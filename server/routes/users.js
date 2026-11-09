/**
 * 用户相关路由：
 *   - /api/me        当前用户信息读取与更新（meRouter）
 *   - /api/users     用户搜索（usersRouter）
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import { db, now } from '../db.js';
import { httpAuth } from '../auth.js';
import { ApiError, ok, wrap } from '../lib/http.js';
import { emitToUsers } from '../lib/realtime.js';
import { isAvatarUrl, isPaletteColor, publicUser, toInt } from '../lib/serialize.js';
import { orderPair } from '../lib/pair.js';
import { isMediaUrl } from '../lib/media.js';
import { getOrCreateQrToken, refreshQrToken } from '../lib/qr.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { getNote } from '../lib/friendNotes.js';

/** 搜索返回条数上限 */
const SEARCH_LIMIT = 20;
/** 昵称长度上限 */
const NICKNAME_MAX = 20;
/** 个性签名长度上限 */
const SIGNATURE_MAX = 50;
/** 搜索关键词长度上限 */
const QUERY_MAX = 32;

/** 封面类型白名单 */
const COVER_TYPES = Object.freeze(new Set(['photo', 'live', 'video']));

/** 性别白名单 */
const GENDERS = Object.freeze(new Set(['', 'male', 'female', 'secret']));

/** 地区长度上限 */
const REGION_MAX = 30;

/** 用户名（微聊号）格式：与注册保持一致，4-16 位字母/数字/下划线 */
const USERNAME_PATTERN = /^[A-Za-z0-9_]{4,16}$/;

/** 用户名修改冷却期：一年仅可修改一次 */
const USERNAME_CHANGE_INTERVAL_MS = 365 * 24 * 60 * 60 * 1000;

/** 新密码长度区间（与注册时 auth 约定保持一致） */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 32;

/** 封面类型对应的合法扩展名 */
const COVER_EXT_BY_TYPE = Object.freeze({
  photo: ['jpg', 'jpeg', 'png', 'webp'],
  live: ['gif', 'mp4'],
  video: ['mp4'],
});

/**
 * 判断封面地址扩展名是否匹配封面类型。
 * @param {string} url 形如 /uploads/xxx.mp4
 * @param {string} type photo|live|video
 * @returns {boolean}
 */
function coverUrlMatchesType(url, type) {
  const allowed = COVER_EXT_BY_TYPE[type];
  if (!allowed) return false;
  const match = /\.([A-Za-z0-9]+)$/.exec(url);
  if (!match) return false;
  return allowed.includes(match[1].toLowerCase());
}

/**
 * 统计字符数（emoji 等代理对按 1 个字符计）。
 * @param {string} text
 * @returns {number}
 */
function charLength(text) {
  return [...text].length;
}

/**
 * 转义 SQL LIKE 中的通配符，配合 ESCAPE '\' 使用。
 * @param {string} text
 * @returns {string}
 */
