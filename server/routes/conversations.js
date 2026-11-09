/**
 * 会话相关路由（全部需要登录）：
 *   GET    /api/conversations                     会话列表
 *   PATCH  /api/conversations/:id/prefs           会话偏好（置顶/隐藏/标记未读/删除聊天）
 *   POST   /api/conversations/single              创建/复用单聊
 *   POST   /api/conversations/group               创建群聊
 *   GET    /api/conversations/:id                 会话详情（含成员）
 *   POST   /api/conversations/:id/members         拉人入群
 *   DELETE /api/conversations/:id/members/me      退群
 *   POST   /api/conversations/:id/read            会话已读
 *   GET    /api/unread/total                      未读总数
 */
import express from 'express';
import { db, now, tx } from '../db.js';
import { httpAuth } from '../auth.js';
import { ApiError, ok, wrap } from '../lib/http.js';
import { toInt } from '../lib/serialize.js';
import { isMediaUrl } from '../lib/media.js';
import { emitToUser, emitToUsers } from '../lib/realtime.js';
import {
  areFriends,
  assertMember,
  conversationDetail,
  createGroupConversation,
  ensurePairConversation,
  friendIdSet,
  getConversationRow,
  getMemberRow,
  GROUP_MAX_MEMBERS,
  memberIds,
  summarizeConversation,
  unreadTotal,
} from '../lib/conversations.js';
import { isBlocked } from '../lib/friendPermissions.js';
import { assertCanInvite, isOwner } from '../lib/groupAuth.js';
import { insertSystemMessage, markRead, notifyConversationUpdate } from '../lib/messages.js';

const router = express.Router();

/**
 * 解析 id 数组参数：必须是数组，元素去重、剔除自己与非法值。
 * @param {unknown} value
 * @param {number} selfId
 * @returns {number[]}
 */
function parseUserIdList(value, selfId) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'INVALID_PARAM', 'member_ids / user_ids 必须是数组');
  }
  const unique = new Set();
  for (const item of value) {
    const id = toInt(item, 0);
    if (id <= 0) {
      throw new ApiError(400, 'INVALID_PARAM', '成员 id 不合法');
    }
    if (id !== selfId) unique.add(id);
  }
  return [...unique];
}

/**
 * 会话列表基础查询片段：会话自身字段 + 本人成员行上的偏好字段。
 * 统一用 mine. 前缀区分「我的偏好」与「会话本身」。
 */
const CONVERSATION_ROW_SELECT = `SELECT c.id, c.type, c.name, c.avatar_url, c.owner_id, c.last_message_at,
                                        c.allow_non_friend_send,
                                        mine.unread_count, mine.mentioned, mine.background_url,
                                        mine.pinned, mine.hidden, mine.hidden_at,
                                        mine.cleared_before_id, mine.manual_unread, mine.muted
                                   FROM conversation_members mine
                                   JOIN conversations c ON c.id = mine.conversation_id`;

/**
 * 取会话基础行。
 * @param {number} me 当前用户 id
 * @param {number} [conversationId] 传入时只取该会话（含已隐藏的，供偏好接口回显）
 * @returns {Array<Record<string, unknown>>}
 */
function selectConversationRows(me, conversationId = 0) {
  const convId = toInt(conversationId, 0);
  if (convId > 0) {
    return db.prepare(`${CONVERSATION_ROW_SELECT} WHERE mine.user_id = ? AND c.id = ?`).all(me, convId);
  }
  // 隐藏过滤：隐藏之后又有新消息（last_message_at > hidden_at）则重新浮现
  // 排序：置顶优先 → 最近消息时间倒序 → id 倒序
  return db
    .prepare(
      `${CONVERSATION_ROW_SELECT}
        WHERE mine.user_id = ?
          AND (mine.hidden = 0 OR c.last_message_at > mine.hidden_at)
        ORDER BY mine.pinned DESC, c.last_message_at DESC, c.id DESC`,
    )
    .all(me);
}

/**
 * 把基础行组装成前端消费的会话列表项（批量补成员数 / 单聊对方 / 最新消息）。
 * @param {number} me 当前用户 id
 * @param {Array<Record<string, unknown>>} rows selectConversationRows 的结果
 * @returns {Array<Record<string, unknown>>}
 */
