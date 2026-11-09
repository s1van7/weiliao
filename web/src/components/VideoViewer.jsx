/**
 * 全屏视频播放器：黑色遮罩 + 居中 <video controls autoPlay playsInline> + 右上关闭；
 * Esc / 点击遮罩（视频外的黑色区域）关闭。样式对齐 ImageViewer。
 */
import { useEffect } from 'react';
import { useUI } from '../store/useUI';
import Icon from './Icon';

export default function VideoViewer() {
  const src = useUI((state) => state.videoPreview);
  const closeVideo = useUI((state) => state.closeVideo);

  useEffect(() => {
    if (!src) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeVideo();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [src, closeVideo]);

  if (!src) return null;

  return (
    <div className="wx-fade-in fixed inset-0 z-[90] flex items-center justify-center bg-black">
      {/* 遮罩：覆盖整个屏幕，点击关闭；视频元素在其上（保留 controls 交互） */}
      <button type="button" aria-label="关闭播放" className="absolute inset-0 h-full w-full" onClick={closeVideo} />
      <video src={src} controls autoPlay playsInline className="relative max-h-full max-w-full" />
      <button
        type="button"
        aria-label="关闭"
        onClick={closeVideo}
        className="absolute right-3 flex h-11 w-11 items-center justify-center rounded-full text-white/90 active:bg-white/10"
        style={{ top: 'calc(12px + env(safe-area-inset-top, 0px))' }}
      >
        <Icon name="close" size={26} />
      </button>
    </div>
  );
}
