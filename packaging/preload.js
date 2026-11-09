/**
 * 桌面端 preload：通过 contextBridge 暴露最小能力集（contextIsolation=true，禁止 nodeIntegration）。
 *
 * platform / version 供前端做平台判定；
 * openExternal 供「检查更新」调用系统浏览器下载安装包（WebView 内无法下载 exe）。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('weiliaoDesktop', {
  platform: process.platform,
  version: process.versions.electron,
  /** 用系统默认浏览器打开 URL（仅允许 http/https） */
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
});
