/**
 * 媒体工具：视频 MP4 时长解析（纯 JS 读字节，不引入任何原生模块）、媒体地址白名单。
 *
 * 口径约定（与前端一致）：
 *   - 照片 = jpg / jpeg / png / webp；
 *   - live  = gif 或 mp4（前端循环播放）；
 *   - 视频 = mp4（不限大小与时长，best-effort 解析时长）；
 *   - 音频 = mp3 / wav / m4a / aac / ogg / webm。
 */
import fs from 'node:fs';

/** 媒体地址白名单：仅允许本站上传目录下的相对路径 */
export const MEDIA_URL_PATTERN = /^\/uploads\/[A-Za-z0-9._-]+$/;

/** 媒体地址长度上限 */
export const MEDIA_URL_MAX = 512;

/** 视频地址白名单：/uploads/*.mp4 */
export const VIDEO_URL_PATTERN = /^\/uploads\/[A-Za-z0-9._-]+\.mp4$/i;

/** 语音地址白名单：/uploads/*.webm 或 /uploads/*.mp4 */
export const VOICE_URL_PATTERN = /^\/uploads\/[A-Za-z0-9._-]+\.(webm|mp4)$/i;

/** 音频地址白名单：/uploads/*.mp3|wav|m4a|aac|ogg|webm */
export const AUDIO_URL_PATTERN = /^\/uploads\/[A-Za-z0-9._-]+\.(mp3|wav|m4a|aac|ogg|webm)$/i;

/** 文件名长度上限（按码点计） */
export const FILE_NAME_MAX = 255;

/** 语音时长上限（秒） */
export const VOICE_MAX_SECONDS = 60;

/** 语音文件大小上限（字节，10MB） */
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * 判断字符串是否为合法的媒体地址（/uploads/xxx）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isMediaUrl(value) {
  return typeof value === 'string' && value.length <= MEDIA_URL_MAX && MEDIA_URL_PATTERN.test(value);
}

/**
 * 判断字符串是否为合法的视频地址（/uploads/xxx.mp4）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isVideoUrl(value) {
  return typeof value === 'string' && value.length <= MEDIA_URL_MAX && VIDEO_URL_PATTERN.test(value);
}

/**
 * 判断字符串是否为合法的语音地址（/uploads/xxx.webm|mp4）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isVoiceUrl(value) {
  return typeof value === 'string' && value.length <= MEDIA_URL_MAX && VOICE_URL_PATTERN.test(value);
}

/**
 * 判断字符串是否为合法的音频地址（/uploads/xxx.mp3|wav|m4a|aac|ogg|webm）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAudioUrl(value) {
  return typeof value === 'string' && value.length <= MEDIA_URL_MAX && AUDIO_URL_PATTERN.test(value);
}

/**
 * 清洗文件名：去控制字符、替换非法字符、trim、按码点截断 ≤255。
 * @param {unknown} name 原始文件名
 * @returns {string}
 */