function escapeLike(text) {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * 与我共处同一会话的其他成员 id（去重、排除自己），用于资料变更广播。
 * @param {number} userId
 * @returns {number[]}
 */
function peerMemberIds(userId) {
  const rows = db
    .prepare(
      `SELECT DISTINCT other.user_id AS user_id
         FROM conversation_members mine
         JOIN conversation_members other ON other.conversation_id = mine.conversation_id
        WHERE mine.user_id = ? AND other.user_id <> ?`,
    )
    .all(userId, userId);
  return rows.map((row) => Number(row.user_id));
}

/**
 * 计算当前用户与目标用户的关系。
 * 判定顺序与 /search 里的 relationOf 完全一致：self > friend > pending_out > pending_in > none。
 * @param {number} me 当前登录用户 id
 * @param {number} otherId 目标用户 id
 * @returns {'self'|'friend'|'pending_out'|'pending_in'|'none'}
 */
function relationOf(me, otherId) {
  if (otherId === me) return 'self';

  // friendships 是 user_low_id / user_high_id 无序对，需要双向匹配
  const isFriend = db
    .prepare(
      `SELECT 1 AS found
         FROM friendships
        WHERE (user_low_id = ? AND user_high_id = ?)
           OR (user_low_id = ? AND user_high_id = ?)
        LIMIT 1`,
    )
    .get(me, otherId, otherId, me);
  if (isFriend) return 'friend';

  const pendingOut = db
    .prepare(
      "SELECT 1 AS found FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending' LIMIT 1",
    )
    .get(me, otherId);
  if (pendingOut) return 'pending_out';

  const pendingIn = db
    .prepare(
      "SELECT 1 AS found FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending' LIMIT 1",
    )
    .get(otherId, me);
  if (pendingIn) return 'pending_in';

  return 'none';
}

/* ------------------------------------------------------------------ */
/* /api/me                                                            */
/* ------------------------------------------------------------------ */

export const meRouter = express.Router();
meRouter.use(httpAuth);

// 获取当前登录用户信息
meRouter.get(
  '/',
  wrap(async (req, res) => {
    return ok(res, { user: publicUser(req.user) });
  }),
);

// 更新当前用户资料（昵称 / 签名 / 头像颜色 / 自定义头像）
meRouter.patch(
  '/',
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const assignments = [];
    const params = [];

    if (body.nickname !== undefined) {
      const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
      if (charLength(nickname) < 1 || charLength(nickname) > NICKNAME_MAX) {
        throw new ApiError(400, 'INVALID_PARAM', `昵称长度需在 1-${NICKNAME_MAX} 个字符之间`);
      }
      assignments.push('nickname = ?');
      params.push(nickname);
    }

    // 用户名（微聊号）：一年只能改一次，改动后旧用户名立即失效（登录请用新用户名或手机号）
    if (body.username !== undefined) {
      if (typeof body.username !== 'string') {
        throw new ApiError(400, 'INVALID_PARAM', 'username 必须是字符串');
      }
      const nextUsername = body.username.trim();
      if (!USERNAME_PATTERN.test(nextUsername)) {
        throw new ApiError(400, 'INVALID_PARAM', '用户名需为 4-16 位字母、数字或下划线');
      }
      const currentUsername = String(req.user?.username ?? '');
      if (nextUsername === currentUsername) {
        throw new ApiError(400, 'INVALID_PARAM', '新用户名与当前用户名相同');
      }
      const changedAt = Number(req.user?.username_changed_at ?? 0) || 0;
      const nextAllowedAt = changedAt + USERNAME_CHANGE_INTERVAL_MS;
      if (changedAt > 0 && Date.now() < nextAllowedAt) {
        const daysLeft = Math.max(1, Math.ceil((nextAllowedAt - Date.now()) / (24 * 60 * 60 * 1000)));
        throw new ApiError(403, 'USERNAME_LOCKED', `用户名一年只能修改一次，还需 ${daysLeft} 天`);
      }
      const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id <> ?').get(nextUsername, req.userId);
      if (taken) {
        throw new ApiError(409, 'USERNAME_TAKEN', '该用户名已被占用');
      }
      assignments.push('username = ?', 'username_changed_at = ?');
      params.push(nextUsername, now());
    }

    if (body.signature !== undefined) {
      const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
      if (charLength(signature) > SIGNATURE_MAX) {
        throw new ApiError(400, 'INVALID_PARAM', `个性签名不能超过 ${SIGNATURE_MAX} 个字符`);
      }
      assignments.push('signature = ?');
      params.push(signature);
    }

    if (body.avatar_color !== undefined) {
      const rawColor = typeof body.avatar_color === 'string' ? body.avatar_color.trim() : '';
      if (!isPaletteColor(rawColor)) {
        throw new ApiError(400, 'INVALID_PARAM', '头像颜色不在允许的色板内');
      }
      assignments.push('avatar_color = ?');
      params.push(rawColor.toUpperCase());
    }

    if (body.avatar_url !== undefined) {
      // 只有字符串才是合法输入：数字 / 布尔等一律 400，避免被当成空串静默清除头像
      if (typeof body.avatar_url !== 'string') {
        throw new ApiError(400, 'INVALID_PARAM', 'avatar_url 必须是字符串');
      }
      const rawUrl = body.avatar_url.trim();
      // 空串表示清除自定义头像，回落到纯色头像
      if (rawUrl !== '' && !isAvatarUrl(rawUrl)) {
        throw new ApiError(400, 'INVALID_PARAM', '头像地址必须是 /uploads/ 下的图片路径');
      }
      assignments.push('avatar_url = ?');
      params.push(rawUrl);
    }

    // 封面：cover_url 空串 = 清除封面；非空必须匹配媒体地址白名单，且扩展名与 cover_type 对应
    if (body.cover_url !== undefined) {
      if (typeof body.cover_url !== 'string') {
        throw new ApiError(400, 'INVALID_PARAM', 'cover_url 必须是字符串');
      }
      const rawCoverUrl = body.cover_url.trim();
      if (rawCoverUrl !== '' && !isMediaUrl(rawCoverUrl)) {
        throw new ApiError(400, 'INVALID_PARAM', '封面地址必须是 /uploads/ 下的媒体路径');
      }
      assignments.push('cover_url = ?');
      params.push(rawCoverUrl);
    }

    if (body.cover_type !== undefined) {
      if (typeof body.cover_type !== 'string' || !COVER_TYPES.has(body.cover_type)) {
        throw new ApiError(400, 'INVALID_PARAM', 'cover_type 取值不合法');
      }
      const coverType = body.cover_type;
      const coverUrl = body.cover_url !== undefined ? String(body.cover_url).trim() : String(req.user?.cover_url ?? '');
      if (coverUrl !== '' && !coverUrlMatchesType(coverUrl, coverType)) {
        throw new ApiError(400, 'INVALID_PARAM', '封面地址扩展名与 cover_type 不匹配');
      }
      assignments.push('cover_type = ?');
      params.push(coverType);
    } else if (body.cover_url !== undefined) {
      // 只传 cover_url 时，若清除封面则回退为 photo；否则保留原类型并校验扩展名
      const coverUrl = String(body.cover_url).trim();
      const coverType = coverUrl === '' ? 'photo' : String(req.user?.cover_type ?? 'photo');
      if (coverUrl !== '' && !coverUrlMatchesType(coverUrl, coverType)) {
        throw new ApiError(400, 'INVALID_PARAM', '封面地址扩展名与当前 cover_type 不匹配');
      }
      assignments.push('cover_type = ?');
      params.push(coverType);
    }

    if (body.gender !== undefined) {
      if (typeof body.gender !== 'string' || !GENDERS.has(body.gender)) {
        throw new ApiError(400, 'INVALID_PARAM', "gender 仅支持 ''、male、female 或 secret");
      }
      assignments.push('gender = ?');
      params.push(body.gender);
    }

    if (body.region !== undefined) {
      if (typeof body.region !== 'string') {
        throw new ApiError(400, 'INVALID_PARAM', 'region 必须是字符串');
      }
      const region = body.region.trim();
      if (charLength(region) > REGION_MAX) {
        throw new ApiError(400, 'INVALID_PARAM', `地区不能超过 ${REGION_MAX} 个字符`);
      }
      assignments.push('region = ?');
      params.push(region);
    }

    if (assignments.length === 0) {
      throw new ApiError(400, 'INVALID_PARAM', '没有可更新的字段');
    }

    params.push(req.userId);
    db.prepare(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    const user = publicUser(updated);

    // 资料（昵称 / 签名 / 头像）已落库并提交，此时才广播给同会话的其他成员，
    // 让他们本地的好友列表、会话 peer、已渲染消息的头像/昵称一起刷新。
    emitToUsers(peerMemberIds(Number(req.userId)), 'user:update', { user });

    return ok(res, { user });
  }),
);

