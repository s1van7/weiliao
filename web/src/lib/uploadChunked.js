/**
 * 分片上传管线：hash → init（秒传 / 续传）→ 逐片 uploadChunk → complete。
 * 不引入任何依赖，hash 用纯 JS 增量 SHA-256，请求统一走 api.js。
 */
import { UPLOAD_CHUNK_SIZE } from '../config';
import { api } from '../api';
import { hashFileHex } from './hash';

/**
 * 分片上传一个文件。
 * @param {File} file
 * @param {(progress: {loaded: number, total: number, percent: number}) => void} [onProgress] 进度回调
 * @returns {Promise<{url: string, file_id: string, file_name: string, file_size: number}>}
 */
export async function uploadFileChunked(file, onProgress) {
  if (!file) throw new Error('文件不存在');

  const size = file.size;
  const chunkSize = UPLOAD_CHUNK_SIZE;
  const hash = await hashFileHex(file, { chunkSize });

  const init = await api.uploadInit({ hash, size, chunk_size: chunkSize, file_name: file.name });

  // 秒传：服务端已有同 hash 完成文件
  if (init.existed) {
    if (onProgress) onProgress({ loaded: size, total: size, percent: 100 });
    return {
      url: String(init.url || ''),
      file_id: '',
      file_name: String(init.file_name || file.name),
      file_size: size,
    };
  }

  const fileId = String(init.file_id || '');
  const chunkTotal = Number(init.chunk_total) || Math.ceil(size / chunkSize);
  const uploadedSet = new Set((init.uploaded_chunks || []).map(Number));

  let loaded = Math.min(uploadedSet.size * chunkSize, size);
  if (onProgress) onProgress({ loaded, total: size, percent: percentOf(loaded, size) });

  for (let index = 0; index < chunkTotal; index += 1) {
    if (uploadedSet.has(index)) continue;
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, size);
    const blob = file.slice(start, end);
    await api.uploadChunk(fileId, index, blob);
    uploadedSet.add(index);
    loaded = Math.min(uploadedSet.size * chunkSize, size);
    if (onProgress) onProgress({ loaded, total: size, percent: percentOf(loaded, size) });
  }

  const complete = await api.uploadComplete(fileId);
  if (onProgress) onProgress({ loaded: size, total: size, percent: 100 });

  return {
    url: String(complete.url || ''),
    file_id: fileId,
    file_name: String(complete.file_name || file.name),
    file_size: Number(complete.size) || size,
  };
}

/**
 * 计算百分比（0..100 整数）。
 * @param {number} loaded
 * @param {number} total
 * @returns {number}
 */
function percentOf(loaded, total) {
  if (!total) return 0;
  const percent = Math.floor((loaded / total) * 100);
  return Math.max(0, Math.min(100, percent));
}

export default uploadFileChunked;
