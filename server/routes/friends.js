/**
 * 好友相关路由：申请、处理申请、好友列表、删除好友、待处理计数。
 * 申请 / 同意 / 拒绝成功后通过 realtime 向对方 user:{id} 房间推送实时事件。
 */
import express from 'express';
import { db, tx, now } from '../db.js';
import { httpAuth } from '../auth.js';
import { ApiError, ok, wrap } from '../lib/http.js';
import { orderPair } from '../lib/pair.js';
import { publicUser, toInt } from '../lib/serialize.js';
import { areFriends, ensurePairConversation } from '../lib/conversations.js';
import { getPermission, setPermission } from '../lib/friendPermissions.js';
import { emitToUser, isOnline } from '../lib/realtime.js';
import { getSettings } from '../lib/settings.js';
import { resolveQrToken } from '../lib/qr.js';
import { clearRemarks, setStarred, upsertNote } from '../lib/friendNotes.js';

const router = express.Router();
router.use(httpAuth);

/** 被拒绝后再次申请的冷却时间 */
const REJECT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** 申请附言长度上限 */
const REQUEST_MESSAGE_MAX = 50;
/** 备注名长度上限 */
const REMARK_NAME_MAX = 20;
/** 备注手机号格式 */
const REMARK_PHONE_PATTERN = /^1\d{10}$/;
/** 申请列表返回条数上限 */
const REQUEST_LIST_LIMIT = 100;
/** 允许的申请状态过滤值 */
const ALLOWED_STATUS = new Set(['pending', 'accepted', 'rejected', 'all']);

// 发送好友申请
router.post(
  '/requests',
  wrap(async (req, res) => {
    const me = req.userId;
    const body = req.body ?? {};
    const toUserId = toInt(body.to_user_id);

    if (!toUserId) {
      throw new ApiError(400, 'INVALID_PARAM', 'to_user_id 不合法');
    }
    if (toUserId === me) {
      throw new ApiError(400, 'INVALID_PARAM', '不能向自己发送好友申请');
    }

    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(toUserId);
    if (!target) {
      throw new ApiError(404, 'NOT_FOUND', '目标用户不存在');
    }

    let message = typeof body.message === 'string' ? body.message.trim() : '';
    if ([...message].length > REQUEST_MESSAGE_MAX) {
      throw new ApiError(400, 'INVALID_PARAM', `申请附言不能超过 ${REQUEST_MESSAGE_MAX} 个字符`);
    }
    message = [...message].slice(0, REQUEST_MESSAGE_MAX).join('');

    if (areFriends(me, toUserId)) {
      throw new ApiError(409, 'CONFLICT', '你们已经是好友了');
    }

    // 同方向已有 pending：幂等返回原申请
    const sameDirection = db
      .prepare(
        "SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
      )
      .get(me, toUserId);
    if (sameDirection) {
      return ok(res, { request_id: Number(sameDirection.id) });
    }

    // 反方向已有 pending：提示对方已发申请
    const reverseDirection = db
      .prepare(
        "SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
      )
      .get(toUserId, me);
    if (reverseDirection) {
      throw new ApiError(409, 'CONFLICT', '对方已向你发送申请');
    }

    // 24 小时内被拒绝过：冷却中
    const lastRejected = db
      .prepare(
        "SELECT updated_at FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'rejected' ORDER BY updated_at DESC LIMIT 1",
      )
      .get(me, toUserId);
    if (lastRejected && now() - Number(lastRejected.updated_at) < REJECT_COOLDOWN_MS) {
      throw new ApiError(409, 'CONFLICT', '请 24 小时后再试');
    }

    // 加好友方式强制校验（在既有校验后、写入前）：
    //   invite_only  → 一律拒绝；
    //   qrcode_only  → 必须携带目标用户本人的有效二维码 token；
    //   all          → 正常放行。
    const targetSettings = getSettings(toUserId);
    const friendRequestMode = targetSettings.friend_request_mode ?? 'all';
    if (friendRequestMode === 'invite_only') {
      throw new ApiError(403, 'INVITE_ONLY', '对方只接受邀请添加，暂不接受好友申请');
    }
    if (friendRequestMode === 'qrcode_only') {
      const qrRow = resolveQrToken(body.qr_token);
      if (!qrRow || Number(qrRow.user_id) !== toUserId) {
        throw new ApiError(403, 'QR_REQUIRED', '对方仅支持扫码添加，请使用对方的名片二维码');
      }
    }

    const timestamp = now();
    const inserted = db
      .prepare(
        `INSERT INTO friend_requests (from_user_id, to_user_id, message, status, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?)`,
      )
      .run(me, toUserId, message, timestamp, timestamp);

    const requestId = Number(inserted.lastInsertRowid);

    // 事务已提交（单条写入），此时才推送实时事件；io 未就绪时静默跳过
    emitToUser(toUserId, 'friend:request', {
      request_id: requestId,
      message,
      created_at: timestamp,
      from_user: publicUser(req.user),
    });

    return ok(res, { request_id: requestId });
  }),
);

