/**
 * 朋友圈单条动态卡片：
 *   - 头像 + 昵称（自己显示「我」）+ 相对时间；
 *   - 文字保留换行，超过 6 行折叠为「全文 / 收起」；
 *   - 九宫格图片：1 张大图、2-4 张两列、5-9 张三列，点击全屏预览；
 *   - 点赞 / 评论操作区 + 点赞人列表（♡ 张三、李四）+ 评论列表（可删的显示删除）；
 *   - 自己的动态右上角「···」可删除。
 */
import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import Icon from './Icon';
import CommentInput from './CommentInput';
import Modal from './Modal';
import MomentMedia from './MomentMedia';
import { mediaUrl } from '../config';
import { relativeTime } from '../lib/time';
import { useUI } from '../store/useUI';

/**
 * 根据图片数量决定网格列数。
 * @param {number} count 图片数
 * @returns {string} Tailwind 栅格类
 */
function gridClassOf(count) {
  if (count <= 1) return 'grid-cols-1';
  if (count <= 4) return 'grid-cols-2';
  return 'grid-cols-3';
}

/**
 * @param {{
 *   moment: Record<string, any>,
 *   myId: number,
 *   onLike: (moment: Record<string, any>) => Promise<unknown>,
 *   onComment: (moment: Record<string, any>, content: string) => Promise<unknown>,
 *   onDeleteComment: (moment: Record<string, any>, comment: Record<string, any>) => Promise<unknown>,
 *   onDelete: (moment: Record<string, any>) => Promise<unknown>,
 *   onFavorite: (moment: Record<string, any>) => Promise<unknown>,
 *   onImageClick?: (src: string) => void,
 * }} props
 * @returns {JSX.Element}
 */
