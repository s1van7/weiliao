/**
 * 消息领域服务：REST 与 Socket.IO 共用的落库/校验/广播逻辑。
 *
 * 约定：
 *   - 事务内只做同步写库，禁止 await；
 *   - 所有 emit 都在事务提交之后执行；
 *   - 返回值中的 message 已经是统一的对外序列化结构。
 */
import { db, now, tx } from '../db.js';
import { ApiError } from './http.js';
import { DEFAULT_AVATAR_COLOR, toInt } from './serialize.js';
import { areFriends, assertMember, memberIds } from './conversations.js';
import { blockedBy } from './friendPermissions.js';
import { assertCanSpeak, isAdmin, loadGroup } from './groupAuth.js';
import { normalizeMentions, parseMentions, serializeMentions } from './mentions.js';
import { emitToConversation, emitToUsers } from './realtime.js';
import { isMediaUrl, isVideoUrl, isVoiceUrl, sanitizeFileName } from './media.js';

/** 文本消息长度上限（按字符计） */
export const TEXT_MAX = 2000;
/** 图片消息 url 长度上限 */
const IMAGE_URL_MAX = 512;
/** client_id 长度上限 */
export const CLIENT_ID_MAX = 64;
/** 撤回时间窗（毫秒） */
export const REVOKE_WINDOW_MS = 120 * 1000;
/** 拉历史默认条数 */
export const PAGE_DEFAULT = 30;
/** 拉历史最大条数 */
export const PAGE_MAX = 50;
/** 增量同步最大条数 */
export const SYNC_MAX = 200;

/** 合并转发消息类型（与前端 web/src/lib/forward.js 保持一致） */
export const MERGED_TYPE = 'merged';
/** 单次合并条数上限 */
export const MERGED_MAX_ITEMS = 100;
/** merged content 总字节上限（utf8） */
export const MERGED_MAX_BYTES = 64 * 1024;

/** 允许的消息类型（system 只由服务端内部写入，不接受客户端指定） */
const ALLOWED_TYPES = new Set(['text', 'image', 'sticker', 'card', 'voice', 'video', 'file', MERGED_TYPE]);

/** 带发送者信息的消息查询片段 */
const MESSAGE_SELECT = `SELECT m.id, m.conversation_id, m.sender_id, m.type, m.content, m.client_id, m.revoked, m.mentions,
                               m.voice_url, m.voice_duration,
                               m.video_url, m.video_duration,
                               m.file_url, m.file_name, m.file_size,
                               m.transcript,
                               m.created_at,
                               u.nickname AS sender_nickname, u.avatar_color AS sender_avatar_color,
                               u.avatar_url AS sender_avatar_url
                          FROM messages m
                          JOIN users u ON u.id = m.sender_id`;

/**
 * 取「我在该会话里的清除边界」：删除聊天（clear）时记录的会话最大 message id。
 *
 * 历史分页 / 增量同步统一过滤 `m.id > cleared_before_id`，
 * 避免已删除的旧消息被向上翻页或断线重连同步回来。
 * @param {number} conversationId
 * @param {number} userId
 * @returns {number} 0 表示不过滤
 */