// 待处理申请数量（必须声明在其他 /requests 路由之前，避免路径歧义）
router.get(
  '/requests/count',
  wrap(async (req, res) => {
    const row = db
      .prepare("SELECT COUNT(*) AS total FROM friend_requests WHERE to_user_id = ? AND status = 'pending'")
      .get(req.userId);
    return ok(res, { count: Number(row?.total ?? 0) });
  }),
);

// 申请列表：direction=in|out，status=pending|accepted|rejected|all
router.get(
  '/requests',
  wrap(async (req, res) => {
    const me = req.userId;
    const direction = req.query.direction === 'out' ? 'out' : 'in';
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : 'pending';
    if (!ALLOWED_STATUS.has(status)) {
      throw new ApiError(400, 'INVALID_PARAM', 'status 参数不合法');
    }

    const sql =
      direction === 'in'
        ? `SELECT r.id, r.message, r.status, r.created_at, r.updated_at, r.from_user_id AS other_id
             FROM friend_requests r
            WHERE r.to_user_id = ? AND (? = 'all' OR r.status = ?)
            ORDER BY r.created_at DESC, r.id DESC
            LIMIT ?`
        : `SELECT r.id, r.message, r.status, r.created_at, r.updated_at, r.to_user_id AS other_id
             FROM friend_requests r
            WHERE r.from_user_id = ? AND (? = 'all' OR r.status = ?)
            ORDER BY r.created_at DESC, r.id DESC
            LIMIT ?`;

    const rows = db.prepare(sql).all(me, status, status, REQUEST_LIST_LIMIT);

    const otherIds = [...new Set(rows.map((row) => Number(row.other_id)))];
    const userMap = new Map();
    if (otherIds.length > 0) {
      const placeholders = otherIds.map(() => '?').join(', ');
      const userRows = db
        .prepare(
          `SELECT id, username, phone, nickname, signature, avatar_color, avatar_url FROM users WHERE id IN (${placeholders})`,
        )
        .all(...otherIds);
      for (const userRow of userRows) {
        userMap.set(Number(userRow.id), publicUser(userRow));
      }
    }

    // 已通过条目补充「通过时间」：数据源为 friendships.created_at
    const acceptedMap = new Map();
    const acceptedOtherIds = rows
      .filter((row) => row.status === 'accepted')
      .map((row) => Number(row.other_id));
    if (acceptedOtherIds.length > 0) {
      const placeholders = acceptedOtherIds.map(() => '?').join(', ');
      const friendshipRows = db
        .prepare(
          `SELECT user_high_id AS other_id, created_at FROM friendships WHERE user_low_id = ? AND user_high_id IN (${placeholders})
           UNION ALL
           SELECT user_low_id AS other_id, created_at FROM friendships WHERE user_high_id = ? AND user_low_id IN (${placeholders})`,
        )
        .all(me, ...acceptedOtherIds, me, ...acceptedOtherIds);
      for (const friendshipRow of friendshipRows) {
        acceptedMap.set(Number(friendshipRow.other_id), Number(friendshipRow.created_at));
      }
    }

    const requests = rows.map((row) => {
      const otherId = Number(row.other_id);
      return {
        id: Number(row.id),
        direction,
        message: row.message ?? '',
        status: row.status,
        created_at: Number(row.created_at),
        updated_at: Number(row.updated_at ?? row.created_at),
        accepted_at: row.status === 'accepted' ? (acceptedMap.get(otherId) ?? null) : null,
        user: userMap.get(otherId) ?? null,
      };
    });

    return ok(res, { requests });
  }),
);

