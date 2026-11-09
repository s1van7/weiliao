/**
 * 群管理路由（挂在 /api/conversations，全部需要登录）：
 *   PATCH  /:id                        改群名 / 群头像（群主或管理员）
 *   PUT    /:id/announcement           写群公告（群主或管理员，空串=清除）
 *   POST   /:id/announcement/read      标记公告已读（成员）
 *   PATCH  /:id/permissions            三个权限开关（仅群主）
 *   PUT    /:id/members/:uid/role      设 / 取消管理员（仅群主）
 *   DELETE /:id/members/:uid           移除成员（走 groupAuth.assertCanRemove）
 *
 * 本文件不出现任何 role 字符串比较：所有权限判定都调用 lib/groupAuth.js。
 */
import express from 'express';
import { db, now, tx } from '../db.js';
import { httpAuth } from '../auth.js';
import { ApiError, ok, wrap } from '../lib/http.js';
import { isAvatarUrl, toInt } from '../lib/serialize.js';
import { emitToUsers } from '../lib/realtime.js';
import { charLength, conversationDetail, getConversationRow, memberDetails, memberIds } from '../lib/conversations.js';
import { getOrCreateInvite, refreshInvite } from '../lib/groupInvite.js';
import { insertSystemMessage, notifyConversationUpdate } from '../lib/messages.js';
import {
  assertCanAssignRole,
  assertCanManageProfile,
  assertCanRemove,
  parseAssignableRole,
  parseRemovePermission,
  parseSpeakInvitePermission,
  permissionsOf,
  requireMember,
  requireOwner,
} from '../lib/groupAuth.js';

const router = express.Router();

/** 群名称长度上限 */
const GROUP_NAME_MAX = 30;
/** 群公告长度上限 */
const ANNOUNCEMENT_MAX = 500;

/**
 * 解析会话 id 路径参数。
 * @param {unknown} raw 原始参数
 * @returns {number}
 * @throws {ApiError} 400 INVALID_PARAM
 */
function parseConversationId(raw) {
  const id = toInt(raw, 0);
  if (id <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '会话 id 不合法');
  }
  return id;
}

/**
 * 群资料广播体（不发个人化的未读字段，保证一份 payload 可群发）。
 * @param {Record<string, unknown>} conv conversations 行
 * @param {number} memberCount 当前成员数
 * @returns {Record<string, unknown>}
 */
function profileOf(conv, memberCount) {
  return {
    id: Number(conv.id),
    type: conv.type,
    name: conv.name ?? null,
    avatar_url: conv.avatar_url ?? '',
    announcement: conv.announcement ?? '',
    announcement_at: Number(conv.announcement_at ?? 0),
    owner_id: conv.owner_id === null || conv.owner_id === undefined ? null : Number(conv.owner_id),
    member_count: memberCount,
  };
}

/**
 * 群资料变更统一推送：conversation:profile 给指定成员（默认全群）。
 * 必须在事务提交之后调用。
 * @param {number} conversationId 会话 id
 * @param {number[]} [recipients] 接收方 user id 列表
 * @returns {number} 实际推送人数
 */
function broadcastProfile(conversationId, recipients) {
  const conv = getConversationRow(conversationId);
  if (!conv) return 0;
  const targets = Array.isArray(recipients) ? recipients : memberIds(conversationId);
  return emitToUsers(targets, 'conversation:profile', {
    conversation_id: Number(conversationId),
    conversation: profileOf(conv, memberIds(conversationId).length),
  });
}

// 生成 / 刷新群邀请（P0 放开所有群成员，仅 requireMember，不走 assertCanInvite）
router.post(
  '/:id/invite',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const conversationId = parseConversationId(req.params.id);
    requireMember(conversationId, me);

    const refresh = (req.body ?? {}).refresh === true;
    const invite = refresh
      ? refreshInvite(conversationId, me)
      : getOrCreateInvite(conversationId, me);
    return ok(res, invite);
  }),
);

