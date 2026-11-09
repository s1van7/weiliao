/**
 * 聊天页：
 *   - 顶部：返回（仅移动端）+ 标题（单聊对方昵称 / 群聊「群名(人数)」）+ 副标题（在线 / 正在输入）；
 *   - 右上「···」：单聊查看资料 / 删除好友，群聊进入群信息；
 *   - 消息流 + 输入区；长按 / 右键自己的消息可撤回（2 分钟内），群主 / 管理员可撤回群内任何消息且不限时。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../store/useAuth';
import { useChat } from '../store/useChat';
import { useCall } from '../store/useCall';
import { useUI } from '../store/useUI';
import { useClickOutside, useIsDesktop, useTick } from '../lib/hooks';
import { canMentionAll, canSpeak, isGroupAdmin } from '../lib/groupPerm';
import { api } from '../api';
import { mediaUrl } from '../config';
import { displayNameOf } from '../lib/format';
import { emitTyping } from '../socket';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import MessageList from '../components/MessageList';
import Composer from '../components/Composer';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import ConversationPicker from '../components/ConversationPicker';

/** 稳定的空数组引用，避免 selector 每次返回新对象 */
const EMPTY_MESSAGES = [];

/** 稳定的空成员数组 */
const EMPTY_MEMBERS = [];

/** 聊天背景预设纯色 */
const BG_COLORS = ['#EDEDED', '#DCE8F5', '#F5E6D9', '#E4F2E4', '#F2E6F2', '#E8F0E8'];

/** 撤回时间窗 */
const REVOKE_WINDOW = 120 * 1000;

/**
 * @param {{conversationId: number}} props
 * @returns {JSX.Element}
 */
