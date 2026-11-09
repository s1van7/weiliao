/**
 * 群权限唯一入口。
 *
 * 所有「群主 / 管理员 / 发言 / 邀请 / 移除成员 / @所有人」的判断都收敛在本模块，
 * 路由与 socket 只允许调用这里导出的断言函数，禁止在别处直接比较 role 字符串。
 *
 * 约定：
 *   - 所有函数都是同步的（与 db.js 的 DatabaseSync 一致），不返回 Promise；
 *   - ctx = { conv, member, conversationId, userId, role }，由 loadGroup 产出；
 *   - 抛出的 ApiError 统一带机器可读 code，前端据此决定按钮显隐。
 */
import { db } from '../db.js';
import { ApiError } from './http.js';
import { toInt } from './serialize.js';

/**
 * 群默认权限。单聊（非群）没有权限概念，对外展示时用这份兜底值，
 * 保证前端读 permissions.speak 之类的字段永远不会空指针。
 */
export const DEFAULT_PERMISSIONS = Object.freeze({ speak: 'all', invite: 'all', remove: 'owner' });

/** 允许的权限取值 */
const SPEAK_INVITE_VALUES = Object.freeze(['all', 'admin']);
const REMOVE_VALUES = Object.freeze(['owner', 'owner_admin']);
/** 允许的成员角色（owner 只能由群主转让产生，不通过设置接口写入） */
const ASSIGNABLE_ROLES = Object.freeze(['admin', 'member']);

/**
 * 归一成员角色字符串（脏值一律视为 member）。
 * @param {Record<string, unknown>|null|undefined} member conversation_members 行
 * @returns {'owner'|'admin'|'member'}
 */
export function roleOf(member) {
  const role = String(member?.role ?? '');
  return role === 'owner' || role === 'admin' ? role : 'member';
}

/**
 * 加载群上下文：会话行 + 我的成员行。
 * @param {number|string} conversationId 会话 id
 * @param {number|string} userId 当前用户 id
 * @returns {{conv:Record<string, unknown>, member:Record<string, unknown>, conversationId:number, userId:number, role:'owner'|'admin'|'member'}}
 * @throws {ApiError} 400 INVALID_PARAM / 404 NOT_GROUP / 403 FORBIDDEN
 */
export function loadGroup(conversationId, userId) {
  const convId = toInt(conversationId, 0);
  const uid = toInt(userId, 0);
  if (convId <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '会话 id 不合法');
  }
  if (uid <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '用户 id 不合法');
  }

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  if (!conv) {
    throw new ApiError(404, 'NOT_GROUP', '群聊不存在');
  }
  if (conv.type !== 'group') {
    throw new ApiError(404, 'NOT_GROUP', '该会话不是群聊');
  }

  const member = db
    .prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(convId, uid);
  if (!member) {
    throw new ApiError(403, 'FORBIDDEN', '你不在该群中');
  }

  return { conv, member, conversationId: convId, userId: uid, role: roleOf(member) };
}

/**
 * 是否群主（role='owner' 与 conversations.owner_id 唯一判定点）。
 * @param {{conv:Record<string, unknown>, member:Record<string, unknown>, userId:number}|null} ctx 群上下文
 * @returns {boolean}
 */
export function isOwner(ctx) {
  if (!ctx || !ctx.conv || !ctx.member) return false;
  if (roleOf(ctx.member) === 'owner') return true;
  const ownerId = ctx.conv.owner_id;
  if (ownerId === null || ownerId === undefined) return false;
  return Number(ownerId) === Number(ctx.userId);
}

/**
 * 是否群主或管理员。
 * @param {{conv:Record<string, unknown>, member:Record<string, unknown>, userId:number}|null} ctx 群上下文
 * @returns {boolean}
 */
export function isAdmin(ctx) {
  if (!ctx || !ctx.member) return false;
  return isOwner(ctx) || roleOf(ctx.member) === 'admin';
}

/**
 * 取我的对外角色（owner / admin / member）。
 * @param {{conv:Record<string, unknown>, member:Record<string, unknown>, userId:number}} ctx 群上下文
 * @returns {'owner'|'admin'|'member'}
 */
export function myRole(ctx) {
  if (isOwner(ctx)) return 'owner';
  return roleOf(ctx.member);
}

/**
 * 三个权限开关的当前取值（原始字符串，供前端做按钮显隐）。
 * @param {{conv:Record<string, unknown>}|null} ctx 群上下文（可为 null，返回默认值）
 * @returns {{speak:string, invite:string, remove:string}}
 */
export function permissionsOf(ctx) {
  if (!ctx || !ctx.conv) return { ...DEFAULT_PERMISSIONS };
  return {
    speak: String(ctx.conv.perm_speak ?? DEFAULT_PERMISSIONS.speak),
    invite: String(ctx.conv.perm_invite ?? DEFAULT_PERMISSIONS.invite),
    remove: String(ctx.conv.perm_remove ?? DEFAULT_PERMISSIONS.remove),
  };
}

