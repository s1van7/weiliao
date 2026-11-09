/**
 * 语音消息气泡：使用原生 HTMLAudioElement 播放 / 暂停。
 * 展示时长（秒），点击切换播放状态；播放中显示动态条。
 * 支持语音转文字：展示 message.transcript，转写中显示 loading，可一键复制。
 */
import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../config';
import { useUI } from '../store/useUI';
import Spinner from './Spinner';

/** 播放中的三根律动条（纯 CSS 动画，不引第三方库） */
function WaveBars({ active }) {
  return (
    <span className="flex h-[14px] items-end gap-[2px]">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={`w-[3px] rounded-full ${active ? 'wave-bar' : ''}`}
          style={{
            height: active ? `${[10, 14, 7][index]}px` : '4px',
            animationDelay: `${index * 0.18}s`,
            backgroundColor: 'currentColor',
            opacity: active ? 1 : 0.75,
          }}
        />
      ))}
    </span>
  );
}

/**
 * @param {{message: Record<string, any>, isMine: boolean, transcribing?: boolean}} props
 * @returns {JSX.Element}
 */
export default function VoiceMessage({ message, isMine, transcribing = false, ...rest }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);
  const showToast = useUI((state) => state.showToast);

  const url = mediaUrl(message.voice_url || message.content || '');
  const duration = Math.max(0, Number(message.voice_duration) || 0);
  const transcript = String(message.transcript || '').trim();

  useEffect(
    () => () => {
      const audio = audioRef.current;
      if (audio) {
        try {
          audio.pause();
        } catch {
          /* 忽略 */
        }
      }
    },
    [],
  );

  /**
   * 切换播放 / 暂停。
   * @returns {void}
   */
  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !url) return;
    if (playing) {
      audio.pause();
      return;
    }
    audio.currentTime = 0;
    audio
      .play()
      .catch(() => {
        /* 自动播放被浏览器拦截时静默失败 */
      });
  };

  /**
   * 复制转写文本。
   * @returns {Promise<void>}
   */
  const copyTranscript = async () => {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcript);
      showToast('已复制');
    } catch {
      showToast('复制失败', 'error');
    }
  };

  return (
    <div className={`flex flex-col gap-1 ${isMine ? 'items-end' : 'items-start'}`} {...rest}>
      <div className={`flex items-center gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
        <button
          type="button"
          aria-label="播放语音"
          onClick={togglePlay}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#07C160] active:opacity-70"
        >
          <WaveBars active={playing} />
        </button>
        <span className="text-[13px] leading-5 text-[#111]">{duration > 0 ? `${duration}″` : '语音'}</span>
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      </div>

      {transcribing ? (
        <span className="flex items-center gap-1 text-[12px] leading-4 text-[#999]">
          <Spinner size={12} className="text-[#B2B2B2]" />
          转写中…
        </span>
      ) : transcript ? (
        <div
          className={`max-w-full rounded-[4px] bg-[#F5F5F5] px-2 py-1 ${isMine ? 'text-right' : 'text-left'}`}
        >
          <span className="wx-selectable break-words text-[13px] leading-5 text-[#333]">{transcript}</span>
          <button
            type="button"
            onClick={copyTranscript}
            className="ml-2 align-middle text-[12px] text-[#576B95] active:opacity-60"
          >
            复制
          </button>
        </div>
      ) : null}
    </div>
  );
}
