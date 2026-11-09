/**
 * 群邀请路由（挂在 /api/group-invites，全部需要登录）：
 *   POST /resolve  解析邀请（返回群信息与是否已入群）
 *   POST /join     通过邀请入群
 */
import express from 'express';
import { httpAuth } from '../auth.js';
import { ok, wrap } from '../lib/http.js';
import { joinByInvite, resolveInvite } from '../lib/groupInvite.js';

const router = express.Router();
router.use(httpAuth);

// 解析群邀请
router.post(
  '/resolve',
  wrap(async (req, res) => {
    const token = (req.body ?? {}).token;
    return ok(res, resolveInvite(token, req.userId));
  }),
);

// 通过群邀请入群
router.post(
  '/join',
  wrap(async (req, res) => {
    const token = (req.body ?? {}).token;
    return ok(res, joinByInvite(token, req.userId));
  }),
);

export default router;
