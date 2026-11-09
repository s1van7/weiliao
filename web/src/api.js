/**
 * 统一 fetch 封装：
 *   - 自动附加 Bearer token；
 *   - 统一解析 {ok, code, message, ...} 响应体；
 *   - 401 时触发登出回调；
 *   - 失败一律抛 ApiError（带 message / status / code / payload）。
 *
 * 与后端约定（见 server/routes/*.js）：成功 {ok:true, ...}，失败 {ok:false, code, message}。
 */
import { API_BASE, TOKEN_KEY } from './config';

/** 当前内存中的 token（store 初始化时用 setToken 同步） */
let currentToken = '';

try {
  currentToken = localStorage.getItem(TOKEN_KEY) || '';
} catch {
  currentToken = '';
}

/**
 * 同步 token 到请求层。
 * @param {string} token
 * @returns {void}
 */
export function setToken(token) {
  currentToken = typeof token === 'string' ? token : '';
}

/**
 * 读取请求层当前 token。
 * @returns {string}
 */
export function getToken() {
  return currentToken;
}

/** @type {(null | (() => void))} */
let unauthorizedHandler = null;

/**
 * 注册 401 处理器（store 用它执行自动登出）。
 * @param {() => void} handler
 * @returns {void}
 */
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = typeof handler === 'function' ? handler : null;
}

/** 接口错误：携带 HTTP 状态与后端错误码，便于页面差异化处理（如 423 锁定） */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   * @param {string} [code]
   * @param {Record<string, unknown>|null} [payload]
   */
  constructor(message, status = 0, code = 'ERROR', payload = null) {
    super(message || '请求失败');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

/**
 * 发起请求。
 * @param {string} path 以 / 开头的 API 路径（不含 /api 前缀）
 * @param {{method?: string, body?: unknown, query?: Record<string, unknown>, form?: FormData, timeout?: number}} [options]
 * @returns {Promise<Record<string, any>>}
 */
async function request(path, options = {}) {
  const { method = 'GET', body, query, form, timeout = 20000 } = options;

  let url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  if (query) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      search.append(key, String(value));
    }
    const qs = search.toString();
    if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`;
  }

  const headers = {};
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (currentToken) headers.Authorization = `Bearer ${currentToken}`;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: payload,
      signal: controller ? controller.signal : undefined,
      credentials: 'same-origin',
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    const aborted = err && err.name === 'AbortError';
    throw new ApiError(aborted ? '请求超时，请稍后重试' : '网络连接失败，请检查网络', 0, aborted ? 'TIMEOUT' : 'NETWORK');
  }
  if (timer) clearTimeout(timer);

  return parseHttpResponse(response);
}

/**
 * 解析 HTTP 响应：统一处理 401 登出与 {ok:false} 业务错误，供 request / requestRaw 复用。
 * @param {Response} response
 * @returns {Promise<Record<string, any>>}
 */
async function parseHttpResponse(response) {
  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }

  if (response.status === 401) {
    if (currentToken && unauthorizedHandler) unauthorizedHandler();
    throw new ApiError((data && data.message) || '登录状态已失效，请重新登录', 401, 'AUTH_INVALID', data);
  }

  if (!response.ok || (data && data.ok === false)) {
    throw new ApiError(
      (data && data.message) || `请求失败（HTTP ${response.status}）`,
      response.status,
      (data && data.code) || 'HTTP_ERROR',
      data,
    );
  }

  return data || {};
}

/**
 * 发送原始二进制请求体（application/octet-stream）。
 * 用于分片上传 /chunk：body 传 Blob，query 拼 file_id / index。
 * 超时固定 600000ms（大分片 / 弱网），token 注入与 401 处理与 request 完全一致。
 * @param {string} path 以 / 开头的 API 路径（不含 /api 前缀）
 * @param {Blob} blob 原始字节
 * @param {{query?: Record<string, unknown>}} [options]
 * @returns {Promise<Record<string, any>>}
 */
async function requestRaw(path, blob, options = {}) {
  const { query } = options;

  let url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  if (query) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      search.append(key, String(value));
    }
    const qs = search.toString();
    if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`;
  }

  const headers = { 'Content-Type': 'application/octet-stream' };
  if (currentToken) headers.Authorization = `Bearer ${currentToken}`;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 600000) : null;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: blob,
      signal: controller ? controller.signal : undefined,
      credentials: 'same-origin',
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    const aborted = err && err.name === 'AbortError';
    throw new ApiError(aborted ? '请求超时，请稍后重试' : '网络连接失败，请检查网络', 0, aborted ? 'TIMEOUT' : 'NETWORK');
  }
  if (timer) clearTimeout(timer);

  return parseHttpResponse(response);
}

