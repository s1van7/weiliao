/**
 * 消息流：时间分组（>5 分钟插入分隔条）、系统消息、撤回占位、分页加载与滚动位置保持。
 * 消息不足一屏时贴底显示（微信行为）。
 */
import { Fragment, useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import Spinner from './Spinner';
import EmptyState from './EmptyState';
import { formatMessageTime, shouldShowTime } from '../lib/time';

/**
 * @param {{
 *   conversationId: number,
 *   messages: Array<Record<string, any>>,
 *   myId: number,
 *   isGroup?: boolean,
 *   hasMore?: boolean,
 *   loading?: boolean,
 *   loadingOlder?: boolean,
 *   mentionNames?: Record<string|number, string>|null,
 *   onLoadOlder?: () => Promise<unknown>,
 *   onImageClick?: (src: string) => void,
 *   onMessageAction?: (message: Record<string, any>) => void,
 *   onAvatarClick?: (userId: number) => void,
 *   onAvatarMention?: (userId: number, nickname: string) => void,
 *   onCardOpen?: (userId: number) => void,
 *   transcribingId?: number,
 * }} props
 * @returns {JSX.Element}
 */
export default function MessageList({
  conversationId,
  messages,
  myId,
  isGroup = false,
  hasMore = false,
  loading = false,
  loadingOlder = false,
  mentionNames = null,
  onLoadOlder,
  onImageClick,
  onMessageAction,
  onAvatarClick,
  onAvatarMention,
  onCardOpen,
  transcribingId = null,
  selecting = false,
  selectedKeys = null,
  onToggleSelect,
}) {
  const scrollRef = useRef(null);
  const prependingRef = useRef(false);
  const loadingRef = useRef(false);
  const prevCountRef = useRef(0);

  // 切换会话 / 首屏加载完成：滚到底部
  // 注意：不要依赖 messages.length，否则向上翻页（前插）也会被拽回底部
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (loading) return;
    el.scrollTop = el.scrollHeight;
    prevCountRef.current = messages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, loading]);

  // 新消息到达：接近底部或自己发送时自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = prevCountRef.current;
    prevCountRef.current = messages.length;
    if (messages.length <= prev) return;
    if (prependingRef.current) return;
    const last = messages[messages.length - 1];
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom || (last && last.sender_id === myId)) el.scrollTop = el.scrollHeight;
  }, [messages, myId]);

  /**
   * 滚到顶附近加载更早消息，并用 scrollHeight 差值保持视觉位置。
   * @returns {void}
   */
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || !onLoadOlder) return;
    if (loadingRef.current || !hasMore || loadingOlder) return;
    if (el.scrollTop > 80) return;

    loadingRef.current = true;
    prependingRef.current = true;
    const previousHeight = el.scrollHeight;

    Promise.resolve(onLoadOlder())
      .catch(() => {})
      .finally(() => {
        requestAnimationFrame(() => {
          const node = scrollRef.current;
          if (node) node.scrollTop = node.scrollHeight - previousHeight;
          loadingRef.current = false;
          setTimeout(() => {
            prependingRef.current = false;
          }, 120);
        });
      });
  };

  if (loading && messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size={22} className="text-[#B2B2B2]" />
      </div>
    );
  }

  if (!loading && messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <EmptyState title="还没有消息" description="发条消息，开始聊天吧" variant="chat" />
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-2 pt-1 md:px-6"
    >
      {/* min-h-full + justify-end：内容不足一屏时从底部开始排列 */}
      <div className="flex min-h-full flex-col justify-end">
        {loadingOlder ? (
          <div className="flex justify-center py-2">
            <Spinner size={16} className="text-[#B2B2B2]" />
          </div>
        ) : null}

        {!hasMore && messages.length > 0 ? (
          <div className="py-2 text-center text-[12px] text-[#B2B2B2]">没有更多消息了</div>
        ) : null}

        {messages.map((message, index) => {
          const previous = index > 0 ? messages[index - 1] : null;
          const showTime = shouldShowTime(previous ? previous.created_at : 0, message.created_at);
          const isMine = message.sender_id === myId;
          const revoked = Number(message.revoked) === 1;
          const key = `${message.client_id || message.id}-${index}`;

          if (message.type === 'system') {
            return (
              <div key={key} className="my-2 flex justify-center px-6">
                <span className="rounded-[3px] bg-black/[0.06] px-2 py-[3px] text-center text-[12px] leading-[17px] text-[#888]">
                  {message.content}
                </span>
              </div>
            );
          }

          const sameSender = previous && previous.sender_id === message.sender_id && previous.type !== 'system';
          const marginClass = !sameSender || showTime ? 'mt-4' : 'mt-1.5';
          const showName = isGroup && !isMine && !revoked && (!sameSender || showTime);
          const selectable = selecting && typeof message.id === 'number';
          const selected = selectable && selectedKeys ? Boolean(selectedKeys[String(message.id)]) : false;

          return (
            <Fragment key={key}>
              {showTime ? (
                <div className="my-3 text-center text-[12px] leading-4 text-[#B2B2B2]">
                  {formatMessageTime(message.created_at)}
                </div>
              ) : null}

              {revoked ? (
                <div className={`${marginClass} text-center text-[12px] leading-4 text-[#B2B2B2]`}>
                  {isMine ? '你撤回了一条消息' : `${message.sender_nickname || '对方'} 撤回了一条消息`}
                </div>
              ) : (
                <div className={marginClass}>
                  <MessageBubble
                    message={message}
                    isMine={isMine}
                    isGroup={isGroup}
                    showName={showName}
                    mentionNames={mentionNames}
                    onImageClick={onImageClick}
                    onMessageAction={onMessageAction}
                    onAvatarClick={onAvatarClick}
                    onAvatarMention={onAvatarMention}
                    onCardOpen={onCardOpen}
                    transcribingId={transcribingId}
                    selecting={selectable}
                    selected={selected}
                    onToggleSelect={onToggleSelect}
                  />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
