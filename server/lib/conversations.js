/**
 * 会话领域共享工具：成员校验、好友判定、单聊会话幂等创建、会话摘要序列化。
 * 只依赖 db / http / pair / serialize，不依赖任何路由或 socket 模块。
 */
import { db, now, tx } from '../db.js';
import { ApiError } from './http.js';
import { orderPair, pairKey } from './pair.js';
import { toInt } from './serialize.js';
import { DEFAULT_PERMISSIONS, announcementUnread, loadGroup, myRole, permissionsOf } from './groupAuth.js';
import { isBlocked } from './friendPermissions.js';

/** 群聊人数上下限（含自己） */
export const GROUP_MIN_MEMBERS = 3;
export const GROUP_MAX_MEMBERS = 50;
/** 群名称长度上限（与 routes/groups.js、前端 config 保持一致） */
const GROUP_NAME_MAX = 30;
/** 默认群名取前 N 位成员昵称 */
const DEFAULT_NAME_MEMBERS = 3;
/** 默认群名总长上限 */
const DEFAULT_NAME_MAX = 20;

/**
 * 判断两人是否已是好友。
 * @param {number|string} a
 * @param {number|string} b
 * @returns {boolean}
 */
export function areFriends(a, b) {
  const [low, high] = orderPair(a, b);
  const row = db.prepare('SELECT 1 AS hit FROM friendships WHERE user_low_id = ? AND user_high_id = ?').get(low, high);
  return Boolean(row);
}

/**
 * 取会话行。
 * @param {number|string} conversationId
 * @returns {Record<string, unknown>|null}
 */
export function getConversationRow(conversationId) {
  const id = toInt(conversationId);
  if (!id) return null;
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) ?? null;
}

/**
 * 是否会话成员。
 * @param {number|string} conversationId
 * @param {number|string} userId
 * @returns {boolean}
 */
