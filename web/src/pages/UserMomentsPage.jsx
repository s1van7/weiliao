/**
 * 用户朋友圈页：展示目标用户封面 + 其朋友圈分页。
 * 数据来源 GET /api/users/:id（封面/备注）与 GET /api/moments?user_id=（朋友圈）。
 * 非好友由后端统一 404，本页 catch 后 toast 并返回。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../store/useAuth';
import { useUI } from '../store/useUI';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import MomentCard from '../components/MomentCard';
import MomentMedia from '../components/MomentMedia';

const PAGE_SIZE = 20;

/**
 * @param {{userId: number, embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function UserMomentsPage({ userId, embedded = false }) {
  const id = Number(userId) || 0;
  const me = useAuth((state) => state.user);
  const myId = me ? Number(me.id) : 0;
  const back = useUI((state) => state.back);
  const showToast = useUI((state) => state.showToast);
  const openImage = useUI((state) => state.openImage);

  const [profile, setProfile] = useState(null);
  const [moments, setMoments] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);

  /**
   * 加载目标资料 + 首屏朋友圈。
   * @returns {Promise<void>}
   */
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [userData, momentData] = await Promise.all([
        api.getUser(id),
        api.moments({ userId: id, limit: PAGE_SIZE }),
      ]);
      setProfile(userData.user || null);
      setMoments(momentData.moments || []);
      setHasMore(Boolean(momentData.has_more));
    } catch (err) {
      showToast((err && err.message) || '加载失败', 'error');
      back();
    } finally {
      setLoading(false);
    }
  }, [id, back, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * 加载更多。
   * @returns {Promise<void>}
   */
  const loadMore = async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const last = moments.length > 0 ? moments[moments.length - 1] : null;
      const beforeId = last ? Number(last.id) : 0;
      const data = await api.moments({ userId: id, beforeId: beforeId || undefined, limit: PAGE_SIZE });
      const incoming = data.moments || [];
      setMoments((prev) => {
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
   * 点赞 / 取消点赞（本地乐观更新）。
   * @param {Record<string, any>} moment
   * @returns {Promise<unknown>}
   */
  const handleLike = async (moment) => {
    const nextLiked = !moment.liked;
    setMoments((prev) =>
      prev.map((item) =>
        Number(item.id) === Number(moment.id)
          ? { ...item, liked: nextLiked, like_count: Math.max(0, Number(item.like_count || 0) + (nextLiked ? 1 : -1)) }
          : item,
      ),
    );
    try {
      const data = nextLiked ? await api.likeMoment(moment.id) : await api.unlikeMoment(moment.id);
      setMoments((prev) =>
        prev.map((item) =>
          Number(item.id) === Number(moment.id)
            ? { ...item, liked: Boolean(data.liked), like_count: Number(data.like_count ?? item.like_count) || 0 }
            : item,
        ),
      );
    } catch (err) {
      setMoments((prev) =>
        prev.map((item) =>
          Number(item.id) === Number(moment.id) ? { ...item, liked: moment.liked, like_count: moment.like_count } : item,
        ),
      );
      throw err;
    }
  };

  /**
   * 发表评论。
   * @param {Record<string, any>} moment
   * @param {string} content
   * @returns {Promise<unknown>}
   */
  const handleComment = async (moment, content) => {
    const data = await api.addMomentComment(moment.id, content);
    const comment = data.comment;
    if (comment) {
      setMoments((prev) =>
        prev.map((item) =>
          Number(item.id) === Number(moment.id)
            ? { ...item, comments: [...(item.comments || []).filter((c) => Number(c.id) !== Number(comment.id)), comment] }
            : item,
        ),
      );
    }
    return comment;
  };

  /**
   * 删除评论。
   * @param {Record<string, any>} moment
   * @param {Record<string, any>} comment
   * @returns {Promise<unknown>}
   */
  const handleDeleteComment = async (moment, comment) => {
    await api.deleteMomentComment(moment.id, comment.id);
    setMoments((prev) =>
      prev.map((item) =>
        Number(item.id) === Number(moment.id)
          ? { ...item, comments: (item.comments || []).filter((c) => Number(c.id) !== Number(comment.id)) }
          : item,
      ),
    );
  };

  /**
   * 删除动态。
   * @param {Record<string, any>} moment
   * @returns {Promise<unknown>}
   */
  const handleDelete = async (moment) => {
    await api.deleteMoment(moment.id);
    setMoments((prev) => prev.filter((item) => Number(item.id) !== Number(moment.id)));
  };

  /**
   * 收藏动态。
   * @param {Record<string, any>} moment
   * @returns {Promise<unknown>}
   */
  const handleFavorite = async (moment) => {
    const data = await api.createFavorite('moment', moment.id);
    return data.favorite;
  };

  const coverUrl = profile ? profile.cover_url || '' : '';
  const coverType = profile ? profile.cover_type || 'photo' : 'photo';

  const body = (
    <div className={`mx-auto w-full ${embedded ? 'max-w-[620px]' : ''} pb-8`}>
      {/* 封面 */}
      <div className="relative h-[200px] w-full overflow-hidden bg-gradient-to-br from-[#3F6FD8] via-[#4C7DE0] to-[#8FBDF5]">
        {coverUrl ? (
          <MomentMedia url={coverUrl} type={coverType} className="h-full w-full object-cover" />
        ) : null}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-end gap-2 px-3 pb-3">
          <span className="mb-1.5 max-w-[150px] truncate text-[15px] font-semibold text-white drop-shadow">
            {profile ? profile.nickname : '好友'}
          </span>
          <Avatar
            name={profile ? profile.nickname : ''}
            color={profile ? profile.avatar_color : '#07C160'}
            src={profile ? profile.avatar_url : ''}
            size={56}
            radius={6}
            className="ring-2 ring-white"
          />
        </div>
      </div>

      {loading && moments.length === 0 ? (
        <div className="flex justify-center py-10">
          <Spinner size={22} className="text-[#B2B2B2]" />
        </div>
      ) : null}

      {!loading && moments.length === 0 ? (
        <EmptyState title="对方还没发过朋友圈" description="这里会展示 TA 的朋友圈动态" variant="contact" />
      ) : null}

      {moments.length > 0 ? (
        <div className="mt-2 flex flex-col divide-y divide-[#F0F0F0] bg-white">
          {moments.map((moment) => (
            <MomentCard
              key={moment.id}
              moment={moment}
              myId={myId}
              onLike={handleLike}
              onComment={handleComment}
              onDeleteComment={handleDeleteComment}
              onDelete={handleDelete}
              onFavorite={handleFavorite}
              onImageClick={openImage}
            />
          ))}
        </div>
      ) : null}

      {moments.length > 0 && hasMore ? (
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
          <h1 className="ml-1 text-[16px] font-semibold text-[#111]">朋友圈</h1>
        </div>
      ) : (
        <PageHeader title="朋友圈" onBack={back} />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#EDEDED]">{body}</div>
    </div>
  );
}
