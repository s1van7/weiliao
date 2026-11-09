/**
 * 选择目标会话弹层（转发共用）：
 *   - 展示我参与的会话（单聊显示对方展示名、群聊显示群名+人数）；
 *   - 只读会话置灰不可选；支持搜索过滤。
 */
import { useMemo, useState } from 'react';
import { useChat } from '../store/useChat';
import Modal from './Modal';
import Avatar from './Avatar';
import Icon from './Icon';
import { conversationTitle } from '../lib/format';

/**
 * @param {{
 *   open: boolean,
 *   onClose?: () => void,
 *   onSelect?: (conversationId: number) => void,
 *   title?: string,
 * }} props
 * @returns {JSX.Element}
 */
export default function ConversationPicker({ open, onClose, onSelect, title = '选择会话' }) {
  const conversations = useChat((state) => state.conversations);
  const [keyword, setKeyword] = useState('');

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return conversations.filter((item) => {
      if (!kw) return true;
      return conversationTitle(item).toLowerCase().includes(kw);
    });
  }, [conversations, keyword]);

  /**
   * 关闭弹层。
   * @returns {void}
   */
  const closePicker = () => {
    setKeyword('');
    if (onClose) onClose();
  };

  /**
   * 选择会话：回调前不先关闭，由调用方决定是否关闭（避免清掉待转发载荷）。
   * @param {number} conversationId
   * @returns {void}
   */
  const handleSelect = (conversationId) => {
    setKeyword('');
    if (onSelect) onSelect(conversationId);
  };

  return (
    <Modal open={open} onClose={closePicker} title={title} width={320}>
      <div className="-mx-5 -my-3">
        <div className="px-5 pb-2 pt-1">
          <div className="flex h-8 items-center gap-2 rounded-full bg-black/[0.06] px-3">
            <Icon name="search" size={15} className="text-[#8A8A8A]" />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索"
              className="h-full min-w-0 flex-1 text-[14px] text-[#111] placeholder:text-[#9A9A9A]"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-[#999]">暂无会话</div>
        ) : (
          filtered.map((item) => {
            const isGroup = item.type === 'group';
            const readonly = Boolean(item.readonly);
            return (
              <button
                key={item.id}
                type="button"
                disabled={readonly}
                onClick={() => handleSelect(item.id)}
                className={`flex min-h-[52px] w-full items-center gap-3 px-5 text-left ${
                  readonly ? 'opacity-40' : 'active:bg-black/5'
                }`}
              >
                {isGroup ? (
                  <Avatar name={item.name || '群聊'} group size={36} />
                ) : (
                  <Avatar
                    name={item.peer ? item.peer.nickname : ''}
                    color={item.peer ? item.peer.avatar_color : '#07C160'}
                    src={item.peer ? item.peer.avatar_url : ''}
                    size={36}
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-[#111]">{conversationTitle(item)}</span>
                  {isGroup ? (
                    <span className="block text-[12px] text-[#999]">{item.member_count || 0} 人</span>
                  ) : null}
                </span>
                {readonly ? <span className="text-[12px] text-[#999]">只读</span> : null}
              </button>
            );
          })
        )}
      </div>
    </Modal>
  );
}
