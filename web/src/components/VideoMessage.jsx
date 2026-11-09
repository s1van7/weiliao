/**
 * 视频消息气泡：展示视频首帧 + 中央播放按钮，点击进入全屏播放（VideoViewer）。
 * 地址优先取 video_url（服务端回填），乐观阶段回退到 content（本地 blob url）。
 * 分片上传中展示 UploadProgress（进度 / 失败续传）。
 */
import { mediaUrl } from '../config';
import { useChat } from '../store/useChat';
import { useUI } from '../store/useUI';
import UploadProgress from './UploadProgress';

/**
 * @param {{message: Record<string, any>}} props
 * @returns {JSX.Element|null}
 */
export default function VideoMessage({ message, ...rest }) {
  const src = mediaUrl(message.video_url || message.content || '');
  const openVideo = useUI((state) => state.openVideo);

  // 分片上传：有进行中的任务（uploading / failed）则展示进度条，复用文件消息的进度组件
  const upload = useChat((state) => state.uploadsByClientId[message.client_id]);
  const resumeVideo = useChat((state) => state.resumeVideo);
  if (upload && upload.status !== 'done') {
    return <UploadProgress upload={upload} onResume={() => resumeVideo(message.client_id)} />;
  }

  if (!src) return null;

  return (
    <button
      type="button"
      onClick={() => openVideo(src)}
      className="relative block overflow-hidden rounded-[4px] border border-[#E5E5E5] bg-black"
      {...rest}
    >
      <video
        src={src}
        muted
        playsInline
        preload="metadata"
        className="block max-h-[240px] max-w-[180px] object-cover"
        draggable="false"
      />
      <span className="absolute inset-0 flex items-center justify-center bg-black/25">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5-11-6.5Z" />
          </svg>
        </span>
      </span>
    </button>
  );
}
