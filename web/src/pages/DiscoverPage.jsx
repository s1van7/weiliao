/**
 * 发现页：按 useDiscover.config 隐藏 / 排序「扫一扫 / 朋友圈 / 我的表情」。
 * 桌面端作为左栏内容（embedded）时无顶部导航，移动端显示 44px 顶部导航。
 */
import { useEffect } from 'react';
import { useUI } from '../store/useUI';
import { useStickers } from '../store/useStickers';
import { useDiscover } from '../store/useDiscover';
import PageHeader from '../components/PageHeader';
import Icon from '../components/Icon';

/** 三项入口的展示配置 */
const ENTRY_META = Object.freeze({
  scan: { label: '扫一扫', icon: 'scan', color: '#07C160', route: 'scan' },
  moments: { label: '朋友圈', icon: 'moments', color: '#4C7DE0', route: 'moments' },
  emoji: { label: '我的表情', icon: 'sticker', color: '#F2B33D', route: 'stickers' },
});

/**
 * @param {{embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function DiscoverPage({ embedded = false }) {
  const navigate = useUI((state) => state.navigate);
  const stickers = useStickers((state) => state.stickers);
  const discover = useDiscover((state) => state.config);
  const loadDiscover = useDiscover((state) => state.load);

  // 表情数量展示需要先拉一次列表（失败静默：入口仍可用）
  useEffect(() => {
    useStickers
      .getState()
      .load()
      .catch(() => {});
    loadDiscover().catch(() => {});
  }, [loadDiscover]);

  const items = [...discover]
    .sort((a, b) => Number(a.sort) - Number(b.sort))
    .filter((item) => item.enabled !== false)
    .map((item) => ({ key: item.key, ...(ENTRY_META[item.key] || {}) }))
    .filter((item) => item.label);

  const content = (
    <div className="pb-4">
      {items.map((item, index) => (
        <div key={item.key} className={index === 0 ? 'mt-2 bg-white' : 'mt-2 bg-white'}>
          <button
            type="button"
            onClick={() => navigate(item.route)}
            className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left active:bg-black/5"
          >
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px]"
              style={{ backgroundColor: item.color }}
            >
              <Icon name={item.icon} size={22} className="text-white" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[15px] text-[#111]">{item.label}</span>
            {item.key === 'emoji' ? (
              <span className="shrink-0 text-[12px] text-[#B2B2B2]">
                {stickers.length > 0 ? `${stickers.length} 个` : ''}
              </span>
            ) : null}
            <Icon name="chevronRight" size={18} className="text-[#C8C8C8]" />
          </button>
        </div>
      ))}
    </div>
  );

  if (embedded) {
    return <div className="h-full overflow-y-auto bg-[#EDEDED]">{content}</div>;
  }

  return (
    <div className="flex h-full flex-col bg-[#EDEDED]">
      <PageHeader title="发现" />
      <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
    </div>
  );
}
