/**
 * 深色主题应用工具：在 <html> 上切换 .dark 类。
 * 具体配色由 index.css 中的 .dark 规则兜底，页面可再用 Tailwind 的 dark: 前缀细化。
 */

/** 深色主题 class 名 */
export const DARK_CLASS = 'dark';

/**
 * 应用 / 取消深色主题。
 * @param {boolean} dark
 * @returns {void}
 */
export function applyTheme(dark) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (dark) root.classList.add(DARK_CLASS);
  else root.classList.remove(DARK_CLASS);
}

export default { DARK_CLASS, applyTheme };