function clearedBeforeIdOf(conversationId, userId) {
  const convId = toInt(conversationId, 0);
  const uid = toInt(userId, 0);
  if (!convId || !uid) return 0;
  const row = db
    .prepare('SELECT cleared_before_id FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(convId, uid);
  return Number(row?.cleared_before_id ?? 0) || 0;
}

/**
 * 统一消息序列化：撤回后 content 置空，type 保留；mentions 解析成对象（无 @ 为 null）。
 * @param {Record<string, unknown>|null|undefined} row
 * @returns {{id:number, conversation_id:number, sender_id:number, sender_nickname:string, sender_avatar_color:string, sender_avatar_url:string, type:string, content:string, client_id:string|null, revoked:number, mentions:{all:boolean, ids:number[]}|null, voice_url:string, voice_duration:number, video_url:string, video_duration:number, file_url:string, file_name:string, file_size:number, transcript:string, created_at:number}|null}
 */
export function serializeMessage(row) {
  if (!row) return null;
  const revoked = Number(row.revoked ?? 0) === 1 ? 1 : 0;
  return {
    id: Number(row.id),
    conversation_id: Number(row.conversation_id),
    sender_id: Number(row.sender_id),
    sender_nickname: row.sender_nickname ?? '',
    sender_avatar_color: row.sender_avatar_color ?? DEFAULT_AVATAR_COLOR,
    sender_avatar_url: row.sender_avatar_url ?? '',
    type: row.type ?? 'text',
    content: revoked ? '' : String(row.content ?? ''),
    client_id: row.client_id === null || row.client_id === undefined ? null : String(row.client_id),
    revoked,
    mentions: revoked ? null : parseMentions(row.mentions),
    voice_url: revoked ? '' : String(row.voice_url ?? ''),
    voice_duration: revoked ? 0 : Number(row.voice_duration ?? 0),
    video_url: revoked ? '' : String(row.video_url ?? ''),
    video_duration: revoked ? 0 : Number(row.video_duration ?? 0),
    file_url: revoked ? '' : String(row.file_url ?? ''),
    file_name: revoked ? '' : String(row.file_name ?? ''),
    file_size: revoked ? 0 : Number(row.file_size ?? 0),
    transcript: revoked ? '' : String(row.transcript ?? ''),
    created_at: Number(row.created_at),
  };
}

/**
 * 按 id 取消息（含发送者信息）。
 * @param {number|string} messageId
 * @returns {Record<string, unknown>|null}
 */
export function findMessageById(messageId) {
  const id = toInt(messageId);
  if (!id) return null;
  return db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).get(id) ?? null;
}

/**
 * 按 (conversation_id, sender_id, client_id) 取消息，用于幂等去重。
 * client_id 由发送方本地生成，不同发送者可能撞车，因此必须带上 sender_id。
 * @param {number|string} conversationId
 * @param {string} clientId
 * @param {number|string} senderId
 * @returns {Record<string, unknown>|null}
 */
export function findMessageByClientId(conversationId, clientId, senderId) {
  const convId = toInt(conversationId);
  const uid = toInt(senderId);
  if (!convId || !uid || typeof clientId !== 'string' || !clientId) return null;
  return (
    db
      .prepare(`${MESSAGE_SELECT} WHERE m.conversation_id = ? AND m.sender_id = ? AND m.client_id = ?`)
      .get(convId, uid, clientId) ?? null
  );
}

/**
 * 校验消息入参（类型、client_id、内容）。
 *
 * text：非空、≤ TEXT_MAX；
 * image / sticker：content 必须是 /uploads/ 下的图片地址（sticker 复用同一落盘目录）；
 * card：content 为 JSON 字符串，服务端校验 user_id 存在后回填 nickname/avatar_url（不信任客户端）；
 * voice：content 必须是 /uploads/ 下的 webm|mp4 地址，且 voice_duration ∈ 1..60；
 * video：content 必须是 /uploads/ 下的 mp4 地址，且 video_duration 为非负整数；
 * file：content 必须是 /uploads/ 下的媒体地址，file_name 清洗后非空 ≤255，file_size 为正整数。
 * @param {{type:unknown, content:unknown, clientId:unknown, voiceDuration:unknown, videoDuration:unknown, fileName:unknown, fileSize:unknown}} input
 * @returns {{type:'text'|'image'|'sticker'|'card'|'voice'|'video'|'file', content:string, clientId:string, voice_duration?:number, video_duration?:number, file_name?:string, file_size?:number}}
 */