function buildConversationEntries(me, rows) {
  if (rows.length === 0) return [];

  const conversationIds = rows.map((row) => Number(row.id));
  const placeholders = conversationIds.map(() => '?').join(', ');

  // 成员数（子查询）
  const countRows = db
    .prepare(
      `SELECT conversation_id, COUNT(*) AS total
         FROM conversation_members
        WHERE conversation_id IN (${placeholders})
        GROUP BY conversation_id`,
    )
    .all(...conversationIds);
  const countMap = new Map(countRows.map((row) => [Number(row.conversation_id), Number(row.total)]));

  // 单聊对方（附带我的备注名，展示名 = remark_name || nickname）
  const peerRows = db
    .prepare(
      `SELECT cm.conversation_id AS conversation_id, u.id, u.nickname, u.avatar_color, u.avatar_url,
              fn.remark_name AS remark_name
         FROM conversation_members cm
         JOIN users u ON u.id = cm.user_id
         LEFT JOIN friend_notes fn ON fn.owner_id = ? AND fn.friend_id = u.id
        WHERE cm.conversation_id IN (${placeholders}) AND cm.user_id <> ?`,
    )
    .all(me, ...conversationIds, me);
  const peerMap = new Map(
    peerRows.map((row) => [
      Number(row.conversation_id),
      {
        id: Number(row.id),
        nickname: row.nickname ?? '',
        avatar_color: row.avatar_color ?? '#07C160',
        avatar_url: row.avatar_url ?? '',
        remark_name: String(row.remark_name ?? '').trim(),
      },
    ]),
  );

  // 每会话最新一条消息
  const lastRows = db
    .prepare(
      `SELECT m.id, m.conversation_id, m.type, m.content, m.revoked, m.sender_id, m.created_at,
              u.nickname AS sender_nickname, u.avatar_color AS sender_avatar_color,
              u.avatar_url AS sender_avatar_url
         FROM messages m
         JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id IN (${placeholders})
          AND m.id = (SELECT MAX(m2.id) FROM messages m2 WHERE m2.conversation_id = m.conversation_id)`,
    )
    .all(...conversationIds);
  const lastMap = new Map(
    lastRows.map((row) => [
      Number(row.conversation_id),
      {
        id: Number(row.id),
        type: row.type,
        content: Number(row.revoked ?? 0) === 1 ? '' : String(row.content ?? ''),
        revoked: Number(row.revoked ?? 0) === 1 ? 1 : 0,
        sender_id: Number(row.sender_id),
        created_at: Number(row.created_at),
        sender_nickname: row.sender_nickname ?? '',
        sender_avatar_color: row.sender_avatar_color ?? '#07C160',
        sender_avatar_url: row.sender_avatar_url ?? '',
      },
    ]),
  );

  // 我的好友集合：单聊里对方已不是好友时会话转为只读
  const friendIds = friendIdSet(me);

  return rows.map((row) => {
    const conversationId = Number(row.id);
    const peer = row.type === 'single' ? peerMap.get(conversationId) ?? null : null;
    return {
      id: conversationId,
      type: row.type,
      name: row.name ?? null,
      avatar_url: row.avatar_url ?? '',
      owner_id: row.owner_id === null || row.owner_id === undefined ? null : Number(row.owner_id),
      last_message_at: Number(row.last_message_at ?? 0),
      unread_count: Number(row.unread_count ?? 0),
      // 有人 @我 的未读提醒：进入会话 markRead 后由 lib/messages.js 清零
      mentioned: Number(row.mentioned ?? 0) === 1,
      member_count: countMap.get(conversationId) ?? 0,
      // 本人聊天背景（用户级，存 conversation_members.background_url）
      background_url: String(row.background_url ?? ''),
      // 本人会话偏好：置顶 / 手动标记未读 / 删除聊天时的消息清除边界
      pinned: Number(row.pinned ?? 0) === 1,
      manual_unread: Number(row.manual_unread ?? 0) === 1,
      // 消息免打扰：不响铃、不弹通知；列表未读改为小红点
      muted: Number(row.muted ?? 0) === 1,
      cleared_before_id: Number(row.cleared_before_id ?? 0) || 0,
      peer,
      // 单聊只读：拉黑恒只读；非好友仅在 allow_non_friend_send=1 时临时放行；群聊恒可写
      readonly:
        row.type === 'single'
          ? Boolean(
              peer &&
                (isBlocked(me, peer.id) ||
                  (!friendIds.has(peer.id) && Number(row.allow_non_friend_send ?? 0) !== 1)),
            )
          : false,
      last_message: lastMap.get(conversationId) ?? null,
    };
  });
}

// 会话列表：只返回本人是成员、且未隐藏（或隐藏后又有新消息）的会话
router.get(
  '/conversations',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const rows = selectConversationRows(me);
    return ok(res, { conversations: buildConversationEntries(me, rows) });
  }),
);

