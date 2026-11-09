/**
 * 面对面配对领域服务：
 *   - 4 位数字码（1000-9999），5 分钟有效；
 *   - kind=file 上限 2 人，凑满即创建/复用单聊并置 allow_non_friend_send=1；
 *   - kind=group 不限人数，成组（含自己 ≥3）后复用 createGroupConversation 建群；
 *   - 码在 (kind, 有效期内) 应用层唯一，过期配对惰性清理。
 */
import crypto from 'node:crypto';
import { db, now, tx } from '../db.js';
import { ApiError } from './http.js';
import { toInt } from './serialize.js';
import { createGroupConversation, ensurePairConversation, getConversationRow, summarizeConversation } from './conversations.js';
import { emitToUser, emitToUsers } from './realtime.js';

/** 4 位数字码取值区间 */
const CODE_MIN = 1000;
const CODE_MAX = 9999;
/** 配对有效期（毫秒） */
const TTL_MS = 5 * 60 * 1000;
/** 面对面传文件人数上限 */
const FILE_MAX_MEMBERS = 2;
/** 允许的配对类型 */
const KINDS = Object.freeze(new Set(['file', 'group']));

/**
 * 校验并归一化 kind。
 * @param {unknown} kind
 * @returns {'file'|'group'}
 * @throws {ApiError} 400 INVALID_PARAM
 */
function parseKind(kind) {
  const value = typeof kind === 'string' ? kind.trim() : '';
  if (!KINDS.has(value)) {
    throw new ApiError(400, 'INVALID_PARAM', "kind 仅支持 'file' 或 'group'");
  }
  return /** @type {'file'|'group'} */ (value);
}

/**
 * 校验并归一化 4 位数字码。
 * @param {unknown} code
 * @returns {string}
 * @throws {ApiError} 400 INVALID_PARAM
 */
function normalizeCode(code) {
  const value = String(code ?? '').trim();
  if (!/^\d{4}$/.test(value)) {
    throw new ApiError(400, 'INVALID_PARAM', '数字码必须是 4 位数字');
  }
  return value;
}

/**
 * 清理已过期的配对（成员由 ON DELETE CASCADE 一并删除）。
 * @returns {void}
 */
function cleanupExpired() {
  db.prepare('DELETE FROM face_pairings WHERE expires_at <= ?').run(now());
}

/**
 * 查询 (kind, code) 下仍有效的配对。
 * @param {string} kind
 * @param {string} code
 * @returns {Record<string, unknown>|null}
 */
function findActivePairing(kind, code) {
  return (
    db
      .prepare(
        `SELECT * FROM face_pairings
          WHERE kind = ? AND code = ? AND resolved = 0 AND expires_at > ?
          ORDER BY id DESC LIMIT 1`,
      )
      .get(kind, code, now()) ?? null
  );
}

/**
 * 生成一个 (kind, 有效期内) 未冲突的 4 位码。
 * @param {string} kind
 * @returns {string}
 */
function generateCode(kind) {
  for (;;) {
    const code = String(crypto.randomInt(CODE_MIN, CODE_MAX + 1));
    if (!findActivePairing(kind, code)) return code;
  }
}

/**
 * 配对成员 user_id 列表（按加入时间升序）。
 * @param {number} pairingId
 * @returns {number[]}
 */
function pairingMemberIds(pairingId) {
  return db
    .prepare('SELECT user_id FROM face_pairing_members WHERE pairing_id = ? ORDER BY joined_at ASC, user_id ASC')
    .all(pairingId)
    .map((row) => Number(row.user_id));
}

/**
 * 配对成员摘要列表。
 * @param {number} pairingId
 * @returns {Array<{user_id:number, nickname:string, avatar_color:string, avatar_url:string}>}
 */
