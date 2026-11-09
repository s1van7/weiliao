/**
 * 面对面配对路由（挂在 /api/face-pair，全部需要登录）：
 *   POST /create        创建配对（返回 4 位码）
 *   POST /join          加入配对
 *   GET  /:id           配对详情
 *   POST /group         面对面建群成组
 */
import express from 'express';
import { httpAuth } from '../auth.js';
import { ok, wrap } from '../lib/http.js';
import { createGroupFromPairing, createPairing, getPairing, joinPairing } from '../lib/facePair.js';

const router = express.Router();
router.use(httpAuth);

// 创建配对
router.post(
  '/create',
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const result = createPairing(req.userId, body.kind);
    return ok(res, result);
  }),
);

// 加入配对
router.post(
  '/join',
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const result = joinPairing(req.userId, body.kind, body.code);
    return ok(res, result);
  }),
);

// 配对详情
router.get(
  '/:id',
  wrap(async (req, res) => {
    const result = getPairing(req.params.id, req.userId);
    return ok(res, result);
  }),
);

// 面对面建群成组
router.post(
  '/group',
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const result = createGroupFromPairing(body.pairing_id, req.userId);
    return ok(res, result);
  }),
);

export default router;
