/**
 * 朋友圈 store。
 *
 * 数据形态（严格对齐 GET /api/moments）：
 *   moment = {
 *     id, user: {id, nickname, avatar_color, avatar_url}, content, images: string[],
 *     created_at, liked, like_count, likes: user[], comments: [{id, user, content, created_at, can_delete}]
 *   }
 *
 * 约定：
 *   - 时间线按 id DESC（服务端顺序），loadMore 用 before_id 游标，天然不重复；
 *   - 点赞 / 评论 / 删除全部先改本地再请求，失败回滚并抛错；
 *   - 发布成功把新动态插到最前（无需整页刷新）。
 */
import { create } from 'zustand';
import { api } from '../api';

/** 单页条数（服务端默认 20，最大 50） */
const PAGE_SIZE = 20;

/**
 * 合并点赞列表：liked 时补上自己（若列表里没有），unliked 时剔除自己。
 * @param {Array<Record<string, any>>} likes 原点赞用户列表
 * @param {Record<string, any>} me 当前用户快照
 * @param {boolean} liked 目标状态
 * @returns {Array<Record<string, any>>}
 */
function mergeLikeList(likes, me, liked) {
  const list = Array.isArray(likes) ? likes : [];
  const withoutMe = list.filter((user) => Number(user.id) !== Number(me.id));
  if (!liked) return withoutMe;
  return [...withoutMe, { id: Number(me.id), nickname: me.nickname, avatar_color: me.avatar_color, avatar_url: me.avatar_url }];
}

/**
 * 替换某条动态（不可变）。
 * @param {Array<Record<string, any>>} list 原列表
 * @param {number} momentId 动态 id
 * @param {(moment: Record<string, any>) => Record<string, any>} updater 更新函数
 * @returns {Array<Record<string, any>>}
 */
function patchMoment(list, momentId, updater) {
  return list.map((item) => (Number(item.id) === Number(momentId) ? updater(item) : item));
}

