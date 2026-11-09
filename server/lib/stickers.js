/**
 * 自定义表情领域服务：列表 / 新增（不限数量）/ 删除。
 *
 * 排序约定：按 id DESC（新→旧）返回，与微信「最近添加在前」一致，无需 sort 列。
 * 删除只删数据库行、保留磁盘文件：旧消息里的表情气泡仍能正常显示，
 * 避免「删表情把历史消息炸成裂图」，磁盘占用由运维侧统一清理。
 */
import { db, now, tx } from '../db.js';
import { ApiError } from './http.js';
import { toInt } from './serialize.js';

/** 表情 url 长度上限 */
const STICKER_URL_MAX = 512;
/**
 * 表情 url 严格白名单：只允许 /uploads/ 下单层文件名。
 * 用白名单而非 startsWith('/uploads/')，挡住 /uploads/../.. 之类的穿越写法。
 */
const STICKER_URL_PATTERN = /^\/uploads\/[A-Za-z0-9._-]+$/;

/**
 * 我的表情列表（新→旧）。
 * @param {number|string} userId 用户 id
 * @returns {Array<{id:number, url:string, created_at:number}>}
 * @throws {ApiError} 400 INVALID_PARAM
 */
export function listStickers(userId) {
  const uid = toInt(userId, 0);
  if (uid <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }
  return db
    .prepare('SELECT id, url, created_at FROM user_stickers WHERE user_id = ? ORDER BY id DESC')
    .all(uid)
    .map((row) => ({
      id: Number(row.id),
      url: String(row.url ?? ''),
      created_at: Number(row.created_at ?? 0),
    }));
}

/**
 * 新增一个自定义表情。
 * @param {number|string} userId 用户 id
 * @param {unknown} url 表情图片地址（必须以 /uploads/ 开头）
 * @returns {{id:number, url:string, created_at:number}}
 * @throws {ApiError} 400 STICKER_URL_INVALID
 */
export function insertSticker(userId, url) {
  const uid = toInt(userId, 0);
  if (uid <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }

  const normalizedUrl = typeof url === 'string' ? url.trim() : '';
  if (!STICKER_URL_PATTERN.test(normalizedUrl) || normalizedUrl.length > STICKER_URL_MAX) {
    throw new ApiError(400, 'STICKER_URL_INVALID', '表情地址必须是 /uploads/ 下的图片路径');
  }

  const createdAt = now();
  const sticker = tx(() => {
    const inserted = db
      .prepare('INSERT INTO user_stickers (user_id, url, created_at) VALUES (?, ?, ?)')
      .run(uid, normalizedUrl, createdAt);
    return { id: Number(inserted.lastInsertRowid), url: normalizedUrl, created_at: createdAt };
  });

  return sticker;
}

/**
 * 删除我的一个自定义表情。
 * @param {number|string} userId 用户 id
 * @param {number|string} stickerId 表情 id
 * @returns {{deleted:true, id:number, url:string}}
 * @throws {ApiError} 400 INVALID_PARAM / 404 NOT_FOUND
 */
export function deleteSticker(userId, stickerId) {
  const uid = toInt(userId, 0);
  const id = toInt(stickerId, 0);
  if (uid <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }
  if (id <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '表情 id 不合法');
  }

  const row = db.prepare('SELECT id, user_id, url FROM user_stickers WHERE id = ?').get(id);
  if (!row || Number(row.user_id) !== uid) {
    throw new ApiError(404, 'NOT_FOUND', '表情不存在');
  }

  tx(() => {
    db.prepare('DELETE FROM user_stickers WHERE id = ? AND user_id = ?').run(id, uid);
  });

  return { deleted: true, id, url: String(row.url ?? '') };
}
