/**
 * 语音录制按钮（按住说话）：
 *   - 按下开始录音、松开结束并回调 onRecord(file, duration)；
 *   - 上滑超过阈值取消；≤60s 自动截断发送；
 *   - Blob type 归一为 audio/webm（Chromium/Android）或 audio/mp4（Safari/iOS），不含 ;codecs；
 *   - 录音时用 Web Audio AnalyserNode 驱动竖条波形（绿→红渐变）+ 微信风格气泡提示。
 */
import { useEffect, useRef, useState } from 'react';
import { useUI } from '../store/useUI';
import { requestMedia } from '../lib/webrtc';
import { VOICE_MAX_SECONDS } from '../config';
import Icon from './Icon';

/** 上滑取消的位移阈值（px） */
const CANCEL_DISTANCE = 60;

/** 候选录制 mime：Chromium 用 webm，Safari 用 mp4 */
const MIME_CANDIDATES = ['audio/webm', 'audio/mp4'];

/** 波形竖条数量 */
const BAR_COUNT = 9;

/** 波形竖条颜色：绿 → 黄 → 红渐变 */
const BAR_COLORS = Object.freeze([
  '#07C160',
  '#2FC25B',
  '#57C455',
  '#7FC650',
  '#A7C94B',
  '#CF9F3E',
  '#E89031',
  '#F56A38',
  '#FA5151',
]);

/**
 * 选择当前浏览器支持的录制 mime。
 * @returns {string} 空串表示交给浏览器默认
 */
function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

/** 由 mime 推出文件扩展名 */
function extOf(mime) {
  return mime === 'audio/mp4' ? 'mp4' : 'webm';
}

/**
 * @param {{
 *   onRecord: (file: File, duration: number) => Promise<unknown>,
 *   disabled?: boolean,
 * }} props
 * @returns {JSX.Element}
 */
