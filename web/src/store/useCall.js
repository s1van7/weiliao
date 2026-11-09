/**
 * 通话 / 群会议前端状态机。
 *
 * 数据形态：
 *   activeCall  { callId, status, mediaType, peer, localStream, remoteStream, pc,
 *                 muted, cameraOn, speakerOn, pendingSdp }
 *     status: outgoing | incoming | connected | ended
 *   activeConf  { confId, conversationId, initiatorId, mediaType, members, localStream,
 *                 pcs, remoteStreams, muted, cameraOn, speakerOn, invited, joined }
 *
 * 约定：
 *   - 信令统一走 socket.js 的 emitWithAck（服务端 respond 包装）；
 *   - 1v1 主叫 offer / 被叫 answer；会议新加入者 offer、既有成员 answer；
 *   - 媒体流 / RTCPeerConnection 直接挂进 store，由 CallPage / ConferencePage 渲染。
 */
import { create } from 'zustand';
import { emitWithAck } from '../socket';
import {
  closePeer,
  createPeerConnection,
  requestMedia,
  setTrackEnabled,
  stopStream,
} from '../lib/webrtc';
import { useAuth } from './useAuth';
import { useUI } from './useUI';
import { api } from '../api';
import { RTC_ICE_SERVERS } from '../config';

/**
 * 当前用户 id。
 * @returns {number}
 */
function myId() {
  const user = useAuth.getState().user;
  return user ? Number(user.id) : 0;
}

