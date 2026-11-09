/**
 * 收藏领域服务：消息 / 朋友圈快照式收藏。
 *
 * 快照思路：收藏时把内容整段写入 snapshot_json，源消息 / 动态之后被撤回或删除，
 * 收藏仍可展示。收藏创建复用 findMessageById / findMoment 现有查询，不重复实现。
 */
import { db, now, tx } from '../db.js';
import { ApiError } from './http.js';
import { toInt } from './serialize.js';
import { areFriends, assertMember } from './conversations.js';
import { findMessageById, serializeMessage } from './messages.js';
import { findMoment } from './moments.js';

/** 允许的收藏内容类型 */
const CONTENT_TYPES = Object.freeze(new Set(['message', 'moment']));

/** 收藏列表默认分页条数 */
const FAVORITE_PAGE_DEFAULT = 20;
/** 收藏列表最大分页条数 */
const FAVORITE_PAGE_MAX = 50;

/**
 * 分页条数钳制。
 * @param {unknown} limit
 * @returns {number}
 */
function clampLimit(limit) {
  const raw = toInt(limit, FAVORITE_PAGE_DEFAULT);
  return Math.min(Math.max(raw > 0 ? raw : FAVORITE_PAGE_DEFAULT, 1), FAVORITE_PAGE_MAX);
}

/**
 * 解析快照 JSON，失败返回 null。
 * @param {unknown} raw
 * @returns {Record<string, unknown>|null}
 */
function parseSnapshot(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 构造消息收藏快照。
 * @param {number} messageId 消息 id
 * @param {number} userId 当前用户 id
 * @returns {Record<string, unknown>}
 * @throws {ApiError} 404 NOT_FOUND / 403 FORBIDDEN
 */
function buildMessageSnapshot(messageId, userId) {
  const row = findMessageById(messageId);
  if (!row) {
    throw new ApiError(404, 'NOT_FOUND', '消息不存在');
  }
  const conversationId = Number(row.conversation_id);
  // 仅会话成员可收藏，否则 403（不暴露内容存在性之外的信息）
  assertMember(conversationId, userId);

  const message = serializeMessage(row);
  return {
    kind: 'message',
    message_id: message.id,
    conversation_id: message.conversation_id,
    sender_id: message.sender_id,
    sender_nickname: message.sender_nickname,
    sender_avatar_color: message.sender_avatar_color,
    sender_avatar_url: message.sender_avatar_url,
    type: message.type,
    content: message.content,
    created_at: message.created_at,
  };
}

/**
 * 构造动态收藏快照。
 * @param {number} momentId 动态 id
 * @param {number} userId 当前用户 id
 * @returns {Record<string, unknown>}
 * @throws {ApiError} 404 NOT_FOUND
 */
function buildMomentSnapshot(momentId, userId) {
  // 可见性判定与 lib/moments.js 一致：仅本人或好友，非好友统一 404，不暴露存在性
  const row = db.prepare('SELECT id, user_id FROM moments WHERE id = ?').get(momentId);
  if (!row) {
    throw new ApiError(404, 'NOT_FOUND', '动态不存在');
  }
  const authorId = Number(row.user_id);
  if (authorId !== userId && !areFriends(userId, authorId)) {
    throw new ApiError(404, 'NOT_FOUND', '动态不存在');
  }

  const moment = findMoment(momentId, userId);
  if (!moment) {
    throw new ApiError(404, 'NOT_FOUND', '动态不存在');
  }

  return {
    kind: 'moment',
    moment_id: moment.id,
    user: moment.user,
    content: moment.content,
    media_type: moment.media_type,
    images: moment.images,
    video_url: moment.video_url,
    created_at: moment.created_at,
  };
}

/**
 * 收藏一条消息或动态。
 * @param {number|string} userId 当前用户 id
 * @param {unknown} contentType 'message' | 'moment'
 * @param {unknown} contentId 内容 id
 * @returns {{id:number, content_type:string, content_id:number, created_at:number, snapshot:Record<string, unknown>}}
 * @throws {ApiError} 400 INVALID_PARAM / 404 NOT_FOUND / 403 FORBIDDEN
 */
export function createFavorite(userId, contentType, contentId) {
  const uid = toInt(userId, 0);
  if (uid <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }
  const type = typeof contentType === 'string' ? contentType : '';
  if (!CONTENT_TYPES.has(type)) {
    throw new ApiError(400, 'INVALID_PARAM', 'content_type 仅支持 message 或 moment');
  }
  const id = toInt(contentId, 0);
  if (id <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', 'content_id 不合法');
  }

  const snapshot = type === 'message' ? buildMessageSnapshot(id, uid) : buildMomentSnapshot(id, uid);
  const snapshotJson = JSON.stringify(snapshot);
  const createdAt = now();

  const favoriteId = tx(() => {
    const inserted = db
      .prepare(
        `INSERT INTO favorites (user_id, content_type, content_id, snapshot_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(uid, type, id, snapshotJson, createdAt);
    return Number(inserted.lastInsertRowid);
  });

  return { id: favoriteId, content_type: type, content_id: id, created_at: createdAt, snapshot };
}

/**
 * 我的收藏列表（before_id 游标，倒序）。
 * @param {number|string} userId 当前用户 id
 * @param {{beforeId?: unknown, limit?: unknown}} input 分页参数
 * @returns {{favorites:Array<Record<string, unknown>>, has_more:boolean}}
 */
export function listFavorites(userId, { beforeId, limit } = {}) {
  const uid = toInt(userId, 0);
  if (uid <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }

  const cursor = Math.max(toInt(beforeId, 0), 0);
  const pageSize = clampLimit(limit);

  const rows =
    cursor > 0
      ? db
          .prepare(
            'SELECT * FROM favorites WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT ?',
          )
          .all(uid, cursor, pageSize + 1)
      : db
          .prepare('SELECT * FROM favorites WHERE user_id = ? ORDER BY id DESC LIMIT ?')
          .all(uid, pageSize + 1);

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  const favorites = page.map((row) => ({
    id: Number(row.id),
    content_type: String(row.content_type ?? ''),
    content_id: Number(row.content_id ?? 0),
    created_at: Number(row.created_at ?? 0),
    snapshot: parseSnapshot(row.snapshot_json) ?? null,
  }));

  return { favorites, has_more: hasMore };
}

/**
 * 取消收藏（仅本人，幂等）。
 * @param {number|string} userId 当前用户 id
 * @param {number|string} favoriteId 收藏 id
 * @returns {{deleted:true, id:number}}
 * @throws {ApiError} 400 INVALID_PARAM / 404 NOT_FOUND
 */
export function deleteFavorite(userId, favoriteId) {
  const uid = toInt(userId, 0);
  const id = toInt(favoriteId, 0);
  if (uid <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }
  if (id <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '收藏 id 不合法');
  }

  const result = tx(() => db.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?').run(id, uid));
  if (Number(result.changes) === 0) {
    throw new ApiError(404, 'NOT_FOUND', '收藏不存在');
  }
  return { deleted: true, id };
}

export default { createFavorite, listFavorites, deleteFavorite };
