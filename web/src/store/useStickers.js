/**
 * 自定义表情 store。
 *
 * 数据形态：
 *   stickers  Array<{id: number, url: string, created_at: number}>（服务端按新→旧返回）
 *   recent    Array<{t: 'emoji'|'sticker', v: string}>（localStorage 镜像，最多 16 条）
 *   loading   列表加载中
 *
 * 约定：
 *   - 所有接口异常都向上抛，由页面决定 toast 文案（错误码见 api.ApiError.code）；
 *   - recent 同时写内存与 localStorage，保证刷新后仍在。
 */
import { create } from 'zustand';
import { api } from '../api';
import { popRecents, pushRecent as pushRecentStorage, clearRecents } from '../lib/recent';

export const useStickers = create((set, get) => ({
  /** 我的自定义表情（新 → 旧） */
  stickers: [],
  /** 最近使用（emoji 与自定义表情混排，新 → 旧） */
  recent: popRecents(),
  loading: false,
  /** 是否已经成功加载过一次（避免重复拉取） */
  loaded: false,

  /**
   * 拉取我的表情列表。
   * @param {{force?: boolean}} [options] force 为 true 时忽略 loaded 缓存
   * @returns {Promise<Array<Record<string, any>>>}
   */
  load: async (options = {}) => {
    const { force = false } = options;
    // 已成功加载过且非强制刷新：直接复用内存数据，避免每次打开面板都打一次接口
    if (!force && get().loaded) return get().stickers;
    if (get().loading) return get().stickers;
    set({ loading: true });
    try {
      const data = await api.stickers();
      const stickers = Array.isArray(data.stickers) ? data.stickers : [];
      set({ stickers, loading: false, loaded: true });
      return stickers;
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  /**
   * 新增一个表情（url 必须来自 api.uploadSticker 的返回值）。
   * @param {string} url 形如 /uploads/xxx.png
   * @returns {Promise<Record<string, any>>} 新表情
   */
  add: async (url) => {
    const data = await api.addSticker(url);
    const sticker = data.sticker;
    set((state) => ({
      stickers: sticker ? [sticker, ...state.stickers.filter((item) => item.id !== sticker.id)] : state.stickers,
      loaded: true,
    }));
    return sticker;
  },

  /**
   * 删除一个表情（服务端只删库，磁盘文件保留，历史消息里的表情仍可显示）。
   * @param {number} id 表情 id
   * @returns {Promise<void>}
   */
  remove: async (id) => {
    const stickerId = Number(id);
    if (!Number.isInteger(stickerId) || stickerId <= 0) return;
    await api.deleteSticker(stickerId);
    set((state) => ({ stickers: state.stickers.filter((item) => Number(item.id) !== stickerId) }));
  },

  /**
   * 记录一次「最近使用」。
   * @param {{t: 'emoji'|'sticker', v: string}} item
   * @returns {void}
   */
  pushRecent: (item) => {
    const recent = pushRecentStorage(item);
    set({ recent });
  },

  /** 清空最近使用 */
  clearRecent: () => {
    clearRecents();
    set({ recent: [] });
  },

  /** 登出时清空（避免切换账号串数据） */
  reset: () => set({ stickers: [], recent: [], loading: false, loaded: false }),
}));

export default useStickers;