function normalizePayload({ type, content, clientId, voiceDuration, videoDuration, fileName, fileSize }) {
  const normalizedType = typeof type === 'string' ? type.trim() : '';
  if (!ALLOWED_TYPES.has(normalizedType)) {
    throw new ApiError(400, 'INVALID_PARAM', 'type 仅支持 text、image、sticker、card、voice、video、file 或 merged');
  }

  const normalizedClientId = typeof clientId === 'string' ? clientId.trim() : '';
  if (!normalizedClientId) {
    throw new ApiError(400, 'INVALID_PARAM', 'client_id 不能为空');
  }
  if (normalizedClientId.length > CLIENT_ID_MAX) {
    throw new ApiError(400, 'INVALID_PARAM', `client_id 不能超过 ${CLIENT_ID_MAX} 个字符`);
  }

  const raw = typeof content === 'string' ? content : '';

  if (normalizedType === MERGED_TYPE) {
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.v !== 1 ||
      typeof parsed.title !== 'string' ||
      !Array.isArray(parsed.items) ||
      parsed.items.length < 1 ||
      parsed.items.length > MERGED_MAX_ITEMS
    ) {
      throw new ApiError(400, 'INVALID_PARAM', '合并转发的 content 必须是合法的 merged JSON 结构');
    }
    if (Buffer.byteLength(raw, 'utf8') > MERGED_MAX_BYTES) {
      throw new ApiError(400, 'INVALID_PARAM', '合并转发内容过大（上限 64KB）');
    }
    return { type: MERGED_TYPE, content: raw, clientId: normalizedClientId };
  }

  if (normalizedType === 'text') {
    const text = raw.trim();
    if (!text) {
      throw new ApiError(400, 'INVALID_PARAM', '消息内容不能为空');
    }
    if ([...text].length > TEXT_MAX) {
      throw new ApiError(400, 'INVALID_PARAM', `消息内容不能超过 ${TEXT_MAX} 个字符`);
    }
    return { type: 'text', content: text, clientId: normalizedClientId };
  }

  if (normalizedType === 'card') {
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const cardUserId = parsed && parsed.user_id ? toInt(parsed.user_id, 0) : 0;
    if (!parsed || typeof parsed !== 'object' || parsed.type !== 'card' || cardUserId <= 0) {
      throw new ApiError(400, 'INVALID_PARAM', '名片消息的 content 必须是 {"type":"card","user_id":123}');
    }
    const target = db
      .prepare('SELECT id, nickname, avatar_url FROM users WHERE id = ?')
      .get(cardUserId);
    if (!target) {
      throw new ApiError(404, 'NOT_FOUND', '名片用户不存在');
    }
    const normalizedContent = JSON.stringify({
      type: 'card',
      user_id: Number(target.id),
      nickname: String(target.nickname ?? ''),
      avatar_url: String(target.avatar_url ?? ''),
    });
    return { type: 'card', content: normalizedContent, clientId: normalizedClientId };
  }

  if (normalizedType === 'voice') {
    const url = raw.trim();
    if (!isVoiceUrl(url)) {
      throw new ApiError(400, 'INVALID_PARAM', '语音消息的 content 必须是 /uploads/ 下的 webm 或 mp4 地址');
    }
    const duration = toInt(voiceDuration, 0);
    if (duration < 1 || duration > 60) {
      throw new ApiError(400, 'INVALID_PARAM', '语音时长需在 1-60 秒之间');
    }
    return { type: 'voice', content: url, clientId: normalizedClientId, voice_duration: duration };
  }

  if (normalizedType === 'video') {
    const url = raw.trim();
    if (!isVideoUrl(url)) {
      throw new ApiError(400, 'INVALID_PARAM', '视频消息的 content 必须是 /uploads/ 下的 mp4 地址');
    }
    const duration = toInt(videoDuration, 0);
    if (duration < 0) {
      throw new ApiError(400, 'INVALID_PARAM', '视频时长必须是非负整数');
    }
    return { type: 'video', content: url, clientId: normalizedClientId, video_duration: duration };
  }

  if (normalizedType === 'file') {
    const url = raw.trim();
    if (!isMediaUrl(url)) {
      throw new ApiError(400, 'INVALID_PARAM', '文件消息的 content 必须是 /uploads/ 下的媒体地址');
    }
    const name = sanitizeFileName(fileName);
    if (!name || [...name].length > 255) {
      throw new ApiError(400, 'INVALID_PARAM', '文件名不能为空且不能超过 255 个字符');
    }
    const size = toInt(fileSize, 0);
    if (size <= 0) {
      throw new ApiError(400, 'INVALID_PARAM', '文件大小必须是正整数');
    }
    return { type: 'file', content: url, clientId: normalizedClientId, file_name: name, file_size: size };
  }

  const url = raw.trim();
  if (!isMediaUrl(url)) {
    const label = normalizedType === 'sticker' ? '表情消息' : '图片消息';
    throw new ApiError(400, 'INVALID_PARAM', `${label}的 content 必须是 /uploads/ 开头的地址`);
  }
  if (url.length > IMAGE_URL_MAX) {
    throw new ApiError(400, 'INVALID_PARAM', '图片地址过长');
  }
  return { type: /** @type {'image'|'sticker'} */ (normalizedType), content: url, clientId: normalizedClientId };
}

