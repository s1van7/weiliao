/**
 * 朋友圈媒体渲染：image→img、live(gif)→img、live(mp4)→循环播放、video→带控制条、audio→音频播放。
 * 输入 url 为后端返回的相对路径，统一经 config.mediaUrl 拼成可访问地址。
 */
import { mediaUrl } from '../config';

/**
 * @param {{
 *   url: string,
 *   type?: 'image'|'live'|'video'|'audio',
 *   className?: string,
 *   onClick?: () => void,
 *   alt?: string,
 * }} props
 * @returns {JSX.Element|null}
 */
export default function MomentMedia({ url, type = 'image', className = '', onClick, alt = '动态媒体' }) {
  if (!url) return null;
  const src = mediaUrl(url);

  if (type === 'video') {
    return (
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        className={`block ${className}`}
        draggable="false"
      />
    );
  }

  if (type === 'audio') {
    return (
      <audio
        src={src}
        controls
        preload="metadata"
        className={`block ${className}`}
      />
    );
  }

  // live 且为 mp4：循环静音自动播放；gif 直接按图片渲染
  if (type === 'live' && /\.mp4$/i.test(url)) {
    return (
      <video
        src={src}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        className={`block ${className}`}
        draggable="false"
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`block ${className}`}
      draggable="false"
      loading="lazy"
      onClick={onClick}
    />
  );
}
