/**
 * 通话 ICE 路由：
 *   GET /api/rtc-config  （httpAuth）→ {ice_servers:[STUN, TURN?]}
 */
import express from 'express';
import { httpAuth } from '../auth.js';
import { ok, wrap } from '../lib/http.js';
import { buildIceServers } from '../lib/rtc.js';

const router = express.Router();

router.get(
  '/rtc-config',
  httpAuth,
  wrap(async (req, res) => {
    return ok(res, buildIceServers(req.userId));
  }),
);

export default router;
