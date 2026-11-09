/**
 * 朋友圈领域服务：时间线（好友可见）、发布、删除、点赞、评论。
 *
 * 可见性约定：一律按「当前好友关系」实时判定（friendships 的 low/high 结构），
 * 不做快照、不缓存；非好友访问任何动态 id 统一返回 404，不暴露存在性。
 *
 * 性能约定：时间线严格「一次查 moments + 一次查 images + 一次查 likes + 一次查 comments」，
 * 再在 JS 里按 moment_id 聚合，禁止在循环里逐条查询（N+1）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { db, now, tx, UPLOAD_DIR } from '../db.js';
import { ApiError } from './http.js';
import { DEFAULT_AVATAR_COLOR, toInt } from './serialize.js';
import { areFriends } from './conversations.js';
import { canSeeMoments, filterVisibleMomentAuthors } from './friendPermissions.js';
import { isAudioUrl, isMediaUrl, isVideoUrl } from './media.js';

/** 动态文字长度上限（字符数） */
export const MOMENT_TEXT_MAX = 1000;
/** 评论长度上限（字符数） */
export const MOMENT_COMMENT_MAX = 200;
/** 时间线默认分页条数 */
export const MOMENT_PAGE_DEFAULT = 20;
/** 时间线最大分页条数 */
export const MOMENT_PAGE_MAX = 50;

/** 允许的动态媒体类型 */
const MOMENT_MEDIA_TYPES = Object.freeze(new Set(['text', 'image', 'live', 'video', 'audio']));

/** 照片扩展名 */
const PHOTO_EXTS = Object.freeze(['jpg', 'jpeg', 'png', 'webp']);

/** live 扩展名（gif 或 mp4 循环播放） */
const LIVE_EXTS = Object.freeze(['gif', 'mp4']);

/**
 * 取 URL 扩展名（小写）。
 * @param {string} url
 * @returns {string}
 */
function extOf(url) {
  const match = /\.([A-Za-z0-9]+)$/.exec(url);
  return match ? match[1].toLowerCase() : '';
}

/** 上传目录的对外前缀 */
const UPLOAD_URL_PREFIX = '/uploads/';
/** 上传文件名白名单（反删文件时防止路径穿越） */
const UPLOAD_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/** 动态主查询片段（带作者信息） */
const MOMENT_SELECT = `SELECT m.id, m.user_id, m.content, m.media_type, m.media_url, m.created_at,
                              u.nickname AS user_nickname, u.avatar_color AS user_avatar_color,
                              u.avatar_url AS user_avatar_url
                         FROM moments m
                         JOIN users u ON u.id = m.user_id`;

/**
 * 统计字符数（emoji 等代理对按 1 个字符计）。
 * @param {string} text 文本
 * @returns {number}
 */
function charLength(text) {
  return [...String(text ?? '')].length;
}

/**
 * 把行里的用户字段整理成对外的 user 对象。
 * @param {Record<string, unknown>} row 含 nickname / avatar_color / avatar_url 的行
 * @param {string} prefix 列前缀（如 'user_'）
 * @returns {{id:number, nickname:string, avatar_color:string, avatar_url:string}}
 */
function userBrief(row, prefix = 'user_') {
  return {
    id: Number(row[`${prefix}id`] ?? row.id ?? 0),
    nickname: String(row[`${prefix}nickname`] ?? row.nickname ?? ''),
    avatar_color: String(row[`${prefix}avatar_color`] ?? row.avatar_color ?? DEFAULT_AVATAR_COLOR),
    avatar_url: String(row[`${prefix}avatar_url`] ?? row.avatar_url ?? ''),
  };
}

/**
 * 我的好友 id 列表（friendships 的 low/high 结构，双向查一次）。
 * @param {number} userId 用户 id
 * @returns {number[]}
 */
function friendIdsOf(userId) {
  const rows = db
    .prepare(
      `SELECT user_high_id AS other_id FROM friendships WHERE user_low_id = ?
       UNION
       SELECT user_low_id AS other_id FROM friendships WHERE user_high_id = ?`,
    )
    .all(userId, userId);
  return rows.map((row) => Number(row.other_id));
}

/**
 * 分页条数钳制。
 * @param {unknown} limit 原始入参
 * @returns {number}
 */
function clampLimit(limit) {
  const raw = toInt(limit, MOMENT_PAGE_DEFAULT);
  return Math.min(Math.max(raw > 0 ? raw : MOMENT_PAGE_DEFAULT, 1), MOMENT_PAGE_MAX);
}

