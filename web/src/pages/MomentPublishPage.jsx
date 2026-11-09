/**
 * 发表动态：
 *   - 多行文本（≤1000 字，右下角计数）；
 *   - 照片 / live（gif）混排，图片数量不限；
 *   - 视频单条（mp4，不限大小与时长，前端不再预检）；
 *   - 音频单段（mp3/wav/m4a/aac/ogg/webm，不限大小）；
 *   - gif 走图片上传（type=live），mp4 走视频上传（type=video），音频走 audio 上传；
 *   - 图片 / 视频 / 音频三者互斥，发布时逐张/单条上传，拿到 /uploads 地址后再提交动态。
 */
import { useEffect, useRef, useState } from 'react';
import { useUI } from '../store/useUI';
import { useMoments } from '../store/useMoments';
import { api } from '../api';
import { compressImage, isImageFile } from '../lib/format';
import { MOMENT_TEXT_MAX } from '../config';
import PageHeader from '../components/PageHeader';
import Icon from '../components/Icon';
import Spinner from '../components/Spinner';

/**
 * 判断文件属于图片还是视频。
 * @param {File} file
 * @returns {'image'|'live'|'video'|null}
 */
function mediaKindOf(file) {
  if (file.type === 'video/mp4') return 'video';
  if (!isImageFile(file)) return null;
  return file.type === 'image/gif' ? 'live' : 'image';
}

/**
 * 判断文件是否为音频（后端支持 mp3/wav/m4a/aac/ogg/webm）。
 * @param {File} file
 * @returns {boolean}
 */
