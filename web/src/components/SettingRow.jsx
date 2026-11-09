/**
 * 设置页行组件 + 开关控件。
 * 统一白底列表样式：左图标 + 标题（+副标题），右侧可放开关 / 值 / 箭头。
 */
import Icon from './Icon';

/**
 * 开关控件。
 * @param {{checked: boolean, onChange: (next: boolean) => void, disabled?: boolean}} props
 * @returns {JSX.Element}
 */
export function SettingSwitch({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[24px] w-[44px] shrink-0 rounded-full transition-colors ${
        checked ? 'bg-[#07C160]' : 'bg-[#E0E0E0]'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <span
        className="absolute top-[2px] h-[20px] w-[20px] rounded-full bg-white shadow transition-all"
        style={{ left: checked ? 22 : 2 }}
      />
    </button>
  );
}

/**
 * 设置行。
 * @param {{
 *   icon?: string,
 *   iconColor?: string,
 *   title: string,
 *   subtitle?: string,
 *   right?: any,
 *   onClick?: () => void,
 *   last?: boolean,
 *   danger?: boolean,
 * }} props
 * @returns {JSX.Element}
 */
export default function SettingRow({ icon, iconColor = '#07C160', title, subtitle, right, onClick, last = false, danger = false }) {
  const content = (
    <>
      {icon ? (
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px]"
          style={{ backgroundColor: iconColor }}
        >
          <Icon name={icon} size={18} className="text-white" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 text-left">
        <span className={`block text-[15px] leading-5 ${danger ? 'text-[#FA5151]' : 'text-[#111]'}`}>{title}</span>
        {subtitle ? <span className="mt-[1px] block truncate text-[12px] leading-4 text-[#999]">{subtitle}</span> : null}
      </span>
      {right !== undefined && right !== null ? (
        right
      ) : onClick ? (
        <Icon name="chevronRight" size={18} className="text-[#C8C8C8]" />
      ) : null}
    </>
  );

  const className = `flex min-h-[52px] w-full items-center gap-3 px-4 ${
    onClick ? 'active:bg-black/5' : ''
  } ${last ? '' : 'border-b border-[#F0F0F0]'}`;

  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