export const useCall = create((set, get) => ({
  /** 1v1 通话状态 */
  activeCall: null,
  /** 群会议状态 */
  activeConf: null,
  /** 动态 ICE 缓存（服务端 rtcConfig 返回；未就绪时用 RTC_ICE_SERVERS 兜底） */
  iceServers: null,

  /**
   * 确保已缓存动态 ICE：未缓存则拉 /api/rtc-config，失败回退静态 STUN。
   * @returns {Promise<Array<{urls: string|string[], username?: string, credential?: string}>>}
   */
  ensureIceServers: async () => {
    const cached = get().iceServers;
    if (cached && cached.length > 0) return cached;
    try {
      const data = await api.rtcConfig();
      const servers = Array.isArray(data && data.ice_servers) && data.ice_servers.length > 0
        ? data.ice_servers
        : RTC_ICE_SERVERS;
      set({ iceServers: servers });
      return servers;
    } catch (err) {
      console.warn('[call] load rtc config failed, fallback to STUN:', err && err.message);
      set({ iceServers: RTC_ICE_SERVERS });
      return RTC_ICE_SERVERS;
    }
  },

  /* ------------------------------------------------------------------ */
  /* 1v1 通话                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * 主叫发起通话（voice / video）。
   * @param {number|string} peerId 对端用户 id
   * @param {'voice'|'video'} mediaType
   * @returns {Promise<void>}
   */
  startCall: async (peerId, mediaType) => {
    const targetId = Number(peerId);
    if (!targetId || targetId <= 0) throw new Error('对方不存在');
    const type = mediaType === 'video' ? 'video' : 'voice';
    const video = type === 'video';

    const iceServers = await get().ensureIceServers();
    const localStream = await requestMedia({ audio: true, video });
    const pc = createPeerConnection(iceServers);
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    let callId = '';
    const pendingIce = [];
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      if (callId) {
        emitWithAck('ice:candidate', { call_id: callId, candidate: event.candidate }).catch(() => {});
      } else {
        pendingIce.push(event.candidate);
      }
    };
    pc.ontrack = (event) => {
      const remoteStream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
      set((state) => (state.activeCall ? { activeCall: { ...state.activeCall, remoteStream } } : {}));
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    set({
      activeCall: {
        callId: '',
        status: 'outgoing',
        mediaType: type,
        peer: null,
        localStream,
        remoteStream: null,
        pc,
        muted: false,
        cameraOn: video,
        speakerOn: true,
        pendingSdp: null,
      },
    });

    try {
      const reply = await emitWithAck('call:invite', {
        target_user_id: targetId,
        media_type: type,
        sdp: pc.localDescription,
      });
      callId = String(reply.call_id || '');
      set((state) => (state.activeCall ? { activeCall: { ...state.activeCall, callId } } : {}));
      for (const candidate of pendingIce) {
        emitWithAck('ice:candidate', { call_id: callId, candidate }).catch(() => {});
      }
    } catch (err) {
      stopStream(localStream);
      closePeer(pc);
      set({ activeCall: null });
      throw err;
    }
  },

  /**
   * 处理来电邀请（服务端 call:invite）。
   * @param {{call_id:string, caller:object, media_type:string, sdp:object}|null} payload
   * @returns {void}
   */
  handleInvite: (payload) => {
    if (!payload || !payload.call_id) return;
    // 已有通话 / 会议：自动拒绝新来电，避免状态互相覆盖
    if (get().activeCall || get().activeConf) {
      emitWithAck('call:reject', { call_id: payload.call_id }).catch(() => {});
      return;
    }
    const video = payload.media_type === 'video';
    set({
      activeCall: {
        callId: String(payload.call_id),
        status: 'incoming',
        mediaType: video ? 'video' : 'voice',
        peer: payload.caller || null,
        localStream: null,
        remoteStream: null,
        pc: null,
        muted: false,
        cameraOn: video,
        speakerOn: true,
        pendingSdp: payload.sdp || null,
      },
    });
  },

  /**
   * 被叫接听。
   * @returns {Promise<void>}
   */
  acceptCall: async () => {
    const call = get().activeCall;
    if (!call || call.status !== 'incoming') return;
    const video = call.mediaType === 'video';

    try {
      const iceServers = await get().ensureIceServers();
      const localStream = await requestMedia({ audio: true, video });
      const pc = createPeerConnection(iceServers);
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

      const callId = call.callId;
      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        emitWithAck('ice:candidate', { call_id: callId, candidate: event.candidate }).catch(() => {});
      };
      pc.ontrack = (event) => {
        const remoteStream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
        set((state) => (state.activeCall ? { activeCall: { ...state.activeCall, remoteStream } } : {}));
      };

      await pc.setRemoteDescription(call.pendingSdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await emitWithAck('call:answer', { call_id: callId, sdp: pc.localDescription });

      set((state) =>
        state.activeCall
          ? {
              activeCall: {
                ...state.activeCall,
                localStream,
                pc,
                status: 'connected',
                cameraOn: video,
                pendingSdp: null,
              },
            }
          : {},
      );
    } catch (err) {
      useUI.getState().showToast((err && err.message) || '接听失败', 'error');
      get()._teardownCall();
    }
  },

  /**
   * 处理被叫 answer（主叫收到）。
   * @param {{call_id:string, callee:object, sdp:object}|null} payload
   * @returns {Promise<void>}
   */
  handleAnswer: async (payload) => {
    const call = get().activeCall;
    if (!call || !payload || String(payload.call_id) !== call.callId || !call.pc) return;
    try {
      await call.pc.setRemoteDescription(payload.sdp);
      set((state) =>
        state.activeCall
          ? { activeCall: { ...state.activeCall, status: 'connected', peer: payload.callee || state.activeCall.peer } }
          : {},
      );
    } catch (err) {
      console.warn('[call] set remote answer failed:', err && err.message);
    }
  },

  /**
   * 处理通话被拒绝。
   * @param {{call_id:string, by_user_id:number}|null} payload
   * @returns {void}
   */
  handleReject: (payload) => {
    const call = get().activeCall;
    if (!call || !payload || String(payload.call_id) !== call.callId) return;
    get()._teardownCall();
    useUI.getState().showToast('对方已拒绝');
  },

  /**
   * 处理对端挂断。
   * @param {{call_id:string, by_user_id:number}|null} payload
   * @returns {void}
   */
  handleHangup: (payload) => {
    const call = get().activeCall;
    if (!call || !payload || String(payload.call_id) !== call.callId) return;
    get()._teardownCall();
    useUI.getState().showToast('对方已挂断');
  },

  /**
   * 处理 1v1 ICE candidate。
   * @param {{call_id:string, candidate:object}|null} payload
   * @returns {void}
   */
  handleIce: (payload) => {
    const call = get().activeCall;
    if (!call || !call.pc || !payload || String(payload.call_id) !== call.callId || !payload.candidate) return;
    try {
      call.pc.addIceCandidate(payload.candidate);
    } catch (err) {
      console.warn('[call] add ice candidate failed:', err && err.message);
    }
  },

  /**
   * 拒绝来电（本地主动）。
   * @returns {Promise<void>}
   */
  rejectCall: async () => {
    const call = get().activeCall;
    if (!call) return;
    if (call.status === 'incoming' && call.callId) {
      emitWithAck('call:reject', { call_id: call.callId }).catch(() => {});
    }
    get()._teardownCall();
  },

  /**
   * 挂断（本地主动）。
   * @returns {Promise<void>}
   */
  hangup: async () => {
    const call = get().activeCall;
    if (!call) return;
    if (call.callId) {
      emitWithAck('call:hangup', { call_id: call.callId }).catch(() => {});
    }
    get()._teardownCall();
  },

  /**
   * 内部：销毁 1v1 通话资源。
   * @returns {void}
   */
  _teardownCall: () => {
    const call = get().activeCall;
    if (call) {
      stopStream(call.localStream);
      closePeer(call.pc);
    }
    set({ activeCall: null });
  },

  /* ------------------------------------------------------------------ */
  /* 群会议（mesh）                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * 发起群会议（voice|video，缺省 video）。
   * @param {number|string} conversationId 群会话 id
   * @param {'voice'|'video'} [mediaType]
   * @returns {Promise<void>}
   */
  startConference: async (conversationId, mediaType = 'video') => {
    const convId = Number(conversationId);
    if (!convId || convId <= 0) throw new Error('群聊不存在');

    const type = mediaType === 'voice' ? 'voice' : 'video';
    const video = type === 'video';
    await get().ensureIceServers();
    const localStream = await requestMedia({ audio: true, video });
    try {
      const reply = await emitWithAck('conf:create', { conversation_id: convId, media_type: type });
      set({
        activeConf: {
          confId: String(reply.conf_id || ''),
          conversationId: convId,
          initiatorId: myId(),
          mediaType: type,
          members: reply.members || [],
          localStream,
          pcs: {},
          remoteStreams: {},
          muted: false,
          cameraOn: video,
          speakerOn: true,
          invited: false,
          joined: true,
        },
      });
    } catch (err) {
      stopStream(localStream);
      throw err;
    }
  },

  /**
   * 处理会议邀请（服务端 conf:invite）。
   * @param {{conf_id:string, conversation_id:number, initiator:object, members:Array}|null} payload
   * @returns {void}
   */
  handleConfInvite: (payload) => {
    if (!payload || !payload.conf_id) return;
    // 已在通话 / 会议中则忽略（MVP 不做并发会话）
    if (get().activeCall || get().activeConf) return;
    const video = payload.media_type === 'video';
    set({
      activeConf: {
        confId: String(payload.conf_id),
        conversationId: Number(payload.conversation_id) || 0,
        initiatorId: Number(payload.initiator && payload.initiator.user_id) || 0,
        mediaType: video ? 'video' : 'voice',
        members: payload.members || [],
        localStream: null,
        pcs: {},
        remoteStreams: {},
        muted: false,
        cameraOn: video,
        speakerOn: true,
        invited: true,
        joined: false,
      },
    });
  },

  /**
   * 加入会议（作为新加入者：向每个既有成员发起 offer）。
   * @param {string} [confId] 缺省用当前 activeConf.confId
   * @returns {Promise<void>}
   */
  joinConference: async (confId) => {
    const current = get().activeConf;
    const id = String(confId || (current && current.confId) || '');
    if (!id) return;

    const video = !current || current.mediaType !== 'voice';
    try {
      await get().ensureIceServers();
      const localStream = await requestMedia({ audio: true, video });
      const reply = await emitWithAck('conf:join', { conf_id: id });
      const members = reply.members || [];
      set((state) => {
        const base = state.activeConf || {
          confId: id,
          conversationId: 0,
          initiatorId: 0,
          mediaType: video ? 'video' : 'voice',
          members: [],
          localStream,
          pcs: {},
          remoteStreams: {},
          muted: false,
          cameraOn: video,
          speakerOn: true,
          invited: false,
          joined: true,
        };
        return {
          activeConf: {
            ...base,
            confId: id,
            initiatorId: Number(reply.initiator_id) || base.initiatorId,
            mediaType: reply.media_type === 'voice' ? 'voice' : 'video',
            members,
            localStream,
            invited: false,
            joined: true,
          },
        };
      });

      // mesh：新加入者向每个既有成员 offer
      const me = myId();
      for (const member of members) {
        const uid = Number(member.user_id);
        if (!uid || uid === me) continue;
        await get()._confOffer(id, uid, localStream);
      }
    } catch (err) {
      useUI.getState().showToast((err && err.message) || '加入会议失败', 'error');
      get()._teardownConf();
    }
  },

  /**
   * 内部：为指定成员创建（或复用）PeerConnection。
   * @param {string} confId
   * @param {number} targetId
   * @param {MediaStream|null} [localStream]
   * @returns {RTCPeerConnection|null}
   */
  _confEnsurePc: (confId, targetId, localStream) => {
    const conf = get().activeConf;
    if (!conf) return null;
    const key = String(targetId);
    if (conf.pcs && conf.pcs[key]) return conf.pcs[key];

    const pc = createPeerConnection(get().iceServers || RTC_ICE_SERVERS);
    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      emitWithAck('conf:ice:candidate', { conf_id: confId, target_user_id: targetId, candidate: event.candidate }).catch(
        () => {},
      );
    };
    pc.ontrack = (event) => {
      const remoteStream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
      set((state) => {
        if (!state.activeConf) return {};
        return {
          activeConf: {
            ...state.activeConf,
            remoteStreams: { ...(state.activeConf.remoteStreams || {}), [key]: remoteStream },
          },
        };
      });
    };

    set((state) => {
      if (!state.activeConf) return {};
      return { activeConf: { ...state.activeConf, pcs: { ...(state.activeConf.pcs || {}), [key]: pc } } };
    });
    return pc;
  },

  /**
   * 内部：向指定成员发起 offer。
   * @param {string} confId
   * @param {number} targetId
   * @param {MediaStream|null} [localStream]
   * @returns {Promise<void>}
   */
  _confOffer: async (confId, targetId, localStream) => {
    const pc = get()._confEnsurePc(confId, targetId, localStream);
    if (!pc) return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await emitWithAck('conf:offer', { conf_id: confId, target_user_id: targetId, sdp: pc.localDescription });
    } catch (err) {
      console.warn('[call] conf offer failed:', err && err.message);
    }
  },

  /**
   * 处理 conf:offer（既有成员收到新加入者的 offer，回 answer）。
   * @param {{conf_id:string, from_user_id:number, sdp:object}|null} payload
   * @returns {Promise<void>}
   */
  handleConfOffer: async (payload) => {
    if (!payload || !payload.conf_id) return;
    const conf = get().activeConf;
    if (!conf || String(conf.confId) !== String(payload.conf_id) || !conf.joined) return;
    const fromId = Number(payload.from_user_id);
    if (!fromId) return;

    const pc = get()._confEnsurePc(conf.confId, fromId, conf.localStream);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(payload.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await emitWithAck('conf:answer', { conf_id: conf.confId, target_user_id: fromId, sdp: pc.localDescription });
    } catch (err) {
      console.warn('[call] conf answer failed:', err && err.message);
    }
  },

  /**
   * 处理 conf:answer（新加入者收到既有成员的 answer）。
   * @param {{conf_id:string, from_user_id:number, sdp:object}|null} payload
   * @returns {Promise<void>}
   */
  handleConfAnswer: async (payload) => {
    if (!payload || !payload.conf_id) return;
    const conf = get().activeConf;
    if (!conf || String(conf.confId) !== String(payload.conf_id)) return;
    const fromId = Number(payload.from_user_id);
    const pc = conf.pcs && conf.pcs[String(fromId)];
    if (!pc) return;
    try {
      await pc.setRemoteDescription(payload.sdp);
    } catch (err) {
      console.warn('[call] set remote conf answer failed:', err && err.message);
    }
  },

  /**
   * 处理 conf:ice:candidate。
   * @param {{conf_id:string, from_user_id:number, candidate:object}|null} payload
   * @returns {void}
   */
  handleConfIce: (payload) => {
    if (!payload || !payload.conf_id) return;
    const conf = get().activeConf;
    if (!conf || String(conf.confId) !== String(payload.conf_id) || !payload.candidate) return;
    const fromId = Number(payload.from_user_id);
    const pc = conf.pcs && conf.pcs[String(fromId)];
    if (!pc) return;
    try {
      pc.addIceCandidate(payload.candidate);
    } catch (err) {
      console.warn('[call] add conf ice candidate failed:', err && err.message);
    }
  },

  /**
   * 处理 conf:join（成员列表更新）。
   * @param {{conf_id:string, user:object, members:Array}|null} payload
   * @returns {void}
   */
  handleConfJoin: (payload) => {
    if (!payload || !payload.conf_id) return;
    const conf = get().activeConf;
    if (!conf || String(conf.confId) !== String(payload.conf_id)) return;
    const members = payload.members || conf.members;
    set((state) => (state.activeConf ? { activeConf: { ...state.activeConf, members } } : {}));
  },

  /**
   * 处理 conf:leave（移除成员的连接与流）。
   * @param {{conf_id:string, user_id:number}|null} payload
   * @returns {void}
   */
  handleConfLeave: (payload) => {
    if (!payload || !payload.conf_id) return;
    const conf = get().activeConf;
    if (!conf || String(conf.confId) !== String(payload.conf_id)) return;
    get()._confRemovePeer(payload.conf_id, Number(payload.user_id));
  },

  /**
   * 处理 conf:end（会议结束）。
   * @param {{conf_id:string, by_user_id:number}|null} payload
   * @returns {void}
   */
  handleConfEnd: (payload) => {
    if (!payload || !payload.conf_id) return;
    const conf = get().activeConf;
    if (!conf || String(conf.confId) !== String(payload.conf_id)) return;
    get()._teardownConf();
    useUI.getState().showToast('会议已结束');
  },

  /**
   * 内部：移除某个会议成员的连接与远端流。
   * @param {string} confId
   * @param {number} userId
   * @returns {void}
   */
  _confRemovePeer: (confId, userId) => {
    const uid = Number(userId);
    if (!uid) return;
    set((state) => {
      if (!state.activeConf) return {};
      const pcs = { ...(state.activeConf.pcs || {}) };
      const remoteStreams = { ...(state.activeConf.remoteStreams || {}) };
      const key = String(uid);
      if (pcs[key]) {
        closePeer(pcs[key]);
        delete pcs[key];
      }
      if (remoteStreams[key]) delete remoteStreams[key];
      const members = (state.activeConf.members || []).filter((member) => Number(member.user_id) !== uid);
      return { activeConf: { ...state.activeConf, pcs, remoteStreams, members } };
    });
  },

  /**
   * 拒绝会议邀请（尚未加入，直接关闭覆盖层）。
   * @returns {void}
   */
  rejectConference: () => {
    get()._teardownConf();
  },

  /**
   * 离开会议。
   * @returns {Promise<void>}
   */
  leaveConference: async () => {
    const conf = get().activeConf;
    if (!conf) return;
    if (conf.joined && conf.confId) {
      emitWithAck('conf:leave', { conf_id: conf.confId }).catch(() => {});
    }
    get()._teardownConf();
  },

  /**
   * 结束会议。
   * @returns {Promise<void>}
   */
  endConference: async () => {
    const conf = get().activeConf;
    if (!conf) return;
    if (conf.confId) {
      emitWithAck('conf:end', { conf_id: conf.confId }).catch(() => {});
    }
    get()._teardownConf();
  },

  /**
   * 内部：销毁会议全部资源。
   * @returns {void}
   */
  _teardownConf: () => {
    const conf = get().activeConf;
    if (conf) {
      stopStream(conf.localStream);
      for (const pc of Object.values(conf.pcs || {})) closePeer(pc);
    }
    set({ activeConf: null });
  },

  /* ------------------------------------------------------------------ */
  /* 通用控制                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * 切换静音（通话与会议共用）。
   * @returns {void}
   */
  toggleMute: () => {
    const call = get().activeCall;
    const conf = get().activeConf;
    if (call) {
      const muted = !call.muted;
      setTrackEnabled(call.localStream, 'audio', !muted);
      set((state) => (state.activeCall ? { activeCall: { ...state.activeCall, muted } } : {}));
    } else if (conf) {
      const muted = !conf.muted;
      setTrackEnabled(conf.localStream, 'audio', !muted);
      set((state) => (state.activeConf ? { activeConf: { ...state.activeConf, muted } } : {}));
    }
  },

  /**
   * 切换摄像头（仅视频通话 / 会议）。
   * @returns {void}
   */
  toggleCamera: () => {
    const call = get().activeCall;
    const conf = get().activeConf;
    if (call) {
      const cameraOn = !call.cameraOn;
      setTrackEnabled(call.localStream, 'video', cameraOn);
      set((state) => (state.activeCall ? { activeCall: { ...state.activeCall, cameraOn } } : {}));
    } else if (conf) {
      const cameraOn = !conf.cameraOn;
      setTrackEnabled(conf.localStream, 'video', cameraOn);
      set((state) => (state.activeConf ? { activeConf: { ...state.activeConf, cameraOn } } : {}));
    }
  },

  /**
   * 切换扬声器（前端渲染层据此 muted 远端音频元素）。
   * @returns {void}
   */
  toggleSpeaker: () => {
    const call = get().activeCall;
    const conf = get().activeConf;
    if (call) {
      set((state) =>
        state.activeCall ? { activeCall: { ...state.activeCall, speakerOn: !state.activeCall.speakerOn } } : {},
      );
    } else if (conf) {
      set((state) =>
        state.activeConf ? { activeConf: { ...state.activeConf, speakerOn: !state.activeConf.speakerOn } } : {},
      );
    }
  },
}));

export default useCall;