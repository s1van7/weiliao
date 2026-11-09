/**
 * 发现页配置路由（账号维度）：
 *   GET  /api/settings/discover  → {config:[{key,enabled,sort}]}
 *   PUT  /api/settings/discover  → {config:[...]}
 *
 * key 白名单 scan|moments|emoji，恰好 3 项、key 唯一、sort 0..2 唯一。
 */
import express from 'express';
import { db, now, tx } from '../db.js';
import { httpAuth } from '../auth.js';
import { ApiError, ok, wrap } from '../lib/http.js';
import { toInt } from '../lib/serialize.js';

const router = express.Router();

/** key 白名单 */
const DISCOVER_KEYS = Object.freeze(new Set(['scan', 'moments', 'emoji']));

/** 默认配置（无行时返回） */
const DEFAULT_CONFIG = Object.freeze([
  { key: 'scan', enabled: true, sort: 0 },
  { key: 'moments', enabled: true, sort: 1 },
  { key: 'emoji', enabled: true, sort: 2 },
]);

/**
 * 读取用户发现页配置（无行返回默认）。
 * @param {number|string} userId
 * @returns {Array<{key:string, enabled:boolean, sort:number}>}
 */
function readDiscoverConfig(userId) {
  const uid = toInt(userId, 0);
  if (uid <= 0) return DEFAULT_CONFIG.map((item) => ({ ...item }));
  const row = db.prepare('SELECT config_json FROM discover_config WHERE user_id = ?').get(uid);
  if (!row) return DEFAULT_CONFIG.map((item) => ({ ...item }));
  try {
    const parsed = JSON.parse(String(row.config_json ?? '[]'));
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        key: String(item?.key ?? ''),
        enabled: Boolean(item?.enabled),
        sort: toInt(item?.sort, 0),
      }));
    }
  } catch {
    /* 回退默认 */
  }
  return DEFAULT_CONFIG.map((item) => ({ ...item }));
}

/**
 * 校验并规范化发现页配置。
 * @param {unknown} raw
 * @returns {Array<{key:string, enabled:boolean, sort:number}>}
 */
function normalizeDiscoverConfig(raw) {
  if (!Array.isArray(raw) || raw.length !== DISCOVER_KEYS.size) {
    throw new ApiError(400, 'INVALID_PARAM', 'config 必须是恰好 3 项的数组');
  }

  const keys = new Set();
  const sorts = new Set();
  const items = raw.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new ApiError(400, 'INVALID_PARAM', 'config 项必须是对象');
    }
    const key = typeof item.key === 'string' ? item.key : '';
    if (!DISCOVER_KEYS.has(key)) {
      throw new ApiError(400, 'INVALID_PARAM', '发现页 key 仅支持 scan、moments、emoji');
    }
    if (keys.has(key)) {
      throw new ApiError(400, 'INVALID_PARAM', '发现页 key 不能重复');
    }
    keys.add(key);

    const sort = toInt(item.sort, -1);
    if (sort < 0 || sort > DISCOVER_KEYS.size - 1 || sorts.has(sort)) {
      throw new ApiError(400, 'INVALID_PARAM', 'sort 必须唯一且取 0、1、2');
    }
    sorts.add(sort);

    return { key, enabled: Boolean(item.enabled), sort };
  });

  // 白名单三项必须齐全
  if ([...DISCOVER_KEYS].some((key) => !keys.has(key))) {
    throw new ApiError(400, 'INVALID_PARAM', 'config 必须包含 scan、moments、emoji 三项');
  }

  return items.sort((a, b) => a.sort - b.sort);
}

router.get(
  '/discover',
  httpAuth,
  wrap(async (req, res) => {
    return ok(res, { config: readDiscoverConfig(req.userId) });
  }),
);

router.put(
  '/discover',
  httpAuth,
  wrap(async (req, res) => {
    const config = normalizeDiscoverConfig(req.body?.config);
    const uid = toInt(req.userId, 0);
    const configJson = JSON.stringify(config);

    tx(() => {
      db.prepare(
        `INSERT INTO discover_config (user_id, config_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`,
      ).run(uid, configJson, now());
    });

    return ok(res, { config });
  }),
);

export default router;