/**
 * 生成 IN (...) 的占位符。
 * @param {number} count 元素个数
 * @returns {string}
 */
function placeholders(count) {
  return new Array(count).fill('?').join(', ');
}

/**
 * best-effort 删除磁盘图片：事务提交后调用，失败只告警，不影响接口结果。
 * @param {string[]} urls 形如 /uploads/xxx.png 的地址列表
 * @returns {void}
 */
function removeUploadFiles(urls) {
  for (const url of urls) {
    if (typeof url !== 'string' || !url.startsWith(UPLOAD_URL_PREFIX)) continue;
    const name = url.slice(UPLOAD_URL_PREFIX.length);
    if (!UPLOAD_NAME_PATTERN.test(name)) continue;
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, name));
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      console.warn('[moments] unlink failed:', name, err?.message ?? err);
    }
  }
}

/**
 * 把动态行批量组装成对外结构（图片 / 点赞 / 评论各一次查询后聚合）。
 * @param {Array<Record<string, unknown>>} rows moments 行（按期望输出顺序传入）
 * @param {number} me 当前用户 id
 * @returns {Array<Record<string, unknown>>}
 */
function assemble(rows, me) {
  if (!rows || rows.length === 0) return [];
  const ids = rows.map((row) => Number(row.id));
  const ph = placeholders(ids.length);

  const imageRows = db
    .prepare(
      `SELECT moment_id, url, media_type FROM moment_images
        WHERE moment_id IN (${ph})
        ORDER BY moment_id ASC, seq ASC, id ASC`,
    )
    .all(...ids);
  const imageMap = new Map();
  for (const row of imageRows) {
    const momentId = Number(row.moment_id);
    if (!imageMap.has(momentId)) imageMap.set(momentId, []);
    imageMap.get(momentId).push({
      url: String(row.url ?? ''),
      type: row.media_type === 'live' ? 'live' : 'image',
    });
  }

  const likeRows = db
    .prepare(
      `SELECT ml.moment_id AS moment_id, ml.created_at AS created_at,
              u.id AS id, u.nickname AS nickname, u.avatar_color AS avatar_color, u.avatar_url AS avatar_url
         FROM moment_likes ml
         JOIN users u ON u.id = ml.user_id
        WHERE ml.moment_id IN (${ph})
        ORDER BY ml.moment_id ASC, ml.created_at ASC, u.id ASC`,
    )
    .all(...ids);
  const likeMap = new Map();
  for (const row of likeRows) {
    const momentId = Number(row.moment_id);
    if (!likeMap.has(momentId)) likeMap.set(momentId, []);
    likeMap.get(momentId).push(userBrief(row, ''));
  }

  const commentRows = db
    .prepare(
      `SELECT mc.id AS id, mc.moment_id AS moment_id, mc.user_id AS user_id, mc.content AS content, mc.created_at AS created_at,
              u.nickname AS nickname, u.avatar_color AS avatar_color, u.avatar_url AS avatar_url
         FROM moment_comments mc
         JOIN users u ON u.id = mc.user_id
        WHERE mc.moment_id IN (${ph})
        ORDER BY mc.moment_id ASC, mc.id ASC`,
    )
    .all(...ids);
  const commentMap = new Map();
  for (const row of commentRows) {
    const momentId = Number(row.moment_id);
    if (!commentMap.has(momentId)) commentMap.set(momentId, []);
    commentMap.get(momentId).push(row);
  }

  return rows.map((row) => {
    const momentId = Number(row.id);
    const authorId = Number(row.user_id);
    const likes = likeMap.get(momentId) ?? [];
    const comments = (commentMap.get(momentId) ?? []).map((comment) => ({
      id: Number(comment.id),
      user: userBrief(comment, ''),
      content: String(comment.content ?? ''),
      created_at: Number(comment.created_at ?? 0),
      // 评论作者或动态作者都能删评论
      can_delete: Number(comment.user_id) === me || authorId === me,
    }));
    return {
      id: momentId,
      user: userBrief(row),
      content: String(row.content ?? ''),
      media_type:
        row.media_type === 'video' || row.media_type === 'live' || row.media_type === 'text' || row.media_type === 'audio'
          ? row.media_type
          : 'image',
      images: imageMap.get(momentId) ?? [],
      video_url: row.media_type === 'video' ? String(row.media_url ?? '') : '',
      audio_url: row.media_type === 'audio' ? String(row.media_url ?? '') : '',
      created_at: Number(row.created_at ?? 0),
      liked: likes.some((user) => user.id === me),
      like_count: likes.length,
      likes,
      comments,
    };
  });
}

