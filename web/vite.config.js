/**
 * 构建配置。
 * base 使用相对路径，保证 Electron（file://）与 Capacitor（capacitor://localhost）下资源可用。
 * 开发期把 /api、/socket.io、/uploads 代理到本地后端。
 *
 * 版本号：构建时读取 web/package.json 的 version 并注入 __APP_VERSION__。
 * 发版只需改 web/package.json 的 version，Web 与三端（Android / Windows / iOS）设置页会同步显示，
 * 不需要再手改任何页面代码。
 */
import fs from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 直接读 package.json 文本，避免新增 import assertion 造成的 Node 版本兼容问题
const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    // 注入为字符串字面量，页面侧用 lib/version.js 的 APP_VERSION 消费
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2019',
    chunkSizeWarningLimit: 900,
  },
});
