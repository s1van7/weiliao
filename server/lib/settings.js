/**
 * 用户设置领域服务：读取 / 更新 user_settings 表。
 *
 * 约定：整数 0/1 存库，对外统一暴露为布尔值；friend_request_mode 为三值字符串。
 */
import { db, now, tx } from '../db.js';
import { ApiError } from './http.js';
import { toInt } from './serialize.js';

/** 允许的加好友方式 */
export const FRIEND_REQUEST_MODES = Object.freeze(new Set(['all', 'qrcode_only', 'invite_only']));

/** 默认设置（无行时按此返回） */
export const DEFAULT_SETTINGS = Object.freeze({
  notification_enabled: true,
  sound_enabled: true,
  vibrate_enabled: true,
  friend_request_mode: 'all',
  dark_mode: false,
});

/**
 * 把数据库行转换为对外设置对象。
 * @param {Record<string, unknown>|null|undefined} row
 * @returns {{notification_enabled:boolean, sound_enabled:boolean, vibrate_enabled:boolean, friend_request_mode:string, dark_mode:boolean}}
 */
function toShape(row) {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    notification_enabled: Number(row.notification_enabled ?? 1) === 1,
    sound_enabled: Number(row.sound_enabled ?? 1) === 1,
    vibrate_enabled: Number(row.vibrate_enabled ?? 1) === 1,
    friend_request_mode: row.friend_request_mode ?? 'all',
    dark_mode: Number(row.dark_mode ?? 0) === 1,
  };
}

/**
 * 读取用户设置；无行时返回默认值（GET 只读，不主动创建行）。
 * @param {number|string} userId 用户 id
 * @returns {{notification_enabled:boolean, sound_enabled:boolean, vibrate_enabled:boolean, friend_request_mode:string, dark_mode:boolean}}
 */
export function getSettings(userId) {
  const uid = toInt(userId, 0);
  if (uid <= 0) return { ...DEFAULT_SETTINGS };
  const row = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(uid);
  return toShape(row);
}

/**
 * 更新用户设置（接受任意子集；无行时先建行再更新）。
 * @param {number|string} userId 用户 id
 * @param {Record<string, unknown>} patch 待更新字段
 * @returns {{notification_enabled:boolean, sound_enabled:boolean, vibrate_enabled:boolean, friend_request_mode:string, dark_mode:boolean}}
 * @throws {ApiError} 400 INVALID_PARAM
 */
export function updateSettings(userId, patch) {
  const uid = toInt(userId, 0);
  if (uid <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }

  const assignments = [];
  const params = [];

  const booleanFields = ['notification_enabled', 'sound_enabled', 'vibrate_enabled', 'dark_mode'];
  for (const field of booleanFields) {
    if (patch[field] !== undefined) {
      if (typeof patch[field] !== 'boolean') {
        throw new ApiError(400, 'INVALID_PARAM', `${field} 必须是布尔值`);
      }
      assignments.push(`${field} = ?`);
      params.push(patch[field] ? 1 : 0);
    }
  }

  if (patch.friend_request_mode !== undefined) {
    const mode = typeof patch.friend_request_mode === 'string' ? patch.friend_request_mode : '';
    if (!FRIEND_REQUEST_MODES.has(mode)) {
      throw new ApiError(400, 'INVALID_PARAM', 'friend_request_mode 取值不合法');
    }
    assignments.push('friend_request_mode = ?');
    params.push(mode);
  }

  if (assignments.length === 0) {
    throw new ApiError(400, 'INVALID_PARAM', '没有可更新的设置项');
  }

  tx(() => {
    db.prepare('INSERT OR IGNORE INTO user_settings (user_id, updated_at) VALUES (?, ?)').run(uid, now());
    params.push(now());
    params.push(uid);
    db.prepare(`UPDATE user_settings SET ${assignments.join(', ')}, updated_at = ? WHERE user_id = ?`).run(...params);
  });

  return getSettings(uid);
}

export default { FRIEND_REQUEST_MODES, DEFAULT_SETTINGS, getSettings, updateSettings };
