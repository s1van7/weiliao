/**
 * 序列化与通用小工具：12 色头像调色板、用户行转换、整数解析。
 */

/** 12 色头像调色板（全局唯一来源，与前端 config.js 的 AVATAR_COLORS 保持一致） */
export const COLOR_PALETTE = Object.freeze([
  '#07C160',
  '#10AEFF',
  '#FF9F0A',
  '#FF3B30',
  '#AF52DE',
  '#00C7BE',
  '#FF2D55',
  '#8E8E93',
  '#5856D6',
  '#FFCC00',
  '#34C759',
  '#FF6B22',
]);

/** 默认头像色 */
export const DEFAULT_AVATAR_COLOR = COLOR_PALETTE[0];

/** 自定义头像地址白名单：仅允许本站上传目录下的相对路径 */
export const AVATAR_URL_PATTERN = /^\/uploads\/[A-Za-z0-9._-]+$/;

/**
 * 判断颜色是否为合法的 #RRGGBB（大小写不敏感，允许自定义取色）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPaletteColor(value) {
  if (typeof value !== 'string') return false;
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * 按用户 id 从调色板取色，保证同一用户颜色稳定。
 * @param {number|string} userId
 * @returns {string}
 */
export function pickColor(userId) {
  const id = Number(userId);
  const index = Number.isInteger(id) && id > 0 ? id % COLOR_PALETTE.length : 0;
  return COLOR_PALETTE[index];
}

/**
 * 判断字符串是否为合法的自定义头像地址（/uploads/xxx.jpg）。
 * 空串表示「清除自定义头像」，由调用方单独放行。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAvatarUrl(value) {
  if (typeof value !== 'string') return false;
  return AVATAR_URL_PATTERN.test(value);
}

/**
 * 解析整数，失败返回默认值（不使用 parseInt，避免 "12abc" 被接受）。
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function toInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

/**
 * 把数据库 users 行转换成对外暴露的用户对象（不含 password_hash）。
 * @param {Record<string, unknown>|null|undefined} row
 * @returns {{id:number, username:string|null, phone:string|null, nickname:string, signature:string, avatar_color:string, avatar_url:string, cover_url:string, cover_type:string, gender:string, region:string}|null}
 */
export function publicUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username ?? null,
    phone: row.phone ?? null,
    nickname: row.nickname ?? '',
    signature: row.signature ?? '',
    avatar_color: row.avatar_color ?? DEFAULT_AVATAR_COLOR,
    avatar_url: row.avatar_url ?? '',
    cover_url: row.cover_url ?? '',
    cover_type: row.cover_type ?? 'photo',
    gender: row.gender ?? '',
    region: row.region ?? '',
    // 用户名最近一次修改时间（0=从未修改）；前端据此计算「下次可修改时间」
    username_changed_at: Number(row.username_changed_at ?? 0) || 0,
  };
}
