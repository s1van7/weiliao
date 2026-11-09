/**
 * 通话 / 群会议信令状态机与中继。
 *
 * 职责边界：
 *   - 服务端只做「鉴权 + 房间状态 + 信令中继」，绝不参与媒体面；
 *   - 1v1：callMap 记录主叫 / 被叫 / 媒体类型，点对点转发 offer/answer/ICE；
 *   - 群会议：mesh 拓扑（不硬限人数，前端 >8 人软提示），新加入者对既有成员发起 offer，既有成员 answer；
 *   - 用户断开时清理其参与的通话与会议，并通知对端 / 成员。
 *
 * 约定：
 *   - 全部为纯同步函数（除状态外无 await），错误一律抛 ApiError；
 *   - 广播统一走 realtime.js 的 emitToUser / emitToUsers，不新增 socket 房间；
 *   - 信令寻址使用 user:{id} 个人房间（socket 层已 join）。
 */
import crypto from 'node:crypto';
import { db } from '../db.js';
import { ApiError } from './http.js';
import { toInt } from './serialize.js';
import { areFriends, getConversationRow, memberIds } from './conversations.js';
import { blockedBy } from './friendPermissions.js';
import { emitToUser, emitToUsers, isOnline } from './realtime.js';

/** 允许的 1v1 媒体类型 */
const MEDIA_TYPES = Object.freeze(new Set(['voice', 'video']));

/** callId -> { callerId, calleeId, mediaType } */
const callMap = new Map();

/** confId -> { conversationId, initiatorId, mediaType, members:Set<number> } */
const confMap = new Map();

/**
 * 取用户的对外摘要（含头像信息，供信令对端渲染来电 / 成员头像）。
 * @param {number|string} userId
 * @returns {{user_id:number, nickname:string, avatar_color:string, avatar_url:string}|null}
 */
function userSummary(userId) {
  const id = toInt(userId, 0);
  if (id <= 0) return null;
  const row = db.prepare('SELECT id, nickname, avatar_color, avatar_url FROM users WHERE id = ?').get(id);
  if (!row) return null;
  return {
    user_id: Number(row.id),
    nickname: row.nickname ?? '',
    avatar_color: row.avatar_color ?? '#07C160',
    avatar_url: row.avatar_url ?? '',
  };
}

/**
 * 会议成员摘要列表（按加入顺序）。
 * @param {{members:Set<number>}} conf
 * @returns {Array<{user_id:number, nickname:string, avatar_color:string, avatar_url:string}>}
 */
function memberList(conf) {
  return [...conf.members].map((id) => userSummary(id)).filter(Boolean);
}

/**
 * 校验媒体类型入参。
 * @param {unknown} mediaType
 * @returns {'voice'|'video'}
 * @throws {ApiError} 400 INVALID_PARAM
 */
function parseMediaType(mediaType) {
  const type = typeof mediaType === 'string' ? mediaType.trim() : '';
  if (!MEDIA_TYPES.has(type)) {
    throw new ApiError(400, 'INVALID_PARAM', "media_type 仅支持 'voice' 或 'video'");
  }
  return /** @type {'voice'|'video'} */ (type);
}

/**
 * 主叫发起 1v1 通话邀请。
 * @param {{callerId:unknown, targetUserId:unknown, mediaType:unknown, sdp:unknown}} input
 * @returns {{call_id:string}}
 * @throws {ApiError} 400 INVALID_PARAM / 403 NOT_FRIEND / 409 TARGET_OFFLINE
 */
export function inviteCall({ callerId, targetUserId, mediaType, sdp }) {
  const caller = toInt(callerId, 0);
  const callee = toInt(targetUserId, 0);
  if (caller <= 0 || callee <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '通话双方 id 不合法');
  }
  if (caller === callee) {
    throw new ApiError(400, 'INVALID_PARAM', '不能给自己发起通话');
  }

  if (!areFriends(caller, callee)) {
    throw new ApiError(403, 'NOT_FRIEND', '只能与好友通话');
  }
  if (blockedBy(caller, callee)) {
    throw new ApiError(403, 'BLOCKED', '你已拉黑对方，无法通话');
  }
  if (blockedBy(callee, caller)) {
    throw new ApiError(403, 'BLOCKED_BY_PEER', '对方已拉黑你，无法通话');
  }
  if (!isOnline(callee)) {
    throw new ApiError(409, 'TARGET_OFFLINE', '对方不在线');
  }

  const type = parseMediaType(mediaType);
  const callerInfo = userSummary(caller);
  if (!callerInfo) {
    throw new ApiError(400, 'INVALID_PARAM', '主叫用户不存在');
  }

  const callId = crypto.randomUUID();
  callMap.set(callId, { callerId: caller, calleeId: callee, mediaType: type });

  emitToUser(callee, 'call:invite', {
    call_id: callId,
    caller: callerInfo,
    media_type: type,
    sdp: sdp ?? null,
  });

  return { call_id: callId };
}

