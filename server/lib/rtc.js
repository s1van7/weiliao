/**
 * TURN 动态凭证：为每个用户现算 HMAC 临时凭证（coturn static-auth-secret）。
 *
 * 约定：
 *   - username = "<expiry_epoch_seconds>:<userId>"；
 *   - credential = base64(hmac-sha1(TURN_SECRET, username))；
 *   - ttl 24h；TURN_SECRET 未配置时只返回 STUN（不接 TURN 兜底）。
 */
import crypto from 'node:crypto';
import { toInt } from './serialize.js';

/** TURN 凭证有效期（秒，24 小时） */
const TURN_TTL_SECONDS = 24 * 60 * 60;

/** 默认 STUN 兜底 */
const STUN_SERVER = Object.freeze({ urls: 'stun:stun.l.google.com:19302' });

/**
 * 生成 ICE 服务器列表。
 * @param {number|string} userId 当前用户 id
 * @returns {{ice_servers: Array<{urls: string|string[], username?: string, credential?: string}>}}
 */
export function buildIceServers(userId) {
  const uid = toInt(userId, 0);
  const secret = typeof process.env.TURN_SECRET === 'string' ? process.env.TURN_SECRET.trim() : '';
  const host = typeof process.env.TURN_HOST === 'string' ? process.env.TURN_HOST.trim() : '';

  // TURN_SECRET 与 TURN_HOST 任一缺失时只下发 STUN：通话尽力直连，不暴露无效中继
  if (!secret || !host) {
    return { ice_servers: [STUN_SERVER] };
  }
  const port = Number(process.env.TURN_PORT) || 3478;

  const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
  const username = `${expiry}:${uid}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');

  const urls = [`turn:${host}:${port}`, `turn:${host}:${port}?transport=tcp`];

  return {
    ice_servers: [STUN_SERVER, { urls, username, credential }],
  };
}

export default { buildIceServers };
