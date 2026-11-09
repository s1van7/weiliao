/**
 * 消息全文搜索：
 *   - GET /api/messages/search 分页（before_id 游标倒序）；
 *   - 按会话分组展示，命中关键词高亮，点击进入会话。
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useUI } from '../store/useUI';
import { SEARCH_PAGE_SIZE } from '../config';
import { errorText } from '../lib/errorText';
import { conversationTitle } from '../lib/format';
import { formatMessageTime } from '../lib/time';
import PageHeader from '../components/PageHeader';
import Avatar from '../components/Avatar';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';

/** 类型筛选白名单 */
const TYPE_FILTERS = [
  { key: '', label: '全部' },
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
 * 搜索结果摘要。
 * @param {Record<string, any>} message
 * @returns {string}
 */
function snippetOf(message) {
  if (Number(message.revoked) === 1) return '消息已撤回';
  switch (message.type) {
    case 'text':
    case 'system':
      return String(message.content || '');
    case 'image':
      return '[图片]';
    case 'sticker':
      return '[表情]';
    case 'voice':
      return '[语音]';
    case 'video':
      return '[视频]';
    case 'file':
      return `[文件] ${String(message.file_name || '')}`;
    case 'merged':
      return '[聊天记录]';
    case 'card': {
      try {
        const parsed = JSON.parse(message.content || '{}');
        return `[名片] ${parsed.nickname || ''}`;
      } catch {
        return '[名片]';
      }
    }
    default:
      return String(message.content || '');
  }
}

/**
 * 关键词高亮。
 * @param {string} text
 * @param {string} keyword
 * @returns {Array<string|JSX.Element>|string}
 */
function highlight(text, keyword) {
  const value = String(text || '');
  const kw = String(keyword || '').trim();
  if (!kw) return value;
  const lower = value.toLowerCase();
  const lowerKw = kw.toLowerCase();
  const first = lower.indexOf(lowerKw);
  if (first < 0) return value;

  const parts = [];
  let start = 0;
  let idx = first;
  while (idx >= 0) {
    if (idx > start) parts.push(value.slice(start, idx));
    parts.push(
      <mark key={idx} className="rounded-[2px] bg-[#FDE68A] text-[#111]">
        {value.slice(idx, idx + lowerKw.length)}
      </mark>,
    );
    start = idx + lowerKw.length;
    idx = lower.indexOf(lowerKw, start);
  }
  if (start < value.length) parts.push(value.slice(start));
  return parts;
}

/**
 * @param {{embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function MessageSearchPage({ embedded = false }) {
  const back = useUI((state) => state.back);
  const navigate = useUI((state) => state.navigate);
  const showToast = useUI((state) => state.showToast);
  const initialSearch = useUI((state) => state.search);

  const [q, setQ] = useState(initialSearch);
  const [type, setType] = useState('');
  const [results, setResults] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [beforeId, setBeforeId] = useState(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searched, setSearched] = useState(false);

  /**
   * 执行搜索。
   * @param {boolean} reset 是否重置分页
   * @param {string} keyword 关键词
   * @param {string} typeFilter 类型过滤
   * @returns {Promise<void>}
   */
  const runSearch = async (reset, keyword, typeFilter) => {
    const kw = String(keyword || '').trim();
    if (!kw) return;

    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const data = await api.searchMessages({
        q: kw,
        type: typeFilter || undefined,
        before_id: reset ? undefined : beforeId,
        limit: SEARCH_PAGE_SIZE,
      });
      const incoming = Array.isArray(data.results) ? data.results : [];
      setResults((prev) => (reset ? incoming : [...prev, ...incoming]));
      setHasMore(Boolean(data.has_more));
      if (incoming.length > 0) {
        const last = incoming[incoming.length - 1];
        if (last && last.message) setBeforeId(last.message.id);
      }
      setSearched(true);
    } catch (err) {
      showToast(errorText(err, '搜索失败'), 'error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // 从桌面左栏搜索框进入时自动搜索
  useEffect(() => {
    if (initialSearch) {
      runSearch(true, initialSearch, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const item of results) {
      const convId = Number(item.conversation && item.conversation.id);
      if (!convId) continue;
      if (!map.has(convId)) map.set(convId, { conversation: item.conversation, items: [] });
      map.get(convId).items.push(item);
    }
    return [...map.values()];
  }, [results]);

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
      <h1 className="ml-1 text-[16px] font-semibold text-[#111]">搜索聊天记录</h1>
    </div>
  ) : (
    <PageHeader title="搜索聊天记录" onBack={back} />
  );

  return (
    <div className={`flex h-full flex-col ${embedded ? 'bg-[#F5F5F5]' : 'bg-[#EDEDED]'}`}>
      {header}

      {/* 搜索框 */}
      <div className="shrink-0 bg-[#F5F5F5] px-3 pb-2 pt-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            runSearch(true, q, type);
          }}
          className="flex items-center gap-2"
        >
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-black/[0.06] px-3">
            <Icon name="search" size={15} className="text-[#8A8A8A]" />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="输入关键词搜索"
              className="h-full min-w-0 flex-1 text-[14px] text-[#111] placeholder:text-[#9A9A9A]"
            />
          </div>
          <button
            type="submit"
            disabled={!q.trim() || loading}
            className="flex h-9 shrink-0 items-center justify-center rounded-full bg-[#07C160] px-4 text-[14px] text-white active:bg-[#06AD56] disabled:opacity-60"
          >
            搜索
          </button>
        </form>

        {/* 类型筛选 */}
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {TYPE_FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setType(item.key);
                runSearch(true, q, item.key);
              }}
              className={`h-8 shrink-0 rounded-full px-3 text-[13px] ${
                type === item.key ? 'bg-[#07C160] text-white' : 'bg-white text-[#666] active:bg-black/5'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* 结果 */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#F5F5F5] pb-6">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner size={22} className="text-[#B2B2B2]" />
          </div>
        ) : searched && grouped.length === 0 ? (
          <EmptyState title="没有找到相关消息" description="换个关键词或类型试试吧" variant="search" />
        ) : (
          <div className={embedded ? 'mx-auto w-full max-w-[620px]' : ''}>
            {grouped.map((group) => {
              const conv = group.conversation;
              const isGroup = conv.type === 'group';
              const peer = conv.peer || {};
              return (
                <div key={conv.id} className="mb-3 bg-white">
                  <button
                    type="button"
                    onClick={() => navigate(`chat/${conv.id}`)}
                    className="flex w-full items-center gap-3 border-b border-[#F0F0F0] px-3 py-2.5 text-left active:bg-black/5"
                  >
                    {isGroup ? (
                      <Avatar name={conv.name || '群聊'} group size={36} />
                    ) : (
                      <Avatar name={peer.nickname} color={peer.avatar_color} src={peer.avatar_url} size={36} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium text-[#111]">
                        {conversationTitle(conv) || '聊天'}
                      </p>
                      <p className="mt-[1px] text-[12px] text-[#B2B2B2]">{group.items.length} 条匹配</p>
                    </div>
                    <Icon name="chevronRight" size={18} className="text-[#C8C8C8]" />
                  </button>

                  {group.items.map((item, index) => {
                    const message = item.message;
                    const senderName = isGroup ? `${message.sender_nickname || '成员'}：` : '';
                    return (
                      <button
                        key={`${message.id}-${index}`}
                        type="button"
                        onClick={() => navigate(`chat/${conv.id}`)}
                        className="flex w-full items-start gap-2 px-3 py-2.5 text-left active:bg-black/5"
                      >
                        <span className="w-[52px] shrink-0 pt-[2px] text-[11px] leading-4 text-[#B2B2B2]">
                          {formatMessageTime(message.created_at)}
                        </span>
                        <span className="min-w-0 flex-1 text-[14px] leading-5 text-[#333]">
                          {senderName ? <span className="text-[#576B95]">{senderName}</span> : null}
                          {highlight(snippetOf(message), q)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {hasMore ? (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  onClick={() => runSearch(false, q, type)}
                  disabled={loadingMore}
                  className="flex h-9 items-center gap-1.5 rounded-full bg-white px-5 text-[13px] text-[#07C160] active:bg-black/5 disabled:opacity-60"
                >
                  {loadingMore ? <Spinner size={13} className="text-[#07C160]" /> : null}
                  加载更多
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
