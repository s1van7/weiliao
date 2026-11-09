/**
 * 应用元信息路由（不鉴权）：
 *   GET /api/app/latest  当前发版版本号、更新说明、三端安装包下载地址。
 *
 * 客户端「检查更新」用它对比本地构建版本（构建时注入的 APP_VERSION）。
 */
import express from 'express';
import { ok, wrap } from '../lib/http.js';
import { getLatestRelease } from '../lib/update.js';

const router = express.Router();

router.get(
  '/latest',
  wrap(async (req, res) => {
    // 更新包内容随发版变化，禁止任何中间层缓存
    res.setHeader('Cache-Control', 'no-store');
    return ok(res, getLatestRelease());
  }),
);

export default router;