function pairingMemberSummaries(pairingId) {
  return db
    .prepare(
      `SELECT u.id AS user_id, u.nickname, u.avatar_color, u.avatar_url
         FROM face_pairing_members fpm
         JOIN users u ON u.id = fpm.user_id
        WHERE fpm.pairing_id = ?
        ORDER BY fpm.joined_at ASC, fpm.user_id ASC`,
    )
    .all(pairingId)
    .map((row) => ({
      user_id: Number(row.user_id),
      nickname: row.nickname ?? '',
      avatar_color: row.avatar_color ?? '#07C160',
      avatar_url: row.avatar_url ?? '',
    }));
}

/**
 * 取用户昵称。
 * @param {number} userId
 * @returns {string}
 */
function nicknameOf(userId) {
  const row = db.prepare('SELECT nickname FROM users WHERE id = ?').get(userId);
  return row ? String(row.nickname ?? '') : '';
}

/**
 * 创建配对（创建者自动成为第一个成员）。
 * @param {number|string} userId
 * @param {'file'|'group'} kind
 * @returns {{pairing_id:number, code:string, expires_at:number, member_count:number}}
 */
export function createPairing(userId, kind) {
  const uid = toInt(userId, 0);
  const normalizedKind = parseKind(kind);
  if (uid <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }

  cleanupExpired();
  const code = generateCode(normalizedKind);
  const expiresAt = now() + TTL_MS;
  const createdAt = now();

  const pairingId = tx(() => {
    const inserted = db
      .prepare(
        'INSERT INTO face_pairings (code, kind, expires_at, resolved, created_at) VALUES (?, ?, ?, 0, ?)',
      )
      .run(code, normalizedKind, expiresAt, createdAt);
    const pid = Number(inserted.lastInsertRowid);
    db.prepare('INSERT INTO face_pairing_members (pairing_id, user_id, joined_at) VALUES (?, ?, ?)').run(
      pid,
      uid,
      createdAt,
    );
    return pid;
  });

  return { pairing_id: pairingId, code, expires_at: expiresAt, member_count: 1 };
}

/**
 * 加入配对。
 * @param {number|string} userId
 * @param {'file'|'group'} kind
 * @param {unknown} code
 * @returns {{pairing_id:number, members:Array<object>, conversation_id?:number, peer_user_id?:number}}
 * @throws {ApiError} 404 PAIR_NOT_FOUND / 409 PAIR_FULL / 400 INVALID_PARAM
 */
export function joinPairing(userId, kind, code) {
  const uid = toInt(userId, 0);
  const normalizedKind = parseKind(kind);
  const normalizedCode = normalizeCode(code);
  if (uid <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }

  cleanupExpired();
  const pairing = findActivePairing(normalizedKind, normalizedCode);
  if (!pairing) {
    throw new ApiError(404, 'PAIR_NOT_FOUND', '数字码不存在或已过期');
  }

  const pairingId = Number(pairing.id);
  const existingIds = pairingMemberIds(pairingId);

  // 幂等：已加入则返回当前状态
  if (existingIds.includes(uid)) {
    return { pairing_id: pairingId, members: pairingMemberSummaries(pairingId) };
  }

  if (normalizedKind === 'file' && existingIds.length >= FILE_MAX_MEMBERS) {
    throw new ApiError(409, 'PAIR_FULL', '面对面传文件最多 2 人');
  }

  db.prepare('INSERT OR IGNORE INTO face_pairing_members (pairing_id, user_id, joined_at) VALUES (?, ?, ?)').run(
    pairingId,
    uid,
    now(),
  );

  const members = pairingMemberSummaries(pairingId);
  const memberUserIds = members.map((member) => member.user_id);

  if (normalizedKind === 'file' && memberUserIds.length >= FILE_MAX_MEMBERS) {
    const peerId = memberUserIds.find((id) => id !== uid);
    const conversationId = tx(() => {
      const convId = ensurePairConversation(uid, peerId);
      db.prepare('UPDATE conversations SET allow_non_friend_send = 1 WHERE id = ?').run(convId);
      return convId;
    });

    // 分别推给两个成员，各自的 peer_user_id 指向对方
    for (const id of memberUserIds) {
      const peer = memberUserIds.find((other) => other !== id);
      emitToUser(id, 'face-pair:ready', {
        pairing_id: pairingId,
        conversation_id: conversationId,
        peer_user_id: peer,
      });
    }

    return {
      pairing_id: pairingId,
      members,
      conversation_id: conversationId,
      peer_user_id: peerId,
    };
  }

  emitToUsers(
    memberUserIds.filter((id) => id !== uid),
    'face-pair:update',
    { pairing_id: pairingId, members },
  );

  return { pairing_id: pairingId, members };
}

