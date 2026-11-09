/**
 * 二维码解析路由：
 *   POST /api/qr/resolve   {token}（也接受二维码 URL 末段）→ {user, relation}
 *
 * 注意：我的二维码生成 / 刷新接口挂在 /api/me/qr（见 routes/users.js）。
 */
import express from 'express';
import { db } from '../db.js';
import { httpAuth } from '../auth.js';
import { ApiError, ok, wrap } from '../lib/http.js';
import { publicUser } from '../lib/serialize.js';
import { resolveQrToken } from '../lib/qr.js';

const router = express.Router();
router.use(httpAuth);

/**
 * 计算当前用户与目标用户的关系（与 routes/users.js 的 relationOf 保持一致）。
 * @param {number} me
 * @param {number} otherId
 * @returns {'self'|'friend'|'pending_out'|'pending_in'|'none'}
 */
function relationOf(me, otherId) {
  if (otherId === me) return 'self';

  const isFriend = db
    .prepare(
      `SELECT 1 AS found FROM friendships
        WHERE (user_low_id = ? AND user_high_id = ?)
           OR (user_low_id = ? AND user_high_id = ?)
        LIMIT 1`,
    )
    .get(me, otherId, otherId, me);
  if (isFriend) return 'friend';

  const pendingOut = db
    .prepare("SELECT 1 AS found FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending' LIMIT 1")
    .get(me, otherId);
  if (pendingOut) return 'pending_out';

  const pendingIn = db
    .prepare("SELECT 1 AS found FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending' LIMIT 1")
    .get(otherId, me);
  if (pendingIn) return 'pending_in';

  return 'none';
}

// 解析二维码令牌 → 目标用户资料 + 与当前用户的关系
router.post(
  '/resolve',
  wrap(async (req, res) => {
    const token = (req.body ?? {}).token;
    const row = resolveQrToken(token);
    if (!row) {
      throw new ApiError(404, 'QR_INVALID', '二维码无效或已失效');
    }

    const targetId = Number(row.user_id);
    const userRow = db
      .prepare('SELECT id, username, phone, nickname, signature, avatar_color, avatar_url, cover_url, cover_type FROM users WHERE id = ?')
      .get(targetId);
    if (!userRow) {
      throw new ApiError(404, 'QR_INVALID', '二维码无效或已失效');
    }

    return ok(res, { user: publicUser(userRow), relation: relationOf(req.userId, targetId) });
  }),
);

export default router;
