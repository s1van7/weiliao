/**
 * 通讯录页：
 *   - 顶部「新的朋友」（红色数量角标）与「群聊」入口；
 *   - 星标朋友固定排在最前，其余好友按 A-Z（拼音首字母）分组，右侧字母索引可快速跳转；
 *   - 点击好友进入单聊：有 conversation_id 直接用，否则 POST /conversations/single；
 *   - 群聊入口弹出群会话列表供选择。
 */
import { useMemo, useRef, useState } from 'react';
import { useChat } from '../store/useChat';
import { useUI } from '../store/useUI';
import Avatar from '../components/Avatar';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';
import Icon from '../components/Icon';
import { displayNameOf } from '../lib/format';
import { CONTACT_LETTERS, compareContact, initialOf } from '../lib/pinyin';

/**
 * 字母索引条：只在有对应分组的字母上显示，点击滚动到分组。
 * @param {{letters: string[], onJump: (key: string) => void}} props
 * @returns {JSX.Element}
 */
function LetterIndex({ letters, onJump }) {
  if (letters.length === 0) return null;
  return (
    <div className="pointer-events-auto absolute right-0 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-[1px] pr-[2px]">
      {letters.map((letter) => (
        <button
          key={letter}
          type="button"
          onClick={() => onJump(letter)}
          className="flex h-[15px] w-[15px] items-center justify-center rounded-full text-[9px] font-medium leading-none text-[#666] active:bg-black/10"
          aria-label={`跳到 ${letter === 'star' ? '星标朋友' : letter}`}
        >
          {letter === 'star' ? '★' : letter}
        </button>
      ))}
    </div>
  );
}

