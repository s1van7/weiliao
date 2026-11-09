/**
 * 群会议覆盖层（mesh ≤6）：
 *   - 受邀未加入：显示邀请卡片，可「加入会议」或「拒绝」；
 *   - 会议中：九宫格渲染本地 + 各成员远端视频（无流的成员显示头像），底部控制条。
 */
import { useEffect, useRef } from 'react';
import { useCall } from '../store/useCall';
import { useAuth } from '../store/useAuth';
import { CONF_SOFT_WARN_THRESHOLD } from '../config';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';

/** 挂载 MediaStream 到 video 元素 */
function StreamVideo({ stream, muted = false, mirror = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className="h-full w-full object-cover"
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
    />
  );
}

/**
 * @returns {JSX.Element|null}
 */
export default function ConferencePage() {
  const activeConf = useCall((state) => state.activeConf);
  const joinConference = useCall((state) => state.joinConference);
  const rejectConference = useCall((state) => state.rejectConference);
  const leaveConference = useCall((state) => state.leaveConference);
  const endConference = useCall((state) => state.endConference);
  const toggleMute = useCall((state) => state.toggleMute);
  const toggleCamera = useCall((state) => state.toggleCamera);
  const toggleSpeaker = useCall((state) => state.toggleSpeaker);
  const user = useAuth((state) => state.user);

  if (!activeConf) return null;

  const myId = user ? Number(user.id) : 0;
  const {
    confId,
    initiatorId,
    mediaType = 'video',
    members,
    localStream,
    remoteStreams,
    muted,
    cameraOn,
    speakerOn,
    invited,
    joined,
  } = activeConf;

  const isVoice = mediaType === 'voice';
  const memberCount = Array.isArray(members) ? members.length : 0;
  const overSoftThreshold = memberCount > CONF_SOFT_WARN_THRESHOLD;

  /* ----------------------------- 受邀未加入 ----------------------------- */
  if (invited && !joined) {
    const initiator = members.find((member) => Number(member.user_id) === initiatorId) || null;
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-8">
        <div className="w-full max-w-[320px] rounded-[16px] bg-white p-6 text-center wx-pop">
          <Avatar
            name={initiator ? initiator.nickname : '群成员'}
            color={initiator ? initiator.avatar_color : '#07C160'}
            src={initiator ? initiator.avatar_url : ''}
            size={64}
            radius={10}
          />
          <p className="mt-3 text-[17px] font-semibold text-[#111]">
            {(initiator ? initiator.nickname : '群成员') || '有人'} 邀请你加入会议
          </p>
          <p className="mt-1 text-[12px] text-[#999]">{isVoice ? '语音会议' : '视频会议'}</p>
          <div className="mt-6 flex items-center justify-center gap-8">
            <button type="button" onClick={rejectConference} className="flex flex-col items-center gap-1.5">
              <span className="flex h-[56px] w-[56px] items-center justify-center rounded-full bg-[#FA5151] text-white active:scale-95">
                <Icon name="phoneOff" size={24} />
              </span>
              <span className="text-[12px] text-[#999]">拒绝</span>
            </button>
            <button type="button" onClick={() => joinConference(confId)} className="flex flex-col items-center gap-1.5">
              <span className="flex h-[64px] w-[64px] items-center justify-center rounded-full bg-[#07C160] text-white active:scale-95">
                <Icon name={isVoice ? 'mic' : 'video'} size={26} />
              </span>
              <span className="text-[12px] text-[#999]">加入</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------- 会议中 ------------------------------- */
  const isInitiator = myId > 0 && initiatorId === myId;
  const remoteEntries = Object.entries(remoteStreams || {});

  return (
    <div className="fixed inset-0 z-[80] flex flex-col overflow-hidden bg-[#1A1A1A]">
      {/* 标题 */}
      <div className="shrink-0 pt-4 text-center" style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}>
        <p className="text-[15px] font-medium text-white">
          {isVoice ? '语音会议' : '视频会议'} · {memberCount} 人
        </p>
        {overSoftThreshold ? (
          <p className="mx-auto mt-1 w-fit rounded-full bg-[#FF9F0A]/90 px-3 py-1 text-[11px] leading-4 text-white">
            当前 {memberCount} 人，超过 {CONF_SOFT_WARN_THRESHOLD} 人建议改为语音会议
          </p>
        ) : null}
      </div>

      {/* 画面网格 */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto p-3 md:grid-cols-3">
        {/* 本地画面 */}
        <div className="relative aspect-[3/4] overflow-hidden rounded-[10px] border border-white/20 bg-black">
          {localStream ? (
            <StreamVideo stream={localStream} muted mirror />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Avatar name={user ? user.nickname : '我'} color={user ? user.avatar_color : '#07C160'} src={user ? user.avatar_url : ''} size={64} />
            </div>
          )}
          <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1.5 py-0.5 text-[11px] text-white">我</span>
        </div>

        {/* 远端画面：无流的成员用头像占位 */}
        {members
          .filter((member) => Number(member.user_id) !== myId)
          .map((member) => {
            const uid = Number(member.user_id);
            const stream = remoteStreams && remoteStreams[String(uid)];
            return (
              <div key={uid} className="relative aspect-[3/4] overflow-hidden rounded-[10px] border border-white/20 bg-black">
                {stream ? (
                  <StreamVideo stream={stream} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Avatar name={member.nickname} color={member.avatar_color} src={member.avatar_url} size={64} />
                  </div>
                )}
                <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1.5 py-0.5 text-[11px] text-white">
                  {member.nickname || '成员'}
                </span>
              </div>
            );
          })}

        {remoteEntries
          .filter(([uid]) => !members.some((member) => String(member.user_id) === uid))
          .map(([uid, stream]) => (
            <div key={uid} className="relative aspect-[3/4] overflow-hidden rounded-[10px] border border-white/20 bg-black">
              <StreamVideo stream={stream} />
            </div>
          ))}
      </div>

      {/* 控制条 */}
      <div
        className="flex shrink-0 items-center justify-center gap-7 pb-8 pt-4"
        style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <button type="button" onClick={toggleMute} className="flex flex-col items-center gap-1.5">
          <span className={`flex h-[52px] w-[52px] items-center justify-center rounded-full active:scale-95 ${muted ? 'bg-white text-[#111]' : 'bg-white/15 text-white'}`}>
            <Icon name={muted ? 'micOff' : 'mic'} size={23} />
          </span>
          <span className="text-[12px] text-white/90">{muted ? '已静音' : '静音'}</span>
        </button>
        {!isVoice ? (
          <button type="button" onClick={toggleCamera} className="flex flex-col items-center gap-1.5">
            <span className={`flex h-[52px] w-[52px] items-center justify-center rounded-full active:scale-95 ${!cameraOn ? 'bg-white text-[#111]' : 'bg-white/15 text-white'}`}>
              <Icon name={cameraOn ? 'camera' : 'cameraOff'} size={23} />
            </span>
            <span className="text-[12px] text-white/90">{cameraOn ? '摄像头' : '已关'}</span>
          </button>
        ) : null}
        <button type="button" onClick={toggleSpeaker} className="flex flex-col items-center gap-1.5">
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white/15 text-white active:scale-95">
            <Icon name="speaker" size={23} />
          </span>
          <span className="text-[12px] text-white/90">{speakerOn ? '扬声器' : '听筒'}</span>
        </button>
        {isInitiator ? (
          <button type="button" onClick={endConference} className="flex flex-col items-center gap-1.5">
            <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#FA5151] text-white active:scale-95">
              <Icon name="phoneOff" size={23} />
            </span>
            <span className="text-[12px] text-white/90">结束会议</span>
          </button>
        ) : (
          <button type="button" onClick={leaveConference} className="flex flex-col items-center gap-1.5">
            <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#FA5151] text-white active:scale-95">
              <Icon name="phoneOff" size={23} />
            </span>
            <span className="text-[12px] text-white/90">离开</span>
          </button>
        )}
      </div>
    </div>
  );
}