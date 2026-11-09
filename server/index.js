/**
 * 服务入口：中间件、API 路由挂载、Socket.IO 实时层、静态资源与 SPA fallback、错误处理。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { Server } from 'socket.io';
import { db, closeDb, DB_PATH, ROOT_DIR, UPLOAD_DIR, WEB_DIST_DIR } from './db.js';
import { ApiError } from './lib/http.js';
import { initSocket } from './socket.js';
import authRouter from './routes/auth.js';
import { meRouter, usersRouter } from './routes/users.js';
import friendsRouter from './routes/friends.js';
import conversationsRouter from './routes/conversations.js';
import messagesRouter from './routes/messages.js';
import groupsRouter from './routes/groups.js';
import stickersRouter from './routes/stickers.js';
import momentsRouter from './routes/moments.js';
import uploadRouter from './routes/upload.js';
import downloadRouter from './routes/download.js';
import qrRouter from './routes/qr.js';
import favoritesRouter from './routes/favorites.js';
import rtcRouter from './routes/rtc.js';
import voiceRouter from './routes/voice.js';
import settingsRouter from './routes/settings.js';
import facePairRouter from './routes/facePair.js';
import groupInviteRouter from './routes/groupInvite.js';
import appRouter from './routes/app.js';

const PORT = Number(process.env.PORT) || 3000;

/**
 * 读取 package.json 中的版本号，失败时退回占位版本。
 * @returns {string}
 */
function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const APP_VERSION = readVersion();

/** web/dist 不存在时返回的提示页 */
const MISSING_DIST_HTML = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><title>WeChat Lite</title></head>
<body style="font-family:system-ui,-apple-system,'PingFang SC',sans-serif;padding:48px;color:#111">
  <h1 style="margin:0 0 12px">WeChat Lite 服务已启动</h1>
  <p style="color:#555">前端构建产物尚未生成：请先执行前端构建，产物输出到 <code>web/dist</code>。</p>
  <p style="color:#555">后端接口可用：<code>GET /api/health</code></p>