/**
 * 查询配对详情（非成员 403）。
 * @param {number|string} pairingId
 * @param {number|string} userId
 * @returns {{pairing:{id:number, kind:string, code:string, expires_at:number}, members:Array<object>}}
 * @throws {ApiError} 404 PAIR_NOT_FOUND / 403 FORBIDDEN
 */
export function getPairing(pairingId, userId) {
  const pid = toInt(pairingId, 0);
  const uid = toInt(userId, 0);
  if (pid <= 0) {
    throw new ApiError(404, 'PAIR_NOT_FOUND', '配对不存在或已过期');
  }

  const pairing = db.prepare('SELECT id, code, kind, expires_at FROM face_pairings WHERE id = ?').get(pid);
  if (!pairing || Number(pairing.expires_at) <= now()) {
    throw new ApiError(404, 'PAIR_NOT_FOUND', '配对不存在或已过期');
  }
  if (!pairingMemberIds(pid).includes(uid)) {
    throw new ApiError(403, 'FORBIDDEN', '你不在该配对中');
  }

  return {
    pairing: {
      id: Number(pairing.id),
      kind: pairing.kind,
      code: pairing.code,
      expires_at: Number(pairing.expires_at),
    },
    members: pairingMemberSummaries(pid),
  };
}

/**
 * 面对面建群：成员含自己 ≥3 时成组，复用共享建群 helper（allowNonFriends=true）。
 * 建群成功后删除配对并广播 face-pair:resolved。
 * @param {number|string} pairingId
 * @param {number|string} userId
 * @returns {{conversation_id:number}}
 * @throws {ApiError} 404 PAIR_NOT_FOUND / 403 FORBIDDEN / 400 PAIR_TOO_FEW / 400 INVALID_PARAM
 */
export function createGroupFromPairing(pairingId, userId) {
  const pid = toInt(pairingId, 0);
  const uid = toInt(userId, 0);
  if (pid <= 0 || uid <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '配对参数不合法');
  }

  const pairing = db.prepare('SELECT * FROM face_pairings WHERE id = ?').get(pid);
  if (!pairing || Number(pairing.resolved) === 1 || Number(pairing.expires_at) <= now()) {
    throw new ApiError(404, 'PAIR_NOT_FOUND', '配对不存在或已过期');
  }
  if (pairing.kind !== 'group') {
    throw new ApiError(400, 'INVALID_PARAM', '该配对不是面对面建群');
  }

  const memberUserIds = pairingMemberIds(pid);
  if (!memberUserIds.includes(uid)) {
    throw new ApiError(403, 'FORBIDDEN', '你不在该配对中');
  }
  if (memberUserIds.length < 3) {
    throw new ApiError(400, 'PAIR_TOO_FEW', '面对面建群至少 3 人（含自己）');
  }

  const ownerId = memberUserIds[0];
  const result = createGroupConversation({
    ownerId,
    ownerNickname: nicknameOf(ownerId),
    memberIds: memberUserIds.slice(1),
    name: '',
    allowNonFriends: true,
  });
  const conversationId = result.conversationId;

  tx(() => {
    db.prepare('DELETE FROM face_pairings WHERE id = ?').run(pid);
  });

  const summary = summarizeConversation(getConversationRow(conversationId));
  emitToUsers(memberUserIds, 'conversation:new', { conversation_id: conversationId, conversation: summary });
  emitToUsers(memberUserIds, 'face-pair:resolved', { pairing_id: pid, conversation_id: conversationId });

  return { conversation_id: conversationId };
}

export default { createPairing, joinPairing, getPairing, createGroupFromPairing };