// 修改密码：校验旧密码，设置新密码（8-32 位）
meRouter.post(
  '/password',
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const oldPassword = typeof body.old_password === 'string' ? body.old_password : '';
    const newPassword = typeof body.new_password === 'string' ? body.new_password : '';

    if (!oldPassword || !newPassword) {
      throw new ApiError(400, 'INVALID_PARAM', '请输入旧密码与新密码');
    }
    if (newPassword.length < PASSWORD_MIN || newPassword.length > PASSWORD_MAX) {
      throw new ApiError(400, 'INVALID_PARAM', `新密码长度需在 ${PASSWORD_MIN}-${PASSWORD_MAX} 位之间`);
    }

    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.userId);
    const oldOk = row ? await bcrypt.compare(oldPassword, String(row.password_hash)) : false;
    if (!oldOk) {
      throw new ApiError(401, 'AUTH_INVALID', '旧密码不正确');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, req.userId);
    return ok(res, {});
  }),
);

// 读取用户设置
meRouter.get(
  '/settings',
  wrap(async (req, res) => {
    return ok(res, { settings: getSettings(req.userId) });
  }),
);

// 更新用户设置（接受任意子集）
meRouter.patch(
  '/settings',
  wrap(async (req, res) => {
    const settings = updateSettings(req.userId, req.body ?? {});
    return ok(res, { settings });
  }),
);

// 我的二维码：复用有效 token 或新建
meRouter.get(
  '/qr',
  wrap(async (req, res) => {
    return ok(res, getOrCreateQrToken(req.userId));
  }),
);

// 刷新二维码：吊销旧 token 并签发新 token
meRouter.post(
  '/qr/refresh',
  wrap(async (req, res) => {
    return ok(res, refreshQrToken(req.userId));
  }),
);

/* ------------------------------------------------------------------ */
/* /api/users                                                         */
/* ------------------------------------------------------------------ */

export const usersRouter = express.Router();
usersRouter.use(httpAuth);

