/**
 * 会话列表页。
 *   - 桌面端作为左栏内容（embedded）：无顶部导航，仅列表；
 *   - 移动端：44px 顶部导航（标题「微聊」+ 右上「+」），底部 TabBar 由 App 渲染；
 *   - 按 置顶 + last_message_at 倒序（服务端已排序，前端 store 同口径重排）；
 *   - 支持搜索过滤、骨架屏、空态；
 *   - 长按 / 右键会话弹出操作菜单：置顶、标记未读、隐藏、删除（+ 取消）。
 */
import { useMemo, useRef, useState } from 'react';
import { useAuth } from '../store/useAuth';
import { useChat } from '../store/useChat';
import { useUI } from '../store/useUI';
import ChatListItem from '../components/ChatListItem';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import { conversationTitle } from '../lib/format';

/**
 * 列表骨架屏。
 * @returns {JSX.Element}
 */
function ListSkeleton() {
  return (
    <div className="divide-y divide-black/[0.04]">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-3">
          <div className="h-11 w-11 shrink-0 animate-pulse rounded-[4px] bg-black/[0.08]" />
          <div className="min-w-0 flex-1">
            <div className="h-3.5 w-24 animate-pulse rounded bg-black/[0.08]" />
            <div className="mt-2 h-3 w-40 animate-pulse rounded bg-black/[0.05]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * @param {{embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function ChatsPage({ embedded = false }) {
  const user = useAuth((state) => state.user);
  const conversations = useChat((state) => state.conversations);
  const loading = useChat((state) => state.loadingConversations);
  const route = useUI((state) => state.route);
  const search = useUI((state) => state.search);
  const navigate = useUI((state) => state.navigate);
  const setFacePairKind = useUI((state) => state.setFacePairKind);
  const openModal = useUI((state) => state.openModal);
  const showToast = useUI((state) => state.showToast);

  const [sheetOpen, setSheetOpen] = useState(false);
  // 当前被长按 / 右键选中的会话（null 表示菜单关闭）
  const [menuConv, setMenuConv] = useState(null);
  const [menuBusy, setMenuBusy] = useState(false);
  // 菜单打开时间：长按抬手后浏览器可能补发一次 click，落在遮罩上会立刻关闭菜单，
  // 因此打开后的 400ms 内忽略关闭请求。
  const menuOpenedAtRef = useRef(0);

  const myId = user ? Number(user.id) : 0;

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return conversations;
    return conversations.filter((item) => conversationTitle(item).toLowerCase().includes(keyword));
  }, [conversations, search]);

  const handleOpen = (conversationId) => {
    navigate(`chat/${conversationId}`);
  };

  /**
   * 打开会话操作菜单（长按 / 右键）。
   * @param {Record<string, any>} conversation
   * @returns {void}
   */
  const openMenu = (conversation) => {
    if (!conversation) return;
    menuOpenedAtRef.current = Date.now();
    setMenuConv(conversation);
  };

  /**
   * 关闭会话操作菜单（请求进行中或刚打开 400ms 内不响应，避免长按抬手误关）。
   * @returns {void}
   */
  const closeMenu = () => {
    if (menuBusy) return;
    if (Date.now() - menuOpenedAtRef.current < 400) return;
    setMenuConv(null);
  };

  /**
   * 执行一条会话偏好操作，成功后关闭菜单。
   * @param {Record<string, any>} target 目标会话
   * @param {{pinned?: boolean, hidden?: boolean, unread?: boolean, muted?: boolean, clear?: boolean}} payload
   * @returns {Promise<void>}
   */
  const runPrefs = async (target, payload) => {
    if (!target || menuBusy) return;
    setMenuBusy(true);
    try {
      await useChat.getState().setConversationPrefs(target.id, payload);
      // 删除 / 隐藏了当前正在查看的会话：退回消息列表
      if ((payload.clear === true || payload.hidden === true) && route === `chat/${target.id}`) {
        navigate('chats', { replace: true });
      }
      setMenuConv(null);
    } catch (err) {
      showToast((err && err.message) || '操作失败', 'error');
    } finally {
      setMenuBusy(false);
    }
  };

  /**
   * 删除聊天：二次确认（复用全局确认弹窗）。
   * @returns {void}
   */
  const confirmDelete = () => {
    const target = menuConv;
    if (!target) return;
    openModal({
      title: '删除该聊天',
      content: '将同时清空该聊天的聊天记录，并从会话列表中移除。对方不受影响。',
      confirmText: '删除',
      danger: true,
      onConfirm: () => runPrefs(target, { clear: true }),
    });
  };

  const list = (
    <>
      {loading && conversations.length === 0 ? <ListSkeleton /> : null}

      {!loading && filtered.length === 0 ? (
        <EmptyState
          title={search ? '没有找到相关会话' : '还没有会话'}
          description={search ? '换个关键词试试吧' : '去通讯录找人聊天吧'}
          variant={search ? 'search' : 'chat'}
        />
      ) : null}

      {filtered.map((conversation) => (
        <ChatListItem
          key={conversation.id}
          conversation={conversation}
          myId={myId}
          active={embedded && route === `chat/${conversation.id}`}
          onClick={() => handleOpen(conversation.id)}
          onLongPress={openMenu}
          onContextMenu={openMenu}
        />
      ))}
    </>
  );

  // 会话操作菜单：移动端从底部区域弹出、桌面端居中，复用 Modal 保持一致
  const actionSheet = (
    <Modal open={Boolean(menuConv)} onClose={closeMenu} width={300}>
      {menuConv ? (
        <div className="-mx-5 -my-3">
          <button
            type="button"
            disabled={menuBusy}
            onClick={() => runPrefs(menuConv, { pinned: menuConv.pinned !== true })}
            className="flex h-[52px] w-full items-center justify-center px-5 text-[16px] text-[#111] active:bg-black/5 disabled:opacity-50"
          >
            {menuConv.pinned === true ? '取消置顶' : '置顶该聊天'}
          </button>
          <div className="h-px bg-[#E5E5E5]" />
          <button
            type="button"
            disabled={menuBusy}
            onClick={() => runPrefs(menuConv, { unread: true })}
            className="flex h-[52px] w-full items-center justify-center px-5 text-[16px] text-[#111] active:bg-black/5 disabled:opacity-50"
          >
            标记为未读
          </button>
          <div className="h-px bg-[#E5E5E5]" />
          <button
            type="button"
            disabled={menuBusy}
            onClick={() => runPrefs(menuConv, { muted: menuConv.muted !== true })}
            className="flex h-[52px] w-full items-center justify-center px-5 text-[16px] text-[#111] active:bg-black/5 disabled:opacity-50"
          >
            {menuConv.muted === true ? '取消免打扰' : '消息免打扰'}
          </button>
          <div className="h-px bg-[#E5E5E5]" />
          <button
            type="button"
            disabled={menuBusy}
            onClick={() => runPrefs(menuConv, { hidden: true })}
            className="flex h-[52px] w-full items-center justify-center px-5 text-[16px] text-[#111] active:bg-black/5 disabled:opacity-50"
          >
            隐藏该聊天
          </button>
          <div className="h-px bg-[#E5E5E5]" />
          <button
            type="button"
            disabled={menuBusy}
            onClick={confirmDelete}
            className="flex h-[52px] w-full items-center justify-center px-5 text-[16px] text-[#FA5151] active:bg-black/5 disabled:opacity-50"
          >
            删除该聊天
          </button>
          <div className="h-2 bg-[#F7F7F7]" />
          <button
            type="button"
            onClick={closeMenu}
            className="flex h-[52px] w-full items-center justify-center px-5 text-[16px] text-[#111] active:bg-black/5"
          >
            取消
          </button>
        </div>
      ) : null}
    </Modal>
  );

  if (embedded) {
    return (
      <div className="h-full overflow-y-auto">
        {list}
        {actionSheet}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="relative z-20 shrink-0 border-b border-black/[0.06] bg-[#EDEDED]">
        <div className="flex h-11 items-center px-1">
          <div className="flex w-11 items-center justify-start">
            <button
              type="button"
              aria-label="搜索"
              onClick={() => navigate('messageSearch')}
              className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
            >
              <Icon name="search" size={20} className="text-[#111]" />
            </button>
          </div>
          <div className="min-w-0 flex-1 text-center">
            <h1 className="truncate text-[17px] font-semibold leading-5 text-[#111]">微聊</h1>
          </div>
          <div className="flex w-11 items-center justify-end">
            <button
              type="button"
              aria-label="新建"
              onClick={() => setSheetOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
            >
              <Icon name="plus" size={22} className="text-[#111]" />
            </button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-white">{list}</div>

      {actionSheet}

      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} width={300}>
        <div className="-mx-5 -my-3">
          <button
            type="button"
            onClick={() => {
              setSheetOpen(false);
              navigate('scan');
            }}
            className="flex h-[52px] w-full items-center gap-3 px-5 text-[16px] active:bg-black/5"
          >
            <Icon name="scan" size={20} className="text-[#07C160]" />
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
            className="flex h-[52px] w-full items-center gap-3 px-5 text-[16px] active:bg-black/5"
          >
            <Icon name="file" size={20} className="text-[#07C160]" />
            面对面传文件
          </button>
          <div className="h-px bg-[#E5E5E5]" />
          <button
            type="button"
            onClick={() => {
              setSheetOpen(false);
              navigate('groupCreate');
            }}
            className="flex h-[52px] w-full items-center gap-3 px-5 text-[16px] active:bg-black/5"
          >
            <Icon name="group" size={20} className="text-[#07C160]" />
            发起群聊
          </button>
          <div className="h-px bg-[#E5E5E5]" />
          <button
            type="button"
            onClick={() => {
              setSheetOpen(false);
              navigate('addFriend');
            }}
            className="flex h-[52px] w-full items-center gap-3 px-5 text-[16px] active:bg-black/5"
          >
            <Icon name="users" size={20} className="text-[#07C160]" />
            添加朋友
          </button>
        </div>
      </Modal>
    </div>
  );
}
