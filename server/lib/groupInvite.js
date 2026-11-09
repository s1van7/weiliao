/**
 * 群邀请领域服务：
 *   - token 用 crypto.randomBytes(24).toString('base64url')；
 *   - 二维码内容 = 'wlgroup:' + token（与用户名片码区分）；
 *   - 链接 = '#/join/' + token；
 *   - 默认 7 天有效，刷新时吊销旧 token；
 *   - 入群受 50 人上限约束，入群后写 system 消息并广播。
 */
import crypto from 'node:crypto';
import { db, now, tx } from '../db.js';
import { ApiError } from './http.js';
import { toInt } from './serialize.js';
import { getConversationRow, isMember, memberIds, summarizeConversation } from './conversations.js';
import { insertSystemMessage, notifyConversationUpdate } from './messages.js';
import { requireMember, roleOf } from './groupAuth.js';
import { emitToUsers } from './realtime.js';

/** 群邀请默认有效期（毫秒，7 天） */
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
/** 群人数上限 */
const GROUP_MAX_MEMBERS = 50;
/** 群邀请二维码前缀 */
export const GROUP_INVITE_PREFIX = 'wlgroup:';

/**
 * 归一化入参 token：兼容「wlgroup:<token>」「#/join/<token>」与链接末段。
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeInviteToken(raw) {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  if (!value) return '';
  if (value.startsWith(GROUP_INVITE_PREFIX)) {
    value = value.slice(GROUP_INVITE_PREFIX.length);
  }
  const segments = value.split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : '';
}

/**
 * 序列化 invite 行为对外结构。
 * @param {Record<string, unknown>} row group_invites 行
 * @returns {{token:string, qr_content:string, link:string, expires_at:number}}
 */
function toInviteShape(row) {
  const token = String(row.token ?? '');
  return {
    token,
    qr_content: `${GROUP_INVITE_PREFIX}${token}`,
    link: `#/join/${token}`,
    expires_at: Number(row.expires_at ?? 0),
  };
}

/**
 * 查某群当前有效的邀请。
 * @param {number|string} conversationId
 * @returns {Record<string, unknown>|null}
 */
function findValidInvite(conversationId) {
  const convId = toInt(conversationId, 0);
  if (convId <= 0) return null;
  return (
    db
      .prepare(
        `SELECT * FROM group_invites
          WHERE conversation_id = ? AND revoked = 0 AND expires_at > ?
          ORDER BY id DESC LIMIT 1`,
      )
      .get(convId, now()) ?? null
  );
}

/**
 * 按 token 查有效邀请。
 * @param {string} token
 * @returns {Record<string, unknown>|null}
 */
function findValidInviteByToken(token) {
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT * FROM group_invites
          WHERE token = ? AND revoked = 0 AND expires_at > ?
          LIMIT 1`,
      )
      .get(token, now()) ?? null
  );
}

/**
 * 签发一条邀请并落库。
 * @param {number} conversationId
 * @param {number} userId
 * @returns {{token:string, qr_content:string, link:string, expires_at:number}}
 */
function issueInvite(conversationId, userId) {
  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = now() + INVITE_TTL_MS;
  const createdAt = now();

  tx(() => {
    db.prepare(
      `INSERT INTO group_invites (conversation_id, token, created_by, expires_at, revoked, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
    ).run(conversationId, token, userId, expiresAt, createdAt);
  });

  const row = db.prepare('SELECT * FROM group_invites WHERE token = ?').get(token);
  return toInviteShape(row);
}

/**
 * 取或创建群邀请（有效 token 复用）。
 * @param {number|string} conversationId
 * @param {number|string} userId
 * @returns {{token:string, qr_content:string, link:string, expires_at:number}}
 * @throws {ApiError} 404 NOT_GROUP / 403 FORBIDDEN
 */
export function getOrCreateInvite(conversationId, userId) {
  requireMember(conversationId, userId);
  const existing = findValidInvite(conversationId);
  if (existing) return toInviteShape(existing);
  return issueInvite(toInt(conversationId, 0), toInt(userId, 0));
}

/**
 * 刷新群邀请：吊销旧 token 并签发新 token。
 * @param {number|string} conversationId
 * @param {number|string} userId
 * @returns {{token:string, qr_content:string, link:string, expires_at:number}}
 * @throws {ApiError} 404 NOT_GROUP / 403 FORBIDDEN
 */
