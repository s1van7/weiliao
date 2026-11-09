/**
 * 「最近使用」本地存储：localStorage `wx.recent`，最多 16 条。
 *
 * 条目结构：{ t: 'emoji' | 'sticker', v: string }
 *   - t === 'emoji'   时 v 是 emoji 字符
 *   - t === 'sticker' 时 v 是表情图片地址（/uploads/xxx.png）
 *
 * 设计取舍：最近使用是纯个人 UI 偏好，跨设备同步价值低，放 localStorage 即可，
 * 避免「每发一条消息就多一次写库」。
 */

/** localStorage key */
const RECENT_KEY = 'wx.recent';

/** 最多保留条数 */
export const RECENT_MAX = 16;

/**
 * 判断条目是否合法。
 * @param {unknown} item
 * @returns {boolean}
 */
function isValidItem(item) {
  if (!item || typeof item !== 'object') return false;
  const type = item.t;
  const value = item.v;
  if (type !== 'emoji' && type !== 'sticker') return false;
  return typeof value === 'string' && value.length > 0;
}

/**
 * 读取最近使用列表（新 → 旧）。任何异常（隐私模式 / 脏数据）都返回空数组。
 * @returns {Array<{t: 'emoji'|'sticker', v: string}>}
 */
export function popRecents() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidItem).slice(0, RECENT_MAX).map((item) => ({ t: item.t, v: item.v }));
  } catch {
    return [];
  }
}

/**
 * 写入最近使用列表（覆盖式，自动截断到 16 条）。
 * @param {Array<{t: 'emoji'|'sticker', v: string}>} list
 * @returns {void}
 */
function persist(list) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    /* 隐私模式 / 配额满：静默降级，最近使用丢失不影响主流程 */
  }
}

/**
 * 把一条记录推到最前（同 type + value 去重，超出 16 条丢弃最旧）。
 * @param {{t: 'emoji'|'sticker', v: string}} item 待记录项
 * @returns {Array<{t: 'emoji'|'sticker', v: string}>} 更新后的完整列表
 */
export function pushRecent(item) {
  if (!isValidItem(item)) return popRecents();
  const current = popRecents();
  const next = [{ t: item.t, v: item.v }, ...current.filter((row) => !(row.t === item.t && row.v === item.v))];
  const trimmed = next.slice(0, RECENT_MAX);
  persist(trimmed);
  return trimmed;
}

/**
 * 清空最近使用（表情管理页「清空最近使用」入口用）。
 * @returns {void}
 */
export function clearRecents() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* 忽略 */
  }
}

export default { RECENT_MAX, popRecents, pushRecent, clearRecents };