export function sanitizeFileName(name) {
  let value = String(name ?? '');
  // 去除控制字符（<0x20 与 0x7F），按码点遍历避免切断代理对
  value = [...value]
    .filter((ch) => {
      const code = ch.codePointAt(0);
      return code !== undefined && code >= 0x20 && code !== 0x7f;
    })
    .join('');
  // 替换文件系统不安全字符
  value = value.replace(/[\\/:*?"<>|]/g, '_');
  value = value.trim();
  const chars = [...value];
  return chars.length <= FILE_NAME_MAX ? chars.join('') : chars.slice(0, FILE_NAME_MAX).join('');
}

/**
 * 从清洗后的原始文件名中提取落盘扩展名。
 * 与 upload.js 历史私有实现保持一致，仅提取为公共导出供分片上传复用。
 * @param {string} cleanedName sanitizeFileName 后的文件名
 * @returns {string} 1-10 位字母数字扩展名；缺失时回退 'bin'
 */
export function fileExtOf(cleanedName) {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(String(cleanedName ?? ''));
  return match ? match[1].toLowerCase() : 'bin';
}

/**
 * 还原 multer 里被 latin1 解码破坏的中文原始文件名。
 * @param {{originalname?: string}|null|undefined} file multer 文件对象
 * @returns {string}
 */
export function decodeOriginalName(file) {
  if (!file || typeof file.originalname !== 'string') return '';
  return Buffer.from(file.originalname, 'latin1').toString('utf8');
}

/**
 * 读取无符号 32 位大端整数（越界返回 null）。
 * @param {Buffer} buf
 * @param {number} offset
 * @returns {number|null}
 */
function readUInt32(buf, offset) {
  if (offset < 0 || offset + 4 > buf.length) return null;
  return buf.readUInt32BE(offset);
}

/**
 * 解析一个 MP4 box 头。
 * @param {Buffer} buf 整个文件字节
 * @param {number} offset box 起始偏移
 * @param {number} limit box 父级结束偏移
 * @returns {{type:string, size:number, headerSize:number, start:number, end:number}|null}
 */
function readBoxHeader(buf, offset, limit) {
  const size = readUInt32(buf, offset);
  if (size === null) return null;
  if (offset + 8 > limit) return null;

  const type = buf.toString('ascii', offset + 4, offset + 8);
  let headerSize = 8;
  let boxSize = size;

  if (size === 1) {
    // 64 位大 size：后面跟 8 字节 largesize
    if (offset + 16 > limit) return null;
    boxSize = Number(buf.readBigUInt64BE(offset + 8));
    headerSize = 16;
  } else if (size === 0) {
    // size=0 表示 box 延伸到父级末尾
    boxSize = limit - offset;
  }

  if (!Number.isSafeInteger(boxSize) || boxSize < headerSize) return null;
  return { type, size: boxSize, headerSize, start: offset, end: offset + boxSize };
}

/**
 * 在 [start, end) 区间内查找第一个指定类型的子 box。
 * @param {Buffer} buf
 * @param {number} start
 * @param {number} end
 * @param {string} targetType
 * @returns {{type:string, size:number, headerSize:number, start:number, end:number}|null}
 */
function findChildBox(buf, start, end, targetType) {
  let offset = start;
  while (offset + 8 <= end) {
    const header = readBoxHeader(buf, offset, end);
    if (!header) return null;
    if (header.type === targetType) return header;
    offset = header.end;
  }
  return null;
}

/**
 * 解析 moov/mvhd 里的 timescale 与 duration。
 * @param {Buffer} buf
 * @param {number} start mvhd box 数据区起始偏移
 * @param {number} end mvhd box 结束偏移
 * @returns {{timescale:number, duration:number}|null}
 */
function parseMvhd(buf, start, end) {
  if (start + 4 > end) return null;
  const version = buf[start];
  let offset = start + 4;

  let timescale = 0;
  let duration = 0;

  if (version === 0) {
    // version 0: creation(4) + modification(4) + timescale(4) + duration(4)
    if (offset + 16 > end) return null;
    timescale = buf.readUInt32BE(offset + 8);
    duration = buf.readUInt32BE(offset + 12);
  } else if (version === 1) {
    // version 1: creation(8) + modification(8) + timescale(4) + duration(8)
    if (offset + 20 > end) return null;
    timescale = buf.readUInt32BE(offset + 16);
    duration = Number(buf.readBigUInt64BE(offset + 20));
  } else {
    return null;
  }

  if (!Number.isFinite(timescale) || timescale <= 0) return null;
  if (!Number.isFinite(duration) || duration < 0) return null;
  return { timescale, duration };
}

/**
 * 纯 JS 解析 MP4 文件时长（毫秒）。
 *
 * 遍历顶层 box 定位 moov，再在 moov 内定位 mvhd，用 timescale / duration 计算秒数。
 * 解析失败返回 null（由调用方决定是否报错）。
 * @param {string} filePath 磁盘文件绝对路径
 * @returns {number|null} 时长毫秒；无法解析返回 null
 */
export function mp4DurationMs(filePath) {
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return null;
  }
  if (!buf || buf.length < 12) return null;

  const fileEnd = buf.length;
  let offset = 0;
  let moov = null;

  // 顶层 box 遍历，定位 moov
  while (offset + 8 <= fileEnd) {
    const header = readBoxHeader(buf, offset, fileEnd);
    if (!header) break;
    if (header.type === 'moov') {
      moov = header;
      break;
    }
    offset = header.end;
  }

  if (!moov) return null;

  // moov 内部定位 mvhd
  const mvhd = findChildBox(buf, moov.start + moov.headerSize, moov.end, 'mvhd');
  if (!mvhd) return null;

  const parsed = parseMvhd(buf, mvhd.start + mvhd.headerSize, mvhd.end);
  if (!parsed) return null;

  return Math.round((parsed.duration * 1000) / parsed.timescale);
}

export default {
  MEDIA_URL_PATTERN,
  MEDIA_URL_MAX,
  VIDEO_URL_PATTERN,
  VOICE_URL_PATTERN,
  AUDIO_URL_PATTERN,
  FILE_NAME_MAX,
  VOICE_MAX_SECONDS,
  VOICE_MAX_BYTES,
  isMediaUrl,
  isVideoUrl,
  isVoiceUrl,
  isAudioUrl,
  sanitizeFileName,
  decodeOriginalName,
  fileExtOf,
  mp4DurationMs,
};
