/**
 * 语音转文字路由：
 *   POST /api/voice/transcribe  （httpAuth）→ {text, message_id}
 */
import express from 'express';
import { httpAuth } from '../auth.js';
import { ok, wrap } from '../lib/http.js';
import { transcribe } from '../lib/asr.js';

const router = express.Router();

router.post(
  '/voice/transcribe',
  httpAuth,
  wrap(async (req, res) => {
    const result = await transcribe(req.body ?? {}, req.userId);
    return ok(res, result);
  }),
);

export default router;
