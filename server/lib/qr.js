/**
 * 二维码令牌领域服务：签发、复用、刷新（吊销旧 token）、解析。
 *
 * 令牌规则：crypto.randomBytes(24).toString('base64url')；
 * expires_at = 0 表示长期有效；有效条件 revoked=0 AND (expires_at=0 OR expires_at>now())。
 */
import crypto from 'node:crypto';
import { db, now, tx } from '../db.js';
import { toInt } from './serialize.js';

/**
 * 生成一个新的二维码令牌。
 * @returns {string}
 */
export function newQrToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * 序列化 token 行为对外结构。
 * @param {Record<string, unknown>} row user_qr_tokens 行
 * @returns {{token:string, qr_content:string, expires_at:number, revoked:boolean}}
 */
function toShape(row) {
  return {
    token: String(row.token ?? ''),
    qr_content: String(row.token ?? ''),
    expires_at: Number(row.expires_at ?? 0),
    revoked: Number(row.revoked ?? 0) === 1,
  };
}

/**
 * 查询某用户当前有效的 token 行（最新一条）。
 * @param {number|string} userId
 * @returns {Record<string, unknown>|null}
 */
export function findValidTokenByUser(userId) {
  const uid = toInt(userId, 0);
  if (uid <= 0) return null;
  return (
    db
      .prepare(
        `SELECT * FROM user_qr_tokens
          WHERE user_id = ? AND revoked = 0 AND (expires_at = 0 OR expires_at > ?)
          ORDER BY id DESC LIMIT 1`,
      )
      .get(uid, now()) ?? null
  );
}

/**
 * 签发一条 token 并落库。
 * @param {number|string} userId 用户 id
 * @param {{expiresAt?: number}} [options] expiresAt 缺省 0（长期有效）
 * @returns {Record<string, unknown>} 新 token 行
 */
export function issueQrToken(userId, options = {}) {
  const uid = toInt(userId, 0);
  if (uid <= 0) {
    throw new Error(`issueQrToken 需要合法的用户 id: ${userId}`);
  }
  const expiresAt = toInt(options.expiresAt, 0) > 0 ? toInt(options.expiresAt, 0) : 0;
  const createdAt = now();
  const token = newQrToken();

  return tx(() => {
    db.prepare(
      `INSERT INTO user_qr_tokens (user_id, token, expires_at, revoked, created_at)
       VALUES (?, ?, ?, 0, ?)`,
    ).run(uid, token, expiresAt, createdAt);
    return db.prepare('SELECT * FROM user_qr_tokens WHERE token = ?').get(token);
  });
}

/**
 * 复用有效 token，否则新建。
 * @param {number|string} userId
 * @returns {{token:string, qr_content:string, expires_at:number, revoked:boolean}}
 */
export function getOrCreateQrToken(userId) {
  const existing = findValidTokenByUser(userId);
  if (existing) return toShape(existing);
  return toShape(issueQrToken(userId));
}

/**
 * 吊销旧 token 并签发新 token。
 * @param {number|string} userId
 * @returns {{token:string, qr_content:string, expires_at:number, revoked:boolean}}
 */
export function refreshQrToken(userId) {
  const uid = toInt(userId, 0);
  tx(() => {
    db.prepare('UPDATE user_qr_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0').run(uid);
  });
  return toShape(issueQrToken(uid));
}

/**
 * 从入参提取 token：兼容「直接传 token」与「传二维码 URL（取末段）」。
 * @param {unknown} raw
 * @returns {string}
 */
export function extractToken(raw) {
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  if (!value) return '';
  const segment = value.split('/').filter(Boolean).pop() ?? '';
  return segment;
}

/**
 * 解析 token 行（未命中 / 已吊销 / 已过期统一返回 null）。
 * @param {unknown} raw token 或二维码 URL
 * @returns {Record<string, unknown>|null} user_qr_tokens 行
 */
export function resolveQrToken(raw) {
  const token = extractToken(raw);
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT * FROM user_qr_tokens
          WHERE token = ? AND revoked = 0 AND (expires_at = 0 OR expires_at > ?)
          LIMIT 1`,
      )
      .get(token, now()) ?? null
  );
}

export default { newQrToken, findValidTokenByUser, issueQrToken, getOrCreateQrToken, refreshQrToken, extractToken, resolveQrToken };
