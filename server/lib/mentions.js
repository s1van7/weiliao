/**
 * @ 机制领域模块：mentions 对象的规范化校验、JSON 文本序列化/反序列化。
 *
 * 存储形态：messages.mentions 存 JSON 文本（如 `{"all":false,"ids":[3,7]}`），空串表示无 @。
 * 选择 JSON 列而非关联表：@ 与消息同生命周期、只按 message_id 整取，
 * 从不需要「按被 @ 人反查消息」（提醒靠 conversation_members.mentioned 位 + socket 推送）。
 */
import { db } from '../db.js';
import { ApiError } from './http.js';
import { toInt } from './serialize.js';
import { assertCanMentionAll } from './groupAuth.js';

/**
 * 把 mentions 对象序列化成入库文本。
 * @param {{all?:boolean, ids?:number[]}|null|undefined} mentions 规范化后的 mentions
 * @returns {string} 空串表示无 @
 */
export function serializeMentions(mentions) {
  if (!mentions) return '';
  const all = mentions.all === true;
  const ids = Array.isArray(mentions.ids) ? mentions.ids.filter((id) => Number.isInteger(Number(id)) && Number(id) > 0).map(Number) : [];
  if (!all && ids.length === 0) return '';
  return JSON.stringify({ all, ids: [...new Set(ids)] });
}

/**
 * 把入库文本解析回 mentions 对象（脏数据/空串一律返回 null）。
 * @param {unknown} raw 数据库原文
 * @returns {{all:boolean, ids:number[]}|null}
 */
export function parseMentions(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const all = parsed.all === true;
    const rawIds = Array.isArray(parsed.ids) ? parsed.ids : [];
    const ids = [...new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
    if (!all && ids.length === 0) return null;
    return { all, ids };
  } catch {
    return null;
  }
}

/**
 * 我能 @ 到的群成员 id 集合。
 * @param {number} conversationId 会话 id
 * @returns {Set<number>}
 */
function groupMemberIdSet(conversationId) {
  const rows = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(conversationId);
  return new Set(rows.map((row) => Number(row.user_id)));
}

/**
 * 规范化发送方提交的 mentions 入参。
 *
 * 规则：
 *   - 缺省 / null / 单聊会话 → 返回 null（无 @）；
 *   - ids 去重，元素必须是正整数且全部为群成员（否则 400 INVALID_PARAM）；
 *   - 去掉发送者自己；
 *   - all:true 仅要求发送者是群成员（任何成员都可 @所有人）；
 *   - 规范化后既没有 all 也没有 ids → 返回 null。
 * @param {number|string} conversationId 会话 id
 * @param {unknown} raw 原始入参（约定形状 {all?:boolean, ids?:number[]}）
 * @param {number|string} senderId 发送者 id
 * @returns {{all:boolean, ids:number[]}|null}
 * @throws {ApiError} 400 INVALID_PARAM / 403 MENTION_FORBIDDEN
 */
export function normalizeMentions(conversationId, raw, senderId) {
  if (raw === undefined || raw === null) return null;

  const convId = toInt(conversationId, 0);
  const uid = toInt(senderId, 0);
  if (convId <= 0 || uid <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', 'mentions 参数不合法');
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError(400, 'INVALID_PARAM', 'mentions 必须是 {all, ids} 形式的对象');
  }

  // 单聊没有 @ 语义：直接忽略，避免非群场景抛 NOT_GROUP
  const conversation = db.prepare('SELECT id, type FROM conversations WHERE id = ?').get(convId);
  if (!conversation || conversation.type !== 'group') {
    return null;
  }

  const all = raw.all === true;

  let requested = [];
  if (raw.ids !== undefined && raw.ids !== null) {
    if (!Array.isArray(raw.ids)) {
      throw new ApiError(400, 'INVALID_PARAM', 'mentions.ids 必须是数组');
    }
    requested = raw.ids;
  }

  const ids = [];
  for (const item of requested) {
    const id = toInt(item, 0);
    if (id <= 0) {
      throw new ApiError(400, 'INVALID_PARAM', 'mentions.ids 含非法用户 id');
    }
    if (id !== uid && !ids.includes(id)) ids.push(id);
  }

  if (ids.length > 0) {
    const memberSet = groupMemberIdSet(convId);
    const outsider = ids.filter((id) => !memberSet.has(id));
    if (outsider.length > 0) {
      throw new ApiError(400, 'INVALID_PARAM', '被 @ 的用户不是群成员');
    }
  }

  if (all) {
    // 任何群成员都可 @所有人（仅校验是否群成员）
    assertCanMentionAll(convId, uid);
  }

  if (!all && ids.length === 0) return null;
  return { all, ids };
}
