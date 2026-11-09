/**
 * 分片上传领域服务：init / chunk / complete 三阶段。
 *
 * 约定：
 *   - 文件 IO 在事务外（写 .chunks、流式合并、sha256 流式计算、删分片目录）；
 *   - DB 更新在事务内（uploaded_chunks JSON、status / final_url）；
 *   - 秒传 / 断点续传按 hash 定位；同一 hash 完成后的最终文件可跨账号共享。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CHUNK_DIR, db, now, tx, UPLOAD_DIR } from '../db.js';
import { ApiError } from './http.js';
import { toInt } from './serialize.js';
import { fileExtOf, sanitizeFileName } from './media.js';

/** 单片大小（5MB） */
export const UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024;

/** 单文件上限（2GB，可用 UPLOAD_FILE_MAX_BYTES 覆盖） */
export const UPLOAD_FILE_MAX_BYTES = Number(process.env.UPLOAD_FILE_MAX_BYTES) || 2 * 1024 * 1024 * 1024;

/** hash 必须是 64 位小写 hex（sha256） */
const HASH_PATTERN = /^[a-f0-9]{64}$/;

/** file_id 只允许 UUID / 安全短串，杜绝路径穿越 */
const FILE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/**
 * 取某次上传记录（不存在返回 null）。
 * @param {string} fileId
 * @returns {Record<string, unknown>|null}
 */
function findUpload(fileId) {
  return db.prepare('SELECT * FROM upload_files WHERE file_id = ?').get(fileId) ?? null;
}

/**
 * 读取并解析 uploaded_chunks JSON（非法时回退空数组）。
 * @param {Record<string, unknown>|null|undefined} row
 * @returns {number[]}
 */
function uploadedChunksOf(row) {
  try {
    const parsed = JSON.parse(String(row?.uploaded_chunks ?? '[]'));
    if (Array.isArray(parsed)) return parsed.map(Number).filter((n) => Number.isInteger(n) && n >= 0);
  } catch {
    /* 回退空数组 */
  }
  return [];
}

/**
 * 初始化上传：hash 已 done → 秒传；uploading → 续传；否则新建记录。
 * @param {{hash:unknown, size:unknown, chunk_size:unknown, file_name:unknown}} input
 * @returns {{existed:boolean, url?:string, file_name?:string, file_id?:string, chunk_total?:number, uploaded_chunks?:number[]}}
 */
export function initUpload({ hash, size, chunk_size, file_name }) {
  const hashValue = typeof hash === 'string' ? hash.trim() : '';
  if (!HASH_PATTERN.test(hashValue)) {
    throw new ApiError(400, 'INVALID_PARAM', 'hash 必须是 64 位小写 hex（sha256）');
  }

  const sizeValue = toInt(size, 0);
  if (sizeValue <= 0) {
    throw new ApiError(400, 'INVALID_PARAM', '文件大小需大于 0');
  }
  if (sizeValue > UPLOAD_FILE_MAX_BYTES) {
    throw new ApiError(413, 'FILE_TOO_LARGE', `文件不能超过 ${UPLOAD_FILE_MAX_BYTES} 字节`);
  }

  const chunkSize = toInt(chunk_size, 0);
  if (chunkSize <= 0 || chunkSize > UPLOAD_CHUNK_SIZE) {
    throw new ApiError(400, 'INVALID_PARAM', `分片大小需在 1-${UPLOAD_CHUNK_SIZE} 字节之间`);
  }

  const chunkTotal = Math.ceil(sizeValue / chunkSize);
  const fileName = sanitizeFileName(file_name);
  if (!fileName) {
    throw new ApiError(400, 'INVALID_PARAM', '文件名不能为空');
  }

  // 秒传：同 hash 已有完成文件
  const done = db
    .prepare("SELECT * FROM upload_files WHERE hash = ? AND status = 'done' ORDER BY id DESC LIMIT 1")
    .get(hashValue);
  if (done) {
    return {
      existed: true,
      url: String(done.final_url ?? ''),
      file_name: String(done.file_name ?? fileName),
    };
  }

  // 续传：同 hash 有未完成记录
  const uploading = db
    .prepare("SELECT * FROM upload_files WHERE hash = ? AND status = 'uploading' ORDER BY id ASC LIMIT 1")
    .get(hashValue);
  if (uploading) {
    return {
      existed: false,
      file_id: String(uploading.file_id),
      chunk_total: Number(uploading.chunk_total ?? chunkTotal),
      uploaded_chunks: uploadedChunksOf(uploading),
    };
  }

  // 新建记录（只写库，事务内）
  const fileId = crypto.randomUUID();
  tx(() => {
    db.prepare(
      `INSERT INTO upload_files (file_id, hash, size, chunk_size, chunk_total, uploaded_chunks, status, final_url, file_name, created_at)
       VALUES (?, ?, ?, ?, ?, '[]', 'uploading', '', ?, ?)`,
    ).run(fileId, hashValue, sizeValue, chunkSize, chunkTotal, fileName, now());
  });

  return { existed: false, file_id: fileId, chunk_total: chunkTotal, uploaded_chunks: [] };
}

