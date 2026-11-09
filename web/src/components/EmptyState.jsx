/**
 * 空态：手绘 SVG 插画 + 主副文案。
 * @param {{title?: string, description?: string, variant?: 'chat'|'contact'|'search'|'error', className?: string}} props
 * @returns {JSX.Element}
 */
export default function EmptyState({ title = '暂无内容', description = '', variant = 'chat', className = '' }) {
  const illustration = {
    chat: (
      <g>
        <rect x="26" y="24" width="84" height="58" rx="14" fill="#FFFFFF" stroke="#DCDCDC" strokeWidth="2" />
        <path d="M46 82v12l16-12" fill="#FFFFFF" stroke="#DCDCDC" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="52" cy="52" r="4" fill="#D9D9D9" />
        <circle cx="68" cy="52" r="4" fill="#D9D9D9" />
        <circle cx="84" cy="52" r="4" fill="#D9D9D9" />
      </g>
    ),
    contact: (
      <g>
        <circle cx="68" cy="44" r="20" fill="#FFFFFF" stroke="#DCDCDC" strokeWidth="2" />
        <path
          d="M34 96c0-18 15.2-30 34-30s34 12 34 30"
          fill="#FFFFFF"
          stroke="#DCDCDC"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path d="M96 34h16M104 26v16" stroke="#07C160" strokeWidth="2.4" strokeLinecap="round" />
      </g>
    ),
    search: (
      <g>
        <circle cx="60" cy="52" r="22" fill="#FFFFFF" stroke="#DCDCDC" strokeWidth="2" />
        <path d="m76 68 16 16" stroke="#DCDCDC" strokeWidth="3" strokeLinecap="round" />
        <path d="M52 52h16" stroke="#E0E0E0" strokeWidth="2.4" strokeLinecap="round" />
      </g>
    ),
    error: (
      <g>
        <circle cx="68" cy="58" r="26" fill="#FFFFFF" stroke="#DCDCDC" strokeWidth="2" />
        <path d="M68 44v16" stroke="#FA5151" strokeWidth="3" strokeLinecap="round" />
        <circle cx="68" cy="68" r="2.4" fill="#FA5151" />
      </g>
    ),
  }[variant];

  return (
    <div className={`flex flex-col items-center justify-center gap-3 px-8 py-14 text-center ${className}`}>
      <svg viewBox="0 0 136 116" width="136" height="116" aria-hidden="true">
        {illustration}
      </svg>
      <p className="text-[15px] text-[#999]">{title}</p>
      {description ? <p className="max-w-[280px] text-[13px] leading-relaxed text-[#B2B2B2]">{description}</p> : null}
    </div>
  );
}
