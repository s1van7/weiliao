PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  signature TEXT NOT NULL DEFAULT '',
  avatar_color TEXT NOT NULL DEFAULT '#07C160',
  -- 自定义头像地址（/uploads/xxx.jpg 形式），空串表示未设置、回退到纯色头像
  avatar_url TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  -- 用户名（微聊号）最近一次修改时间：0 表示从未修改，允许随时改；否则 365 天内不可再改
  username_changed_at INTEGER NOT NULL DEFAULT 0,
  CHECK (username IS NOT NULL OR phone IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_low_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_high ON friendships(user_high_id);
CREATE TABLE IF NOT EXISTS friend_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fr_to_status ON friend_requests(to_user_id, status);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  pair_key TEXT UNIQUE,
  name TEXT,
  owner_id INTEGER,
  last_message_at INTEGER NOT NULL DEFAULT 0,
  last_message_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_last ON conversations(last_message_at DESC);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  -- 会话级个人偏好（只作用于本人这一行，不影响其他成员）
  -- pinned=置顶；hidden/hidden_at=隐藏及隐藏时间戳（有更新消息则重新浮现）
  -- cleared_before_id=删除聊天时的会话最大 message id（历史只查 id > 该值）
  -- manual_unread=手动标记未读（列表纯红点无数字）
  pinned INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  hidden_at INTEGER NOT NULL DEFAULT 0,
  cleared_before_id INTEGER NOT NULL DEFAULT 0,
  manual_unread INTEGER NOT NULL DEFAULT 0,
  -- muted=消息免打扰（不响铃、不弹通知，未读只显示小红点）
  muted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cm_user ON conversation_members(user_id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL DEFAULT '',
  client_id TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
-- client_id 由发送方本地生成，不同发送者可能撞车：唯一性以 (会话, 发送者, client_id) 为准。
-- 先 DROP 旧索引，保证老库自动迁移到新结构。
DROP INDEX IF EXISTS uq_msg_client;
CREATE UNIQUE INDEX IF NOT EXISTS uq_msg_client ON messages(conversation_id, sender_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_msg_conv_id ON messages(conversation_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_msg_id ON messages(id);

-- ------------------------------------------------------------------
-- 自定义表情：不限制数量，按 id DESC（新→旧）即为展示顺序，
-- 因此不设 sort 列，省掉整表重排写。
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_stickers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stickers_user ON user_stickers(user_id, id DESC);

-- ------------------------------------------------------------------
-- 朋友圈：图片走关联表（seq 保序 + ON DELETE CASCADE），
-- 点赞主键 (moment_id,user_id) 天然幂等。
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS moments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moments_user ON moments(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_moments_id ON moments(id DESC);
CREATE TABLE IF NOT EXISTS moment_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moment_id INTEGER NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_moment_images ON moment_images(moment_id, seq);
CREATE TABLE IF NOT EXISTS moment_likes (
  moment_id INTEGER NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (moment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_moment_likes_user ON moment_likes(user_id);
CREATE TABLE IF NOT EXISTS moment_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moment_id INTEGER NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moment_comments ON moment_comments(moment_id, id ASC);

-- ------------------------------------------------------------------
-- 好友备注（remark_name 优先于昵称展示）
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS friend_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remark_name TEXT NOT NULL DEFAULT '',
  remark_phone TEXT NOT NULL DEFAULT '',
  -- starred=星标朋友（通讯录置顶展示）
  starred INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE (owner_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friend_notes_owner ON friend_notes(owner_id);

-- ------------------------------------------------------------------
-- 用户设置：通知 / 声音 / 震动 / 加好友方式 / 深色模式
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  notification_enabled INTEGER NOT NULL DEFAULT 1,
  sound_enabled INTEGER NOT NULL DEFAULT 1,
  vibrate_enabled INTEGER NOT NULL DEFAULT 1,
  friend_request_mode TEXT NOT NULL DEFAULT 'all',
  dark_mode INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- ------------------------------------------------------------------
-- 收藏：snapshot_json 整段快照，源内容删除后仍可查看
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  content_id INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id, created_at DESC);

-- ------------------------------------------------------------------
-- 二维码令牌：expires_at=0 表示长期有效，刷新时吊销旧 token
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_qr_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qr_tokens_user ON user_qr_tokens(user_id);

-- ------------------------------------------------------------------
-- 分片上传：upload_files 记录每次大文件上传的会话状态。
-- 秒传 / 断点续传都靠 (hash, status) 索引定位；user_id 不落表，
-- 同一 hash 的最终文件可跨账号共享（服务端只存一份）。
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS upload_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunk_size INTEGER NOT NULL,
  chunk_total INTEGER NOT NULL,
  uploaded_chunks TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'uploading',
  final_url TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upload_files_hash ON upload_files(hash);
CREATE INDEX IF NOT EXISTS idx_upload_files_status ON upload_files(status);

-- ------------------------------------------------------------------
-- 发现页配置：账号维度的开关 + 排序，config_json 存 [{key,enabled,sort}]。
-- user_id 唯一约束本身会建索引（第 3 个索引），无需另建。
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discover_config (
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  config_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ------------------------------------------------------------------
-- 朋友权限（方向：owner_id 对 friend_id 的权限，即「我对该好友」）
-- hide_my_moments=不让他看我的朋友圈；hide_his_moments=不看他朋友圈
-- chat_only=仅聊天（等价 ①+② 同时生效）；blocked=加入黑名单（拉黑）
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS friend_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hide_my_moments INTEGER NOT NULL DEFAULT 0,
  hide_his_moments INTEGER NOT NULL DEFAULT 0,
  chat_only INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE (owner_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friend_permissions_owner ON friend_permissions(owner_id);
CREATE INDEX IF NOT EXISTS idx_friend_permissions_friend ON friend_permissions(friend_id);

-- ------------------------------------------------------------------
-- 面对面配对：code=4位数字，5分钟有效；kind=file|group
-- file 上限 2 人（1对1传文件）；group 不限人数（成组需≥3含自己）
-- code 不做全局唯一约束（可跨时间复用），应用层保证 (kind,code) 在有效期内唯一
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS face_pairings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_face_pairings_active ON face_pairings(kind, code, expires_at, resolved);

CREATE TABLE IF NOT EXISTS face_pairing_members (
  pairing_id INTEGER NOT NULL REFERENCES face_pairings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (pairing_id, user_id)
);

-- ------------------------------------------------------------------
-- 群邀请令牌：默认 7 天有效；refresh 吊销旧 token
-- 二维码内容 = 'wlgroup:' + token（与用户名片码原文 token 区分）
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_group_invites_conv ON group_invites(conversation_id);
