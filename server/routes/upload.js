/**
 * 上传路由：
 *   POST /api/upload/image        multipart/form-data，字段名 file  —— 聊天图片
 *   POST /api/upload/avatar       multipart/form-data，字段名 file  —— 用户头像
 *   POST /api/upload/sticker      multipart/form-data，字段名 file  —— 自定义表情
 *   POST /api/upload/group-avatar multipart/form-data，字段名 file  —— 群头像
 *   POST /api/upload/video        multipart/form-data，字段名 file  —— 视频（mp4）
 *   POST /api/upload/voice        multipart/form-data，字段名 file  —— 语音（webm|mp4）
 *   POST /api/upload/audio        multipart/form-data，字段名 file  —— 音频（mp3|wav|m4a|aac|ogg|webm）
 *   POST /api/upload/file         multipart/form-data，字段名 file  —— 通用文件（任意类型）
 *
 * 限额（服务端硬限制，不依赖客户端自证）：
 *   - /avatar /group-avatar：jpg / png / webp（不含 gif），单文件 ≤ 2MB；
 *   - 其余端点放开大小限制（部署侧 nginx client_max_body_size 需同步放开）。
 * 前端上传头像前已用 canvas 裁成 256×256 JPEG（约 20KB），2MB 上限只是异常客户端的兜底。
 *
 * 落盘文件名形如 1730000000000-3f0c...e1.jpg，不可变，便于长缓存；原始文件名与存盘名分离。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { UPLOAD_DIR } from '../db.js';
import { httpAuth } from '../auth.js';
import { ApiError, ok, wrap } from '../lib/http.js';
import { toInt } from '../lib/serialize.js';
import { decodeOriginalName, fileExtOf, mp4DurationMs, sanitizeFileName, VOICE_MAX_BYTES, VOICE_MAX_SECONDS } from '../lib/media.js';
import { completeUpload, initUpload, saveChunk } from '../lib/uploadChunks.js';

const router = express.Router();

/** 允许的 mime → 规范扩展名 */
const MIME_EXT = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
});

/** mime 对应的可接受原始扩展名（保留原始扩展名） */
const MIME_EXT_ALIASES = Object.freeze({
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
});

/** 头像单文件上限 2MB（硬限制，写在 multer 上而非事后校验） */
const AVATAR_MAX_FILE_SIZE = 2 * 1024 * 1024;

/** 头像允许的 mime（不含 gif：头像静态化，避免动图头像） */
const AVATAR_MIME = Object.freeze(new Set(['image/jpeg', 'image/png', 'image/webp']));

/**
 * 计算落盘扩展名：原始扩展名与 mime 匹配则保留，否则用 mime 的规范扩展名。
 * @param {string} mime
 * @param {string} originalName
 * @returns {string}
 */
function resolveExtension(mime, originalName) {
  const canonical = MIME_EXT[mime] ?? 'jpg';
  const rawExt = path.extname(String(originalName ?? '')).replace('.', '').toLowerCase();
  const aliases = MIME_EXT_ALIASES[mime] ?? [];
  return aliases.includes(rawExt) ? rawExt : canonical;
}

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, UPLOAD_DIR);
  },
  filename: (req, file, callback) => {
    const ext = resolveExtension(file.mimetype, file.originalname);
    callback(null, `${Date.now()}-${crypto.randomUUID()}.${ext}`);
  },
});

/** 聊天图片上传器：四格式，不限大小 */
const upload = multer({
  storage,
  limits: { files: 1 },
  fileFilter: (req, file, callback) => {
    if (!Object.prototype.hasOwnProperty.call(MIME_EXT, file.mimetype)) {
      return callback(new ApiError(400, 'BAD_MIME', '仅支持 jpg / png / gif / webp 格式的图片'));
    }
    return callback(null, true);
  },
});

/** 头像上传器：2MB，三格式（与聊天图片共用落盘策略，仅限额与白名单不同） */
const avatarUpload = multer({
  storage,
  limits: { fileSize: AVATAR_MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!AVATAR_MIME.has(file.mimetype)) {
      return callback(new ApiError(400, 'BAD_MIME', '头像仅支持 jpg / png / webp 格式的图片'));
    }
    return callback(null, true);
  },
});

