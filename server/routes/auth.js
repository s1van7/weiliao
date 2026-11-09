/**
 * 认证相关路由：注册、登录。
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import { db, tx, now } from '../db.js';
import { ApiError, ok, wrap } from '../lib/http.js';
import { DEFAULT_AVATAR_COLOR, isPaletteColor, pickColor, publicUser } from '../lib/serialize.js';
import { clearFailures, getLockRemain, recordFailure, signToken } from '../auth.js';

const router = express.Router();

/** bcrypt 代价因子 */
const BCRYPT_COST = 10;
/** 用户名：4-16 位字母/数字/下划线 */
const USERNAME_PATTERN = /^[A-Za-z0-9_]{4,16}$/;
/** 手机号：1 开头共 11 位数字 */
const PHONE_PATTERN = /^1\d{10}$/;
/** 密码长度区间 */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 32;
/** 昵称长度（按字符数） */
const NICKNAME_MAX = 20;
/** 注册邀请码：取环境变量 INVITE_CODE；为空表示开放注册（不校验） */
const INVITE_CODE = (process.env.INVITE_CODE || '').trim().toLowerCase();

/**
 * 判断是否为 SQLite 唯一约束冲突。
 * @param {unknown} err
 * @returns {boolean}
 */
function isUniqueViolation(err) {
  const message = err && typeof err.message === 'string' ? err.message : '';
  return message.includes('UNIQUE constraint failed');
}

/**
 * 归一化字符串字段：非字符串一律视为空串。
 * @param {unknown} value
 * @returns {string}
 */
function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
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
 * 校验并归一化注册参数。
 * @param {Record<string, unknown>} body
 * @returns {{username: string|null, phone: string|null, password: string, nickname: string, avatarColor: string|null}}
 */
function validateRegisterPayload(body) {
  const username = asText(body.username);
  const phone = asText(body.phone);
  const password = typeof body.password === 'string' ? body.password : '';
  const nickname = asText(body.nickname);
  const rawColor = asText(body.avatar_color);
  const inviteCode = asText(body.invite_code).toLowerCase();

  // 邀请码先行校验：未持码者不应得到任何注册相关的探测反馈
  if (!inviteCode) {
    throw new ApiError(400, 'INVITE_REQUIRED', '请输入邀请码');
  }
  // 未配置 INVITE_CODE 时开放注册；配置后必须匹配（不区分大小写）
  if (INVITE_CODE && inviteCode !== INVITE_CODE) {
    throw new ApiError(403, 'INVITE_INVALID', '邀请码不正确');
  }

  if (!username && !phone) {
    throw new ApiError(400, 'INVALID_PARAM', '用户名和手机号至少填写一项');
  }
  if (username && !USERNAME_PATTERN.test(username)) {
    throw new ApiError(400, 'INVALID_PARAM', '用户名需为 4-16 位字母、数字或下划线');
  }
  if (phone && !PHONE_PATTERN.test(phone)) {
    throw new ApiError(400, 'INVALID_PARAM', '手机号格式不正确');
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new ApiError(400, 'INVALID_PARAM', `密码长度需在 ${PASSWORD_MIN}-${PASSWORD_MAX} 位之间`);
  }
  if (charLength(nickname) < 1 || charLength(nickname) > NICKNAME_MAX) {
    throw new ApiError(400, 'INVALID_PARAM', `昵称长度需在 1-${NICKNAME_MAX} 个字符之间`);
  }

  let avatarColor = null;
  if (rawColor) {
    if (!isPaletteColor(rawColor)) {
      throw new ApiError(400, 'INVALID_PARAM', '头像颜色不在允许的色板内');
    }
    avatarColor = rawColor.toUpperCase();
  }

  return {
    username: username || null,
    phone: phone || null,
    password,
    nickname,
    avatarColor,
  };
}

// 注册：创建用户并直接返回登录态
router.post(
  '/register',
  wrap(async (req, res) => {
    const payload = validateRegisterPayload(req.body ?? {});
    const passwordHash = await bcrypt.hash(payload.password, BCRYPT_COST);
    const createdAt = now();

    let userId = 0;
    try {
      userId = tx(() => {
        const inserted = db
          .prepare(
            `INSERT INTO users (username, phone, password_hash, nickname, signature, avatar_color, created_at)
             VALUES (?, ?, ?, ?, '', ?, ?)`,
          )
          .run(
            payload.username,
            payload.phone,
            passwordHash,
            payload.nickname,
            payload.avatarColor ?? DEFAULT_AVATAR_COLOR,
            createdAt,
          );

        const id = Number(inserted.lastInsertRowid);
        // 未指定颜色时按 id 从 8 色板取色，保证同一用户颜色稳定
        if (!payload.avatarColor) {
          db.prepare('UPDATE users SET avatar_color = ? WHERE id = ?').run(pickColor(id), id);
        }
        return id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ApiError(409, 'CONFLICT', '用户名或手机号已被注册');
      }
      throw err;
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    return ok(res, { token: signToken(userId), user: publicUser(user) });
  }),
);

// 登录：account 自动判断手机号 / 用户名
router.post(
  '/login',
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const account = asText(body.account);
    const password = typeof body.password === 'string' ? body.password : '';

    if (!account || !password) {
      throw new ApiError(400, 'INVALID_PARAM', '请输入账号和密码');
    }

    const lockedSeconds = getLockRemain(account);
    if (lockedSeconds > 0) {
      return res.status(423).json({
        ok: false,
        code: 'LOCKED',
        message: '登录失败次数过多，账号已临时锁定',
        retry_after: lockedSeconds,
      });
    }

    // 全数字 11 位按手机号查，否则按用户名查
    const isPhone = PHONE_PATTERN.test(account);
    const user = isPhone
      ? db.prepare('SELECT * FROM users WHERE phone = ?').get(account)
      : db.prepare('SELECT * FROM users WHERE username = ?').get(account);

    const passwordOk = user ? await bcrypt.compare(password, String(user.password_hash)) : false;
    if (!user || !passwordOk) {
      recordFailure(account);
      // 统一错误信息，不暴露账号是否存在
      throw new ApiError(401, 'AUTH_INVALID', '账号或密码错误');
    }

    clearFailures(account);
    return ok(res, { token: signToken(Number(user.id)), user: publicUser(user) });
  }),
);

export default router;
