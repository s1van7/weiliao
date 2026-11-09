/**
 * UI store：路由、标签页、Toast、全局弹窗、图片预览、表情面板、网络状态、SW 更新提示。
 *
 * 路由采用 hash（#/chat/12），保证 Electron / Capacitor 的 file:// 场景同样可用。
 */
import { create } from 'zustand';

/** 合法路由名 */
const ROUTE_NAMES = [
  'chats',
  'contacts',
  'discover',
  'me',
  'chat',
  'newFriends',
  'addFriend',
  'groupCreate',
  'groupInfo',
  'userInfo',
  'moments',
  'momentPublish',
  'stickers',
  'settings',
  'myQr',
  'scan',
  'favorites',
  'userMoments',
  'facePair',
  'chatHistory',
  'messageSearch',
  'groupJoin',
];

/** 带数字 id 参数的路由 */
const ROUTES_WITH_ID = ['chat', 'groupInfo', 'userInfo', 'userMoments', 'chatHistory'];

/** 带 token（非数字）参数的路由：groupJoin/<token> */
const ROUTES_WITH_TOKEN = ['groupJoin'];

/** 路由名别名：兼容群邀请链接里的 #/join/<token> */
const NAME_ALIASES = Object.freeze({ join: 'groupJoin' });

/** 属于底部 Tab 的路由（4 个 Tab：消息 / 通讯录 / 发现 / 我） */
const TAB_ROUTES = ['chats', 'contacts', 'discover', 'me'];

/**
 * 解析 location.hash 为路由字符串。
 * @param {string} [hash]
 * @returns {string}
 */