/**
 * 被叫接听，回传 answer 给主叫。
 * @param {{callId:unknown, userId:unknown, sdp:unknown}} input
 * @returns {{}}
 * @throws {ApiError} 404 CALL_NOT_FOUND / 403 FORBIDDEN
 */
export function answerCall({ callId, userId, sdp }) {
  const call = callMap.get(String(callId ?? ''));
  if (!call) {
    throw new ApiError(404, 'CALL_NOT_FOUND', '通话不存在或已结束');
  }
  const uid = toInt(userId, 0);
  if (uid !== call.calleeId) {
    throw new ApiError(403, 'FORBIDDEN', '只有被叫可以接听');
  }

  emitToUser(call.callerId, 'call:answer', {
    call_id: String(callId),
    callee: userSummary(uid),
    sdp: sdp ?? null,
  });
  return {};
}

/**
 * 拒绝通话（被叫主动拒绝，通知主叫后清理）。
 * @param {{callId:unknown, userId:unknown}} input
 * @returns {{}}
 * @throws {ApiError} 404 CALL_NOT_FOUND
 */
export function rejectCall({ callId, userId }) {
  const id = String(callId ?? '');
  const call = callMap.get(id);
  if (!call) {
    throw new ApiError(404, 'CALL_NOT_FOUND', '通话不存在或已结束');
  }
  const uid = toInt(userId, 0);
  const peer = uid === call.callerId ? call.calleeId : call.callerId;

  emitToUser(peer, 'call:reject', { call_id: id, by_user_id: uid });
  callMap.delete(id);
  return {};
}

/**
 * 挂断通话（任意一方），通知对端后清理。
 * @param {{callId:unknown, userId:unknown}} input
 * @returns {{}}
 * @throws {ApiError} 404 CALL_NOT_FOUND
 */
export function hangupCall({ callId, userId }) {
  const id = String(callId ?? '');
  const call = callMap.get(id);
  if (!call) {
    throw new ApiError(404, 'CALL_NOT_FOUND', '通话不存在或已结束');
  }
  const uid = toInt(userId, 0);
  const peer = uid === call.callerId ? call.calleeId : call.callerId;

  emitToUser(peer, 'call:hangup', { call_id: id, by_user_id: uid });
  callMap.delete(id);
  return {};
}

/**
 * 中继 1v1 ICE candidate。
 * @param {{callId:unknown, userId:unknown, candidate:unknown}} input
 * @returns {{}}
 * @throws {ApiError} 404 CALL_NOT_FOUND
 */
export function relayIce({ callId, userId, candidate }) {
  const id = String(callId ?? '');
  const call = callMap.get(id);
  if (!call) {
    throw new ApiError(404, 'CALL_NOT_FOUND', '通话不存在或已结束');
  }
  const uid = toInt(userId, 0);
  const peer = uid === call.callerId ? call.calleeId : call.callerId;

  emitToUser(peer, 'ice:candidate', { call_id: id, candidate: candidate ?? null });
  return {};
}

/**
 * 创建群会议：校验群成员 → 建房（members 只含发起人）→ 邀请群内其余成员。
 * @param {{conversationId:unknown, userId:unknown, mediaType?:unknown}} input
 * @returns {{conf_id:string, members:Array<object>, media_type:string}}
 * @throws {ApiError} 404 NOT_GROUP / 403 FORBIDDEN
 */
