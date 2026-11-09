/**
 * 本地视频时长读取：用 <video> + objectURL + loadedmetadata 事件解析时长（秒）。
 * 解析失败返回 0（由调用方决定是否回退），不阻塞视频发送。
 */

/** 元数据读取超时（毫秒），超时按失败处理返回 0 */
const METADATA_TIMEOUT_MS = 8000;

/**
 * 读取本地视频文件的时长（秒，取整）。
 * @param {File|Blob} file 本地视频文件
 * @returns {Promise<number>} 时长秒数；失败返回 0
 */
export function readVideoDuration(file) {
  return new Promise((resolve) => {
    if (!file || typeof URL === 'undefined' || typeof document === 'undefined') {
      resolve(0);
      return;
    }

    let objectUrl = '';
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      resolve(0);
      return;
    }

    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    let settled = false;

    /**
     * 收尾：清理 objectURL 与 video，避免内存泄漏。
     * @param {number} value 时长秒数
     * @returns {void}
     */
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        /* 忽略 */
      }
      try {
        video.removeAttribute('src');
        video.load();
      } catch {
        /* 忽略 */
      }
      resolve(value);
    };

    const timer = setTimeout(() => finish(0), METADATA_TIMEOUT_MS);

    video.onloadedmetadata = () => {
      clearTimeout(timer);
      const seconds = Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration) : 0;
      finish(seconds);
    };
    video.onerror = () => {
      clearTimeout(timer);
      finish(0);
    };

    video.src = objectUrl;
  });
}

export default readVideoDuration;
