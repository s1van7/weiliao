/**
 * 聊天记录查看（只读）：
 *   - 只调 GET /conversations/:id/messages 分页，不调 markRead（进入聊天主界面才标已读）；
 *   - 按日期分组（YYYY/M/D）+ 每条消息 HH:mm 时间 + 类型筛选。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../store/useAuth';
import { useUI } from '../store/useUI';
import { formatDateOnly } from '../lib/time';
import PageHeader from '../components/PageHeader';
import MessageBubble from '../components/MessageBubble';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';

/** 单页消息条数 */
const PAGE_SIZE = 30;

/** 类型筛选白名单 */
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'text', label: '文本' },
  { key: 'image', label: '图片' },
  { key: 'file', label: '文件' },
  { key: 'voice', label: '语音' },
  { key: 'video', label: '视频' },
  { key: 'sticker', label: '表情' },
  { key: 'card', label: '名片' },
  { key: 'merged', label: '聊天记录' },
];

/**
 * HH:mm。
 * @param {number} ts
 * @returns {string}
 */
function hhmm(ts) {
  const date = new Date(Number(ts));
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * @param {{conversationId: number, embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function ChatHistoryPage({ conversationId, embedded = false }) {
  const id = Number(conversationId) || 0;
  const me = useAuth((state) => state.user);
  const myId = me ? Number(me.id) : 0;
  const back = useUI((state) => state.back);
  const navigate = useUI((state) => state.navigate);
  const showToast = useUI((state) => state.showToast);

  const scrollRef = useRef(null);
  const loadingRef = useRef(false);

  const [conv, setConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [filter, setFilter] = useState('all');

  // 首屏：拉会话详情 + 最近一页消息
  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    setLoading(true);
    Promise.all([api.conversationDetail(id), api.messages(id, { limit: PAGE_SIZE })])
      .then(([detailData, messageData]) => {
        if (!alive) return;
        setConv(detailData.conversation || null);
        setMessages(messageData.messages || []);
        setHasMore(Boolean(messageData.has_more));
      })
      .catch((err) => {
        if (!alive) return;
        showToast((err && err.message) || '加载聊天记录失败', 'error');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /**
   * 向上翻页加载更早消息。
   * @returns {Promise<void>}
   */
  const loadOlder = async () => {
    if (loadingRef.current || !hasMore || loadingOlder) return;
    const first = messages.find((message) => typeof message.id === 'number');
    if (!first) return;

    loadingRef.current = true;
    setLoadingOlder(true);
    try {
      const data = await api.messages(id, { beforeId: first.id, limit: PAGE_SIZE });
      const existingIds = new Set(messages.map((message) => message.id));
      const older = (data.messages || []).filter((message) => !existingIds.has(message.id));
      setMessages((prev) => [...older, ...prev]);
      setHasMore(Boolean(data.has_more));
    } catch (err) {
      showToast((err && err.message) || '加载更早消息失败', 'error');
    } finally {
      setLoadingOlder(false);
      loadingRef.current = false;
    }
  };

  /**
   * 滚到顶部附近时加载更早。
   * @returns {void}
   */
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || el.scrollTop > 60) return;
    loadOlder();
  };

  const isGroup = conv ? conv.type === 'group' : false;

  const filtered = useMemo(
    () => (filter === 'all' ? messages : messages.filter((message) => message.type === filter)),
    [messages, filter],
  );

  // 按日期分组
  const groups = useMemo(() => {
    const out = [];
    let current = null;
    for (const message of filtered) {
      const label = formatDateOnly(message.created_at) || '未知日期';
      if (!current || current.label !== label) {
        current = { label, items: [] };
        out.push(current);
      }
      current.items.push(message);
    }
    return out;
  }, [filtered]);

  // 群聊 @ 高亮需要成员昵称表
  const mentionNames = useMemo(() => {
    const map = {};
    const members = (conv && conv.members) || [];
    for (const member of members) {
      map[Number(member.user_id)] = String(member.nickname || '');
    }
    return map;
  }, [conv]);

  const header = embedded ? (
    <div className="flex h-[52px] shrink-0 items-center border-b border-[#E0E0E0] bg-[#F5F5F5] px-4">
      <button
        type="button"
        onClick={back}
        className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
        aria-label="返回"
      >
        <Icon name="back" size={20} className="text-[#111]" />
      </button>
      <h1 className="ml-1 text-[16px] font-semibold text-[#111]">聊天记录</h1>
    </div>
  ) : (
    <PageHeader title="聊天记录" onBack={back} />
  );

  return (
    <div className={`flex h-full flex-col ${embedded ? 'bg-[#F5F5F5]' : 'bg-[#EDEDED]'}`}>
      {header}

      {/* 类型筛选 */}
      <div className="flex shrink-0 gap-2 overflow-x-auto bg-[#F5F5F5] px-3 py-2">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilter(item.key)}
            className={`h-8 shrink-0 rounded-full px-3 text-[13px] ${
              filter === item.key ? 'bg-[#07C160] text-white' : 'bg-white text-[#666] active:bg-black/5'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* 消息流 */}
      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto bg-[#F5F5F5] pb-6">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner size={22} className="text-[#B2B2B2]" />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState title="没有聊天记录" description="该会话还没有消息" variant="chat" />
        ) : (
          <div className={embedded ? 'mx-auto w-full max-w-[620px]' : ''}>
            {loadingOlder ? (
              <div className="flex justify-center py-3">
                <Spinner size={15} className="text-[#B2B2B2]" />
              </div>
            ) : null}

            {!hasMore && filtered.length > 0 ? (
              <div className="py-2 text-center text-[12px] text-[#B2B2B2]">没有更多消息了</div>
            ) : null}

            {groups.map((group) => (
              <div key={group.label}>
                <div className="sticky top-0 z-10 bg-[#F5F5F5]/95 py-2 text-center text-[12px] leading-4 text-[#999]">
                  {group.label}
                </div>
                <div className="bg-white">
                  {group.items.map((message, index) => {
                    const revoked = Number(message.revoked) === 1;
                    const isMine = message.sender_id === myId;
                    const key = `${message.client_id || message.id}-${index}`;

                    if (message.type === 'system') {
                      return (
                        <div key={key} className="flex justify-center px-6 py-2">
                          <span className="rounded-[3px] bg-black/[0.06] px-2 py-[3px] text-center text-[12px] leading-[17px] text-[#888]">
                            {message.content}
                          </span>
                        </div>
                      );
                    }

                    if (revoked) {
                      return (
                        <div key={key} className="py-2 text-center text-[12px] text-[#B2B2B2]">
                          {isMine ? '你撤回了一条消息' : `${message.sender_nickname || '对方'} 撤回了一条消息`}
                        </div>
                      );
                    }

                    return (
                      <div key={key} className="flex items-start gap-2 px-3 py-2">
                        <span className="w-[42px] shrink-0 pt-[6px] text-right text-[11px] leading-4 text-[#B2B2B2]">
                          {hhmm(message.created_at)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <MessageBubble
                            message={message}
                            isMine={isMine}
                            isGroup={isGroup}
                            showName={isGroup && !isMine}
                            mentionNames={mentionNames}
                            onImageClick={(src) => useUI.getState().openImage(src)}
                            onAvatarClick={(userId) => navigate(`userInfo/${Number(userId)}`)}
                            onCardOpen={(userId) => navigate(`userInfo/${Number(userId)}`)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
