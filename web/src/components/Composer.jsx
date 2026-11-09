/**
 * 输入区（重构版）：
 *   布局「语音按钮｜输入框｜表情按钮｜+ 按钮｜发送按钮」。
 *   - 语音按钮切换「按住说话」模式（复用 VoiceRecorder），有内容时右侧显示发送；
 *   - 表情按钮打开 EmojiPicker（emoji + 自定义表情）；
 *   - + 按钮打开 PlusPanel（图片 / 名片 / 表情包管理），图片、名片从原按钮移入；
 *   - 保留 @ 选择、发送按钮（有内容显示发送，否则隐藏）；
 *   - textarea 自适应高度（最高 5 行）；桌面 Enter 发送、Shift+Enter 换行；触摸设备 Enter 换行。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import EmojiPicker from './EmojiPicker';
import MentionPicker from './MentionPicker';
import PlusPanel from './PlusPanel';
import VoiceRecorder from './VoiceRecorder';
import VoiceToText from './VoiceToText';
import { useUI } from '../store/useUI';
import { useIsTouch } from '../lib/hooks';
import { filterMentionsByText } from '../lib/mention';

const LINE_HEIGHT = 21;
const MAX_LINES = 5;
const MAX_HEIGHT = LINE_HEIGHT * MAX_LINES + 8;

/** @ 关键字最长长度（超过即认为用户不是在选人） */
const MENTION_KEYWORD_MAX = 12;

/** 空数组常量，避免每次渲染新建引用 */
const EMPTY_MEMBERS = [];

/**
 * @param {{
 *   onSend: (text: string, mentions: {all: boolean, ids: number[]}|null) => Promise<unknown>,
 *   onSendImage: (file: File) => Promise<unknown>,
 *   onSendSticker?: (url: string) => Promise<unknown>,
 *   onSendCard?: () => void,
 *   onSendVoice?: (file: File, duration: number) => Promise<unknown>,
 *   onSendVideo?: (file: File) => Promise<unknown>,
 *   onSendFile?: (file: File) => Promise<unknown>,
 *   onVoiceCall?: () => void,
 *   onVideoCall?: () => void,
 *   members?: Array<Record<string, any>>,
 *   allowMentionAll?: boolean,
 *   onTyping?: (typing: boolean) => void,
 *   disabled?: boolean,
 *   readonly?: boolean,
 *   readonlyText?: string,
 *   mentionRequest?: {id: number, nickname: string}|null,
 *   onMentionConsumed?: () => void,
 * }} props
 * @returns {JSX.Element}
 */
