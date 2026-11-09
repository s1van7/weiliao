/**
 * 好友对 / 单聊会话 pair_key 计算工具。
 * pair_key 规则：两个用户 id 升序用冒号拼接，例如 3:8。
 */

/**
 * 归一化用户对，返回 [low, high]，保证 low < high。
 * @param {number|string} a
 * @param {number|string} b
 * @returns {[number, number]}
 */
export function orderPair(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x <= 0 || y <= 0) {
    throw new Error(`orderPair 需要合法的用户 id: ${a}, ${b}`);
  }
  if (x === y) {
    throw new Error(`orderPair 不允许相同用户: ${x}`);
  }
  return x < y ? [x, y] : [y, x];
}

/**
 * 计算单聊会话的 pair_key。
 * @param {number|string} a
 * @param {number|string} b
 * @returns {string} 形如 "3:8"
 */
export function pairKey(a, b) {
  const [low, high] = orderPair(a, b);
  return `${low}:${high}`;
}
