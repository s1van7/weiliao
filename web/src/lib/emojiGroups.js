/**
 * 系统 emoji 分组常量（全部手写 Unicode 字符，不联网、不引第三方库、不用图片素材）。
 *
 * 结构：{ key, name, icon, emojis }
 *   - key    分组唯一标识（用于选中态与 localStorage）
 *   - name   中文分组名（面板顶部展示 / 无障碍标签）
 *   - icon   分组图标，直接复用组内代表 emoji 字符
 *   - emojis 该组全部 emoji
 *
 * 说明：不按肤色 / 变体做展开，避免长列表里出现视觉重复项。
 */

/** 笑脸与情绪 */
const SMILEY = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
  '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩',
  '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜',
  '🤪', '😝', '🤗', '🤭', '🤫', '🤔', '🤨', '😐',
  '😑', '😶', '😏', '😒', '🙄', '😬', '😮', '😴',
  '😪', '😷', '🤒', '🤕', '😵', '🤯', '🥳', '😎',
  '😕', '😟',
];

/** 手势与身体 */
const GESTURE = [
  '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏',
  '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆',
  '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜',
  '👏', '🙌', '👐', '🤲', '🤝', '🙏', '💪', '🦾',
  '✍️', '💅', '👀', '👁️', '🫶', '🫰', '🙋', '🙆',
  '🙅', '🤷', '🤦', '🧠',
];

/** 食物与饮品 */
const FOOD = [
  '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓',
  '🍒', '🍑', '🍍', '🥥', '🥝', '🍅', '🥑', '🥦',
  '🥕', '🌽', '🌶️', '🥒', '🍄', '🥜', '🍞', '🥐',
  '🥖', '🧀', '🍳', '🍔', '🍟', '🍕', '🌭', '🥪',
  '🌮', '🍜', '🍚', '🍣', '🍤', '🍦', '🍰', '🎂',
  '🍫', '🍬', '🍭', '🍺', '🍻', '🍷', '🍵', '☕',
];

/** 动物与自然 */
const ANIMAL = [
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
  '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈',
  '🙉', '🙊', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅',
  '🦉', '🦄', '🐝', '🦋', '🐌', '🐞', '🐢', '🐍',
  '🐙', '🦑', '🦐', '🦀', '🐠', '🐟', '🐬', '🐳',
  '🦈', '🐊', '🐘', '🦒', '🐎', '🐑', '🐕', '🐈',
];

/** 符号与心情 */
const SYMBOL = [
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
  '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘',
  '💝', '✨', '⭐', '🌟', '💫', '⚡', '🔥', '💥',
  '💦', '💨', '🎉', '🎊', '🎈', '🎁', '🏆', '🥇',
  '🎯', '💯', '✅', '❌', '❓', '❗', '💤', '💬',
  '👑', '💎', '🌹', '🌸', '🌻', '🌞', '🌙', '☀️',
];

/**
 * 分组列表（顺序即面板顶部横向分组条的顺序，「最近使用」「我的表情」由面板自行拼在最前 / 最后）。
 * @type {Array<{key: string, name: string, icon: string, emojis: string[]}>}
 */
export const EMOJI_GROUPS = Object.freeze([
  { key: 'smiley', name: '笑脸', icon: '😊', emojis: SMILEY },
  { key: 'gesture', name: '手势', icon: '👍', emojis: GESTURE },
  { key: 'food', name: '食物', icon: '🍎', emojis: FOOD },
  { key: 'animal', name: '动物', icon: '🐶', emojis: ANIMAL },
  { key: 'symbol', name: '符号', icon: '❤️', emojis: SYMBOL },
]);

/**
 * 按 key 取分组。
 * @param {string} key 分组标识
 * @returns {{key: string, name: string, icon: string, emojis: string[]}|null}
 */
export function findEmojiGroup(key) {
  return EMOJI_GROUPS.find((group) => group.key === key) || null;
}

/**
 * 全部 emoji 的扁平列表（供最近使用校验 / 测试用）。
 * @returns {string[]}
 */
export function allEmojis() {
  return EMOJI_GROUPS.reduce((list, group) => list.concat(group.emojis), []);
}

export default { EMOJI_GROUPS, findEmojiGroup, allEmojis };
