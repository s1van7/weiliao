/**
 * Android 返回键处理（仅 Capacitor 原生平台）。
 * 纯 Web 环境不注册任何监听，直接返回；原生平台注册 backButton 后即接管返回键，
 * 不再走默认退出流程，改由前端决定「返回上一级」还是「退出应用」。
 */
import { App } from '@capacitor/app';
import { useUI } from '../store/useUI';

/** 是否已注册返回键监听（模块级，避免重复注册） */
let initialized = false;

/**
 * 初始化 Capacitor Android 返回键。
 * 已注册过、无 window 或非原生平台时直接返回。
 * @returns {void}
 */
export function initBackButton() {
  if (initialized) return;
  if (typeof window === 'undefined') return;
  if (
    !window.Capacitor ||
    typeof window.Capacitor.isNativePlatform !== 'function' ||
    !window.Capacitor.isNativePlatform()
  ) {
    return;
  }

  initialized = true;

  App.addListener('backButton', () => {
    const ui = useUI.getState();
    // 有历史栈 → 返回上一级；否则已在 Tab 根页 → 退出应用
    if (ui.history.length > 0) {
      ui.back();
    } else {
      App.exitApp();
    }
  });
}

export default initBackButton;