/**
 * 是否有未读公告（公告更新时间晚于我上次阅读时间）。
 * @param {{conv:Record<string, unknown>, member:Record<string, unknown>}|null} ctx 群上下文
 * @returns {boolean}
 */
export function announcementUnread(ctx) {
  if (!ctx || !ctx.conv || !ctx.member) return false;
  return Number(ctx.conv.announcement_at ?? 0) > Number(ctx.member.last_read_announcement_at ?? 0);
}

/**
 * 要求是群成员（loadGroup 已保证），返回 ctx。
 * @param {number|string} conversationId 会话 id
 * @param {number|string} userId 用户 id
 * @returns {ReturnType<typeof loadGroup>}
 * @throws {ApiError} 404 NOT_GROUP / 403 FORBIDDEN
 */
export function requireMember(conversationId, userId) {
  return loadGroup(conversationId, userId);
}

/**
 * 要求是群主或管理员。
 * @param {number|string} conversationId 会话 id
 * @param {number|string} userId 用户 id
 * @returns {ReturnType<typeof loadGroup>}
 * @throws {ApiError} 404 NOT_GROUP / 403 NOT_ADMIN
 */
export function requireAdmin(conversationId, userId) {
  const ctx = loadGroup(conversationId, userId);
  if (!isAdmin(ctx)) {
    throw new ApiError(403, 'NOT_ADMIN', '仅群主和管理员可操作');
  }
  return ctx;
}

/**
 * 要求是群主。
 * @param {number|string} conversationId 会话 id
 * @param {number|string} userId 用户 id
 * @returns {ReturnType<typeof loadGroup>}
 * @throws {ApiError} 404 NOT_GROUP / 403 NOT_OWNER
 */
export function requireOwner(conversationId, userId) {
  const ctx = loadGroup(conversationId, userId);
  if (!isOwner(ctx)) {
    throw new ApiError(403, 'NOT_OWNER', '仅群主可操作');
  }
  return ctx;
}

/**
 * 断言可以在群里发言（perm_speak='admin' 时普通成员被拦）。
 * @param {number|string} conversationId 会话 id
 * @param {number|string} userId 用户 id
 * @returns {ReturnType<typeof loadGroup>}
 * @throws {ApiError} 403 SPEAK_FORBIDDEN
 */
export function assertCanSpeak(conversationId, userId) {
  const ctx = loadGroup(conversationId, userId);
  if (permissionsOf(ctx).speak === 'admin' && !isAdmin(ctx)) {
    throw new ApiError(403, 'SPEAK_FORBIDDEN', '当前群仅群主和管理员可发言');
  }
  return ctx;
}

/**
 * 断言可以拉人入群（perm_invite='admin' 时普通成员被拦）。
 * @param {number|string} conversationId 会话 id
 * @param {number|string} userId 用户 id
 * @returns {ReturnType<typeof loadGroup>}
 * @throws {ApiError} 403 INVITE_FORBIDDEN
 */
export function assertCanInvite(conversationId, userId) {
  const ctx = loadGroup(conversationId, userId);
  if (permissionsOf(ctx).invite === 'admin' && !isAdmin(ctx)) {
    throw new ApiError(403, 'INVITE_FORBIDDEN', '当前群仅群主和管理员可邀请新成员');
  }
  return ctx;
}

/**
 * 断言可以移除目标成员。
 *
 * 判定顺序（顺序即语义，不可调换）：
 *   目标是自己 → 400 INVALID_PARAM
 *   目标是群主 → 403 OWNER_PROTECTED
 *   我是群主 → 通过
 *   我是管理员且目标也是管理员 → 403 ADMIN_PROTECTED
 *   我不是群主也不是管理员 → 403 REMOVE_FORBIDDEN（普通成员永远不能踢人）
 *   perm_remove='owner' 且我不是群主 → 403 REMOVE_FORBIDDEN
 *   否则通过
 * @param {number|string} conversationId 会话 id
 * @param {number|string} userId 操作者 id
 * @param {number|string} targetId 被移除者 id
 * @returns {ReturnType<typeof loadGroup> & {target:Record<string, unknown>}}
 * @throws {ApiError} 400 INVALID_PARAM / 404 NOT_FOUND / 403 OWNER_PROTECTED|ADMIN_PROTECTED|REMOVE_FORBIDDEN
 */