export function parseRoute(hash) {
  const raw = String(hash !== undefined ? hash : typeof window !== 'undefined' ? window.location.hash : '');
  const cleaned = raw.replace(/^#\/?/, '');
  const [segment, id] = cleaned.split('/');
  const name = NAME_ALIASES[segment] || segment;
  if (!ROUTE_NAMES.includes(name)) return 'chats';
  if (ROUTES_WITH_ID.includes(name)) {
    const numericId = Number(id);
    return Number.isInteger(numericId) && numericId > 0 ? `${name}/${numericId}` : 'chats';
  }
  if (ROUTES_WITH_TOKEN.includes(name)) {
    return id ? `${name}/${id}` : 'chats';
  }
  return name;
}

/**
 * 路由转 hash。
 * @param {string} route
 * @returns {string}
 */
function toHash(route) {
  return `#/${route}`;
}

/**
 * 路由对应的 tab。
 * @param {string} route
 * @returns {'chats'|'contacts'|'discover'|'me'|''}
 */
function tabOf(route) {
  const name = route.split('/')[0];
  return TAB_ROUTES.includes(name) ? name : '';
}

let toastTimer = null;

export const useUI = create((set, get) => ({
  /** 当前标签页 */
  tab: tabOf(parseRoute()),
  /** 当前路由：'chats' | 'chat/12' | 'contacts' | 'me' | 'newFriends' | ... */
  route: typeof window !== 'undefined' ? parseRoute() : 'chats',
  /** 路由历史栈（供返回使用） */
  history: [],
  /** 搜索关键词（桌面左栏搜索框） */
  search: '',
  /** Toast：{ id, message, type } | null */
  toast: null,
  /** 全局弹窗：{ title, content, confirmText, cancelText, danger, onConfirm } | null */
  modal: null,
  /** 图片预览地址 */
  imagePreview: null,
  /** 视频预览地址 */
  videoPreview: null,
  /** 表情面板是否展开 */
  showEmoji: false,
  /** 网络是否正常（socket 连接状态） */
  network: true,
  /** 是否有新版本 Service Worker 等待激活 */
  swUpdate: false,
  /** 扫码解析出的二维码 token（供 UserInfoPage 发送好友申请时附带） */
  qrToken: '',
  /** 面对面配对页初始类型（file=传文件 / group=建群） */
  facePairKind: 'file',

  /**
   * 切换路由。
   * @param {string} route
   * @param {{replace?: boolean}} [options]
   * @returns {void}
   */
  navigate: (route, options = {}) => {
    const next = String(route || 'chats');
    const current = get().route;
    if (next === current) return;

    const history = options.replace ? get().history : [...get().history, current];
    set({ route: next, history, showEmoji: false });
    const tab = tabOf(next);
    if (tab) set({ tab });

    if (typeof window !== 'undefined') {
      if (options.replace) window.history.replaceState(null, '', toHash(next));
      else window.location.hash = toHash(next);
    }
  },

  /**
   * 返回上一页（无历史则回消息页）。
   * @returns {void}
   */
  back: () => {
    const history = get().history;
    if (history.length > 0) {
      const prev = history[history.length - 1];
      set({ route: prev, history: history.slice(0, -1), showEmoji: false });
      const tab = tabOf(prev);
      if (tab) set({ tab });
      if (typeof window !== 'undefined') window.history.replaceState(null, '', toHash(prev));
      return;
    }
    get().navigate('chats', { replace: true });
  },

  /**
   * 切换标签页。
   * @param {'chats'|'contacts'|'discover'|'me'} tab
   * @returns {void}
   */
  setTab: (tab) => get().navigate(tab),

  /**
   * 浏览器前进/后退导致 hash 变化时同步状态。
   * @returns {void}
   */
  syncFromHash: () => {
    const next = parseRoute();
    if (next === get().route) return;
    const history = get().history;
    set({ route: next, history: history.length > 0 ? history.slice(0, -1) : [] });
    const tab = tabOf(next);
    if (tab) set({ tab });
  },

  /**
   * 设置左栏搜索关键词。
   * @param {string} keyword
   * @returns {void}
   */
  setSearch: (keyword) => set({ search: String(keyword || '') }),

  /**
   * 展示 Toast。
   * @param {string} message
   * @param {'info'|'error'|'success'} [type]
   * @returns {void}
   */
  showToast: (message, type = 'info') => {
    if (!message) return;
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { id: Date.now(), message: String(message), type } });
    toastTimer = setTimeout(() => set({ toast: null }), type === 'error' ? 2800 : 1800);
  },

  /** 关闭 Toast */
  hideToast: () => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: null });
  },

  /**
   * 打开全局确认弹窗。
   * @param {{title?: string, content?: any, confirmText?: string, cancelText?: string, danger?: boolean, onConfirm?: () => void|Promise<void>}} config
   * @returns {void}
   */
  openModal: (config) => set({ modal: config || {} }),

  /** 关闭全局弹窗 */
  closeModal: () => set({ modal: null }),

  /**
   * 打开图片预览。
   * @param {string} src
   * @returns {void}
   */
  openImage: (src) => set({ imagePreview: src || null }),

  /** 关闭图片预览 */
  closeImage: () => set({ imagePreview: null }),

  /**
   * 打开视频预览。
   * @param {string} src
   * @returns {void}
   */
  openVideo: (src) => set({ videoPreview: src || null }),

  /** 关闭视频预览 */
  closeVideo: () => set({ videoPreview: null }),

  /**
   * 展开 / 收起表情面板。
   * @param {boolean} [next]
   * @returns {void}
   */
  setShowEmoji: (next) => set({ showEmoji: typeof next === 'boolean' ? next : !get().showEmoji }),

  /**
   * 设置网络状态。
   * @param {boolean} network
   * @returns {void}
   */
  setNetwork: (network) => set({ network: Boolean(network) }),

  /**
   * 设置 SW 更新提示。
   * @param {boolean} value
   * @returns {void}
   */
  setSwUpdate: (value) => set({ swUpdate: Boolean(value) }),

  /**
   * 设置扫码得到的二维码 token（用于带 token 发送好友申请）。
   * @param {string} token
   * @returns {void}
   */
  setQrToken: (token) => set({ qrToken: String(token || '') }),

  /**
   * 设置面对面配对初始类型。
   * @param {'file'|'group'} kind
   * @returns {void}
   */
  setFacePairKind: (kind) => set({ facePairKind: kind === 'group' ? 'group' : 'file' }),
}));

export default useUI;
