/**
 * 通用 React hooks：响应式断点、防抖、点击外部、定时刷新、页面可见性。
 */
import { useEffect, useRef, useState } from 'react';

/**
 * 媒体查询匹配。
 * @param {string} query 例如 '(min-width: 768px)'
 * @returns {boolean}
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const handler = (event) => setMatches(event.matches);
    setMatches(mql.matches);
    if (mql.addEventListener) mql.addEventListener('change', handler);
    else mql.addListener(handler);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler);
      else mql.removeListener(handler);
    };
  }, [query]);

  return matches;
}

/**
 * 是否桌面端（≥768px，对应 Tailwind 的 md 断点）。
 * @returns {boolean}
 */
export function useIsDesktop() {
  return useMediaQuery('(min-width: 768px)');
}

/**
 * 是否触摸设备（决定 Enter 是发送还是换行）。
 * @returns {boolean}
 */
export function useIsTouch() {
  const [touch, setTouch] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia('(pointer: coarse)');
    const handler = (event) => setTouch(event.matches);
    if (mql.addEventListener) mql.addEventListener('change', handler);
    else mql.addListener(handler);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler);
      else mql.removeListener(handler);
    };
  }, []);

  return touch;
}

/**
 * 防抖值。
 * @template T
 * @param {T} value
 * @param {number} [delay]
 * @returns {T}
 */
export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/**
 * 点击元素外部触发回调。
 * @param {import('react').RefObject<HTMLElement>} ref
 * @param {(event: MouseEvent|TouchEvent) => void} handler
 * @param {boolean} [enabled]
 * @returns {void}
 */
export function useClickOutside(ref, handler, enabled = true) {
  const saved = useRef(handler);
  saved.current = handler;

  useEffect(() => {
    if (!enabled) return undefined;
    const listener = (event) => {
      const el = ref.current;
      if (!el || el.contains(event.target)) return;
      saved.current(event);
    };
    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener, { passive: true });
    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref, enabled]);
}

/**
 * setInterval 的 hooks 版本（callback 始终指向最新）。
 * @param {() => void} callback
 * @param {number|null} delay 为 null 时停止
 * @returns {void}
 */
export function useInterval(callback, delay) {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (delay === null || delay === undefined) return undefined;
    const timer = setInterval(() => saved.current(), delay);
    return () => clearInterval(timer);
  }, [delay]);
}

/**
 * 周期性重渲染，用于「正在输入」等带过期时间的状态。
 * @param {number} [interval]
 * @returns {number} tick 计数
 */
export function useTick(interval = 1000) {
  const [tick, setTick] = useState(0);
  useInterval(() => setTick((value) => value + 1), interval);
  return tick;
}

export default {
  useMediaQuery,
  useIsDesktop,
  useIsTouch,
  useDebouncedValue,
  useClickOutside,
  useInterval,
  useTick,
};
