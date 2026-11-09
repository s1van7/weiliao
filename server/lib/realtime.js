/**
 * 实时事件总线（realtime bus）。
 *
 * 设计目标：打破「路由层 ↔ socket 层」的循环依赖。
 *   - 本模块不 import 任何业务模块（仅依赖注入），因此可以被任何模块安全 import。
 *   - socket 层启动时调用 setIO(io) 注入 Socket.IO 实例。
 *   - presence 模块启动时调用 setPresenceChecker(fn) 注入在线状态查询函数。
 *   - io 未就绪时（例如单元进程、启动早期）所有 emit 静默降级为 no-op，返回 false。
 */

/** @type {import('socket.io').Server|null} */
let ioRef = null;

/** 在线状态查询函数，由 presence.js 注入 */
let presenceChecker = () => false;

/**
 * 注入 Socket.IO 实例。
 * @param {import('socket.io').Server|null} io
 */
export function setIO(io) {
  ioRef = io ?? null;
}

/**
 * 取回 Socket.IO 实例（可能为 null）。
 * @returns {import('socket.io').Server|null}
 */
export function getIO() {
  return ioRef;
}

/**
 * 注入在线状态查询函数（由 presence.js 调用，避免 realtime → presence 的循环依赖）。
 * @param {(userId: number) => boolean} fn
 */
export function setPresenceChecker(fn) {
  presenceChecker = typeof fn === 'function' ? fn : () => false;
}

/**
 * 单用户房间名。
 * @param {number|string} userId
 * @returns {string}
 */
export function userRoom(userId) {
  return `user:${Number(userId)}`;
}

/**
 * 会话房间名。
 * @param {number|string} conversationId
 * @returns {string}
 */
export function conversationRoom(conversationId) {
  return `conv:${Number(conversationId)}`;
}

/**
 * 向单个用户的房间推送事件。
 * @param {number|string} userId
 * @param {string} event
 * @param {Record<string, unknown>} payload
 * @returns {boolean} 是否真的发出了
 */
export function emitToUser(userId, event, payload) {
  const id = Number(userId);
  if (!ioRef || !Number.isInteger(id) || id <= 0) return false;
  ioRef.to(userRoom(id)).emit(event, payload);
  return true;
}

/**
 * 向多个用户的房间推送同一事件（去重）。
 * @param {Iterable<number|string>} userIds
 * @param {string} event
 * @param {Record<string, unknown>} payload
 * @returns {number} 实际推送的用户数
 */
export function emitToUsers(userIds, event, payload) {
  if (!ioRef) return 0;
  const unique = new Set();
  for (const value of userIds ?? []) {
    const id = Number(value);
    if (Number.isInteger(id) && id > 0) unique.add(id);
  }
  for (const id of unique) {
    ioRef.to(userRoom(id)).emit(event, payload);
  }
  return unique.size;
}

/**
 * 向会话房间推送事件（房间内所有在线成员都会收到，包含发送者自己的其他设备）。
 * @param {number|string} conversationId
 * @param {string} event
 * @param {Record<string, unknown>} payload
 * @returns {boolean} 是否真的发出了
 */
export function emitToConversation(conversationId, event, payload) {
  const id = Number(conversationId);
  if (!ioRef || !Number.isInteger(id) || id <= 0) return false;
  ioRef.to(conversationRoom(id)).emit(event, payload);
  return true;
}

/**
 * 查询用户是否在线（真实实现来自 presence.js）。
 * @param {number|string} userId
 * @returns {boolean}
 */
export function isOnline(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return false;
  try {
    return Boolean(presenceChecker(id));
  } catch (err) {
    console.warn('[realtime] presence checker failed:', err.message);
    return false;
  }
}
