/**
 * 合并转发聊天记录卡片：标题 + 摘要行，点击打开只读明细弹层。
 * 作为 MessageBubble 的 merged 分支渲染，必须透传 ...rest 以接收 cloneElement 注入的手势事件。
 */
import { useState } from 'react';
import { parseMergedContent } from '../lib/forward';
import MergedDetailModal from './MergedDetailModal';
import Icon from './Icon';

/**
 * @param {{message: Record<string, any>}} props
 * @returns {JSX.Element}
 */
export default function MergedMessage({ message, ...rest }) {
  const [open, setOpen] = useState(false);
  const parsed = parseMergedContent(message && message.content);
  const title = parsed ? parsed.title : '聊天记录';
  const items = parsed ? parsed.items : [];
  const summary = items.map((item) => String((item && item.summary) || '')).join(' ');
  const canOpen = Boolean(parsed && items.length > 0);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (canOpen) setOpen(true);
        }}
        className="flex w-[220px] flex-col gap-1.5 rounded-[8px] border border-[#E5E5E5] bg-white px-3 py-2.5 text-left active:bg-black/5"
        {...rest}
      >
        <span className="flex items-center gap-1.5">
          <Icon name="chat" size={16} className="shrink-0 text-[#07C160]" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-[#111]">{title}</span>
        </span>
        <span
          className="block break-words text-[13px] leading-5 text-[#666]"
          style={{
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 3,
            overflow: 'hidden',
          }}
        >
          {summary || '聊天记录'}
        </span>
      </button>

      {open ? <MergedDetailModal title={title} items={items} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
