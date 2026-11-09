/**
 * 文件消息气泡：文件图标 + 原始文件名 + 人性化大小；发送完成后可点击下载（attachment）。
 * 地址优先取 file_url，乐观阶段回退到 content（本地 blob url，仅展示不下载）。
 * 分片上传中展示 UploadProgress（进度 / 失败续传）。
 */
import { downloadUrl } from '../config';
import { formatFileSize } from '../lib/format';
import { useChat } from '../store/useChat';
import Icon from './Icon';
import UploadProgress from './UploadProgress';

/**
 * @param {{message: Record<string, any>}} props
 * @returns {JSX.Element}
 */
export default function FileMessage({ message, ...rest }) {
  const name = message.file_name || '文件';
  const size = Number(message.file_size) || 0;
  const fileUrl = message.file_url || message.content || '';
  const sending = message._status === 'sending';

  // 分片上传：有进行中的任务（uploading / failed）则展示进度条
  const upload = useChat((state) => state.uploadsByClientId[message.client_id]);
  const resumeFile = useChat((state) => state.resumeFile);
  if (upload && upload.status !== 'done') {
    return <UploadProgress upload={upload} onResume={() => resumeFile(message.client_id)} />;
  }

  const inner = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[#07C160]/10 text-[#07C160]">
        <Icon name="file" size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] leading-5 text-[#111]">{name}</span>
        <span className="block text-[12px] leading-4 text-[#999]">
          {sending ? '发送中…' : formatFileSize(size)}
        </span>
      </span>
    </>
  );

  if (!sending && fileUrl) {
    return (
      <a
        href={downloadUrl(fileUrl, name)}
        download
        className="flex w-[200px] items-center gap-2.5 rounded-[4px] border border-[#E5E5E5] bg-white px-3 py-2.5 active:bg-black/5"
        {...rest}
      >
        {inner}
      </a>
    );
  }

  return (
    <div
      className="flex w-[200px] items-center gap-2.5 rounded-[4px] border border-[#E5E5E5] bg-white px-3 py-2.5"
      {...rest}
    >
      {inner}
    </div>
  );
}
