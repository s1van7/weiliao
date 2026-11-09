/**
 * 运行期配置常量。
 * SERVER_URL 为空串表示「与页面同源」（后端直接托管 dist 时即为此场景）；
 * Electron / Capacitor 打包时通过 VITE_SERVER_URL 指定远端地址。
 */
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

/** 所有 REST 接口前缀 */
export const API_BASE = `${SERVER_URL}/api`;

/** localStorage：登录令牌 */
export const TOKEN_KEY = 'wx.token';

/** localStorage：提示音开关（值为 'off' 表示关闭） */
export const SOUND_KEY = 'wx.sound';

/** localStorage：提示音音效选择（default/crisp/water/xylo/silent） */
export const NOTIFICATION_SOUND_KEY = 'wx.notification_sound';

/** 12 色头像色板（与后端 COLOR_PALETTE 保持一致） */
export const AVATAR_COLORS = Object.freeze([
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
export const DEFAULT_AVATAR_COLOR = '#07C160';

/** 新消息提示音音效集合（default=叮咚 / crisp=清脆 / water=水滴 / xylo=木琴 / silent=静音） */
export const NOTIFICATION_SOUNDS = Object.freeze({
  default: '默认',
  crisp: '清脆',
  water: '水滴',
  xylo: '木琴',
  silent: '静音',
});

/** 群聊人数限制（含自己） */
export const GROUP_MIN_MEMBERS = 3;
export const GROUP_MAX_MEMBERS = 50;

/** 面对面数字码位数 */
export const FACE_PAIR_CODE_LEN = 4;

/** 面对面配对有效期（毫秒，5 分钟） */
export const FACE_PAIR_TTL_MS = 5 * 60 * 1000;

/** 群邀请默认有效期（毫秒，7 天） */
export const GROUP_INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

/** 消息搜索单页条数 */
export const SEARCH_PAGE_SIZE = 20;

/** 文本消息长度上限（与后端一致） */
export const TEXT_MAX = 2000;

/** 自定义表情允许的 MIME 类型 */
export const STICKER_MIME = Object.freeze(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** 朋友圈文字长度上限 */
export const MOMENT_TEXT_MAX = 1000;

/** 加好友方式三选一 */
export const FRIEND_REQUEST_MODES = Object.freeze(['all', 'qrcode_only', 'invite_only']);

/** 加好友方式文案 */
export const FRIEND_REQUEST_MODE_LABELS = Object.freeze({
  all: '允许所有人添加',
  qrcode_only: '仅可通过二维码添加',
  invite_only: '仅可通过邀请添加',
});

/** 群公告长度上限 */
export const ANNOUNCEMENT_MAX = 500;

/** 群名称长度上限 */
export const GROUP_NAME_MAX = 30;

/** 群头像大小上限（字节） */
export const GROUP_AVATAR_FILE_MAX = 2 * 1024 * 1024;

/** 单页消息条数 */
export const PAGE_SIZE = 30;

/** 消息时间分组间隔：5 分钟 */
export const TIME_GAP_MS = 5 * 60 * 1000;

/** 撤回时间窗：2 分钟 */
export const REVOKE_WINDOW_MS = 120 * 1000;

/** WebRTC ICE 服务器（MVP 仅 STUN，不接 TURN） */
export const RTC_ICE_SERVERS = Object.freeze([{ urls: 'stun:stun.l.google.com:19302' }]);

/** 语音消息时长上限（秒） */
export const VOICE_MAX_SECONDS = 60;

/** 语音消息大小上限（字节，10MB） */
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;

/** 群会议软提示人数阈值（超过 8 人建议改为语音会议，服务端不再硬限制） */
export const CONF_SOFT_WARN_THRESHOLD = 8;

/** 分片上传单片大小（5MB，与后端 UPLOAD_CHUNK_SIZE 对齐） */
export const UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024;

/** 分片上传单文件上限（2GB，与后端 UPLOAD_FILE_MAX_BYTES 对齐） */
export const UPLOAD_FILE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** 语音转文字接口超时（毫秒，服务端含 ffmpeg 转码 + whisper 推理） */
export const VOICE_TRANSCRIBE_TIMEOUT_MS = 600000;

/**
 * 把后端返回的相对媒体路径补全为可直接访问的地址。
 * /uploads 开头的路径补 SERVER_URL；其余（http/blob/data）原样返回。
 * @param {string} path
 * @returns {string}
 */
export function mediaUrl(path) {
  if (!path) return '';
  const value = String(path);
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  if (value.startsWith('/uploads')) return `${SERVER_URL}${value}`;
  return value;
}

/**
 * 构造文件下载地址（attachment + 原始文件名）。
 * @param {string} url 形如 /uploads/xxx 的相对路径
 * @param {string} [filename] 原始文件名（服务端会再清洗一次）
 * @returns {string}
 */
export function downloadUrl(url, filename = '') {
  if (!url) return '';
  const value = String(url);
  const base = value.startsWith('/uploads') ? `${SERVER_URL}/api/download/${value.slice('/uploads/'.length)}` : value;
  if (!filename) return base;
  const search = new URLSearchParams({ filename });
  return `${base}${base.includes('?') ? '&' : '?'}${search.toString()}`;
}