/**
 * 校验动态可见性并返回 {id, authorId}：非好友与不存在一律 404。
 * @param {number|string} momentId 动态 id
 * @param {number} me 当前用户 id
 * @returns {{id:number, authorId:number}}
 * @throws {ApiError} 400 INVALID_PARAM / 404 NOT_FOUND
 */
function assertVisibleMoment(momentId, me) {
  const id = toInt(momentId, 0);
  if (id <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '动态 id 不合法');
  }
  const row = db.prepare('SELECT id, user_id FROM moments WHERE id = ?').get(id);
  if (!row) {
    throw new ApiError(404, 'NOT_FOUND', '动态不存在');
  }
  const authorId = Number(row.user_id);
  // 非好友：不暴露存在性，和「不存在」返回完全一致
  if (authorId !== me && !areFriends(me, authorId)) {
    throw new ApiError(404, 'NOT_FOUND', '动态不存在');
  }
  // 朋友权限：作者对我隐藏朋友圈 / 我屏蔽作者朋友圈，统一 404
  if (authorId !== me && !canSeeMoments(me, authorId)) {
    throw new ApiError(404, 'NOT_FOUND', '动态不存在');
  }
  return { id, authorId };
}

/**
 * 单条动态（含作者 / 图片 / 点赞 / 评论），供发布后回显使用。
 * @param {number} momentId 动态 id
 * @param {number} me 当前用户 id
 * @returns {Record<string, unknown>|null}
 */
export function findMoment(momentId, me) {
  const row = db.prepare(`${MOMENT_SELECT} WHERE m.id = ?`).get(toInt(momentId, 0));
  if (!row) return null;
  return assemble([row], me)[0] ?? null;
}

/**
 * 时间线分页（before_id 游标）：我与好友的动态，含我自己。
 * @param {{userId:unknown, beforeId:unknown, limit:unknown}} input 查询参数
 * @returns {{moments:Array<Record<string, unknown>>, has_more:boolean}}
 * @throws {ApiError} 400 INVALID_PARAM
 */
export function listTimeline({ userId, beforeId, limit }) {
  const me = toInt(userId, 0);
  if (me <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }

  const cursor = Math.max(toInt(beforeId, 0), 0);
  const pageSize = clampLimit(limit);

  const friendIds = friendIdsOf(me);
  // 朋友权限过滤：批量算出「我能看到其朋友圈的好友」，再拼进 SQL，避免 N+1
  const visibleFriendIds = filterVisibleMomentAuthors(me, friendIds);
  const conditions = [];
  const params = [];

  if (visibleFriendIds.length > 0) {
    conditions.push(`(m.user_id = ? OR m.user_id IN (${placeholders(visibleFriendIds.length)}))`);
    params.push(me, ...visibleFriendIds);
  } else {
    conditions.push('m.user_id = ?');
    params.push(me);
  }
  if (cursor > 0) {
    conditions.push('m.id < ?');
    params.push(cursor);
  }

  const rows = db
    .prepare(`${MOMENT_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY m.id DESC LIMIT ?`)
    .all(...params, pageSize + 1);

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  return { moments: assemble(page, me), has_more: hasMore };
}

/**
 * 指定用户的朋友圈分页：仅本人或好友可见，非好友统一 404（不暴露存在性）。
 * @param {{userId:unknown, viewerId:unknown, beforeId:unknown, limit:unknown}} input
 * @returns {{moments:Array<Record<string, unknown>>, has_more:boolean}}
 * @throws {ApiError} 404 NOT_FOUND / 400 INVALID_PARAM
 */
export function listUserMoments({ userId, viewerId, beforeId, limit }) {
  const targetId = toInt(userId, 0);
  const me = toInt(viewerId, 0);
  if (targetId <= 0 || me <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }
  if (targetId !== me && !areFriends(me, targetId)) {
    throw new ApiError(404, 'NOT_FOUND', '动态不存在');
  }
  if (targetId !== me && !canSeeMoments(me, targetId)) {
    throw new ApiError(404, 'NOT_FOUND', '动态不存在');
  }

  const cursor = Math.max(toInt(beforeId, 0), 0);
  const pageSize = clampLimit(limit);

  const rows =
    cursor > 0
      ? db
          .prepare(`${MOMENT_SELECT} WHERE m.user_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`)
          .all(targetId, cursor, pageSize + 1)
      : db
          .prepare(`${MOMENT_SELECT} WHERE m.user_id = ? ORDER BY m.id DESC LIMIT ?`)
          .all(targetId, pageSize + 1);

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  return { moments: assemble(page, me), has_more: hasMore };
}

