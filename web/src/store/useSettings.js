/**
 * 用户设置 store：服务端 user_settings 表 + dark/sound/vibrate 本地镜像。
 *
 * 约定：
 *   - settings 以 GET /api/me/settings 为准；
 *   - dark/sound/vibrate 同步到 localStorage，让 audio.js / theme.js 等非 React 模块也能读取；
 *   - 通知开关目前只落库（服务端后续可据此静默推送），前端不强制消费。
 */
import { create } from 'zustand';
import { api } from '../api';
import { applyTheme } from '../lib/theme';
import { setSoundEnabled } from '../audio';

/** localStorage 键 */
const DARK_KEY = 'wx.dark';
const VIBRATE_KEY = 'wx.vibrate';

/** 默认设置（与后端 DEFAULT_SETTINGS 对齐） */
const DEFAULT_SETTINGS = {
  notification_enabled: true,
  sound_enabled: true,
  vibrate_enabled: true,
  friend_request_mode: 'all',
  dark_mode: false,
};

/**
 * 读取本地布尔开关。
 * @param {string} key
 * @returns {boolean}
 */
function readFlag(key) {
  try {
    return localStorage.getItem(key) !== 'off';
  } catch {
    return true;
  }
}

/**
 * 把服务端设置镜像到 localStorage 并应用主题。
 * @param {Record<string, any>} settings
 * @returns {void}
 */
function mirrorLocal(settings) {
  try {
    localStorage.setItem(DARK_KEY, settings.dark_mode ? 'on' : 'off');
    localStorage.setItem(VIBRATE_KEY, settings.vibrate_enabled ? 'on' : 'off');
  } catch {
    /* 隐私模式忽略 */
  }
  setSoundEnabled(Boolean(settings.sound_enabled));
  applyTheme(Boolean(settings.dark_mode));
}

export const useSettings = create((set, get) => ({
  /** 服务端设置（bool + friend_request_mode 三值字符串） */
  settings: { ...DEFAULT_SETTINGS },
  loading: false,
  loaded: false,

  /**
   * 拉取服务端设置并应用本地镜像。
   * @returns {Promise<Record<string, any>>}
   */
  load: async () => {
    set({ loading: true });
    try {
      const data = await api.meSettings();
      const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
      mirrorLocal(settings);
      set({ settings, loading: false, loaded: true });
      return settings;
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  /**
   * 更新设置子集（PATCH 后合并并应用）。
   * @param {Record<string, any>} patch
   * @returns {Promise<Record<string, any>>}
   */
  update: async (patch) => {
    const data = await api.updateSettings(patch);
    const settings = { ...get().settings, ...(data.settings || {}) };
    mirrorLocal(settings);
    set({ settings, loaded: true });
    return settings;
  },

  /**
   * 用本地已持久化的设置启动主题（无需等接口返回，避免深色模式闪烁）。
   * @returns {void}
   */
  applyBootTheme: () => {
    applyTheme(readFlag(DARK_KEY));
  },

  /** 登出时重置为默认值 */
  reset: () => {
    mirrorLocal(DEFAULT_SETTINGS);
    set({ settings: { ...DEFAULT_SETTINGS }, loaded: false, loading: false });
  },
}));

export default useSettings;