export default function MomentCard({
  moment,
  myId,
  onLike,
  onComment,
  onDeleteComment,
  onDelete,
  onFavorite,
  onImageClick,
}) {
  const showToast = useUI((state) => state.showToast);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  // 加载失败的图片 url（图片地址 → true），失败后渲染灰底占位而不是裂图
  const [failedImages, setFailedImages] = useState({});
  const contentRef = useRef(null);

  const user = moment.user || { nickname: '', avatar_color: '#07C160', avatar_url: '' };
  // 兼容旧结构（images 为 string[]）与新结构（images 为 [{url,type}]）
  const images = (Array.isArray(moment.images) ? moment.images : []).map((item) =>
    typeof item === 'string' ? { url: item, type: 'image' } : { url: item.url, type: item.type || 'image' },
  );
  const audioUrl = moment.audio_url || '';
  const mediaType =
    moment.media_type ||
    (audioUrl ? 'audio' : images.length > 0 ? (images.some((item) => item.type === 'live') ? 'live' : 'image') : 'text');
  const videoUrl = moment.video_url || '';
  const likes = Array.isArray(moment.likes) ? moment.likes : [];
  const comments = Array.isArray(moment.comments) ? moment.comments : [];
  const isMine = Number(user.id) === Number(myId);

  // 折叠判定：line-clamp 状态下 scrollHeight 反映完整内容高度
  useEffect(() => {
    const el = contentRef.current;
    if (!el) {
      setOverflowing(false);
      return;
    }
    setOverflowing(el.scrollHeight > el.clientHeight + 4);
  }, [moment.content, expanded]);

  /**
   * 点赞 / 取消点赞。
   * @returns {Promise<void>}
   */
  const handleLike = async () => {
    if (likeBusy) return;
    setLikeBusy(true);
    try {
      await onLike(moment);
    } catch (err) {
      showToast((err && err.message) || '操作失败', 'error');
    } finally {
      setLikeBusy(false);
    }
  };

  /**
   * 发表评论。
   * @param {string} content
   * @returns {Promise<void>}
   */
  const handleComment = async (content) => {
    try {
      await onComment(moment, content);
      setCommentOpen(false);
    } catch (err) {
      showToast((err && err.message) || '评论失败', 'error');
    }
  };

  /**
   * 删除评论。
   * @param {Record<string, any>} comment
   * @returns {Promise<void>}
   */
  const handleDeleteComment = async (comment) => {
    try {
      await onDeleteComment(moment, comment);
    } catch (err) {
      showToast((err && err.message) || '删除失败', 'error');
    }
  };

  /**
   * 删除动态（二次确认）。
   * @returns {Promise<void>}
   */
  const handleDelete = async () => {
    setMenuOpen(false);
    try {
      await onDelete(moment);
      showToast('已删除');
    } catch (err) {
      showToast((err && err.message) || '删除失败', 'error');
    }
  };

  /**
   * 收藏动态。
   * @returns {Promise<void>}
   */
  const handleFavorite = async () => {
    setMenuOpen(false);
    try {
      await onFavorite(moment);
      showToast('已收藏');
    } catch (err) {
      showToast((err && err.message) || '收藏失败', 'error');
    }
  };

  return (
    <div className="flex gap-2.5 bg-white px-3 py-3">
      <Avatar name={user.nickname} color={user.avatar_color} src={user.avatar_url} size={40} />

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate text-[15px] font-medium leading-5 text-[#576B95]">
            {user.nickname || '好友'}
          </p>
          <div className="relative">
            <button
              type="button"
              aria-label="更多"
              onClick={() => setMenuOpen(true)}
              className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-[#F7F7F7] text-[#666] active:bg-black/10"
            >
              <Icon name="more" size={14} />
            </button>
          </div>
        </div>

        {/* 正文 */}
        {moment.content ? (
          <div className="mt-1">
            <p
              ref={contentRef}
              className={`wx-selectable whitespace-pre-wrap break-words text-[15px] leading-[22px] text-[#111] ${
                expanded ? '' : 'line-clamp-6'
              }`}
            >
              {moment.content}
            </p>
            {overflowing || expanded ? (
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="mt-1 text-[13px] text-[#576B95] active:opacity-60"
              >
                {expanded ? '收起' : '全文'}
              </button>
            ) : null}
          </div>
        ) : null}

        {/* 视频动态 */}
        {mediaType === 'video' && videoUrl ? (
          <div className="mt-2 max-w-[240px] overflow-hidden rounded-[4px] bg-black">
            <MomentMedia url={videoUrl} type="video" className="w-full" />
          </div>
        ) : null}

        {/* 音频动态 */}
        {mediaType === 'audio' && audioUrl ? (
          <div className="mt-2 max-w-[280px]">
            <MomentMedia url={audioUrl} type="audio" className="w-full" />
          </div>
        ) : null}

        {/* 图片 / live 九宫格 */}
        {mediaType !== 'video' && mediaType !== 'audio' && images.length > 0 ? (
          <div className={`mt-2 grid gap-1 ${gridClassOf(images.length)}`}>
            {images.map((item, index) => {
              const single = images.length === 1;
              const isVideo = item.type === 'live' && /\.mp4$/i.test(item.url);
              const failed = Boolean(failedImages[item.url]);
              const clickable = !isVideo && !failed && onImageClick;

              return (
                <button
                  key={`${item.url}-${index}`}
                  type="button"
                  onClick={() => {
                    if (clickable) onImageClick(mediaUrl(item.url));
                  }}
                  className={`overflow-hidden rounded-[3px] bg-[#F2F2F2] ${
                    single ? 'aspect-[4/3] w-full max-w-[220px]' : 'aspect-square w-full'
                  }`}
                >
                  {failed ? (
                    <span className="flex h-full w-full items-center justify-center bg-[#F2F2F2] text-[12px] leading-4 text-[#B2B2B2]">
                      图片加载失败
                    </span>
                  ) : (
                    <MomentMedia
                      url={item.url}
                      type={item.type}
                      alt={`动态图片 ${index + 1}`}
                      className="h-full w-full object-cover"
                      onClick={clickable ? () => onImageClick(mediaUrl(item.url)) : undefined}
                    />
                  )}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* 时间 + 操作 */}
        <div className="mt-2 flex items-center gap-3">
          <span className="text-[12px] leading-4 text-[#B2B2B2]">{relativeTime(moment.created_at)}</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={handleLike}
            className={`flex items-center gap-1 text-[12px] leading-4 active:opacity-60 ${
              moment.liked ? 'text-[#FA5151]' : 'text-[#576B95]'
            }`}
          >
            <span className="text-[14px] leading-none">{moment.liked ? '♥' : '♡'}</span>
            {Number(moment.like_count) > 0 ? moment.like_count : '赞'}
          </button>
          <button
            type="button"
            onClick={() => setCommentOpen((prev) => !prev)}
            className="flex items-center gap-1 text-[12px] leading-4 text-[#576B95] active:opacity-60"
          >
            <Icon name="chat" size={13} className="text-[#576B95]" />
            评论
          </button>
        </div>

        {/* 点赞人 + 评论列表 */}
        {likes.length > 0 || comments.length > 0 || commentOpen ? (
          <div className="mt-2 rounded-[4px] bg-[#F7F7F7] px-2.5 py-2">
            {likes.length > 0 ? (
              <div className="flex gap-1 text-[13px] leading-5 text-[#576B95]">
                <span className="shrink-0 text-[#FA5151]">♡</span>
                <span className="min-w-0 flex-1 break-words">
                  {likes.map((like) => (Number(like.id) === Number(myId) ? '我' : like.nickname)).join('、')}
                </span>
              </div>
            ) : null}

            {likes.length > 0 && comments.length > 0 ? <div className="my-1 h-px bg-[#E7E7E7]" /> : null}

            {comments.map((comment) => (
              <div key={comment.id} className="flex items-start gap-1 text-[13px] leading-5">
                <span className="min-w-0 flex-1 break-words">
                  <span className="text-[#576B95]">
                    {Number(comment.user && comment.user.id) === Number(myId)
                      ? '我'
                      : (comment.user && comment.user.nickname) || '好友'}
                  </span>
                  <span className="text-[#111]">：{comment.content}</span>
                </span>
                {comment.can_delete ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteComment(comment)}
                    className="shrink-0 text-[12px] text-[#576B95] active:opacity-60"
                  >
                    删除
                  </button>
                ) : null}
              </div>
            ))}

            {commentOpen ? (
              <CommentInput
                onSubmit={handleComment}
                onCancel={() => setCommentOpen(false)}
                placeholder={`评论 ${user.nickname || ''}`}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 动态操作弹窗：收藏（所有人）+ 删除（仅自己） */}
      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} width={260}>
        <div className="-mx-5 -my-3">
          <button
            type="button"
            onClick={handleFavorite}
            className="flex h-[48px] w-full items-center justify-center gap-2 text-[16px] text-[#333] active:bg-black/5"
          >
            <Icon name="star" size={17} className="text-[#333]" />
            收藏
          </button>
          {isMine ? (
            <>
              <div className="h-px bg-[#E5E5E5]" />
              <button
                type="button"
                onClick={handleDelete}
                className="flex h-[48px] w-full items-center justify-center text-[16px] text-[#FA5151] active:bg-black/5"
              >
                删除这条动态
              </button>
            </>
          ) : null}
          <div className="h-px bg-[#E5E5E5]" />
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            className="flex h-[48px] w-full items-center justify-center text-[16px] text-[#333] active:bg-black/5"
          >
            取消
          </button>
        </div>
      </Modal>
    </div>
  );
}
