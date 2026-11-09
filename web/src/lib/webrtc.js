/**
 * WebRTC 工具层（不引入任何第三方库，原生 getUserMedia + RTCPeerConnection）。
 *   - requestMedia：采集音视频流（视频默认前置摄像头）；
 *   - createPeerConnection：统一注入 STUN（config.js 唯一来源）；
 *   - 轨道开关 / 流与连接销毁的收尾工具。
 */

import { RTC_ICE_SERVERS } from '../config';

/**
 * 当前环境是否支持 WebRTC。
 * @returns {boolean}
 */
export function supportsWebRTC() {
  return (
    typeof window !== 'undefined' &&
    typeof window.RTCPeerConnection === 'function' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  );
}

/**
 * 采集本地音视频流。
 * @param {{audio?: boolean, video?: boolean}} [options] video=true 时默认前置摄像头
 * @returns {Promise<MediaStream>}
 * @throws {Error} 环境不支持或用户拒绝授权
 */
export async function requestMedia({ audio = true, video = false } = {}) {
  if (!supportsWebRTC()) {
    throw new Error('当前设备不支持音视频采集');
  }
  const constraints = {
    audio: audio ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
    video: video ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false,
  };
  return navigator.mediaDevices.getUserMedia(constraints);
}

/**
 * 创建 RTCPeerConnection（注入动态 ICE，缺省回退 STUN）。
 * @param {Array<{urls: string|string[], username?: string, credential?: string}>} [iceServers] 动态 ICE 服务器列表
 * @returns {RTCPeerConnection}
 * @throws {Error} 环境不支持
 */
export function createPeerConnection(iceServers = RTC_ICE_SERVERS) {
  if (!supportsWebRTC()) {
    throw new Error('当前环境不支持 WebRTC');
  }
  return new RTCPeerConnection({ iceServers: iceServers && iceServers.length > 0 ? iceServers : RTC_ICE_SERVERS });
}

/**
 * 开关流内指定 kind 的轨道（静音 / 关闭摄像头用）。
 * @param {MediaStream|null|undefined} stream
 * @param {'audio'|'video'} kind
 * @param {boolean} enabled
 * @returns {void}
 */
export function setTrackEnabled(stream, kind, enabled) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    if (track.kind === kind) track.enabled = Boolean(enabled);
  }
}

/**
 * 停止流内所有轨道（释放麦克风 / 摄像头）。
 * @param {MediaStream|null|undefined} stream
 * @returns {void}
 */
export function stopStream(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* 忽略 */
    }
  }
}

/**
 * 关闭 PeerConnection（先解绑回调再 close）。
 * @param {RTCPeerConnection|null|undefined} pc
 * @returns {void}
 */
export function closePeer(pc) {
  if (!pc) return;
  try {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.oniceconnectionstatechange = null;
    pc.close();
  } catch {
    /* 忽略 */
  }
}

export default { supportsWebRTC, requestMedia, createPeerConnection, setTrackEnabled, stopStream, closePeer };