/**
 * 校验单张媒体 url 与类型（image=照片、live=gif/mp4）。
 * @param {string} url
 * @param {'image'|'live'} type
 * @returns {void}
 * @throws {ApiError} 400 INVALID_PARAM
 */
function assertImageItem(url, type) {
  if (!isMediaUrl(url)) {
    throw new ApiError(400, 'INVALID_PARAM', '图片地址必须是 /uploads/ 下的媒体路径');
  }
  const ext = extOf(url);
  const allowed = type === 'live' ? LIVE_EXTS : PHOTO_EXTS;
  if (!allowed.includes(ext)) {
    throw new ApiError(400, 'INVALID_PARAM', type === 'live' ? 'live 图片仅支持 gif 或 mp4' : '图片仅支持 jpg/png/webp');
  }
}

/**
 * 解析发布参数中的 images（支持 string[] 或 [{url,type}]）。
 * @param {unknown} images 原始入参
 * @returns {Array<{url:string, type:'image'|'live'}>}
 * @throws {ApiError} 400 TOO_MANY_IMAGES / INVALID_PARAM
 */
function parseMomentImages(images) {
  let rawImages = [];
  if (images !== undefined && images !== null) {
    if (!Array.isArray(images)) {
      throw new ApiError(400, 'INVALID_PARAM', 'images 必须是数组');
    }
    rawImages = images;
  }

  return rawImages.map((item) => {
    if (typeof item === 'string') {
      const url = item.trim();
      assertImageItem(url, 'image');
      return { url, type: 'image' };
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const url = typeof item.url === 'string' ? item.url.trim() : '';
      const type = item.type === 'live' ? 'live' : 'image';
      assertImageItem(url, type);
      return { url, type };
    }
    throw new ApiError(400, 'INVALID_PARAM', 'images 元素必须是字符串或 {url,type} 对象');
  });
}

/**
 * 发布动态。
 * @param {{userId:unknown, content:unknown, mediaType?:unknown, images?:unknown, videoUrl?:unknown, audioUrl?:unknown}} input 发布参数
 * @returns {Record<string, unknown>} 组装后的动态
 * @throws {ApiError} 400 MOMENT_EMPTY / INVALID_PARAM
 */