export function refreshInvite(conversationId, userId) {
  requireMember(conversationId, userId);
  const convId = toInt(conversationId, 0);
  tx(() => {
    db.prepare('UPDATE group_invites SET revoked = 1 WHERE conversation_id = ? AND revoked = 0').run(convId);
  });
  return issueInvite(convId, toInt(userId, 0));
}

/**
 * 解析群邀请：返回群信息与「我是否已入群」。
 * @param {unknown} token
 * @param {number|string} userId 当前用户 id（用于计算 already_joined / my_role）
 * @returns {{group:{id:number, name:string, avatar_url:string, member_count:number}, already_joined:boolean, my_role?:string}}
 * @throws {ApiError} 404 GROUP_INVITE_INVALID
 */
export function resolveInvite(token, userId) {
  const normalized = normalizeInviteToken(token);
  const row = normalized ? findValidInviteByToken(normalized) : null;
  if (!row) {
    throw new ApiError(404, 'GROUP_INVITE_INVALID', '群邀请无效或已过期');
  }

  const convId = Number(row.conversation_id);
  const uid = toInt(userId, 0);
  const conversation = getConversationRow(convId);
  if (!conversation || conversation.type !== 'group') {
    throw new ApiError(404, 'GROUP_INVITE_INVALID', '群邀请无效或已过期');
  }

  const alreadyJoined = isMember(convId, uid);
  let myRole;
  if (alreadyJoined) {
    const memberRow = db
      .prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(convId, uid);
    myRole = roleOf(memberRow);
  }

  return {
    group: {
      id: convId,
      name: conversation.name ?? '',
      avatar_url: String(conversation.avatar_url ?? ''),
      member_count: memberIds(convId).length,
    },
    already_joined: alreadyJoined,
    my_role: myRole,
  };
}

/**
 * 通过群邀请入群（已入群幂等；受 50 人上限约束）。
 * @param {unknown} token
 * @param {number|string} userId
 * @returns {{conversation_id:number, already_joined:boolean}}
 * @throws {ApiError} 404 GROUP_INVITE_INVALID / 400 GROUP_FULL
 */
export function joinByInvite(token, userId) {
  const normalized = normalizeInviteToken(token);
  const row = normalized ? findValidInviteByToken(normalized) : null;
  if (!row) {
    throw new ApiError(404, 'GROUP_INVITE_INVALID', '群邀请无效或已过期');
  }

  const convId = Number(row.conversation_id);
  const uid = toInt(userId, 0);
  if (uid <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }
  const conversation = getConversationRow(convId);
  if (!conversation || conversation.type !== 'group') {
    throw new ApiError(404, 'GROUP_INVITE_INVALID', '群邀请无效或已过期');
  }

  const outcome = tx(() => {
    const currentMembers = memberIds(convId);
    if (currentMembers.includes(uid)) {
      return { already: true, systemMessage: null, oldMembers: currentMembers };
    }
    if (currentMembers.length >= GROUP_MAX_MEMBERS) {
      throw new ApiError(400, 'GROUP_FULL', `群聊最多 ${GROUP_MAX_MEMBERS} 人`);
    }

    db.prepare(
      `INSERT INTO conversation_members
         (conversation_id, user_id, role, unread_count, last_read_message_id, joined_at)
       VALUES (?, ?, 'member', 0, 0, ?)`,
    ).run(convId, uid, now());

    const nicknameRow = db.prepare('SELECT nickname FROM users WHERE id = ?').get(uid);
    const nickname = nicknameRow ? String(nicknameRow.nickname ?? '') : '新成员';
    const systemMessage = insertSystemMessage(convId, uid, `「${nickname}」通过群邀请加入了群聊`);
    return { already: false, systemMessage, oldMembers: currentMembers };
  });

  if (outcome.already) {
    return { conversation_id: convId, already_joined: true };
  }

  const summary = summarizeConversation(getConversationRow(convId));
  emitToUsers([uid], 'conversation:new', { conversation_id: convId, conversation: summary });
  notifyConversationUpdate(
    convId,
    memberIds(convId),
    {
      id: outcome.systemMessage.id,
      type: outcome.systemMessage.type,
      content: outcome.systemMessage.content,
      revoked: outcome.systemMessage.revoked,
      sender_id: outcome.systemMessage.sender_id,
      created_at: outcome.systemMessage.created_at,
      sender_nickname: outcome.systemMessage.sender_nickname,
      sender_avatar_url: outcome.systemMessage.sender_avatar_url,
    },
    outcome.systemMessage.created_at,
  );

  return { conversation_id: convId, already_joined: false };
}

export default { normalizeInviteToken, getOrCreateInvite, refreshInvite, resolveInvite, joinByInvite };
