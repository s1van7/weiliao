/**
 * 朋友权限领域服务（方向：owner_id 对 friend_id，即「我对该好友」）。
 *
 * 存储为 4 个独立开关：
 *   hide_my_moments = 不让他看我的朋友圈；
 *   hide_his_moments = 不看他朋友圈；
 *   chat_only        = 仅聊天（等价于前两项同时生效）；
 *   blocked          = 加入黑名单（拉黑，保留好友关系与会话、只读）。
 *
 * 对外 API 返回「生效值」：chat_only / blocked 折叠进两个 hide 字段，
 * 因此 hide_my_moments / hide_his_moments 已经包含 chat_only 与 blocked 的隐式效果。
 */
import { db, now } from '../db.js';
import { toInt } from './serialize.js';

/** 权限字段白名单 */
const PERMISSION_KEYS = Object.freeze(['hide_my_moments', 'hide_his_moments', 'chat_only', 'blocked']);

/**
 * 把数据库行折叠成「生效值」布尔对象。
 * @param {Record<string, unknown>|null|undefined} row friend_permissions 行
 * @returns {{hide_my_moments:boolean, hide_his_moments:boolean, chat_only:boolean, blocked:boolean}}
 */
function toEffective(row) {
  const hideMy = row ? Number(row.hide_my_moments ?? 0) === 1 : false;
  const hideHis = row ? Number(row.hide_his_moments ?? 0) === 1 : false;
  const chatOnly = row ? Number(row.chat_only ?? 0) === 1 : false;
  const blocked = row ? Number(row.blocked ?? 0) === 1 : false;
  return {
    hide_my_moments: hideMy || chatOnly || blocked,
    hide_his_moments: hideHis || chatOnly || blocked,
    chat_only: chatOnly,
    blocked,
  };
}

/**
 * 取原始权限行（不存在返回 null，不抛错）。
 * @param {number|string} ownerId
 * @param {number|string} friendId
 * @returns {Record<string, unknown>|null}
 */
function getRaw(ownerId, friendId) {
  const owner = toInt(ownerId, 0);
  const friend = toInt(friendId, 0);
  if (owner <= 0 || friend <= 0) return null;
  return (
    db
      .prepare('SELECT * FROM friend_permissions WHERE owner_id = ? AND friend_id = ?')
      .get(owner, friend) ?? null
  );
}

/**
 * 读取「我对该好友」的生效权限。
 * 未设置过时返回全 false 默认值（路由层负责校验好友关系）。
 * @param {number|string} ownerId 我
 * @param {number|string} friendId 对方
 * @returns {{hide_my_moments:boolean, hide_his_moments:boolean, chat_only:boolean, blocked:boolean}}
 */
export function getPermission(ownerId, friendId) {
  return toEffective(getRaw(ownerId, friendId));
}

/**
 * 设置「我对该好友」的权限（patch 只包含需要改动的字段，缺失字段保持不变）。
 * @param {number|string} ownerId 我
 * @param {number|string} friendId 对方
 * @param {{hide_my_moments?:boolean, hide_his_moments?:boolean, chat_only?:boolean, blocked?:boolean}} patch
 * @returns {{hide_my_moments:boolean, hide_his_moments:boolean, chat_only:boolean, blocked:boolean}}
 */
export function setPermission(ownerId, friendId, patch = {}) {
  const owner = toInt(ownerId, 0);
  const friend = toInt(friendId, 0);
  if (owner <= 0 || friend <= 0) {
    throw new Error(`setPermission 需要合法的用户 id: ${ownerId}, ${friendId}`);
  }

  const existing = getRaw(owner, friend);
  const next = {
    hide_my_moments: existing ? Number(existing.hide_my_moments ?? 0) === 1 : false,
    hide_his_moments: existing ? Number(existing.hide_his_moments ?? 0) === 1 : false,
    chat_only: existing ? Number(existing.chat_only ?? 0) === 1 : false,
    blocked: existing ? Number(existing.blocked ?? 0) === 1 : false,
  };

  for (const key of PERMISSION_KEYS) {
    if (patch[key] !== undefined) next[key] = Boolean(patch[key]);
  }

  const timestamp = now();
  db.prepare(
    `INSERT INTO friend_permissions
       (owner_id, friend_id, hide_my_moments, hide_his_moments, chat_only, blocked, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, friend_id) DO UPDATE SET
       hide_my_moments = excluded.hide_my_moments,
       hide_his_moments = excluded.hide_his_moments,
       chat_only = excluded.chat_only,
       blocked = excluded.blocked,
       updated_at = excluded.updated_at`,
  ).run(
    owner,
    friend,
    next.hide_my_moments ? 1 : 0,
    next.hide_his_moments ? 1 : 0,
    next.chat_only ? 1 : 0,
    next.blocked ? 1 : 0,
    timestamp,
  );

  return toEffective(getRaw(owner, friend));
}

