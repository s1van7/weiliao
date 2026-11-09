/**
 * 应用入口：
 *   1. 挂载 React 根节点（含 ErrorBoundary，异常不白屏）；
 *   2. load 后注册 Service Worker，发现 waiting 时通知 App 显示「有新版本」；
 *   3. 移除 index.html 中的启动占位。
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

/**
 * 全局错误边界：任何渲染异常都降级为友好提示，而不是白屏。
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[app] render error:', error, info);
  }

  handleReload() {
    window.location.reload();
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[#EDEDED] px-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#07C160] text-white">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3.6 21 19.2H3L12 3.6Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M12 9.2v4.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="12" cy="16.2" r="1" fill="currentColor" />
            </svg>
          </div>
          <p className="text-[17px] font-semibold text-[#111]">页面出了点问题</p>
          <p className="max-w-[320px] text-[13px] leading-relaxed text-[#888]">
            请尝试刷新页面；若问题持续存在，可以退出后重新登录。
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="h-[44px] rounded-lg bg-[#07C160] px-6 text-[15px] font-medium text-white active:bg-[#06AD56]"
          >
            刷新页面
          </button>
          <pre className="max-h-32 max-w-full overflow-auto rounded bg-black/5 p-2 text-left text-[11px] text-[#999]">
            {String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

/** 注册 Service Worker（仅生产构建且浏览器支持时） */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;

  // 新 SW 接管后自动刷新一次，避免用户停留在旧页面上看不到新功能
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    // 带版本查询参数：绕过浏览器对 sw.js 的 HTTP 缓存，保证新版本能立即生效
    navigator.serviceWorker
      .register('./sw.js?v=3')
      .then((registration) => {
        registration.update().catch(() => undefined);
        if (registration.waiting) {
          window.dispatchEvent(new CustomEvent('wx:sw-update'));
        }
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent('wx:sw-update'));
            }
          });
        });
      })
      .catch((err) => {
        console.warn('[sw] register failed:', err);
      });
  });
}

const container = document.getElementById('root');
const splash = document.getElementById('boot-splash');
if (splash && splash.parentNode) splash.parentNode.removeChild(splash);

createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

registerServiceWorker();
