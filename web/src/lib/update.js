/**
 * 客户端更新工具：平台识别、版本比较、打开下载链接。
 *
 * 三端同源，但「下载后如何安装」各平台不同：
 *   - Web：浏览器直接下载（a[download]）；
 *   - Android：优先调原生 DownloadManager（应用内下载并自动拉起安装器）；
 *     没有原生桥时退化为系统浏览器下载；
 *   - iOS：交给系统浏览器（Capacitor 对非本地 URL 走 ACTION_VIEW）；
 *   - Windows（Electron）：通过 preload 暴露的 openExternal 调系统浏览器。
 */
import { SERVER_URL } from '../config';

/**
 * 当前运行平台。
 * @returns {'android'|'ios'|'windows'|'web'}
 */
export function currentPlatform() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) {
    const name = typeof cap.getPlatform === 'function' ? cap.getPlatform() : '';
    if (name === 'android') return 'android';
    if (name === 'ios') return 'ios';
  }
  if (typeof window !== 'undefined' && window.weiliaoDesktop) return 'windows';
  if (typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent || '')) return 'windows';
  return 'web';
}

/**
 * 平台展示名（用于「检查更新」弹窗文案）。
 * @param {string} platform
 * @returns {string}
 */
export function platformLabel(platform) {
  if (platform === 'android') return 'Android';
  if (platform === 'ios') return 'iOS';
  if (platform === 'windows') return 'Windows';
  return '网页版';
}

/**
 * 把 "1.2.3" 解析为数字数组（缺失段补 0，忽略 -beta 之类的后缀）。
 * @param {string} version
 * @returns {number[]}
 */
function parseVersion(version) {
  return String(version ?? '')
    .split('-')[0]
    .split('.')
    .map((part) => {
      const value = Number.parseInt(part, 10);
      return Number.isFinite(value) ? value : 0;
    });
}

/**
 * 比较两个版本号。
 * @param {string} a
 * @param {string} b
 * @returns {number} a>b 返回正数，相等返回 0，a<b 返回负数
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * latest 是否比 current 更新。
 * @param {string} latest
 * @param {string} current
 * @returns {boolean}
 */
export function isNewerVersion(latest, current) {
  return compareVersions(latest, current) > 0;
}

/**
 * 在给定下载列表里挑出当前平台对应的安装包。
 * Web 端按「桌面安装包优先」给 Windows 包，用户也可在弹窗里手动选其它平台。
 * @param {Array<{platform: string, url: string}>} downloads
 * @param {string} platform
 * @returns {{platform: string, url: string}|null}
 */
export function pickDownload(downloads, platform) {
  if (!Array.isArray(downloads) || downloads.length === 0) return null;
  const preferred = platform === 'android' ? 'android' : platform === 'ios' ? 'ios' : 'windows';
  return downloads.find((item) => item.platform === preferred) || downloads[0];
}

/**
 * 拿到可直接访问的绝对下载地址（打包端 SERVER_URL 非空，Web 端为相对路径）。
 * @param {string} url /downloads/xxx.apk 形式的服务端相对路径
 * @returns {string}
 */
export function absoluteDownloadUrl(url) {
  const raw = String(url ?? '');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${SERVER_URL}${raw}`;
}

/**
 * 打开下载链接：按平台选择最合适的下载方式。
 * @param {string} url 服务端相对路径或绝对地址
 * @returns {boolean} 是否已发起下载
 */
export function openDownload(url) {
  const absolute = absoluteDownloadUrl(url);
  if (!absolute) return false;

  const platform = currentPlatform();

  // 桌面端：系统浏览器下载（Electron 默认拦截 window.open，必须走主进程）
  if (platform === 'windows' && window.weiliaoDesktop && typeof window.weiliaoDesktop.openExternal === 'function') {
    try {
      window.weiliaoDesktop.openExternal(absolute);
      return true;
    } catch (err) {
      console.warn('[update] openExternal failed:', err && err.message);
    }
  }

  // Android：优先走原生 DownloadManager（应用内下载 + 自动拉起安装器）
  if (platform === 'android' && window.WeiliaoUpdater && typeof window.WeiliaoUpdater.download === 'function') {
    try {
      const fileName = absolute.split('?')[0].split('/').pop() || 'weiliao-update.apk';
      window.WeiliaoUpdater.download(absolute, fileName);
      return true;
    } catch (err) {
      console.warn('[update] native download failed:', err && err.message);
    }
  }

  // 移动端兜底：Capacitor 会把外部 http(s) 地址交给系统浏览器，下载由系统通知栏接管
  if (platform === 'android' || platform === 'ios') {
    const opened = window.open(absolute, '_blank');
    if (!opened) window.location.href = absolute;
    return true;
  }

  // Web：直接触发下载，避免新开空白页
  try {
    const link = document.createElement('a');
    link.href = absolute;
    link.rel = 'noopener';
    // 去掉 ?v= 查询串，避免保存成带参数的奇怪文件名
    link.download = absolute.split('?')[0].split('/').pop() || '';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  } catch (err) {
    console.warn('[update] anchor download failed:', err && err.message);
    window.location.href = absolute;
    return true;
  }
}

export default {
  currentPlatform,
  platformLabel,
  compareVersions,
  isNewerVersion,
  pickDownload,
  absoluteDownloadUrl,
  openDownload,
};
