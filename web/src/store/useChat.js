/**
 * 会话与消息 store。
 *
 * 关键约定：
 *   - messagesByConv 按会话缓存，消息去重依据 id 与 client_id；
 *   - 自己发送的消息先插入乐观条目（_status = 'sending'），REST 成功后替换为服务端消息；
 *   - 收到别人对自己消息的 message:read 后，把 id <= last_message_id 的己方消息标记为已读；
 *   - 所有接口调用失败都会抛错，由页面/全局兜底提示。
 */
import { create } from 'zustand';
import { api } from '../api';
import { useAuth, setUserUpdateSink } from './useAuth';
import { subscribeConversation } from '../socket';
import { compressImage } from '../lib/format';
import { UPLOAD_CHUNK_SIZE } from '../config';
import { uploadFileChunked } from '../lib/uploadChunked';
import { readVideoDuration } from '../lib/videoDuration';
import { forwardPayloadOf, mergedContentOf } from '../lib/forward';

/** 单页消息条数 */
const PAGE_SIZE = 30;

/**
 * 当前用户 id（从 auth store 同步读取，避免循环 import）。
 * @returns {number}
 */
function currentUserId() {
  const user = useAuth.getState().user;
  return user ? Number(user.id) : 0;
}

/**
 * 当前用户基础信息（用于乐观消息渲染）。
 * @returns {{id: number, nickname: string, avatar_color: string, avatar_url: string}}
 */
function currentProfile() {
  const user = useAuth.getState().user;
  if (!user) return { id: 0, nickname: '', avatar_color: '#07C160', avatar_url: '' };
  return {
    id: Number(user.id),
    nickname: user.nickname || '',
    avatar_color: user.avatar_color || '#07C160',
    avatar_url: user.avatar_url || '',
  };
}

/**
 * 会话列表排序：置顶优先，其次最近消息时间倒序，最后 id 倒序。
 * 与服务端 GET /conversations 的 ORDER BY mine.pinned DESC, last_message_at DESC, id DESC 保持一致。
 * @param {Array<Record<string, any>>} list
 * @returns {Array<Record<string, any>>}
 */
function sortConversations(list) {
  return [...list].sort((a, b) => {
    const pinnedDiff = (b.pinned === true ? 1 : 0) - (a.pinned === true ? 1 : 0);
    if (pinnedDiff !== 0) return pinnedDiff;
    const diff = (Number(b.last_message_at) || 0) - (Number(a.last_message_at) || 0);
    return diff !== 0 ? diff : Number(b.id) - Number(a.id);
  });
}

/**
 * 消息排序：按 created_at 升序（稳定排序，同毫秒保持插入顺序）。
 * @param {Array<Record<string, any>>} list
 * @returns {Array<Record<string, any>>}
 */
function sortMessages(list) {
  return [...list].sort((a, b) => (Number(a.created_at) || 0) - (Number(b.created_at) || 0));
}

/**
 * 合并单条消息（按 client_id / id 去重）。
 * @param {Array<Record<string, any>>} list
 * @param {Record<string, any>} incoming
 * @returns {Array<Record<string, any>>}
 */
function mergeMessage(list, incoming) {
  const index = list.findIndex(
    (item) =>
      (incoming.client_id && item.client_id && item.client_id === incoming.client_id) ||
      (typeof item.id === 'number' && item.id === incoming.id),
  );

  if (index < 0) return sortMessages([...list, incoming]);

  const prev = list[index];
  const next = [...list];
  next[index] = { ...prev, ...incoming, _status: incoming._status || prev._status };
  return next;
}

/**
 * 删除对象的某个 key（不可变）。
 * @param {Record<string, any>} source
 * @param {string|number} key
 * @returns {Record<string, any>}
 */
function omitKey(source, key) {
  const next = { ...source };
  delete next[key];
  return next;
}

/**
 * 生成 client_id，用于消息幂等去重。
 * @returns {string}
 */
function makeClientId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 会话是否只读（单聊且已不是好友）。
 * @param {Array<Record<string, any>>} list
 * @param {number} conversationId
 * @returns {boolean}
 */
function isReadonlyConversation(list, conversationId) {
  const conversation = list.find((item) => item.id === conversationId);
  return Boolean(conversation && conversation.type === 'single' && conversation.readonly);
}

/** 只读会话的发送拦截提示 */
const READONLY_MESSAGE = '已不是好友，仅可查看历史消息';

/**
 * 构造乐观消息。
 * @param {number} conversationId
 * @param {{type: string, content: string, mentions?: {all: boolean, ids: number[]}|null}} payload
 * @param {string} clientId
 * @returns {Record<string, any>}
 */
function buildOptimistic(conversationId, payload, clientId) {
  const me = currentProfile();
  return {
    id: `tmp-${clientId}`,
    conversation_id: conversationId,
    sender_id: me.id,
    sender_nickname: me.nickname,
    sender_avatar_color: me.avatar_color,
    sender_avatar_url: me.avatar_url,
    type: payload.type,
    content: payload.content,
    mentions: payload.mentions || null,
    // 语音：乐观消息直接带本地 blob url + 时长，便于立即播放
    voice_url: payload.voice_url ?? (payload.type === 'voice' ? payload.content : ''),
    voice_duration: payload.voice_duration ?? 0,
    // 视频：乐观消息带本地 blob url，便于立即渲染首帧 / 播放
    video_url: payload.video_url ?? (payload.type === 'video' ? payload.content : ''),
    video_duration: payload.video_duration ?? 0,
    // 文件：乐观消息带文件名 / 大小，content 存本地 blob url
    file_url: payload.file_url ?? (payload.type === 'file' ? payload.content : ''),
    file_name: payload.file_name ?? '',
    file_size: payload.file_size ?? 0,
    client_id: clientId,
    revoked: 0,
    created_at: Date.now(),
    _status: 'sending',
    _local: true,
  };
}

