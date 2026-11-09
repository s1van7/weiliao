/**
 * 认证 store：
 *   token    当前 JWT（localStorage 持久化）
 *   user     当前用户（服务端 publicUser 结构）
 *   loading  启动校验中（App 显示闪屏）
 *
 * 所有方法失败时抛出 ApiError，由页面决定提示文案。
 */
import { create } from 'zustand';
import { api, setToken, setUnauthorizedHandler } from '../api';
import { TOKEN_KEY } from '../config';

/**
 * 读取本地 token。
 * @returns {string}
 */
function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * 持久化 token。
 * @param {string} token
 * @returns {void}
 */
function persistToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 隐私模式忽略 */
  }
}

/**
 * 资料变更同步钩子：由 useChat 在加载时注入，避免 useAuth ↔ useChat 的循环 import。
 * 未注入时（例如 useChat 尚未加载）静默跳过。
 * @type {((user: Record<string, any>) => void)|null}
 */
let userUpdateSink = null;

/**
 * 注册资料变更回调（供 useChat 注入）。
 * @param {(user: Record<string, any>) => void} sink 接收 publicUser 结构的回调
 * @returns {void}
 */
export function setUserUpdateSink(sink) {
  userUpdateSink = typeof sink === 'function' ? sink : null;
}

/**
 * 把资料变更同步到聊天 store（好友列表、会话 peer、已渲染消息的 sender_* 字段）。
 * @param {Record<string, any>} user 服务端 publicUser 结构
 * @returns {void}
 */
function syncToChatStore(user) {
  if (!user || !userUpdateSink) return;
  try {
    userUpdateSink(user);
  } catch (err) {
    console.warn('[auth] sync profile to chat store failed:', err && err.message);
  }
}

/** 防止 StrictMode 双重挂载导致重复校验 */
let bootstrapStarted = false;

export const useAuth = create((set, get) => ({
  token: readToken(),
  user: null,
  loading: true,

  /**
   * 启动引导：读本地 token → GET /api/me 校验。
   * 校验期间 loading=true（App 展示绿色闪屏），失败则清 token。
   * @returns {Promise<void>}
   */
  bootstrap: async () => {
    if (bootstrapStarted) return;
    bootstrapStarted = true;

    const stored = readToken();
    if (!stored) {
      setToken('');
      set({ token: '', user: null, loading: false });
      return;
    }

    setToken(stored);
    try {
      const data = await api.me();
      set({ token: stored, user: data.user, loading: false });
    } catch (err) {
      persistToken('');
      setToken('');
      set({ token: '', user: null, loading: false });
    }
  },

  /**
   * 登录。
   * @param {string} account 用户名或手机号
   * @param {string} password
   * @returns {Promise<Record<string, unknown>>} 用户对象
   */
  login: async (account, password) => {
    const data = await api.login(account, password);
    persistToken(data.token);
    setToken(data.token);
    set({ token: data.token, user: data.user, loading: false });
    return data.user;
  },

  /**
   * 注册（成功后直接进入登录态）。
   * @param {{mode: 'username'|'phone', username?: string, phone?: string, nickname: string, password: string, inviteCode: string}} payload
   * @returns {Promise<Record<string, unknown>>} 用户对象
   */
  register: async (payload) => {
    const body = {
      nickname: payload.nickname,
      password: payload.password,
      invite_code: payload.inviteCode,
    };
    if (payload.mode === 'phone') body.phone = payload.phone;
    else body.username = payload.username;

    const data = await api.register(body);
    persistToken(data.token);
    setToken(data.token);
    set({ token: data.token, user: data.user, loading: false });
    return data.user;
  },

  /**
   * 更新资料（昵称 / 签名 / 头像色 / 自定义头像 / 性别 / 地区）。
   * avatar_url 传空串表示清除图片头像、回退纯色。
   * @param {{nickname?: string, signature?: string, avatar_color?: string, avatar_url?: string, gender?: string, region?: string}} patch
   * @returns {Promise<Record<string, unknown>>}
   */
  updateProfile: async (patch) => {
    const data = await api.updateMe(patch);
    set({ user: data.user });
    // 自己改昵称 / 头像后，已渲染的气泡、会话列表也要立即更新（无需重进页面）
    syncToChatStore(data.user);
    return data.user;
  },

  /**
   * 本地写入用户对象（例如收到资料变更推送时）。
   * @param {Record<string, unknown>} user
   * @returns {void}
   */
  setUser: (user) => set({ user }),

  /**
   * 登出：清 token、清内存态。
   * @returns {void}
   */
  logout: () => {
    persistToken('');
    setToken('');
    set({ token: '', user: null, loading: false });
  },

  /**
   * 当前用户 id。
   * @returns {number}
   */
  currentUserId: () => {
    const user = get().user;
    return user ? Number(user.id) : 0;
  },
}));

// 401 统一自动登出（只在带 token 的请求上触发）
setUnauthorizedHandler(() => {
  const state = useAuth.getState();
  if (state.token) state.logout();
});

export default useAuth;