// 改群名 / 群头像（群主或管理员）
router.patch(
  '/:id',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const conversationId = parseConversationId(req.params.id);
    assertCanManageProfile(conversationId, me);

    const body = req.body ?? {};
    const assignments = [];
    const params = [];

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const length = charLength(name);
      if (length < 1 || length > GROUP_NAME_MAX) {
        throw new ApiError(400, 'INVALID_PARAM', `群名称长度需在 1-${GROUP_NAME_MAX} 个字符之间`);
      }
      assignments.push('name = ?');
      params.push(name);
    }

    if (body.avatar_url !== undefined) {
      if (typeof body.avatar_url !== 'string') {
        throw new ApiError(400, 'INVALID_PARAM', '群头像必须是字符串');
      }
      const url = body.avatar_url.trim();
      // 空串表示清除群头像，回落到 2x2 色块
      if (url !== '' && !isAvatarUrl(url)) {
        throw new ApiError(400, 'INVALID_PARAM', '群头像地址必须是 /uploads/ 下的图片路径');
      }
      assignments.push('avatar_url = ?');
      params.push(url);
    }

    if (assignments.length === 0) {
      throw new ApiError(400, 'INVALID_PARAM', '没有可更新的字段');
    }

    params.push(conversationId);
    tx(() => {
      db.prepare(`UPDATE conversations SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    });

    const detail = conversationDetail(conversationId, me);
    broadcastProfile(conversationId);

    return ok(res, { conversation: detail.conversation });
  }),
);

// 写群公告（群主或管理员）
router.put(
  '/:id/announcement',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const conversationId = parseConversationId(req.params.id);
    assertCanManageProfile(conversationId, me);

    const body = req.body ?? {};
    const raw = body.text !== undefined ? body.text : body.announcement;
    if (typeof raw !== 'string') {
      throw new ApiError(400, 'INVALID_PARAM', '公告内容必须是字符串');
    }
    const text = raw.trim();
    if (charLength(text) > ANNOUNCEMENT_MAX) {
      throw new ApiError(400, 'INVALID_PARAM', `公告不能超过 ${ANNOUNCEMENT_MAX} 个字符`);
    }

    const announcementAt = now();
    tx(() => {
      db.prepare('UPDATE conversations SET announcement = ?, announcement_at = ? WHERE id = ?').run(
        text,
        announcementAt,
        conversationId,
      );
    });

    broadcastProfile(conversationId);

    return ok(res, { announcement: text, announcement_at: announcementAt });
  }),
);

// 标记公告已读（成员）
router.post(
  '/:id/announcement/read',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const conversationId = parseConversationId(req.params.id);
    const ctx = requireMember(conversationId, me);

    tx(() => {
      db.prepare(
        'UPDATE conversation_members SET last_read_announcement_at = ? WHERE conversation_id = ? AND user_id = ?',
      ).run(Number(ctx.conv.announcement_at ?? 0), conversationId, me);
    });

    return ok(res, { announcement_unread: false });
  }),
);

// 三个权限开关（仅群主）
router.patch(
  '/:id/permissions',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const conversationId = parseConversationId(req.params.id);
    requireOwner(conversationId, me);

    const body = req.body ?? {};
    const assignments = [];
    const params = [];

    if (body.speak !== undefined) {
      assignments.push('perm_speak = ?');
      params.push(parseSpeakInvitePermission(body.speak, 'speak'));
    }
    if (body.invite !== undefined) {
      assignments.push('perm_invite = ?');
      params.push(parseSpeakInvitePermission(body.invite, 'invite'));
    }
    if (body.remove !== undefined) {
      assignments.push('perm_remove = ?');
      params.push(parseRemovePermission(body.remove));
    }

    if (assignments.length === 0) {
      throw new ApiError(400, 'INVALID_PARAM', '没有可更新的字段');
    }

    params.push(conversationId);
    tx(() => {
      db.prepare(`UPDATE conversations SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    });

    broadcastProfile(conversationId);

    const updated = getConversationRow(conversationId);
    return ok(res, { permissions: permissionsOf({ conv: updated }) });
  }),
);

// 设 / 取消管理员（仅群主）
router.put(
  '/:id/members/:uid/role',
  httpAuth,
  wrap(async (req, res) => {
    const conversationId = parseConversationId(req.params.id);
    const { target } = assertCanAssignRole(conversationId, req.userId, req.params.uid);
    const targetId = Number(target.user_id);
    const role = parseAssignableRole((req.body ?? {}).role);

    tx(() => {
      db.prepare('UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?').run(
        role,
        conversationId,
        targetId,
      );
    });

    const members = memberDetails(conversationId);
    broadcastProfile(
      conversationId,
      members.map((member) => member.user_id),
    );

    return ok(res, { members });
  }),
);

// 移除成员（群主 / 管理员，具体规则见 groupAuth.assertCanRemove）
router.delete(
  '/:id/members/:uid',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const myNickname = String(req.user?.nickname ?? '');
    const conversationId = parseConversationId(req.params.id);
    const ctx = assertCanRemove(conversationId, me, req.params.uid);
    const targetId = Number(ctx.target.user_id);

    const targetRow = db.prepare('SELECT nickname FROM users WHERE id = ?').get(targetId);
    const targetNickname = String(targetRow?.nickname ?? '');

    const outcome = tx(() => {
      db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(
        conversationId,
        targetId,
      );
      // 沿用现有系统消息写法：insertSystemMessage 会累加其余成员未读并刷新会话摘要
      const systemMessage = insertSystemMessage(
        conversationId,
        me,
        `「${myNickname}」将「${targetNickname}」移出了群聊`,
      );
      return { systemMessage, remaining: memberIds(conversationId) };
    });

    broadcastProfile(conversationId, outcome.remaining);
    notifyConversationUpdate(
      conversationId,
      outcome.remaining,
      {
        id: outcome.systemMessage.id,
        type: outcome.systemMessage.type,
        content: outcome.systemMessage.content,
        revoked: outcome.systemMessage.revoked,
        sender_id: outcome.systemMessage.sender_id,
        created_at: outcome.systemMessage.created_at,
        sender_nickname: outcome.systemMessage.sender_nickname,
        sender_avatar_url: outcome.systemMessage.sender_avatar_url,
      },
      outcome.systemMessage.created_at,
    );

    // 通知被移除者：前端据此关闭该会话并从列表移除
    emitToUsers([targetId], 'conversation:removed', {
      conversation_id: conversationId,
      by_user_id: me,
    });

    return ok(res, { removed: true, members: memberDetails(conversationId) });
  }),
);

export default router;
