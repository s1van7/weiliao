/**
 * 头像图片预处理：居中裁剪为正方形并压缩为 256x256 JPEG。
 *
 * 设计说明：
 *   - 裁剪放在前端做，服务端就不再引入 sharp / canvas 等原生依赖（VPS 装不上）；
 *   - 输出固定 256x256、质量 0.85，单张通常 20KB 上下，远小于服务端 3MB 兜底上限；
 *   - 透明 PNG 先铺白底再转 JPEG，避免透明区域变黑。
 */

/** 头像输出边长（px） */
export const AVATAR_SIZE = 256;

/** JPEG 压缩质量 */
export const AVATAR_QUALITY = 0.85;

/**
 * 把用户选择的图片居中裁剪为正方形并压缩。
 * @param {File} file 用户选择的原始图片
 * @param {{size?: number, quality?: number}} [options] 输出边长与 JPEG 质量
 * @returns {Promise<File>} 裁剪后的 JPEG 文件
 */
export function cropSquareAvatar(file, { size = AVATAR_SIZE, quality = AVATAR_QUALITY } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//i.test(file.type || '')) {
      reject(new Error('请选择图片文件'));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (!width || !height) {
          reject(new Error('图片尺寸异常，请换一张试试'));
          return;
        }

        // 取短边作为裁剪边长，居中裁出正方形
        const side = Math.min(width, height);
        const offsetX = Math.round((width - side) / 2);
        const offsetY = Math.round((height - side) / 2);

        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('当前环境不支持图片裁剪'));
          return;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, offsetX, offsetY, side, side, 0, 0, size, size);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('图片处理失败，请重试'));
              return;
            }
            resolve(new File([blob], `avatar-${Date.now()}.jpg`, { type: 'image/jpeg' }));
          },
          'image/jpeg',
          quality,
        );
      } catch (err) {
        reject(err instanceof Error ? err : new Error('图片处理失败'));
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('图片读取失败，请换一张试试'));
    };

    image.src = objectUrl;
  });
}

export default { cropSquareAvatar, AVATAR_SIZE, AVATAR_QUALITY };