/**
 * 会话更新推送：给所有成员的 user 房间广播 conversation:update。
 * @param {number} conversationId
 * @param {number[]} recipients
 * @param {{id:number, type:string, content:string, revoked:number, sender_id:number, created_at:number, sender_nickname:string, sender_avatar_url?:string}|null} lastMessage
 * @param {number} lastMessageAt
 * @returns {number} 接收方数量
 */
export function notifyConversationUpdate(conversationId, recipients, lastMessage, lastMessageAt) {
  return emitToUsers(recipients, 'conversation:update', {
    conversation_id: Number(conversationId),
    last_message_at: Number(lastMessageAt ?? 0),
    last_message: lastMessage ?? null,
  });
}

/**
 * 落库一条消息（REST 与 socket 共用）。
 *
 * 校验链：conversation 存在 → 我是成员 → 单聊好友关系（非好友只读）/ 群发言权限
 *        → 参数合法 → mentions 合法 → 幂等命中 → 插入（含 @ 状态位）。
 * 幂等命中时返回 duplicate=true 且不广播、不加未读、不改 mentioned。
 *
 * @param {{conversationId:unknown, senderId:unknown, type:unknown, content:unknown, clientId:unknown, mentions?:unknown, voiceDuration?:unknown, videoDuration?:unknown, fileName?:unknown, fileSize?:unknown}} input
 * @returns {{message:ReturnType<typeof serializeMessage>, duplicate:boolean}}
 */