// 接受好友申请：写 friendships + 幂等创建单聊会话
router.post(
  '/requests/:id/accept',
  wrap(async (req, res) => {
    const me = req.userId;
    const requestId = toInt(req.params.id);
    if (!requestId) {
      throw new ApiError(400, 'INVALID_PARAM', '申请 id 不合法');
    }

    const outcome = tx(() => {
      const request = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(requestId);
      if (!request) {
        throw new ApiError(404, 'NOT_FOUND', '好友申请不存在');
      }
      if (Number(request.to_user_id) !== me) {
        throw new ApiError(403, 'FORBIDDEN', '无权处理该好友申请');
      }
      if (request.status === 'rejected') {
        throw new ApiError(409, 'CONFLICT', '该申请已被拒绝');
      }

      const fromUserId = Number(request.from_user_id);
      if (request.status !== 'accepted') {
        db.prepare('UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?').run('accepted', now(), requestId);
      }

      const [low, high] = orderPair(fromUserId, me);
      db.prepare('INSERT OR IGNORE INTO friendships (user_low_id, user_high_id, created_at) VALUES (?, ?, ?)').run(
        low,
        high,
        now(),
      );

      return { conversationId: ensurePairConversation(low, high), fromUserId };
    });

    // 提交后推送：通知申请发起方「已被同意」以及新的单聊会话
    emitToUser(outcome.fromUserId, 'friend:accepted', {
      request_id: requestId,
      conversation_id: outcome.conversationId,
      user: publicUser(req.user),
    });

    return ok(res, { conversation_id: outcome.conversationId });
  }),
);

// 拒绝好友申请
router.post(
  '/requests/:id/reject',
  wrap(async (req, res) => {
    const me = req.userId;
    const requestId = toInt(req.params.id);
    if (!requestId) {
      throw new ApiError(400, 'INVALID_PARAM', '申请 id 不合法');
    }

    const request = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(requestId);
    if (!request) {
      throw new ApiError(404, 'NOT_FOUND', '好友申请不存在');
    }
    if (Number(request.to_user_id) !== me) {
      throw new ApiError(403, 'FORBIDDEN', '无权处理该好友申请');
    }
    if (request.status !== 'pending') {
      throw new ApiError(409, 'CONFLICT', '该申请已处理，无法重复操作');
    }

    db.prepare('UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?').run('rejected', now(), requestId);

    // 提交后推送：通知申请发起方「已被拒绝」
    emitToUser(Number(request.from_user_id), 'friend:rejected', {
      request_id: requestId,
      user: publicUser(req.user),
    });

    return ok(res, {});
  }),
);

