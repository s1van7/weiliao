/**
 * 收藏页：列表分页、快照渲染、跳转、取消收藏。
 * 快照在收藏时整段写入，源消息 / 动态删除后仍可展示。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useUI } from '../store/useUI';
import Avatar from '../components/Avatar';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Spinner from '../components/Spinner';
import Icon from '../components/Icon';
import { relativeTime } from '../lib/time';

const PAGE_SIZE = 20;

/**
 * 消息快照摘要。
 * @param {Record<string, any>} snapshot
 * @returns {string}
 */
function messageSummary(snapshot) {
  if (!snapshot) return '内容已失效';
  if (Number(snapshot.revoked) === 1) return '消息已撤回';
  const type = snapshot.type;
  const content = String(snapshot.content || '');
  if (type === 'image') return '[图片]';
  if (type === 'sticker') return '[表情]';
  if (type === 'card') return '[名片]';
  if (type === 'merged') return '[聊天记录]';
  if (type === 'system') return content;
  return content || '[消息]';
}

/**
 * 动态快照摘要。
 * @param {Record<string, any>} snapshot
 * @returns {string}
 */
function momentSummary(snapshot) {
  if (!snapshot) return '内容已失效';
  if (snapshot.content) return snapshot.content;
  if (snapshot.media_type === 'video') return '[视频]';
  const images = Array.isArray(snapshot.images) ? snapshot.images : [];
  if (images.length > 0) return `[${snapshot.media_type === 'live' ? 'live 图片' : '图片'}]`;
  return '[动态]';
}

/**
 * 渲染单条收藏。
 * @param {{
 *   favorite: Record<string, any>,
 *   onOpen: (favorite: Record<string, any>) => void,
 *   onDelete: (favorite: Record<string, any>) => Promise<void>,
 * }} props
 * @returns {JSX.Element}
 */
function FavoriteItem({ favorite, onOpen, onDelete }) {
  const snapshot = favorite.snapshot || {};
  const isMessage = favorite.content_type === 'message';

  const title = isMessage
    ? snapshot.sender_nickname || '好友'
    : (snapshot.user && snapshot.user.nickname) || '好友';
  const avatarColor = isMessage ? snapshot.sender_avatar_color : snapshot.user && snapshot.user.avatar_color;
  const avatarUrl = isMessage ? snapshot.sender_avatar_url : snapshot.user && snapshot.user.avatar_url;
  const summary = isMessage ? messageSummary(snapshot) : momentSummary(snapshot);

  return (
    <div className="flex items-center gap-3 px-3 py-3">
      <button type="button" onClick={() => onOpen(favorite)} className="shrink-0">
        <Avatar name={title} color={avatarColor || '#07C160'} src={avatarUrl || ''} size={44} />
      </button>
      <button type="button" onClick={() => onOpen(favorite)} className="min-w-0 flex-1 text-left">
        <p className="truncate text-[15px] text-[#111]">{title}</p>
        <p className="mt-[2px] truncate text-[13px] text-[#999]">{summary}</p>
        <p className="mt-[2px] text-[11px] text-[#B2B2B2]">{relativeTime(favorite.created_at)}</p>
      </button>
      <button
        type="button"
        aria-label="取消收藏"
        onClick={() => onDelete(favorite)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#B2B2B2] active:bg-black/5"
      >
        <Icon name="star" size={18} className="text-[#FF9F0A]" />
      </button>
    </div>
  );
}

/**
 * @param {{embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function FavoritesPage({ embedded = false }) {
  const back = useUI((state) => state.back);
  const navigate = useUI((state) => state.navigate);
  const showToast = useUI((state) => state.showToast);

  const [favorites, setFavorites] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);

  /**
   * 首屏加载。
   * @returns {Promise<void>}
   */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.favorites({ limit: PAGE_SIZE });
      setFavorites(data.favorites || []);
      setHasMore(Boolean(data.has_more));
    } catch (err) {
      showToast((err && err.message) || '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * 加载更多（按钮触发）。
   * @returns {Promise<void>}
   */
  const loadMore = async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const list = favorites;
      const last = list.length > 0 ? list[list.length - 1] : null;
      const beforeId = last ? Number(last.id) : 0;
      const data = await api.favorites({ beforeId: beforeId || undefined, limit: PAGE_SIZE });
      const incoming = data.favorites || [];
      setFavorites((prev) => {
        const existing = new Set(prev.map((item) => Number(item.id)));
        return [...prev, ...incoming.filter((item) => !existing.has(Number(item.id)))];
      });
      setHasMore(Boolean(data.has_more));
    } catch (err) {
      showToast((err && err.message) || '加载失败', 'error');
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  };

  /**
   * 跳转：消息 → 会话；动态 → 用户朋友圈。
   * @param {Record<string, any>} favorite
   * @returns {void}
   */
  const openFavorite = (favorite) => {
    const snapshot = favorite.snapshot || {};
    if (favorite.content_type === 'message') {
      const conversationId = Number(snapshot.conversation_id) || 0;
      if (conversationId) navigate(`chat/${conversationId}`);
      return;
    }
    if (favorite.content_type === 'moment') {
      const userId = snapshot.user ? Number(snapshot.user.id) : 0;
      if (userId) navigate(`userMoments/${userId}`);
    }
  };

  /**
   * 取消收藏。
   * @param {Record<string, any>} favorite
   * @returns {Promise<void>}
   */
  const removeFavorite = async (favorite) => {
    try {
      await api.deleteFavorite(favorite.id);
      setFavorites((prev) => prev.filter((item) => Number(item.id) !== Number(favorite.id)));
      showToast('已取消收藏');
    } catch (err) {
      showToast((err && err.message) || '操作失败', 'error');
    }
  };

  const body = (
    <div className={`mx-auto w-full ${embedded ? 'max-w-[560px] pt-2' : ''} pb-8`}>
      {loading && favorites.length === 0 ? (
        <div className="flex justify-center py-16">
          <Spinner size={22} className="text-[#B2B2B2]" />
        </div>
      ) : null}

      {!loading && favorites.length === 0 ? (
        <EmptyState title="还没有收藏" description="长按消息或点动态菜单的「收藏」即可收藏" variant="contact" />
      ) : null}

      {favorites.length > 0 ? (
        <div className="divide-y divide-[#F0F0F0] bg-white">
          {favorites.map((favorite) => (
            <FavoriteItem
              key={favorite.id}
              favorite={favorite}
              onOpen={openFavorite}
              onDelete={removeFavorite}
            />
          ))}
        </div>
      ) : null}

      {favorites.length > 0 && hasMore ? (
        <div className="flex justify-center py-4">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="flex h-9 items-center gap-1.5 rounded-[6px] bg-white px-5 text-[13px] text-[#576B95] active:bg-black/5 disabled:opacity-60"
          >
            {loadingMore ? <Spinner size={14} className="text-[#576B95]" /> : null}
            加载更多
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className={`flex h-full flex-col ${embedded ? 'bg-[#F5F5F5]' : 'bg-[#EDEDED]'}`}>
      {embedded ? (
        <div className="flex h-[52px] shrink-0 items-center border-b border-[#E0E0E0] bg-[#F5F5F5] px-4">
          <button
            type="button"
            onClick={back}
            className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
            aria-label="返回"
          >
            <Icon name="back" size={20} className="text-[#111]" />
          </button>
          <h1 className="ml-1 text-[16px] font-semibold text-[#111]">我的收藏</h1>
        </div>
      ) : (
        <PageHeader title="我的收藏" onBack={back} />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </div>
  );
}