export default function ChatPage({ conversationId }) {
  const id = Number(conversationId) || 0;
  const desktop = useIsDesktop();

  const user = useAuth((state) => state.user);
  const conversations = useChat((state) => state.conversations);
  const onlineByUser = useChat((state) => state.onlineByUser);
  const typingByConv = useChat((state) => state.typingByConv);
  const messages = useChat((state) => state.messagesByConv[id]) || EMPTY_MESSAGES;
  const hasMore = useChat((state) => Boolean(state.hasMoreByConv[id]));
  const loadingMessages = useChat((state) => state.loadingMessages);
  const loadingOlder = useChat((state) => state.loadingOlder);
  const friends = useChat((state) => state.friends);
  const transcribingId = useChat((state) => state.transcribingId);

  const navigate = useUI((state) => state.navigate);
  const back = useUI((state) => state.back);
  const showToast = useUI((state) => state.showToast);

  const [menuOpen, setMenuOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);
  /** 多选态：selecting 标记 + selected 映射（消息 id → 消息） */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState({});
  /** 转发目标会话弹层与待转发载荷 */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [forwardTarget, setForwardTarget] = useState(null);
  /** 发送名片的好友选择弹窗 */
  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  /** 群聊长按头像触发的 @ 注入请求，交给 Composer 处理后清空 */
  const [mentionRequest, setMentionRequest] = useState(null);
  /** 设置聊天背景弹窗 */
  const [bgOpen, setBgOpen] = useState(false);
  const [bgBusy, setBgBusy] = useState(false);
  const bgInputRef = useRef(null);
  const menuRef = useRef(null);

  useTick(1000); // 让「正在输入」按过期时间自动消失
  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen);

  const myId = user ? Number(user.id) : 0;

  // 打开 / 切换会话
  useEffect(() => {
    if (!id) return undefined;
    useChat
      .getState()
      .openConversation(id)
      .catch((err) => {
        useUI.getState().showToast(err && err.message ? err.message : '加载会话失败', 'error');
      });
    return () => {
      useChat.getState().closeConversation();
      useUI.getState().setShowEmoji(false);
    };
  }, [id]);

  const conversation = useMemo(() => conversations.find((item) => item.id === id) || null, [conversations, id]);
  const isGroup = conversation ? conversation.type === 'group' : false;
  // 单聊且已不是好友：会话只读，仅可查看历史消息
  const friendReadonly = !isGroup && Boolean(conversation && conversation.readonly);
  const peerId = conversation && conversation.peer ? Number(conversation.peer.id) : 0;
  const online = peerId ? Boolean(onlineByUser[peerId]) : false;

  // 聊天背景：纯色直接作为背景色；/uploads 图片作为背景图；空串回退默认灰
  const bgValue = conversation ? String(conversation.background_url || '') : '';
  const pageStyle = /^#[0-9a-fA-F]{6}$/.test(bgValue)
    ? { backgroundColor: bgValue }
    : bgValue
      ? {
          backgroundImage: `url(${mediaUrl(bgValue)})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }
      : { backgroundColor: '#EDEDED' };

  // 群详情（成员 / 我的角色 / 权限）：@ 选择器与「仅管理员可发言」都依赖它
  const detail = useChat((state) => state.detailsByConv[id]) || null;

  useEffect(() => {
    if (!id || !isGroup) return;
    useChat
      .getState()
      .groupDetail(id)
      .catch(() => {});
  }, [id, isGroup]);

  const members = useMemo(() => (detail && Array.isArray(detail.members) ? detail.members : EMPTY_MEMBERS), [detail]);

  /** id → 昵称，供气泡里的 @ 高亮使用 */
  const mentionNames = useMemo(() => {
    const map = {};
    for (const member of members) {
      const memberId = Number(member.user_id || 0);
      if (memberId > 0) map[memberId] = String(member.nickname || '');
    }
    return map;
  }, [members]);

  // 群里被限制发言：输入框置灰并提示（服务端仍会二次校验）
  const speakForbidden = Boolean(isGroup && detail && !canSpeak(detail));
  const allowMentionAll = Boolean(isGroup && canMentionAll(detail));
  const readonly = friendReadonly || speakForbidden;
  const readonlyText = speakForbidden ? '当前群仅群主和管理员可发言' : '已不是好友，仅可查看历史消息';

  const selectedList = useMemo(
    () => Object.values(selected).sort((a, b) => (Number(a.created_at) || 0) - (Number(b.created_at) || 0)),
    [selected],
  );
  const selectedCount = selectedList.length;

  const typingInfo = typingByConv[id];
  const isTyping = Boolean(typingInfo && typingInfo.until > Date.now());

  const title = isGroup
    ? `${(conversation && conversation.name) || '群聊'}(${(conversation && conversation.member_count) || 0})`
    : displayNameOf(conversation && conversation.peer) || '聊天';

  let subtitle = '';
  let subtitleGreen = false;
  if (isTyping) {
    subtitle = isGroup ? '有人正在输入…' : '对方正在输入…';
    subtitleGreen = true;
  } else if (!isGroup && friendReadonly) {
    subtitle = '已不是好友，仅可查看历史消息';
  } else if (speakForbidden) {
    subtitle = '仅群主和管理员可发言';
  } else if (!isGroup && online) {
    subtitle = '在线';
    subtitleGreen = true;
  }

  /**
   * 删除好友（二次确认）。
   * @returns {void}
   */
  const handleDeleteFriend = () => {
    if (!peerId) return;
    setMenuOpen(false);
    useUI.getState().openModal({
      title: '删除好友',
      content: `确定要删除「${displayNameOf(conversation && conversation.peer)}」吗？删除后需要重新添加才能成为好友。`,
      confirmText: '删除',
      danger: true,
      onConfirm: async () => {
        try {
          await useChat.getState().deleteFriend(peerId);
          useUI.getState().showToast('已删除好友');
        } catch (err) {
          useUI.getState().showToast((err && err.message) || '删除失败', 'error');
        }
      },
    });
  };

  /**
   * 发起语音通话（单聊）/ 语音会议（群聊）。
   * @returns {void}
   */
  const handleVoiceCall = () => {
    if (!id) return;
    if (isGroup) {
      useCall
        .getState()
        .startConference(id, 'voice')
        .catch((err) => showToast((err && err.message) || '发起语音会议失败', 'error'));
      return;
    }
    if (!peerId || friendReadonly) return;
    useCall
      .getState()
      .startCall(peerId, 'voice')
      .catch((err) => showToast((err && err.message) || '发起语音通话失败', 'error'));
  };

  /**
   * 发起视频通话（单聊）/ 视频会议（群聊）。
   * @returns {void}
   */
  const handleVideoCall = () => {
    if (!id) return;
    if (isGroup) {
      useCall
        .getState()
        .startConference(id, 'video')
        .catch((err) => showToast((err && err.message) || '发起视频会议失败', 'error'));
      return;
    }
    if (!peerId || friendReadonly) return;
    useCall
      .getState()
      .startCall(peerId, 'video')
      .catch((err) => showToast((err && err.message) || '发起视频通话失败', 'error'));
  };

  /**
   * 发起群会议（默认视频，供顶栏入口使用）。
   * @returns {void}
   */
  const handleConference = () => {
    if (!id || !isGroup) return;
    useCall
      .getState()
      .startConference(id, 'video')
      .catch((err) => showToast((err && err.message) || '发起会议失败', 'error'));
  };

  /**
   * 点击头像进入用户信息页（自己头像也可点）。
   * @param {number} userId
   * @returns {void}
   */
  const handleAvatarClick = (userId) => {
    const targetId = Number(userId) || 0;
    if (targetId) navigate(`userInfo/${targetId}`);
  };

  /**
   * 群聊长按他人头像：把 @ 请求交给 Composer 注入。
   * @param {number} userId
   * @param {string} nickname
   * @returns {void}
   */
  const handleAvatarMention = (userId, nickname) => {
    setMentionRequest({ id: Number(userId) || 0, nickname: String(nickname || '') });
  };

  /**
   * Composer 消费完 @ 请求后清空。
   * @returns {void}
   */
  const handleMentionConsumed = () => setMentionRequest(null);

  /**
   * 设置纯色聊天背景。
   * @param {string} color #RRGGBB
   * @returns {Promise<void>}
   */
  const handlePickBgColor = async (color) => {
    if (bgBusy) return;
    setBgBusy(true);
    try {
      await useChat.getState().setBackground(id, color);
      setBgOpen(false);
    } catch (err) {
      showToast((err && err.message) || '设置背景失败', 'error');
    } finally {
      setBgBusy(false);
    }
  };

  /**
   * 选择图片作为聊天背景。
   * @param {React.ChangeEvent<HTMLInputElement>} event
   * @returns {Promise<void>}
   */
  const handlePickBgImage = async (event) => {
    const input = event.target;
    const file = input && input.files ? input.files[0] : null;
    if (input) input.value = '';
    if (!file) return;
    if (!/^image\//i.test(file.type || '')) {
      showToast('请选择图片文件', 'error');
      return;
    }
    setBgBusy(true);
    try {
      const uploaded = await api.uploadImage(file);
      if (!uploaded || !uploaded.url) throw new Error('背景上传失败');
      await useChat.getState().setBackground(id, uploaded.url);
      setBgOpen(false);
    } catch (err) {
      showToast((err && err.message) || '设置背景失败', 'error');
    } finally {
      setBgBusy(false);
    }
  };

  /**
   * 恢复默认背景。
   * @returns {Promise<void>}
   */
  const handleResetBg = async () => {
    if (bgBusy) return;
    setBgBusy(true);
    try {
      await useChat.getState().setBackground(id, '');
      setBgOpen(false);
    } catch (err) {
      showToast((err && err.message) || '设置背景失败', 'error');
    } finally {
      setBgBusy(false);
    }
  };

  /**
   * 点击顶栏标题：群聊进群信息，单聊进对方资料卡。
   * @returns {void}
   */
  const handleTitleClick = () => {
    if (isGroup) {
      navigate(`groupInfo/${id}`);
    } else if (peerId) {
      navigate(`userInfo/${peerId}`);
    }
  };

  /**
   * 长按 / 右键消息：自己的消息未超过撤回时间窗时可撤回；
   * 群主 / 管理员在群聊里可撤回任何人的消息，且不受 2 分钟限制。
   * @param {Record<string, any>} message
   * @returns {void}
   */
  const handleMessageAction = (message) => {
    if (!message || Number(message.revoked) === 1) return;
    if (typeof message.id !== 'number') return;
    setActionMessage(message);
  };

  /**
   * 退出多选态，清空勾选与待转发载荷。
   * @returns {void}
   */
  const cancelSelecting = () => {
    setSelecting(false);
    setSelected({});
    setForwardTarget(null);
  };

  /**
   * 进入多选态，并把长按的这条消息预勾选。
   * @param {Record<string, any>} message
   * @returns {void}
   */
  const enterSelecting = (message) => {
    if (!message || typeof message.id !== 'number') return;
    setSelecting(true);
    setSelected({ [String(message.id)]: message });
  };

  /**
   * 勾选 / 取消勾选。
   * @param {Record<string, any>} message
   * @returns {void}
   */
  const toggleSelect = (message) => {
    if (!message || typeof message.id !== 'number') return;
    const key = String(message.id);
    setSelected((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = message;
      return next;
    });
  };

  /**
   * 长按菜单「转发」：单条转发。
   * @returns {void}
   */
  const startSingleForward = () => {
    const target = actionMessage;
    setActionMessage(null);
    if (!target) return;
    setForwardTarget({ mode: 'single', message: target });
    setPickerOpen(true);
  };

  /**
   * 长按菜单「多选」。
   * @returns {void}
   */
  const startSelecting = () => {
    const target = actionMessage;
    setActionMessage(null);
    enterSelecting(target);
  };

  /**
   * 多选底部「逐条转发」。
   * @returns {void}
   */
  const startMultiForward = () => {
    if (selectedCount === 0) return;
    setForwardTarget({ mode: 'multi', messages: selectedList });
    setPickerOpen(true);
  };

  /**
   * 多选底部「合并转发」。
   * @returns {void}
   */
  const startMergedForward = () => {
    if (selectedCount === 0) return;
    setForwardTarget({ mode: 'merged', messages: selectedList });
    setPickerOpen(true);
  };

  /**
   * 选择目标会话后执行转发（单条 / 逐条 / 合并）。
   * @param {number|string} conversationId
   * @returns {Promise<void>}
   */
  const handlePickerSelect = async (conversationId) => {
    const target = forwardTarget;
    setForwardTarget(null);
    setPickerOpen(false);
    if (!target) return;
    const convId = Number(conversationId);
    if (!Number.isInteger(convId) || convId <= 0) return;
    try {
      if (target.mode === 'single') {
        await useChat.getState().forwardMessage(convId, target.message);
        showToast('已转发');
      } else if (target.mode === 'multi') {
        await useChat.getState().forwardMessages(convId, target.messages);
        showToast(`已转发 ${target.messages.length} 条消息`);
      } else if (target.mode === 'merged') {
        await useChat.getState().sendMerged(convId, target.messages, '', conversation);
        showToast('已合并转发');
      }
      cancelSelecting();
    } catch (err) {
      showToast((err && err.message) || '转发失败', 'error');
    }
  };

  /**
   * 执行撤回。
   * @returns {Promise<void>}
   */
  const confirmRevoke = async () => {
    const target = actionMessage;
    setActionMessage(null);
    if (!target) return;
    try {
      await useChat.getState().revokeMessage(target.id);
      showToast('已撤回');
    } catch (err) {
      showToast((err && err.message) || '撤回失败', 'error');
    }
  };

  /**
   * 语音转文字：自己与好友语音均显示「转文字」（后端固定中文转写 language=zh）。
   * @returns {Promise<void>}
   */
  const confirmTranscribe = async () => {
    const target = actionMessage;
    setActionMessage(null);
    if (!target || target.type !== 'voice') return;
    try {
      await useChat.getState().transcribeVoice(target.id);
      showToast('转写完成');
    } catch (err) {
      showToast((err && err.message) || '转写失败', 'error');
    }
  };

  /**
   * 收藏当前长按 / 右键的消息。
   * @returns {Promise<void>}
   */
  const confirmFavorite = async () => {
    const target = actionMessage;
    setActionMessage(null);
    if (!target) return;
    try {
      await api.createFavorite('message', target.id);
      showToast('已收藏', 'success');
    } catch (err) {
      showToast((err && err.message) || '收藏失败', 'error');
    }
  };

  /**
   * 从好友选择器发送名片消息。
   * @param {number} userId
   * @returns {Promise<void>}
   */
  const handleSendCard = async (userId) => {
    const targetId = Number(userId);
    setCardPickerOpen(false);
    if (!Number.isInteger(targetId) || targetId <= 0) return;
    try {
      await useChat.getState().sendCard(targetId);
    } catch (err) {
      showToast((err && err.message) || '名片发送失败', 'error');
    }
  };

  // 消息操作菜单：撤回仅本人（2 分钟内）或群主 / 管理员可用；收藏对所有消息开放。
  const isActionMine = actionMessage ? actionMessage.sender_id === myId : false;
  const adminCanRevoke = Boolean(isGroup && isGroupAdmin(detail));
  const canRevoke = isActionMine || adminCanRevoke;
  const revokeExpired = !adminCanRevoke && actionMessage && Date.now() - Number(actionMessage.created_at) > REVOKE_WINDOW;

  if (!id) {
    return (
      <div className="flex h-full items-center justify-center bg-[#F5F5F5]">
        <EmptyState title="选择一个会话" description="从左侧会话列表点击即可开始聊天" variant="chat" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" style={pageStyle}>
      {/* 顶部导航 */}
      {selecting ? (
        <header className="relative z-20 shrink-0 border-b border-[#E0E0E0] bg-[#EDEDED] md:bg-[#F5F5F5]">
          <div className="flex h-11 items-center px-3 md:h-[56px] md:px-4">
            <span className="text-[16px] font-medium text-[#111]">已选择 {selectedCount} 条</span>
            <div className="min-w-0 flex-1" />
            <button
              type="button"
              onClick={cancelSelecting}
              className="flex h-9 items-center rounded-[6px] px-3 text-[15px] text-[#576B95] active:bg-black/5"
            >
              取消
            </button>
          </div>
        </header>
      ) : (
      <header className="relative z-20 shrink-0 border-b border-[#E0E0E0] bg-[#EDEDED] md:bg-[#F5F5F5]">
        <div className="flex h-11 items-center px-1 md:h-[56px] md:px-4">
          {!desktop ? (
            <button
              type="button"
              aria-label="返回"
              onClick={back}
              className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
            >
              <Icon name="back" size={22} className="text-[#111]" />
            </button>
          ) : null}

          <div className={`min-w-0 flex-1 ${desktop ? 'text-left' : 'text-center'}`}>
            <button
              type="button"
              onClick={handleTitleClick}
              className={`group flex max-w-full items-center gap-1 ${desktop ? '' : 'justify-center'}`}
            >
              <h1 className="min-w-0 truncate text-[17px] font-semibold leading-5 text-[#111] group-active:opacity-60">
                {title}
              </h1>
              <Icon name="chevronRight" size={14} className="shrink-0 text-[#C8C8C8]" />
            </button>
            {subtitle ? (
              <p
                className={`mt-[1px] truncate text-[11px] leading-3 ${subtitleGreen ? 'text-[#07C160]' : 'text-[#999]'}`}
              >
                {subtitle}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center">
            {!isGroup && peerId ? (
              <>
                <button
                  type="button"
                  aria-label="语音通话"
                  onClick={handleVoiceCall}
                  disabled={friendReadonly}
                  className={`flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5 ${
                    friendReadonly ? 'text-[#C8C8C8]' : 'text-[#111]'
                  }`}
                >
                  <Icon name="phone" size={21} />
                </button>
                <button
                  type="button"
                  aria-label="视频通话"
                  onClick={handleVideoCall}
                  disabled={friendReadonly}
                  className={`flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5 ${
                    friendReadonly ? 'text-[#C8C8C8]' : 'text-[#111]'
                  }`}
                >
                  <Icon name="video" size={22} />
                </button>
              </>
            ) : null}
            {isGroup ? (
              <>
                <button
                  type="button"
                  aria-label="语音会议"
                  onClick={handleVoiceCall}
                  className="flex h-11 w-11 items-center justify-center rounded-full text-[#111] active:bg-black/5"
                >
                  <Icon name="phone" size={21} />
                </button>
                <button
                  type="button"
                  aria-label="视频会议"
                  onClick={handleConference}
                  className="flex h-11 w-11 items-center justify-center rounded-full text-[#111] active:bg-black/5"
                >
                  <Icon name="video" size={22} />
                </button>
              </>
            ) : null}
          </div>

          <div className="relative flex w-11 items-center justify-end" ref={menuRef}>
            <button
              type="button"
              aria-label="更多"
              onClick={() => setMenuOpen((prev) => !prev)}
              className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
            >
              <Icon name="more" size={22} className="text-[#111]" />
            </button>

            {menuOpen ? (
              <div className="wx-pop absolute right-0 top-[44px] w-[168px] overflow-hidden rounded-[8px] bg-white py-1 shadow-[0_6px_20px_rgba(0,0,0,0.16)]">
                {isGroup ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate(`chatHistory/${id}`);
                      }}
                      className="flex h-[42px] w-full items-center px-4 text-[15px] text-[#333] active:bg-black/5"
                    >
                      查看聊天记录
                    </button>
                    <div className="h-px bg-[#F0F0F0]" />
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate(`groupInfo/${id}`);
                      }}
                      className="flex h-[42px] w-full items-center px-4 text-[15px] text-[#333] active:bg-black/5"
                    >
                      群聊信息
                    </button>
                    <div className="h-px bg-[#F0F0F0]" />
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setBgOpen(true);
                      }}
                      className="flex h-[42px] w-full items-center px-4 text-[15px] text-[#333] active:bg-black/5"
                    >
                      设置聊天背景
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate(`chatHistory/${id}`);
                      }}
                      className="flex h-[42px] w-full items-center px-4 text-[15px] text-[#333] active:bg-black/5"
                    >
                      查看聊天记录
                    </button>
                    <div className="h-px bg-[#F0F0F0]" />
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        if (peerId) navigate(`userInfo/${peerId}`);
                      }}
                      className="flex h-[42px] w-full items-center px-4 text-[15px] text-[#333] active:bg-black/5"
                    >
                      查看资料
                    </button>
                    <div className="h-px bg-[#F0F0F0]" />
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setBgOpen(true);
                      }}
                      className="flex h-[42px] w-full items-center px-4 text-[15px] text-[#333] active:bg-black/5"
                    >
                      设置聊天背景
                    </button>
                    <div className="h-px bg-[#F0F0F0]" />
                    <button
                      type="button"
                      onClick={handleDeleteFriend}
                      className="flex h-[42px] w-full items-center px-4 text-[15px] text-[#FA5151] active:bg-black/5"
                    >
                      删除好友
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </header>
      )}

      {/* 消息流 */}
      <MessageList
        conversationId={id}
        messages={messages}
        myId={myId}
        isGroup={isGroup}
        hasMore={hasMore}
        loading={loadingMessages}
        loadingOlder={loadingOlder}
        mentionNames={mentionNames}
        onLoadOlder={() => useChat.getState().loadOlder()}
        onImageClick={(src) => useUI.getState().openImage(src)}
        onMessageAction={handleMessageAction}
        onAvatarClick={handleAvatarClick}
        onAvatarMention={handleAvatarMention}
        onCardOpen={(userId) => navigate(`userInfo/${Number(userId)}`)}
        transcribingId={transcribingId}
        selecting={selecting}
        selectedKeys={selected}
        onToggleSelect={toggleSelect}
      />

      {/* 输入区（只读 / 禁言时禁用输入与发送） / 多选操作栏 */}
      {selecting ? (
        <div className="flex shrink-0 items-stretch border-t border-[#E0E0E0] bg-[#F7F7F7]">
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={startMultiForward}
            className="flex h-[52px] flex-1 items-center justify-center text-[15px] text-[#111] active:bg-black/5 disabled:opacity-40"
          >
            逐条转发
          </button>
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={startMergedForward}
            className="flex h-[52px] flex-1 items-center justify-center border-l border-[#E0E0E0] text-[15px] text-[#07C160] active:bg-black/5 disabled:opacity-40"
          >
            合并转发
          </button>
          <button
            type="button"
            onClick={cancelSelecting}
            className="flex h-[52px] flex-1 items-center justify-center border-l border-[#E0E0E0] text-[15px] text-[#999] active:bg-black/5"
          >
            取消
          </button>
        </div>
      ) : (
        <Composer
          readonly={readonly}
          readonlyText={readonlyText}
          members={members}
          allowMentionAll={allowMentionAll}
          onSend={(text, mentions) => useChat.getState().sendText(text, mentions)}
          onSendImage={(file) => useChat.getState().sendImage(file)}
          onSendSticker={(url) => useChat.getState().sendSticker(url)}
          onSendCard={() => setCardPickerOpen(true)}
          onSendVoice={(file, duration) => useChat.getState().sendVoice(file, duration)}
          onSendVideo={(file) => useChat.getState().sendVideo(file)}
          onSendFile={(file) => useChat.getState().sendFile(file)}
          onVoiceCall={handleVoiceCall}
          onVideoCall={handleVideoCall}
          onTyping={(typing) => emitTyping(id, typing)}
          mentionRequest={mentionRequest}
          onMentionConsumed={handleMentionConsumed}
        />
      )}

      {/* 消息操作 */}
      <Modal open={Boolean(actionMessage)} onClose={() => setActionMessage(null)} width={260}>
        <div className="-mx-5 -my-3">
          <button
            type="button"
            onClick={startSingleForward}
            className="flex h-[48px] w-full items-center justify-center text-[16px] text-[#333] active:bg-black/5"
          >
            转发
          </button>
          <div className="h-px bg-[#E5E5E5]" />
          <button
            type="button"
            onClick={startSelecting}
            className="flex h-[48px] w-full items-center justify-center text-[16px] text-[#333] active:bg-black/5"
          >
            多选
          </button>
          <div className="h-px bg-[#E5E5E5]" />
          <button
            type="button"
            onClick={confirmFavorite}
            className="flex h-[48px] w-full items-center justify-center text-[16px] text-[#333] active:bg-black/5"
          >
            收藏
          </button>
          {actionMessage && actionMessage.type === 'voice' ? (
            <>
              <div className="h-px bg-[#E5E5E5]" />
              <button
                type="button"
                onClick={confirmTranscribe}
                className="flex h-[48px] w-full items-center justify-center text-[16px] text-[#333] active:bg-black/5"
              >
                转文字
              </button>
            </>
          ) : null}
          {canRevoke && !revokeExpired ? (
            <>
              <div className="h-px bg-[#E5E5E5]" />
              <button
                type="button"
                onClick={confirmRevoke}
                className="flex h-[48px] w-full items-center justify-center text-[16px] text-[#FA5151] active:bg-black/5"
              >
                撤回
              </button>
            </>
          ) : null}
          <div className="h-px bg-[#E5E5E5]" />
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="flex h-[48px] w-full items-center justify-center text-[16px] text-[#333] active:bg-black/5"
          >
            取消
          </button>
        </div>
      </Modal>

      {/* 设置聊天背景 */}
      <Modal open={bgOpen} onClose={() => setBgOpen(false)} title="设置聊天背景" width={320}>
        <div className="py-1">
          <p className="mb-2 text-[12px] text-[#999]">纯色背景</p>
          <div className="flex flex-wrap gap-3">
            {BG_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => handlePickBgColor(color)}
                disabled={bgBusy}
                className="h-10 w-10 rounded-[8px] ring-1 ring-black/10 active:scale-95 disabled:opacity-50"
                style={{ backgroundColor: color }}
                aria-label={`背景色 ${color}`}
              />
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => bgInputRef.current && bgInputRef.current.click()}
              disabled={bgBusy}
              className="flex h-[40px] flex-1 items-center justify-center rounded-[6px] bg-[#07C160] text-[14px] text-white active:bg-[#06AD56] disabled:opacity-50"
            >
              {bgBusy ? '设置中…' : '从相册选择'}
            </button>
            <button
              type="button"
              onClick={handleResetBg}
              disabled={bgBusy}
              className="flex h-[40px] flex-1 items-center justify-center rounded-[6px] bg-[#F2F2F2] text-[14px] text-[#333] active:bg-[#E5E5E5] disabled:opacity-50"
            >
              恢复默认
            </button>
          </div>

          <input
            ref={bgInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePickBgImage}
          />
        </div>
      </Modal>

      {/* 发送名片：选择好友 */}
      <Modal open={cardPickerOpen} onClose={() => setCardPickerOpen(false)} title="选择好友" width={320}>
        <div className="-mx-5 -my-3">
          {friends.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-[#999]">暂无好友</div>
          ) : (
            friends.map((friend) => (
              <button
                key={friend.id}
                type="button"
                onClick={() => handleSendCard(friend.id)}
                className="flex min-h-[52px] w-full items-center gap-3 px-5 text-left active:bg-black/5"
              >
                <Avatar
                  name={friend.nickname}
                  color={friend.avatar_color}
                  src={friend.avatar_url}
                  size={36}
                  radius={4}
                />
                <span className="min-w-0 flex-1 truncate text-[15px] text-[#111]">{displayNameOf(friend)}</span>
              </button>
            ))
          )}
        </div>
      </Modal>

      {/* 转发：选择目标会话 */}
      <ConversationPicker
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          setForwardTarget(null);
        }}
        onSelect={handlePickerSelect}
      />
    </div>
  );
}
