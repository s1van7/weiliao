/**
 * 全局 Toast：屏幕居中半透明黑底提示（微信风格）。
 * @returns {JSX.Element|null}
 */
import { useUI } from '../store/useUI';

export default function Toast() {
  const toast = useUI((state) => state.toast);
  if (!toast) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center px-8">
      <div
        className="wx-pop max-w-[70vw] rounded-lg bg-black/75 px-4 py-2.5 text-center text-[14px] leading-relaxed text-white"
        role="status"
      >
        {toast.message}
      </div>
    </div>
  );
}
