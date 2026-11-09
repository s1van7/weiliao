/**
 * 群权限前端纯函数：只做「按钮显隐」判断，服务端永远二次校验。
 *
 * 数据来源统一是 GET /api/conversations/:id 返回的 conversation 对象：
 *   { my_role: 'owner'|'admin'|'member', owner_id, permissions: { speak, invite, remove }, members[] }
 *
 * 取值约定（与 server/lib/groupAuth.js 一致）：
 *   speak  : 'all' | 'admin'
 *   invite : 'all' | 'admin'
 *   remove : 'owner' | 'owner_admin'
 */

/** 默认权限（服务端 DEFAULT_PERMISSIONS 的前端镜像，用于 detail 缺字段时兜底） */
export const DEFAULT_PERMISSIONS = Object.freeze({ speak: 'all', invite: 'all', remove: 'owner' });

/**
 * 取我的群角色。
 * @param {Record<string, any>|null|undefined} detail 会话详情
 * @returns {'owner'|'admin'|'member'}
 */
export function myRoleOf(detail) {
  const role = detail && detail.my_role;
  return role === 'owner' || role === 'admin' ? role : 'member';
}

/**
 * 取三个权限开关（缺字段时用默认值兜底，保证读 permissions.speak 不会空指针）。
 * @param {Record<string, any>|null|undefined} detail 会话详情
 * @returns {{speak: string, invite: string, remove: string}}
 */
export function permissionsOf(detail) {
  const source = (detail && detail.permissions) || {};
  return {
    speak: String(source.speak || DEFAULT_PERMISSIONS.speak),
    invite: String(source.invite || DEFAULT_PERMISSIONS.invite),
    remove: String(source.remove || DEFAULT_PERMISSIONS.remove),
  };
}

/**
 * 是否群主。
 * @param {Record<string, any>|null|undefined} detail
 * @returns {boolean}
 */
export function isOwner(detail) {
  return myRoleOf(detail) === 'owner';
}

/**
 * 是否群主或管理员。
 * @param {Record<string, any>|null|undefined} detail
 * @returns {boolean}
 */
export function isGroupAdmin(detail) {
  const role = myRoleOf(detail);
  return role === 'owner' || role === 'admin';
}

/**
 * 能否改群名 / 群头像 / 群公告（群主与管理员）。
 * @param {Record<string, any>|null|undefined} detail
 * @returns {boolean}
 */
export function canManageProfile(detail) {
  return isGroupAdmin(detail);
}

/**
 * 能否在群里发言。
 * @param {Record<string, any>|null|undefined} detail
 * @returns {boolean}
 */
export function canSpeak(detail) {
  if (!detail) return true;
  if (detail.type && detail.type !== 'group') return true;
  return permissionsOf(detail).speak !== 'admin' || isGroupAdmin(detail);
}

/**
 * 能否邀请好友入群。
 * @param {Record<string, any>|null|undefined} detail
 * @returns {boolean}
 */
export function canInvite(detail) {
  // 详情未就绪 / 加载失败时不给入口，避免「点了才报错」
  if (!detail) return false;
  if (detail.type && detail.type !== 'group') return false;
  return permissionsOf(detail).invite !== 'admin' || isGroupAdmin(detail);
}

/**
 * 能否 @所有人（任何群成员都可以，需求：群聊任何人都可以 @全体人员）。
 * @param {Record<string, any>|null|undefined} detail
 * @returns {boolean}
 */
export function canMentionAll(detail) {
  if (!detail) return false;
  if (detail.type && detail.type !== 'group') return false;
  return true;
}

/**
 * 能否修改三个权限开关（仅群主）。
 * @param {Record<string, any>|null|undefined} detail
 * @returns {boolean}
 */
export function canManagePermissions(detail) {
  return isOwner(detail);
}

/**
 * 能否移除某个成员（服务端 assertCanRemove 的前端镜像，仅用于按钮显隐）。
 * @param {Record<string, any>|null|undefined} detail 会话详情
 * @param {number} myId 我的用户 id
 * @param {Record<string, any>|null|undefined} target 目标成员（含 user_id / role）
 * @returns {boolean}
 */
export function canRemoveMember(detail, myId, target) {
  if (!detail || !target) return false;
  if (Number(target.user_id) === Number(myId)) return false;
  if (target.role === 'owner') return false;
  if (Number(target.user_id) === Number(detail.owner_id)) return false;

  const role = myRoleOf(detail);
  if (role === 'owner') return true;
  if (role !== 'admin') return false;
  // 管理员不能移除管理员
  if (target.role === 'admin') return false;
  return permissionsOf(detail).remove !== 'owner';
}

/**
 * 计算「点击某个成员」弹出的操作项（空数组 = 不弹菜单）。
 *
 * 规则（对齐需求 T8-4）：
 *   群主看普通成员 → 设为管理员 / 移出群聊
 *   群主看管理员   → 取消管理员 / 移出群聊
 *   管理员看普通成员 → 移出群聊（受 permissions.remove 控制，'owner' 时不显示）
 *   所有人看群主   → 无
 *   自己           → 无
 *
 * @param {Record<string, any>|null|undefined} detail 会话详情
 * @param {number} myId 我的用户 id
 * @param {Record<string, any>|null|undefined} target 目标成员
 * @returns {Array<{key: 'promote'|'demote'|'remove', label: string, danger: boolean}>}
 */
export function memberActions(detail, myId, target) {
  if (!detail || !target) return [];
  if (Number(target.user_id) === Number(myId)) return [];
  if (target.role === 'owner' || Number(target.user_id) === Number(detail.owner_id)) return [];

  const actions = [];

  if (isOwner(detail)) {
    if (target.role === 'admin') actions.push({ key: 'demote', label: '取消管理员', danger: false });
    else actions.push({ key: 'promote', label: '设为管理员', danger: false });
    actions.push({ key: 'remove', label: '移出群聊', danger: true });
    return actions;
  }

  if (canRemoveMember(detail, myId, target)) {
    actions.push({ key: 'remove', label: '移出群聊', danger: true });
  }

  return actions;
}

export default {
  DEFAULT_PERMISSIONS,
  myRoleOf,
  permissionsOf,
  isOwner,
  isGroupAdmin,
  canManageProfile,
  canSpeak,
  canInvite,
  canMentionAll,
  canManagePermissions,
  canRemoveMember,
  memberActions,
};
