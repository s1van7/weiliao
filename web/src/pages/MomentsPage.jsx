/**
 * 朋友圈时间线：
 *   - 顶部封面区（渐变 + 我的头像昵称，不做封面上传）；
 *   - 右上角相机按钮进入发布页；
 *   - 下拉刷新（移动端 touch）+ 上滑加载更多（滚动监听）；
 *   - 空态「好友还没发过动态」。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../store/useAuth';
import { useMoments } from '../store/useMoments';
import { useUI } from '../store/useUI';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';
import Spinner from '../components/Spinner';
import MomentCard from '../components/MomentCard';
import MomentMedia from '../components/MomentMedia';

/** 下拉刷新触发距离（px） */
const PULL_THRESHOLD = 56;
/** 距底多少 px 触发加载更多 */
const LOAD_MORE_OFFSET = 240;

/**
 * @param {{embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function MomentsPage({ embedded = false }) {
  const user = useAuth((state) => state.user);
  const updateProfile = useAuth((state) => state.updateProfile);
  const myId = user ? Number(user.id) : 0;

  const moments = useMoments((state) => state.moments);
  const hasMore = useMoments((state) => state.hasMore);
  const loading = useMoments((state) => state.loading);
  const loadingMore = useMoments((state) => state.loadingMore);
  const loaded = useMoments((state) => state.loaded);

  const back = useUI((state) => state.back);
  const navigate = useUI((state) => state.navigate);
  const showToast = useUI((state) => state.showToast);
  const openImage = useUI((state) => state.openImage);

  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const scrollRef = useRef(null);
  const pullStartY = useRef(-1);
  const loadingRef = useRef(false);
  const coverInputRef = useRef(null);

  /**
   * 刷新时间线（下拉 / 按钮共用）。
   * @returns {Promise<void>}
   */
  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await useMoments.getState().load();
    } catch (err) {
      showToast((err && err.message) || '加载失败', 'error');
    } finally {
      setRefreshing(false);
      setPull(0);
    }
  }, [refreshing, showToast]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 滚动到底部附近时加载下一页。
   * @returns {void}
   */
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || loadingRef.current) return;
    if (!useMoments.getState().hasMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > LOAD_MORE_OFFSET) return;

    loadingRef.current = true;
    useMoments
      .getState()
      .loadMore()
      .catch((err) => showToast((err && err.message) || '加载失败', 'error'))
      .finally(() => {
        loadingRef.current = false;
      });
  };

  /**
   * 触摸开始：仅在滚动到顶部时记录起点，用于下拉刷新。
   * @param {React.TouchEvent<HTMLDivElement>} event
   * @returns {void}
   */
  const handleTouchStart = (event) => {
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0) {
      pullStartY.current = -1;
      return;
    }
    pullStartY.current = event.touches[0] ? event.touches[0].clientY : -1;
  };

  /**
   * 触摸移动：跟随手指位移（上限 80px）展示下拉提示。
   * @param {React.TouchEvent<HTMLDivElement>} event
   * @returns {void}
   */
  const handleTouchMove = (event) => {
    const start = pullStartY.current;
    if (start < 0 || refreshing) return;
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0) return;
    const current = event.touches[0] ? event.touches[0].clientY : start;
    const delta = current - start;
    setPull(Math.max(0, Math.min(80, delta)));
  };

  /**
   * 触摸结束：超过阈值则刷新。
   * @returns {void}
   */
  const handleTouchEnd = () => {
    if (pull >= PULL_THRESHOLD) refresh();
    else setPull(0);
    pullStartY.current = -1;
  };

  /**
   * 点赞 / 取消点赞。
   * @param {Record<string, any>} moment
   * @returns {Promise<unknown>}
   */
  const handleLike = (moment) =>
    useMoments.getState().toggleLike(moment.id, {
      id: myId,
      nickname: (user && user.nickname) || '',
      avatar_color: (user && user.avatar_color) || '#07C160',
      avatar_url: (user && user.avatar_url) || '',
    });

  /**
   * 评论。
   * @param {Record<string, any>} moment
   * @param {string} content
   * @returns {Promise<unknown>}
   */
  const handleComment = (moment, content) => useMoments.getState().addComment(moment.id, content);

  /**
   * 删除评论。
   * @param {Record<string, any>} moment
   * @param {Record<string, any>} comment
   * @returns {Promise<unknown>}
   */
  const handleDeleteComment = (moment, comment) => useMoments.getState().removeComment(moment.id, comment.id);

  /**
   * 删除动态（二次确认放在卡片弹窗内，这里直接执行）。
   * @param {Record<string, any>} moment
   * @returns {Promise<unknown>}
   */
  const handleDelete = (moment) => useMoments.getState().remove(moment.id);

  /**
   * 收藏动态。
   * @param {Record<string, any>} moment
   * @returns {Promise<unknown>}
   */
  const handleFavorite = async (moment) => {
    const data = await api.createFavorite('moment', moment.id);
    return data.favorite;
  };

  /**
   * 打开系统选图（封面支持图片与 mp4）。
   * @returns {void}
   */
  const handlePickCover = () => {
    if (coverBusy) return;
    const input = coverInputRef.current;
    if (!input) return;
    input.value = '';
    input.click();
  };

  /**
   * 选择封面：图片（jpg/png/webp→photo、gif→live）与 mp4→video。
   * @param {React.ChangeEvent<HTMLInputElement>} event
   * @returns {Promise<void>}
   */
  const handleCoverChange = async (event) => {
    const input = event.target;
    const file = input && input.files ? input.files[0] : null;
    if (!file) return;

    setCoverBusy(true);
    try {
      let coverUrl = '';
      let coverType = 'photo';
      if (file.type === 'video/mp4') {
        const uploaded = await api.uploadVideo(file);
        if (!uploaded || !uploaded.url) throw new Error('封面上传失败');
        coverUrl = uploaded.url;
        coverType = 'video';
      } else if (/^image\//i.test(file.type || '')) {
        const uploaded = await api.uploadImage(file);
        if (!uploaded || !uploaded.url) throw new Error('封面上传失败');
        coverUrl = uploaded.url;
        coverType = file.type === 'image/gif' ? 'live' : 'photo';
      } else {
        showToast('封面仅支持图片或 mp4 视频', 'error');
        return;
      }

      await updateProfile({ cover_url: coverUrl, cover_type: coverType });
      showToast('封面已更新');
    } catch (err) {
      showToast((err && err.message) || '封面上传失败', 'error');
    } finally {
      setCoverBusy(false);
      if (input) input.value = '';
    }
  };

  /**
   * 移除封面，回退到渐变背景。
   * @returns {Promise<void>}
   */
  const handleRemoveCover = async () => {
    if (coverBusy) return;
    setCoverBusy(true);
    try {
      await updateProfile({ cover_url: '', cover_type: 'photo' });
      showToast('封面已移除');
    } catch (err) {
      showToast((err && err.message) || '操作失败', 'error');
    } finally {
      setCoverBusy(false);
    }
  };

  const publishButton = (
    <button
      type="button"
      aria-label="发布动态"
      onClick={() => navigate('momentPublish')}
      className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
    >
      <Icon name="camera" size={22} className="text-[#111]" />
    </button>
  );

  const cover = (
    <div className="relative h-[200px] w-full overflow-hidden bg-gradient-to-br from-[#3F6FD8] via-[#4C7DE0] to-[#8FBDF5]">
      {user && user.cover_url ? (
        <MomentMedia
          url={user.cover_url}
          type={user.cover_type || 'photo'}
          className="h-full w-full object-cover"
        />
      ) : null}

      {/* 封面操作 */}
      <div className="absolute right-2 top-2 flex gap-1.5">
        <button
          type="button"
          onClick={handlePickCover}
          disabled={coverBusy}
          className="flex items-center gap-1 rounded-full bg-black/30 px-2.5 py-1 text-[11px] text-white active:bg-black/50 disabled:opacity-60"
        >
          {coverBusy ? <Spinner size={11} className="text-white" /> : <Icon name="camera" size={12} className="text-white" />}
          更换封面
        </button>
        {user && user.cover_url ? (
          <button
            type="button"
            onClick={handleRemoveCover}
            disabled={coverBusy}
            className="flex items-center rounded-full bg-black/30 px-2.5 py-1 text-[11px] text-white active:bg-black/50 disabled:opacity-60"
          >
            移除封面
          </button>
        ) : null}
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-end gap-2 px-3 pb-3">
        <span className="mb-1.5 max-w-[150px] truncate text-[15px] font-semibold text-white drop-shadow">
          {(user && user.nickname) || '我'}
        </span>
        <Avatar
          name={(user && user.nickname) || ''}
          color={(user && user.avatar_color) || '#07C160'}
          src={(user && user.avatar_url) || ''}
          size={56}
          radius={6}
          className="ring-2 ring-white"
        />
      </div>

      <input
        ref={coverInputRef}
        type="file"
        accept="image/*,video/mp4"
        className="hidden"
        onChange={handleCoverChange}
      />

      {refreshing ? (
        <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/25 px-2 py-1 text-[11px] text-white">
          <Spinner size={11} className="text-white" />
          刷新中
        </span>
      ) : null}
    </div>
  );

  const list = (
    <>
      {cover}

      {/* 下拉刷新提示（仅移动端，跟手展示） */}
      {pull > 0 ? (
        <div
          className="flex items-center justify-center overflow-hidden bg-[#F5F5F5] text-[12px] text-[#999] transition-[height]"
          style={{ height: Math.round(pull / 2) }}
        >
          {pull >= PULL_THRESHOLD ? '松开刷新' : '下拉刷新'}
        </div>
      ) : null}

      {loading && moments.length === 0 ? (
        <div className="flex justify-center py-10">
          <Spinner size={22} className="text-[#B2B2B2]" />
        </div>
      ) : null}

      {!loading && loaded && moments.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <span className="text-[34px] leading-none">🌤️</span>
          <p className="text-[14px] text-[#999]">好友还没发过动态</p>
          <button
            type="button"
            onClick={() => navigate('momentPublish')}
            className="mt-1 rounded-[6px] bg-[#07C160] px-4 py-1.5 text-[13px] text-white active:bg-[#06AD56]"
          >
            发一条
          </button>
        </div>
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

      {loadingMore ? (
        <div className="flex justify-center py-4">
          <Spinner size={18} className="text-[#B2B2B2]" />
        </div>
      ) : null}

      {!hasMore && moments.length > 0 ? (
        <p className="py-4 text-center text-[12px] text-[#B2B2B2]">没有更多了</p>
      ) : null}

      {moments.length > 0 && !embedded ? (
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={refresh}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[6px] bg-white text-[13px] text-[#576B95] active:bg-black/5"
          >
            <Icon name="refresh" size={14} className="text-[#576B95]" />
            刷新
          </button>
        </div>
      ) : null}
    </>
  );

  const body = (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#EDEDED] pb-4"
    >
      {embedded ? <div className="mx-auto w-full max-w-[620px]">{list}</div> : list}
    </div>
  );

  if (embedded) {
    return (
      <div className="flex h-full flex-col bg-[#EDEDED]">
        <div className="flex h-[52px] shrink-0 items-center border-b border-[#E0E0E0] bg-[#F5F5F5] px-4">
          <button
            type="button"
            onClick={back}
            className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
            aria-label="返回"
          >
            <Icon name="back" size={20} className="text-[#111]" />
          </button>
          <h1 className="ml-1 min-w-0 flex-1 truncate text-[16px] font-semibold text-[#111]">朋友圈</h1>
          <button
            type="button"
            onClick={refresh}
            className="mr-1 flex h-9 items-center gap-1 rounded-full px-2 text-[13px] text-[#576B95] active:bg-black/5"
          >
            <Icon name="refresh" size={15} className="text-[#576B95]" />
            刷新
          </button>
          {publishButton}
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#EDEDED]">
      <PageHeader title="朋友圈" onBack={back} right={publishButton} />
      {body}
    </div>
  );
}