// 会话个人偏好：置顶 / 隐藏 / 标记未读 / 删除聊天（只写本人成员行）
router.patch(
  '/conversations/:id/prefs',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const conversationId = toInt(req.params.id, 0);
    if (conversationId <= 0) {
      throw new ApiError(400, 'INVALID_PARAM', '会话 id 不合法');
    }
    assertMember(conversationId, me);

    const body = req.body ?? {};
    const hasPinned = typeof body.pinned === 'boolean';
    const hasHidden = typeof body.hidden === 'boolean';
    const hasUnread = typeof body.unread === 'boolean';
    const hasMuted = typeof body.muted === 'boolean';
    const clear = body.clear === true;

    if (!hasPinned && !hasHidden && !hasUnread && !hasMuted && !clear) {
      throw new ApiError(400, 'INVALID_PARAM', 'pinned / hidden / unread / muted / clear 至少传入一个');
    }

    tx(() => {
      const timestamp = now();
      if (hasPinned) {
        db.prepare('UPDATE conversation_members SET pinned = ? WHERE conversation_id = ? AND user_id = ?').run(
          body.pinned ? 1 : 0,
          conversationId,
          me,
        );
      }
      if (hasHidden) {
        if (body.hidden) {
          db.prepare(
            'UPDATE conversation_members SET hidden = 1, hidden_at = ? WHERE conversation_id = ? AND user_id = ?',
          ).run(timestamp, conversationId, me);
        } else {
          // 取消隐藏：清空时间戳，会话按原有的最近消息时间重新出现在列表
          db.prepare(
            'UPDATE conversation_members SET hidden = 0, hidden_at = 0 WHERE conversation_id = ? AND user_id = ?',
          ).run(conversationId, me);
        }
      }
      if (clear) {
        // 删除聊天：隐藏会话 + 记录清除边界（历史只保留此 id 之后的消息）+ 清空未读
        db.prepare(
          `UPDATE conversation_members
              SET hidden = 1,
                  hidden_at = ?,
                  cleared_before_id = (SELECT COALESCE(MAX(id), 0) FROM messages WHERE conversation_id = ?),
                  unread_count = 0,
                  manual_unread = 0,
                  mentioned = 0
            WHERE conversation_id = ? AND user_id = ?`,
        ).run(timestamp, conversationId, conversationId, me);
      }
      if (hasUnread) {
        db.prepare(
          'UPDATE conversation_members SET manual_unread = ? WHERE conversation_id = ? AND user_id = ?',
        ).run(body.unread ? 1 : 0, conversationId, me);
      }
      if (hasMuted) {
        db.prepare(
          'UPDATE conversation_members SET muted = ? WHERE conversation_id = ? AND user_id = ?',
        ).run(body.muted ? 1 : 0, conversationId, me);
      }
    });

    const member = getMemberRow(conversationId, me);
    const prefs = {
      conversation_id: conversationId,
      pinned: Number(member?.pinned ?? 0) === 1,
      hidden: Number(member?.hidden ?? 0) === 1,
      manual_unread: Number(member?.manual_unread ?? 0) === 1,
      muted: Number(member?.muted ?? 0) === 1,
    };

    // 只推给自己（本人的其他在线端），不影响会话其他成员
    emitToUser(me, 'conversation:prefs', prefs);

    const conversation = buildConversationEntries(me, selectConversationRows(me, conversationId))[0] ?? null;

    return ok(res, { conversation, prefs });
  }),
);

// 创建（或复用）单聊会话：必须是好友
router.post(
  '/conversations/single',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const body = req.body ?? {};
    const otherId = toInt(body.user_id, 0);

    if (otherId <= 0) {
      throw new ApiError(400, 'INVALID_PARAM', 'user_id 不合法');
    }
    if (otherId === me) {
      throw new ApiError(400, 'INVALID_PARAM', '不能与自己创建会话');
    }

    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(otherId);
    if (!target) {
      throw new ApiError(404, 'NOT_FOUND', '目标用户不存在');
    }
    if (!areFriends(me, otherId)) {
      throw new ApiError(403, 'NOT_FRIEND', '只能与好友创建单聊');
    }

    const conversationId = tx(() => ensurePairConversation(me, otherId));
    return ok(res, { conversation_id: conversationId });
  }),
);