// 好友列表（按昵称排序，conversation_id 通过 pair_key 关联）
router.get(
  '/',
  wrap(async (req, res) => {
    const me = req.userId;
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.phone, u.nickname, u.signature, u.avatar_color, u.avatar_url,
                c.id AS conversation_id,
                fn.remark_name AS remark_name, fn.remark_phone AS remark_phone, fn.starred AS starred
           FROM friendships f
           JOIN users u
             ON u.id = CASE WHEN f.user_low_id = ? THEN f.user_high_id ELSE f.user_low_id END
           LEFT JOIN conversations c
             ON c.type = 'single'
            AND c.pair_key = printf('%d:%d', f.user_low_id, f.user_high_id)
           LEFT JOIN friend_notes fn
             ON fn.owner_id = ? AND fn.friend_id = u.id
          WHERE f.user_low_id = ? OR f.user_high_id = ?
          -- 星标朋友排最前（前端还要按拼音首字母分组，这里先保证星标优先的整体顺序）
          ORDER BY COALESCE(fn.starred, 0) DESC, u.nickname COLLATE NOCASE ASC, u.id ASC`,
      )
      .all(me, me, me, me);

    const friends = rows.map((row) => {
      const serialized = publicUser(row);
      const remarkName = String(row.remark_name ?? '').trim();
      const remarkPhone = String(row.remark_phone ?? '');
      return {
        ...serialized,
        conversation_id: row.conversation_id === null || row.conversation_id === undefined ? null : Number(row.conversation_id),
        remark_name: remarkName,
        remark_phone: remarkPhone,
        // 星标朋友：通讯录里排在字母分组之前
        starred: Number(row.starred ?? 0) === 1,
        display_name: remarkName || serialized.nickname,
        // 在线状态由 realtime 注入的 presence 查询函数提供（io 未启动时恒为 false）
        online: isOnline(serialized.id),
      };
    });

    return ok(res, { friends });
  }),
);

// 读取「我对该好友」的朋友权限（生效值）
router.get(
  '/:user_id/permission',
  wrap(async (req, res) => {
    const me = req.userId;
    const targetId = toInt(req.params.user_id);
    if (!targetId) {
      throw new ApiError(400, 'INVALID_PARAM', '用户 id 不合法');
    }
    if (targetId === me) {
      throw new ApiError(400, 'INVALID_PARAM', '不能查看自己的朋友权限');
    }
    if (!areFriends(me, targetId)) {
      throw new ApiError(403, 'NOT_FRIEND', '只能查看好友的朋友权限');
    }
    return ok(res, { permission: getPermission(me, targetId) });
  }),
);

// 更新「我对该好友」的朋友权限（字段可选布尔，缺失不改动）
router.put(
  '/:user_id/permission',
  wrap(async (req, res) => {
    const me = req.userId;
    const targetId = toInt(req.params.user_id);
    if (!targetId) {
      throw new ApiError(400, 'INVALID_PARAM', '用户 id 不合法');
    }
    if (targetId === me) {
      throw new ApiError(400, 'INVALID_PARAM', '不能设置自己的朋友权限');
    }
    if (!areFriends(me, targetId)) {
      throw new ApiError(403, 'NOT_FRIEND', '只能设置好友的朋友权限');
    }

    const body = req.body ?? {};
    const patch = {};
    for (const key of ['hide_my_moments', 'hide_his_moments', 'chat_only', 'blocked']) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'boolean') {
          throw new ApiError(400, 'INVALID_PARAM', `${key} 必须是布尔值`);
        }
        patch[key] = body[key];
      }
    }
    if (Object.keys(patch).length === 0) {
      throw new ApiError(400, 'INVALID_PARAM', '没有可更新的字段');
    }

    return ok(res, { permission: setPermission(me, targetId, patch) });
  }),
);

// 设置好友备注（remark_name / remark_phone）；两者均空 = 删除备注行
router.put(
  '/:user_id/note',
  wrap(async (req, res) => {
    const me = req.userId;
    const targetId = toInt(req.params.user_id);
    if (!targetId) {
      throw new ApiError(400, 'INVALID_PARAM', '用户 id 不合法');
    }
    if (targetId === me) {
      throw new ApiError(400, 'INVALID_PARAM', '不能给自己设置备注');
    }
    if (!areFriends(me, targetId)) {
      throw new ApiError(403, 'NOT_FRIEND', '只能给好友设置备注');
    }

    const body = req.body ?? {};
    const remarkName = typeof body.remark_name === 'string' ? body.remark_name.trim() : '';
    const remarkPhone = typeof body.remark_phone === 'string' ? body.remark_phone.trim() : '';

    if ([...remarkName].length > REMARK_NAME_MAX) {
      throw new ApiError(400, 'INVALID_PARAM', `备注名不能超过 ${REMARK_NAME_MAX} 个字符`);
    }
    if (remarkPhone !== '' && !REMARK_PHONE_PATTERN.test(remarkPhone)) {
      throw new ApiError(400, 'INVALID_PARAM', '备注手机号格式不正确');
    }

    let note;
    if (remarkName === '' && remarkPhone === '') {
      // 备注双空：清空备注字段，但星标仍为 1 时保留这一行（星标不能被备注操作顺手抹掉）
      note = clearRemarks(me, targetId);
    } else {
      note = upsertNote(me, targetId, { remark_name: remarkName, remark_phone: remarkPhone });
    }

    return ok(res, { note });
  }),
);

// 设置 / 取消星标朋友：星标好友在通讯录排最前
router.put(
  '/:user_id/star',
  wrap(async (req, res) => {
    const me = req.userId;
    const targetId = toInt(req.params.user_id);
    if (!targetId) {
      throw new ApiError(400, 'INVALID_PARAM', '用户 id 不合法');
    }
    if (targetId === me) {
      throw new ApiError(400, 'INVALID_PARAM', '不能给自己设置星标');
    }
    if (!areFriends(me, targetId)) {
      throw new ApiError(403, 'NOT_FRIEND', '只能给好友设置星标');
    }
    if (typeof req.body?.starred !== 'boolean') {
      throw new ApiError(400, 'INVALID_PARAM', 'starred 必须是布尔值');
    }

    const note = setStarred(me, targetId, req.body.starred);
    return ok(res, { note });
  }),
);

// 删除好友：只断开好友关系，保留会话与历史消息
router.delete(
  '/:user_id',
  wrap(async (req, res) => {
    const me = req.userId;
    const targetId = toInt(req.params.user_id);
    if (!targetId) {
      throw new ApiError(400, 'INVALID_PARAM', '用户 id 不合法');
    }
    if (targetId === me) {
      throw new ApiError(400, 'INVALID_PARAM', '不能删除自己');
    }

    const [low, high] = orderPair(me, targetId);
    db.prepare('DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?').run(low, high);
    return ok(res, {});
  }),
);

export default router;