// 搜索用户：username/phone 精确匹配 + nickname 模糊匹配
usersRouter.get(
  '/search',
  wrap(async (req, res) => {
    const me = req.userId;
    const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!rawQuery) {
      return ok(res, { users: [] });
    }

    const keyword = rawQuery.slice(0, QUERY_MAX);
    const likePattern = `%${escapeLike(keyword)}%`;

    const rows = db
      .prepare(
        `SELECT id, username, phone, nickname, signature, avatar_color, avatar_url, gender, region
           FROM users
          WHERE id <> ?
            AND (username = ? OR phone = ? OR nickname LIKE ? ESCAPE '\\')
          ORDER BY
            CASE WHEN username = ? THEN 0 WHEN phone = ? THEN 1 ELSE 2 END,
            nickname COLLATE NOCASE ASC,
            id ASC
          LIMIT ?`,
      )
      .all(me, keyword, keyword, likePattern, keyword, keyword, SEARCH_LIMIT);

    if (rows.length === 0) {
      return ok(res, { users: [] });
    }

    // 关系集合一次算好，避免逐条查库
    const friendIds = new Set(
      db
        .prepare(
          `SELECT user_high_id AS other_id FROM friendships WHERE user_low_id = ?
           UNION
           SELECT user_low_id AS other_id FROM friendships WHERE user_high_id = ?`,
        )
        .all(me, me)
        .map((row) => Number(row.other_id)),
    );
    const pendingOut = new Set(
      db
        .prepare("SELECT to_user_id AS other_id FROM friend_requests WHERE from_user_id = ? AND status = 'pending'")
        .all(me)
        .map((row) => Number(row.other_id)),
    );
    const pendingIn = new Set(
      db
        .prepare("SELECT from_user_id AS other_id FROM friend_requests WHERE to_user_id = ? AND status = 'pending'")
        .all(me)
        .map((row) => Number(row.other_id)),
    );

    /**
     * 计算当前用户与目标用户的关系。
     * @param {number} otherId
     * @returns {'self'|'friend'|'pending_out'|'pending_in'|'none'}
     */
    const relationOf = (otherId) => {
      if (otherId === me) return 'self';
      if (friendIds.has(otherId)) return 'friend';
      if (pendingOut.has(otherId)) return 'pending_out';
      if (pendingIn.has(otherId)) return 'pending_in';
      return 'none';
    };

    const users = rows.map((row) => {
      const serialized = publicUser(row);
      return { ...serialized, relation: relationOf(serialized.id) };
    });

    return ok(res, { users });
  }),
);

// 查看指定用户资料：任何登录用户都可查（群聊里点非好友头像需要），仅走 httpAuth。
// 注意：/search 是静态段，注册在本路由之前，因此 Express 会优先匹配 /search，不会落到 /:id。
usersRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const me = req.userId;
    const targetId = toInt(req.params.id);
    if (!targetId) {
      throw new ApiError(404, 'NOT_FOUND', '用户不存在');
    }

    const row = db
      .prepare(
        'SELECT id, username, phone, nickname, signature, avatar_color, avatar_url, cover_url, cover_type, gender, region FROM users WHERE id = ?',
      )
      .get(targetId);
    if (!row) {
      throw new ApiError(404, 'NOT_FOUND', '用户不存在');
    }

    const user = publicUser(row);
    const relation = relationOf(me, user.id);
    // 仅好友可见备注；非好友不返回备注字段内容
    const note = relation === 'friend' ? getNote(me, user.id) : null;

    // 好友态补充「添加日期」（friendships.created_at）与「共同群聊」
    let addedAt = null;
    if (relation === 'friend') {
      const [low, high] = orderPair(me, user.id);
      const friendship = db
        .prepare('SELECT created_at FROM friendships WHERE user_low_id = ? AND user_high_id = ?')
        .get(low, high);
      addedAt = friendship ? Number(friendship.created_at) : null;
    }

    const commonGroups = db
      .prepare(
        `SELECT c.id, c.name, COUNT(cm.user_id) AS member_count
           FROM conversations c
           JOIN conversation_members cm ON cm.conversation_id = c.id
          WHERE c.type = 'group'
            AND c.id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?)
            AND c.id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?)
          GROUP BY c.id
          ORDER BY c.id DESC`,
      )
      .all(me, targetId)
      .map((group) => ({
        id: Number(group.id),
        name: group.name ?? '',
        member_count: Number(group.member_count),
      }));

    return ok(res, {
      user,
      relation,
      remark_name: note ? note.remark_name : '',
      remark_phone: note ? note.remark_phone : '',
      // 星标朋友：好友信息页的「设为星标朋友」开关回显
      starred: note ? note.starred === true : false,
      added_at: addedAt,
      common_groups: commonGroups,
    });
  }),
);
