/**
 * 接口错误码 → 用户可读文案。
 *
 * 后端在 ApiError 里带机器可读 code（见 server/lib/groupAuth.js、lib/stickers.js、lib/moments.js），
 * 中文 message 已足够友好，但少数场景需要更贴合前端上下文（例如「@所有人」限制）。
 * 这里只做补充映射，未命中的 code 一律回落到 err.message。
 */

/** code → 文案 */
const TEXT_BY_CODE = Object.freeze({
  NOT_ADMIN: '仅群主和管理员可操作',
  NOT_OWNER: '仅群主可操作',
  SPEAK_FORBIDDEN: '当前群仅群主和管理员可发言',
  INVITE_FORBIDDEN: '当前群仅群主和管理员可邀请新成员',
  REMOVE_FORBIDDEN: '当前群仅群主可移除成员',
  ADMIN_PROTECTED: '管理员不能移除其他管理员',
  OWNER_PROTECTED: '群主不能被移除或降级',
  MENTION_FORBIDDEN: '@所有人 仅群主和管理员可用',
  STICKER_LIMIT: '自定义表情已达上限（100 个）',
  STICKER_URL_INVALID: '表情地址不合法，请重新上传',
  MOMENT_EMPTY: '说点什么或选张图片吧',
  TOO_MANY_IMAGES: '最多选择 9 张图片',
  MOMENT_NOT_FOUND: '动态不存在或已删除',
  FORBIDDEN: '你没有权限执行这个操作',
  NOT_FRIEND: '对方还不是你的好友',
  GROUP_FULL: '群聊人数已达上限',
  BLOCKED: '你已拉黑对方，无法发送消息或通话',
  BLOCKED_BY_PEER: '消息已发出，但被对方拒收',
  PAIR_NOT_FOUND: '数字码不存在或已过期',
  PAIR_FULL: '面对面传文件最多 2 人',
  PAIR_TOO_FEW: '面对面建群至少 3 人（含自己）',
  GROUP_INVITE_INVALID: '群邀请无效或已过期',
});

/**
 * 把接口错误转成可展示文案。
 * @param {Record<string, any>|null|undefined} err 通常为 ApiError
 * @param {string} [fallback] 兜底文案
 * @returns {string}
 */
export function errorText(err, fallback = '操作失败，请重试') {
  if (!err) return fallback;
  const code = err.code;
  if (code && TEXT_BY_CODE[code]) return TEXT_BY_CODE[code];
  return err.message || fallback;
}

export default { errorText };