// 创建群聊：支持好友多选（默认）与「从已有群聊建群」（source_group_id）
router.post(
  '/conversations/group',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const myNickname = String(req.user?.nickname ?? '');
    const body = req.body ?? {};

    const memberIdsInput = parseUserIdList(body.member_ids, me);
    const sourceGroupId = toInt(body.source_group_id, 0);

    // 从已有群聊建群：每个成员必须同时是源群成员且是我的好友
    if (sourceGroupId > 0) {
      const source = getConversationRow(sourceGroupId);
      if (!source || source.type !== 'group') {
        throw new ApiError(404, 'NOT_GROUP', '源群聊不存在');
      }
      const sourceMembers = new Set(memberIds(sourceGroupId));
      if (!sourceMembers.has(me)) {
        throw new ApiError(403, 'FORBIDDEN', '你不在源群聊中');
      }
      const friendIds = friendIdSet(me);
      for (const memberId of memberIdsInput) {
        if (!friendIds.has(memberId) || !sourceMembers.has(memberId)) {
          throw new ApiError(403, 'NOT_FRIEND', '所选成员必须同时是源群成员且是你的好友');
        }
      }
    }

    const result = createGroupConversation({
      ownerId: me,
      ownerNickname: myNickname,
      memberIds: memberIdsInput,
      name: typeof body.name === 'string' ? body.name : '',
      allowNonFriends: false,
    });

    const conversation = summarizeConversation(getConversationRow(result.conversationId));
    emitToUsers(result.members, 'conversation:new', {
      conversation_id: result.conversationId,
      conversation,
    });

    return ok(res, { conversation_id: result.conversationId });
  }),
);

// 未读总数（放在 /conversations/:id 之前，避免被通配路径吞掉）
router.get(
  '/unread/total',
  httpAuth,
  wrap(async (req, res) => {
    return ok(res, { total: unreadTotal(req.userId) });
  }),
);

// 会话详情（含成员列表）
router.get(
  '/conversations/:id',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const conversationId = toInt(req.params.id, 0);
    if (conversationId <= 0) {
      throw new ApiError(400, 'INVALID_PARAM', '会话 id 不合法');
    }

    assertMember(conversationId, me);

    // 群资料（头像 / 公告 / 权限 / 我的角色）与权限判定统一由 lib/conversations.js + lib/groupAuth.js 产出
    const detail = conversationDetail(conversationId, me);
    if (!detail) {
      throw new ApiError(404, 'NOT_FOUND', '会话不存在');
    }

    return ok(res, { conversation: detail.conversation });
  }),
);

// 设置聊天背景：'' | /uploads/<image> | #RRGGBB，写本人成员行，不广播
router.put(
  '/conversations/:id/background',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const conversationId = toInt(req.params.id, 0);
    if (conversationId <= 0) {
      throw new ApiError(400, 'INVALID_PARAM', '会话 id 不合法');
    }
    assertMember(conversationId, me);

    const body = req.body ?? {};
    const raw = typeof body.background_url === 'string' ? body.background_url.trim() : '';

    if (raw !== '') {
      if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
        // 纯色背景，合法
      } else if (isMediaUrl(raw)) {
        const match = /\.([A-Za-z0-9]+)$/.exec(raw);
        const ext = match ? match[1].toLowerCase() : '';
        if (!['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
          throw new ApiError(400, 'INVALID_PARAM', '背景图片必须是 jpg/png/gif/webp 格式');
        }
      } else {
        throw new ApiError(400, 'INVALID_PARAM', '背景必须是空串、图片地址或 #RRGGBB 颜色值');
      }
    }

    db.prepare(
      'UPDATE conversation_members SET background_url = ? WHERE conversation_id = ? AND user_id = ?',
    ).run(raw, conversationId, me);

    return ok(res, { background_url: raw });
  }),
);

