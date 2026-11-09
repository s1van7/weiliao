/**
 * 左右滑动切换 Tab 的包裹容器（移动端 / 触屏笔记本 / 平板通用）。
 *
 * 设计原则（最小变更）：
 *   - 不加任何视觉动画、不改变子元素布局，只透传 children；
 *   - 不设置 touchAction，避免破坏子页面内部的横向滚动（朋友圈图片、图片预览等）；
 *   - touchmove 中一旦判定为纵向滚动，立刻作废本次手势，且从不调用 preventDefault()，
 *     保证原生纵向滚动与内部横向滚动完全不受影响。
 *
 * 触发条件（严格，防误触）：
 *   enabled === true 且 |dx| >= 60 且 |dx| > |dy| * 1.5 且 |dy| <= 50。
 * 方向：dx < 0（左滑）→ 下一个 Tab；dx > 0（右滑）→ 上一个 Tab；到头不循环。
 */
import { useRef } from 'react';

/** Tab 顺序（与 components/TabBar.jsx 的 ITEMS、useUI 的 TAB_ROUTES 保持一致） */
export const TAB_ORDER = Object.freeze(['chats', 'contacts', 'discover', 'me']);

/** 触发滑动的最小横向位移（px） */
const MIN_DX = 60;
/** 允许的最大纵向位移（px），超过视为滚动 */
const MAX_DY = 50;
/** 横向位移必须明显大于纵向位移的倍数 */
const DX_DY_RATIO = 1.5;

/**
 * 左右滑动切 Tab。
 * @param {{
 *   current: 'chats'|'contacts'|'discover'|'me'|'',
 *   onChange?: (next: 'chats'|'contacts'|'discover'|'me') => void,
 *   children?: any,
 *   enabled?: boolean,
 *   className?: string,
 * }} props
 * @returns {JSX.Element}
 */
export default function SwipeTabs({ current, onChange, children, enabled = false, className = 'h-full' }) {
  // 一次手势的状态：active=手指按下中，invalid=已判定为滚动、放弃本次手势
  const gestureRef = useRef({ active: false, invalid: false, startX: 0, startY: 0 });

  /**
   * 手指按下：记录起点。
   * @param {React.TouchEvent} event
   * @returns {void}
   */
  const handleTouchStart = (event) => {
    if (!enabled) return;
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    gestureRef.current = { active: true, invalid: false, startX: touch.clientX, startY: touch.clientY };
  };

  /**
   * 手指移动：判定为纵向滚动就作废本次手势（不 preventDefault，保留原生滚动）。
   * @param {React.TouchEvent} event
   * @returns {void}
   */
  const handleTouchMove = (event) => {
    const gesture = gestureRef.current;
    if (!gesture.active || gesture.invalid) return;
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    const dx = Math.abs(touch.clientX - gesture.startX);
    const dy = Math.abs(touch.clientY - gesture.startY);
    if (dy > dx) gesture.invalid = true;
  };

  /**
   * 手指抬起：满足阈值与方向即切换 Tab。
   * @param {React.TouchEvent} event
   * @returns {void}
   */
  const handleTouchEnd = (event) => {
    const gesture = gestureRef.current;
    if (!gesture.active) return;
    gesture.active = false;
    if (!enabled || gesture.invalid) {
      gestureRef.current = { active: false, invalid: false, startX: 0, startY: 0 };
      return;
    }

    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch) return;

    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;

    if (Math.abs(dx) < MIN_DX) return;
    if (Math.abs(dy) > MAX_DY) return;
    if (Math.abs(dx) <= Math.abs(dy) * DX_DY_RATIO) return;

    const index = TAB_ORDER.indexOf(current);
    if (index < 0) return;

    const nextIndex = dx < 0 ? index + 1 : index - 1;
    // 到头不循环：第一个再右滑、最后一个再左滑都无动作
    if (nextIndex < 0 || nextIndex >= TAB_ORDER.length) return;

    if (typeof onChange === 'function') onChange(TAB_ORDER[nextIndex]);
  };

  /**
   * 手势被打断（来电、系统手势等）：清空状态。
   * @returns {void}
   */
  const handleTouchCancel = () => {
    gestureRef.current = { active: false, invalid: false, startX: 0, startY: 0 };
  };

  return (
    <div
      className={className}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {children}
    </div>
  );
}
