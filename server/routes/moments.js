/**
 * 朋友圈路由（全部需要登录）：
 *   GET    /api/moments                      时间线分页（?before_id=&limit=）
 *   POST   /api/moments                      发布动态（body: {content, images}）
 *   DELETE /api/moments/:id                  删除自己的动态
 *   POST   /api/moments/:id/like             点赞（幂等）
 *   DELETE /api/moments/:id/like             取消点赞（幂等）
 *   POST   /api/moments/:id/comments         发表评论
 *   DELETE /api/moments/:id/comments/:cid    删除评论（评论作者或动态作者）
 *
 * 可见性（好友关系实时判定）与业务规则全部落在 lib/moments.js。
 */
import express from 'express';
import { httpAuth } from '../auth.js';
import { ok, wrap } from '../lib/http.js';
import {
  addComment,
  createMoment,
  deleteComment,
  deleteMoment,
  likeMoment,
  listTimeline,
  listUserMoments,
  unlikeMoment,
} from '../lib/moments.js';

const router = express.Router();

// 时间线：我与好友的动态；带 user_id 时切换为「指定用户的朋友圈」
router.get(
  '/',
  httpAuth,
  wrap(async (req, res) => {
    const query = req.query ?? {};
    if (query.user_id !== undefined && query.user_id !== '') {
      const result = listUserMoments({
        userId: query.user_id,
        viewerId: req.userId,
        beforeId: query.before_id,
        limit: query.limit,
      });
      return ok(res, { moments: result.moments, has_more: result.has_more });
    }

    const result = listTimeline({
      userId: req.userId,
      beforeId: query.before_id,
      limit: query.limit,
    });
    return ok(res, { moments: result.moments, has_more: result.has_more });
  }),
);

// 发布动态
router.post(
  '/',
  httpAuth,
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const moment = createMoment({
      userId: req.userId,
      content: body.content,
      mediaType: body.media_type,
      images: body.images,
      videoUrl: body.video_url,
      audioUrl: body.audio_url,
    });
    return ok(res, { moment });
  }),
);

// 删除动态（仅作者）
router.delete(
  '/:id',
  httpAuth,
  wrap(async (req, res) => {
    const result = deleteMoment({ userId: req.userId, momentId: req.params.id });
    return ok(res, result);
  }),
);

// 点赞
router.post(
  '/:id/like',
  httpAuth,
  wrap(async (req, res) => {
    const result = likeMoment({ userId: req.userId, momentId: req.params.id });
    return ok(res, result);
  }),
);

// 取消点赞
router.delete(
  '/:id/like',
  httpAuth,
  wrap(async (req, res) => {
    const result = unlikeMoment({ userId: req.userId, momentId: req.params.id });
    return ok(res, result);
  }),
);

// 发表评论
router.post(
  '/:id/comments',
  httpAuth,
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const result = addComment({ userId: req.userId, momentId: req.params.id, content: body.content });
    return ok(res, result);
  }),
);

// 删除评论
router.delete(
  '/:id/comments/:cid',
  httpAuth,
  wrap(async (req, res) => {
    const result = deleteComment({
      userId: req.userId,
      momentId: req.params.id,
      commentId: req.params.cid,
    });
    return ok(res, result);
  }),
);

export default router;