/**
 * @param {{embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function ContactsPage({ embedded = false }) {
  const friends = useChat((state) => state.friends);
  const conversations = useChat((state) => state.conversations);
  const pendingRequestCount = useChat((state) => state.pendingRequestCount);
  const onlineByUser = useChat((state) => state.onlineByUser);
  const navigate = useUI((state) => state.navigate);
  const search = useUI((state) => state.search);
  const showToast = useUI((state) => state.showToast);

  const [groupOpen, setGroupOpen] = useState(false);
  const [opening, setOpening] = useState(0);
  const scrollRef = useRef(null);

  const groups = useMemo(() => conversations.filter((item) => item.type === 'group'), [conversations]);

  /**
   * 分组结果：星标组 + 各字母组（只保留有好友的字母）。
   * 星标好友不再重复出现在字母组里，避免同一人出现两次。
   */
  const sections = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const list = friends
      .filter((friend) => {
        if (!keyword) return true;
        const name = String(displayNameOf(friend) || '').toLowerCase();
        const nickname = String(friend.nickname || '').toLowerCase();
        return name.includes(keyword) || nickname.includes(keyword);
      })
      .slice()
      .sort(compareContact);

    const starred = list.filter((friend) => friend.starred === true);
    const buckets = new Map();
    for (const friend of list) {
      if (friend.starred === true) continue;
      const letter = initialOf(displayNameOf(friend));
      if (!buckets.has(letter)) buckets.set(letter, []);
      buckets.get(letter).push(friend);
    }

    const result = [];
    if (starred.length > 0) result.push({ key: 'star', title: '★ 星标朋友', items: starred });
    for (const letter of CONTACT_LETTERS) {
      const items = buckets.get(letter);
      if (items && items.length > 0) result.push({ key: letter, title: letter, items });
    }
    return result;
  }, [friends, search]);

  const letters = useMemo(() => sections.map((section) => section.key), [sections]);

  /**
   * 点击字母索引：滚动到对应分组头（容器为 offsetParent，直接改 scrollTop 不会带动整页）。
   * @param {string} key 分组 key（star 或 A-Z / #）
   * @returns {void}
   */
  const jumpTo = (key) => {
    const container = scrollRef.current;
    if (!container) return;
    const target = container.querySelector(`[data-group="${key}"]`);
    if (!target) return;
    container.scrollTo({ top: Math.max(0, target.offsetTop - 2), behavior: 'smooth' });
  };

  /**
   * 打开与某位好友的单聊。
   * @param {Record<string, any>} friend
   * @returns {Promise<void>}
   */
  const openFriend = async (friend) => {
    if (opening) return;
    setOpening(friend.id);
    try {
      let conversationId = Number(friend.conversation_id) || 0;
      if (!conversationId) {
        conversationId = await useChat.getState().ensureSingleConversation(friend.id);
      }
      if (conversationId) navigate(`chat/${conversationId}`);
    } catch (err) {
      showToast(err && err.message ? err.message : '打开会话失败', 'error');
    } finally {
      setOpening(0);
    }
  };

  const content = (
    <>
      {/* 功能入口 */}
      <div className="mb-2 bg-white">
        <button
          type="button"
          onClick={() => navigate('newFriends')}
          className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left active:bg-black/5"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] bg-[#FA9D3B]">
            <Icon name="users" size={22} className="text-white" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] text-[#111]">新的朋友</span>
          {pendingRequestCount > 0 ? (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#FA5151] px-1 text-[10px] leading-none text-white">
              {pendingRequestCount > 99 ? '99+' : pendingRequestCount}
            </span>
          ) : null}
          <Icon name="chevronRight" size={18} className="text-[#C8C8C8]" />
        </button>
        <div className="ml-[58px] h-px bg-[#E5E5E5]" />
        <button
          type="button"
          onClick={() => setGroupOpen(true)}
          className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left active:bg-black/5"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] bg-[#07C160]">
            <Icon name="group" size={20} className="text-white" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] text-[#111]">群聊</span>
          <span className="text-[12px] text-[#B2B2B2]">{groups.length > 0 ? `${groups.length} 个` : ''}</span>
          <Icon name="chevronRight" size={18} className="text-[#C8C8C8]" />
        </button>
      </div>

      {/* 好友列表：星标 → A-Z 分组 */}
      <div className="bg-white">
        <div className="px-3 pb-1 pt-3 text-[12px] text-[#888]">好友 {friends.length}</div>
        {sections.length === 0 ? (
          <EmptyState
            title={search ? '没有找到好友' : '还没有好友'}
            description={search ? '换个关键词试试' : '去「新的朋友」或搜索添加好友'}
            variant="contact"
          />
        ) : (
          sections.map((section) => (
            <div key={section.key} data-group={section.key}>
              <div className="sticky top-0 z-10 bg-[#F7F7F7] px-3 py-1 text-[12px] leading-4 text-[#888]">
                {section.title}
              </div>
              {section.items.map((friend) => (
                <button
                  key={friend.id}
                  type="button"
                  onClick={() => openFriend(friend)}
                  className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left active:bg-black/5"
                >
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="查看用户资料"
                    onClick={(event) => {
                      event.stopPropagation();
                      navigate(`userInfo/${friend.id}`);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        navigate(`userInfo/${friend.id}`);
                      }
                    }}
                    className="shrink-0"
                  >
                    <Avatar
                      name={friend.nickname}
                      color={friend.avatar_color}
                      src={friend.avatar_url}
                      size={40}
                      online={onlineByUser[friend.id] !== undefined ? onlineByUser[friend.id] : friend.online}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-[#111]">{displayNameOf(friend)}</span>
                    {friend.signature ? (
                      <span className="mt-[1px] block truncate text-[12px] text-[#B2B2B2]">{friend.signature}</span>
                    ) : null}
                  </span>
                  {opening === friend.id ? <Spinner size={16} className="text-[#B2B2B2]" /> : null}
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {/* 群聊选择弹窗 */}
      <Modal
        open={groupOpen}
        onClose={() => setGroupOpen(false)}
        title="我的群聊"
        width={340}
        footer={
          <button
            type="button"
            onClick={() => setGroupOpen(false)}
            className="h-[48px] w-full text-[16px] text-[#333] active:bg-black/5"
          >
            关闭
          </button>
        }
      >
        {groups.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[#999]">还没有群聊，去「+」发起一个吧</p>
        ) : (
          <div className="-mx-5 -my-3 divide-y divide-[#F0F0F0]">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => {
                  setGroupOpen(false);
                  navigate(`chat/${group.id}`);
                }}
                className="flex w-full items-center gap-3 px-5 py-3 text-left active:bg-black/5"
              >
                <Avatar name={group.name} group size={36} src={group.avatar_url || ''} />
                <span className="min-w-0 flex-1 truncate text-[15px]">{group.name || '群聊'}</span>
                <span className="shrink-0 text-[12px] text-[#B2B2B2]">{group.member_count}人</span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </>
  );

  if (embedded) {
    return (
      <div className="relative h-full">
        <div ref={scrollRef} className="relative h-full overflow-y-auto bg-[#EDEDED] pb-4">
          {content}
        </div>
        {!search ? <LetterIndex letters={letters} onJump={jumpTo} /> : null}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#EDEDED]">
      <PageHeader
        title="通讯录"
        right={
          <button
            type="button"
            aria-label="添加朋友"
            onClick={() => navigate('addFriend')}
            className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
          >
            <Icon name="plus" size={22} className="text-[#111]" />
          </button>
        }
      />
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="relative h-full overflow-y-auto pb-4">
          {content}
        </div>
        {!search ? <LetterIndex letters={letters} onJump={jumpTo} /> : null}
      </div>
    </div>
  );
}
