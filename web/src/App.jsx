/**
 * 应用根组件：
 *   启动校验（全屏闪屏）→ 未登录显示登录页 → 已登录进入双栏 / 单栏主界面。
 * 同时承担：socket 事件桥接、页面标题未读提醒、网络状态条、SW 更新提示、全局 Toast / 弹窗 / 图片预览。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './store/useAuth';
import { useChat } from './store/useChat';
import { useCall } from './store/useCall';
import { useUI } from './store/useUI';
import { useStickers } from './store/useStickers';
import { useMoments } from './store/useMoments';
import { useSettings } from './store/useSettings';
import { connectSocket, disconnectSocket, onSocket } from './socket';
import { playMessageSound, unlockAudio } from './audio';
import { useIsDesktop } from './lib/hooks';
import { formatUnread } from './lib/format';
import { initBackButton } from './lib/backButton';
import LoginPage from './pages/LoginPage';
import ChatsPage from './pages/ChatsPage';
import ContactsPage from './pages/ContactsPage';
import ChatPage from './pages/ChatPage';
import ProfilePage from './pages/ProfilePage';
import NewFriendsPage from './pages/NewFriendsPage';
import AddFriendPage from './pages/AddFriendPage';
import GroupCreatePage from './pages/GroupCreatePage';
import GroupInfoPage from './pages/GroupInfoPage';
import UserInfoPage from './pages/UserInfoPage';
import DiscoverPage from './pages/DiscoverPage';
import MomentsPage from './pages/MomentsPage';
import MomentPublishPage from './pages/MomentPublishPage';
import StickerManagePage from './pages/StickerManagePage';
import SettingsPage from './pages/SettingsPage';
import MyQrPage from './pages/MyQrPage';
import ScanPage from './pages/ScanPage';
import FavoritesPage from './pages/FavoritesPage';
import UserMomentsPage from './pages/UserMomentsPage';
import FacePairPage from './pages/FacePairPage';
import ChatHistoryPage from './pages/ChatHistoryPage';
import MessageSearchPage from './pages/MessageSearchPage';
import GroupJoinPage from './pages/GroupJoinPage';
import CallPage from './pages/CallPage';
import ConferencePage from './pages/ConferencePage';
import Avatar from './components/Avatar';
import Icon from './components/Icon';
import TabBar from './components/TabBar';
import SwipeTabs from './components/SwipeTabs';
import Toast from './components/Toast';
import Modal, { ModalActions } from './components/Modal';
import ImageViewer from './components/ImageViewer';
import VideoViewer from './components/VideoViewer';
import EmptyState from './components/EmptyState';
import Spinner from './components/Spinner';

/* ------------------------------------------------------------------ */
/* 闪屏                                                                */
/* ------------------------------------------------------------------ */

/**
 * 启动校验期间的闪屏：绿色 Logo + 应用名，避免闪现登录页。
 * @returns {JSX.Element}
 */
