/**
 * 扫一扫：摄像头取帧 → lib/scan.js 解析二维码 → POST /api/qr/resolve → 跳转到用户资料页。
 * 扫码不静默加好友：只跳转到 userInfo，并把 qr_token 暂存，供用户点「添加」时附带。
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useUI } from '../store/useUI';
import { decodeQrFromVideo } from '../lib/scan';
import PageHeader from '../components/PageHeader';
import Spinner from '../components/Spinner';
import Icon from '../components/Icon';

/** 扫码轮询间隔（毫秒） */
const SCAN_INTERVAL_MS = 800;

/**
 * @param {{embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function ScanPage({ embedded = false }) {
  const back = useUI((state) => state.back);
  const navigate = useUI((state) => state.navigate);
  const showToast = useUI((state) => state.showToast);
  const setQrToken = useUI((state) => state.setQrToken);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const resolvingRef = useRef(false);

  const [starting, setStarting] = useState(true);
  const [error, setError] = useState('');

  /**
   * 停止摄像头与扫码轮询。
   * @returns {void}
   */
  const stop = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  };

  /**
   * 处理扫码结果。
   * @param {string} token
   * @returns {Promise<void>}
   */
  const handleToken = async (token) => {
    if (resolvingRef.current) return;
    const value = String(token || '').trim();

    // 群邀请码：wlgroup:<token> → 进入群邀请入群页
    if (value.startsWith('wlgroup:')) {
      resolvingRef.current = true;
      stop();
      navigate(`groupJoin/${value}`);
      resolvingRef.current = false;
      return;
    }

    resolvingRef.current = true;
    try {
      const data = await api.resolveQr(value);
      const targetId = data.user ? Number(data.user.id) : 0;
      if (!targetId) throw new Error('二维码无效');
      setQrToken(value);
      stop();
      navigate(`userInfo/${targetId}`);
    } catch (err) {
      showToast((err && err.message) || '二维码无效或已失效', 'error');
    } finally {
      resolvingRef.current = false;
    }
  };

  /**
   * 定时取帧扫码。
   * @returns {Promise<void>}
   */
  const tick = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || resolvingRef.current) return;
    const value = await decodeQrFromVideo(video);
    if (value) await handleToken(value);
  };

  useEffect(() => {
    let alive = true;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStarting(false);
      setError('当前环境不支持摄像头扫码');
      return undefined;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        if (!alive) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setStarting(false);
        timerRef.current = setInterval(tick, SCAN_INTERVAL_MS);
      })
      .catch(() => {
        if (!alive) return;
        setStarting(false);
        setError('无法访问摄像头，请检查权限设置');
      });

    return () => {
      alive = false;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const header = embedded ? (
    <div className="flex h-[52px] shrink-0 items-center border-b border-[#E0E0E0] bg-[#F5F5F5] px-4">
      <button
        type="button"
        onClick={back}
        className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
        aria-label="返回"
      >
        <Icon name="back" size={20} className="text-[#111]" />
      </button>
      <h1 className="ml-1 text-[16px] font-semibold text-[#111]">扫一扫</h1>
    </div>
  ) : (
    <PageHeader title="扫一扫" onBack={back} />
  );

  return (
    <div className="flex h-full flex-col bg-black">
      {header}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />

        {/* 扫描框 */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-[240px] w-[240px]">
            <span className="absolute left-0 top-0 h-8 w-8 border-l-2 border-t-2 border-[#07C160]" />
            <span className="absolute right-0 top-0 h-8 w-8 border-r-2 border-t-2 border-[#07C160]" />
            <span className="absolute bottom-0 left-0 h-8 w-8 border-b-2 border-l-2 border-[#07C160]" />
            <span className="absolute bottom-0 right-0 h-8 w-8 border-b-2 border-r-2 border-[#07C160]" />
          </div>
        </div>

        {starting ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <Spinner size={22} className="text-white" />
          </div>
        ) : null}

        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-8 text-center">
            <p className="text-[15px] text-white">{error}</p>
            <button
              type="button"
              onClick={back}
              className="rounded-[6px] bg-[#07C160] px-5 py-2 text-[14px] text-white active:bg-[#06AD56]"
            >
              返回
            </button>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 bg-black py-4 text-center text-[13px] text-white/70">
        将二维码放入框内，即可自动扫描
      </div>
    </div>
  );
}