/**
 * 保存单个分片（幂等）：先落盘 CHUNK_DIR/<file_id>/<index>，再事务内更新 uploaded_chunks。
 * @param {string} fileId
 * @param {number} index
 * @param {Buffer} buf
 * @returns {{index:number}}
 */
export function saveChunk(fileId, index, buf) {
  const id = String(fileId ?? '');
  if (!FILE_ID_PATTERN.test(id)) {
    throw new ApiError(400, 'INVALID_PARAM', 'file_id 不合法');
  }
  if (!Number.isInteger(index) || index < 0) {
    throw new ApiError(400, 'INVALID_PARAM', 'index 不合法');
  }

  const row = findUpload(id);
  if (!row) {
    throw new ApiError(404, 'UPLOAD_NOT_FOUND', '上传任务不存在');
  }
  if (row.status !== 'uploading') {
    throw new ApiError(409, 'CONFLICT', '该上传任务已结束');
  }
  if (index >= Number(row.chunk_total ?? 0)) {
    throw new ApiError(400, 'INVALID_PARAM', 'index 超出分片范围');
  }
  if (!buf || buf.length === 0 || buf.length > UPLOAD_CHUNK_SIZE) {
    throw new ApiError(400, 'INVALID_PARAM', `分片内容需在 1-${UPLOAD_CHUNK_SIZE} 字节之间`);
  }

  // 文件 IO 在事务外
  const dir = path.join(CHUNK_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, String(index)), buf);

  // DB 更新在事务内
  tx(() => {
    const current = findUpload(id);
    const chunks = uploadedChunksOf(current);
    const set = new Set(chunks);
    set.add(index);
    const sorted = [...set].sort((a, b) => a - b);
    db.prepare('UPDATE upload_files SET uploaded_chunks = ? WHERE file_id = ?').run(JSON.stringify(sorted), id);
  });

  return { index };
}

/**
 * 带背压控制地把一个 Buffer 写入流（false 时等待 drain）。
 * @param {import('node:fs').WriteStream} ws
 * @param {Buffer} buf
 * @returns {Promise<void>}
 */
function writeWithBackpressure(ws, buf) {
  return new Promise((resolve, reject) => {
    let settled = false;
    /**
     * 结束本次写入（只结算一次，同时清理监听器）。
     * @param {(arg?: unknown) => void} fn resolve / reject
     * @param {unknown} [arg]
     * @returns {void}
     */
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      ws.removeListener('error', onError);
      ws.removeListener('drain', onDrain);
      fn(arg);
    };
    const onError = (err) => finish(reject, err);
    const onDrain = () => finish(resolve);

    ws.once('error', onError);
    if (ws.write(buf)) {
      finish(resolve);
    } else {
      ws.once('drain', onDrain);
    }
  });
}

/**
 * 完成分片上传：校验齐全 → 流式合并 → 校验 size → 流式 sha256 → 落库 → 删分片目录。
 * @param {string} fileId
 * @returns {{url:string, file_id:string, file_name:string, size:number}}
 */