export const useChat = create((set, get) => ({
  conversations: [],
  activeId: null,
  messagesByConv: {},
  hasMoreByConv: {},
  /** 会话详情缓存（GET /conversations/:id，含成员 / 群权限 / 公告），供群设置页与 @ 选择器复用 */
  detailsByConv: {},
  unreadTotal: 0,
  typingByConv: {},
  onlineByUser: {},
  friends: [],
  friendRequests: [],
  pendingRequestCount: 0,
  loadingConversations: false,
  loadingMessages: false,
  loadingOlder: false,
  /** 分片上传进度：clientId -> {clientId, conversationId, file, loaded, total, percent, status, error} */
  uploadsByClientId: {},
  /** 正在转写的消息 id（供气泡渲染 loading） */
  transcribingId: null,

  /* ------------------------- 会话 ------------------------- */

  /**
   * 拉取会话列表（服务端已按 last_message_at 倒序）。
   * @returns {Promise<void>}
   */
  loadConversations: async () => {
    set({ loadingConversations: true });
    try {
      const data = await api.conversations();
      const conversations = sortConversations(data.conversations || []);
      set({
        conversations,
        unreadTotal: conversations.reduce((sum, item) => sum + (Number(item.unread_count) || 0), 0),
        loadingConversations: false,
      });
    } catch (err) {
      set({ loadingConversations: false });
      throw err;
    }
  },

  /**
   * 以服务端为准刷新未读总数。
   * @returns {Promise<void>}
   */
  refreshUnread: async () => {
    try {
      const data = await api.unreadTotal();
      if (typeof data.total === 'number') set({ unreadTotal: data.total });
    } catch {
      /* 忽略：后续事件会修正 */
    }
  },

  /**
   * 打开会话：订阅房间 → 拉首屏 30 条 → 标记已读。
   * @param {number|string} conversationId
   * @returns {Promise<void>}
   */
  openConversation: async (conversationId) => {
    const convId = Number(conversationId);
    if (!Number.isInteger(convId) || convId <= 0) return;

    set({ activeId: convId, loadingMessages: !get().messagesByConv[convId] });
    subscribeConversation(convId);

    if (!get().conversations.some((item) => item.id === convId)) {
      await get().ensureConversation(convId);
    }
    if (!get().messagesByConv[convId]) {
      await get().loadMessages(convId);
    }
    await get().markRead(convId);
  },

  /**
   * 离开聊天页。
   * @returns {void}
   */
  closeConversation: () => set({ activeId: null }),

  /**
   * 确保会话存在于列表中（新建单聊 / 群聊后的兜底）。
   * @param {number} conversationId
   * @returns {Promise<void>}
   */
  ensureConversation: async (conversationId) => {
    try {
      await get().loadConversations();
    } catch {
      /* 忽略：继续尝试详情接口 */
    }
    if (get().conversations.some((item) => item.id === conversationId)) return;

    try {
      const data = await api.conversationDetail(conversationId);
      const detail = data.conversation;
      if (!detail) return;
      const myId = currentUserId();
      const members = detail.members || [];
      const peerMember = members.find((member) => member.user_id !== myId);
      const conversation = {
        id: Number(detail.id),
        type: detail.type,
        name: detail.name || null,
        owner_id: detail.owner_id,
        last_message_at: 0,
        unread_count: 0,
        member_count: members.length,
        readonly: Boolean(detail.readonly),
        peer:
          detail.type === 'single' && peerMember
            ? {
                id: peerMember.user_id,
                nickname: peerMember.nickname || '',
                avatar_color: peerMember.avatar_color || '#07C160',
                avatar_url: peerMember.avatar_url || '',
              }
            : null,
        last_message: null,
      };
      set((state) => ({ conversations: sortConversations([...state.conversations, conversation]) }));
    } catch (err) {
      console.warn('[chat] ensureConversation failed:', err && err.message);
    }
  },

  /**
   * 拉取最近一页消息。
   * @param {number} conversationId
   * @returns {Promise<void>}
   */
  loadMessages: async (conversationId) => {
    set({ loadingMessages: true });
    try {
      const data = await api.messages(conversationId, { limit: PAGE_SIZE });
      const myId = currentUserId();
      const messages = (data.messages || []).map((message) => ({
        ...message,
        _status: message.sender_id === myId ? 'sent' : undefined,
      }));
      set((state) => ({
        messagesByConv: { ...state.messagesByConv, [conversationId]: messages },
        hasMoreByConv: { ...state.hasMoreByConv, [conversationId]: Boolean(data.has_more) },
        loadingMessages: false,
      }));
    } catch (err) {
      set({ loadingMessages: false });
      throw err;
    }
  },

  /**
   * 向上翻页加载更早消息。
   * @returns {Promise<boolean>} 是否真的加载了
   */
  loadOlder: async () => {
    const conversationId = get().activeId;
    if (!conversationId || get().loadingOlder) return false;
    if (!get().hasMoreByConv[conversationId]) return false;

    const list = get().messagesByConv[conversationId] || [];
    const first = list.find((message) => typeof message.id === 'number');
    if (!first) return false;

    set({ loadingOlder: true });
    try {
      const data = await api.messages(conversationId, { beforeId: first.id, limit: PAGE_SIZE });
      const myId = currentUserId();
      const older = (data.messages || []).map((message) => ({
        ...message,
        _status: message.sender_id === myId ? 'sent' : undefined,
      }));
      set((state) => {
        const existing = state.messagesByConv[conversationId] || [];
        const existingIds = new Set(existing.map((message) => message.id));
        const merged = [...older.filter((message) => !existingIds.has(message.id)), ...existing];
        return {
          messagesByConv: { ...state.messagesByConv, [conversationId]: merged },
          hasMoreByConv: { ...state.hasMoreByConv, [conversationId]: Boolean(data.has_more) },
          loadingOlder: false,
        };
      });
      return true;
    } catch (err) {
      set({ loadingOlder: false });
      throw err;
    }
  },

  /**
   * 标记会话已读：本地立即清零，再同步服务端。
   * @param {number} [conversationId]
   * @returns {Promise<void>}
   */
  markRead: async (conversationId) => {
    const convId = Number(conversationId || get().activeId);
    if (!Number.isInteger(convId) || convId <= 0) return;

    const list = get().messagesByConv[convId] || [];
    const lastId = list.reduce((max, message) => {
      const id = typeof message.id === 'number' ? message.id : 0;
      return id > max ? id : max;
    }, 0);

    set((state) => {
      const conversations = state.conversations.map((item) =>
        // 进入会话即视为已看到 @ 提醒与「手动标记未读」，本地同步清掉
        item.id === convId
          ? { ...item, unread_count: 0, mentioned: false, manual_unread: false }
          : item,
      );
      return {
        conversations,
        unreadTotal: conversations.reduce((sum, item) => sum + (Number(item.unread_count) || 0), 0),
      };
    });

    try {
      const data = await api.readConversation(convId, lastId);
      if (data && typeof data.unread_total === 'number') set({ unreadTotal: data.unread_total });
    } catch (err) {
      console.warn('[chat] markRead failed:', err && err.message);
    }
  },

  /* ------------------------- 发送 ------------------------- */

  /**
   * 发送文本消息（可携带 @ 信息）。
   * @param {string} text 正文
   * @param {{all: boolean, ids: number[]}|null} [mentions] @ 目标；无 @ 时传 null
   * @returns {Promise<Record<string, any>|null>}
   */
  sendText: async (text, mentions = null) => {
    const content = String(text || '').trim();
    const conversationId = get().activeId;
    if (!content || !conversationId) return null;

    const payload = { type: 'text', content };
    if (mentions && (mentions.all === true || (Array.isArray(mentions.ids) && mentions.ids.length > 0))) {
      payload.mentions = { all: mentions.all === true, ids: (mentions.ids || []).map(Number) };
    }
    return get()._send(conversationId, payload);
  },

  /**
   * 发送自定义表情：content 是图片地址，type = 'sticker'。
   * 复用 _send 的乐观消息 + client_id 幂等管线。
   * @param {string} url 表情图片地址（/uploads/xxx.png）
   * @returns {Promise<Record<string, any>|null>}
   */
  sendSticker: async (url) => {
    const content = String(url || '').trim();
    const conversationId = get().activeId;
    if (!content || !conversationId) return null;
    return get()._send(conversationId, { type: 'sticker', content });
  },

  /**
   * 发送名片消息：content 传最小 JSON，服务端会校验并回填昵称/头像。
   * @param {number|string} userId 名片用户 id
   * @returns {Promise<Record<string, any>|null>}
   */
  sendCard: async (userId) => {
    const conversationId = get().activeId;
    const targetId = Number(userId);
    if (!Number.isInteger(targetId) || targetId <= 0 || !conversationId) return null;
    const content = JSON.stringify({ type: 'card', user_id: targetId });
    return get()._send(conversationId, { type: 'card', content });
  },

  /**
   * 把某位好友的名片分享到指定会话（好友信息页「分享名片」）。
   * 与 sendCard 的区别：目标会话可显式指定，不依赖当前 activeId。
   * @param {number|string} conversationId 目标会话 id
   * @param {number|string} userId 被分享名片的好友 id
   * @returns {Promise<Record<string, any>|null>}
   */
  shareCard: async (conversationId, userId) => {
    const convId = Number(conversationId);
    const targetId = Number(userId);
    if (!Number.isInteger(convId) || convId <= 0 || !Number.isInteger(targetId) || targetId <= 0) return null;
    const content = JSON.stringify({ type: 'card', user_id: targetId });
    return get()._send(convId, { type: 'card', content });
  },

  /**
   * 逐条转发单条消息到目标会话（sender=当前用户，媒体复用地址不重传）。
   * @param {number|string} conversationId 目标会话 id
   * @param {Record<string, any>} message 原消息
   * @returns {Promise<Record<string, any>|null>}
   */
  forwardMessage: async (conversationId, message) => {
    const convId = Number(conversationId);
    if (!Number.isInteger(convId) || convId <= 0 || !message) return null;
    const payload = forwardPayloadOf(message);
    if (!payload) throw new Error('暂不支持转发该消息');
    return get()._forward(convId, payload);
  },

  /**
   * 多选逐条转发：把选中的消息依次作为新消息发到目标会话。
   * @param {number|string} conversationId 目标会话 id
   * @param {Array<Record<string, any>>} messages 被选中的消息
   * @returns {Promise<Array<Record<string, any>|null>>}
   */
  forwardMessages: async (conversationId, messages) => {
    const convId = Number(conversationId);
    if (!Number.isInteger(convId) || convId <= 0) return [];
    const list = (Array.isArray(messages) ? messages : []).filter(Boolean);
    const results = [];
    for (const message of list) {
      const payload = forwardPayloadOf(message);
      if (!payload) continue;
      results.push(await get()._forward(convId, payload));
    }
    return results;
  },

  /**
   * 合并转发：把选中消息快照成一条 type='merged' 卡片消息。
   * @param {number|string} conversationId 目标会话 id
   * @param {Array<Record<string, any>>} items 被合并的消息
   * @param {string} [title] 标题（无 sourceInfo 时使用）
   * @param {Record<string, any>|null} [sourceInfo] 源会话信息 {type,name,peer,id}
   * @returns {Promise<Record<string, any>|null>}
   */
  sendMerged: async (conversationId, items, title = '', sourceInfo = null) => {
    const convId = Number(conversationId);
    if (!Number.isInteger(convId) || convId <= 0) return null;
    const list = (Array.isArray(items) ? items : []).filter(Boolean);
    if (list.length === 0) return null;
    const source =
      sourceInfo && typeof sourceInfo === 'object'
        ? sourceInfo
        : { type: 'single', title: title || undefined };
    const content = mergedContentOf(list, source);
    if (!content) throw new Error('没有可合并转发的消息');
    return get()._forward(convId, { type: 'merged', content });
  },

  /**
   * 发送图片：canvas 压缩（长边 1600 / q0.8）→ 上传 → 发消息。
   * @param {File} file
   * @returns {Promise<Record<string, any>|null>}
   */
  sendImage: async (file) => {
    const conversationId = get().activeId;
    if (!file || !conversationId) return null;
    if (isReadonlyConversation(get().conversations, conversationId)) {
      throw new Error(READONLY_MESSAGE);
    }

    const clientId = makeClientId();
    const localUrl = typeof URL !== 'undefined' ? URL.createObjectURL(file) : '';
    get()._append(conversationId, buildOptimistic(conversationId, { type: 'image', content: localUrl }, clientId));

    try {
      const compressed = await compressImage(file);
      const uploaded = await api.uploadImage(compressed);
      if (!uploaded || !uploaded.url) throw new Error('图片上传失败');
      const data = await api.sendMessage(conversationId, {
        type: 'image',
        content: uploaded.url,
        client_id: clientId,
      });
      get()._replace(conversationId, clientId, data.message);
      get()._bumpSummary(conversationId, data.message);
      if (localUrl) URL.revokeObjectURL(localUrl);
      return data.message;
    } catch (err) {
      get()._fail(conversationId, clientId);
      if (localUrl) URL.revokeObjectURL(localUrl);
      throw err;
    }
  },

  /**
   * 发送语音消息：上传 webm|mp4 → 发 voice 消息（带 voice_duration）。
   * 乐观消息使用本地 blob url 供即时播放，上传成功后替换为 /uploads 地址。
   * @param {File|Blob} file 归一化后的语音 Blob（audio/webm|audio/mp4）
   * @param {number} duration 时长（秒）
   * @returns {Promise<Record<string, any>|null>}
   */
  sendVoice: async (file, duration) => {
    const conversationId = get().activeId;
    if (!file || !conversationId) return null;
    if (isReadonlyConversation(get().conversations, conversationId)) {
      throw new Error(READONLY_MESSAGE);
    }

    const seconds = Math.min(60, Math.max(1, Math.round(Number(duration) || 1)));
    const clientId = makeClientId();
    const localUrl = typeof URL !== 'undefined' ? URL.createObjectURL(file) : '';
    get()._append(
      conversationId,
      buildOptimistic(
        conversationId,
        { type: 'voice', content: localUrl, voice_url: localUrl, voice_duration: seconds },
        clientId,
      ),
    );

    try {
      const uploaded = await api.uploadVoice(file, seconds);
      if (!uploaded || !uploaded.url) throw new Error('语音上传失败');
      const data = await api.sendMessage(conversationId, {
        type: 'voice',
        content: uploaded.url,
        voice_duration: uploaded.duration || seconds,
        client_id: clientId,
      });
      get()._replace(conversationId, clientId, data.message);
      get()._bumpSummary(conversationId, data.message);
      if (localUrl) URL.revokeObjectURL(localUrl);
      return data.message;
    } catch (err) {
      get()._fail(conversationId, clientId);
      if (localUrl) URL.revokeObjectURL(localUrl);
      throw err;
    }
  },

  /**
   * 发送视频消息：上传 mp4 → 发 video 消息（带 video_duration）。
   * 乐观消息使用本地 blob url 供即时播放，上传成功后替换为 /uploads 地址。
   * @param {File} file
   * @returns {Promise<Record<string, any>|null>}
   */
  sendVideo: async (file) => {
    const conversationId = get().activeId;
    if (!file || !conversationId) return null;
    if (isReadonlyConversation(get().conversations, conversationId)) {
      throw new Error(READONLY_MESSAGE);
    }

    const clientId = makeClientId();
    const localUrl = typeof URL !== 'undefined' ? URL.createObjectURL(file) : '';
    get()._append(
      conversationId,
      buildOptimistic(conversationId, { type: 'video', content: localUrl, video_duration: 0 }, clientId),
    );

    // 小视频走旧单次上传（服务端解析时长）；超过 5MB 走分片管线，前端读取本地时长
    if (file.size <= UPLOAD_CHUNK_SIZE) {
      try {
        const uploaded = await api.uploadVideo(file);
        if (!uploaded || !uploaded.url) throw new Error('视频上传失败');
        const data = await api.sendMessage(conversationId, {
          type: 'video',
          content: uploaded.url,
          video_duration: Number(uploaded.duration_ms) || 0,
          client_id: clientId,
        });
        get()._replace(conversationId, clientId, data.message);
        get()._bumpSummary(conversationId, data.message);
        if (localUrl) URL.revokeObjectURL(localUrl);
        return data.message;
      } catch (err) {
        get()._fail(conversationId, clientId);
        if (localUrl) URL.revokeObjectURL(localUrl);
        throw err;
      }
    }

    const entry = {
      clientId,
      conversationId,
      file,
      fileName: file.name,
      fileSize: file.size,
      localUrl,
      loaded: 0,
      total: file.size,
      percent: 0,
      status: 'uploading',
      error: '',
    };
    set((state) => ({ uploadsByClientId: { ...state.uploadsByClientId, [clientId]: entry } }));
    return get()._runChunkedVideoUpload(clientId);
  },

  /**
   * 发送文件消息：上传任意文件 → 发 file 消息（带 file_name / file_size）。
   * @param {File} file
   * @returns {Promise<Record<string, any>|null>}
   */
  sendFile: async (file) => {
    const conversationId = get().activeId;
    if (!file || !conversationId) return null;
    if (isReadonlyConversation(get().conversations, conversationId)) {
      throw new Error(READONLY_MESSAGE);
    }

    const clientId = makeClientId();
    const localUrl = typeof URL !== 'undefined' ? URL.createObjectURL(file) : '';
    get()._append(
      conversationId,
      buildOptimistic(
        conversationId,
        { type: 'file', content: localUrl, file_name: file.name, file_size: file.size },
        clientId,
      ),
    );

    // 小文件走旧单次上传；超过 5MB 走分片管线并暴露进度
    if (file.size <= UPLOAD_CHUNK_SIZE) {
      try {
        const uploaded = await api.uploadFile(file);
        if (!uploaded || !uploaded.url) throw new Error('文件上传失败');
        const data = await api.sendMessage(conversationId, {
          type: 'file',
          content: uploaded.url,
          file_name: uploaded.file_name || file.name,
          file_size: uploaded.file_size || file.size,
          client_id: clientId,
        });
        get()._replace(conversationId, clientId, data.message);
        get()._bumpSummary(conversationId, data.message);
        if (localUrl) URL.revokeObjectURL(localUrl);
        return data.message;
      } catch (err) {
        get()._fail(conversationId, clientId);
        if (localUrl) URL.revokeObjectURL(localUrl);
        throw err;
      }
    }

    const entry = {
      clientId,
      conversationId,
      file,
      fileName: file.name,
      fileSize: file.size,
      localUrl,
      loaded: 0,
      total: file.size,
      percent: 0,
      status: 'uploading',
      error: '',
    };
    set((state) => ({ uploadsByClientId: { ...state.uploadsByClientId, [clientId]: entry } }));
    return get()._runChunkedUpload(clientId);
  },

  /**
   * 断点续传：点击「继续」后重跑分片上传（服务端 init 返回已传分片）。
   * @param {string} clientId
   * @returns {Promise<Record<string, any>|null>}
   */
  resumeFile: async (clientId) => {
    const entry = get().uploadsByClientId[clientId];
    if (!entry) return null;
    get()._updateUpload(clientId, { status: 'uploading', error: '', loaded: 0, percent: 0 });
    return get()._runChunkedUpload(clientId);
  },

  /**
   * 内部：执行分片上传并在成功后发送 file 消息。
   * @param {string} clientId
   * @returns {Promise<Record<string, any>|null>}
   */
  _runChunkedUpload: async (clientId) => {
    const entry = get().uploadsByClientId[clientId];
    if (!entry) return null;
    try {
      const uploaded = await uploadFileChunked(entry.file, (progress) => {
        get()._updateUpload(clientId, {
          loaded: progress.loaded,
          total: progress.total,
          percent: progress.percent,
          status: 'uploading',
          error: '',
        });
      });
      if (!uploaded || !uploaded.url) throw new Error('文件上传失败');
      const data = await api.sendMessage(entry.conversationId, {
        type: 'file',
        content: uploaded.url,
        file_name: uploaded.file_name || entry.fileName,
        file_size: uploaded.file_size || entry.fileSize,
        client_id: clientId,
      });
      get()._replace(entry.conversationId, clientId, data.message);
      get()._bumpSummary(entry.conversationId, data.message);
      if (entry.localUrl) URL.revokeObjectURL(entry.localUrl);
      get()._clearUpload(clientId);
      return data.message;
    } catch (err) {
      get()._updateUpload(clientId, { status: 'failed', error: (err && err.message) || '上传失败' });
      get()._fail(entry.conversationId, clientId);
      throw err;
    }
  },

  /**
   * 断点续传视频：点击「继续」后重跑分片上传。
   * @param {string} clientId
   * @returns {Promise<Record<string, any>|null>}
   */
  resumeVideo: async (clientId) => {
    const entry = get().uploadsByClientId[clientId];
    if (!entry) return null;
    get()._updateUpload(clientId, { status: 'uploading', error: '', loaded: 0, percent: 0 });
    return get()._runChunkedVideoUpload(clientId);
  },

  /**
   * 内部：执行视频分片上传并在成功后发送 video 消息（时长取本地视频元数据）。
   * 分片完成后发消息用 type:'video'、content=url、video_duration=本地读取时长（秒）×1000 转毫秒、client_id 一致。
   * @param {string} clientId
   * @returns {Promise<Record<string, any>|null>}
   */
  _runChunkedVideoUpload: async (clientId) => {
    const entry = get().uploadsByClientId[clientId];
    if (!entry) return null;
    try {
      const uploaded = await uploadFileChunked(entry.file, (progress) => {
        get()._updateUpload(clientId, {
          loaded: progress.loaded,
          total: progress.total,
          percent: progress.percent,
          status: 'uploading',
          error: '',
        });
      });
      if (!uploaded || !uploaded.url) throw new Error('视频上传失败');
      const duration = await readVideoDuration(entry.file);
      const data = await api.sendMessage(entry.conversationId, {
        type: 'video',
        content: uploaded.url,
        video_duration: Math.round(Number(duration) * 1000) || 0,
        client_id: clientId,
      });
      get()._replace(entry.conversationId, clientId, data.message);
      get()._bumpSummary(entry.conversationId, data.message);
      if (entry.localUrl) URL.revokeObjectURL(entry.localUrl);
      get()._clearUpload(clientId);
      return data.message;
    } catch (err) {
      get()._updateUpload(clientId, { status: 'failed', error: (err && err.message) || '上传失败' });
      get()._fail(entry.conversationId, clientId);
      throw err;
    }
  },

  /**
   * 更新某个分片上传的进度 / 状态。
   * @param {string} clientId
   * @param {Record<string, any>} patch
   * @returns {void}
   */
  _updateUpload: (clientId, patch) => {
    set((state) => {
      const current = state.uploadsByClientId[clientId];
      if (!current) return {};
      return {
        uploadsByClientId: { ...state.uploadsByClientId, [clientId]: { ...current, ...patch } },
      };
    });
  },

  /**
   * 移除某个分片上传记录（成功发送后清理）。
   * @param {string} clientId
   * @returns {void}
   */
  _clearUpload: (clientId) => {
    set((state) => {
      const next = { ...state.uploadsByClientId };
      delete next[clientId];
      return { uploadsByClientId: next };
    });
  },

  /**
   * 语音转文字：调 voiceTranscribe 回填 transcript 到消息缓存。
   * @param {number|string} messageId
   * @returns {Promise<Record<string, any>>}
   */
  transcribeVoice: async (messageId) => {
    const id = Number(messageId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('消息不存在');
    set({ transcribingId: id });
    try {
      const data = await api.voiceTranscribe({ message_id: id });
      const text = String((data && data.text) || '');
      set((state) => {
        const messagesByConv = {};
        for (const [convId, list] of Object.entries(state.messagesByConv)) {
          const hit = Array.isArray(list) && list.some((message) => message.id === id);
          messagesByConv[convId] = hit
            ? list.map((message) => (message.id === id ? { ...message, transcript: text } : message))
            : list;
        }
        return { messagesByConv };
      });
      return data;
    } finally {
      set({ transcribingId: null });
    }
  },

  /**
   * 设置会话聊天背景（'' | /uploads/<image> | #RRGGBB），并同步会话列表缓存。
   * @param {number} conversationId
   * @param {string} backgroundUrl
   * @returns {Promise<string>} 服务端返回的 background_url
   */
  setBackground: async (conversationId, backgroundUrl) => {
    const convId = Number(conversationId);
    if (!Number.isInteger(convId) || convId <= 0) return '';
    const data = await api.updateConversationBackground(convId, backgroundUrl);
    const value = String(data.background_url ?? '');
    set((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === convId ? { ...item, background_url: value } : item,
      ),
    }));
    return value;
  },

  /**
   * 内部：把会话偏好落进本地列表（供 setConversationPrefs 与 socket 同步共用）。
   *
   * 语义：
   *   - hidden=true（隐藏 / 删除聊天）→ 直接从列表移除并重算未读总数；
   *     activeId 不动：若用户正停在该会话里，页面仍可用（服务端数据未删）。
   *   - pinned / manual_unread → 就地更新并重排序（置顶优先）。
   *   - hidden=false（取消隐藏）且会话不在列表中 → 重新拉一次列表。
   * @param {number} conversationId
   * @param {{pinned?: boolean, hidden?: boolean, manual_unread?: boolean, muted?: boolean}} prefs
   * @param {{purgeMessages?: boolean}} [options] purgeMessages=true 时清掉该会话的消息缓存
   *   （「删除该聊天」场景：否则再次进入会命中旧缓存，看到已删除的历史）
   * @returns {void}
   */
  _applyPrefs: (conversationId, prefs, options = {}) => {
    const convId = Number(conversationId);
    if (!Number.isInteger(convId) || convId <= 0 || !prefs) return;

    // 消息缓存清理与「会话是否还在列表里」无关，先无条件执行：
    // socket 事件可能比 REST 响应先到，此时会话已被移除，若放在后面会被提前 return 跳过。
    if (options.purgeMessages === true) {
      set((state) => ({
        messagesByConv: omitKey(state.messagesByConv, convId),
        hasMoreByConv: omitKey(state.hasMoreByConv, convId),
        detailsByConv: omitKey(state.detailsByConv, convId),
      }));
    }

    const exists = get().conversations.some((item) => item.id === convId);
    if (!exists) {
      if (prefs.hidden === false) get().loadConversations().catch(() => {});
      return;
    }

    if (prefs.hidden === true) {
      set((state) => {
        const conversations = state.conversations.filter((item) => item.id !== convId);
        return {
          conversations,
          unreadTotal: conversations.reduce((sum, item) => sum + (Number(item.unread_count) || 0), 0),
        };
      });
      return;
    }

    const pinned = prefs.pinned === undefined ? undefined : prefs.pinned === true;
    const manualUnread = prefs.manual_unread === undefined ? undefined : prefs.manual_unread === true;
    const muted = prefs.muted === undefined ? undefined : prefs.muted === true;

    set((state) => ({
      conversations: sortConversations(
        state.conversations.map((item) =>
          item.id === convId
            ? {
                ...item,
                pinned: pinned === undefined ? item.pinned === true : pinned,
                manual_unread: manualUnread === undefined ? item.manual_unread === true : manualUnread,
                muted: muted === undefined ? item.muted === true : muted,
              }
            : item,
        ),
      ),
    }));
  },

  /**
   * 更新会话偏好（置顶 / 标记未读 / 隐藏 / 删除聊天）。
   * 服务端只写本人成员行，并回推 conversation:prefs 给本人的其他在线端。
   * @param {number|string} conversationId
   * @param {{pinned?: boolean, hidden?: boolean, unread?: boolean, muted?: boolean, clear?: boolean}} payload
   * @returns {Promise<Record<string, any>|null>} 服务端返回的会话条目（可能为 null）
   */
  setConversationPrefs: async (conversationId, payload) => {
    const convId = Number(conversationId);
    if (!Number.isInteger(convId) || convId <= 0) return null;
    const body = payload && typeof payload === 'object' ? payload : {};

    const data = await api.setConversationPrefs(convId, body);
    const prefs = (data && data.prefs) || {};

    // 以服务端回显为准；字段缺失时回退到本次请求意图
    get()._applyPrefs(
      convId,
      {
        pinned: prefs.pinned !== undefined ? prefs.pinned : body.pinned,
        hidden: prefs.hidden !== undefined ? prefs.hidden : body.hidden === true || body.clear === true,
        manual_unread: prefs.manual_unread !== undefined ? prefs.manual_unread : body.unread,
        muted: prefs.muted !== undefined ? prefs.muted : body.muted,
      },
      // 删除聊天要连本地消息缓存一起清掉，否则再次进入会命中旧缓存
      { purgeMessages: body.clear === true },
    );

    return (data && data.conversation) || null;
  },

  /**
   * 处理 socket conversation:prefs（本人在其他端改了偏好）。
   * @param {{conversation_id: number, pinned: boolean, hidden: boolean, manual_unread: boolean, muted: boolean}} payload
   * @returns {void}
   */
  onConversationPrefs: (payload) => {
    if (!payload) return;
    const convId = Number(payload.conversation_id);
    if (!Number.isInteger(convId) || convId <= 0) return;
    get()._applyPrefs(convId, {
      pinned: payload.pinned,
      hidden: payload.hidden,
      manual_unread: payload.manual_unread,
      muted: payload.muted,
    });
  },

  /**
   * 内部：乐观插入 → REST 发送 → 替换 / 失败标记。
   * @param {number} conversationId
   * @param {{type: string, content: string}} payload
   * @returns {Promise<Record<string, any>>}
   */
  _send: async (conversationId, payload) => {
    // 只读会话（已不是好友）不允许发送，防御性拦截
    if (isReadonlyConversation(get().conversations, conversationId)) {
      throw new Error(READONLY_MESSAGE);
    }
    const clientId = makeClientId();
    get()._append(conversationId, buildOptimistic(conversationId, payload, clientId));
    try {
      const data = await api.sendMessage(conversationId, { ...payload, client_id: clientId });
      get()._replace(conversationId, clientId, data.message);
      get()._bumpSummary(conversationId, data.message);
      return data.message;
    } catch (err) {
      get()._fail(conversationId, clientId);
      throw err;
    }
  },

  /**
   * 内部：转发 / 合并的发送入口。
   * 目标会话已加载消息时走 _send（乐观 append + 替换）；未加载时直接 api.sendMessage，
   * 不做乐观 append，避免创建「只有一条转发消息」的残缺缓存污染后续全量拉取。
   * @param {number} conversationId
   * @param {{type: string, content: string}} payload
   * @returns {Promise<Record<string, any>>}
   */
  _forward: async (conversationId, payload) => {
    if (isReadonlyConversation(get().conversations, conversationId)) {
      throw new Error(READONLY_MESSAGE);
    }
    const loaded = Boolean(get().messagesByConv[conversationId]);
    if (loaded) {
      return get()._send(conversationId, payload);
    }
    const clientId = makeClientId();
    const data = await api.sendMessage(conversationId, { ...payload, client_id: clientId });
    get()._bumpSummary(conversationId, data.message);
    return data.message;
  },

  /**
   * 追加乐观消息。
   * @param {number} conversationId
   * @param {Record<string, any>} message
   * @returns {void}
   */
  _append: (conversationId, message) => {
    set((state) => ({
      messagesByConv: {
        ...state.messagesByConv,
        [conversationId]: [...(state.messagesByConv[conversationId] || []), message],
      },
    }));
  },

  /**
   * 用服务端消息替换乐观条目。
   * @param {number} conversationId
   * @param {string} clientId
   * @param {Record<string, any>} message
   * @returns {void}
   */
  _replace: (conversationId, clientId, message) => {
    if (!message || !message.id) return;
    set((state) => {
      const list = state.messagesByConv[conversationId] || [];
      let index = list.findIndex((item) => item.client_id === clientId);
      if (index < 0) index = list.findIndex((item) => item.id === message.id);

      if (index < 0) {
        return {
          messagesByConv: {
            ...state.messagesByConv,
            [conversationId]: sortMessages([...list, { ...message, _status: 'sent' }]),
          },
        };
      }

      const next = [...list];
      next[index] = { ...next[index], ...message, _status: 'sent', _local: false };
      return { messagesByConv: { ...state.messagesByConv, [conversationId]: next } };
    });
  },

  /**
   * 标记发送失败。
   * @param {number} conversationId
   * @param {string} clientId
   * @returns {void}
   */
  _fail: (conversationId, clientId) => {
    set((state) => {
      const list = state.messagesByConv[conversationId] || [];
      return {
        messagesByConv: {
          ...state.messagesByConv,
          [conversationId]: list.map((item) =>
            item.client_id === clientId ? { ...item, _status: 'failed' } : item,
          ),
        },
      };
    });
  },

  /**
   * 更新会话摘要并重排。
   * @param {number} conversationId
   * @param {Record<string, any>} message
   * @returns {void}
   */
  _bumpSummary: (conversationId, message) => {
    if (!message) return;
    set((state) => {
      const conversations = state.conversations.map((item) =>
        item.id === conversationId
          ? {
              ...item,
              last_message_at: Number(message.created_at) || item.last_message_at,
              last_message: {
                id: message.id,
                type: message.type,
                content: message.content,
                revoked: message.revoked,
                sender_id: message.sender_id,
                created_at: message.created_at,
                sender_nickname: message.sender_nickname,
                sender_avatar_url: message.sender_avatar_url,
              },
            }
          : item,
      );
      return { conversations: sortConversations(conversations) };
    });
  },

  /* ------------------------- 实时事件 ------------------------- */

  /**
   * 处理 socket message:new。
   * @param {Record<string, any>} message
   * @returns {{unread: boolean, conversationId: number, isMine: boolean}}
   */
  onSocketMessage: (message) => {
    const empty = { unread: false, conversationId: 0, isMine: false };
    if (!message || !message.id) return empty;

    const conversationId = Number(message.conversation_id);
    const myId = currentUserId();
    const isMine = message.sender_id === myId;
    const state = get();

    if (state.messagesByConv[conversationId]) {
      set((prev) => ({
        messagesByConv: {
          ...prev.messagesByConv,
          [conversationId]: mergeMessage(prev.messagesByConv[conversationId] || [], {
            ...message,
            _status: isMine ? 'sent' : undefined,
          }),
        },
      }));
    }

    if (!state.conversations.some((item) => item.id === conversationId)) {
      get()
        .loadConversations()
        .catch(() => {});
    }
    get()._bumpSummary(conversationId, message);

    const active = get().activeId === conversationId;
    const visible =
      typeof document !== 'undefined' && !document.hidden && (document.hasFocus ? document.hasFocus() : true);

    // 本地镜像「有人@我」：服务端置位在 conversation_members.mentioned，
    // 这里同步置位，让停留在其他页面的用户也能立刻看到列表红字。
    const mentioned =
      !isMine &&
      Boolean(
        message.mentions &&
          (message.mentions.all === true ||
            (Array.isArray(message.mentions.ids) && message.mentions.ids.map(Number).includes(myId))),
      );

    if (!isMine && !(active && visible)) {
      set((prev) => ({
        conversations: prev.conversations.map((item) =>
          item.id === conversationId
            ? {
                ...item,
                unread_count: (Number(item.unread_count) || 0) + 1,
                mentioned: mentioned || item.mentioned === true,
              }
            : item,
        ),
        unreadTotal: prev.unreadTotal + 1,
      }));
      // 消息免打扰：未读照常累加，但不触发提示音（App 层据 unread 决定是否播放）
      const muted = get().conversations.find((item) => item.id === conversationId)?.muted === true;
      return { unread: !muted, conversationId, isMine, muted };
    }

    if (!isMine) get().markRead(conversationId);
    return { unread: false, conversationId, isMine };
  },

  /**
   * 处理 socket message:read。
   * @param {{conversation_id: number, user_id: number, last_message_id: number}} payload
   * @returns {void}
   */
  onMessageRead: (payload) => {
    if (!payload) return;
    const conversationId = Number(payload.conversation_id);
    const userId = Number(payload.user_id);
    const lastMessageId = Number(payload.last_message_id) || 0;
    const myId = currentUserId();

    if (userId === myId) {
      set((state) => {
        const conversations = state.conversations.map((item) =>
          item.id === conversationId ? { ...item, unread_count: 0 } : item,
        );
        return {
          conversations,
          unreadTotal: conversations.reduce((sum, item) => sum + (Number(item.unread_count) || 0), 0),
        };
      });
      return;
    }

    set((state) => {
      const list = state.messagesByConv[conversationId];
      if (!list) return {};
      return {
        messagesByConv: {
          ...state.messagesByConv,
          [conversationId]: list.map((item) =>
            item.sender_id === myId && typeof item.id === 'number' && item.id <= lastMessageId
              ? { ...item, _status: 'read' }
              : item,
          ),
        },
      };
    });
  },

  /**
   * 处理 socket message:revoked。
   * @param {{conversation_id: number, message_id: number}} payload
   * @returns {void}
   */
  onMessageRevoked: (payload) => {
    if (!payload) return;
    const conversationId = Number(payload.conversation_id);
    const messageId = Number(payload.message_id);
    if (!conversationId || !messageId) return;

    set((state) => {
      const conversations = state.conversations.map((item) => {
        if (item.id !== conversationId || !item.last_message) return item;
        if (item.last_message.id !== messageId) return item;
        return { ...item, last_message: { ...item.last_message, revoked: 1, content: '' } };
      });
      const list = state.messagesByConv[conversationId];
      if (!list) return { conversations };
      return {
        conversations,
        messagesByConv: {
          ...state.messagesByConv,
          [conversationId]: list.map((item) =>
            item.id === messageId ? { ...item, revoked: 1, content: '' } : item,
          ),
        },
      };
    });
  },

  /**
   * 处理 socket typing。
   * @param {{conversation_id: number, user_id: number, typing: boolean}} payload
   * @returns {void}
   */
  onTyping: (payload) => {
    if (!payload) return;
    const conversationId = Number(payload.conversation_id);
    if (!conversationId) return;
    if (Number(payload.user_id) === currentUserId()) return;

    set((state) => {
      const next = { ...state.typingByConv };
      if (payload.typing) next[conversationId] = { userId: Number(payload.user_id), until: Date.now() + 4500 };
      else delete next[conversationId];
      return { typingByConv: next };
    });
  },

  /**
   * 处理 socket presence。
   * @param {{user_id: number, online: boolean}} payload
   * @returns {void}
   */
  onPresence: (payload) => {
    if (!payload) return;
    const userId = Number(payload.user_id);
    if (!userId) return;
    set((state) => ({
      onlineByUser: { ...state.onlineByUser, [userId]: Boolean(payload.online) },
      friends: state.friends.map((friend) =>
        friend.id === userId ? { ...friend, online: Boolean(payload.online) } : friend,
      ),
    }));
  },

  /**
   * 处理 user:update（对方改昵称 / 头像，或自己改资料后由 useAuth 回灌）。
   * 同步进 friends[]、friendRequests[]、conversations[].peer 与已渲染消息的 sender_* 字段，
   * 避免「消息气泡是新头像、顶栏与会话列表还是旧头像」的自相矛盾。
   * 群成员弹窗（GroupInfoPage）用的是页面级 useState，不在本 store 内，
   * 下次打开群资料时重新拉取即可覆盖，这里不做处理。
   * @param {Record<string, any>} user 服务端 publicUser 结构
   * @returns {void}
   */
  applyUserUpdate: (user) => {
    const userId = user ? Number(user.id) : 0;
    if (!Number.isInteger(userId) || userId <= 0) return;

    const nickname = user.nickname || '';
    const avatarColor = user.avatar_color || '#07C160';
    const avatarUrl = user.avatar_url || '';
    const signature = user.signature;

    /**
     * 把新资料合并进一个「用户快照」字段。
     * @param {Record<string, any>} person
     * @returns {Record<string, any>}
     */
    const mergePerson = (person) => ({
      ...person,
      nickname,
      signature: signature === undefined ? person.signature : signature,
      avatar_color: avatarColor,
      avatar_url: avatarUrl,
    });

    set((state) => {
      const friends = state.friends.map((friend) =>
        Number(friend.id) === userId ? mergePerson(friend) : friend,
      );

      // 新的朋友列表：申请人挂在 user 字段上；同时兼容 from_user / to_user 形状
      const friendRequests = state.friendRequests.map((item) => {
        let next = item;
        if (item.user && Number(item.user.id) === userId) next = { ...next, user: mergePerson(item.user) };
        if (item.from_user && Number(item.from_user.id) === userId) {
          next = { ...next, from_user: mergePerson(item.from_user) };
        }
        if (item.to_user && Number(item.to_user.id) === userId) {
          next = { ...next, to_user: mergePerson(item.to_user) };
        }
        return next;
      });

      const conversations = state.conversations.map((item) =>
        item.peer && Number(item.peer.id) === userId
          ? { ...item, peer: { ...item.peer, nickname, avatar_color: avatarColor, avatar_url: avatarUrl } }
          : item,
      );

      const messagesByConv = {};
      for (const [key, list] of Object.entries(state.messagesByConv)) {
        messagesByConv[key] = list.some((message) => Number(message.sender_id) === userId)
          ? list.map((message) =>
              Number(message.sender_id) === userId
                ? {
                    ...message,
                    sender_nickname: nickname,
                    sender_avatar_color: avatarColor,
                    sender_avatar_url: avatarUrl,
                  }
                : message,
            )
          : list;
      }

      return { friends, friendRequests, conversations, messagesByConv };
    });
  },

  /**
   * 处理 socket conversation:new。
   * @param {{conversation_id: number}} payload
   * @returns {void}
   */
  onConversationNew: (payload) => {
    if (!payload || !payload.conversation_id) return;
    subscribeConversation(Number(payload.conversation_id));
    get()
      .loadConversations()
      .catch(() => {});
  },

  /**
   * 处理 socket conversation:update。
   * @param {{conversation_id: number, last_message_at: number, last_message: any}} payload
   * @returns {void}
   */
  onConversationUpdate: (payload) => {
    if (!payload || !payload.conversation_id) return;
    const conversationId = Number(payload.conversation_id);
    if (!get().conversations.some((item) => item.id === conversationId)) {
      get()
        .loadConversations()
        .catch(() => {});
      return;
    }
    set((state) => ({
      conversations: sortConversations(
        state.conversations.map((item) =>
          item.id === conversationId
            ? {
                ...item,
                last_message_at: Number(payload.last_message_at) || item.last_message_at,
                last_message: payload.last_message
                  ? { ...(item.last_message || {}), ...payload.last_message }
                  : item.last_message,
              }
            : item,
        ),
      ),
    }));
  },

  /**
   * 会话详情（含成员 / 我的角色 / 群权限 / 公告），带内存缓存。
   * 群设置页与 @ 选择器共用同一份数据，避免重复请求。
   * @param {number|string} conversationId
   * @param {{force?: boolean}} [options] force 为 true 时忽略缓存重新拉取
   * @returns {Promise<Record<string, any>|null>}
   */
  groupDetail: async (conversationId, options = {}) => {
    const convId = Number(conversationId);
    if (!Number.isInteger(convId) || convId <= 0) return null;

    const { force = false } = options;
    const cached = get().detailsByConv[convId];
    if (cached && !force) return cached;

    const data = await api.conversationDetail(convId);
    const detail = data.conversation || null;
    if (!detail) return null;

    set((state) => ({ detailsByConv: { ...state.detailsByConv, [convId]: detail } }));
    // 顺带把群资料同步回会话列表，避免「群设置里改了群名，会话列表还是旧名」
    get().applyGroupUpdate(convId, detail);
    return detail;
  },

  /**
   * 合并群资料变更到会话列表与会话详情缓存。
   * 只合并「列表里存在的字段」，不会把 detail 专有字段（members 等）写进列表项。
   * @param {number} conversationId
   * @param {Record<string, any>} patch 可含 name / avatar_url / member_count / owner_id / announcement / permissions / members
   * @returns {void}
   */
  applyGroupUpdate: (conversationId, patch) => {
    const convId = Number(conversationId);
    if (!Number.isInteger(convId) || convId <= 0 || !patch) return;

    set((state) => {
      const conversations = state.conversations.map((item) => {
        if (item.id !== convId) return item;
        const next = { ...item };
        if (patch.name !== undefined) next.name = patch.name;
        if (patch.avatar_url !== undefined) next.avatar_url = patch.avatar_url;
        if (patch.member_count !== undefined) next.member_count = Number(patch.member_count) || 0;
        if (patch.owner_id !== undefined) next.owner_id = patch.owner_id;
        return next;
      });

      const cached = state.detailsByConv[convId];
      const detailsByConv = cached
        ? { ...state.detailsByConv, [convId]: { ...cached, ...patch } }
        : state.detailsByConv;

      return { conversations, detailsByConv };
    });
  },

  /**
   * 处理 socket conversation:profile（群名 / 头像 / 公告 / 权限变更广播）。
   * @param {{conversation_id: number, conversation: Record<string, any>}} payload
   * @returns {void}
   */
  onConversationProfile: (payload) => {
    if (!payload) return;
    const convId = Number(payload.conversation_id);
    if (!Number.isInteger(convId) || convId <= 0) return;
    get().applyGroupUpdate(convId, payload.conversation || {});
  },

  /**
   * 处理 socket conversation:removed（被管理员移出群聊）。
   * 移除会话与消息缓存，并在 total 里扣掉该会话的未读数。
   * @param {{conversation_id: number, by_user_id?: number}} payload
   * @returns {number} 被移除的会话 id（0 表示 payload 非法）
   */
  onConversationRemoved: (payload) => {
    const convId = Number(payload && payload.conversation_id);
    if (!Number.isInteger(convId) || convId <= 0) return 0;

    set((state) => {
      const conversations = state.conversations.filter((item) => item.id !== convId);
      return {
        conversations,
        unreadTotal: conversations.reduce((sum, item) => sum + (Number(item.unread_count) || 0), 0),
        messagesByConv: omitKey(state.messagesByConv, convId),
        hasMoreByConv: omitKey(state.hasMoreByConv, convId),
        detailsByConv: omitKey(state.detailsByConv, convId),
        activeId: state.activeId === convId ? null : state.activeId,
      };
    });
    return convId;
  },

  /**
   * 断线重连后按本地最大消息 id 增量补齐。
   * @returns {Promise<number>} 补齐条数
   */
  syncMessages: async () => {
    let maxId = 0;
    for (const list of Object.values(get().messagesByConv)) {
      for (const message of list) {
        if (typeof message.id === 'number' && message.id > maxId) maxId = message.id;
      }
    }

    try {
      const data = await api.syncMessages(maxId);
      const myId = currentUserId();
      const incoming = data.messages || [];
      if (incoming.length > 0) {
        set((state) => {
          const next = { ...state.messagesByConv };
          for (const message of incoming) {
            const conversationId = Number(message.conversation_id);
            if (!next[conversationId]) continue;
            next[conversationId] = mergeMessage(next[conversationId], {
              ...message,
              _status: message.sender_id === myId ? 'sent' : undefined,
            });
          }
          return { messagesByConv: next };
        });
      }
      await get().loadConversations();
      return incoming.length;
    } catch (err) {
      console.warn('[chat] syncMessages failed:', err && err.message);
      return 0;
    }
  },

  /**
   * 撤回消息。
   * @param {number} messageId
   * @returns {Promise<void>}
   */
  revokeMessage: async (messageId) => {
    const data = await api.revokeMessage(messageId);
    const message = data.message;
    if (!message) return;
    set((state) => {
      const list = state.messagesByConv[message.conversation_id] || [];
      return {
        messagesByConv: {
          ...state.messagesByConv,
          [message.conversation_id]: list.map((item) =>
            item.id === messageId ? { ...item, revoked: 1, content: '' } : item,
          ),
        },
      };
    });
    get()
      .loadConversations()
      .catch(() => {});
  },

  /* ------------------------- 好友 ------------------------- */

  /**
   * 好友列表（服务端按昵称排序）。
   * @returns {Promise<void>}
   */
  loadFriends: async () => {
    const data = await api.friends();
    const friends = data.friends || [];
    set((state) => {
      const onlineByUser = { ...state.onlineByUser };
      for (const friend of friends) {
        if (typeof friend.online === 'boolean') onlineByUser[friend.id] = friend.online;
      }
      return { friends, onlineByUser };
    });
  },

  /**
   * 好友申请列表。
   * @param {'pending'|'accepted'|'rejected'|'all'} [status]
   * @returns {Promise<void>}
   */
  loadFriendRequests: async (status = 'all') => {
    const data = await api.friendRequests('in', status);
    set({ friendRequests: data.requests || [] });
  },

  /**
   * 待处理申请数量。
   * @returns {Promise<void>}
   */
  loadPendingCount: async () => {
    try {
      const data = await api.friendRequestCount();
      set({ pendingRequestCount: Number(data.count) || 0 });
    } catch {
      /* 忽略 */
    }
  },

  /**
   * 同意好友申请。
   * @param {number} requestId
   * @returns {Promise<number>} 单聊会话 id
   */
  acceptFriendRequest: async (requestId) => {
    const data = await api.acceptFriendRequest(requestId);
    await Promise.allSettled([
      get().loadFriendRequests('all'),
      get().loadPendingCount(),
      get().loadFriends(),
      get().loadConversations(),
    ]);
    return Number(data.conversation_id) || 0;
  },

  /**
   * 拒绝好友申请。
   * @param {number} requestId
   * @returns {Promise<void>}
   */
  rejectFriendRequest: async (requestId) => {
    await api.rejectFriendRequest(requestId);
    await Promise.allSettled([get().loadFriendRequests('all'), get().loadPendingCount()]);
  },

  /**
   * 发送好友申请。
   * @param {number} userId
   * @param {string} message 验证语
   * @returns {Promise<number>} request_id
   */
  sendFriendRequest: async (userId, message, qrToken) => {
    const data = await api.sendFriendRequest(userId, message, qrToken);
    return Number(data.request_id) || 0;
  },

  /**
   * 搜索用户。
   * @param {string} keyword
   * @returns {Promise<Array<Record<string, any>>>}
   */
  searchUsers: async (keyword) => {
    const data = await api.searchUsers(keyword);
    return data.users || [];
  },

  /**
   * 删除好友（保留会话与历史消息）。
   * @param {number} userId
   * @returns {Promise<void>}
   */
  deleteFriend: async (userId) => {
    await api.deleteFriend(userId);
    await get().loadFriends();
    // 删除好友后单聊会话转为只读，刷新列表以拿到最新的 readonly 标记
    await get()
      .loadConversations()
      .catch(() => {});
  },

  /**
   * 创建 / 复用单聊会话。
   * @param {number} userId
   * @returns {Promise<number>} 会话 id
   */
  ensureSingleConversation: async (userId) => {
    const data = await api.createSingleConversation(userId);
    const conversationId = Number(data.conversation_id) || 0;
    await get().loadConversations();
    if (conversationId) subscribeConversation(conversationId);
    return conversationId;
  },

  /**
   * 建群。
   * @param {number[]} memberIds 不含自己
   * @param {string} [name]
   * @param {number|null} [sourceGroupId] 从已有群聊建群时传入源群 id
   * @returns {Promise<number>} 会话 id
   */
  createGroup: async (memberIds, name = '', sourceGroupId = null) => {
    const data = await api.createGroupConversation(memberIds, name, sourceGroupId);
    const conversationId = Number(data.conversation_id) || 0;
    await get().loadConversations();
    if (conversationId) subscribeConversation(conversationId);
    return conversationId;
  },

  /**
   * 拉人入群。
   * @param {number} conversationId
   * @param {number[]} userIds
   * @returns {Promise<void>}
   */
  addGroupMembers: async (conversationId, userIds) => {
    await api.addGroupMembers(conversationId, userIds);
  },

  /**
   * 退出群聊。
   * @param {number} conversationId
   * @returns {Promise<void>}
   */
  leaveGroup: async (conversationId) => {
    await api.leaveGroup(conversationId);
    set((state) => ({
      conversations: state.conversations.filter((item) => item.id !== conversationId),
      messagesByConv: omitKey(state.messagesByConv, conversationId),
      hasMoreByConv: omitKey(state.hasMoreByConv, conversationId),
      detailsByConv: omitKey(state.detailsByConv, conversationId),
      activeId: state.activeId === conversationId ? null : state.activeId,
    }));
  },
}));

// 自己改完资料后（useAuth.updateProfile），把最新 publicUser 回灌进本 store，
// 让已渲染的「我」的气泡、会话列表立即更新。用注入方式而非 useAuth 反向 import，避免循环依赖。
setUserUpdateSink((user) => useChat.getState().applyUserUpdate(user));

export default useChat;
