/**
 * 内联 SVG 图标集（不引入任何图标库，全部手写路径）。
 * 用法：<Icon name="back" size={22} className="text-[#111]" />
 */
const ICONS = {
  back: (
    <path
      d="M15 4.5 7.5 12l7.5 7.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  more: (
    <g fill="currentColor">
      <circle cx="5.5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18.5" cy="12" r="1.7" />
    </g>
  ),
  search: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15.2 15.2 4.1 4.1" />
    </g>
  ),
  plus: (
    <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  ),
  close: (
    <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  ),
  check: (
    <path
      d="m5 12.8 4.6 4.6L19 6.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  doubleCheck: (
    <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2.5 12.6 3.9 3.9 6.6-6.6" />
      <path d="m9.6 16.5 1 1L21.5 6.6" />
    </g>
  ),
  emoji: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.4 14.2a4.4 4.4 0 0 0 7.2 0" strokeLinecap="round" />
      <circle cx="9.1" cy="9.9" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.9" cy="9.9" r="1.1" fill="currentColor" stroke="none" />
    </g>
  ),
  image: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.4" />
      <circle cx="8.6" cy="9.4" r="1.4" fill="currentColor" stroke="none" />
      <path d="m4.6 17.6 4.8-4.8 3 3 2.6-2.6 4.4 4.4" strokeLinecap="round" />
    </g>
  ),
  chat: (
    <path
      d="M4.3 5.7A2.7 2.7 0 0 1 7 3h10a2.7 2.7 0 0 1 2.7 2.7v7.1A2.7 2.7 0 0 1 17 15.5h-6.5l-4.3 3.2a.7.7 0 0 1-1.1-.6v-2.7a2.7 2.7 0 0 1-.8-1.9V5.7Z"
      fill="currentColor"
    />
  ),
  users: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="9.2" cy="8.2" r="3.1" />
      <path d="M3.6 19.1c0-2.9 2.5-5.1 5.6-5.1s5.6 2.2 5.6 5.1" />
      <path d="M16.1 5.7a2.9 2.9 0 0 1 0 5.4" />
      <path d="M17.3 14.1c2 .6 3.4 2.3 3.4 4.4" />
    </g>
  ),
  user: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.9 19.6c0-3.3 3.2-5.9 7.1-5.9s7.1 2.6 7.1 5.9" />
    </g>
  ),
  group: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3.6" y="3.6" width="7" height="7" rx="1.6" />
      <rect x="13.4" y="3.6" width="7" height="7" rx="1.6" />
      <rect x="3.6" y="13.4" width="7" height="7" rx="1.6" />
      <rect x="13.4" y="13.4" width="7" height="7" rx="1.6" />
    </g>
  ),
  chevronRight: (
    <path
      d="m9.5 5 7 7-7 7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  warning: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <path d="M12 4.4 20.8 19.6H3.2L12 4.4Z" />
      <path d="M12 10v3.7" strokeLinecap="round" />
      <circle cx="12" cy="16.7" r="1" fill="currentColor" stroke="none" />
    </g>
  ),
  logout: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.4 7.6V5.4A1.4 1.4 0 0 0 13 4H5.4A1.4 1.4 0 0 0 4 5.4v13.2A1.4 1.4 0 0 0 5.4 20H13a1.4 1.4 0 0 0 1.4-1.4v-2.2" />
      <path d="M9.6 12H20.4" />
      <path d="m17.2 8.6 3.2 3.4-3.2 3.4" />
    </g>
  ),
  volume: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.4h3.2L11.4 6v12L7.2 14.6H4z" fill="currentColor" stroke="none" />
      <path d="M14.6 8.6a4.6 4.6 0 0 1 0 6.8" />
      <path d="M17.2 6.2a8 8 0 0 1 0 11.6" />
    </g>
  ),
  volumeOff: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.4h3.2L11.4 6v12L7.2 14.6H4z" fill="currentColor" stroke="none" />
      <path d="m15 9.6 5 4.8" />
      <path d="m20 9.6-5 4.8" />
    </g>
  ),
  refresh: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.6 12a7.6 7.6 0 1 1-2.3-5.4" />
      <path d="M20 4.4v4.8h-4.8" />
    </g>
  ),
  lock: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <rect x="4.8" y="10.2" width="14.4" height="10" rx="2.4" />
      <path d="M8.4 10.2V7.8a3.6 3.6 0 0 1 7.2 0v2.4" strokeLinecap="round" />
      <circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none" />
    </g>
  ),
  discover: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="8.4" />
      <path d="m15.4 8.6-1.9 4.9-4.9 1.9 1.9-4.9 4.9-1.9Z" strokeLinejoin="round" />
    </g>
  ),
  moments: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3.6" y="5.4" width="16.8" height="13.2" rx="2.4" />
      <circle cx="8.6" cy="10" r="1.3" fill="currentColor" stroke="none" />
      <path d="m4.8 17.4 4.6-4.4 3 2.9 2.6-2.5 4.2 4" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
  camera: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <path d="M3.6 8.6A2 2 0 0 1 5.6 6.6h2.2l1.3-1.8h5.8l1.3 1.8h2.2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2v-8Z" />
      <circle cx="12" cy="12.4" r="3.2" />
    </g>
  ),
  sticker: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3.8" y="3.8" width="16.4" height="16.4" rx="4.2" />
      <path d="M9 14.2a3.9 3.9 0 0 0 6 0" strokeLinecap="round" />
      <circle cx="9.2" cy="9.8" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="9.8" r="1" fill="currentColor" stroke="none" />
    </g>
  ),
  trash: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.8 7.4h14.4" />
      <path d="M9.2 7.4V5.6h5.6v1.8" />
      <path d="M6.6 7.4l.9 11.1a1.6 1.6 0 0 0 1.6 1.5h5.8a1.6 1.6 0 0 0 1.6-1.5l.9-11.1" />
      <path d="M10.4 11v5.4M13.6 11v5.4" />
    </g>
  ),
  scan: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8V5.6A1.6 1.6 0 0 1 5.6 4H8" />
      <path d="M16 4h2.4A1.6 1.6 0 0 1 20 5.6V8" />
      <path d="M20 16v2.4a1.6 1.6 0 0 1-1.6 1.6H16" />
      <path d="M8 20H5.6A1.6 1.6 0 0 1 4 18.4V16" />
      <path d="M4 12h16" />
    </g>
  ),
  qrcode: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <rect x="3.6" y="3.6" width="7" height="7" rx="1.2" />
      <rect x="13.4" y="3.6" width="7" height="7" rx="1.2" />
      <rect x="3.6" y="13.4" width="7" height="7" rx="1.2" />
      <path d="M13.4 13.4h3.2v3.2h-3.2zM18 18h2.4v2.4H18z" fill="currentColor" stroke="none" />
    </g>
  ),
  star: (
    <path
      d="m12 3.6 2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8L12 3.6Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
  ),
  settings: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.6h-4l-.4 2.4A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.4h4l.4-2.4a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.6Z" />
    </g>
  ),
  phone: (
    <path
      d="M6.7 4.5c.5 0 1 .2 1.4.6l2.1 2.4c.4.5.5 1.1.2 1.7l-.9 1.6c.8 1.7 2.2 3.1 3.9 3.9l1.6-.9c.6-.3 1.2-.2 1.7.2l2.4 2.1c.4.4.6.9.6 1.4v1.4c0 1.1-.9 2-2 2C10.6 21 4 14.4 4 6.5c0-1.1.9-2 2-2h.7Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
  ),
  video: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <rect x="3.5" y="6.5" width="12" height="11" rx="2.2" />
      <path d="m15.5 10 5-2.8v9.6l-5-2.8" />
    </g>
  ),
  mic: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
    </g>
  ),
  keyboard: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M7 13.5h.01M10.5 13.5h.01M14 13.5h.01M17.5 13.5h.01" strokeLinecap="round" />
      <path d="M8 16.5h8" strokeLinecap="round" />
    </g>
  ),
  phoneOff: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.7 4.5c.5 0 1 .2 1.4.6l2.1 2.4c.4.5.5 1.1.2 1.7l-.9 1.6c.8 1.7 2.2 3.1 3.9 3.9l1.6-.9c.6-.3 1.2-.2 1.7.2l2.4 2.1c.4.4.6.9.6 1.4v1.4c0 1.1-.9 2-2 2C10.6 21 4 14.4 4 6.5c0-1.1.9-2 2-2h.7Z" />
      <path d="m4 4 16 16" />
    </g>
  ),
  micOff: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
      <path d="m4 4 16 16" />
    </g>
  ),
  cameraOff: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <path d="M3.6 8.6A2 2 0 0 1 5.6 6.6h2.2l1.3-1.8h5.8l1.3 1.8h2.2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2v-8Z" />
      <circle cx="12" cy="12.4" r="3.2" />
      <path d="m4 4 16 16" strokeLinecap="round" />
    </g>
  ),
  speaker: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.4h3.2L11.4 6v12L7.2 14.6H4z" fill="currentColor" stroke="none" />
      <path d="M14.6 8.6a4.6 4.6 0 0 1 0 6.8" />
      <path d="M17.2 6.2a8 8 0 0 1 0 11.6" />
    </g>
  ),
  file: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M6 3.5h7l5 5V19a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5A1.5 1.5 0 0 1 6 3.5Z" />
      <path d="M13 3.5V9h5" />
      <path d="M8.5 13h7M8.5 16h7" strokeLinecap="round" />
    </g>
  ),
  micText: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="3.5" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 17.5V21" />
      <path d="M5 14h.01M8 14h.01M11 14h.01M14 14h.01M17 14h.01M20 14h.01" />
    </g>
  ),
};

/**
 * 图标组件。
 * @param {{name: string, size?: number, className?: string}} props
 * @returns {JSX.Element|null}
 */
export default function Icon({ name, size = 22, className = '' }) {
  const content = ICONS[name];
  if (!content) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {content}
    </svg>
  );
}

export { ICONS };
