/**
 * 收藏路由（全部需要登录）：
 *   POST   /api/favorites          收藏消息或动态
 *   GET    /api/favorites          收藏列表（before_id 分页）
 *   DELETE /api/favorites/:id      取消收藏
 */
import express from 'express';
import { httpAuth } from '../auth.js';
import { ok, wrap } from '../lib/http.js';
import { createFavorite, deleteFavorite, listFavorites } from '../lib/favorites.js';

const router = express.Router();
router.use(httpAuth);

// 收藏：content_type = message | moment
router.post(
  '/',
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const favorite = createFavorite(req.userId, body.content_type, body.content_id);
    return ok(res, { favorite });
  }),
);

// 收藏列表
router.get(
  '/',
  wrap(async (req, res) => {
    const query = req.query ?? {};
    const result = listFavorites(req.userId, { beforeId: query.before_id, limit: query.limit });
    return ok(res, { favorites: result.favorites, has_more: result.has_more });
  }),
);

// 取消收藏
router.delete(
  '/:id',
  wrap(async (req, res) => {
    const result = deleteFavorite(req.userId, req.params.id);
    return ok(res, result);
  }),
);

export default router;