export function createMessage({
  conversationId,
  senderId,
  type,
  content,
  clientId,
  mentions,
  voiceDuration,
  videoDuration,
  fileName,
  fileSize,
}) {
  const convId = toInt(conversationId);
  const uid = toInt(senderId);
  if (!convId) {
    throw new ApiError(400, 'INVALID_PARAM', 'conversation_id 不合法');
  }
  if (!uid) {
    throw new ApiError(400, 'INVALID_PARAM', 'sender_id 不合法');
  }

  const conversation = db
    .prepare('SELECT id, type, allow_non_friend_send FROM conversations WHERE id = ?')
    .get(convId);
  if (!conversation) {
    throw new ApiError(404, 'NOT_FOUND', '会话不存在');
  }
  assertMember(convId, uid);

  // 单聊：先做拉黑拦截（保留好友关系与会话，但不可发送），再判好友关系只读；
  // 面对面传文件创建的临时单聊通过 allow_non_friend_send=1 放行非好友发送。
  if (conversation.type === 'single') {
    const peer = db
      .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id <> ? LIMIT 1')
      .get(convId, uid);
    const peerId = peer ? Number(peer.user_id) : 0;
    if (peerId) {
      if (blockedBy(uid, peerId)) {
        throw new ApiError(403, 'BLOCKED', '你已拉黑对方，无法发送消息');
      }
      if (blockedBy(peerId, uid)) {
        throw new ApiError(403, 'BLOCKED_BY_PEER', '消息已发出，但被对方拒收');
      }
      const allowNonFriendSend = Number(conversation.allow_non_friend_send ?? 0) === 1;
      if (!areFriends(uid, peerId) && !allowNonFriendSend) {
        throw new ApiError(403, 'CONVERSATION_READONLY', '已不是好友，该会话为只读状态');
      }
    }
  } else if (conversation.type === 'group') {
    // 群聊发言统一走 groupAuth（perm_speak='admin' 时普通成员 403 SPEAK_FORBIDDEN）
    assertCanSpeak(convId, uid);
  }

  const payload = normalizePayload({ type, content, clientId, voiceDuration, videoDuration, fileName, fileSize });

  // @ 规范化：ids 必须是群成员、去掉自己；all:true 仅需是群成员；单聊直接返回 null
  const normalizedMentions = normalizeMentions(convId, mentions, uid);
  const mentionsText = serializeMentions(normalizedMentions);

  // 幂等快路径：同一发送者命中已存在的 (conversation_id, sender_id, client_id) 直接返回
  const existing = findMessageByClientId(convId, payload.clientId, uid);
  if (existing) {
    return { message: serializeMessage(existing), duplicate: true };
  }

  const recipients = memberIds(convId);

  let messageId = 0;
  try {
    messageId = tx(() => {
      const createdAt = now();
      const voiceUrl = payload.type === 'voice' ? payload.content : '';
      const voiceDuration = payload.type === 'voice' ? Number(payload.voice_duration ?? 0) : 0;
      const videoUrl = payload.type === 'video' ? payload.content : '';
      const videoDurationValue = payload.type === 'video' ? Number(payload.video_duration ?? 0) : 0;
      const fileUrl = payload.type === 'file' ? payload.content : '';
      const fileNameValue = payload.type === 'file' ? payload.file_name : '';
      const fileSizeValue = payload.type === 'file' ? Number(payload.file_size ?? 0) : 0;
      const inserted = db
        .prepare(
          `INSERT INTO messages (conversation_id, sender_id, type, content, client_id, revoked, mentions, created_at, voice_url, voice_duration, video_url, video_duration, file_url, file_name, file_size)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          convId,
          uid,
          payload.type,
          payload.content,
          payload.clientId,
          mentionsText,
          createdAt,
          voiceUrl,
          voiceDuration,
          videoUrl,
          videoDurationValue,
          fileUrl,
          fileNameValue,
          fileSizeValue,
        );

      const newId = Number(inserted.lastInsertRowid);

      // 其他成员未读 +1
      db.prepare(
        'UPDATE conversation_members SET unread_count = unread_count + 1 WHERE conversation_id = ? AND user_id <> ?',
      ).run(convId, uid);

      // @ 状态位：只置 mentioned，不动 unread_count（未读只由消息条数决定，避免重复计数）
      if (normalizedMentions && normalizedMentions.all) {
        db.prepare(
          'UPDATE conversation_members SET mentioned = 1 WHERE conversation_id = ? AND user_id <> ?',
        ).run(convId, uid);
      } else if (normalizedMentions && normalizedMentions.ids.length > 0) {
        const placeholders = normalizedMentions.ids.map(() => '?').join(', ');
        db.prepare(
          `UPDATE conversation_members SET mentioned = 1
            WHERE conversation_id = ? AND user_id IN (${placeholders}) AND user_id <> ?`,
        ).run(convId, ...normalizedMentions.ids, uid);
      }

      // 会话摘要
      db.prepare('UPDATE conversations SET last_message_at = ?, last_message_id = ? WHERE id = ?').run(createdAt, newId, convId);

      return newId;
    });
  } catch (err) {
    // 唯一索引兜底：极端并发下同一发送者的重复 client_id 命中 uq_msg_client，按幂等语义返回已存在的那条
    const message = err && typeof err.message === 'string' ? err.message : '';
    if (message.includes('UNIQUE constraint failed')) {
      const fallback = findMessageByClientId(convId, payload.clientId, uid);
      if (fallback) {
        return { message: serializeMessage(fallback), duplicate: true };
      }
    }
    throw err;
  }

  const row = findMessageById(messageId);
  const message = serializeMessage(row);

  // 提交后才广播
  emitToConversation(convId, 'message:new', { message });
  notifyConversationUpdate(
    convId,
    recipients,
    {
      id: message.id,
      type: message.type,
      content: message.content,
      revoked: message.revoked,
      sender_id: message.sender_id,
      created_at: message.created_at,
      sender_nickname: message.sender_nickname,
      sender_avatar_url: message.sender_avatar_url,
    },
    message.created_at,
  );

  return { message, duplicate: false };
}

/**
 * 插入系统消息（必须在 tx() 内调用）。
 * 同步累加其他成员未读并刷新会话摘要；不单独广播 message:new（由调用方广播 conversation:update）。
 * @param {number|string} conversationId
 * @param {number|string} actorId 触发系统消息的用户
 * @param {string} content 系统消息文本
 * @param {number} [timestamp]
 * @returns {ReturnType<typeof serializeMessage>}
 */
export function insertSystemMessage(conversationId, actorId, content, timestamp = now()) {
  const convId = toInt(conversationId);
  const uid = toInt(actorId);
  if (!convId || !uid) {
    throw new ApiError(400, 'INVALID_PARAM', '系统消息参数不合法');
  }
  const createdAt = Number.isInteger(Number(timestamp)) && Number(timestamp) > 0 ? Number(timestamp) : now();

  const inserted = db
    .prepare(
      `INSERT INTO messages (conversation_id, sender_id, type, content, client_id, revoked, created_at)
       VALUES (?, ?, 'system', ?, NULL, 0, ?)`,
    )
    .run(convId, uid, content, createdAt);

  const messageId = Number(inserted.lastInsertRowid);

  db.prepare(
    'UPDATE conversation_members SET unread_count = unread_count + 1 WHERE conversation_id = ? AND user_id <> ?',
  ).run(convId, uid);
  db.prepare('UPDATE conversations SET last_message_at = ?, last_message_id = ? WHERE id = ?').run(
    createdAt,
    messageId,
    convId,
  );

  return serializeMessage(findMessageById(messageId));
}

/**
 * 撤回消息：普通成员仅能撤回自己 120 秒内发送的消息；群主 / 管理员可撤回群内
 * 任何人的消息且不受 120 秒时间窗限制（需求：群主和管理员可撤回超过两分钟的消息）。
 * @param {{messageId:unknown, userId:unknown}} input
 * @returns {ReturnType<typeof serializeMessage>}
 */
export function revokeMessage({ messageId, userId }) {
  const id = toInt(messageId);
  const uid = toInt(userId);
  if (!id) {
    throw new ApiError(400, 'INVALID_PARAM', 'message_id 不合法');
  }

  const row = findMessageById(id);
  if (!row) {
    throw new ApiError(404, 'NOT_FOUND', '消息不存在');
  }

  const convId = Number(row.conversation_id);
  assertMember(convId, uid);

  if (row.type === 'system') {
    throw new ApiError(403, 'FORBIDDEN', '系统消息不能撤回');
  }
  if (Number(row.revoked ?? 0) === 1) {
    throw new ApiError(409, 'CONFLICT', '该消息已撤回');
  }

  const senderId = Number(row.sender_id);
  const isMine = senderId === uid;

  // 群聊里群主 / 管理员：可撤回任何人的消息、不受 2 分钟限制
  const conversation = db.prepare('SELECT type FROM conversations WHERE id = ?').get(convId);
  const isGroupAdmin = conversation && conversation.type === 'group' && isAdmin(loadGroup(convId, uid));

  if (!isMine && !isGroupAdmin) {
    throw new ApiError(403, 'FORBIDDEN', '只能撤回自己发送的消息');
  }
  if (!isGroupAdmin && now() - Number(row.created_at) > REVOKE_WINDOW_MS) {
    throw new ApiError(403, 'REVOKE_EXPIRED', '超过 2 分钟的消息不能撤回');
  }

  tx(() => {
    const revoked = db.prepare("UPDATE messages SET revoked = 1, content = '' WHERE id = ? AND revoked = 0").run(id);

    // 真正撤回成功才回退未读：未读过该消息的成员未读 -1（下限 0）。
    // 这里排除的是「消息发送者」而非撤回者：发送者自己的消息在发送时本就不计入自己的未读，
    // 群主/管理员撤回他人消息时，发送者同样不应被回退。
    if (Number(revoked.changes) > 0) {
      db.prepare(
        `UPDATE conversation_members
            SET unread_count = MAX(unread_count - 1, 0)
          WHERE conversation_id = ?
            AND user_id <> ?
            AND last_read_message_id < ?
            AND unread_count > 0`,
      ).run(convId, senderId, id);
    }
  });

  const updated = serializeMessage(findMessageById(id));

  emitToConversation(convId, 'message:revoked', { conversation_id: convId, message_id: id });

  return updated;
}

/**
 * 会话已读：清零未读、清除「有人@我」标记并前推 last_read_message_id。
 * last_message_id 会被钳制到该会话当前最大消息 id，非法值不报错。
 * @param {{conversationId:unknown, userId:unknown, lastMessageId:unknown}} input
 * @returns {{unread_total:number, last_message_id:number}}
 */
export function markRead({ conversationId, userId, lastMessageId }) {
  const convId = toInt(conversationId);
  const uid = toInt(userId);
  if (!convId) {
    throw new ApiError(400, 'INVALID_PARAM', 'conversation_id 不合法');
  }

  assertMember(convId, uid);

  // last_read_message_id 必须属于本会话：超出会话最大消息 id 的非法值静默钳制
  const maxRow = db.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM messages WHERE conversation_id = ?').get(convId);
  const maxMessageId = Number(maxRow?.max_id ?? 0);
  const rawLast = toInt(lastMessageId, 0);
  const safeLast = Math.min(rawLast > 0 ? rawLast : 0, maxMessageId);

  tx(() => {
    db.prepare(
      `UPDATE conversation_members
          SET unread_count = 0,
              mentioned = 0,
              manual_unread = 0,
              last_read_message_id = MAX(last_read_message_id, ?)
        WHERE conversation_id = ? AND user_id = ?`,
    ).run(safeLast, convId, uid);
  });

  // 未读总数与会话列表口径保持一致：已隐藏（且无更新消息）的会话不计入未读
  const totalRow = db
    .prepare(
      `SELECT COALESCE(SUM(cm.unread_count), 0) AS total
         FROM conversation_members cm
         JOIN conversations c ON c.id = cm.conversation_id
        WHERE cm.user_id = ?
          AND (cm.hidden = 0 OR c.last_message_at > cm.hidden_at)`,
    )
    .get(uid);

  emitToConversation(convId, 'message:read', {
    conversation_id: convId,
    user_id: uid,
    last_message_id: safeLast,
  });

  return { unread_total: Number(totalRow?.total ?? 0), last_message_id: safeLast };
}

/**
 * 历史消息分页（before_id 模式）：倒序取 limit+1 条判断 has_more，再反转为正序返回。
 * 已「删除聊天」的旧消息（id <= cleared_before_id）不参与分页。
 * @param {{conversationId:unknown, userId:unknown, beforeId:unknown, limit:unknown}} input
 * @returns {{messages:Array<Record<string, unknown>>, has_more:boolean}}
 */
export function listMessagesBefore({ conversationId, userId, beforeId, limit }) {
  const convId = toInt(conversationId);
  if (!convId) {
    throw new ApiError(400, 'INVALID_PARAM', 'conversation_id 不合法');
  }
  assertMember(convId, userId);

  const numericBefore = toInt(beforeId, 0);
  const cursor = numericBefore > 0 ? numericBefore : Number.MAX_SAFE_INTEGER;

  const rawLimit = toInt(limit, PAGE_DEFAULT);
  const pageSize = Math.min(Math.max(rawLimit > 0 ? rawLimit : PAGE_DEFAULT, 1), PAGE_MAX);
  const clearedBeforeId = clearedBeforeIdOf(convId, userId);

  const rows = db
    .prepare(
      `${MESSAGE_SELECT} WHERE m.conversation_id = ? AND m.id < ? AND m.id > ? ORDER BY m.id DESC LIMIT ?`,
    )
    .all(convId, cursor, clearedBeforeId, pageSize + 1);

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  page.reverse();

  return { messages: page.map(serializeMessage), has_more: hasMore };
}

/**
 * 增量消息（after_id 模式）：正序取最多 200 条。
 * 同样过滤 cleared_before_id，避免删除聊天后旧消息被增量补回。
 * @param {{conversationId:unknown, userId:unknown, afterId:unknown}} input
 * @returns {{messages:Array<Record<string, unknown>>, has_more:boolean}}
 */
export function listMessagesAfter({ conversationId, userId, afterId }) {
  const convId = toInt(conversationId);
  if (!convId) {
    throw new ApiError(400, 'INVALID_PARAM', 'conversation_id 不合法');
  }
  assertMember(convId, userId);

  const cursor = Math.max(toInt(afterId, 0), 0);
  const clearedBeforeId = clearedBeforeIdOf(convId, userId);

  const rows = db
    .prepare(`${MESSAGE_SELECT} WHERE m.conversation_id = ? AND m.id > ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`)
    .all(convId, cursor, clearedBeforeId, SYNC_MAX + 1);

  const hasMore = rows.length > SYNC_MAX;
  const page = hasMore ? rows.slice(0, SYNC_MAX) : rows;

  return { messages: page.map(serializeMessage), has_more: hasMore };
}

/**
 * 全局增量同步：只返回我参与的会话中 id > after_id 的消息。
 *
 * 每个会话的清除边界不同，因此用相关子查询逐行比较 cleared_before_id
 * （仍是一条 SQL，走 conversation_members 主键索引，不会引入额外往返）。
 * @param {{userId:unknown, afterId:unknown, limit:unknown}} input
 * @returns {{messages:Array<Record<string, unknown>>, has_more:boolean, server_time:number}}
 */
export function syncMessages({ userId, afterId, limit }) {
  const uid = toInt(userId);
  if (!uid) {
    throw new ApiError(400, 'INVALID_PARAM', '用户不合法');
  }

  const cursor = Math.max(toInt(afterId, 0), 0);
  const rawLimit = toInt(limit, SYNC_MAX);
  const pageSize = Math.min(Math.max(rawLimit > 0 ? rawLimit : SYNC_MAX, 1), SYNC_MAX);

  const rows = db
    .prepare(
      `${MESSAGE_SELECT}
        WHERE m.id > ?
          AND m.conversation_id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?)
          AND m.id > COALESCE(
                (SELECT cm.cleared_before_id FROM conversation_members cm
                  WHERE cm.conversation_id = m.conversation_id AND cm.user_id = ?), 0)
        ORDER BY m.id ASC
        LIMIT ?`,
    )
    .all(cursor, uid, uid, pageSize + 1);

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  return { messages: page.map(serializeMessage), has_more: hasMore, server_time: now() };
}
