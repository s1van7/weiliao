/**
 * 全屏图片预览：黑色遮罩 + 居中图片 + 右上关闭；Esc / 点击遮罩关闭。
 */
import { useEffect } from 'react';
import { useUI } from '../store/useUI';
import Icon from './Icon';

export default function ImageViewer() {
  const src = useUI((state) => state.imagePreview);
  const closeImage = useUI((state) => state.closeImage);

  useEffect(() => {
    if (!src) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeImage();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [src, closeImage]);

  if (!src) return null;

  return (
    <div className="wx-fade-in fixed inset-0 z-[90] flex items-center justify-center bg-black">
      <button type="button" aria-label="关闭预览" className="absolute inset-0 h-full w-full" onClick={closeImage} />
      <img
        src={src}
        alt="图片预览"
        className="pointer-events-none relative max-h-full max-w-full select-none object-contain"
        draggable="false"
      />
      <button
        type="button"
        aria-label="关闭"
        onClick={closeImage}
        className="absolute right-3 flex h-11 w-11 items-center justify-center rounded-full text-white/90 active:bg-white/10"
        style={{ top: 'calc(12px + env(safe-area-inset-top, 0px))' }}
      >
        <Icon name="close" size={26} />
      </button>
    </div>
  );
}