export default function VoiceRecorder({ onRecord, disabled = false }) {
  const showToast = useUI((state) => state.showToast);
  const [recording, setRecording] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [levels, setLevels] = useState(() => Array(BAR_COUNT).fill(4));

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const mimeRef = useRef('');
  const startAtRef = useRef(0);
  const cancelRef = useRef(false);
  const startYRef = useRef(0);
  const busyRef = useRef(false);
  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const dataRef = useRef(null);
  const rafRef = useRef(null);

  /**
   * 停止音量波形分析：取消 rAF、关闭 AudioContext 并复位波形。
   * @param {{resetLevels?: boolean}} [options]
   * @returns {void}
   */
  const stopAudioMeter = ({ resetLevels = true } = {}) => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const ctx = audioCtxRef.current;
    if (ctx) {
      try {
        ctx.close();
      } catch {
        /* 忽略 */
      }
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    dataRef.current = null;
    if (resetLevels) setLevels(Array(BAR_COUNT).fill(4));
  };

  /**
   * 启动音量波形分析：AudioContext + AnalyserNode，requestAnimationFrame 驱动竖条高度。
   * 浏览器不支持 AudioContext 时静默降级（录音仍正常）。
   * @param {MediaStream} stream 已获取到的麦克风流
   * @returns {void}
   */
  const startAudioMeter = (stream) => {
    stopAudioMeter();
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;

    try {
      const ctx = new Ctor();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(analyser.fftSize);

      const tick = () => {
        const analyserNow = analyserRef.current;
        if (!analyserNow || !dataRef.current) return;

        analyserNow.getByteTimeDomainData(dataRef.current);
        let sum = 0;
        for (let i = 0; i < dataRef.current.length; i += 1) {
          const v = (dataRef.current[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / dataRef.current.length);
        // 映射到 0..1，加增益让波形更明显
        const level = Math.max(0, Math.min(1, rms * 2.8));

        setLevels((prev) => {
          const next = [];
          for (let i = 0; i < BAR_COUNT; i += 1) {
            const wave = 0.5 + 0.5 * Math.sin(Date.now() / 140 + i * 1.1);
            const target = Math.max(3, level * 24 * (0.4 + 0.6 * wave));
            const prevValue = Number(prev[i]) || 3;
            next.push(prevValue + (target - prevValue) * 0.4);
          }
          return next;
        });

        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      stopAudioMeter();
    }
  };

  /**
   * 清理录制资源（含波形分析与麦克风轨道）。
   * @returns {void}
   */
  const cleanup = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    stopAudioMeter();
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          /* 忽略 */
        }
      });
      streamRef.current = null;
    }
  };

  // 组件卸载时释放麦克风与 AudioContext，避免资源泄漏
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const ctx = audioCtxRef.current;
      if (ctx) {
        try {
          ctx.close();
        } catch {
          /* 忽略 */
        }
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      const stream = streamRef.current;
      if (stream) {
        stream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {
            /* 忽略 */
          }
        });
      }
    },
    [],
  );

  /**
   * 开始录音。
   * @param {number} startY 起始 Y 坐标（用于上滑取消判定）
   * @returns {Promise<void>}
   */
  const start = async (startY) => {
    if (recording || busyRef.current || disabled) return;
    try {
      const stream = await requestMedia({ audio: true, video: false });
      const mime = pickMime();
      const options = mime ? { mimeType: mime } : undefined;
      const recorder = new MediaRecorder(stream, options);

      streamRef.current = stream;
      mimeRef.current = mime || 'audio/webm';
      chunksRef.current = [];
      cancelRef.current = false;
      startYRef.current = startY;
      startAtRef.current = Date.now();
      busyRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const elapsed = Math.max(1, Math.round((Date.now() - startAtRef.current) / 1000));
        const file = new Blob(chunksRef.current, { type: mimeRef.current });
        cleanup();
        setRecording(false);
        setCanceling(false);

        if (cancelRef.current || file.size === 0) return;
        const finalFile = new File([file], `voice-${Date.now()}.${extOf(mimeRef.current)}`, { type: mimeRef.current });
        const finalDuration = Math.min(VOICE_MAX_SECONDS, elapsed);
        busyRef.current = true;
        Promise.resolve(onRecord(finalFile, finalDuration))
          .catch((err) => showToast((err && err.message) || '语音发送失败', 'error'))
          .finally(() => {
            busyRef.current = false;
          });
      };

      recorder.start(250);
      recorderRef.current = recorder;
      startAudioMeter(stream);
      setRecording(true);
      setCanceling(false);

      // 60s 自动截断
      timerRef.current = setTimeout(() => {
        if (recorderRef.current && recorderRef.current.state === 'recording') {
          stop();
        }
      }, VOICE_MAX_SECONDS * 1000);
    } catch (err) {
      showToast('无法访问麦克风，请检查权限设置', 'error');
    }
  };

  /**
   * 结束录音（发送或取消）。
   * @returns {void}
   */
  const stop = () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder || recorder.state === 'inactive') return;
    try {
      recorder.stop();
    } catch {
      /* 忽略 */
    }
  };

  /**
   * 按下。
   * @param {number} clientY
   * @returns {void}
   */
  const handleStart = (clientY) => {
    start(clientY);
  };

  /**
   * 移动：上滑超过阈值进入取消态。
   * @param {number} clientY
   * @returns {void}
   */
  const handleMove = (clientY) => {
    if (!recording) return;
    const shouldCancel = startYRef.current - clientY > CANCEL_DISTANCE;
    if (shouldCancel !== cancelRef.current) setCanceling(shouldCancel);
    cancelRef.current = shouldCancel;
  };

  /**
   * 松开：发送或取消。
   * @returns {void}
   */
  const handleEnd = () => {
    if (!recording) return;
    stop();
  };

  return (
    <div className="relative flex h-[44px] items-center justify-center">
      {recording ? (
        <div className="pointer-events-none absolute bottom-[calc(100%+10px)] left-1/2 z-10 -translate-x-1/2">
          <div
            className={`flex flex-col items-center rounded-[8px] px-4 py-2.5 shadow-lg ${
              canceling ? 'bg-[#FA5151]' : 'bg-[#3D3D3D]'
            }`}
          >
            <div className="flex h-[24px] items-center gap-[3px]">
              {levels.map((height, index) => (
                <span
                  key={index}
                  className="w-[3px] rounded-full"
                  style={{
                    height: `${Math.max(3, Math.min(24, height))}px`,
                    backgroundColor: canceling ? 'rgba(255,255,255,0.9)' : BAR_COLORS[index],
                  }}
                />
              ))}
            </div>
            <span className={`mt-1.5 text-[12px] leading-4 ${canceling ? 'text-white' : 'text-white/90'}`}>
              {canceling ? '松开手指，取消发送' : '松开发送，上滑取消'}
            </span>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        disabled={disabled}
        aria-label={recording ? '松开发送' : '按住说话'}
        onPointerDown={(event) => handleStart(event.clientY)}
        onPointerMove={(event) => handleMove(event.clientY)}
        onPointerUp={handleEnd}
        onPointerCancel={handleEnd}
        className={`flex h-[38px] w-full items-center justify-center gap-1 rounded-[6px] text-[14px] font-medium transition-colors ${
          recording ? 'bg-[#E0E0E0] text-[#333]' : 'bg-white text-[#111] active:bg-black/5'
        } ${disabled ? 'opacity-50' : ''}`}
        style={{ touchAction: 'none' }}
      >
        <Icon name="mic" size={18} className={canceling ? 'text-[#FA5151]' : 'text-[#333]'} />
        {recording ? (canceling ? '松开取消' : '松开发送') : '按住说话'}
      </button>
    </div>
  );
}
