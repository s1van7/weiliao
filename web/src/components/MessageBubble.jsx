/**
 * 单条消息气泡：
 *   - 对方：头像在左，白底描边气泡 + 左侧小三角；群聊在气泡上方显示昵称；
 *   - 自己：头像在右，#95EC69 气泡 + 右侧小三角，气泡左侧显示发送状态；
 *   - 图片消息使用无气泡预览，点击全屏查看；
 *   - 自定义表情（type='sticker'）：96px 无气泡图片，点击看大图，加载失败降级为「[表情已删除]」；
 *   - 文本消息按 @ 片段渲染，被 @ 的部分用 .wx-mention 蓝字高亮；
 *   - 支持长按 / 右键触发消息操作（撤回）。
 */
import { cloneElement, useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import CardMessage from './CardMessage';
import VoiceMessage from './VoiceMessage';
import VideoMessage from './VideoMessage';
import FileMessage from './FileMessage';
import MergedMessage from './MergedMessage';
import Icon from './Icon';
import Spinner from './Spinner';
import { mediaUrl } from '../config';
import { renderMentionSegments } from '../lib/mention';

/** 头像长按触发 @ 的时长 */
const AVATAR_MENTION_MS = 500;

/**
 * 头像触发区：短按进资料卡，群聊中长按他人头像触发 @。
 * 长按用 pointerdown 记时，pointerup / leave / cancel 清除；长按后抑制后续 click 避免误跳转。
 * @param {{
 *   message: Record<string, any>,
 *   isMine: boolean,
 *   isGroup: boolean,
 *   onAvatarClick?: (userId: number) => void,
 *   onAvatarMention?: (userId: number, nickname: string) => void,
 * }} props
 * @returns {JSX.Element}
 */
function AvatarPress({ message, isMine, isGroup, onAvatarClick, onAvatarMention }) {
  const timer = useRef(null);
  const longPressRef = useRef(false);
  /** 本次手势是否发生过移动：拖出又拖回仍视为同一手势，松开时不触发 click */
  const movedRef = useRef(false);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /**
   * 清除长按计时器。
   * @returns {void}
   */
  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  /**
   * 按下：启动长按计时。
   * @returns {void}
   */
  const startPress = () => {
    clear();
    longPressRef.current = false;
    movedRef.current = false;
    timer.current = setTimeout(() => {
      timer.current = null;
      longPressRef.current = true;
      if (isGroup && !isMine && onAvatarMention) {
        onAvatarMention(Number(message.sender_id), String(message.sender_nickname || ''));
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(12);
      }
    }, AVATAR_MENTION_MS);
  };

  /**
   * 按下后发生移动：置位 moved，松开时抑制 click。
   * @returns {void}
   */
  const handleMove = () => {
    movedRef.current = true;
  };

  /**
   * 点击：长按或拖动后抑制一次点击，短按进资料卡。
   * @returns {void}
   */
  const handleClick = () => {
    if (longPressRef.current || movedRef.current) {
      longPressRef.current = false;
      movedRef.current = false;
      return;
    }
    if (onAvatarClick) onAvatarClick(Number(message.sender_id));
  };

  return (
    <button
      type="button"
      aria-label="查看用户资料"
      onPointerDown={startPress}
      onPointerMove={handleMove}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onClick={handleClick}
      className="shrink-0"
    >
      <Avatar
        name={message.sender_nickname}
        color={message.sender_avatar_color}
        src={message.sender_avatar_url}
        size={40}
      />
    </button>
  );
}

/**
 * @param {{
 *   message: Record<string, any>,
 *   isMine: boolean,
 *   isGroup?: boolean,
 *   showName?: boolean,
 *   mentionNames?: Record<string|number, string>|Map<number, string>|null,
 *   onImageClick?: (src: string) => void,
 *   onMessageAction?: (message: Record<string, any>) => void,
 *   onAvatarClick?: (userId: number) => void,
 *   onAvatarMention?: (userId: number, nickname: string) => void,
 *   onCardOpen?: (userId: number) => void,
 *   transcribingId?: number,
 * }} props
 * @returns {JSX.Element}
 */
export default function MessageBubble({
  message,
  isMine,
  isGroup = false,
  showName = false,
  mentionNames = null,
  onImageClick,
  onMessageAction,
  onAvatarClick,
  onAvatarMention,
  onCardOpen,
  transcribingId = null,
  selecting = false,
  selected = false,
  onToggleSelect,
}) {
  const pressTimer = useRef(null);
  // 自定义表情加载失败（表情被作者删除后磁盘文件可能已清理）
  const [stickerFailed, setStickerFailed] = useState(false);

  useEffect(() => {
    setStickerFailed(false);
  }, [message.content]);

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const startPress = () => {
    if (!onMessageAction) return;
    clearPress();
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      onMessageAction(message);
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(12);
    }, 520);
  };

  const handleContextMenu = (event) => {
    if (!onMessageAction) return;
    event.preventDefault();
    onMessageAction(message);
  };

  const isImage = message.type === 'image';
  const isSticker = message.type === 'sticker';
  const isCard = message.type === 'card';
  const isVoice = message.type === 'voice';
  const isVideo = message.type === 'video';
  const isFile = message.type === 'file';
  const isMerged = message.type === 'merged';
  const status = message._status || 'sent';

  let statusNode = null;
  if (isMine) {
    if (status === 'sending') statusNode = <Spinner size={14} className="text-[#B2B2B2]" />;
    else if (status === 'failed') statusNode = <Icon name="warning" size={15} className="text-[#FA5151]" />;
    else if (status === 'read') statusNode = <Icon name="doubleCheck" size={16} className="text-[#07C160]" />;
    else statusNode = <Icon name="check" size={15} className="text-[#B2B2B2]" />;
  }

  /** 文本内容：按 @ 片段切分后渲染（图片 / 表情 / 名片 / 语音 / 视频 / 文件 / 合并卡片不走文本渲染） */
  const segments =
    isImage || isSticker || isCard || isVoice || isVideo || isFile || isMerged
      ? []
      : renderMentionSegments(message.content, message.mentions, mentionNames);

  let content = null;
  if (isImage) {
    content = (
      <button
        type="button"
        onClick={() => {
          if (onImageClick) onImageClick(mediaUrl(message.content));
        }}
        className="block overflow-hidden rounded-[4px] border border-[#E5E5E5] bg-white"
      >
        <img
          src={mediaUrl(message.content)}
          alt="图片消息"
          className="block max-h-[240px] max-w-[180px] object-cover"
          draggable="false"
          loading="lazy"
        />
      </button>
    );
  } else if (isSticker) {
    content = stickerFailed ? (
      <span className="px-1 py-0.5 text-[13px] leading-5 text-[#999]">[表情已删除]</span>
    ) : (
      <button
        type="button"
        aria-label="表情消息"
        onClick={() => {
          if (onImageClick) onImageClick(mediaUrl(message.content));
        }}
        className="block overflow-hidden rounded-[6px] active:opacity-80"
      >
        <img
          src={mediaUrl(message.content)}
          alt="表情"
          className="block h-24 w-24 object-contain"
          draggable="false"
          loading="lazy"
          onError={() => setStickerFailed(true)}
        />
      </button>
    );
  } else if (isCard) {
    content = <CardMessage content={message.content} onOpen={onCardOpen} />;
  } else if (isVoice) {
    content = (
      <VoiceMessage message={message} isMine={isMine} transcribing={Number(message.id) === transcribingId} />
    );
  } else if (isVideo) {
    content = <VideoMessage message={message} />;
  } else if (isFile) {
    content = <FileMessage message={message} />;
  } else if (isMerged) {
    content = <MergedMessage message={message} />;
  } else {
    content = (
      <div className={`wx-selectable ${isMine ? 'wx-bubble wx-bubble-mine' : 'wx-bubble wx-bubble-peer'}`}>
        {segments.map((segment, index) =>
          segment.mention ? (
            <span key={`m-${index}`} className="wx-mention">
              {segment.text}
            </span>
          ) : (
            <span key={`t-${index}`}>{segment.text}</span>
          ),
        )}
      </div>
    );
  }

  // 消息长按操作只在气泡内容区（文字/图片/表情/媒体/合并卡片）触发，头像区不参与，
  // 避免与头像长按 @ 互相干扰；cloneElement 直接挂到 content 上，保持原有布局不变。
  const pressContent = cloneElement(content, {
    onPointerDown: startPress,
    onPointerUp: clearPress,
    onPointerLeave: clearPress,
    onPointerCancel: clearPress,
    onContextMenu: handleContextMenu,
  });

  // 多选态：点气泡 / 长按气泡 = 勾选或取消勾选；内部媒体交互（播放/下载/打开）被抑制
  const toggleSelect = () => {
    if (onToggleSelect) onToggleSelect(message);
  };

  const contentNode = selecting ? (
    <div onClick={toggleSelect} className="cursor-pointer">
      <div style={{ pointerEvents: 'none' }}>{content}</div>
    </div>
  ) : (
    pressContent
  );

  return (
    <div className={`flex items-start gap-2 ${isMine ? 'justify-end' : 'justify-start'}`}>
      {selecting ? (
        <button
          type="button"
          aria-label="选择消息"
          onClick={toggleSelect}
          className="flex shrink-0 items-center self-center"
        >
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full border ${
              selected ? 'border-[#07C160] bg-[#07C160] text-white' : 'border-[#C8C8C8] bg-white'
            }`}
          >
            {selected ? <Icon name="check" size={13} /> : null}
          </span>
        </button>
      ) : null}

      {!isMine ? (
        <AvatarPress
          message={message}
          isMine={isMine}
          isGroup={isGroup}
          onAvatarClick={onAvatarClick}
          onAvatarMention={onAvatarMention}
        />
      ) : null}

      <div
        className={`flex min-w-0 flex-col ${isMine ? 'items-end' : 'items-start'}`}
        style={{ maxWidth: '70%' }}
      >
        {showName && !isMine ? (
          <span className="mb-1 max-w-full truncate px-1 text-[12px] leading-4 text-[#999]">
            {message.sender_nickname}
          </span>
        ) : null}

        {isMine ? (
          <div className="flex min-w-0 items-end justify-end gap-1">
            <span className="flex shrink-0 items-center pb-1">{statusNode}</span>
            {contentNode}
          </div>
        ) : (
          contentNode
        )}
      </div>

      {isMine ? (
        <AvatarPress
          message={message}
          isMine={isMine}
          isGroup={isGroup}
          onAvatarClick={onAvatarClick}
          onAvatarMention={onAvatarMention}
        />
      ) : null}
    </div>
  );
}