export function createConf({ conversationId, userId, mediaType }) {
  const convId = toInt(conversationId, 0);
  const uid = toInt(userId, 0);
  if (convId <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '会话 id 不合法');
  }

  const conversation = getConversationRow(convId);
  if (!conversation || conversation.type !== 'group') {
    throw new ApiError(404, 'NOT_GROUP', '该会话不是群聊');
  }
  if (!memberIds(convId).includes(uid)) {
    throw new ApiError(403, 'FORBIDDEN', '你不在该群中');
  }

  const rawType = typeof mediaType === 'string' ? mediaType.trim() : '';
  const type = rawType === '' ? 'video' : parseMediaType(rawType);

  const confId = crypto.randomUUID();
  const members = new Set([uid]);
  const initiator = userSummary(uid);
  confMap.set(confId, { conversationId: convId, initiatorId: uid, mediaType: type, members });

  // 群内其余成员收到邀请
  const others = memberIds(convId).filter((id) => id !== uid);
  if (others.length > 0) {
    emitToUsers(others, 'conf:invite', {
      conf_id: confId,
      conversation_id: convId,
      initiator,
      media_type: type,
      members: memberList({ members }),
    });
  }

  return { conf_id: confId, members: memberList({ members }), media_type: type };
}

/**
 * 加入群会议：非群成员拦截；加入后向所有成员广播 conf:join（不再限制人数）。
 * @param {{confId:unknown, userId:unknown}} input
 * @returns {{conf_id:string, members:Array<object>, initiator_id:number, media_type:string}}
 * @throws {ApiError} 404 CONF_NOT_FOUND / 403 NOT_MEMBER
 */
export function joinConf({ confId, userId }) {
  const id = String(confId ?? '');
  const conf = confMap.get(id);
  if (!conf) {
    throw new ApiError(404, 'CONF_NOT_FOUND', '会议不存在或已结束');
  }
  const uid = toInt(userId, 0);
  if (uid <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户 id 不合法');
  }
  if (!memberIds(conf.conversationId).includes(uid)) {
    throw new ApiError(403, 'NOT_MEMBER', '你不是该群成员');
  }

  // 已加入则幂等返回，避免重复广播
  if (conf.members.has(uid)) {
    return { conf_id: id, members: memberList(conf), initiator_id: conf.initiatorId, media_type: conf.mediaType };
  }

  conf.members.add(uid);
  emitToUsers(conf.members, 'conf:join', {
    conf_id: id,
    user: userSummary(uid),
    members: memberList(conf),
    media_type: conf.mediaType,
  });

  return { conf_id: id, members: memberList(conf), initiator_id: conf.initiatorId, media_type: conf.mediaType };
}

/**
 * 中继会议 offer（新加入者 → 既有成员）。
 * @param {{confId:unknown, userId:unknown, targetUserId:unknown, sdp:unknown}} input
 * @returns {{}}
 * @throws {ApiError} 404 CONF_NOT_FOUND / 403 NOT_IN_CONF
 */
export function relayConfOffer({ confId, userId, targetUserId, sdp }) {
  const id = String(confId ?? '');
  const conf = confMap.get(id);
  if (!conf) {
    throw new ApiError(404, 'CONF_NOT_FOUND', '会议不存在或已结束');
  }
  const uid = toInt(userId, 0);
  if (!conf.members.has(uid)) {
    throw new ApiError(403, 'NOT_IN_CONF', '你不在该会议中');
  }
  const targetId = toInt(targetUserId, 0);
  if (targetId <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '目标成员 id 不合法');
  }

  emitToUser(targetId, 'conf:offer', { conf_id: id, from_user_id: uid, sdp: sdp ?? null });
  return {};
}

/**
 * 中继会议 answer（既有成员 → 新加入者）。
 * @param {{confId:unknown, userId:unknown, targetUserId:unknown, sdp:unknown}} input
 * @returns {{}}
 * @throws {ApiError} 404 CONF_NOT_FOUND / 403 NOT_IN_CONF
 */
export function relayConfAnswer({ confId, userId, targetUserId, sdp }) {
  const id = String(confId ?? '');
  const conf = confMap.get(id);
  if (!conf) {
    throw new ApiError(404, 'CONF_NOT_FOUND', '会议不存在或已结束');
  }
  const uid = toInt(userId, 0);
  if (!conf.members.has(uid)) {
    throw new ApiError(403, 'NOT_IN_CONF', '你不在该会议中');
  }
  const targetId = toInt(targetUserId, 0);
  if (targetId <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '目标成员 id 不合法');
  }

  emitToUser(targetId, 'conf:answer', { conf_id: id, from_user_id: uid, sdp: sdp ?? null });
  return {};
}

