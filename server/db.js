/**
 * 数据库模块：单例 DatabaseSync、启动时执行 schema、事务辅助函数。
 * 依赖 Node 内置 node:sqlite（Node 24 无需任何 flag）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 代码根目录（/opt/wechat-lite） */
export const ROOT_DIR = path.resolve(__dirname, '..');
/**
 * 数据目录（数据库 + 密钥 + 上传文件）。
 * 默认 ROOT_DIR/data；可用 DATA_DIR 环境变量覆盖（自测/临时库/多实例隔离）。
 */
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT_DIR, 'data');
/** SQLite 数据库文件路径 */
export const DB_PATH = path.join(DATA_DIR, 'app.db');
/** 上传目录 */
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
/** 分片上传临时目录（不被静态托管，合并完成后清理） */
export const CHUNK_DIR = path.join(UPLOAD_DIR, '.chunks');
/** 前端构建产物目录 */
export const WEB_DIST_DIR = path.join(ROOT_DIR, 'web', 'dist');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(CHUNK_DIR, { recursive: true });

/** 全局唯一的数据库连接 */
export const db = new DatabaseSync(DB_PATH);

// schema.sql 内含 PRAGMA 与 CREATE TABLE IF NOT EXISTS，可安全重复执行
const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schemaSql);

/**
 * 幂等迁移：确保 users 表存在 avatar_url 列。
 *
 * 老库建表语句里没有该列，CREATE TABLE IF NOT EXISTS 不会补列，因此需要显式 ALTER TABLE。
 * 通过 PRAGMA table_info(users) 判断列是否已存在，存在即跳过（可反复执行）。
 * 新增列带 NOT NULL DEFAULT ''，老用户自动取空串 → 继续使用纯色头像，不会报错。
 * @returns {boolean} 本次是否真的执行了迁移
 */
function migrateUsersAvatarUrl() {
  const columns = db.prepare('PRAGMA table_info(users)').all();
  const exists = columns.some((column) => column.name === 'avatar_url');
  if (exists) return false;
  db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''");
  console.log('[db] migrated: users.avatar_url');
  return true;
}

migrateUsersAvatarUrl();

/**
 * 通用幂等迁移：确保 table 表存在 column 列。
 *
 * 用法与 migrateUsersAvatarUrl 一致：PRAGMA table_info 判列，不存在才 ALTER，
 * 存在即跳过（可反复执行，不会出现 duplicate column）。
 * table / column / definition 只接受代码里的字面量常量，绝不拼接用户输入。
 * @param {string} table 表名
 * @param {string} column 列名
 * @param {string} definition 列定义（跟在列名后的 SQL 片段，如 "TEXT NOT NULL DEFAULT ''"）
 * @returns {boolean} 本次是否真的执行了迁移
 */
export function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some((item) => item.name === column);
  if (exists) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`[db] migrated: ${table}.${column}`);
  return true;
}

/** 群资料 / 群权限 / 公告已读 / @ 未读 / @ 内容 的增量列（顺序固定，便于日志比对） */
const COLUMN_MIGRATIONS = Object.freeze([
  ['conversations', 'avatar_url', "TEXT NOT NULL DEFAULT ''"],
  ['conversations', 'announcement', "TEXT NOT NULL DEFAULT ''"],
  ['conversations', 'announcement_at', 'INTEGER NOT NULL DEFAULT 0'],
  ['conversations', 'perm_speak', "TEXT NOT NULL DEFAULT 'all'"],
  ['conversations', 'perm_invite', "TEXT NOT NULL DEFAULT 'all'"],
  ['conversations', 'perm_remove', "TEXT NOT NULL DEFAULT 'owner'"],
  ['conversation_members', 'last_read_announcement_at', 'INTEGER NOT NULL DEFAULT 0'],
  ['conversation_members', 'mentioned', 'INTEGER NOT NULL DEFAULT 0'],
  ['messages', 'mentions', "TEXT NOT NULL DEFAULT ''"],
  // 语音消息：voice_url 存 /uploads/xxx.webm|mp4；voice_duration 存秒数（1..60）
  ['messages', 'voice_url', "TEXT NOT NULL DEFAULT ''"],
  ['messages', 'voice_duration', 'INTEGER NOT NULL DEFAULT 0'],
  // 封面：cover_url 为空串表示未设置；cover_type 取值 photo|live|video
  ['users', 'cover_url', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'cover_type', "TEXT NOT NULL DEFAULT 'photo'"],
  // 朋友圈媒体：media_type 取值 text|image|live|video；video 的地址存 media_url
  ['moments', 'media_type', "TEXT NOT NULL DEFAULT 'image'"],
  ['moments', 'media_url', "TEXT NOT NULL DEFAULT ''"],
  // 单张图片也区分 image/live（live=gif 或 mp4 循环播放）
  ['moment_images', 'media_type', "TEXT NOT NULL DEFAULT 'image'"],
  // 视频消息：video_url 存 /uploads/xxx.mp4；video_duration 存毫秒（非负整数）
  ['messages', 'video_url', "TEXT NOT NULL DEFAULT ''"],
  ['messages', 'video_duration', 'INTEGER NOT NULL DEFAULT 0'],
  // 文件消息：file_url 存 /uploads/xxx（任意扩展名）；file_name 为清洗后的原始名；file_size 为字节
  ['messages', 'file_url', "TEXT NOT NULL DEFAULT ''"],
  ['messages', 'file_name', "TEXT NOT NULL DEFAULT ''"],
  ['messages', 'file_size', 'INTEGER NOT NULL DEFAULT 0'],
  // 个人资料：性别（''|male|female|secret）与地区（≤30 字符）
  ['users', 'gender', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'region', "TEXT NOT NULL DEFAULT ''"],
  // 聊天背景：用户级，取值 ''（默认）| /uploads/<image> | #RRGGBB
  ['conversation_members', 'background_url', "TEXT NOT NULL DEFAULT ''"],
  // 语音转文字：仅 voice 消息有意义，ASR 成功后回填；撤回时序列化层置空
  ['messages', 'transcript', "TEXT NOT NULL DEFAULT ''"],
  // 面对面传文件：非好友临时可发（1=允许），单聊发送与只读判定联动
  ['conversations', 'allow_non_friend_send', 'INTEGER NOT NULL DEFAULT 0'],
  // 会话级个人偏好（存在本人成员行上，互不影响）：
  // pinned            = 1 置顶（列表排序优先，浅灰底）
  // hidden            = 1 隐藏（列表不展示，来新消息后自动浮现）
  // hidden_at         = 隐藏/删除发生的时间戳，与 c.last_message_at 比较判断是否重新浮现
  // cleared_before_id = 删除聊天时记下的会话最大 message id，历史查询只返回 id > 该值
  // manual_unread     = 1 手动标记未读（列表显示纯红点，无数字）
  ['conversation_members', 'pinned', 'INTEGER NOT NULL DEFAULT 0'],
  ['conversation_members', 'hidden', 'INTEGER NOT NULL DEFAULT 0'],
  ['conversation_members', 'hidden_at', 'INTEGER NOT NULL DEFAULT 0'],
  ['conversation_members', 'cleared_before_id', 'INTEGER NOT NULL DEFAULT 0'],
  ['conversation_members', 'manual_unread', 'INTEGER NOT NULL DEFAULT 0'],
  // muted = 消息免打扰：不响铃不弹通知，未读仍累加但列表只显示小红点
  ['conversation_members', 'muted', 'INTEGER NOT NULL DEFAULT 0'],
  // starred = 星标朋友：通讯录里排在最前（与备注同表，注释见 friend_notes 表）
  ['friend_notes', 'starred', 'INTEGER NOT NULL DEFAULT 0'],
  // username_changed_at = 用户名（微聊号）最近修改时间，0 表示从未修改
  ['users', 'username_changed_at', 'INTEGER NOT NULL DEFAULT 0'],
]);

