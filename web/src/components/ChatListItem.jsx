/**
 * 会话列表项：头像（在线绿点）+ 昵称 + 摘要 + 时间 + 未读红点。
 * 有未读 @ 时摘要前渲染红色「[有人@我]」。
 *
 * 交互：
 *   - 点击进入会话；
 *   - 长按 500ms（移动端）/ 右键（桌面端）唤起会话操作菜单；
 *   - 置顶会话用加深的灰底区分；手动标记未读 / 免打扰会话只显示纯红点（无数字）。
 */
import { useEffect, useRef } from 'react';
import Avatar from './Avatar';
import Icon from './Icon';
import { useChat } from '../store/useChat';
import { conversationAvatarUrl, conversationColor, conversationTitle, formatUnread, summarizeLastMessage } from '../lib/format';
import { formatListTime } from '../lib/time';

/** 长按判定时长（毫秒） */
const LONG_PRESS_MS = 500;
/** 长按期间允许的最大位移（px），超过视为滚动或点击 */
const LONG_PRESS_MOVE_TOLERANCE = 10;
/**
 * 长按之后吞掉「合成 click」的时间窗（毫秒）。
 *
 * 必须用时间戳而不是「一次性标志位」：长按会把操作菜单盖在列表之上，
 * 抬手那一次合成 click 往往被遮罩接管、根本派发不到本按钮，
 * 标志位就再也没有机会复位，会把之后第一次真实点击永久吞掉（QA 复现的 P2）。
 * 时间戳只有在窗口内才吞，窗口一过自动恢复正常点击，天然自愈。
 */
const CLICK_GUARD_MS = 700;

/**
 * @param {{
 *   conversation: Record<string, any>,
 *   myId?: number,
 *   active?: boolean,
 *   onClick?: () => void,
 *   onLongPress?: (conversation: Record<string, any>) => void,
 *   onContextMenu?: (conversation: Record<string, any>) => void,
 * }} props
 * @returns {JSX.Element}
 */
