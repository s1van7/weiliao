/**
 * 扫码解析工具：优先 BarcodeDetector，失败回退 jsQR。
 * 输入为正在播放的视频元素（ScanPage 的摄像头预览），输出解码后的字符串或 null。
 */
import jsQR from 'jsqr';

/**
 * 用 jsQR 从 video 当前帧解析二维码（纯前端回退方案）。
 * @param {HTMLVideoElement} video
 * @returns {string|null}
 */
function decodeWithJsQR(video) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(video, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const result = jsQR(imageData.data, width, height, { inversionAttempts: 'dontInvert' });
  return result ? result.data : null;
}

/**
 * 从摄像头视频帧解析二维码。
 * @param {HTMLVideoElement} video
 * @returns {Promise<string|null>} 解码文本；未识别到返回 null
 */
export async function decodeQrFromVideo(video) {
  if (!video) return null;

  // 优先用原生 BarcodeDetector（Chromium 系可用，识别率更高）
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const codes = await detector.detect(video);
      if (codes && codes.length > 0) {
        const value = codes[0].rawValue;
        if (value) return value;
      }
    } catch {
      // 原生能力不可用或识别失败，继续走 jsQR 回退
    }
  }

  return decodeWithJsQR(video);
}

export default { decodeQrFromVideo };