</body>
</html>`;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

/** 不需要打印访问日志的路径前缀 */
const LOG_SKIP_PREFIXES = ['/api/health', '/uploads/', '/assets/', '/favicon'];

// 跨域：Android/iOS/Windows 客户端从 localhost/file:// 访问远端 API，需要放行
// 鉴权使用 Authorization 头而非 Cookie，因此允许任意来源回显是安全的
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return next();
});

// 访问日志：method path status ms
app.use((req, res, next) => {
  if (LOG_SKIP_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    return next();
  }
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(`[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${elapsedMs.toFixed(1)}ms`);
  });
  return next();
});

/** 允许浏览器内联预览的安全媒体扩展名 */
const SAFE_INLINE_EXTS = Object.freeze(
  new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'ogg']),
);

// 上传文件静态托管（文件名不可变，长缓存）：
// 安全媒体扩展名正常内联；其余类型强制 application/octet-stream + attachment + nosniff，防 XSS。
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '30d',
    immutable: true,
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).replace('.', '').toLowerCase();
      if (SAFE_INLINE_EXTS.has(ext)) return;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }),
);

// 安装包下载：/dl 为下载引导页，/downloads 存放三端安装包
const DOWNLOAD_DIR = path.join(ROOT_DIR, 'data', 'downloads');
app.get('/dl', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'server', 'download-page.html'));
});
// 安装包：不设长缓存（同版本号可能重传，长缓存会命中边缘节点旧文件），
// 改用 ETag 协商缓存；下载地址由 /api/app/latest 下发并带版本参数
app.use('/downloads', express.static(DOWNLOAD_DIR, { maxAge: 0, etag: true, lastModified: true }));

// 健康检查
app.get('/api/health', (req, res) => {
  let dbStatus = 'ok';
  try {
    db.prepare('SELECT 1 AS value').get();
  } catch (err) {
    dbStatus = 'error';
    console.error('[health] db probe failed:', err.message);
  }
  res.json({ ok: true, uptime: Math.round(process.uptime()), version: APP_VERSION, db: dbStatus });
});

// 业务路由
app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);
app.use('/api/users', usersRouter);
app.use('/api/friends', friendsRouter);
// 会话 / 未读、消息、上传：路由内部逐条挂 httpAuth，未命中的路径仍走全局 404
app.use('/api', conversationsRouter);
app.use('/api', messagesRouter);
// 群管理：路径形如 /api/conversations/:id/...，必须挂在 conversationsRouter 之后，
// 否则 DELETE /api/conversations/:id/members/me（退群）会被 /:id/members/:uid 抢先匹配
app.use('/api/conversations', groupsRouter);
// 表情与朋友圈：各自独立前缀
app.use('/api/stickers', stickersRouter);
app.use('/api/moments', momentsRouter);
app.use('/api/upload', uploadRouter);
// 文件下载（不鉴权，attachment + 原始文件名）
app.use('/api/download', downloadRouter);
// 二维码解析与收藏
app.use('/api/qr', qrRouter);
app.use('/api/favorites', favoritesRouter);
// 通话 ICE 配置、语音转文字、发现页配置
app.use('/api', rtcRouter);
app.use('/api', voiceRouter);
app.use('/api/settings', settingsRouter);
// 应用更新（版本号 / 更新说明 / 三端安装包地址，不鉴权）
app.use('/api/app', appRouter);
// 面对面配对与群邀请
app.use('/api/face-pair', facePairRouter);
app.use('/api/group-invites', groupInviteRouter);

// 未匹配的 API 一律 404 JSON
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '接口不存在' });
});

// 前端静态资源（dist 不存在时 express.static 会自动 fallthrough）
// 缓存策略：/assets/ 下带内容哈希 → 永久缓存；index.html、sw.js、manifest → 禁止缓存，
// 否则浏览器/中间商会长期持有旧外壳，导致前端更新后用户看不到新功能。
app.use(
  express.static(WEB_DIST_DIR, {
    index: false,
    setHeaders(res, filePath) {
      const name = path.basename(filePath);
      if (name === 'index.html' || name === 'sw.js' || name.endsWith('.webmanifest')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return;
      }
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }
      res.setHeader('Cache-Control', 'public, max-age=3600');
    },
  }),
);

// SPA fallback：非 /api、非 /uploads、非 /downloads 的 GET 返回 index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/downloads')) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '资源不存在' });
  }
  const indexHtmlPath = path.join(WEB_DIST_DIR, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(indexHtmlPath);
  }
  return res.status(200).type('html').send(MISSING_DIST_HTML);
});

// 全局错误处理
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof multer.MulterError) {
    console.warn('[error] multer:', err.code, err.message);
    return res.status(400).json({ ok: false, code: 'UPLOAD_ERROR', message: `文件上传失败：${err.message}` });
  }

  if (err instanceof ApiError) {
    return res.status(err.status).json({ ok: false, code: err.code, message: err.message, ...err.extra });
  }

  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, code: 'BAD_JSON', message: '请求体不是合法的 JSON' });
  }

  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, code: 'PAYLOAD_TOO_LARGE', message: '请求体过大' });
  }

  console.error('[error]', err && err.stack ? err.stack : err);
  const message = process.env.NODE_ENV === 'production' ? '服务器内部错误' : String(err?.message ?? err);
  return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message });
});

// HTTP 服务器 + Socket.IO（同一端口，path 默认 /socket.io）
const server = http.createServer(app);
server.keepAliveTimeout = 65000;

const io = new Server(server, {
  serveClient: false,
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e6,
  cors: { origin: true, credentials: true },
});

// 注册实时层（内部会注入事件总线：握手鉴权 / 房间 / presence / 事件）
initSocket(io);

let shuttingDown = false;

/**
 * 优雅关闭：先关闭 Socket.IO，再停止接收新连接，最后关闭数据库。
 * @param {string} signal
 */
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] received ${signal}, shutting down`);

  const forceTimer = setTimeout(() => {
    closeDb();
    process.exit(0);
  }, 5000);
  forceTimer.unref();

  io.close(() => {
    console.log('[socket] closed');
  });

  server.close(() => {
    closeDb();
    clearTimeout(forceTimer);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, () => {
  console.log(`[server] listening on http://127.0.0.1:${PORT}`);
  console.log(`[server] db: ${DB_PATH}`);
  console.log(`[server] uploads: ${UPLOAD_DIR}`);
  console.log(`[server] web dist: ${WEB_DIST_DIR} (exists: ${fs.existsSync(WEB_DIST_DIR)})`);
  console.log(`[server] node ${process.version}, version ${APP_VERSION}`);
});

export default app;
