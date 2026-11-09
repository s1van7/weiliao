/**
 * 时间格式化工具：会话列表时间、消息时间分隔条、时间分组判定。
 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 补零。
 * @param {number} value
 * @returns {string}
 */
function pad(value) {
  return String(value).padStart(2, '0');
}

/**
 * 取某时间戳当天 00:00 的时间戳。
 * @param {number} timestamp
 * @returns {number}
 */
function startOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * 自然日差（今天 0 点 - 目标 0 点）。
 * @param {number} timestamp
 * @returns {number}
 */
function dayDiff(timestamp) {
  return Math.round((startOfDay(Date.now()) - startOfDay(timestamp)) / DAY_MS);
}

/**
 * 会话列表时间：今天 HH:mm / 昨天 / 周X / M月D日 / YYYY/M/D。
 * @param {number} timestamp 毫秒
 * @returns {string}
 */
export function formatListTime(timestamp) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const date = new Date(ts);
  const diff = dayDiff(ts);

  if (diff === 0) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (diff === 1) return '昨天';
  if (diff > 1 && diff < 7) return WEEKDAYS[date.getDay()];
  if (diff < 0) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  const now = new Date();
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * 消息时间分隔条：今天 HH:mm / 昨天 HH:mm / 周X HH:mm / M月D日 HH:mm / YYYY年M月D日 HH:mm。
 * @param {number} timestamp 毫秒
 * @returns {string}
 */
export function formatMessageTime(timestamp) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const date = new Date(ts);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const diff = dayDiff(ts);

  if (diff === 0) return time;
  if (diff === 1) return `昨天 ${time}`;
  if (diff > 1 && diff < 7) return `${WEEKDAYS[date.getDay()]} ${time}`;

  const now = new Date();
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

/**
 * 判断两条消息之间是否需要插入时间分隔条（默认 5 分钟）。
 * @param {number} prevTimestamp 上一条消息时间
 * @param {number} currentTimestamp 当前消息时间
 * @param {number} [gap] 间隔阈值（毫秒）
 * @returns {boolean}
 */
export function shouldShowTime(prevTimestamp, currentTimestamp, gap = 5 * 60 * 1000) {
  const current = Number(currentTimestamp);
  if (!Number.isFinite(current) || current <= 0) return false;
  const prev = Number(prevTimestamp);
  if (!Number.isFinite(prev) || prev <= 0) return true;
  return current - prev > gap;
}

/**
 * 相对时间（朋友圈 / 评论用）：
 *   刚刚 / x 分钟前 / x 小时前 / 昨天 HH:mm / MM-DD / YYYY-MM-DD
 * @param {number} timestamp 毫秒
 * @returns {string}
 */
export function relativeTime(timestamp) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return '';

  const diff = Date.now() - ts;
  const date = new Date(ts);
  const diffDay = dayDiff(ts);

  // 未来时间（客户端时钟偏差）按「刚刚」处理，避免出现「-3 分钟前」
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / (60 * 1000)))} 分钟前`;
  if (diffDay === 0) return `${Math.max(1, Math.floor(diff / (60 * 60 * 1000)))} 小时前`;

  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (diffDay === 1) return `昨天 ${time}`;

  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (date.getFullYear() === new Date().getFullYear()) return monthDay;
  return `${date.getFullYear()}-${monthDay}`;
}

/**
 * 纯日期：YYYY/M/D（好友添加日期 / 新的朋友日期口径）。
 * @param {number} timestamp 毫秒
 * @returns {string}
 */
export function formatDateOnly(timestamp) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const date = new Date(ts);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

export default { formatListTime, formatMessageTime, shouldShowTime, relativeTime, formatDateOnly };