export default function ChatListItem({
  conversation,
  myId = 0,
  active = false,
  onClick,
  onLongPress,
  onContextMenu,
}) {
  const onlineByUser = useChat((state) => state.onlineByUser);

  /** 长按定时器 */
  const timerRef = useRef(null);
  /** 长按起点坐标 */
  const startRef = useRef({ x: 0, y: 0 });
  /** 最近一次长按的触发时刻（0 = 当前手势没有触发长按） */
  const longPressAtRef = useRef(0);

  /**
   * 清除长按定时器。
   * @returns {void}
   */
  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // 组件卸载时兜底清理，避免定时器泄漏
  useEffect(() => () => clearTimer(), []);

  const isGroup = conversation.type === 'group';
  const peerId = conversation.peer ? Number(conversation.peer.id) : 0;
  const online = !isGroup && peerId ? Boolean(onlineByUser[peerId]) : false;
  const unread = Number(conversation.unread_count) || 0;
  const manualUnread = conversation.manual_unread === true;
  const showBadge = unread > 0 || manualUnread;
  const pinned = conversation.pinned === true;
  const muted = conversation.muted === true;
  const title = conversationTitle(conversation);
  const summary = summarizeLastMessage(conversation.last_message, myId);
  // 单聊且已不是好友：摘要前加只读前缀
  const readonly = !isGroup && Boolean(conversation.readonly);
  const mentioned = conversation.mentioned === true;
  const time = formatListTime(conversation.last_message_at);

  /**
   * 手指按下：启动长按定时器。
   * @param {React.TouchEvent} event
   * @returns {void}
   */
  const handleTouchStart = (event) => {
    if (typeof onLongPress !== 'function') return;
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    startRef.current = { x: touch.clientX, y: touch.clientY };
    // 新手势开始即清空抑制窗口：保证「菜单关闭后的下一次点击」一定按真实点击处理
    longPressAtRef.current = 0;
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      longPressAtRef.current = Date.now();
      onLongPress(conversation);
    }, LONG_PRESS_MS);
  };

  /**
   * 手指移动：位移超出容差即取消长按（视为滚动）。
   * @param {React.TouchEvent} event
   * @returns {void}
   */
  const handleTouchMove = (event) => {
    if (!timerRef.current) return;
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    const dx = Math.abs(touch.clientX - startRef.current.x);
    const dy = Math.abs(touch.clientY - startRef.current.y);
    if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) clearTimer();
  };

  /**
   * 手指抬起：取消长按；若本次手势已触发长按，同时阻止浏览器补发那一次合成 click。
   *
   * preventDefault 只是「少一次无意义的 click」，真正的兜底是 CLICK_GUARD_MS 时间窗：
   * 有的环境（DevTools 触摸模拟 / 部分 Android WebView）仍会派发，
   * 由 handleClick 的时间窗吞掉；两者叠加保证长按抬手不会误关刚弹出的菜单。
   * @param {React.TouchEvent} event
   * @returns {void}
   */
  const handleTouchEnd = (event) => {
    const longPressed = longPressAtRef.current > 0;
    clearTimer();
    // React 18 只把 touchstart/touchmove/wheel 注册为 passive，touchend 可以安全 preventDefault
    if (longPressed && event && event.cancelable && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
  };

  /** 手势被打断（来电 / 系统手势）：只清定时器，抑制窗口交给时间自动过期 */
  const handleTouchCancel = () => clearTimer();

  /**
   * 点击：仅吞掉长按抬手后紧随的那一次合成 click，窗口外一律按真实点击处理。
   * @returns {void}
   */
  const handleClick = () => {
    if (Date.now() - longPressAtRef.current < CLICK_GUARD_MS) return;
    if (typeof onClick === 'function') onClick();
  };

  /**
   * 桌面端右键菜单。
   * @param {React.MouseEvent} event
   * @returns {void}
   */
  const handleContextMenu = (event) => {
    if (typeof onContextMenu !== 'function') return;
    event.preventDefault();
    onContextMenu(conversation);
  };

  // 置顶会话底色加深（原 #F0F0F0 在浅色列表里几乎看不出，改为 #E3E3E3 与普通项拉开层次）
  const backgroundClass = active
    ? 'bg-[#D2D2D2]'
    : pinned
      ? 'bg-[#E3E3E3] hover:bg-[#DCDCDC] active:bg-[#D5D5D5]'
      : 'hover:bg-black/[0.03] active:bg-black/5';

  return (
    <button
      type="button"
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onContextMenu={handleContextMenu}
      className={`flex w-full select-none items-center gap-3 px-3 py-2.5 text-left transition-colors ${backgroundClass}`}
    >
      <Avatar
        name={title}
        color={conversationColor(conversation)}
        src={conversationAvatarUrl(conversation)}
        size={44}
        group={isGroup}
        online={online}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-[15px] leading-5 text-[#111]">{title}</span>
          {isGroup && conversation.member_count ? (
            <span className="shrink-0 text-[11px] leading-4 text-[#B2B2B2]">{conversation.member_count}人</span>
          ) : null}
          {muted ? (
            <span className="shrink-0 text-[#B2B2B2]" aria-label="消息免打扰">
              <Icon name="volumeOff" size={13} />
            </span>
          ) : null}
        </div>
        <div className="mt-[2px] flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-[#999]">
            {mentioned ? <span className="text-[#FA5151]">[有人@我] </span> : null}
            {readonly ? '[只读] ' : ''}
            {summary || '暂无消息'}
          </span>
          {time ? <span className="shrink-0 text-[11px] leading-4 text-[#B2B2B2]">{time}</span> : null}
        </div>
      </div>

      {showBadge ? (
        // 免打扰会话只显示小红点（与微信一致：不展示具体条数）
        !muted && unread > 0 ? (
          <span className="ml-1 flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#FA5151] px-1 text-[10px] leading-none text-white">
            {formatUnread(unread)}
          </span>
        ) : (
          // 手动标记未读 / 免打扰：纯小红点，不带数字
          <span
            className="ml-1 h-[9px] w-[9px] shrink-0 rounded-full bg-[#FA5151]"
            aria-label={muted ? '免打扰会话有新消息' : '已标记未读'}
          />
        )
      ) : null}
    </button>
  );
}
