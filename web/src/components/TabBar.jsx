/**
 * 移动端底部 TabBar：高 50px + 安全区，白底 1px 上边框，选中绿色，未读红点。
 * 4 个 Tab：消息 / 通讯录 / 发现 / 我。
 * @returns {JSX.Element}
 */
import { useUI } from '../store/useUI';
import { useChat } from '../store/useChat';
import { formatUnread } from '../lib/format';
import Icon from './Icon';

const ITEMS = [
  { key: 'chats', label: '消息', icon: 'chat' },
  { key: 'contacts', label: '通讯录', icon: 'users' },
  { key: 'discover', label: '发现', icon: 'discover' },
  { key: 'me', label: '我', icon: 'user' },
];

export default function TabBar() {
  const tab = useUI((state) => state.tab);
  const navigate = useUI((state) => state.navigate);
  const unreadTotal = useChat((state) => state.unreadTotal);

  return (
    <nav
      className="shrink-0 border-t border-[#E5E5E5] bg-white"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="主导航"
    >
      <div className="flex h-[50px] items-stretch">
        {ITEMS.map((item) => {
          const active = tab === item.key;
          const badge = item.key === 'chats' ? unreadTotal : 0;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.key)}
              className="relative flex flex-1 flex-col items-center justify-center gap-[2px] active:bg-black/5"
            >
              <span className="relative flex items-center justify-center">
                <Icon name={item.icon} size={24} className={active ? 'text-[#07C160]' : 'text-[#7A7E83]'} />
                {badge > 0 ? (
                  <span className="absolute -right-[14px] -top-[6px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#FA5151] px-1 text-[10px] leading-none text-white">
                    {formatUnread(badge)}
                  </span>
                ) : null}
              </span>
              <span className={`text-[10px] leading-[12px] ${active ? 'text-[#07C160]' : 'text-[#7A7E83]'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