function isAudioFile(file) {
  return Boolean(file && /^audio\//i.test(file.type || ''));
}

/**
 * @param {{embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function MomentPublishPage({ embedded = false }) {
  const back = useUI((state) => state.back);
  const navigate = useUI((state) => state.navigate);
  const showToast = useUI((state) => state.showToast);
  const publishing = useMoments((state) => state.publishing);

  const [text, setText] = useState('');
  const [images, setImages] = useState([]); // {id, file, url, kind:'image'|'live'}
  const [video, setVideo] = useState(null); // {id, file, url}
  const [audio, setAudio] = useState(null); // {id, file, url}
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const seqRef = useRef(0);
  const mediaRef = useRef({ images, video, audio });
  mediaRef.current = { images, video, audio };

  // 卸载时释放本地预览 URL
  useEffect(
    () => () => {
      for (const item of mediaRef.current.images) {
        if (item.url) URL.revokeObjectURL(item.url);
      }
      if (mediaRef.current.video && mediaRef.current.video.url) {
        URL.revokeObjectURL(mediaRef.current.video.url);
      }
      if (mediaRef.current.audio && mediaRef.current.audio.url) {
        URL.revokeObjectURL(mediaRef.current.audio.url);
      }
    },
    [],
  );

  const textLength = [...text].length;
  const mediaCount = images.length + (video ? 1 : 0) + (audio ? 1 : 0);
  const canPublish = (text.trim().length > 0 || mediaCount > 0) && !busy && !publishing;

  /**
   * 选择图片（gif → live，其余 → image）。
   * @param {React.ChangeEvent<HTMLInputElement>} event
   * @returns {void}
   */
  const handlePickImages = (event) => {
    const input = event.target;
    const files = input && input.files ? Array.from(input.files) : [];
    if (input) input.value = '';
    if (files.length === 0) return;

    const invalid = files.find((file) => mediaKindOf(file) !== 'image' && mediaKindOf(file) !== 'live');
    if (invalid) {
      showToast('请选择图片文件（gif 可作为 live）', 'error');
      return;
    }

    setImages((prev) => {
      const added = files.map((file) => {
        seqRef.current += 1;
        return { id: seqRef.current, file, url: URL.createObjectURL(file), kind: mediaKindOf(file) };
      });
      return [...prev, ...added];
    });
  };

  /**
   * 选择视频（单条，会清空已选图片与音频）。
   * @param {React.ChangeEvent<HTMLInputElement>} event
   * @returns {void}
   */
  const handlePickVideo = (event) => {
    const input = event.target;
    const file = input && input.files ? input.files[0] : null;
    if (input) input.value = '';
    if (!file) return;
    if (mediaKindOf(file) !== 'video') {
      showToast('请选择 mp4 视频文件', 'error');
      return;
    }

    // 视频单条：清掉已选图片与音频
    setImages((prev) => {
      for (const item of prev) if (item.url) URL.revokeObjectURL(item.url);
      return [];
    });
    setAudio((prev) => {
      if (prev && prev.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    setVideo((prev) => {
      if (prev && prev.url) URL.revokeObjectURL(prev.url);
      seqRef.current += 1;
      return { id: seqRef.current, file, url: URL.createObjectURL(file) };
    });
  };

  /**
   * 选择音频（单段，会清空已选图片与视频）。
   * @param {React.ChangeEvent<HTMLInputElement>} event
   * @returns {void}
   */
  const handlePickAudio = (event) => {
    const input = event.target;
    const file = input && input.files ? input.files[0] : null;
    if (input) input.value = '';
    if (!file) return;
    if (!isAudioFile(file)) {
      showToast('请选择音频文件（mp3 / wav / m4a / aac / ogg / webm）', 'error');
      return;
    }

    // 音频单段：清掉已选图片与视频
    setImages((prev) => {
      for (const item of prev) if (item.url) URL.revokeObjectURL(item.url);
      return [];
    });
    setVideo((prev) => {
      if (prev && prev.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    setAudio((prev) => {
      if (prev && prev.url) URL.revokeObjectURL(prev.url);
      seqRef.current += 1;
      return { id: seqRef.current, file, url: URL.createObjectURL(file) };
    });
  };

  /**
   * 删除一张图片。
   * @param {number} id
   * @returns {void}
   */
  const handleRemoveImage = (id) => {
    setImages((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target && target.url) URL.revokeObjectURL(target.url);
      return prev.filter((item) => item.id !== id);
    });
  };

  /**
   * 删除视频。
   * @returns {void}
   */
  const handleRemoveVideo = () => {
    setVideo((prev) => {
      if (prev && prev.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  /**
   * 删除音频。
   * @returns {void}
   */
  const handleRemoveAudio = () => {
    setAudio((prev) => {
      if (prev && prev.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  /**
   * 发布：上传媒体 → 提交动态 → 返回时间线。
   * @returns {Promise<void>}
   */
  const handlePublish = async () => {
    if (!canPublish) return;
    setBusy(true);
    try {
      let payload = { content: text.trim(), media_type: 'text', images: [], video_url: '', audio_url: '' };

      if (video) {
        const uploaded = await api.uploadVideo(video.file);
        if (!uploaded || !uploaded.url) throw new Error('视频上传失败');
        payload.media_type = 'video';
        payload.video_url = uploaded.url;
      } else if (audio) {
        const uploaded = await api.uploadAudio(audio.file);
        if (!uploaded || !uploaded.url) throw new Error('音频上传失败');
        payload.media_type = 'audio';
        payload.audio_url = uploaded.url;
      } else if (images.length > 0) {
        const uploadedImages = [];
        for (const item of images) {
          const compressed = await compressImage(item.file);
          const uploaded = await api.uploadImage(compressed);
          if (!uploaded || !uploaded.url) throw new Error('图片上传失败');
          uploadedImages.push({ url: uploaded.url, type: item.kind === 'live' ? 'live' : 'image' });
        }
        const hasLive = uploadedImages.some((item) => item.type === 'live');
        payload.media_type = hasLive ? 'live' : 'image';
        payload.images = uploadedImages;
      }

      await useMoments.getState().publish(payload);
      showToast('已发表', 'success');
      navigate('moments', { replace: true });
    } catch (err) {
      showToast((err && err.message) || '发布失败，请重试', 'error');
    } finally {
      setBusy(false);
    }
  };

  const publishButton = (
    <button
      type="button"
      onClick={handlePublish}
      disabled={!canPublish}
      className={`flex h-[30px] items-center justify-center rounded-[4px] px-3 text-[14px] font-medium ${
        canPublish ? 'bg-[#07C160] text-white active:bg-[#06AD56]' : 'bg-[#E0E0E0] text-[#B2B2B2]'
      }`}
    >
      {busy || publishing ? <Spinner size={14} className={canPublish ? 'text-white' : 'text-[#B2B2B2]'} /> : '发表'}
    </button>
  );

  const content = (
    <div className="mx-auto w-full max-w-[620px]">
      <div className="bg-white px-3 py-3">
        <textarea
          value={text}
          onChange={(event) => setText([...event.target.value].slice(0, MOMENT_TEXT_MAX).join(''))}
          rows={6}
          maxLength={MOMENT_TEXT_MAX}
          placeholder="这一刻的想法…"
          className="wx-selectable block min-h-[132px] w-full text-[16px] leading-[23px] text-[#111] placeholder:text-[#B2B2B2]"
        />

        {/* 视频预览 */}
        {video ? (
          <div className="mt-2">
            <div className="relative w-[180px] overflow-hidden rounded-[4px] bg-black">
              <video src={video.url} controls playsInline className="block w-full" />
              <button
                type="button"
                aria-label="删除视频"
                onClick={handleRemoveVideo}
                className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-bl-[4px] bg-black/50 text-white active:bg-black/70"
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          </div>
        ) : null}

        {/* 音频预览 */}
        {audio ? (
          <div className="mt-2">
            <div className="flex w-full max-w-[320px] items-center gap-2 rounded-[6px] bg-[#F7F7F7] px-2 py-1.5">
              <audio src={audio.url} controls preload="metadata" className="min-w-0 flex-1" />
              <button
                type="button"
                aria-label="删除音频"
                onClick={handleRemoveAudio}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-black/5 text-[#666] active:bg-black/10"
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          </div>
        ) : null}

        {/* 图片 / live 九宫格 */}
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((item) => (
            <div key={item.id} className="relative h-[92px] w-[92px] overflow-hidden rounded-[4px] bg-[#F2F2F2]">
              <img src={item.url} alt="待发布图片" className="h-full w-full object-cover" draggable="false" />
              {item.kind === 'live' ? (
                <span className="absolute left-0 top-0 rounded-br-[4px] bg-black/55 px-1 py-0.5 text-[10px] leading-3 text-white">
                  live
                </span>
              ) : null}
              <button
                type="button"
                aria-label="删除图片"
                onClick={() => handleRemoveImage(item.id)}
                className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-bl-[4px] bg-black/50 text-white active:bg-black/70"
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          ))}

          {/* 添加按钮：图片不限量；视频 / 音频单条；三者互斥 */}
          <button
            type="button"
            onClick={() => imageInputRef.current && imageInputRef.current.click()}
            disabled={busy || Boolean(video) || Boolean(audio)}
            aria-label="添加图片"
            className="flex h-[92px] w-[92px] flex-col items-center justify-center gap-1 rounded-[4px] border border-dashed border-[#D0D0D0] text-[#B2B2B2] active:bg-black/5 disabled:opacity-50"
          >
            <Icon name="image" size={22} />
            <span className="text-[11px] leading-3">图片/live</span>
          </button>
          <button
            type="button"
            onClick={() => videoInputRef.current && videoInputRef.current.click()}
            disabled={busy || images.length > 0 || Boolean(audio)}
            aria-label="添加视频"
            className="flex h-[92px] w-[92px] flex-col items-center justify-center gap-1 rounded-[4px] border border-dashed border-[#D0D0D0] text-[#B2B2B2] active:bg-black/5 disabled:opacity-50"
          >
            <Icon name="camera" size={22} />
            <span className="text-[11px] leading-3">视频</span>
          </button>
          <button
            type="button"
            onClick={() => audioInputRef.current && audioInputRef.current.click()}
            disabled={busy || images.length > 0 || Boolean(video)}
            aria-label="添加音频"
            className="flex h-[92px] w-[92px] flex-col items-center justify-center gap-1 rounded-[4px] border border-dashed border-[#D0D0D0] text-[#B2B2B2] active:bg-black/5 disabled:opacity-50"
          >
            <Icon name="mic" size={22} />
            <span className="text-[11px] leading-3">音频</span>
          </button>
        </div>

        <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePickImages} />
        <input ref={videoInputRef} type="file" accept="video/mp4" className="hidden" onChange={handlePickVideo} />
        <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={handlePickAudio} />

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] leading-4 text-[#B2B2B2]">
            {mediaCount > 0 ? `已选 ${mediaCount} 个媒体` : '图片数量不限 / 1 个视频 / 1 段音频'}
          </span>
          <span
            className={`text-[11px] leading-4 ${
              textLength > MOMENT_TEXT_MAX - 50 ? 'text-[#FA5151]' : 'text-[#B2B2B2]'
            }`}
          >
            {textLength}/{MOMENT_TEXT_MAX}
          </span>
        </div>
      </div>

      <p className="px-4 py-3 text-[11px] leading-4 text-[#B2B2B2]">发表后仅好友可见，可在时间线里删除。</p>
    </div>
  );

  if (embedded) {
    return (
      <div className="flex h-full flex-col bg-[#F5F5F5]">
        <div className="flex h-[52px] shrink-0 items-center border-b border-[#E0E0E0] bg-[#F5F5F5] px-4">
          <button
            type="button"
            onClick={back}
            className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
            aria-label="返回"
          >
            <Icon name="back" size={20} className="text-[#111]" />
          </button>
          <h1 className="ml-1 min-w-0 flex-1 truncate text-[16px] font-semibold text-[#111]">发表动态</h1>
          {publishButton}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-8 pt-3">{content}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#EDEDED]">
      <PageHeader title="发表动态" onBack={back} right={publishButton} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">{content}</div>
    </div>
  );
}