function Splash() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-[#EDEDED]">
      <svg width="80" height="80" viewBox="0 0 72 72" aria-hidden="true">
        <rect width="72" height="72" rx="18" fill="#07C160" />
        <path
          d="M36 16.5c-11.3 0-20.5 7.4-20.5 16.5 0 5.2 3.1 9.9 7.9 12.9-.5 2.7-2 5.7-4.1 8.1 4-.4 7.6-1.8 10.4-3.8 2 .5 4.2.8 6.3.8 11.3 0 20.5-7.4 20.5-16.5S47.3 16.5 36 16.5Z"
          fill="#FFFFFF"
        />
        <circle cx="28.6" cy="32.6" r="2.7" fill="#07C160" />
        <circle cx="43.4" cy="32.6" r="2.7" fill="#07C160" />
      </svg>
      <p className="mt-4 text-[17px] font-semibold tracking-wide text-[#07C160]">微聊</p>
      <Spinner size={18} className="mt-5 text-[#07C160]" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 桌面端左栏                                                           */
/* ------------------------------------------------------------------ */

/**
 * 左栏「我」的入口卡片。
 * @returns {JSX.Element}
 */
function SidebarMe() {
  const user = useAuth((state) => state.user);
  const navigate = useUI((state) => state.navigate);

  return (
    <div className="px-3 pb-4">
      <button
        type="button"
        onClick={() => navigate('me')}
        className="flex w-full items-center gap-3 rounded-[6px] bg-white p-3 text-left active:bg-black/5"
      >
        <Avatar
          name={user ? user.nickname : ''}
          color={user ? user.avatar_color : '#07C160'}
          src={user ? user.avatar_url : ''}
          size={44}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-[#111]">{user ? user.nickname : ''}</p>
          <p className="truncate text-[12px] text-[#999]">
            {user && user.username ? `用户名：${user.username}` : user && user.phone ? `手机号：${user.phone}` : ''}
          </p>
        </div>
        <Icon name="chevronRight" size={18} className="text-[#C8C8C8]" />
      </button>
      <p className="mt-3 px-1 text-[11px] leading-4 text-[#B2B2B2]">
        在右侧编辑资料、切换新消息提示音，或退出登录。
      </p>
    </div>
  );
}

/**
 * 桌面端左栏：本人头像 + 昵称 + 搜索框 + 胶囊 Tab + 列表。
 * @param {{tab: string}} props
 * @returns {JSX.Element}
 */
function Sidebar({ tab }) {
  const user = useAuth((state) => state.user);
  const unreadTotal = useChat((state) => state.unreadTotal);
  const search = useUI((state) => state.search);
  const setSearch = useUI((state) => state.setSearch);
  const navigate = useUI((state) => state.navigate);
  const setFacePairKind = useUI((state) => state.setFacePairKind);
  const [sheetOpen, setSheetOpen] = useState(false);

  const tabs = useMemo(
    () => [
      { key: 'chats', label: '消息', badge: unreadTotal },
      { key: 'contacts', label: '通讯录', badge: 0 },
      { key: 'discover', label: '发现', badge: 0 },
      { key: 'me', label: '我', badge: 0 },
    ],
    [unreadTotal],
  );

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-r border-[#E0E0E0] bg-[#EDEDED]">
      {/* 本人信息：点头像 / 昵称区域进入自己的资料卡 */}
      <div className="flex items-center gap-3 px-4 pb-2 pt-4">
        <button
          type="button"
          onClick={() => user && navigate(`userInfo/${Number(user.id)}`)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70"
        >
          <Avatar
            name={user ? user.nickname : ''}
            color={user ? user.avatar_color : '#07C160'}
            src={user ? user.avatar_url : ''}
            size={40}
            online
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-5 text-[#111]">{user ? user.nickname : ''}</p>
            <p className="truncate text-[11px] leading-4 text-[#999]">
              {(user && user.signature) || '这个人很懒，什么都没写'}
            </p>
          </div>
        </button>
        <button
          type="button"
          aria-label="新建"
          onClick={() => setSheetOpen(true)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#333] active:bg-black/5"
        >
          <Icon name="plus" size={20} />
        </button>
      </div>

      {/* 搜索 */}
      <div className="px-3 pb-2 pt-1">
        <div className="flex h-8 items-center gap-2 rounded-full bg-black/[0.055] px-3">
          <Icon name="search" size={15} className="text-[#8A8A8A]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索"
            className="h-full min-w-0 flex-1 text-[13px] text-[#111] placeholder:text-[#9A9A9A]"
          />
          {search ? (
            <button type="button" aria-label="清空搜索" onClick={() => setSearch('')} className="p-1">
              <Icon name="close" size={12} className="text-[#9A9A9A]" />
            </button>
          ) : null}
        </div>

        {search ? (
          <button
            type="button"
            onClick={() => navigate('messageSearch')}
            className="mt-2 flex w-full items-center gap-2 rounded-[6px] bg-white px-3 py-2 text-left active:bg-black/5"
          >
            <Icon name="search" size={15} className="text-[#07C160]" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-[#07C160]">搜索聊天记录：{search}</span>
          </button>
        ) : null}
      </div>

      {/* 胶囊 Tab */}
      <div className="px-3 pb-2">
        <div className="flex rounded-full bg-black/[0.06] p-[3px]">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.key)}
              className={`relative h-[26px] flex-1 rounded-full text-[12px] transition-colors ${
                tab === item.key ? 'bg-white font-medium text-[#111] shadow-sm' : 'text-[#666]'
              }`}
            >
              {item.label}
              {item.badge > 0 ? (
                <span className="absolute -right-0.5 -top-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#FA5151] px-1 text-[10px] leading-none text-white">
                  {formatUnread(item.badge)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* 列表：左右滑动切换 Tab（触屏笔记本 / 平板同样生效） */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SwipeTabs current={tab} enabled onChange={(next) => navigate(next)}>
          {tab === 'chats' ? <ChatsPage embedded /> : null}
          {tab === 'contacts' ? <ContactsPage embedded /> : null}
          {tab === 'discover' ? <DiscoverPage embedded /> : null}
          {tab === 'me' ? <SidebarMe /> : null}
        </SwipeTabs>
      </div>

      {/* 新建菜单 */}
      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} width={280}>
        <div className="-mx-5 -my-3">
          <button
            type="button"
            onClick={() => {
              setSheetOpen(false);
              navigate('scan');
            }}
            className="flex h-[52px] w-full items-center gap-3 px-5 text-[15px] active:bg-black/5"
          >
            <Icon name="scan" size={19} className="text-[#07C160]" />
            扫一扫
          </button>
          <div className="h-px bg-[#E5E5E5]" />
          <button
            type="button"
            onClick={() => {
              setSheetOpen(false);
              setFacePairKind('file');
              navigate('facePair');
            }}
            className="flex h-[52px] w-full items-center gap-3 px-5 text-[15px] active:bg-black/5"
          >
            <Icon name="file" size={19} className="text-[#07C160]" />
            面对面传文件
          </button>
          <div className="h-px bg-[#E5E5E5]" />
          <button
            type="button"
            onClick={() => {
              setSheetOpen(false);
              navigate('groupCreate');
            }}
            className="flex h-[52px] w-full items-center gap-3 px-5 text-[15px] active:bg-black/5"
          >
            <Icon name="group" size={19} className="text-[#07C160]" />
            发起群聊
          </button>
          <div className="h-px bg-[#E5E5E5]" />
          <button
            type="button"
            onClick={() => {
              setSheetOpen(false);
              navigate('addFriend');
            }}
            className="flex h-[52px] w-full items-center gap-3 px-5 text-[15px] active:bg-black/5"
          >
            <Icon name="users" size={19} className="text-[#07C160]" />
            添加朋友
          </button>
        </div>
      </Modal>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* 右侧 / 移动端页面路由                                                 */
/* ------------------------------------------------------------------ */

/**
 * 桌面端右栏内容。
 * @param {{route: string}} props
 * @returns {JSX.Element}
 */
function DesktopPane({ route }) {
  const [name, rawId] = route.split('/');
  const id = Number(rawId) || 0;

  if (name === 'chat' && id) return <ChatPage conversationId={id} />;
  if (name === 'me') return <ProfilePage embedded />;
  if (name === 'newFriends') return <NewFriendsPage embedded />;
  if (name === 'addFriend') return <AddFriendPage embedded />;
  if (name === 'groupCreate') return <GroupCreatePage embedded />;
  if (name === 'groupInfo' && id) return <GroupInfoPage conversationId={id} embedded />;
  if (name === 'userInfo' && id) return <UserInfoPage userId={id} embedded />;
  if (name === 'moments') return <MomentsPage embedded />;
  if (name === 'momentPublish') return <MomentPublishPage embedded />;
  if (name === 'stickers') return <StickerManagePage embedded />;
  if (name === 'settings') return <SettingsPage embedded />;
  if (name === 'myQr') return <MyQrPage embedded />;
  if (name === 'scan') return <ScanPage embedded />;
  if (name === 'favorites') return <FavoritesPage embedded />;
  if (name === 'userMoments' && id) return <UserMomentsPage userId={id} embedded />;
  if (name === 'facePair') return <FacePairPage embedded />;
  if (name === 'chatHistory' && id) return <ChatHistoryPage conversationId={id} embedded />;
  if (name === 'messageSearch') return <MessageSearchPage embedded />;
  if (name === 'groupJoin' && rawId) return <GroupJoinPage token={rawId} embedded />;
  if (name === 'discover') {
    return (
      <div className="flex h-full items-center justify-center bg-[#F5F5F5]">
        <EmptyState title="发现" description="从左侧选择「朋友圈」或「我的表情」" variant="contact" />
      </div>
    );
  }
  if (name === 'contacts') {
    return (
      <div className="flex h-full items-center justify-center bg-[#F5F5F5]">
        <EmptyState title="选择一个联系人" description="从左侧好友列表点击，即可开始聊天" variant="contact" />
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center bg-[#F5F5F5]">
      <EmptyState title="选择一个会话" description="从左侧会话列表点击，即可开始聊天" variant="chat" />
    </div>
  );
}

/**
 * 移动端页面路由。
 * @param {{route: string}} props
 * @returns {JSX.Element}
 */
function MobilePane({ route }) {
  const [name, rawId] = route.split('/');
  const id = Number(rawId) || 0;

  switch (name) {
    case 'contacts':
      return <ContactsPage />;
    case 'discover':
      return <DiscoverPage />;
    case 'me':
      return <ProfilePage />;
    case 'newFriends':
      return <NewFriendsPage />;
    case 'addFriend':
      return <AddFriendPage />;
    case 'groupCreate':
      return <GroupCreatePage />;
    case 'groupInfo':
      return id ? <GroupInfoPage conversationId={id} /> : <ChatsPage />;
    case 'userInfo':
      return id ? <UserInfoPage userId={id} /> : <ChatsPage />;
    case 'moments':
      return <MomentsPage />;
    case 'momentPublish':
      return <MomentPublishPage />;
    case 'stickers':
      return <StickerManagePage />;
    case 'settings':
      return <SettingsPage />;
    case 'myQr':
      return <MyQrPage />;
    case 'scan':
      return <ScanPage />;
    case 'favorites':
      return <FavoritesPage />;
    case 'userMoments':
      return id ? <UserMomentsPage userId={id} /> : <ChatsPage />;
    case 'facePair':
      return <FacePairPage />;
    case 'chatHistory':
      return id ? <ChatHistoryPage conversationId={id} /> : <ChatsPage />;
    case 'messageSearch':
      return <MessageSearchPage />;
    case 'groupJoin':
      return rawId ? <GroupJoinPage token={rawId} /> : <ChatsPage />;
    case 'chat':
      return id ? <ChatPage conversationId={id} /> : <ChatsPage />;
    default:
      return <ChatsPage />;
  }
}

/* ------------------------------------------------------------------ */
/* 全局弹窗                                                            */
/* ------------------------------------------------------------------ */

/**
 * 由 useUI.openModal 驱动的全局确认弹窗。
 * @returns {JSX.Element|null}
 */
function GlobalModal() {
  const modal = useUI((state) => state.modal);
  const closeModal = useUI((state) => state.closeModal);

  if (!modal) return null;

  const { title, content, confirmText = '确定', cancelText = '取消', danger = false, onConfirm } = modal;

  const handleConfirm = async () => {
    try {
      if (onConfirm) await onConfirm();
    } finally {
      closeModal();
    }
  };

  return (
    <Modal
      open
      title={title}
      onClose={closeModal}
      footer={
        <ModalActions
          onCancel={closeModal}
          onConfirm={handleConfirm}
          cancelText={cancelText}
          confirmText={confirmText}
          danger={danger}
        />
      }
    >
      <div className="py-1 text-[14px] leading-relaxed text-[#555]">{content}</div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* 主界面                                                              */
/* ------------------------------------------------------------------ */

/**
 * 已登录后的主界面（响应式双栏 / 单栏）。
 * @param {{token: string}} props
 * @returns {JSX.Element}
 */
function MainShell({ token }) {
  const desktop = useIsDesktop();
  const tab = useUI((state) => state.tab);
  const route = useUI((state) => state.route);
  const network = useUI((state) => state.network);
  const swUpdate = useUI((state) => state.swUpdate);
  const unreadTotal = useChat((state) => state.unreadTotal);
  const [blink, setBlink] = useState(false);

  const isTabRoute = ['chats', 'contacts', 'discover', 'me'].includes(route);

  // 进入主界面后预热数据
  useEffect(() => {
    const chat = useChat.getState();
    chat.loadConversations().catch(() => {});
    chat.loadFriends().catch(() => {});
    chat.loadPendingCount();
    useSettings.getState().load().catch(() => {});
  }, []);

  // socket 连接 + 事件桥接
  useEffect(() => {
    let offline = false;

    const offs = [
      onSocket('message:new', (payload) => {
        if (!payload || !payload.message) return;
        const result = useChat.getState().onSocketMessage(payload.message);
        if (result && result.unread) playMessageSound();
      }),
      onSocket('message:read', (payload) => useChat.getState().onMessageRead(payload)),
      onSocket('message:revoked', (payload) => useChat.getState().onMessageRevoked(payload)),
      onSocket('typing', (payload) => useChat.getState().onTyping(payload)),
      onSocket('presence', (payload) => useChat.getState().onPresence(payload)),
      onSocket('conversation:new', (payload) => useChat.getState().onConversationNew(payload)),
      onSocket('conversation:update', (payload) => useChat.getState().onConversationUpdate(payload)),
      onSocket('conversation:profile', (payload) => useChat.getState().onConversationProfile(payload)),
      // 本人在其他端改了会话偏好（置顶 / 隐藏 / 标记未读）
      onSocket('conversation:prefs', (payload) => useChat.getState().onConversationPrefs(payload)),
      onSocket('conversation:removed', (payload) => {
        // 被管理员移出群聊：清掉会话与缓存，若正停在该会话则退回消息页
        const convId = Number(payload && payload.conversation_id);
        const wasActive = convId > 0 && useChat.getState().activeId === convId;
        useChat.getState().onConversationRemoved(payload);
        if (wasActive) useUI.getState().navigate('chats', { replace: true });
        useUI.getState().showToast('你已被移出群聊', 'error');
      }),
      onSocket('user:update', (payload) => {
        // 对方改了昵称 / 头像：同步好友、会话 peer 与已渲染消息
        if (payload && payload.user) useChat.getState().applyUserUpdate(payload.user);
      }),
      onSocket('friend:request', (payload) => {
        const nickname = payload && payload.from_user ? payload.from_user.nickname : '有人';
        useUI.getState().showToast(`${nickname} 请求添加你为好友`);
        useChat.getState().loadPendingCount();
      }),
      onSocket('friend:accepted', () => {
        useUI.getState().showToast('对方已通过你的好友申请');
        useChat.getState().loadFriends().catch(() => {});
        useChat.getState().loadConversations().catch(() => {});
      }),
      // 通话 / 会议信令 → useCall 状态机
      onSocket('call:invite', (payload) => useCall.getState().handleInvite(payload)),
      onSocket('call:answer', (payload) => useCall.getState().handleAnswer(payload)),
      onSocket('call:reject', (payload) => useCall.getState().handleReject(payload)),
      onSocket('call:hangup', (payload) => useCall.getState().handleHangup(payload)),
      onSocket('ice:candidate', (payload) => useCall.getState().handleIce(payload)),
      onSocket('conf:invite', (payload) => useCall.getState().handleConfInvite(payload)),
      onSocket('conf:join', (payload) => useCall.getState().handleConfJoin(payload)),
      onSocket('conf:offer', (payload) => useCall.getState().handleConfOffer(payload)),
      onSocket('conf:answer', (payload) => useCall.getState().handleConfAnswer(payload)),
      onSocket('conf:ice:candidate', (payload) => useCall.getState().handleConfIce(payload)),
      onSocket('conf:leave', (payload) => useCall.getState().handleConfLeave(payload)),
      onSocket('conf:end', (payload) => useCall.getState().handleConfEnd(payload)),
      onSocket('connect', () => {
        useUI.getState().setNetwork(true);
        if (offline) {
          offline = false;
          useChat.getState().syncMessages();
        }
      }),
      onSocket('disconnect', () => {
        offline = true;
        useUI.getState().setNetwork(false);
      }),
      onSocket('connect_error', () => useUI.getState().setNetwork(false)),
    ];

    connectSocket(token);

    return () => {
      offs.forEach((off) => off());
      disconnectSocket();
    };
  }, [token]);

  // 页面标题：未读数量 + 隐藏时闪烁「【新消息】微聊」
  useEffect(() => {
    if (unreadTotal <= 0) {
      setBlink(false);
      return undefined;
    }
    const timer = setInterval(() => setBlink((value) => !value), 1000);
    return () => clearInterval(timer);
  }, [unreadTotal]);

  useEffect(() => {
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (hidden && unreadTotal > 0 && blink) document.title = '【新消息】微聊';
    else document.title = `${unreadTotal > 0 ? `(${unreadTotal})` : ''}微聊`;
  }, [unreadTotal, blink]);

  // 回到前台：把当前会话标记为已读
  useEffect(() => {
    const handler = () => {
      if (document.hidden) return;
      const activeId = useChat.getState().activeId;
      if (activeId) useChat.getState().markRead(activeId);
    };
    document.addEventListener('visibilitychange', handler);
    window.addEventListener('focus', handler);
    return () => {
      document.removeEventListener('visibilitychange', handler);
      window.removeEventListener('focus', handler);
    };
  }, []);

  // hash 变化（浏览器前进 / 后退）
  useEffect(() => {
    const handler = () => useUI.getState().syncFromHash();
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  // Service Worker 更新提示
  useEffect(() => {
    const handler = () => useUI.getState().setSwUpdate(true);
    window.addEventListener('wx:sw-update', handler);
    return () => window.removeEventListener('wx:sw-update', handler);
  }, []);

  // 首次用户手势解锁音频
  useEffect(() => {
    const handler = () => unlockAudio();
    window.addEventListener('pointerdown', handler, { once: true });
    window.addEventListener('keydown', handler, { once: true });
    return () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
    };
  }, []);

  // Capacitor Android 返回键：上一级或退出应用（纯 Web 环境内部直接 return）
  useEffect(() => {
    initBackButton();
  }, []);

  /**
   * 应用 Service Worker 更新：跳过等待并刷新。
   * @returns {Promise<void>}
   */
  const applyUpdate = async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration && registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    } catch (err) {
      console.warn('[app] apply update failed:', err);
    }
    window.location.reload();
  };

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden bg-[#F5F5F5]"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* 状态条 */}
      {!network ? (
        <div className="flex shrink-0 items-center justify-center gap-1.5 bg-[#FFF6D8] py-1.5 text-[12px] text-[#8A6A16]">
          <Spinner size={11} className="text-[#8A6A16]" />
          网络连接中…
        </div>
      ) : null}

      {swUpdate ? (
        <button
          type="button"
          onClick={applyUpdate}
          className="flex shrink-0 items-center justify-center gap-1.5 bg-[#FFF6D8] py-1.5 text-[12px] text-[#8A6A16] active:bg-[#F7E9B8]"
        >
          <Icon name="refresh" size={13} className="text-[#8A6A16]" />
          有新版本，点击刷新
        </button>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {desktop ? (
          <>
            <Sidebar tab={tab} />
            <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[#F5F5F5]">
              <DesktopPane route={route} />
            </main>
          </>
        ) : (
          <div className="flex h-full w-full flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden">
              {/* 四页（消息/通讯录/发现/我）左右滑动切换；仅在 Tab 页生效，避免误触发 */}
              <SwipeTabs
                current={tab}
                enabled={isTabRoute}
                onChange={(next) => useUI.getState().setTab(next)}
              >
                <MobilePane route={route} />
              </SwipeTabs>
            </div>
            {isTabRoute ? <TabBar /> : null}
          </div>
        )}
      </div>

      <CallPage />
      <ConferencePage />
      <Toast />
      <ImageViewer />
      <VideoViewer />
      <GlobalModal />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 根组件                                                              */
/* ------------------------------------------------------------------ */

export default function App() {
  const token = useAuth((state) => state.token);
  const user = useAuth((state) => state.user);
  const loading = useAuth((state) => state.loading);

  // 启动：读 localStorage token → GET /api/me 校验；同时用本地持久化主题先渲染，避免深色模式闪烁
  useEffect(() => {
    useSettings.getState().applyBootTheme();
    useAuth.getState().bootstrap();
    // 首次进入补齐 hash，保证路由可分享、Electron 下刷新不丢页面
    if (typeof window !== 'undefined' && !window.location.hash) {
      window.history.replaceState(null, '', `#/${useUI.getState().route}`);
    }
  }, []);

  // 未登录时清空会话缓存，避免切换账号串数据
  useEffect(() => {
    if (token) return;
    useChat.setState({
      conversations: [],
      activeId: null,
      messagesByConv: {},
      hasMoreByConv: {},
      detailsByConv: {},
      unreadTotal: 0,
      typingByConv: {},
      onlineByUser: {},
      friends: [],
      friendRequests: [],
      pendingRequestCount: 0,
    });
    useStickers.getState().reset();
    useMoments.getState().reset();
  }, [token]);

  // 仅在「从已登录 → 未登录」的登出瞬间重置用户设置；首次挂载（token 本就为空）不重置，避免把深色主题刷回浅色
  const prevTokenRef = useRef(token);
  useEffect(() => {
    const prev = prevTokenRef.current;
    prevTokenRef.current = token;
    if (prev && !token) useSettings.getState().reset();
  }, [token]);

  if (loading) return <Splash />;

  if (!token || !user) {
    return (
      <>
        <LoginPage />
        <Toast />
      </>
    );
  }

  return <MainShell token={token} />;
}