export const useMoments = create((set, get) => ({
  moments: [],
  hasMore: true,
  loading: false,
  loadingMore: false,
  publishing: false,
  /** 最近一次加载是否已成功（用于首次进入的空态判断） */
  loaded: false,

  /**
   * 加载首屏（刷新）。
   * @returns {Promise<Array<Record<string, any>>>}
   */
  load: async () => {
    set({ loading: true });
    try {
      const data = await api.moments({ limit: PAGE_SIZE });
      const moments = Array.isArray(data.moments) ? data.moments : [];
      set({ moments, hasMore: Boolean(data.has_more), loading: false, loaded: true });
      return moments;
    } catch (err) {
      set({ loading: false, loaded: true });
      throw err;
    }
  },

  /**
   * 上滑加载更多（before_id 游标取当前列表最后一条的 id）。
   * @returns {Promise<boolean>} 是否真的追加了数据
   */
  loadMore: async () => {
    const state = get();
    if (state.loading || state.loadingMore || !state.hasMore) return false;
    const list = state.moments;
    const last = list.length > 0 ? list[list.length - 1] : null;
    const beforeId = last ? Number(last.id) : 0;

    set({ loadingMore: true });
    try {
      const data = await api.moments({ beforeId: beforeId || undefined, limit: PAGE_SIZE });
      const incoming = Array.isArray(data.moments) ? data.moments : [];
      set((prev) => {
        const existing = new Set(prev.moments.map((item) => Number(item.id)));
        const merged = [...prev.moments, ...incoming.filter((item) => !existing.has(Number(item.id)))];
        return { moments: merged, hasMore: Boolean(data.has_more), loadingMore: false };
      });
      return incoming.length > 0;
    } catch (err) {
      set({ loadingMore: false });
      throw err;
    }
  },

  /**
   * 发布动态（图片 / 视频 / 音频需先上传拿到 /uploads 地址）。
   * @param {{content: string, images: Array<{url:string, type:string}>, media_type?: string, video_url?: string, audio_url?: string}} payload
   * @returns {Promise<Record<string, any>>} 新动态
   */
  publish: async (payload) => {
    const content = String((payload && payload.content) || '');
    const images = Array.isArray(payload && payload.images) ? payload.images : [];
    const mediaType = payload && payload.media_type ? payload.media_type : undefined;
    const videoUrl = payload && payload.video_url ? payload.video_url : undefined;
    const audioUrl = payload && payload.audio_url ? payload.audio_url : undefined;
    set({ publishing: true });
    try {
      const data = await api.createMoment({ content, media_type: mediaType, images, video_url: videoUrl, audio_url: audioUrl });
      const moment = data.moment;
      if (moment) {
        set((state) => ({
          moments: [moment, ...state.moments.filter((item) => Number(item.id) !== Number(moment.id))],
          loaded: true,
        }));
      }
      set({ publishing: false });
      return moment;
    } catch (err) {
      set({ publishing: false });
      throw err;
    }
  },

  /**
   * 删除自己的动态。
   * @param {number} id 动态 id
   * @returns {Promise<void>}
   */
  remove: async (id) => {
    const momentId = Number(id);
    if (!Number.isInteger(momentId) || momentId <= 0) return;
    const snapshot = get().moments;
    set({ moments: snapshot.filter((item) => Number(item.id) !== momentId) });
    try {
      await api.deleteMoment(momentId);
    } catch (err) {
      set({ moments: snapshot });
      throw err;
    }
  },

  /**
   * 点赞 / 取消点赞（乐观更新，失败回滚）。
   * @param {number} id 动态 id
   * @param {Record<string, any>} me 当前用户快照（用于立即渲染点赞人）
   * @returns {Promise<boolean>} 最终是否已点赞
   */
  toggleLike: async (id, me) => {
    const momentId = Number(id);
    const target = get().moments.find((item) => Number(item.id) === momentId);
    if (!target) return false;

    const nextLiked = !target.liked;
    const snapshot = get().moments;

    set({
      moments: patchMoment(snapshot, momentId, (moment) => ({
        ...moment,
        liked: nextLiked,
        like_count: Math.max(0, Number(moment.like_count || 0) + (nextLiked ? 1 : -1)),
        likes: mergeLikeList(moment.likes, me, nextLiked),
      })),
    });

    try {
      const data = nextLiked ? await api.likeMoment(momentId) : await api.unlikeMoment(momentId);
      set((state) => ({
        moments: patchMoment(state.moments, momentId, (moment) => ({
          ...moment,
          liked: Boolean(data.liked),
          like_count: Number(data.like_count ?? moment.like_count) || 0,
        })),
      }));
      return Boolean(data.liked);
    } catch (err) {
      set({ moments: snapshot });
      throw err;
    }
  },

  /**
   * 发表评论。
   * @param {number} id 动态 id
   * @param {string} content 评论正文
   * @returns {Promise<Record<string, any>>} 新评论
   */
  addComment: async (id, content) => {
    const momentId = Number(id);
    const text = String(content || '').trim();
    if (!momentId || !text) return null;
    const data = await api.addMomentComment(momentId, text);
    const comment = data.comment;
    if (comment) {
      set((state) => ({
        moments: patchMoment(state.moments, momentId, (moment) => ({
          ...moment,
          comments: [...(moment.comments || []).filter((item) => Number(item.id) !== Number(comment.id)), comment],
        })),
      }));
    }
    return comment;
  },

  /**
   * 删除评论（评论作者或动态作者均可）。
   * @param {number} momentId 动态 id
   * @param {number} commentId 评论 id
   * @returns {Promise<void>}
   */
  removeComment: async (momentId, commentId) => {
    const mid = Number(momentId);
    const cid = Number(commentId);
    if (!mid || !cid) return;
    const snapshot = get().moments;
    set({
      moments: patchMoment(snapshot, mid, (moment) => ({
        ...moment,
        comments: (moment.comments || []).filter((item) => Number(item.id) !== cid),
      })),
    });
    try {
      await api.deleteMomentComment(mid, cid);
    } catch (err) {
      set({ moments: snapshot });
      throw err;
    }
  },

  /** 登出时清空 */
  reset: () =>
    set({ moments: [], hasMore: true, loading: false, loadingMore: false, publishing: false, loaded: false }),
}));

export default useMoments;