for (const [table, column, definition] of COLUMN_MIGRATIONS) {
  ensureColumn(table, column, definition);
}

// role 值域扩为 owner|admin|member：SQLite 无法给已有表补 CHECK，
// 老库若存在意外取值（历史脏数据）统一归一为 member，避免权限判定出现第三态。
db.exec("UPDATE conversation_members SET role = 'member' WHERE role NOT IN ('owner', 'admin', 'member')");

// 朋友圈媒体类型幂等 backfill：
// 老数据里 moments.media_type 默认值恒为 'image'，但真正的「无图纯文字」动态应该标成 text。
// 依据关联表 moment_images 是否存在来修正，不触碰已有图片动态。
db.exec(
  "UPDATE moments SET media_type = 'text' WHERE media_type = 'image' AND id NOT IN (SELECT DISTINCT moment_id FROM moment_images)",
);

/**
 * 读取单个 PRAGMA 的当前值，用于启动自检。
 * @param {string} name PRAGMA 名称（仅内部常量，不接受用户输入）
 * @returns {string|number|null}
 */
function readPragma(name) {
  try {
    const row = db.prepare(`PRAGMA ${name}`).get();
    if (!row) return null;
    const values = Object.values(row);
    return values.length > 0 ? values[0] : null;
  } catch (err) {
    return `error:${err.message}`;
  }
}

const pragmaReport = {
  journal_mode: readPragma('journal_mode'),
  synchronous: readPragma('synchronous'),
  busy_timeout: readPragma('busy_timeout'),
  foreign_keys: readPragma('foreign_keys'),
};

/** 当前毫秒时间戳，全项目统一的时间来源 */
export function now() {
  return Date.now();
}

/**
 * 同步事务包装器。
 * 使用 BEGIN IMMEDIATE 抢占写锁，fn 必须是同步函数（事务内禁止 await）。
 * @template T
 * @param {() => T} fn 事务体
 * @returns {T}
 */
export function tx(fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('tx(fn) 需要一个函数');
  }
  db.exec('BEGIN IMMEDIATE');
  let result;
  try {
    result = fn();
    if (result && typeof result.then === 'function') {
      throw new Error('tx(fn) 必须是同步函数，事务内禁止使用 await');
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[db] rollback failed:', rollbackErr.message);
    }
    throw err;
  }
  return result;
}

let connectionClosed = false;

/** 幂等关闭数据库连接 */
export function closeDb() {
  if (connectionClosed) return;
  connectionClosed = true;
  try {
    db.close();
    console.log('[db] connection closed');
  } catch (err) {
    console.error('[db] close failed:', err.message);
  }
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    closeDb();
  });
}

console.log(`[db] opened ${DB_PATH}`);
console.log(
  `[db] pragma journal_mode=${pragmaReport.journal_mode} synchronous=${pragmaReport.synchronous} ` +
    `busy_timeout=${pragmaReport.busy_timeout} foreign_keys=${pragmaReport.foreign_keys}`,
);
