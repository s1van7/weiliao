/**
 * 头像组件：微信风格「圆角方形 + 纯色底 + 昵称首字」，支持自定义图片头像。
 * 有 src 时渲染图片（object-cover），加载失败自动回退纯色首字；
 * 群聊使用 2x2 色块拼贴，避免圆形头像。
 */
import { useEffect, useState } from 'react';
import { initials } from '../lib/format';
import { mediaUrl } from '../config';

/**
 * @param {{
 *   name?: string,
 *   color?: string,
 *   src?: string,
 *   size?: number,
 *   radius?: number,
 *   online?: boolean,
 *   group?: boolean,
 *   badge?: number,
 *   className?: string,
 * }} props
 * @returns {JSX.Element}
 */
export default function Avatar({
  name = '',
  color = '#07C160',
  src = '',
  size = 40,
  radius = 4,
  online = false,
  group = false,
  badge = 0,
  className = '',
}) {
  // 图片加载失败标记：失败后回退到纯色首字，避免裂图
  const [failed, setFailed] = useState(false);

  // 换图或清除头像时重置失败标记，否则一次失败会永久回退
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const text = initials(name);
  const dotSize = Math.max(9, Math.round(size * 0.28));
  // 相对路径统一走 config.mediaUrl 拼 SERVER_URL（与聊天图片同一套逻辑，兼容 App 端）
  const imageSrc = src ? mediaUrl(src) : '';
  const showImage = Boolean(imageSrc) && !failed;

  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      {showImage ? (
        <img
          src={imageSrc}
          alt={name || '头像'}
          className="block h-full w-full object-cover"
          style={{ borderRadius: radius }}
          referrerPolicy="no-referrer"
          loading="lazy"
          draggable="false"
          onError={() => setFailed(true)}
        />
      ) : group ? (
        <div
          className="grid h-full w-full grid-cols-2 grid-rows-2 gap-[1px] overflow-hidden bg-[#D8D8D8]"
          style={{ borderRadius: radius }}
        >
          <span style={{ background: '#07C160' }} />
          <span style={{ background: '#10AEFF' }} />
          <span style={{ background: '#FF9F0A' }} />
          <span style={{ background: '#AF52DE' }} />
        </div>
      ) : (
        <div
          className="flex h-full w-full select-none items-center justify-center font-medium text-white"
          style={{
            borderRadius: radius,
            backgroundColor: color || '#07C160',
            fontSize: Math.max(12, Math.round(size * 0.4)),
            lineHeight: 1,
          }}
        >
          {text}
        </div>
      )}

      {online ? (
        <span
          className="absolute rounded-full border-white bg-[#07C160]"
          style={{
            width: dotSize,
            height: dotSize,
            borderWidth: 2,
            right: -1,
            bottom: -1,
          }}
        />
      ) : null}

      {badge > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#FA5151] px-1 text-[10px] leading-none text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </div>
  );
}