// 拉人入群
router.post(
  '/conversations/:id/members',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const myNickname = String(req.user?.nickname ?? '');
    const conversationId = toInt(req.params.id, 0);
    if (conversationId <= 0) {
      throw new ApiError(400, 'INVALID_PARAM', '会话 id 不合法');
    }

    // 拉人权限统一走 groupAuth：非群 404 NOT_GROUP、非成员 403、perm_invite='admin' 时 403 INVITE_FORBIDDEN
    assertCanInvite(conversationId, me);

    const body = req.body ?? {};
    const requested = parseUserIdList(body.user_ids, me);
    if (requested.length === 0) {
      return ok(res, { added: [] });
    }

    const currentMembers = new Set(memberIds(conversationId));
    // 已在群内的成员直接忽略（含已非好友的老成员），只校验真正要新增的人
    const toAdd = requested.filter((id) => !currentMembers.has(id));

    if (toAdd.length === 0) {
      return ok(res, { added: [] });
    }

    const friendIds = friendIdSet(me);
    const notFriend = toAdd.filter((id) => !friendIds.has(id));
    if (notFriend.length > 0) {
      throw new ApiError(403, 'NOT_FRIEND', '只能邀请自己的好友加入群聊');
    }

    if (currentMembers.size + toAdd.length > GROUP_MAX_MEMBERS) {
      throw new ApiError(400, 'GROUP_FULL', `群聊最多 ${GROUP_MAX_MEMBERS} 人`);
    }

    const recipients = memberIds(conversationId);

    const result = tx(() => {
      const joinedAt = now();
      const insertMember = db.prepare(
        `INSERT INTO conversation_members
           (conversation_id, user_id, role, unread_count, last_read_message_id, joined_at)
         VALUES (?, ?, 'member', 0, 0, ?)`,
      );
      for (const memberId of toAdd) {
        insertMember.run(conversationId, memberId, joinedAt);
      }

      const systemMessage = insertSystemMessage(
        conversationId,
        me,
        `「${myNickname} 邀请 ${toAdd.length} 位好友加入了群聊」`,
        joinedAt + 1,
      );

      return { systemMessage, joinedAt };
    });

    const summary = summarizeConversation(getConversationRow(conversationId));
    emitToUsers(toAdd, 'conversation:new', { conversation_id: conversationId, conversation: summary });

    const allMembers = [...recipients, ...toAdd];
    notifyConversationUpdate(
      conversationId,
      allMembers,
      {
        id: result.systemMessage.id,
        type: result.systemMessage.type,
        content: result.systemMessage.content,
        revoked: result.systemMessage.revoked,
        sender_id: result.systemMessage.sender_id,
        created_at: result.systemMessage.created_at,
        sender_nickname: result.systemMessage.sender_nickname,
        sender_avatar_url: result.systemMessage.sender_avatar_url,
      },
      result.systemMessage.created_at,
    );

    return ok(res, { added: toAdd });
  }),
);

// 退群（仅群聊）
router.delete(
  '/conversations/:id/members/me',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const myNickname = String(req.user?.nickname ?? '');
    const conversationId = toInt(req.params.id, 0);
    if (conversationId <= 0) {
      throw new ApiError(400, 'INVALID_PARAM', '会话 id 不合法');
    }

    const memberRow = assertMember(conversationId, me);

    const conversation = getConversationRow(conversationId);
    if (!conversation) {
      throw new ApiError(404, 'NOT_FOUND', '会话不存在');
    }
    if (conversation.type !== 'group') {
      throw new ApiError(400, 'NOT_GROUP', '单聊会话不能退出');
    }

    const outcome = tx(() => {
      const leftAt = now();
      db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(conversationId, me);

      const remaining = db
        .prepare(
          `SELECT user_id, role FROM conversation_members
            WHERE conversation_id = ?
            ORDER BY joined_at ASC, user_id ASC`,
        )
        .all(conversationId)
        .map((row) => Number(row.user_id));

      // 群已空：删除会话与全部消息
      if (remaining.length === 0) {
        db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
        db.prepare('DELETE FROM conversation_members WHERE conversation_id = ?').run(conversationId);
        db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
        return { new_owner_id: null, deleted: true, recipients: [], systemMessage: null };
      }

      let newOwnerId = null;
      // 群主身份判定统一走 groupAuth.isOwner（此处不比较 role 字符串）
      const wasOwner = isOwner({ conv: conversation, member: memberRow, userId: me });
      if (wasOwner) {
        newOwnerId = remaining[0];
        db.prepare("UPDATE conversation_members SET role = 'owner' WHERE conversation_id = ? AND user_id = ?").run(
          conversationId,
          newOwnerId,
        );
        db.prepare('UPDATE conversations SET owner_id = ? WHERE id = ?').run(newOwnerId, conversationId);
      }

      const systemMessage = insertSystemMessage(conversationId, me, `「${myNickname} 退出了群聊」`, leftAt);

      return { new_owner_id: newOwnerId, deleted: false, recipients: remaining, systemMessage };
    });

    if (!outcome.deleted && outcome.systemMessage) {
      notifyConversationUpdate(
        conversationId,
        outcome.recipients,
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
    }

    return ok(res, { new_owner_id: outcome.new_owner_id, deleted: outcome.deleted });
  }),
);

// 会话已读
router.post(
  '/conversations/:id/read',
  httpAuth,
  wrap(async (req, res) => {
    const me = req.userId;
    const conversationId = toInt(req.params.id, 0);
    if (conversationId <= 0) {
      throw new ApiError(400, 'INVALID_PARAM', '会话 id 不合法');
    }

    const body = req.body ?? {};
    const result = markRead({
      conversationId,
      userId: me,
      lastMessageId: body.last_message_id,
    });

    return ok(res, { unread_total: result.unread_total });
  }),
);

export default router;
