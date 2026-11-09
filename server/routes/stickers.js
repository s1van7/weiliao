/**
 * 自定义表情路由（全部需要登录）：
 *   GET    /api/stickers       我的表情列表（新→旧）
 *   POST   /api/stickers       新增一个表情（body: {url}）
 *   DELETE /api/stickers/:id   删除我的表情
 *
 * 只做参数解析与响应，业务规则全部落在 lib/stickers.js。
 */
import express from 'express';
import { httpAuth } from '../auth.js';
import { ok, wrap } from '../lib/http.js';
import { deleteSticker, insertSticker, listStickers } from '../lib/stickers.js';

const router = express.Router();

// 我的表情列表
router.get(
  '/',
  httpAuth,
  wrap(async (req, res) => {
    return ok(res, { stickers: listStickers(req.userId) });
  }),
);

// 新增表情：url 由 /api/upload/sticker 上传后拿到
router.post(
  '/',
  httpAuth,
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const sticker = insertSticker(req.userId, body.url);
    return ok(res, { sticker });
  }),
);

// 删除表情
router.delete(
  '/:id',
  httpAuth,
  wrap(async (req, res) => {
    const result = deleteSticker(req.userId, req.params.id);
    return ok(res, result);
  }),
);

export default router;