export function isMember(conversationId, userId) {
  const convId = toInt(conversationId);
  const uid = toInt(userId);
  if (!convId || !uid) return false;
  const row = db
    .prepare('SELECT 1 AS hit FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(convId, uid);
  return Boolean(row);
}

/**
 * 断言是会话成员，返回成员行；否则抛 403 FORBIDDEN。
 * @param {number|string} conversationId
 * @param {number|string} userId
 * @returns {Record<string, unknown>}
 */
export function assertMember(conversationId, userId) {
  const row = getMemberRow(conversationId, userId);
  if (!row) {
    throw new ApiError(403, 'FORBIDDEN', '你不在该会话中');
  }
  return row;
}

/**
 * 取成员行（不存在返回 null）。
 * @param {number|string} conversationId
 * @param {number|string} userId
 * @returns {Record<string, unknown>|null}
 */
export function getMemberRow(conversationId, userId) {
  const convId = toInt(conversationId);
  const uid = toInt(userId);
  if (!convId || !uid) return null;
  return (
    db
      .prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(convId, uid) ?? null
  );
}

/**
 * 会话成员 id 列表（按加入时间升序）。
 * @param {number|string} conversationId
 * @returns {number[]}
 */
export function memberIds(conversationId) {
  const convId = toInt(conversationId);
  if (!convId) return [];
  return db
    .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? ORDER BY joined_at ASC, user_id ASC')
    .all(convId)
    .map((row) => Number(row.user_id));
}

/**
 * 我参与的所有会话 id。
 * @param {number|string} userId
 * @returns {number[]}
 */
export function myConversationIds(userId) {
  const uid = toInt(userId);
  if (!uid) return [];
  return db
    .prepare('SELECT conversation_id FROM conversation_members WHERE user_id = ? ORDER BY conversation_id ASC')
    .all(uid)
    .map((row) => Number(row.conversation_id));
}

/**
 * 我的未读消息总数。
 *
 * 与 GET /conversations 的可见性口径保持一致：已隐藏（且没有更新时间戳之后的新消息）
 * 的会话不计入未读，避免「Tab 有红点但列表里找不到该会话」。
 * @param {number|string} userId
 * @returns {number}
 */
export function unreadTotal(userId) {
  const uid = toInt(userId);
  if (!uid) return 0;
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cm.unread_count), 0) AS total
         FROM conversation_members cm
         JOIN conversations c ON c.id = cm.conversation_id
        WHERE cm.user_id = ?
          AND (cm.hidden = 0 OR c.last_message_at > cm.hidden_at)`,
    )
    .get(uid);
  return Number(row?.total ?? 0);
}

/**
 * 幂等创建单聊会话并补全两个成员，返回会话 id。
 * 必须在 tx() 内调用（多表写入）。
 * @param {number|string} a
 * @param {number|string} b
 * @returns {number}
 */
export function ensurePairConversation(a, b) {
  const [low, high] = orderPair(a, b);
  const key = pairKey(low, high);
  const createdAt = now();

  db.prepare(
    `INSERT OR IGNORE INTO conversations (type, pair_key, name, owner_id, last_message_at, created_at)
     VALUES ('single', ?, NULL, NULL, 0, ?)`,
  ).run(key, createdAt);

  const conversation = db.prepare('SELECT id FROM conversations WHERE pair_key = ?').get(key);
  if (!conversation) {
    throw new ApiError(500, 'INTERNAL_ERROR', '单聊会话创建失败');
  }
  const conversationId = Number(conversation.id);

  const insertMember = db.prepare(
    `INSERT OR IGNORE INTO conversation_members
       (conversation_id, user_id, role, unread_count, last_read_message_id, joined_at)
     VALUES (?, ?, 'member', 0, 0, ?)`,
  );
  insertMember.run(conversationId, low, createdAt);
  insertMember.run(conversationId, high, createdAt);

  return conversationId;
}

/**
 * 会话摘要（用于列表与实时推送里的 conversation 字段）。
 * @param {Record<string, unknown>} row conversations 行
 * @returns {{id:number, type:string, name:string|null, avatar_url:string, owner_id:number|null, last_message_at:number, member_count:number}|null}
 */
export function summarizeConversation(row) {
  if (!row) return null;
  const conversationId = Number(row.id);
  const countRow = db
    .prepare('SELECT COUNT(*) AS total FROM conversation_members WHERE conversation_id = ?')
    .get(conversationId);
  return {
    id: conversationId,
    type: row.type,
    name: row.name ?? null,
    avatar_url: String(row.avatar_url ?? ''),
    owner_id: row.owner_id === null || row.owner_id === undefined ? null : Number(row.owner_id),
    last_message_at: Number(row.last_message_at ?? 0),
    member_count: Number(countRow?.total ?? 0),
  };
}

/**
 * 会话详情（列表页 / 群设置页共用的完整结构）。
 *
 * 先在会话字段上补齐群资料（头像、公告、权限、我的角色），
 * 再挂上成员列表；单聊没有群权限概念，permissions 返回默认值兜底。
 * @param {number|string} conversationId 会话 id
 * @param {number|string} userId 当前用户 id
 * @returns {{conversation:Record<string, unknown>}|null} 会话不存在或我不是成员时返回 null
 */
export function conversationDetail(conversationId, userId) {
  const convId = toInt(conversationId, 0);
  const uid = toInt(userId, 0);
  if (convId <= 0 || uid <= 0) return null;

  const row = getConversationRow(convId);
  if (!row) return null;

  const members = memberDetails(convId);
  const me = members.find((member) => member.user_id === uid) ?? null;
  if (!me) return null;

  const myMember = getMemberRow(convId, uid);

  // 单聊只读判定：拉黑恒只读；非好友仅 allow_non_friend_send=1 时临时放行；群聊恒可写
  let readonly = false;
  if (row.type === 'single') {
    const peer = members.find((member) => member.user_id !== uid);
    if (peer) {
      const allowNonFriendSend = Number(row.allow_non_friend_send ?? 0) === 1;
      if (isBlocked(uid, peer.user_id)) {
        readonly = true;
      } else if (!areFriends(uid, peer.user_id) && !allowNonFriendSend) {
        readonly = true;
      }
    }
  }

  // 群权限统一由 groupAuth 判定，镜像到 my_role / permissions 供前端做按钮显隐
  const ctx = row.type === 'group' ? loadGroup(convId, uid) : null;

  return {
    conversation: {
      id: Number(row.id),
      type: row.type,
      name: row.name ?? null,
      owner_id: row.owner_id === null || row.owner_id === undefined ? null : Number(row.owner_id),
      created_at: Number(row.created_at),
      avatar_url: String(row.avatar_url ?? ''),
      announcement: String(row.announcement ?? ''),
      announcement_at: Number(row.announcement_at ?? 0),
      announcement_unread: ctx ? announcementUnread(ctx) : false,
      my_role: ctx ? myRole(ctx) : me.role ?? 'member',
      permissions: ctx ? permissionsOf(ctx) : { ...DEFAULT_PERMISSIONS },
      member_count: members.length,
      readonly,
      background_url: String(myMember?.background_url ?? ''),
      members,
    },
  };
}

/**
 * 会话成员详情（含昵称/头像色/头像图/角色/加入时间）。
 * @param {number|string} conversationId
 * @returns {Array<{user_id:number, nickname:string, avatar_color:string, avatar_url:string, role:string, joined_at:number}>}
 */
export function memberDetails(conversationId) {
  const convId = toInt(conversationId);
  if (!convId) return [];
  return db
    .prepare(
      `SELECT cm.user_id, cm.role, cm.joined_at, u.nickname, u.avatar_color, u.avatar_url
         FROM conversation_members cm
         JOIN users u ON u.id = cm.user_id
        WHERE cm.conversation_id = ?
        ORDER BY cm.joined_at ASC, cm.user_id ASC`,
    )
    .all(convId)
    .map((row) => ({
      user_id: Number(row.user_id),
      nickname: row.nickname ?? '',
      avatar_color: row.avatar_color ?? '#07C160',
      avatar_url: row.avatar_url ?? '',
      role: row.role,
      joined_at: Number(row.joined_at),
    }));
}

/**
 * 批量取我的好友 id 集合。
 * @param {number} userId
 * @returns {Set<number>}
 */
export function friendIdSet(userId) {
  const uid = toInt(userId, 0);
  const rows = db
    .prepare(
      `SELECT user_high_id AS other_id FROM friendships WHERE user_low_id = ?
       UNION
       SELECT user_low_id AS other_id FROM friendships WHERE user_high_id = ?`,
    )
    .all(uid, uid);
  return new Set(rows.map((row) => Number(row.other_id)));
}

/**
 * 批量取用户昵称。
 * @param {number[]} ids
 * @returns {Map<number, string>}
 */
function nicknameMap(ids) {
  const map = new Map();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.prepare(`SELECT id, nickname FROM users WHERE id IN (${placeholders})`).all(...ids);
  for (const row of rows) map.set(Number(row.id), row.nickname ?? '');
  return map;
}

/**
 * 在事务内写入一条 system 消息并累加未读、刷新会话摘要。
 * 与 lib/messages.js#insertSystemMessage 逻辑一致，但为避免 conversations ↔ messages
 * 的循环依赖，这里内联一份最小实现（仅群创建场景使用）。
 * @param {number} conversationId
 * @param {number} actorId
 * @param {string} content
 * @param {number} timestamp
 * @returns {void}
 */
function insertSystemMessageLocal(conversationId, actorId, content, timestamp) {
  const inserted = db
    .prepare(
      `INSERT INTO messages (conversation_id, sender_id, type, content, client_id, revoked, created_at)
       VALUES (?, ?, 'system', ?, NULL, 0, ?)`,
    )
    .run(conversationId, actorId, content, timestamp);
  const messageId = Number(inserted.lastInsertRowid);
  db.prepare(
    'UPDATE conversation_members SET unread_count = unread_count + 1 WHERE conversation_id = ? AND user_id <> ?',
  ).run(conversationId, actorId);
  db.prepare('UPDATE conversations SET last_message_at = ?, last_message_id = ? WHERE id = ?').run(
    timestamp,
    messageId,
    conversationId,
  );
}

/**
 * 共享建群 helper：落库群会话 + 成员 + 系统消息，返回新建会话 id 与成员。
 *
 * 必须在 tx() 内调用（多表写入）。allowNonFriends=true 时跳过「成员必须是我的好友」校验，
 * 用于面对面建群（配对内的非好友也可直接入群）。
 * @param {{ownerId:number|string, ownerNickname?:string, memberIds:Array<number|string>, name?:string, allowNonFriends?:boolean}} input
 * @returns {{conversationId:number, members:number[], createdAt:number}}
 * @throws {ApiError} 400 INVALID_PARAM / 403 NOT_FRIEND / 400 TOO_FEW_MEMBERS / 400 GROUP_FULL
 */
export function createGroupConversation({ ownerId, ownerNickname, memberIds, name, allowNonFriends = false }) {
  const owner = toInt(ownerId, 0);
  if (owner <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '群主不合法');
  }

  const rawMembers = Array.isArray(memberIds)
    ? memberIds.map((id) => toInt(id, 0)).filter((id) => id > 0)
    : [];
  const uniqueMembers = [...new Set(rawMembers.filter((id) => id !== owner))];

  if (!allowNonFriends) {
    const friendIds = friendIdSet(owner);
    const notFriend = uniqueMembers.filter((id) => !friendIds.has(id));
    if (notFriend.length > 0) {
      throw new ApiError(403, 'NOT_FRIEND', '只能邀请自己的好友加入群聊');
    }
  }

  const total = uniqueMembers.length + 1;
  if (total < GROUP_MIN_MEMBERS) {
    throw new ApiError(400, 'TOO_FEW_MEMBERS', `群聊至少需要 ${GROUP_MIN_MEMBERS} 人（含自己）`);
  }
  if (total > GROUP_MAX_MEMBERS) {
    throw new ApiError(400, 'GROUP_FULL', `群聊最多 ${GROUP_MAX_MEMBERS} 人`);
  }

  let finalName = typeof name === 'string' ? name.trim() : '';
  if (finalName) {
    if (charLength(finalName) > GROUP_NAME_MAX) {
      throw new ApiError(400, 'INVALID_PARAM', `群名称不能超过 ${GROUP_NAME_MAX} 个字符`);
    }
  } else {
    // 缺省群名：前 3 位成员（自己优先）昵称拼接，最多 20 字
    const preview = [owner, ...uniqueMembers].slice(0, DEFAULT_NAME_MEMBERS);
    const nicknames = nicknameMap(preview);
    const joined = preview.map((id) => nicknames.get(id) ?? '').filter(Boolean).join('、');
    finalName = truncateChars(joined || '群聊', DEFAULT_NAME_MAX);
  }

  const createdAt = now();
  const conversationId = tx(() => {
    const inserted = db
      .prepare(
        `INSERT INTO conversations (type, pair_key, name, owner_id, perm_remove, last_message_at, last_message_id, created_at)
         VALUES ('group', NULL, ?, ?, 'owner', 0, NULL, ?)`,
      )
      .run(finalName, owner, createdAt);
    const convId = Number(inserted.lastInsertRowid);

    const insertMember = db.prepare(
      `INSERT INTO conversation_members
         (conversation_id, user_id, role, unread_count, last_read_message_id, joined_at)
       VALUES (?, ?, ?, 0, 0, ?)`,
    );
    insertMember.run(convId, owner, 'owner', createdAt);
    for (const memberId of uniqueMembers) {
      insertMember.run(convId, memberId, 'member', createdAt + 1);
    }

    const actorName = typeof ownerNickname === 'string' && ownerNickname.trim() !== '' ? ownerNickname.trim() : '群主';
    insertSystemMessageLocal(convId, owner, `「${actorName} 创建了群聊」`, createdAt + 2);

    return convId;
  });

  return { conversationId, members: [owner, ...uniqueMembers], createdAt };
}

/**
 * 统计字符数（emoji 等代理对按 1 个字符计）。
 * @param {string} text
 * @returns {number}
 */
export function charLength(text) {
  return [...String(text ?? '')].length;
}

/**
 * 按字符数截断（不会切断代理对）。
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function truncateChars(text, max) {
  const chars = [...String(text ?? '')];
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('');
}
