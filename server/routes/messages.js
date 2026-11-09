/**
 * 消息相关路由（全部需要登录）：
 *   GET  /api/conversations/:id/messages   历史分页（before_id）或增量（after_id）
 *   POST /api/conversations/:id/messages   发送消息（与 socket 共用落库逻辑）
 *   POST /api/messages/:id/revoke          撤回消息
 *   GET  /api/messages/sync                全局增量同步
 */
import express from 'express';
import { httpAuth } from '../auth.js';
import { ApiError, ok, wrap } from '../lib/http.js';
import { toInt } from '../lib/serialize.js';
import {
  createMessage,
  listMessagesAfter,
  listMessagesBefore,
  revokeMessage,
  syncMessages,
} from '../lib/messages.js';
import { searchMessages } from '../lib/messageSearch.js';

const router = express.Router();

/**
 * 解析会话 id 路径参数。
 * @param {unknown} raw
 * @returns {number}
 */
function parseConversationId(raw) {
  const id = toInt(raw, 0);
  if (id <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '会话 id 不合法');
  }
  return id;
}

// 拉取消息：带 after_id 走增量模式，否则走 before_id 分页模式
router.get(
  '/conversations/:id/messages',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const conversationId = parseConversationId(req.params.id);
    const query = req.query ?? {};

    const hasAfterId = query.after_id !== undefined && query.after_id !== '';
    if (hasAfterId) {
      const result = listMessagesAfter({
        conversationId,
        userId: me,
        afterId: query.after_id,
      });
      return ok(res, { messages: result.messages, has_more: result.has_more });
    }

    const result = listMessagesBefore({
      conversationId,
      userId: me,
      beforeId: query.before_id,
      limit: query.limit,
    });
    return ok(res, { messages: result.messages, has_more: result.has_more });
  }),
);

// 发送消息
router.post(
  '/conversations/:id/messages',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const conversationId = parseConversationId(req.params.id);
    const body = req.body ?? {};

    const { message, duplicate } = createMessage({
      conversationId,
      senderId: me,
      type: body.type,
      content: body.content,
      clientId: body.client_id,
      mentions: body.mentions,
      voiceDuration: body.voice_duration,
      videoDuration: body.video_duration,
      fileName: body.file_name,
      fileSize: body.file_size,
    });

    return ok(res, { message, duplicate });
  }),
);

// 全局增量同步（放在 /messages/:id 之前，避免路径歧义）
router.get(
  '/messages/sync',
  httpAuth,
  wrap(async (req, res) => {
    const query = req.query ?? {};
    const result = syncMessages({
      userId: req.userId,
      afterId: query.after_id,
      limit: query.limit,
    });
    return ok(res, {
      messages: result.messages,
      has_more: result.has_more,
      server_time: result.server_time,
    });
  }),
);

// 消息全文搜索（放在 /messages/:id 之前，避免路径歧义）
router.get(
  '/messages/search',
  httpAuth,
  wrap(async (req, res) => {
    const query = req.query ?? {};
    const result = searchMessages({
      userId: req.userId,
      query: query.q,
      type: query.type,
      beforeId: query.before_id,
      limit: query.limit,
    });
    return ok(res, { results: result.results, has_more: result.has_more });
  }),
);

// 撤回消息
router.post(
  '/messages/:id/revoke',
  httpAuth,
  wrap(async (req, res) => {
    const messageId = toInt(req.params.id, 0);
    if (messageId <= 0) {
      throw new ApiError(400, 'INVALID_PARAM', '消息 id 不合法');
    }

    const message = revokeMessage({ messageId, userId: req.userId });
    return ok(res, { message });
  }),
);

export default router;
