/**
 * 朋友圈内联评论输入条：单行（Enter 提交 / Shift+Enter 换行），
 * 提交成功后由父组件决定是否收起。样式沿用微信「灰底圆角 + 蓝色发送」。
 */
import { useEffect, useRef, useState } from 'react';
import Spinner from './Spinner';

/** 评论长度上限（与后端 MOMENT_COMMENT_MAX 一致） */
const COMMENT_MAX = 200;

/**
 * @param {{
 *   onSubmit: (content: string) => Promise<unknown>,
 *   onCancel?: () => void,
 *   placeholder?: string,
 *   autoFocus?: boolean,
 * }} props
 * @returns {JSX.Element}
 */
export default function CommentInput({ onSubmit, onCancel, placeholder = '评论', autoFocus = true }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!autoFocus) return;
    const timer = setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      try {
        el.focus();
      } catch {
        /* 部分环境不支持 */
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [autoFocus]);

  /**
   * 提交评论。
   * @returns {Promise<void>}
   */
  const submit = async () => {
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onSubmit(text);
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center rounded-[4px] bg-[#F7F7F7] px-2 py-1.5">
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value.slice(0, COMMENT_MAX))}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            if (event.nativeEvent && event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          }}
          placeholder={placeholder}
          maxLength={COMMENT_MAX}
          className="min-w-0 flex-1 text-[13px] leading-5 text-[#111] placeholder:text-[#B2B2B2]"
        />
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={!value.trim() || busy}
        className="flex h-8 shrink-0 items-center justify-center rounded-[4px] px-2 text-[13px] text-[#576B95] active:opacity-60 disabled:text-[#B2B2B2]"
      >
        {busy ? <Spinner size={13} className="text-[#576B95]" /> : '发送'}
      </button>

      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="h-8 shrink-0 px-1 text-[13px] text-[#888] active:opacity-60"
        >
          取消
        </button>
      ) : null}
    </div>
  );
}