/** 表情上传器：四格式（表情需要动图，因此放行 gif），不限大小 */
const stickerUpload = multer({
  storage,
  limits: { files: 1 },
  fileFilter: (req, file, callback) => {
    if (!Object.prototype.hasOwnProperty.call(MIME_EXT, file.mimetype)) {
      return callback(new ApiError(400, 'BAD_MIME', '表情仅支持 jpg / png / gif / webp 格式的图片'));
    }
    return callback(null, true);
  },
});

/** 视频落盘策略：统一 mp4 扩展名（multer 只认 video/mp4） */
const videoStorage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, UPLOAD_DIR);
  },
  filename: (req, file, callback) => {
    callback(null, `${Date.now()}-${crypto.randomUUID()}.mp4`);
  },
});

/** 视频上传器：仅 video/mp4，不限大小与时长 */
const videoUpload = multer({
  storage: videoStorage,
  limits: { files: 1 },
  fileFilter: (req, file, callback) => {
    if (file.mimetype !== 'video/mp4') {
      return callback(new ApiError(400, 'BAD_MIME', '视频仅支持 mp4 格式'));
    }
    return callback(null, true);
  },
});

/** 语音允许的 mime → 落盘扩展名（webm 在 Chromium/Android，mp4 在 Safari/iOS） */
const VOICE_MIME_EXT = Object.freeze({
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
});

/** 语音落盘策略：按 mime 保留 webm / mp4 扩展名（便于前端按扩展名判断播放能力） */
const voiceStorage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, UPLOAD_DIR);
  },
  filename: (req, file, callback) => {
    const ext = VOICE_MIME_EXT[file.mimetype] ?? 'webm';
    callback(null, `${Date.now()}-${crypto.randomUUID()}.${ext}`);
  },
});

/** 语音上传器：10MB，仅 audio/webm 或 audio/mp4 */
const voiceUpload = multer({
  storage: voiceStorage,
  limits: { fileSize: VOICE_MAX_BYTES, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!Object.prototype.hasOwnProperty.call(VOICE_MIME_EXT, file.mimetype)) {
      return callback(new ApiError(400, 'BAD_MIME', '语音仅支持 webm 或 mp4 格式'));
    }
    return callback(null, true);
  },
});

/** 朋友圈 / 通用音频允许的 mime → 落盘扩展名 */
const AUDIO_MIME_EXT = Object.freeze({
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
});

/** 音频落盘策略：按 mime 保留扩展名（便于前端按扩展名判断播放能力） */
const audioStorage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, UPLOAD_DIR);
  },
  filename: (req, file, callback) => {
    const ext = AUDIO_MIME_EXT[file.mimetype] ?? 'mp3';
    callback(null, `${Date.now()}-${crypto.randomUUID()}.${ext}`);
  },
});

/** 音频上传器：mp3/wav/m4a/aac/ogg/webm，不限大小 */
const audioUpload = multer({
  storage: audioStorage,
  limits: { files: 1 },
  fileFilter: (req, file, callback) => {
    if (!Object.prototype.hasOwnProperty.call(AUDIO_MIME_EXT, file.mimetype)) {
      return callback(new ApiError(400, 'BAD_MIME', '音频仅支持 mp3 / wav / m4a / aac / ogg / webm 格式'));
    }
    return callback(null, true);
  },
});

/** 通用文件落盘策略：存盘名与原始名分离，扩展名取自清洗后的原始名 */
const fileStorage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, UPLOAD_DIR);
  },
  filename: (req, file, callback) => {
    const cleaned = sanitizeFileName(decodeOriginalName(file)) || 'file';
    callback(null, `${Date.now()}-${crypto.randomUUID()}.${fileExtOf(cleaned)}`);
  },
});

/** 通用文件上传器：任意类型，不限大小 */
const fileUpload = multer({
  storage: fileStorage,
  limits: { files: 1 },
});