export default function Composer({
  onSend,
  onSendImage,
  onSendSticker,
  onSendCard,
  onSendVoice,
  onSendVideo,
  onSendFile,
  onVoiceCall,
  onVideoCall,
  members = EMPTY_MEMBERS,
  allowMentionAll = false,
  onTyping,
  disabled = false,
  readonly = false,
  readonlyText = '已不是好友，仅可查看历史消息',
  mentionRequest = null,
  onMentionConsumed = null,
}) {
  const showEmoji = useUI((state) => state.showEmoji);
  const setShowEmoji = useUI((state) => state.setShowEmoji);
  const showToast = useUI((state) => state.showToast);
  const navigate = useUI((state) => state.navigate);

  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  /** 本地 @ 草稿：已插入文本的目标（发送前会用正文再过滤一次） */
  const [mentionDraft, setMentionDraft] = useState({ all: false, ids: [] });
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionKeyword, setMentionKeyword] = useState('');
  /** 是否处于「按住说话」模式 */
  const [voiceMode, setVoiceMode] = useState(false);
  /** 是否打开「+」面板 */
  const [plusOpen, setPlusOpen] = useState(false);

  const textareaRef = useRef(null);
  const typingTimer = useRef(null);
  const lastTypingAt = useRef(0);
  /** 触发选择层的 '@' 在文本中的下标 */
  const atPosRef = useRef(-1);
  const isTouch = useIsTouch();

  const canSend = !readonly && value.trim().length > 0 && !sending && !disabled;
  const mentionable = !readonly && members.length > 0;

  /** id → 昵称，供 @ token 匹配与发送前过滤使用 */
  const nicknameById = useMemo(() => {
    const map = {};
    for (const member of members) {
      const id = Number(member.user_id || member.id || 0);
      if (id > 0) map[id] = String(member.nickname || '');
    }
    return map;
  }, [members]);

  /**
   * 根据内容调整 textarea 高度。
   * @returns {void}
   */
  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  };

  useEffect(() => {
    resize();
  }, [value]);

  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    },
    [],
  );

  /**
   * 停止上报 typing。
   * @returns {void}
   */
  const stopTyping = () => {
    if (typingTimer.current) {
      clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
    if (onTyping) onTyping(false);
  };

  /**
   * 关闭 @ 选择层。
   * @returns {void}
   */
  const closeMention = () => {
    setMentionOpen(false);
    setMentionKeyword('');
    atPosRef.current = -1;
  };

  /**
   * 输入变化：上报 typing、自动扩高、识别 `@` 唤起成员选择层。
   * @param {React.ChangeEvent<HTMLTextAreaElement>} event
   * @returns {void}
   */
  const handleChange = (event) => {
    const next = event.target.value;
    const caret = typeof event.target.selectionStart === 'number' ? event.target.selectionStart : next.length;
    const prev = value;
    setValue(next);

    if (onTyping && !readonly) {
      const now = Date.now();
      if (next && now - lastTypingAt.current > 1500) {
        lastTypingAt.current = now;
        onTyping(true);
      }
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => {
        typingTimer.current = null;
        onTyping(false);
      }, 2600);
    }

    if (!mentionable) return;

    // 刚敲下一个 '@'：唤起选择层
    if (next.length === prev.length + 1 && next[caret - 1] === '@') {
      atPosRef.current = caret - 1;
      setMentionKeyword('');
      setMentionOpen(true);
      setShowEmoji(false);
      setPlusOpen(false);
      return;
    }

    // 已在选人状态：把 @ 到光标之间的内容当关键字；离开 @ 或出现空白则关闭
    if (mentionOpen) {
      const at = atPosRef.current;
      if (at < 0 || at >= next.length || next[at] !== '@') {
        closeMention();
        return;
      }
      const keyword = next.slice(at + 1, caret);
      if (/\s/.test(keyword) || keyword.length > MENTION_KEYWORD_MAX) {
        closeMention();
        return;
      }
      setMentionKeyword(keyword);
    }
  };

  /**
   * 选中一个 @ 目标：把「@ + 关键字」替换为「@昵称 」。
   * @param {{all: boolean, id: number, nickname: string}} target
   * @returns {void}
   */
  const handlePickMention = (target) => {
    const el = textareaRef.current;
    const caret = el && typeof el.selectionStart === 'number' ? el.selectionStart : value.length;
    const at = atPosRef.current;
    const start = at >= 0 && at < value.length && value[at] === '@' ? at + 1 : caret;
    const insert = `${target.all ? '所有人' : target.nickname} `;
    const next = `${value.slice(0, start)}${insert}${value.slice(caret)}`;

    setValue(next);
    setMentionDraft((prev) => {
      if (target.all) return { all: true, ids: prev.ids };
      const id = Number(target.id);
      if (!id || prev.ids.includes(id)) return prev;
      return { all: prev.all, ids: [...prev.ids, id] };
    });
    closeMention();

    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      const position = start + insert.length;
      try {
        node.setSelectionRange(position, position);
      } catch {
        /* 部分环境不支持 */
      }
      resize();
    });
  };

  /**
   * 外部注入 @（群聊长按头像触发）：在光标处插入「@昵称 」并记录到 mentionDraft。
   * @param {number} id 目标用户 id
   * @param {string} nickname 目标昵称
   * @returns {void}
   */
  const insertMentionExternal = (id, nickname) => {
    if (readonly) return;
    const targetId = Number(id);
    if (!Number.isInteger(targetId) || targetId <= 0) return;

    const el = textareaRef.current;
    const caret = el && typeof el.selectionStart === 'number' ? el.selectionStart : value.length;
    const insert = `@${String(nickname || '')} `;
    const next = `${value.slice(0, caret)}${insert}${value.slice(caret)}`;

    setValue(next);
    setMentionDraft((prev) => {
      if (prev.ids.includes(targetId)) return prev;
      return { all: prev.all, ids: [...prev.ids, targetId] };
    });

    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      const position = caret + insert.length;
      try {
        node.setSelectionRange(position, position);
      } catch {
        /* 部分环境不支持 */
      }
      resize();
    });
  };

  // 监听外部 @ 请求：非空时插入一次，然后通知父级清空，避免重复插入。
  useEffect(() => {
    if (!mentionRequest) return;
    insertMentionExternal(mentionRequest.id, mentionRequest.nickname);
    if (onMentionConsumed) onMentionConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionRequest]);

  /**
   * 发送文本（带上过滤后的 @ 信息）。
   * @returns {Promise<void>}
   */
  const submit = async () => {
    if (readonly) return;
    const text = value.trim();
    if (!text || sending || disabled) return;

    const mentions = mentionable ? filterMentionsByText(text, mentionDraft, nicknameById) : null;

    setSending(true);
    stopTyping();
    try {
      await onSend(text, mentions);
      setValue('');
      setMentionDraft({ all: false, ids: [] });
      closeMention();
    } catch (err) {
      showToast(err && err.message ? err.message : '发送失败，请重试', 'error');
    } finally {
      setSending(false);
      requestAnimationFrame(() => {
        resize();
        if (textareaRef.current && !isTouch) textareaRef.current.focus();
      });
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape' && mentionOpen) {
      event.preventDefault();
      closeMention();
      return;
    }
    if (event.key !== 'Enter') return;
    // 输入法确认候选词时不发送
    if (event.nativeEvent && event.nativeEvent.isComposing) return;
    if (isTouch) return; // 触摸设备 Enter 换行
    if (event.shiftKey) return; // Shift+Enter 换行
    event.preventDefault();
    submit();
  };

  /**
   * 在光标处插入 emoji。
   * @param {string} emoji
   * @returns {void}
   */
  const handlePickEmoji = (emoji) => {
    const el = textareaRef.current;
    if (!el) {
      setValue((prevValue) => prevValue + emoji);
      return;
    }
    const start = typeof el.selectionStart === 'number' ? el.selectionStart : value.length;
    const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : value.length;
    const next = `${value.slice(0, start)}${emoji}${value.slice(end)}`;
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      const position = start + emoji.length;
      try {
        el.setSelectionRange(position, position);
      } catch {
        /* 部分环境不支持 */
      }
    });
  };

  /**
   * 直接发送自定义表情（不进输入框）。
   * @param {string} url
   * @returns {Promise<void>}
   */
  const handlePickSticker = async (url) => {
    if (!onSendSticker || readonly) return;
    try {
      await onSendSticker(url);
      stopTyping();
    } catch (err) {
      showToast(err && err.message ? err.message : '表情发送失败', 'error');
    }
  };

  /**
   * 打开表情管理页（关闭面板与选择层）。
   * @returns {void}
   */
  const handleManageStickers = () => {
    setShowEmoji(false);
    setPlusOpen(false);
    navigate('stickers');
  };

  /**
   * 切换表情面板。
   * @returns {void}
   */
  const toggleEmoji = () => {
    setShowEmoji(!showEmoji);
    setPlusOpen(false);
    closeMention();
  };

  /**
   * 切换「+」面板。
   * @returns {void}
   */
  const togglePlus = () => {
    setPlusOpen(!plusOpen);
    setShowEmoji(false);
    closeMention();
  };

  /**
   * 切换语音 / 键盘模式。
   * @returns {void}
   */
  const toggleVoice = () => {
    setVoiceMode((prev) => !prev);
    setShowEmoji(false);
    setPlusOpen(false);
    closeMention();
  };

  /**
   * 从 PlusPanel 打开名片选择器。
   * @returns {void}
   */
  const handleOpenCard = () => {
    setPlusOpen(false);
    if (onSendCard) onSendCard();
  };

  /**
   * 语音转文字结果追加到输入框末尾。
   * @param {string} text
   * @returns {void}
   */
  const handleVoiceTextResult = (text) => {
    const t = String(text || '').trim();
    if (!t) return;
    setValue((prev) => (prev ? `${prev} ${t}` : t));
  };

  return (
    <div
      className="shrink-0 border-t border-[#E5E5E5] bg-[#F7F7F7]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {readonly ? (
        <div className="border-b border-[#E5E5E5] bg-[#EFEFEF] px-3 py-2 text-center text-[12px] leading-4 text-[#999]">
          {readonlyText}
        </div>
      ) : null}

      <div className="relative">
        {mentionOpen && mentionable ? (
          <MentionPicker
            members={members}
            allowAll={allowMentionAll}
            keyword={mentionKeyword}
            onPick={handlePickMention}
            onClose={closeMention}
          />
        ) : null}

        <div className="flex items-end gap-1 px-2 pb-2 pt-2">
          {/* 语音 / 键盘切换 */}
          <button
            type="button"
            aria-label={voiceMode ? '键盘输入' : '按住说话'}
            disabled={readonly}
            onClick={toggleVoice}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-black/5 ${
              readonly ? 'text-[#C8C8C8]' : voiceMode ? 'text-[#07C160]' : 'text-[#333]'
            }`}
          >
            <Icon name={voiceMode ? 'keyboard' : 'mic'} size={26} />
          </button>

          {/* 输入区 / 按住说话 */}
          <div className="min-w-0 flex-1 rounded-[6px] bg-white px-[10px] py-[7px]">
            {voiceMode ? (
              <VoiceRecorder onRecord={onSendVoice} disabled={readonly} />
            ) : (
              <textarea
                ref={textareaRef}
                rows={1}
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                disabled={readonly}
                placeholder={readonly ? readonlyText : '发消息…'}
                enterKeyHint="send"
                className="block w-full text-[16px] leading-[21px] text-[#111] placeholder:text-[#B2B2B2] disabled:bg-transparent disabled:text-[#B2B2B2]"
                style={{ height: 21, maxHeight: MAX_HEIGHT }}
              />
            )}
          </div>

          {/* 语音转文字（不支持的环境自动隐藏） */}
          {!readonly ? <VoiceToText onResult={handleVoiceTextResult} /> : null}

          {/* 表情 */}
          <button
            type="button"
            aria-label="表情"
            disabled={readonly}
            onClick={toggleEmoji}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-black/5 ${
              readonly ? 'text-[#C8C8C8]' : showEmoji ? 'text-[#07C160]' : 'text-[#333]'
            }`}
          >
            <Icon name="emoji" size={26} />
          </button>

          {/* + */}
          <button
            type="button"
            aria-label="更多"
            disabled={readonly}
            onClick={togglePlus}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-black/5 ${
              readonly ? 'text-[#C8C8C8]' : plusOpen ? 'text-[#07C160]' : 'text-[#333]'
            }`}
          >
            <Icon name="plus" size={26} />
          </button>

          {/* 发送（有内容才显示） */}
          {canSend ? (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              className="mb-[3px] ml-1 h-[34px] shrink-0 rounded-[6px] bg-[#07C160] px-3 text-[14px] font-medium text-white transition-colors active:bg-[#06AD56]"
            >
              发送
            </button>
          ) : null}
        </div>
      </div>

      {plusOpen && !readonly ? (
        <PlusPanel
          onSendImage={onSendImage}
          onSendVideo={onSendVideo}
          onSendFile={onSendFile}
          onSendCard={handleOpenCard}
          onVoiceCall={onVoiceCall}
          onVideoCall={onVideoCall}
        />
      ) : null}

      {showEmoji && !readonly ? (
        <EmojiPicker
          onPickEmoji={handlePickEmoji}
          onPickSticker={handlePickSticker}
          onManage={handleManageStickers}
        />
      ) : null}
    </div>
  );
}