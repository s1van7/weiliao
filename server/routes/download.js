/**
 * 文件下载路由（不鉴权）：
 *   GET /api/download/:name?filename=
 *
 * 安全边界：name 只能是上传目录下的 UUID 文件名（不可猜测），并严格匹配
 * /^[A-Za-z0-9._-]+$/，杜绝路径穿越；filename 经 sanitize 后回退 name。
 * 响应固定为 attachment + nosniff，支持 UTF-8 原始文件名。
 */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { UPLOAD_DIR } from '../db.js';
import { sanitizeFileName } from '../lib/media.js';

const router = express.Router();

/** 上传文件名白名单（UUID-时间戳.ext，杜绝路径穿越） */
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * GET /download/:name?filename=
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {void}
 */
router.get('/:name', (req, res) => {
  const name = String(req.params.name ?? '');
  if (!NAME_PATTERN.test(name)) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '文件不存在' });
  }

  const filePath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '文件不存在' });
  }

  const rawFilename = typeof req.query.filename === 'string' ? req.query.filename : '';
  const filename = sanitizeFileName(rawFilename) || name;

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

  return res.sendFile(filePath);
});

export default router;
