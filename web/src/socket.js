/**
 * Socket.IO 客户端封装。
 *
 * 服务端事件（见 server/socket.js 与 lib/*）：
 *   message:new        { message }
 *   message:read       { conversation_id, user_id, last_message_id }
 *   message:revoked    { conversation_id, message_id }
 *   typing             { conversation_id, user_id, typing }
 *   presence           { user_id, online }
 *   conversation:new   { conversation_id, conversation }
 *   conversation:update{ conversation_id, last_message_at, last_message }
 *   conversation:profile { conversation_id, conversation }  群名 / 头像 / 公告 / 权限变更
 *   conversation:removed { conversation_id, by_user_id }    被移出群聊
 *   friend:request     { request_id, message, created_at, from_user }
 *   friend:accepted    { request_id, conversation_id, user }
 *   user:update        { user }  对方修改昵称 / 头像后推给自己
 *
 * 客户端 -> 服务端：message:send / message:read / typing / conversation:subscribe / presence:query
 * 本模块只负责「连接 + 事件转发」，业务逻辑全部在 store 中处理。
 */
import { io } from 'socket.io-client';
import { SERVER_URL } from './config';

/** 需要转发给订阅者的服务端事件 */
const FORWARD_EVENTS = [
  'message:new',
  'message:read',
  'message:revoked',
  'typing',
  'presence',
  'conversation:new',
  'conversation:update',
  'conversation:profile',
  'conversation:removed',
  'friend:request',
  'friend:accepted',
  'user:update',
  'face-pair:update',
  'face-pair:ready',
  'face-pair:resolved',
  'call:invite',
  'call:answer',
  'call:reject',
  'call:hangup',
  'ice:candidate',
  'conf:invite',
  'conf:join',
  'conf:offer',
  'conf:answer',
  'conf:ice:candidate',
  'conf:leave',
  'conf:end',
  'connect',
  'disconnect',
  'connect_error',
];

/** @type {import('socket.io-client').Socket|null} */
let socket = null;

/** event -> Set<handler> */
const listeners = new Map();

/**
 * 取（或创建）事件监听集合。
 * @param {string} event
 * @returns {Set<Function>}
 */
function bucket(event) {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  return set;
}

/**
 * 分发事件到所有订阅者，单个订阅者异常不影响其他订阅者。
 * @param {string} event
 * @param {unknown} payload
 * @returns {void}
 */
function dispatch(event, payload) {
  const set = listeners.get(event);
  if (!set || set.size === 0) return;
  for (const handler of [...set]) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[socket] listener error on ${event}:`, err);
    }
  }
}

/**
 * 订阅 socket 事件（组件卸载时调用返回的函数取消订阅）。
 * @param {string} event
 * @param {(payload: any) => void} handler
 * @returns {() => void}
 */
export function onSocket(event, handler) {
  if (typeof handler !== 'function') return () => {};
  const set = bucket(event);
  set.add(handler);
  return () => set.delete(handler);
}

/**
 * 建立连接（重复调用只更新 token）。
 * @param {string} token JWT
 * @returns {import('socket.io-client').Socket}
 */
export function connectSocket(token) {
  if (socket) {
    socket.auth = { token };
    if (!socket.connected) socket.connect();
    return socket;
  }

  socket = io(SERVER_URL || undefined, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 6000,
    timeout: 12000,
    withCredentials: true,
    autoConnect: true,
  });

  for (const event of FORWARD_EVENTS) {
    socket.on(event, (payload) => dispatch(event, payload));
  }

  return socket;
}

/**
 * 取当前 socket 实例（可能为 null）。
 * @returns {import('socket.io-client').Socket|null}
 */
export function getSocket() {
  return socket;
}

/**
 * 断开并销毁连接。
 * @returns {void}
 */
export function disconnectSocket() {
  if (!socket) return;
  try {
    socket.removeAllListeners();
    socket.disconnect();
  } catch (err) {
    console.error('[socket] disconnect failed:', err);
  }
  socket = null;
}

/**
 * 发送「正在输入」状态。
 * @param {number} conversationId
 * @param {boolean} typing
 * @returns {void}
 */
export function emitTyping(conversationId, typing) {
  if (!socket || !socket.connected) return;
  socket.emit('typing', { conversation_id: conversationId, typing: Boolean(typing) });
}

/**
 * 订阅会话房间（新建会话后调用，之后才能收到该会话的 message:new）。
 * @param {number} conversationId
 * @returns {void}
 */
export function subscribeConversation(conversationId) {
  if (!socket || !socket.connected) return;
  socket.emit('conversation:subscribe', { conversation_id: conversationId }, () => {});
}

/**
 * 带 ack 的 socket 发射：服务端 respond 包装返回 {ok:true,...} / {ok:false,code,message}。
 * 成功 resolve 服务端 payload，失败 reject 携带 message 的 Error。
 * @param {string} event
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<Record<string, unknown>>}
 */
export function emitWithAck(event, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!socket || !socket.connected) {
      reject(new Error('网络未连接，请稍后重试'));
      return;
    }
    socket.emit(event, payload, (reply) => {
      if (reply && reply.ok === true) {
        resolve(reply);
      } else {
        reject(new Error((reply && reply.message) || '操作失败'));
      }
    });
  });
}

export default {
  connectSocket,
  disconnectSocket,
  getSocket,
  onSocket,
  emitTyping,
  subscribeConversation,
  emitWithAck,
};
