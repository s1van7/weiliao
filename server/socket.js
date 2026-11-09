/**
 * Socket.IO 实时层。
 *
 * 职责：
 *   1. 握手鉴权（handshake.auth.token）；
 *   2. 连接后加入 user:{id} 与全部 conv:{id} 房间；
 *   3. 在线状态登记与广播（30s 延迟下线由 presence 负责）；
 *   4. 事件：message:send / message:read / typing / conversation:subscribe。
 *
 * 落库逻辑与 REST 完全复用 lib/messages.js，避免两套实现漂移。
 */
import { userFromToken } from './auth.js';
import { ApiError } from './lib/http.js';
import { conversationRoom, setIO, userRoom } from './lib/realtime.js';
import { addSocket, broadcastPresence, isOnline, removeSocket } from './lib/presence.js';
import { assertMember, myConversationIds } from './lib/conversations.js';
import { createMessage, markRead } from './lib/messages.js';
import {
  answerCall,
  cleanupOnDisconnect,
  createConf,
  endConf,
  hangupCall,
  inviteCall,
  joinConf,
  leaveConf,
  rejectCall,
  relayConfAnswer,
  relayConfIce,
  relayConfOffer,
  relayIce,
} from './lib/calls.js';

/**
 * 统一 ack 包装：成功 {ok:true, ...payload}，失败 {ok:false, code, message}。
 * @param {unknown} ack 客户端回执函数
 * @param {() => Record<string, unknown>|void} fn 同步业务逻辑
 */
function respond(ack, fn) {
  const reply = typeof ack === 'function' ? ack : () => {};
  try {
    const payload = fn();
    reply({ ok: true, ...(payload ?? {}) });
  } catch (err) {
    const code = err instanceof ApiError ? err.code : 'INTERNAL_ERROR';
    const message = err && err.message ? String(err.message) : '操作失败';
    if (!(err instanceof ApiError)) {
      console.error('[socket] handler error:', err && err.stack ? err.stack : err);
    }
    reply({ ok: false, code, message });
  }
}

/**
 * 读取事件负载对象（非对象一律按空对象处理）。
 * @param {unknown} payload
 * @returns {Record<string, unknown>}
 */
function asBody(payload) {
  return payload && typeof payload === 'object' ? payload : {};
}

/**
 * 初始化 Socket.IO。
 * @param {import('socket.io').Server} io
 * @returns {import('socket.io').Server}
 */