/**
 * 中继会议 ICE candidate。
 * @param {{confId:unknown, userId:unknown, targetUserId:unknown, candidate:unknown}} input
 * @returns {{}}
 * @throws {ApiError} 404 CONF_NOT_FOUND / 403 NOT_IN_CONF
 */
export function relayConfIce({ confId, userId, targetUserId, candidate }) {
  const id = String(confId ?? '');
  const conf = confMap.get(id);
  if (!conf) {
    throw new ApiError(404, 'CONF_NOT_FOUND', '会议不存在或已结束');
  }
  const uid = toInt(userId, 0);
  if (!conf.members.has(uid)) {
    throw new ApiError(403, 'NOT_IN_CONF', '你不在该会议中');
  }
  const targetId = toInt(targetUserId, 0);
  if (targetId <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '目标成员 id 不合法');
  }

  emitToUser(targetId, 'conf:ice:candidate', { conf_id: id, from_user_id: uid, candidate: candidate ?? null });
  return {};
}

/**
 * 离开会议：从成员集移除，向剩余成员广播 conf:leave。
 * @param {{confId:unknown, userId:unknown}} input
 * @returns {{}}
 * @throws {ApiError} 404 CONF_NOT_FOUND
 */
export function leaveConf({ confId, userId }) {
  const id = String(confId ?? '');
  const conf = confMap.get(id);
  if (!conf) {
    throw new ApiError(404, 'CONF_NOT_FOUND', '会议不存在或已结束');
  }
  const uid = toInt(userId, 0);
  if (!conf.members.has(uid)) {
    return {};
  }

  conf.members.delete(uid);
  if (conf.members.size === 0) {
    confMap.delete(id);
  } else {
    emitToUsers(conf.members, 'conf:leave', { conf_id: id, user_id: uid });
  }
  return {};
}

/**
 * 结束会议：通知所有成员并清理。
 * @param {{confId:unknown, userId:unknown}} input
 * @returns {{}}
 * @throws {ApiError} 404 CONF_NOT_FOUND / 403 NOT_IN_CONF
 */
export function endConf({ confId, userId }) {
  const id = String(confId ?? '');
  const conf = confMap.get(id);
  if (!conf) {
    throw new ApiError(404, 'CONF_NOT_FOUND', '会议不存在或已结束');
  }
  const uid = toInt(userId, 0);
  if (!conf.members.has(uid)) {
    throw new ApiError(403, 'NOT_IN_CONF', '你不在该会议中');
  }

  emitToUsers(conf.members, 'conf:end', { conf_id: id, by_user_id: uid });
  confMap.delete(id);
  return {};
}

/**
 * 用户断开连接时清理其参与的通话与会议。
 * @param {number|string} userId
 * @returns {void}
 */
export function cleanupOnDisconnect(userId) {
  const uid = toInt(userId, 0);
  if (uid <= 0) return;

  // 1v1：对端发 hangup
  for (const [callId, call] of [...callMap.entries()]) {
    if (call.callerId === uid || call.calleeId === uid) {
      const peer = call.callerId === uid ? call.calleeId : call.callerId;
      emitToUser(peer, 'call:hangup', { call_id: callId, by_user_id: uid });
      callMap.delete(callId);
    }
  }

  // 会议：成员广播 leave
  for (const [confId, conf] of [...confMap.entries()]) {
    if (!conf.members.has(uid)) continue;
    conf.members.delete(uid);
    if (conf.members.size === 0) {
      confMap.delete(confId);
    } else {
      emitToUsers(conf.members, 'conf:leave', { conf_id: confId, user_id: uid });
    }
  }
}

export default {
  inviteCall,
  answerCall,
  rejectCall,
  hangupCall,
  relayIce,
  createConf,
  joinConf,
  relayConfOffer,
  relayConfAnswer,
  relayConfIce,
  leaveConf,
  endConf,
  cleanupOnDisconnect,
};