export function createMoment({ userId, content, mediaType, images, videoUrl, audioUrl }) {
  const me = toInt(userId, 0);
  if (me <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }

  const text = typeof content === 'string' ? content.trim() : '';
  if (charLength(text) > MOMENT_TEXT_MAX) {
    throw new ApiError(400, 'INVALID_PARAM', `动态文字不能超过 ${MOMENT_TEXT_MAX} 个字符`);
  }

  const parsedImages = parseMomentImages(images);

  let rawVideoUrl = '';
  if (videoUrl !== undefined && videoUrl !== null) {
    if (typeof videoUrl !== 'string') {
      throw new ApiError(400, 'INVALID_PARAM', 'video_url 必须是字符串');
    }
    rawVideoUrl = videoUrl.trim();
  }

  let rawAudioUrl = '';
  if (audioUrl !== undefined && audioUrl !== null) {
    if (typeof audioUrl !== 'string') {
      throw new ApiError(400, 'INVALID_PARAM', 'audio_url 必须是字符串');
    }
    rawAudioUrl = audioUrl.trim();
  }

  // 推断 / 校验 media_type
  let type = typeof mediaType === 'string' ? mediaType.trim() : '';
  if (type === '') {
    if (rawVideoUrl !== '') type = 'video';
    else if (rawAudioUrl !== '') type = 'audio';
    else if (parsedImages.length > 0) type = parsedImages.some((item) => item.type === 'live') ? 'live' : 'image';
    else type = 'text';
  }
  if (!MOMENT_MEDIA_TYPES.has(type)) {
    throw new ApiError(400, 'INVALID_PARAM', 'media_type 取值不合法');
  }

  if (type === 'text') {
    if (parsedImages.length > 0 || rawVideoUrl !== '' || rawAudioUrl !== '') {
      throw new ApiError(400, 'INVALID_PARAM', '纯文字动态不能携带图片、视频或音频');
    }
  } else if (type === 'image') {
    if (rawVideoUrl !== '' || rawAudioUrl !== '') {
      throw new ApiError(400, 'INVALID_PARAM', '图片动态不能携带 video_url 或 audio_url');
    }
    if (parsedImages.length === 0) {
      throw new ApiError(400, 'INVALID_PARAM', '图片动态至少需要一张图片');
    }
  } else if (type === 'live') {
    if (rawVideoUrl !== '' || rawAudioUrl !== '') {
      throw new ApiError(400, 'INVALID_PARAM', 'live 动态不能携带 video_url 或 audio_url');
    }
    if (parsedImages.length === 0 || !parsedImages.some((item) => item.type === 'live')) {
      throw new ApiError(400, 'INVALID_PARAM', 'live 动态至少需要一张 live 图片');
    }
  } else if (type === 'video') {
    if (parsedImages.length > 0 || rawAudioUrl !== '') {
      throw new ApiError(400, 'INVALID_PARAM', '视频动态不能携带 images 或 audio_url');
    }
    if (rawVideoUrl === '' || !isVideoUrl(rawVideoUrl)) {
      throw new ApiError(400, 'INVALID_PARAM', '视频动态必须携带 /uploads/ 下的 mp4 地址');
    }
  } else {
    // audio
    if (parsedImages.length > 0 || rawVideoUrl !== '') {
      throw new ApiError(400, 'INVALID_PARAM', '音频动态不能携带 images 或 video_url');
    }
    if (rawAudioUrl === '' || !isAudioUrl(rawAudioUrl)) {
      throw new ApiError(400, 'INVALID_PARAM', '音频动态必须携带 /uploads/ 下的音频地址');
    }
  }

  if (!text && parsedImages.length === 0 && rawVideoUrl === '' && rawAudioUrl === '') {
    throw new ApiError(400, 'MOMENT_EMPTY', '动态内容不能为空');
  }

  const mediaUrlValue = type === 'video' ? rawVideoUrl : type === 'audio' ? rawAudioUrl : '';

  const createdAt = now();
  const momentId = tx(() => {
    const inserted = db
      .prepare('INSERT INTO moments (user_id, content, media_type, media_url, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(me, text, type, mediaUrlValue, createdAt);
    const id = Number(inserted.lastInsertRowid);

    const insertImage = db.prepare(
      'INSERT INTO moment_images (moment_id, url, seq, media_type) VALUES (?, ?, ?, ?)',
    );
    parsedImages.forEach((item, index) => {
      insertImage.run(id, item.url, index, item.type);
    });

    return id;
  });

  return findMoment(momentId, me);
}

/**
 * 删除动态：仅作者；事务内收集图片地址，提交后 best-effort 删磁盘文件。
 * @param {{userId:unknown, momentId:unknown}} input 删除参数
 * @returns {{deleted:true, files:string[]}}
 * @throws {ApiError} 400 INVALID_PARAM / 404 NOT_FOUND / 403 FORBIDDEN
 */
export function deleteMoment({ userId, momentId }) {
  const me = toInt(userId, 0);
  const id = toInt(momentId, 0);
  if (me <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }
  if (id <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '动态 id 不合法');
  }

  // 先判可见性：不存在与非好友统一 404，避免 403 泄露「这条动态存在」；
  // 通过可见性校验说明「存在且可见」，此时非作者才返回 403
  const { authorId } = assertVisibleMoment(id, me);
  if (authorId !== me) {
    throw new ApiError(403, 'FORBIDDEN', '只能删除自己的动态');
  }

  // 图片 / 点赞 / 评论由 ON DELETE CASCADE 自动清理
  const files = tx(() => {
    const imageRows = db.prepare('SELECT url FROM moment_images WHERE moment_id = ?').all(id);
    db.prepare('DELETE FROM moments WHERE id = ? AND user_id = ?').run(id, me);

    // 只删「已无任何动态引用」的文件，避免同一图片被多条动态复用时误删
    const orphans = [];
    for (const image of imageRows) {
      const url = String(image.url ?? '');
      const ref = db.prepare('SELECT COUNT(*) AS total FROM moment_images WHERE url = ?').get(url);
      if (Number(ref?.total ?? 0) === 0) orphans.push(url);
    }
    return orphans;
  });

  removeUploadFiles(files);

  return { deleted: true, files };
}

/**
 * 当前动态的点赞总数。
 * @param {number} momentId 动态 id
 * @returns {number}
 */