/** 业务接口集合（字段名严格对齐后端路由实现） */
export const api = {
  /* ---------------- 认证 ---------------- */
  /** 登录：account 可为用户名或手机号 */
  login: (account, password) => request('/auth/login', { method: 'POST', body: { account, password } }),
  /** 注册：username 与 phone 二选一 */
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),

  /* ---------------- 我 ---------------- */
  me: () => request('/me'),
  updateMe: (patch) => request('/me', { method: 'PATCH', body: patch }),
  /** 修改用户名（微聊号）：一年仅可修改一次，服务端校验冷却期 */
  updateUsername: (username) => request('/me', { method: 'PATCH', body: { username } }),
  /** 修改密码 */
  changePassword: (oldPassword, newPassword) =>
    request('/me/password', { method: 'POST', body: { old_password: oldPassword, new_password: newPassword } }),
  /** 读取用户设置 */
  meSettings: () => request('/me/settings'),
  /** 更新用户设置（任意子集） */
  updateSettings: (patch) => request('/me/settings', { method: 'PATCH', body: patch }),
  /** 我的二维码（复用有效 token 或新建） */
  meQr: () => request('/me/qr'),
  /** 刷新二维码（吊销旧 token 并签发新 token） */
  refreshQr: () => request('/me/qr/refresh', { method: 'POST', body: {} }),
  /** 解析二维码 token */
  resolveQr: (token) => request('/qr/resolve', { method: 'POST', body: { token } }),

  /* ---------------- 用户搜索 ---------------- */
  searchUsers: (keyword) => request('/users/search', { query: { q: keyword } }),
  /** 查看指定用户资料与当前用户的关系（任何登录用户可查） */
  getUser: (id) => request(`/users/${id}`),

  /* ---------------- 好友 ---------------- */
  friends: () => request('/friends'),
  deleteFriend: (userId) => request(`/friends/${userId}`, { method: 'DELETE' }),
  sendFriendRequest: (toUserId, message, qrToken) =>
    request('/friends/requests', { method: 'POST', body: { to_user_id: toUserId, message, qr_token: qrToken } }),
  /** 设置 / 删除好友备注（两者均空 = 删除备注） */
  updateFriendNote: (userId, note) => request(`/friends/${userId}/note`, { method: 'PUT', body: note }),
  /** 设置 / 取消星标朋友（星标好友在通讯录置顶） */
  setFriendStarred: (userId, starred) =>
    request(`/friends/${userId}/star`, { method: 'PUT', body: { starred: Boolean(starred) } }),
  friendRequestCount: () => request('/friends/requests/count'),
  friendRequests: (direction = 'in', status = 'pending') =>
    request('/friends/requests', { query: { direction, status } }),
  acceptFriendRequest: (id) => request(`/friends/requests/${id}/accept`, { method: 'POST', body: {} }),
  rejectFriendRequest: (id) => request(`/friends/requests/${id}/reject`, { method: 'POST', body: {} }),
  /** 读取「我对该好友」的朋友权限（生效值） */
  friendsPermission: (userId) => request(`/friends/${userId}/permission`),
  /** 更新「我对该好友」的朋友权限（字段可选布尔） */
  updateFriendsPermission: (userId, patch) =>
    request(`/friends/${userId}/permission`, { method: 'PUT', body: patch }),

  /* ---------------- 会话 ---------------- */
  conversations: () => request('/conversations'),
  createSingleConversation: (userId) =>
    request('/conversations/single', { method: 'POST', body: { user_id: userId } }),
  createGroupConversation: (memberIds, name = '', sourceGroupId = null) =>
    request('/conversations/group', {
      method: 'POST',
      body: sourceGroupId
        ? { member_ids: memberIds, name, source_group_id: sourceGroupId }
        : { member_ids: memberIds, name },
    }),
  conversationDetail: (id) => request(`/conversations/${id}`),
  addGroupMembers: (id, userIds) =>
    request(`/conversations/${id}/members`, { method: 'POST', body: { user_ids: userIds } }),
  leaveGroup: (id) => request(`/conversations/${id}/members/me`, { method: 'DELETE' }),
  readConversation: (id, lastMessageId) =>
    request(`/conversations/${id}/read`, { method: 'POST', body: { last_message_id: lastMessageId } }),
  /** 会话偏好：{ pinned?, hidden?, unread?, clear? }，任一子集，返回 { conversation, prefs } */
  setConversationPrefs: (id, payload) =>
    request(`/conversations/${id}/prefs`, { method: 'PATCH', body: payload || {} }),
  unreadTotal: () => request('/unread/total'),

  /* ---------------- 消息 ---------------- */
  messages: (conversationId, { beforeId, afterId, limit } = {}) =>
    request(`/conversations/${conversationId}/messages`, {
      query: { before_id: beforeId, after_id: afterId, limit },
    }),
  sendMessage: (conversationId, payload) =>
    request(`/conversations/${conversationId}/messages`, { method: 'POST', body: payload }),
  syncMessages: (afterId) => request('/messages/sync', { query: { after_id: afterId } }),
  revokeMessage: (messageId) => request(`/messages/${messageId}/revoke`, { method: 'POST', body: {} }),
  /** 消息全文搜索（我参与的会话 + content/file_name LIKE + before_id 游标） */
  searchMessages: ({ q, type, before_id, limit } = {}) =>
    request('/messages/search', { query: { q, type, before_id, limit } }),

  /* ---------------- 群管理（群主 / 管理员） ---------------- */
  /** 改群名 / 群头像（avatar_url 传空串表示清除，回落到 2x2 色块） */
  updateConversation: (id, patch) => request(`/conversations/${id}`, { method: 'PATCH', body: patch }),
  /** 写群公告（空串 = 清除） */
  updateAnnouncement: (id, text) =>
    request(`/conversations/${id}/announcement`, { method: 'PUT', body: { text } }),
  /** 标记群公告已读（清零红点） */
  readAnnouncement: (id) => request(`/conversations/${id}/announcement/read`, { method: 'POST', body: {} }),
  /** 三个群权限开关（仅群主） */
  updatePermissions: (id, patch) =>
    request(`/conversations/${id}/permissions`, { method: 'PATCH', body: patch }),
  /** 设 / 取消管理员（仅群主） */
  setMemberRole: (id, userId, role) =>
    request(`/conversations/${id}/members/${userId}/role`, { method: 'PUT', body: { role } }),
  /** 移除成员（群主 / 管理员，规则由服务端 groupAuth 判定） */
  removeMember: (id, userId) => request(`/conversations/${id}/members/${userId}`, { method: 'DELETE' }),

  /* ---------------- 自定义表情 ---------------- */
  stickers: () => request('/stickers'),
  addSticker: (url) => request('/stickers', { method: 'POST', body: { url } }),
  deleteSticker: (id) => request(`/stickers/${id}`, { method: 'DELETE' }),

  /* ---------------- 朋友圈 ---------------- */
  moments: ({ beforeId, limit, userId } = {}) =>
    request('/moments', { query: { before_id: beforeId, limit, user_id: userId } }),
  createMoment: (payload) => request('/moments', { method: 'POST', body: payload }),
  deleteMoment: (id) => request(`/moments/${id}`, { method: 'DELETE' }),
  likeMoment: (id) => request(`/moments/${id}/like`, { method: 'POST', body: {} }),
  unlikeMoment: (id) => request(`/moments/${id}/like`, { method: 'DELETE' }),
  addMomentComment: (id, content) =>
    request(`/moments/${id}/comments`, { method: 'POST', body: { content } }),
  deleteMomentComment: (id, commentId) =>
    request(`/moments/${id}/comments/${commentId}`, { method: 'DELETE' }),

  /* ---------------- 收藏 ---------------- */
  createFavorite: (contentType, contentId) =>
    request('/favorites', { method: 'POST', body: { content_type: contentType, content_id: contentId } }),
  favorites: ({ beforeId, limit } = {}) => request('/favorites', { query: { before_id: beforeId, limit } }),
  deleteFavorite: (id) => request(`/favorites/${id}`, { method: 'DELETE' }),

  /* ---------------- 上传 ---------------- */
  /** 上传聊天图片（不限大小，jpg/png/gif/webp） */
  uploadImage: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/upload/image', { method: 'POST', form, timeout: 600000 });
  },
  /** 上传头像（服务端独立端点，硬限 2MB，仅 jpg/png/webp） */
  uploadAvatar: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/upload/avatar', { method: 'POST', form, timeout: 600000 });
  },
  /** 上传自定义表情（不限大小，jpg/png/gif/webp） */
  uploadSticker: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/upload/sticker', { method: 'POST', form, timeout: 600000 });
  },
  /** 上传群头像（服务端硬限 2MB，jpg/png/webp） */
  uploadGroupAvatar: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/upload/group-avatar', { method: 'POST', form, timeout: 600000 });
  },
  /** 上传视频（不限大小与时长，仅 mp4） */
  uploadVideo: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/upload/video', { method: 'POST', form, timeout: 600000 });
  },
  /** 上传语音（服务端硬限 10MB / 60s，webm|mp4；duration 必须先于 file append） */
  uploadVoice: (file, duration) => {
    const form = new FormData();
    form.append('duration', String(duration));
    form.append('file', file);
    return request('/upload/voice', { method: 'POST', form, timeout: 600000 });
  },
  /** 上传音频（mp3/wav/m4a/aac/ogg/webm，不限大小） */
  uploadAudio: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/upload/audio', { method: 'POST', form, timeout: 600000 });
  },
  /** 上传通用文件（任意类型不限大小，返回 {url, file_name, file_size}） */
  uploadFile: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/upload/file', { method: 'POST', form, timeout: 600000 });
  },
  /** 设置会话聊天背景（'' | /uploads/<image> | #RRGGBB） */
  updateConversationBackground: (id, backgroundUrl) =>
    request(`/conversations/${id}/background`, { method: 'PUT', body: { background_url: backgroundUrl } }),

  /* ---------------- 通话 / 语音 ---------------- */
  /** 获取动态 ICE（STUN + 按需 TURN），失败时前端回退 RTC_ICE_SERVERS */
  rtcConfig: () => request('/rtc-config'),
  /** 语音转文字：传 message_id 或 url，返回 {text, message_id} */
  voiceTranscribe: (payload) => request('/voice/transcribe', { method: 'POST', body: payload, timeout: 600000 }),

  /* ---------------- 发现页配置 ---------------- */
  /** 读取发现页配置（无行返回默认三项） */
  settingsDiscover: () => request('/settings/discover'),
  /** 更新发现页配置（恰好三项，key 唯一，sort 0..2 唯一） */
  updateSettingsDiscover: (config) => request('/settings/discover', { method: 'PUT', body: { config } }),

  /* ---------------- 分片上传 ---------------- */
  /** 初始化 / 续传 / 秒传判断 */
  uploadInit: (payload) => request('/upload/init', { method: 'POST', body: payload }),
  /** 上传单个分片（raw body） */
  uploadChunk: (fileId, index, blob) => requestRaw('/upload/chunk', blob, { query: { file_id: fileId, index } }),
  /** 完成分片上传：合并 + 校验 + 落库 */
  uploadComplete: (fileId) => request('/upload/complete', { method: 'POST', body: { file_id: fileId } }),

  /* ---------------- 面对面配对 ---------------- */
  /** 创建面对面配对（返回 4 位数字码） */
  facePairCreate: (kind) => request('/face-pair/create', { method: 'POST', body: { kind } }),
  /** 加入面对面配对 */
  facePairJoin: (kind, code) => request('/face-pair/join', { method: 'POST', body: { kind, code } }),
  /** 面对面配对详情 */
  facePairDetail: (id) => request(`/face-pair/${id}`),
  /** 面对面建群成组 */
  facePairCreateGroup: (pairingId) =>
    request('/face-pair/group', { method: 'POST', body: { pairing_id: pairingId } }),

  /* ---------------- 群邀请 ---------------- */
  /** 生成 / 刷新群邀请（refresh=true 时吊销旧码并签发新码） */
  createGroupInvite: (id, refresh = false) =>
    request(`/conversations/${id}/invite`, { method: 'POST', body: { refresh } }),
  /** 解析群邀请 */
  resolveGroupInvite: (token) => request('/group-invites/resolve', { method: 'POST', body: { token } }),
  /** 通过群邀请入群 */
  joinGroupInvite: (token) => request('/group-invites/join', { method: 'POST', body: { token } }),

  /* ---------------- 应用更新 ---------------- */
  /** 拉取最新版本号 / 更新说明 / 三端安装包地址（不鉴权） */
  checkUpdate: () => request('/app/latest'),
};

export default api;
