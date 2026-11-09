/**
 * 发现页配置 store：读取 / 更新 / 排序三项（scan|moments|emoji）。
 * 配置以服务端 GET/PUT /api/settings/discover 为准，账号维度跨端持久化。
 */
import { create } from 'zustand';
import { api } from '../api';

/** 默认配置（服务端无行时返回同一结构） */
const DEFAULT_CONFIG = [
  { key: 'scan', enabled: true, sort: 0 },
  { key: 'moments', enabled: true, sort: 1 },
  { key: 'emoji', enabled: true, sort: 2 },
];

export const useDiscover = create((set, get) => ({
  /** 发现页配置（按 sort 升序） */
  config: DEFAULT_CONFIG.map((item) => ({ ...item })),
  loading: false,
  loaded: false,

  /**
   * 拉取发现页配置。
   * @returns {Promise<Array<Record<string, any>>>}
   */
  load: async () => {
    if (get().loading) return get().config;
    set({ loading: true });
    try {
      const data = await api.settingsDiscover();
      const config = Array.isArray(data.config) && data.config.length > 0
        ? data.config.map((item) => ({ ...item })).sort((a, b) => a.sort - b.sort)
        : DEFAULT_CONFIG.map((item) => ({ ...item }));
      set({ config, loading: false, loaded: true });
      return config;
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  /**
   * 开关某项。
   * @param {string} key scan|moments|emoji
   * @param {boolean} enabled
   * @returns {Promise<Array<Record<string, any>>>}
   */
  update: async (key, enabled) => {
    const config = get().config.map((item) => (item.key === key ? { ...item, enabled: Boolean(enabled) } : item));
    return get()._persist(config);
  },

  /**
   * 上移 / 下移某项（交换后重新编号 sort）。
   * @param {string} key scan|moments|emoji
   * @param {'up'|'down'} direction
   * @returns {Promise<Array<Record<string, any>>>}
   */
  reorder: async (key, direction) => {
    const list = [...get().config].sort((a, b) => a.sort - b.sort);
    const index = list.findIndex((item) => item.key === key);
    if (index < 0) return get().config;

    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= list.length) return get().config;

    const swapped = [...list];
    [swapped[index], swapped[target]] = [swapped[target], swapped[index]];
    const config = swapped.map((item, i) => ({ ...item, sort: i }));
    return get()._persist(config);
  },

  /**
   * 持久化配置到服务端并更新本地。
   * @param {Array<Record<string, any>>} config
   * @returns {Promise<Array<Record<string, any>>>}
   */
  _persist: async (config) => {
    const data = await api.updateSettingsDiscover(config);
    const next = Array.isArray(data.config) ? data.config.map((item) => ({ ...item })).sort((a, b) => a.sort - b.sort) : config;
    set({ config: next, loaded: true });
    return next;
  },
}));

export default useDiscover;
