/**
 * 认证模块：JWT 签发/校验、Bearer 中间件、登录失败限流（进程内 Map）。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { db, DATA_DIR } from './db.js';
import { ApiError } from './lib/http.js';

/** Token 算法与有效期 */
const JWT_ALGORITHM = 'HS256';
const JWT_TTL = '7d';
/** 密钥持久化文件 */
const SECRET_FILE = path.join(DATA_DIR, '.secret');

/**
 * 密钥来源优先级：环境变量 JWT_SECRET → data/.secret → 随机生成并落盘（权限 600）。
 * @returns {string}
 */
function loadSecret() {
  const fromEnv = typeof process.env.JWT_SECRET === 'string' ? process.env.JWT_SECRET.trim() : '';
  if (fromEnv) return fromEnv;

  try {
    const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // 文件不存在或不可读，继续生成新密钥
  }

  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  try {
    fs.chmodSync(SECRET_FILE, 0o600);
  } catch (err) {
    console.warn('[auth] chmod .secret failed:', err.message);
  }
  console.log('[auth] generated new JWT secret at', SECRET_FILE);
  return generated;
}

/** 实际使用的 JWT 密钥 */
export const JWT_SECRET = loadSecret();

/* ------------------------------------------------------------------ */
/* 登录失败限流：同一 account 15 分钟内失败 5 次 → 锁定 10 分钟          */
/* ------------------------------------------------------------------ */

const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_DURATION_MS = 10 * 60 * 1000;

/** account(小写) -> {count, firstAt, lockedUntil} */
const attemptStore = new Map();

/**
 * 限流键归一化（账号大小写不敏感，避免绕过）。
 * @param {unknown} account
 * @returns {string}
 */
function lockKey(account) {
  return String(account ?? '').trim().toLowerCase();
}

/**
 * 查询剩余锁定秒数。
 * @param {string} account
 * @returns {number} 0 表示未锁定
 */
export function getLockRemain(account) {
  const key = lockKey(account);
  const record = attemptStore.get(key);
  if (!record) return 0;

  const current = Date.now();
  if (record.lockedUntil > current) {
    return Math.ceil((record.lockedUntil - current) / 1000);
  }
  if (record.lockedUntil > 0 || current - record.firstAt > FAILURE_WINDOW_MS) {
    attemptStore.delete(key);
  }
  return 0;
}

/**
 * 记录一次登录失败，累计到阈值则锁定。
 * @param {string} account
 * @returns {number} 本次失败后的剩余锁定秒数（0 表示未锁定）
 */
export function recordFailure(account) {
  const key = lockKey(account);
  const current = Date.now();
  let record = attemptStore.get(key);

  const expired = record && record.lockedUntil === 0 && current - record.firstAt > FAILURE_WINDOW_MS;
  if (!record || expired) {
    record = { count: 0, firstAt: current, lockedUntil: 0 };
  }

  record.count += 1;
  if (record.count >= MAX_FAILURES) {
    record.lockedUntil = current + LOCK_DURATION_MS;
  }
  attemptStore.set(key, record);

  return record.lockedUntil > current ? Math.ceil((record.lockedUntil - current) / 1000) : 0;
}

/**
 * 登录成功后清零失败计数。
 * @param {string} account
 */
export function clearFailures(account) {
  attemptStore.delete(lockKey(account));
}

/* ------------------------------------------------------------------ */
/* JWT                                                                */
/* ------------------------------------------------------------------ */

/**
 * 签发访问令牌，sub 为字符串形式的用户 id。
 * @param {number|string} userId
 * @returns {string}
 */
export function signToken(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`signToken 需要合法的用户 id: ${userId}`);
  }
  return jwt.sign({ sub: String(id) }, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: JWT_TTL,
  });
}

/**
 * 校验令牌并取回用户行，任何失败都返回 null。
 * @param {string} token
 * @returns {Record<string, unknown>|null}
 */
export function userFromToken(token) {
  if (typeof token !== 'string' || token.length === 0) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    const id = Number(payload?.sub);
    if (!Number.isInteger(id) || id <= 0) return null;
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row) return null;
    return { ...row, id: Number(row.id) };
  } catch {
    return null;
  }
}

/**
 * 从请求头解析 Bearer token。
 * @param {import('express').Request} req
 * @returns {string} 没有则返回空字符串
 */
export function bearerToken(req) {
  const header = req.headers?.authorization ?? '';
  if (typeof header !== 'string') return '';
  const matched = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return matched ? matched[1] : '';
}

/**
 * 认证中间件：成功时挂载 req.user / req.userId，失败返回 401 AUTH_INVALID。
 * @type {import('express').RequestHandler}
 */
export function httpAuth(req, res, next) {
  const token = bearerToken(req);
  const user = token ? userFromToken(token) : null;
  if (!user) {
    return next(new ApiError(401, 'AUTH_INVALID', '登录状态已失效，请重新登录'));
  }
  req.user = user;
  req.userId = Number(user.id);
  return next();
}