function countLikes(momentId) {
  const row = db.prepare('SELECT COUNT(*) AS total FROM moment_likes WHERE moment_id = ?').get(momentId);
  return Number(row?.total ?? 0);
}

/**
 * 点赞（幂等：重复点赞不重复计数）。
 * @param {{userId:unknown, momentId:unknown}} input 点赞参数
 * @returns {{liked:true, like_count:number}}
 * @throws {ApiError} 404 NOT_FOUND（非好友与不存在同码）
 */
export function likeMoment({ userId, momentId }) {
  const me = toInt(userId, 0);
  if (me <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }
  const { id } = assertVisibleMoment(momentId, me);

  tx(() => {
    db.prepare('INSERT OR IGNORE INTO moment_likes (moment_id, user_id, created_at) VALUES (?, ?, ?)').run(id, me, now());
  });

  return { liked: true, like_count: countLikes(id) };
}

/**
 * 取消点赞（幂等：没点过也返回成功）。
 * @param {{userId:unknown, momentId:unknown}} input 取消点赞参数
 * @returns {{liked:false, like_count:number}}
 * @throws {ApiError} 404 NOT_FOUND
 */
export function unlikeMoment({ userId, momentId }) {
  const me = toInt(userId, 0);
  if (me <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }
  const { id } = assertVisibleMoment(momentId, me);

  tx(() => {
    db.prepare('DELETE FROM moment_likes WHERE moment_id = ? AND user_id = ?').run(id, me);
  });

  return { liked: false, like_count: countLikes(id) };
}

/**
 * 发表评论。
 * @param {{userId:unknown, momentId:unknown, content:unknown}} input 评论参数
 * @returns {{comment:{id:number, user:{id:number, nickname:string, avatar_color:string, avatar_url:string}, content:string, created_at:number, can_delete:boolean}}}
 * @throws {ApiError} 400 INVALID_PARAM / 404 NOT_FOUND
 */
export function addComment({ userId, momentId, content }) {
  const me = toInt(userId, 0);
  if (me <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }
  const { id } = assertVisibleMoment(momentId, me);

  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) {
    throw new ApiError(400, 'INVALID_PARAM', '评论内容不能为空');
  }
  if (charLength(text) > MOMENT_COMMENT_MAX) {
    throw new ApiError(400, 'INVALID_PARAM', `评论不能超过 ${MOMENT_COMMENT_MAX} 个字符`);
  }

  const createdAt = now();
  const commentId = tx(() => {
    const inserted = db
      .prepare('INSERT INTO moment_comments (moment_id, user_id, content, created_at) VALUES (?, ?, ?, ?)')
      .run(id, me, text, createdAt);
    return Number(inserted.lastInsertRowid);
  });

  const row = db
    .prepare(
      `SELECT mc.id AS id, mc.content AS content, mc.created_at AS created_at, mc.user_id AS user_id,
              u.nickname AS nickname, u.avatar_color AS avatar_color, u.avatar_url AS avatar_url
         FROM moment_comments mc
         JOIN users u ON u.id = mc.user_id
        WHERE mc.id = ?`,
    )
    .get(commentId);

  return {
    comment: {
      id: Number(row?.id ?? commentId),
      user: userBrief(row ?? {}, ''),
      content: String(row?.content ?? text),
      created_at: Number(row?.created_at ?? createdAt),
      can_delete: true,
    },
  };
}

/**
 * 删除评论：评论作者或动态作者可删。
 * @param {{userId:unknown, momentId:unknown, commentId:unknown}} input 删除参数
 * @returns {{deleted:true, id:number}}
 * @throws {ApiError} 400 INVALID_PARAM / 404 NOT_FOUND / 403 FORBIDDEN
 */
export function deleteComment({ userId, momentId, commentId }) {
  const me = toInt(userId, 0);
  const commentPk = toInt(commentId, 0);
  if (me <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }
  if (commentPk <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '评论 id 不合法');
  }

  const { id, authorId } = assertVisibleMoment(momentId, me);

  const row = db.prepare('SELECT id, moment_id, user_id FROM moment_comments WHERE id = ?').get(commentPk);
  if (!row || Number(row.moment_id) !== id) {
    throw new ApiError(404, 'NOT_FOUND', '评论不存在');
  }
  if (Number(row.user_id) !== me && authorId !== me) {
    throw new ApiError(403, 'FORBIDDEN', '只能删除自己的评论');
  }

  tx(() => {
    db.prepare('DELETE FROM moment_comments WHERE id = ?').run(commentPk);
  });

  return { deleted: true, id: commentPk };
}
