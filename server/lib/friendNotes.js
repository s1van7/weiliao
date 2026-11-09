/**
 * 好友备注领域服务：备注名 / 备注手机号 / 星标读写。
 *
 * 展示名统一规则：display_name = remark_name || nickname。
 * 星标（starred）与备注同表存储：一行记录 = 我对该好友的「备注 + 星标」组合，
 * 因此清空备注时若星标仍为 1，必须保留这一行，不能整行删除。
 */
import { db, now, tx } from '../db.js';
import { toInt } from './serialize.js';

/**
 * 把数据库行归一化成对外结构。
 * @param {Record<string, unknown>|null|undefined} row
 * @returns {{remark_name:string, remark_phone:string, starred:boolean}}
 */
function toNote(row) {
  return {
    remark_name: String(row?.remark_name ?? ''),
    remark_phone: String(row?.remark_phone ?? ''),
    starred: Number(row?.starred ?? 0) === 1,
  };
}

/**
 * 取好友备注行（无则返回 null）。
 * @param {number|string} ownerId 备注所有人（我）
 * @param {number|string} friendId 被备注的好友
 * @returns {{remark_name:string, remark_phone:string, starred:boolean}|null}
 */
export function getNote(ownerId, friendId) {
  const owner = toInt(ownerId, 0);
  const friend = toInt(friendId, 0);
  if (owner <= 0 || friend <= 0) return null;
  const row = db
    .prepare('SELECT remark_name, remark_phone, starred FROM friend_notes WHERE owner_id = ? AND friend_id = ?')
    .get(owner, friend);
  if (!row) return null;
  return toNote(row);
}

/**
 * 批量取「我」对一组好友的备注（返回 Map<friendId, note>）。
 * @param {number|string} ownerId 我
 * @param {number[]} friendIds 好友 id 列表
 * @returns {Map<number, {remark_name:string, remark_phone:string, starred:boolean}>}
 */
export function getNotes(ownerId, friendIds) {
  const owner = toInt(ownerId, 0);
  const map = new Map();
  if (owner <= 0 || !Array.isArray(friendIds) || friendIds.length === 0) return map;

  const placeholders = friendIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT friend_id, remark_name, remark_phone, starred
         FROM friend_notes WHERE owner_id = ? AND friend_id IN (${placeholders})`,
    )
    .all(owner, ...friendIds);
  for (const row of rows) {
    map.set(Number(row.friend_id), toNote(row));
  }
  return map;
}

/**
 * 写入好友备注（UPSERT）。
 *
 * patch 语义：只更新传入的字段，未传的字段保持库中原值（星标与备注互不覆盖）。
 * @param {number|string} ownerId 我
 * @param {number|string} friendId 好友
 * @param {{remark_name?: string, remark_phone?: string, starred?: boolean}} patch 备注内容
 * @returns {{remark_name:string, remark_phone:string, starred:boolean}}
 */
export function upsertNote(ownerId, friendId, patch) {
  const owner = toInt(ownerId, 0);
  const friend = toInt(friendId, 0);
  const existing = getNote(owner, friend);

  const remarkName = typeof patch?.remark_name === 'string' ? patch.remark_name : existing?.remark_name ?? '';
  const remarkPhone = typeof patch?.remark_phone === 'string' ? patch.remark_phone : existing?.remark_phone ?? '';
  const starred = patch?.starred === undefined ? existing?.starred === true : Boolean(patch.starred);

  tx(() => {
    db.prepare(
      `INSERT INTO friend_notes (owner_id, friend_id, remark_name, remark_phone, starred, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, friend_id)
       DO UPDATE SET remark_name = excluded.remark_name,
                     remark_phone = excluded.remark_phone,
                     starred = excluded.starred,
                     updated_at = excluded.updated_at`,
    ).run(owner, friend, remarkName, remarkPhone, starred ? 1 : 0, now());
  });

  return { remark_name: remarkName, remark_phone: remarkPhone, starred };
}

/**
 * 清空备注内容（备注名与备注手机号都置空）。
 *
 * 星标为 1 时保留整行（只清备注字段），否则删除整行，避免留下无意义的空记录。
 * @param {number|string} ownerId 我
 * @param {number|string} friendId 好友
 * @returns {{remark_name:string, remark_phone:string, starred:boolean}}
 */
export function clearRemarks(ownerId, friendId) {
  const owner = toInt(ownerId, 0);
  const friend = toInt(friendId, 0);
  const existing = getNote(owner, friend);

  if (!existing) return { remark_name: '', remark_phone: '', starred: false };

  tx(() => {
    if (existing.starred) {
      db.prepare(
        "UPDATE friend_notes SET remark_name = '', remark_phone = '', updated_at = ? WHERE owner_id = ? AND friend_id = ?",
      ).run(now(), owner, friend);
    } else {
      db.prepare('DELETE FROM friend_notes WHERE owner_id = ? AND friend_id = ?').run(owner, friend);
    }
  });

  return { remark_name: '', remark_phone: '', starred: existing.starred };
}

/**
 * 设置 / 取消星标朋友（幂等）。
 * @param {number|string} ownerId 我
 * @param {number|string} friendId 好友
 * @param {boolean} starred 是否星标
 * @returns {{remark_name:string, remark_phone:string, starred:boolean}}
 */
export function setStarred(ownerId, friendId, starred) {
  return upsertNote(ownerId, friendId, { starred: Boolean(starred) });
}

/**
 * 删除好友备注行（幂等，星标一并清除）。
 * @param {number|string} ownerId 我
 * @param {number|string} friendId 好友
 * @returns {boolean} 是否真的删除了行
 */
export function deleteNote(ownerId, friendId) {
  const owner = toInt(ownerId, 0);
  const friend = toInt(friendId, 0);
  return tx(() => {
    const result = db.prepare('DELETE FROM friend_notes WHERE owner_id = ? AND friend_id = ?').run(owner, friend);
    return Number(result.changes) > 0;
  });
}

export default { getNote, getNotes, upsertNote, clearRemarks, setStarred, deleteNote };
