/**
 * 「+」扩展面板：照片和视频 / 文件 / 收藏 / 语音通话 / 视频通话 / 名片 / 表情包。
 * 「照片和视频」走内置 input[type=file]（accept=image/*,video/*）；「文件」accept 不限。
 */
import { useRef } from 'react';
import Icon from './Icon';
import { useUI } from '../store/useUI';

/** 面板项配置 */
const ITEMS = [
  { key: 'media', label: '照片和视频', icon: 'image', color: '#07C160' },
  { key: 'file', label: '文件', icon: 'file', color: '#10AEFF' },
  { key: 'favorite', label: '收藏', icon: 'star', color: '#FF9F0A' },
  { key: 'voiceCall', label: '语音通话', icon: 'phone', color: '#34C759' },
  { key: 'videoCall', label: '视频通话', icon: 'video', color: '#5856D6' },
  { key: 'card', label: '名片', icon: 'user', color: '#00C7BE' },
  { key: 'stickers', label: '表情包', icon: 'sticker', color: '#FF2D55' },
];

/**
 * @param {{
 *   onSendImage: (file: File) => Promise<unknown>,
 *   onSendVideo: (file: File) => Promise<unknown>,
 *   onSendFile: (file: File) => Promise<unknown>,
 *   onSendCard: () => void,
 *   onVoiceCall: () => void,
 *   onVideoCall: () => void,
 * }} props
 * @returns {JSX.Element}
 */
export default function PlusPanel({ onSendImage, onSendVideo, onSendFile, onSendCard, onVoiceCall, onVideoCall }) {
  const showToast = useUI((state) => state.showToast);
  const navigate = useUI((state) => state.navigate);
  const mediaRef = useRef(null);
  const fileRef = useRef(null);

  /**
   * 选择「照片和视频」后发送：按文件类型分流到图片 / 视频管线。
   * @param {React.ChangeEvent<HTMLInputElement>} event
   * @returns {Promise<void>}
   */
  const handleMedia = async (event) => {
    const input = event.target;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    const isVideo = /^video\//i.test(file.type || '');
    try {
      if (isVideo) await onSendVideo(file);
      else await onSendImage(file);
    } catch (err) {
      showToast((err && err.message) || (isVideo ? '视频发送失败' : '图片发送失败'), 'error');
    }
  };

  /**
   * 选择「文件」后发送。
   * @param {React.ChangeEvent<HTMLInputElement>} event
   * @returns {Promise<void>}
   */
  const handleFile = async (event) => {
    const input = event.target;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      await onSendFile(file);
    } catch (err) {
      showToast((err && err.message) || '文件发送失败', 'error');
    }
  };

  /**
   * 点击面板项。
   * @param {string} key
   * @returns {void}
   */
  const handlePick = (key) => {
    if (key === 'media') {
      if (mediaRef.current) mediaRef.current.click();
      return;
    }
    if (key === 'file') {
      if (fileRef.current) fileRef.current.click();
      return;
    }
    if (key === 'favorite') {
      navigate('favorites');
      return;
    }
    if (key === 'voiceCall') {
      if (onVoiceCall) onVoiceCall();
      return;
    }
    if (key === 'videoCall') {
      if (onVideoCall) onVideoCall();
      return;
    }
    if (key === 'card') {
      onSendCard();
      return;
    }
    if (key === 'stickers') {
      navigate('stickers');
    }
  };

  return (
    <div className="border-t border-[#E5E5E5] bg-[#F7F7F7]">
      <div className="grid grid-cols-4 gap-2 px-4 py-4">
        {ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => handlePick(item.key)}
            className="flex flex-col items-center gap-2 active:opacity-70"
          >
            <span
              className="flex h-[52px] w-[52px] items-center justify-center rounded-[12px]"
              style={{ backgroundColor: item.color }}
            >
              <Icon name={item.icon} size={26} className="text-white" />
            </span>
            <span className="text-[12px] text-[#666]">{item.label}</span>
          </button>
        ))}
      </div>
      <input
        ref={mediaRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleMedia}
      />
      <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />
    </div>
  );
}
