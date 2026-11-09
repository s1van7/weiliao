/**
 * 通用弹窗：遮罩 + 居中卡片 + 可选标题/底部操作区。
 * 页面可用局部 state 控制，也支持由 useUI.openModal 驱动的全局确认弹窗。
 */
import { useEffect } from 'react';

/**
 * @param {{
 *   open: boolean,
 *   title?: string,
 *   children?: any,
 *   footer?: any,
 *   onClose?: () => void,
 *   width?: number,
 *   closeOnOverlay?: boolean,
 * }} props
 * @returns {JSX.Element|null}
 */
export default function Modal({ open, title, children, footer, onClose, width = 320, closeOnOverlay = true }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && typeof onClose === 'function') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-6" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 h-full w-full bg-black/40"
        onClick={() => {
          if (closeOnOverlay && typeof onClose === 'function') onClose();
        }}
      />
      <div
        className="wx-pop relative w-full overflow-hidden rounded-[12px] bg-white shadow-xl"
        style={{ maxWidth: width }}
      >
        {title ? (
          <div className="px-5 pb-1 pt-4 text-center text-[16px] font-semibold text-[#111]">{title}</div>
        ) : null}
        <div className="max-h-[62vh] overflow-y-auto px-5 py-3 text-[14px] leading-relaxed text-[#333]">
          {children}
        </div>
        {footer ? <div className="border-t border-[#E5E5E5]">{footer}</div> : null}
      </div>
    </div>
  );
}

/**
 * 弹窗底部双按钮（取消 / 确认）。
 * @param {{onCancel?: () => void, onConfirm?: () => void, cancelText?: string, confirmText?: string, danger?: boolean, loading?: boolean, disabled?: boolean}} props
 * @returns {JSX.Element}
 */
export function ModalActions({
  onCancel,
  onConfirm,
  cancelText = '取消',
  confirmText = '确定',
  danger = false,
  loading = false,
  disabled = false,
}) {
  return (
    <div className="flex h-[48px] items-stretch">
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 border-r border-[#E5E5E5] text-[16px] text-[#333] active:bg-black/5"
        >
          {cancelText}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled || loading}
        className={`flex-1 text-[16px] font-medium active:bg-black/5 disabled:opacity-50 ${
          danger ? 'text-[#FA5151]' : 'text-[#07C160]'
        }`}
      >
        {loading ? '处理中…' : confirmText}
      </button>
    </div>
  );
}