export function initSocket(io) {
  // 注入事件总线，之后路由层即可通过 realtime 推送
  setIO(io);

  io.use((socket, next) => {
    const token = socket.handshake?.auth?.token;
    const user = userFromToken(token);
    if (!user) {
      return next(new Error('AUTH_INVALID'));
    }
    socket.userId = Number(user.id);
    socket.nickname = user.nickname ?? '';
    return next();
  });

  io.on('connection', (socket) => {
    const uid = Number(socket.userId);
    if (!Number.isInteger(uid) || uid <= 0) {
      socket.disconnect(true);
      return;
    }

    // 1) 个人房间
    socket.join(userRoom(uid));

    // 2) 我参与的所有会话房间
    for (const conversationId of myConversationIds(uid)) {
      socket.join(conversationRoom(conversationId));
    }

    // 3) 在线状态：首个 socket 上线才广播
    const wasOffline = addSocket(uid, socket.id);
    if (wasOffline) {
      broadcastPresence(uid, true);
    }

    console.log(`[socket] connect user=${uid} socket=${socket.id} first=${wasOffline}`);

    // 发送消息（message:new 广播体由 lib/messages.js 的 serializeMessage 统一产出，
    // 已包含 sender_nickname / sender_avatar_color / sender_avatar_url，对端不会看到旧头像）
    socket.on('message:send', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        const { message, duplicate } = createMessage({
          conversationId: body.conversation_id,
          senderId: uid,
          type: body.type,
          content: body.content,
          clientId: body.client_id,
          mentions: body.mentions,
          voiceDuration: body.voice_duration,
          videoDuration: body.video_duration,
          fileName: body.file_name,
          fileSize: body.file_size,
        });
        return { message, duplicate };
      });
    });

    // 会话已读
    socket.on('message:read', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        const result = markRead({
          conversationId: body.conversation_id,
          userId: uid,
          lastMessageId: body.last_message_id,
        });
        return { unread_total: result.unread_total };
      });
    });

    // 正在输入
    socket.on('typing', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        const conversationId = Number(body.conversation_id);
        if (!Number.isInteger(conversationId) || conversationId <= 0) {
          throw new ApiError(400, 'INVALID_PARAM', 'conversation_id 不合法');
        }
        assertMember(conversationId, uid);
        socket.to(conversationRoom(conversationId)).emit('typing', {
          conversation_id: conversationId,
          user_id: uid,
          typing: Boolean(body.typing),
        });
        return {};
      });
    });

    // 订阅会话房间（新建会话后前端可主动订阅）
    socket.on('conversation:subscribe', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        const conversationId = Number(body.conversation_id);
        if (!Number.isInteger(conversationId) || conversationId <= 0) {
          throw new ApiError(400, 'INVALID_PARAM', 'conversation_id 不合法');
        }
        assertMember(conversationId, uid);
        socket.join(conversationRoom(conversationId));
        return {};
      });
    });

    // 主动查询对端在线状态（前端可选使用）
    socket.on('presence:query', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        const userIds = Array.isArray(body.user_ids) ? body.user_ids : [];
        const result = {};
        for (const value of userIds) {
          const targetId = Number(value);
          if (Number.isInteger(targetId) && targetId > 0) {
            result[targetId] = isOnline(targetId);
          }
        }
        return { online: result };
      });
    });

    /* ------------------------- 通话 / 会议信令 ------------------------- */
    // 全部复用 respond 包装 + calls.js 纯函数，服务端只中继，不碰媒体面。

    // 1v1：主叫发起邀请
    socket.on('call:invite', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        return inviteCall({
          callerId: uid,
          targetUserId: body.target_user_id,
          mediaType: body.media_type,
          sdp: body.sdp,
        });
      });
    });

    // 1v1：被叫接听
    socket.on('call:answer', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        return answerCall({ callId: body.call_id, userId: uid, sdp: body.sdp });
      });
    });

    // 1v1：拒绝
    socket.on('call:reject', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        return rejectCall({ callId: body.call_id, userId: uid });
      });
    });

    // 1v1：挂断
    socket.on('call:hangup', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        return hangupCall({ callId: body.call_id, userId: uid });
      });
    });

    // 1v1：ICE trickle
    socket.on('ice:candidate', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        return relayIce({ callId: body.call_id, userId: uid, candidate: body.candidate });
      });
    });

    // 群会议：发起
    socket.on('conf:create', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        return createConf({ conversationId: body.conversation_id, userId: uid, mediaType: body.media_type });
      });
    });

    // 群会议：加入
    socket.on('conf:join', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        return joinConf({ confId: body.conf_id, userId: uid });
      });
    });

    // 群会议：offer
    socket.on('conf:offer', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        return relayConfOffer({
          confId: body.conf_id,
          userId: uid,
          targetUserId: body.target_user_id,
          sdp: body.sdp,
        });
      });
    });

    // 群会议：answer
    socket.on('conf:answer', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        return relayConfAnswer({
          confId: body.conf_id,
          userId: uid,
          targetUserId: body.target_user_id,
          sdp: body.sdp,
        });
      });
    });

    // 群会议：ICE
    socket.on('conf:ice:candidate', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        return relayConfIce({
          confId: body.conf_id,
          userId: uid,
          targetUserId: body.target_user_id,
          candidate: body.candidate,
        });
      });
    });

    // 群会议：离开
    socket.on('conf:leave', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        return leaveConf({ confId: body.conf_id, userId: uid });
      });
    });

    // 群会议：结束
    socket.on('conf:end', (payload, ack) => {
      respond(ack, () => {
        const body = asBody(payload);
        return endConf({ confId: body.conf_id, userId: uid });
      });
    });

    // 断开连接：30s 延迟广播下线
    socket.on('disconnect', (reason) => {
      removeSocket(uid, socket.id, (userId) => {
        broadcastPresence(userId, false);
      });
      // 断开即清理通话 / 会议状态，避免对端悬挂等待
      cleanupOnDisconnect(uid);
      console.log(`[socket] disconnect user=${uid} socket=${socket.id} reason=${reason}`);
    });
  });

  return io;
}

export default initSocket;