/**
 * ownerId 是否拉黑了 friendId（方向敏感）。
 * @param {number|string} ownerId
 * @param {number|string} friendId
 * @returns {boolean}
 */
export function blockedBy(ownerId, friendId) {
  return getPermission(ownerId, friendId).blocked;
}

/**
 * 任意一方是否拉黑了对方。
 * @param {number|string} a
 * @param {number|string} b
 * @returns {boolean}
 */
export function isBlocked(a, b) {
  return blockedBy(a, b) || blockedBy(b, a);
}

/**
 * 「我」是否不让 friendId 看我的朋友圈（生效值）。
 * @param {number|string} ownerId 我
 * @param {number|string} friendId 对方
 * @returns {boolean}
 */
export function hideMyMomentsOf(ownerId, friendId) {
  return getPermission(ownerId, friendId).hide_my_moments;
}

/**
 * 「我」是否不看 friendId 的朋友圈（生效值）。
 * @param {number|string} ownerId 我
 * @param {number|string} friendId 对方
 * @returns {boolean}
 */
export function hideHisMomentsOf(ownerId, friendId) {
  return getPermission(ownerId, friendId).hide_his_moments;
}

/**
 * viewerId 是否能看到 authorId 的朋友圈（自己恒可见）。
 * 会同时检查两个方向：作者是否对我隐藏、我是否屏蔽了作者。
 * @param {number|string} viewerId 浏览者
 * @param {number|string} authorId 动态作者
 * @returns {boolean}
 */
export function canSeeMoments(viewerId, authorId) {
  const viewer = toInt(viewerId, 0);
  const author = toInt(authorId, 0);
  if (viewer <= 0 || author <= 0) return false;
  if (viewer === author) return true;
  return !hideMyMomentsOf(author, viewer) && !hideHisMomentsOf(viewer, author);
}

/**
 * 批量过滤「我能看到其朋友圈的作者 id 子集」，避免逐条查权限造成 N+1。
 * 只返回 authorIds 中我能看到的作者（不含我自己）。
 * @param {number|string} viewerId 浏览者
 * @param {Array<number|string>} authorIds 候选作者 id
 * @returns {number[]}
 */
export function filterVisibleMomentAuthors(viewerId, authorIds) {
  const viewer = toInt(viewerId, 0);
  const authors = [...new Set((Array.isArray(authorIds) ? authorIds : []).map((id) => toInt(id, 0)))]
    .filter((id) => id > 0 && id !== viewer);
  if (viewer <= 0 || authors.length === 0) return [];

  const placeholders = authors.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT owner_id, friend_id, hide_my_moments, hide_his_moments, chat_only, blocked
         FROM friend_permissions
        WHERE (owner_id IN (${placeholders}) AND friend_id = ?)
           OR (owner_id = ? AND friend_id IN (${placeholders}))`,
    )
    .all(...authors, viewer, viewer, ...authors);

  const hiddenAuthors = new Set();
  for (const row of rows) {
    const owner = Number(row.owner_id);
    const friend = Number(row.friend_id);
    const chatOnly = Number(row.chat_only ?? 0) === 1;
    const blocked = Number(row.blocked ?? 0) === 1;
    if (owner === viewer) {
      // 我屏蔽了 friend 的朋友圈 → friend 的作者不可见
      if (Number(row.hide_his_moments ?? 0) === 1 || chatOnly || blocked) hiddenAuthors.add(friend);
    } else if (friend === viewer) {
      // owner 对我隐藏了 TA 的朋友圈 → owner 的作者不可见
      if (Number(row.hide_my_moments ?? 0) === 1 || chatOnly || blocked) hiddenAuthors.add(owner);
    }
  }

  return authors.filter((id) => !hiddenAuthors.has(id));
}

export default {
  getPermission,
  setPermission,
  blockedBy,
  isBlocked,
  hideMyMomentsOf,
  hideHisMomentsOf,
  canSeeMoments,
  filterVisibleMomentAuthors,
};
