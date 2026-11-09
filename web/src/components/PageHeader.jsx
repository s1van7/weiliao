/**
 * 移动端顶部导航栏：高 44px，标题居中 17px/600，左右各 44px 操作位。
 * 顶部安全区由 App 根容器统一处理（padding-top: env(safe-area-inset-top)）。
 * @param {{title?: string, onBack?: (() => void)|null, right?: any, subtitle?: any, className?: string}} props
 * @returns {JSX.Element}
 */
import Icon from './Icon';

export default function PageHeader({ title = '', onBack, right = null, subtitle = null, className = '' }) {
  return (
    <header className={`relative z-20 shrink-0 border-b border-black/[0.06] bg-[#EDEDED] ${className}`}>
      <div className="flex h-11 items-center px-1">
        <div className="flex w-11 items-center justify-start">
          {onBack ? (
            <button
              type="button"
              aria-label="返回"
              onClick={onBack}
              className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
            >
              <Icon name="back" size={22} className="text-[#111]" />
            </button>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 text-center">
          <h1 className="truncate text-[17px] font-semibold leading-5 text-[#111]">{title}</h1>
          {subtitle ? <div className="mt-[1px] truncate text-[11px] leading-3">{subtitle}</div> : null}
        </div>

        <div className="flex w-11 items-center justify-end">{right}</div>
      </div>
    </header>
  );
}
