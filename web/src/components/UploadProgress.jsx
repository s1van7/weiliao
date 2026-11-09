/**
 * 分片上传进度条：百分比 + 已传/总大小 + 分片粒度；失败时展示「点击继续」。
 */
import { UPLOAD_CHUNK_SIZE } from '../config';
import { formatFileSize } from '../lib/format';

/**
 * @param {{
 *   upload: {loaded?: number, total?: number, percent?: number, status?: string} | null,
 *   onResume: () => void,
 * }} props
 * @returns {JSX.Element}
 */
export default function UploadProgress({ upload, onResume }) {
  const percent = Math.max(0, Math.min(100, Number(upload?.percent) || 0));
  const loaded = Number(upload?.loaded) || 0;
  const total = Number(upload?.total) || 0;
  const failed = upload?.status === 'failed';

  return (
    <div className="w-[200px] rounded-[4px] border border-[#E5E5E5] bg-white px-3 py-2.5">
      <div className="mb-1 flex items-center justify-between text-[12px] leading-4 text-[#999]">
        <span>{failed ? '上传失败' : '上传中…'}</span>
        <span>{percent}%</span>
      </div>
      <div className="h-[6px] overflow-hidden rounded-full bg-[#F0F0F0]">
        <div
          className={`h-full transition-[width] ${failed ? 'bg-[#FA5151]' : 'bg-[#07C160]'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1 text-[11px] leading-4 text-[#B2B2B2]">
        {formatFileSize(loaded)} / {formatFileSize(total)} · 每片 {formatFileSize(UPLOAD_CHUNK_SIZE)}
      </div>
      {failed ? (
        <button
          type="button"
          onClick={onResume}
          className="mt-1 text-[12px] text-[#576B95] active:opacity-60"
        >
          点击继续
        </button>
      ) : null}
    </div>
  );
}