/**
 * 把 multer 中间件包装成 Promise，统一转换错误码。
 * @param {import('multer').Multer} middleware 具体上传器
 * @param {string} tooLargeMessage 超限提示文案
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
function runUpload(middleware, tooLargeMessage, req, res) {
  return new Promise((resolve, reject) => {
    middleware.single('file')(req, res, (err) => {
      if (!err) return resolve();
      if (err instanceof ApiError) return reject(err);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return reject(new ApiError(400, 'FILE_TOO_LARGE', tooLargeMessage));
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return reject(new ApiError(400, 'INVALID_PARAM', '请使用 file 字段上传单个文件'));
        }
        return reject(new ApiError(400, 'UPLOAD_ERROR', `文件上传失败：${err.message}`));
      }
      return reject(err);
    });
  });
}

// 聊天图片上传（四格式，不限大小）
router.post(
  '/image',
  httpAuth,
  wrap(async (req, res) => {
    await runUpload(upload, '图片上传失败', req, res);

    const file = req.file;
    if (!file || !file.filename) {
      throw new ApiError(400, 'INVALID_PARAM', '请选择要上传的图片');
    }

    return ok(res, { url: `/uploads/${file.filename}` });
  }),
);

// 头像上传（2MB，jpg / png / webp）：独立端点，限额写在 multer 上，服务端不依赖客户端声明用途
router.post(
  '/avatar',
  httpAuth,
  wrap(async (req, res) => {
    await runUpload(avatarUpload, '头像图片不能超过 2MB', req, res);

    const file = req.file;
    if (!file || !file.filename) {
      throw new ApiError(400, 'INVALID_PARAM', '请选择要上传的头像');
    }

    return ok(res, { url: `/uploads/${file.filename}` });
  }),
);

// 自定义表情上传（jpg / png / gif / webp，不限大小）：表情常用动图，与头像的白名单不同
router.post(
  '/sticker',
  httpAuth,
  wrap(async (req, res) => {
    await runUpload(stickerUpload, '表情上传失败', req, res);

    const file = req.file;
    if (!file || !file.filename) {
      throw new ApiError(400, 'INVALID_PARAM', '请选择要上传的表情图片');
    }

    return ok(res, { url: `/uploads/${file.filename}` });
  }),
);

// 群头像上传（2MB，jpg / png / webp）：写库前由路由侧校验群主/管理员权限，这里只负责落盘
router.post(
  '/group-avatar',
  httpAuth,
  wrap(async (req, res) => {
    await runUpload(avatarUpload, '群头像不能超过 2MB', req, res);

    const file = req.file;
    if (!file || !file.filename) {
      throw new ApiError(400, 'INVALID_PARAM', '请选择要上传的群头像');
    }

    return ok(res, { url: `/uploads/${file.filename}` });
  }),
);

// 视频上传（mp4，不限大小与时长）：best-effort 解析 mvhd 返回 duration_ms，解析失败返回 0 不报错
router.post(
  '/video',
  httpAuth,
  wrap(async (req, res) => {
    await runUpload(videoUpload, '视频上传失败', req, res);

    const file = req.file;
    if (!file || !file.filename) {
      throw new ApiError(400, 'INVALID_PARAM', '请选择要上传的视频');
    }

    const absolutePath = path.join(UPLOAD_DIR, file.filename);
    const durationMs = mp4DurationMs(absolutePath) ?? 0;

    return ok(res, { url: `/uploads/${file.filename}`, duration_ms: durationMs });
  }),
);

// 语音上传（10MB，webm|mp4）：duration 必须先于 file append；
// mp4 用纯 JS 解析 mvhd 强校验 ≤60s，webm 信任前端 duration + 大小。
router.post(
  '/voice',
  httpAuth,
  wrap(async (req, res) => {
    await runUpload(voiceUpload, '语音不能超过 10MB', req, res);

    const file = req.file;
    if (!file || !file.filename) {
      throw new ApiError(400, 'INVALID_PARAM', '请选择要上传的语音');
    }

    const duration = toInt(req.body?.duration, 0);
    if (duration < 1 || duration > VOICE_MAX_SECONDS) {
      // 校验失败删掉已落盘文件，避免留下孤儿文件
      try {
        fs.unlinkSync(path.join(UPLOAD_DIR, file.filename));
      } catch (unlinkErr) {
        console.warn('[upload] unlink failed:', unlinkErr && unlinkErr.message);
      }
      throw new ApiError(400, 'INVALID_PARAM', `语音时长需在 1-${VOICE_MAX_SECONDS} 秒之间`);
    }

    const absolutePath = path.join(UPLOAD_DIR, file.filename);
    let finalDuration = duration;

    // mp4：强校验实际时长；解析失败或超时删除文件并报错
    if (file.mimetype === 'audio/mp4') {
      let realMs = mp4DurationMs(absolutePath);
      if (realMs === null) {
        try {
          fs.unlinkSync(absolutePath);
        } catch (unlinkErr) {
          console.warn('[upload] unlink failed:', unlinkErr && unlinkErr.message);
        }
        throw new ApiError(400, 'INVALID_PARAM', '无法解析语音文件，请确认是合法的 mp4');
      }
      if (realMs > VOICE_MAX_SECONDS * 1000) {
        try {
          fs.unlinkSync(absolutePath);
        } catch (unlinkErr) {
          console.warn('[upload] unlink failed:', unlinkErr && unlinkErr.message);
        }
        throw new ApiError(400, 'VOICE_TOO_LONG', `语音时长不能超过 ${VOICE_MAX_SECONDS} 秒`);
      }
      finalDuration = Math.min(VOICE_MAX_SECONDS, Math.max(1, Math.ceil(realMs / 1000)));
    }

    return ok(res, { url: `/uploads/${file.filename}`, duration: finalDuration });
  }),
);

// 音频上传（mp3/wav/m4a/aac/ogg/webm，不限大小）：供朋友圈音频使用
router.post(
  '/audio',
  httpAuth,
  wrap(async (req, res) => {
    await runUpload(audioUpload, '音频上传失败', req, res);

    const file = req.file;
    if (!file || !file.filename) {
      throw new ApiError(400, 'INVALID_PARAM', '请选择要上传的音频');
    }

    return ok(res, { url: `/uploads/${file.filename}` });
  }),
);

// 通用文件上传（任意类型不限大小）：存盘名与原始名分离，返回清洗后的原始名与字节数
router.post(
  '/file',
  httpAuth,
  wrap(async (req, res) => {
    await runUpload(fileUpload, '文件上传失败', req, res);

    const file = req.file;
    if (!file || !file.filename) {
      throw new ApiError(400, 'INVALID_PARAM', '请选择要上传的文件');
    }

    const fileName = sanitizeFileName(decodeOriginalName(file)) || 'file';
    return ok(res, {
      url: `/uploads/${file.filename}`,
      file_name: fileName,
      file_size: Number(file.size ?? 0),
    });
  }),
);

/* ------------------------------------------------------------------ */
/* 分片上传（大文件）：init（秒传/续传）→ chunk（raw body）→ complete  */
/* ------------------------------------------------------------------ */

// 初始化：body {hash, size, chunk_size, file_name}
router.post(
  '/init',
  httpAuth,
  wrap(async (req, res) => {
    const result = initUpload(req.body ?? {});
    return ok(res, result);
  }),
);

// 分片：query file_id/index，raw body（application/octet-stream，≤6MB 给 5MB 分片留余量）
router.post(
  '/chunk',
  express.raw({ type: () => true, limit: '6mb' }),
  httpAuth,
  wrap(async (req, res) => {
    const fileId = typeof req.query.file_id === 'string' ? req.query.file_id : '';
    const index = toInt(req.query.index, -1);
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const result = saveChunk(fileId, index, buf);
    return ok(res, result);
  }),
);

// 完成：body {file_id}
router.post(
  '/complete',
  httpAuth,
  wrap(async (req, res) => {
    const fileId = typeof req.body?.file_id === 'string' ? req.body.file_id : '';
    const result = await completeUpload(fileId);
    return ok(res, result);
  }),
);

export default router;