export function assertCanRemove(conversationId, userId, targetId) {
  const ctx = loadGroup(conversationId, userId);
  const target = toInt(targetId, 0);
  if (target <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '成员 id 不合法');
  }
  if (target === ctx.userId) {
    throw new ApiError(400, 'INVALID_PARAM', '不能移除自己，请使用退群接口');
  }

  const targetMember = db
    .prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(ctx.conversationId, target);
  if (!targetMember) {
    throw new ApiError(404, 'NOT_FOUND', '该成员不在群中');
  }

  const ownerId = ctx.conv.owner_id;
  const targetIsOwner =
    roleOf(targetMember) === 'owner' ||
    (ownerId !== null && ownerId !== undefined && Number(ownerId) === target);
  if (targetIsOwner) {
    throw new ApiError(403, 'OWNER_PROTECTED', '不能移除群主');
  }

  if (isOwner(ctx)) {
    return { ...ctx, target: targetMember };
  }

  if (isAdmin(ctx) && roleOf(targetMember) === 'admin') {
    throw new ApiError(403, 'ADMIN_PROTECTED', '管理员不能移除其他管理员');
  }

  // 基础门槛：移除成员是管理员操作，普通成员无论 perm_remove 取何值都不得踢人
  if (!isAdmin(ctx)) {
    throw new ApiError(403, 'REMOVE_FORBIDDEN', '当前群仅群主和管理员可移除成员');
  }

  if (permissionsOf(ctx).remove === 'owner') {
    throw new ApiError(403, 'REMOVE_FORBIDDEN', '当前群仅群主可移除成员');
  }

  return { ...ctx, target: targetMember };
}

/**
 * 断言可以修改群资料（群名 / 群头像），等同 requireAdmin。
 * @param {number|string} conversationId 会话 id
 * @param {number|string} userId 用户 id
 * @returns {ReturnType<typeof loadGroup>}
 * @throws {ApiError} 403 NOT_ADMIN
 */
export function assertCanManageProfile(conversationId, userId) {
  return requireAdmin(conversationId, userId);
}

/**
 * 断言可以使用 @所有人（任何群成员都可以，需求：群聊任何人都可以 @全体人员）。
 * @param {number|string} conversationId 会话 id
 * @param {number|string} userId 用户 id
 * @returns {ReturnType<typeof loadGroup>}
 * @throws {ApiError} 404 NOT_GROUP / 403 FORBIDDEN
 */
export function assertCanMentionAll(conversationId, userId) {
  return loadGroup(conversationId, userId);
}

/**
 * 断言可以设置 / 取消目标成员的管理员身份（仅群主，且目标不能是群主）。
 * @param {number|string} conversationId 会话 id
 * @param {number|string} userId 操作者 id
 * @param {number|string} targetId 目标成员 id
 * @returns {{ctx:ReturnType<typeof loadGroup>, target:Record<string, unknown>}}
 * @throws {ApiError} 400 INVALID_PARAM / 404 NOT_FOUND / 403 NOT_OWNER|OWNER_PROTECTED
 */
export function assertCanAssignRole(conversationId, userId, targetId) {
  const ctx = requireOwner(conversationId, userId);
  const target = toInt(targetId, 0);
  if (target <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '成员 id 不合法');
  }

  const targetMember = db
    .prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(ctx.conversationId, target);
  if (!targetMember) {
    throw new ApiError(404, 'NOT_FOUND', '该成员不在群中');
  }

  const ownerId = ctx.conv.owner_id;
  const targetIsOwner =
    roleOf(targetMember) === 'owner' ||
    (ownerId !== null && ownerId !== undefined && Number(ownerId) === target);
  if (targetIsOwner) {
    throw new ApiError(403, 'OWNER_PROTECTED', '不能修改群主的角色');
  }

  return { ctx, target: targetMember };
}

/**
 * 校验成员角色入参（'admin' | 'member'）。
 * @param {unknown} value 原始入参
 * @returns {'admin'|'member'}
 * @throws {ApiError} 400 INVALID_PARAM
 */
export function parseAssignableRole(value) {
  const role = typeof value === 'string' ? value.trim() : '';
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new ApiError(400, 'INVALID_PARAM', "role 仅支持 'admin' 或 'member'");
  }
  return /** @type {'admin'|'member'} */ (role);
}

/**
 * 校验发言 / 邀请权限入参（'all' | 'admin'）。
 * @param {unknown} value 原始入参
 * @param {string} field 字段名（用于报错文案）
 * @returns {'all'|'admin'}
 * @throws {ApiError} 400 INVALID_PARAM
 */
export function parseSpeakInvitePermission(value, field) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!SPEAK_INVITE_VALUES.includes(raw)) {
    throw new ApiError(400, 'INVALID_PARAM', `${field} 仅支持 'all' 或 'admin'`);
  }
  return /** @type {'all'|'admin'} */ (raw);
}

/**
 * 校验移除权限入参（'owner' | 'owner_admin'）。
 * @param {unknown} value 原始入参
 * @returns {'owner'|'owner_admin'}
 * @throws {ApiError} 400 INVALID_PARAM
 */
export function parseRemovePermission(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!REMOVE_VALUES.includes(raw)) {
    throw new ApiError(400, 'INVALID_PARAM', "remove 仅支持 'owner' 或 'owner_admin'");
  }
  return /** @type {'owner'|'owner_admin'} */ (raw);
}