export async function completeUpload(fileId) {
  const id = String(fileId ?? '');
  if (!FILE_ID_PATTERN.test(id)) {
    throw new ApiError(400, 'INVALID_PARAM', 'file_id 不合法');
  }

  const row = findUpload(id);
  if (!row) {
    throw new ApiError(404, 'UPLOAD_NOT_FOUND', '上传任务不存在');
  }
  if (row.status === 'done') {
    return {
      url: String(row.final_url ?? ''),
      file_id: id,
      file_name: String(row.file_name ?? ''),
      size: Number(row.size ?? 0),
    };
  }
  if (row.status !== 'uploading') {
    throw new ApiError(409, 'CONFLICT', '该上传任务状态异常');
  }

  const chunkTotal = Number(row.chunk_total ?? 0);
  const uploaded = uploadedChunksOf(row);
  const uploadedSet = new Set(uploaded);
  const missing = [];
  for (let index = 0; index < chunkTotal; index += 1) {
    if (!uploadedSet.has(index)) missing.push(index);
  }
  if (missing.length > 0) {
    throw new ApiError(409, 'CHUNK_MISSING', `缺少 ${missing.length} 个分片，请重传`, { missing });
  }

  const chunkDir = path.join(CHUNK_DIR, id);
  const ext = fileExtOf(String(row.file_name ?? ''));
  const finalName = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const finalPath = path.join(UPLOAD_DIR, finalName);

  // 流式合并（事务外）：逐片读入内存（单片 ≤5MB）按顺序写入，await drain 控制背压
  const ws = fs.createWriteStream(finalPath, { flags: 'wx' });
  for (let index = 0; index < chunkTotal; index += 1) {
    const chunkPath = path.join(chunkDir, String(index));
    if (!fs.existsSync(chunkPath)) {
      ws.destroy();
      throw new ApiError(409, 'CHUNK_MISSING', `分片 ${index} 缺失`);
    }
    const buf = await fs.promises.readFile(chunkPath);
    await writeWithBackpressure(ws, buf);
  }
  await new Promise((resolve, reject) => {
    ws.end((err) => (err ? reject(err) : resolve()));
  });

  // 校验最终大小
  let actualSize = 0;
  try {
    actualSize = fs.statSync(finalPath).size;
  } catch {
    actualSize = 0;
  }
  if (actualSize !== Number(row.size ?? 0)) {
    cleanup(finalPath, chunkDir);
    throw new ApiError(400, 'SIZE_MISMATCH', '文件大小校验失败');
  }

  // 流式 sha256 比对
  const hasher = crypto.createHash('sha256');
  try {
    for await (const chunk of fs.createReadStream(finalPath)) {
      hasher.update(chunk);
    }
  } catch (err) {
    cleanup(finalPath, chunkDir);
    throw new ApiError(500, 'INTERNAL_ERROR', '文件校验失败');
  }
  const digest = hasher.digest('hex');
  if (digest !== String(row.hash ?? '')) {
    cleanup(finalPath, chunkDir);
    throw new ApiError(400, 'HASH_MISMATCH', '文件哈希校验失败');
  }

  const finalUrl = `/uploads/${finalName}`;

  // DB 更新在事务内
  tx(() => {
    db.prepare("UPDATE upload_files SET status = 'done', final_url = ? WHERE file_id = ?").run(finalUrl, id);
  });

  // 合并成功后才删分片目录
  fs.rmSync(chunkDir, { recursive: true, force: true });

  return {
    url: finalUrl,
    file_id: id,
    file_name: String(row.file_name ?? ''),
    size: Number(row.size ?? 0),
  };
}

/**
 * 校验失败时清理已合并文件与分片目录。
 * @param {string} finalPath
 * @param {string} chunkDir
 * @returns {void}
 */
function cleanup(finalPath, chunkDir) {
  try {
    fs.rmSync(finalPath, { force: true });
  } catch {
    /* 忽略 */
  }
  try {
    fs.rmSync(chunkDir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

export default { UPLOAD_CHUNK_SIZE, UPLOAD_FILE_MAX_BYTES, initUpload, saveChunk, completeUpload };
