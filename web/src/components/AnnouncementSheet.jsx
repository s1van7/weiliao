/**
 * 群公告面板（底部抽屉）：
 *   - 只读态：展示公告正文与最后更新时间，空态「暂无公告」；
 *   - 可编辑态（群主 / 管理员）：右上「编辑」进入编辑，≤500 字，保存后回调父组件写库。
 *
 * 打开时由调用方负责调 `POST /announcement/read` 并清除红点。
 */
import { useEffect, useState } from 'react';
import { ANNOUNCEMENT_MAX } from '../config';
import { formatMessageTime } from '../lib/time';
import Spinner from './Spinner';
import Icon from './Icon';

/**
 * @param {{
 *   open: boolean,
 *   announcement?: string,
 *   announcementAt?: number,
 *   canEdit?: boolean,
 *   saving?: boolean,
 *   onClose: () => void,
 *   onSave?: (text: string) => Promise<unknown>,
 * }} props
 * @returns {JSX.Element|null}
 */
export default function AnnouncementSheet({
  open,
  announcement = '',
  announcementAt = 0,
  canEdit = false,
  saving = false,
  onClose,
  onSave,
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(announcement);

  // 每次打开都回到「只读 + 最新内容」，避免残留上一次的编辑草稿
  useEffect(() => {
    if (!open) return;
    setEditing(false);
    setValue(announcement || '');
  }, [open, announcement]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  /**
   * 保存公告。
   * @returns {Promise<void>}
   */
  const handleSave = async () => {
    if (!onSave) return;
    try {
      await onSave(value.trim());
      setEditing(false);
    } catch {
      /* 错误提示由父组件 toast */
    }
  };

  const length = [...value].length;

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="关闭" className="absolute inset-0 h-full w-full bg-black/40" onClick={onClose} />

      <div
        className="wx-slide-up relative w-full max-w-[620px] rounded-t-[12px] bg-white shadow-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex h-11 items-center border-b border-[#F0F0F0] px-4">
          <span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-[#111]">群公告</span>
          {canEdit && !editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mr-1 px-2 text-[14px] text-[#576B95] active:opacity-60"
            >
              编辑
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-9 w-9 items-center justify-center rounded-full active:bg-black/5"
          >
            <Icon name="close" size={16} className="text-[#888]" />
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto px-4 py-3">
          {editing ? (
            <>
              <textarea
                value={value}
                onChange={(event) => setValue([...event.target.value].slice(0, ANNOUNCEMENT_MAX).join(''))}
                rows={7}
                placeholder="输入群公告，所有成员可见"
                className="wx-selectable block min-h-[148px] w-full rounded-[6px] bg-[#F7F7F7] p-2.5 text-[15px] leading-[22px] text-[#111] placeholder:text-[#B2B2B2]"
              />
              <div className="mt-1 text-right text-[11px] leading-4 text-[#B2B2B2]">
                {length}/{ANNOUNCEMENT_MAX}
              </div>
            </>
          ) : announcement ? (
            <>
              <p className="wx-selectable whitespace-pre-wrap break-words text-[15px] leading-[23px] text-[#111]">
                {announcement}
              </p>
              {announcementAt > 0 ? (
                <p className="mt-2 text-[11px] leading-4 text-[#B2B2B2]">更新于 {formatMessageTime(announcementAt)}</p>
              ) : null}
            </>
          ) : (
            <p className="py-8 text-center text-[13px] text-[#B2B2B2]">暂无公告</p>
          )}
        </div>

        {editing ? (
          <div className="flex h-[48px] items-stretch border-t border-[#E5E5E5]">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setValue(announcement || '');
              }}
              className="flex-1 border-r border-[#E5E5E5] text-[16px] text-[#333] active:bg-black/5"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-1 text-[16px] font-medium text-[#07C160] active:bg-black/5 disabled:opacity-50"
            >
              {saving ? <Spinner size={14} className="text-[#07C160]" /> : null}
              保存
            </button>
          </div>
        ) : (
          <div className="flex h-[48px] items-stretch border-t border-[#E5E5E5]">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 text-[16px] text-[#333] active:bg-black/5"
            >
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
