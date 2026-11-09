/**
 * 消息全文搜索领域服务。
 *
 * 搜索范围 = 我参与的会话中、未撤回的消息，字段覆盖 content（含名片 JSON 内嵌昵称）与 file_name。
 * 当前环境 node:sqlite 未编译 FTS5，因此采用 LIKE 兜底（%kw% 无法走索引，大库量为已知限制）。
 */
import { db } from '../db.js';
import { ApiError } from './http.js';
import { toInt } from './serialize.js';
import { serializeMessage } from './messages.js';

/** 搜索关键词长度上限 */
const QUERY_MAX = 32;
/** 默认分页条数 */
const PAGE_DEFAULT = 20;
/** 最大分页条数 */
const PAGE_MAX = 50;
/** 允许的消息类型过滤值 */
const SEARCH_TYPES = Object.freeze(new Set(['text', 'image', 'file', 'card', 'voice', 'video', 'sticker', 'merged']));

/**
 * 转义 SQL LIKE 通配符，配合 ESCAPE '\' 使用。
 * @param {string} text
 * @returns {string}
 */
function escapeLike(text) {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * 消息行查询片段（与 lib/messages.js 的序列化字段保持一致）。
 */
const MESSAGE_SELECT = `SELECT m.id, m.conversation_id, m.sender_id, m.type, m.content, m.client_id, m.revoked, m.mentions,
                               m.voice_url, m.voice_duration,
                               m.video_url, m.video_duration,
                               m.file_url, m.file_name, m.file_size,
                               m.transcript,
                               m.created_at,
                               u.nickname AS sender_nickname, u.avatar_color AS sender_avatar_color,
                               u.avatar_url AS sender_avatar_url
                          FROM messages m
                          JOIN users u ON u.id = m.sender_id`;

/**
 * 搜索消息（我参与的会话 + content/file_name LIKE + 类型过滤 + before_id 游标倒序）。
 * @param {{userId:unknown, query:unknown, type?:unknown, beforeId?:unknown, limit?:unknown}} input
 * @returns {{results:Array<{message:object, conversation:{id:number, type:string, name:string|null, peer:object|null}}>, has_more:boolean}}
 * @throws {ApiError} 400 INVALID_PARAM
 */
export function searchMessages({ userId, query, type, beforeId, limit }) {
  const uid = toInt(userId, 0);
  if (uid <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }

  const keyword = typeof query === 'string' ? query.trim() : '';
  if (!keyword) {
    throw new ApiError(400, 'INVALID_PARAM', '搜索关键词不能为空');
  }
  if ([...keyword].length > QUERY_MAX) {
    throw new ApiError(400, 'INVALID_PARAM', `搜索关键词最多 ${QUERY_MAX} 个字符`);
  }

  const normalizedType = typeof type === 'string' ? type.trim() : '';
  if (normalizedType && !SEARCH_TYPES.has(normalizedType)) {
    throw new ApiError(400, 'INVALID_PARAM', 'type 参数不合法');
  }

  const cursor = toInt(beforeId, 0) > 0 ? toInt(beforeId, 0) : Number.MAX_SAFE_INTEGER;
  const rawLimit = toInt(limit, PAGE_DEFAULT);
  const pageSize = Math.min(Math.max(rawLimit > 0 ? rawLimit : PAGE_DEFAULT, 1), PAGE_MAX);

  const likePattern = `%${escapeLike(keyword)}%`;
  const conditions = [
    `m.revoked = 0`,
    `m.conversation_id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?)`,
    `(m.content LIKE ? ESCAPE '\\' OR m.file_name LIKE ? ESCAPE '\\')`,
    `m.id < ?`,
  ];
  const params = [uid, likePattern, likePattern, cursor];
  if (normalizedType) {
    conditions.push('m.type = ?');
    params.push(normalizedType);
  }

  const rows = db
    .prepare(`${MESSAGE_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY m.id DESC LIMIT ?`)
    .all(...params, pageSize + 1);

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  if (page.length === 0) {
    return { results: [], has_more: hasMore };
  }

  // 批量取会话摘要，避免逐条查库
  const conversationIds = [...new Set(page.map((row) => Number(row.conversation_id)))];
  const placeholders = conversationIds.map(() => '?').join(', ');
  const conversationRows = db
    .prepare(`SELECT * FROM conversations WHERE id IN (${placeholders})`)
    .all(...conversationIds);
  const conversationMap = new Map(conversationRows.map((row) => [Number(row.id), row]));

  // 单聊对端（peer）
  const peerRows = db
    .prepare(
      `SELECT cm.conversation_id AS conversation_id, u.id, u.nickname, u.avatar_color, u.avatar_url
         FROM conversation_members cm
         JOIN users u ON u.id = cm.user_id
        WHERE cm.conversation_id IN (${placeholders}) AND cm.user_id <> ?`,
    )
    .all(...conversationIds, uid);
  const peerMap = new Map();
  for (const row of peerRows) {
    if (!peerMap.has(Number(row.conversation_id))) {
      peerMap.set(Number(row.conversation_id), {
        id: Number(row.id),
        nickname: row.nickname ?? '',
        avatar_color: row.avatar_color ?? '#07C160',
        avatar_url: row.avatar_url ?? '',
      });
    }
  }

  const results = page.map((row) => {
    const conversationId = Number(row.conversation_id);
    const conversation = conversationMap.get(conversationId);
    return {
      message: serializeMessage(row),
      conversation: conversation
        ? {
            id: conversationId,
            type: conversation.type,
            name: conversation.type === 'group' ? (conversation.name ?? null) : null,
            peer: conversation.type === 'single' ? (peerMap.get(conversationId) ?? null) : null,
          }
        : { id: conversationId, type: 'single', name: null, peer: null },
    };
  });

  return { results, has_more: hasMore };
}

export default { searchMessages };
