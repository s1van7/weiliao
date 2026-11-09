/**
 * 1v1 通话覆盖层：来电 / 去电 / 通话中三种状态。
 *   - 视频通话：远端视频铺满 + 本地小窗；语音通话：大头像 + 远端音频；
 *   - 控制：静音 / 摄像头（仅视频）/ 扬声器 / 挂断。
 */
import { useEffect, useRef } from 'react';
import { useCall } from '../store/useCall';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';

/** 挂载 MediaStream 到 video 元素 */
function StreamVideo({ stream, muted = false, mirror = false, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} style={mirror ? { transform: 'scaleX(-1)' } : undefined} />;
}

/** 挂载远端音频（语音通话用） */
function StreamAudio({ stream, speakerOn }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay muted={!speakerOn} />;
}

/**
 * 圆形控制按钮。
 * @param {{icon: string, label: string, onClick: () => void, danger?: boolean, active?: boolean}} props
 * @returns {JSX.Element}
 */
function ControlButton({ icon, label, onClick, danger = false, active = false }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1.5">
      <span
        className={`flex h-[56px] w-[56px] items-center justify-center rounded-full active:scale-95 ${
          danger ? 'bg-[#FA5151] text-white' : active ? 'bg-white text-[#111]' : 'bg-white/15 text-white'
        }`}
      >
        <Icon name={icon} size={24} />
      </span>
      <span className="text-[12px] text-white/90">{label}</span>
    </button>
  );
}

/**
 * @returns {JSX.Element|null}
 */
export default function CallPage() {
  const activeCall = useCall((state) => state.activeCall);
  const acceptCall = useCall((state) => state.acceptCall);
  const rejectCall = useCall((state) => state.rejectCall);
  const hangup = useCall((state) => state.hangup);
  const toggleMute = useCall((state) => state.toggleMute);
  const toggleCamera = useCall((state) => state.toggleCamera);
  const toggleSpeaker = useCall((state) => state.toggleSpeaker);

  if (!activeCall) return null;

  const { status, mediaType, peer, localStream, remoteStream, muted, cameraOn, speakerOn } = activeCall;
  const video = mediaType === 'video';
  const incoming = status === 'incoming';
  const outgoing = status === 'outgoing';
  const peerName = peer ? peer.nickname || '对方' : '对方';

  const statusText = incoming ? '邀请你进行语音/视频通话' : outgoing ? '等待对方接听…' : '通话中';

  return (
    <div className="fixed inset-0 z-[80] flex flex-col overflow-hidden bg-[#1A1A1A]">
      {/* 远端画面 / 头像 */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {video && remoteStream ? (
          <StreamVideo stream={remoteStream} className="h-full w-full object-cover" />
        ) : video ? (
          <div className="flex flex-col items-center gap-4 text-white/80">
            <Avatar name={peerName} color={peer ? peer.avatar_color : '#07C160'} src={peer ? peer.avatar_url : ''} size={96} radius={12} />
            <p className="text-[15px]">{peerName}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-5 px-8 text-white">
            <Avatar name={peerName} color={peer ? peer.avatar_color : '#07C160'} src={peer ? peer.avatar_url : ''} size={120} radius={16} />
            <p className="text-[18px] font-medium">{peerName}</p>
          </div>
        )}

        {/* 本地小窗（视频通话） */}
        {video && localStream ? (
          <div className="absolute bottom-4 right-4 h-[136px] w-[104px] overflow-hidden rounded-[10px] border border-white/30 bg-black">
            <StreamVideo stream={localStream} muted mirror className="h-full w-full object-cover" />
          </div>
        ) : null}

        {/* 状态文案 */}
        <div className="absolute inset-x-0 top-6 text-center">
          <p className="text-[14px] text-white/80">{statusText}</p>
        </div>
      </div>

      {/* 远端音频（语音通话） */}
      {!video && remoteStream ? <StreamAudio stream={remoteStream} speakerOn={speakerOn} /> : null}

      {/* 控制区 */}
      <div
        className="shrink-0 pb-10 pt-4"
        style={{ paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {incoming ? (
          <div className="flex items-center justify-center gap-10">
            <ControlButton icon="phoneOff" label="拒绝" onClick={rejectCall} danger />
            <button type="button" onClick={acceptCall} className="flex flex-col items-center gap-1.5">
              <span className="flex h-[64px] w-[64px] items-center justify-center rounded-full bg-[#07C160] text-white active:scale-95">
                <Icon name="phone" size={26} />
              </span>
              <span className="text-[12px] text-white/90">接听</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-7">
            <ControlButton icon={muted ? 'micOff' : 'mic'} label={muted ? '已静音' : '静音'} onClick={toggleMute} active={muted} />
            {video ? (
              <ControlButton icon={cameraOn ? 'camera' : 'cameraOff'} label={cameraOn ? '摄像头' : '已关'} onClick={toggleCamera} active={!cameraOn} />
            ) : null}
            <ControlButton icon="speaker" label={speakerOn ? '扬声器' : '听筒'} onClick={toggleSpeaker} />
            <ControlButton icon="phoneOff" label="挂断" onClick={hangup} danger />
          </div>
        )}
      </div>
    </div>
  );
}