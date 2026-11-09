/**
 * 在线状态表（进程内）。
 *
 * 数据结构：Map<userId, { sockets: Set<string>, timer: NodeJS.Timeout|null }>
 *   - 一个用户允许多端同时在线（多个 socket）。
 *   - 最后一个 socket 断开后延迟 30s 才广播离线：期间重连则取消定时器，不产生抖动。
 *
 * 依赖方向：presence.js → realtime.js（单向），因此不会有循环依赖。
 */
import { db } from '../db.js';
import { emitToUsers, setPresenceChecker } from './realtime.js';

/** 离线广播延迟（毫秒） */
export const OFFLINE_DELAY_MS = 30 * 1000;

/** userId -> { sockets: Set<string>, timer: NodeJS.Timeout|null } */
const presenceStore = new Map();

/**
 * 上线登记。
 * @param {number|string} userId
 * @param {string} socketId
 * @returns {boolean} 该用户此前是否完全离线（true 表示需要广播 online）
 */
export function addSocket(userId, socketId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return false;

  const entry = presenceStore.get(id);
  if (!entry) {
    presenceStore.set(id, { sockets: new Set([socketId]), timer: null });
    return true;
  }
  // 宽限期内重连：取消待触发的离线定时器（对端从未收到 offline，因此无需再广播 online）
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  entry.sockets.add(socketId);
  return false;
}

/**
 * 下线登记。最后一个 socket 移除后启动 30s 延迟；延迟到期才真正广播离线。
 * @param {number|string} userId
 * @param {string} socketId
 * @param {(userId: number) => void} [onOffline] 延迟到期后的回调（在定时器中执行）
 * @returns {boolean} 是否已安排在延迟后下线
 */
export function removeSocket(userId, socketId, onOffline) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return false;

  const entry = presenceStore.get(id);
  if (!entry) return false;

  entry.sockets.delete(socketId);
  if (entry.sockets.size > 0) return false;

  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    const current = presenceStore.get(id);
    if (!current || current.sockets.size > 0) return;
    presenceStore.delete(id);
    try {
      if (typeof onOffline === 'function') onOffline(id);
    } catch (err) {
      console.error('[presence] offline callback failed:', err.message);
    }
  }, OFFLINE_DELAY_MS);
  if (typeof entry.timer.unref === 'function') entry.timer.unref();
  return true;
}

/**
 * 查询在线状态（仅统计当前有活跃 socket 的用户；宽限期内的用户仍视为离线）。
 * @param {number|string} userId
 * @returns {boolean}
 */
export function isOnline(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return false;
  const entry = presenceStore.get(id);
  return Boolean(entry) && entry.sockets.size > 0;
}

/**
 * 在线状态受众：我的好友 id ∪ 与我同处任一会话的成员 id，去重且排除自己。
 * @param {number|string} userId
 * @returns {number[]}
 */
export function audienceOf(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return [];

  const rows = db
    .prepare(
      `SELECT user_high_id AS other_id FROM friendships WHERE user_low_id = ?
       UNION
       SELECT user_low_id AS other_id FROM friendships WHERE user_high_id = ?`,
    )
    .all(id, id);

  const conversationRows = db
    .prepare(
      `SELECT DISTINCT peer.user_id AS other_id
         FROM conversation_members mine
         JOIN conversation_members peer ON peer.conversation_id = mine.conversation_id
        WHERE mine.user_id = ? AND peer.user_id <> ?`,
    )
    .all(id, id);

  const audience = new Set();
  for (const row of rows) {
    const otherId = Number(row.other_id);
    if (Number.isInteger(otherId) && otherId > 0 && otherId !== id) audience.add(otherId);
  }
  for (const row of conversationRows) {
    const otherId = Number(row.other_id);
    if (Number.isInteger(otherId) && otherId > 0 && otherId !== id) audience.add(otherId);
  }
  return [...audience];
}

/**
 * 广播某用户的在线状态给其受众。
 * @param {number|string} userId
 * @param {boolean} online
 * @returns {number} 接收方数量
 */
export function broadcastPresence(userId, online) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return 0;
  const audience = audienceOf(id);
  if (audience.length === 0) return 0;
  return emitToUsers(audience, 'presence', { user_id: id, online: Boolean(online) });
}

// 把在线状态查询注入 realtime，供 realtime.isOnline / 好友列表复用（避免循环 import）
setPresenceChecker(isOnline);
