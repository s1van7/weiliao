/**
 * 语音转文字代理：ffmpeg 转 16k 单声道 PCM wav → 转发 whisper.cpp /inference → 回填 transcript。
 *
 * 约定：
 *   - 只依赖 Node 内置 child_process / fs / os / path / fetch / FormData / Blob；
 *   - 文件 IO（ffmpeg 落盘）在事务外，写 messages.transcript 在事务内；
 *   - 错误码：503 ASR_NOT_CONFIGURED / 504 ASR_TIMEOUT / 502 ASR_FAILED /
 *             500 ASR_CONVERT_FAILED / 400 NOT_VOICE / 403 FORBIDDEN / 404 NOT_FOUND。
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, tx, UPLOAD_DIR } from '../db.js';
import { ApiError } from './http.js';
import { toInt } from './serialize.js';
import { isVoiceUrl } from './media.js';
import { assertMember } from './conversations.js';
import { toSimplified } from './zhHans.js';

/** whisper 推理端点（默认本机 9000） */
const WHISPER_ENDPOINT = typeof process.env.WHISPER_ENDPOINT === 'string'
  ? process.env.WHISPER_ENDPOINT.trim()
  : 'http://127.0.0.1:9000';

/** whisper 推理超时（毫秒） */
const WHISPER_TIMEOUT_MS = Number(process.env.WHISPER_TIMEOUT_MS) || 60000;

/** ffmpeg 转码超时（毫秒） */
const FFMPEG_TIMEOUT_MS = 60000;

/**
 * 解析语音消息来源并做权限校验。
 * @param {Record<string, unknown>} payload {message_id | url}
 * @param {number|string} userId 当前用户
 * @returns {{messageId:number, voiceUrl:string}}
 */
function resolveVoiceMessage(payload, userId) {
  const messageId = toInt(payload.message_id, 0);
  const rawUrl = typeof payload.url === 'string' ? payload.url.trim() : '';

  let row = null;
  if (messageId > 0) {
    row = db
      .prepare('SELECT id, conversation_id, type, voice_url, content, revoked, transcript FROM messages WHERE id = ?')
      .get(messageId);
    if (!row) {
      throw new ApiError(404, 'NOT_FOUND', '消息不存在');
    }
  } else if (rawUrl) {
    row = db
      .prepare("SELECT id, conversation_id, type, voice_url, content, revoked, transcript FROM messages WHERE type = 'voice' AND (voice_url = ? OR content = ?) LIMIT 1")
      .get(rawUrl, rawUrl);
    if (!row) {
      throw new ApiError(404, 'NOT_FOUND', '语音消息不存在');
    }
  } else {
    throw new ApiError(400, 'INVALID_PARAM', 'message_id 或 url 必填其一');
  }

  if (Number(row.revoked ?? 0) === 1) {
    throw new ApiError(404, 'NOT_FOUND', '消息不存在');
  }
  if (row.type !== 'voice') {
    throw new ApiError(400, 'NOT_VOICE', '仅语音消息支持转文字');
  }

  // 转写需要用户仍在会话中（自己语音与对方语音都允许）
  assertMember(Number(row.conversation_id), toInt(userId, 0));

  const voiceUrl = String(row.voice_url || row.content || '');
  if (!isVoiceUrl(voiceUrl)) {
    throw new ApiError(400, 'NOT_VOICE', '语音地址不合法');
  }
  return { messageId: Number(row.id), voiceUrl, transcript: String(row.transcript ?? '') };
}

/**
 * 把 /uploads/<name> 解析为磁盘绝对路径（仅限本机存储）。
 * @param {string} voiceUrl
 * @returns {string}
 */
function resolveLocalPath(voiceUrl) {
  const name = voiceUrl.slice('/uploads/'.length);
  const absolutePath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(absolutePath)) {
    throw new ApiError(404, 'NOT_FOUND', '语音文件不存在');
  }
  return absolutePath;
}

/**
 * ffmpeg 转码为 whisper 需要的 16k 单声道 pcm_s16le wav。
 * @param {string} srcPath
 * @returns {Promise<string>} 临时 wav 文件路径
 */
function convertToWav(srcPath) {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asr-'));
    const wavPath = path.join(tmpDir, `${crypto.randomUUID()}.wav`);
    // -t 60：语音消息本身上限 60s，兜底截断，避免异常长音频拖垮 whisper
    const args = ['-y', '-loglevel', 'error', '-i', srcPath, '-t', '60', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath];

    execFile('ffmpeg', args, { timeout: FFMPEG_TIMEOUT_MS }, (err) => {
      if (err) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          /* 忽略清理失败 */
        }
        reject(new ApiError(500, 'ASR_CONVERT_FAILED', '语音转码失败'));
        return;
      }
      resolve(wavPath);
    });
  });
}

/**
 * 转发 whisper /inference 并解析 text。
 * @param {string} wavPath
 * @returns {Promise<string>}
 */
async function callWhisper(wavPath) {
  if (!WHISPER_ENDPOINT) {
    throw new ApiError(503, 'ASR_NOT_CONFIGURED', '语音识别服务未配置');
  }

  const audio = fs.readFileSync(wavPath);
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'audio.wav');
  form.append('temperature', '0.0');
  form.append('language', 'zh');
  // initial prompt 只用于解码引导（要求输出简体中文），不会出现在识别结果里。
  // whisper 的中文语料偏港台，除 prompt 外还有 zhHans.js 的逐字兜底。
  form.append('prompt', '以下是普通话的句子，请使用简体中文输出。');
  form.append('response_format', 'json');
  form.append('translate', 'false');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WHISPER_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${WHISPER_ENDPOINT.replace(/\/+$/, '')}/inference`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      throw new ApiError(504, 'ASR_TIMEOUT', '语音识别超时，请稍后重试');
    }
    // 连接被拒 / 网络错误 = 识别服务未就绪（区别于服务已响应但识别失败的 502）
    throw new ApiError(503, 'ASR_NOT_CONFIGURED', '语音识别服务未就绪');
  }
  clearTimeout(timer);

  if (!response.ok) {
    throw new ApiError(502, 'ASR_FAILED', `语音识别失败（HTTP ${response.status}）`);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  const text = data && typeof data.text === 'string' ? data.text.trim() : '';
  if (!text) {
    throw new ApiError(502, 'ASR_FAILED', '未能识别出有效文本');
  }
  return text;
}

/**
 * 语音转文字主流程。
 *
 * whisper 可能输出繁体，这里统一做一次繁转简（toSimplified）后再落库与返回，
 * 保证数据库中缓存的 transcript 与前端展示都是简体中文。
 * @param {Record<string, unknown>} payload {message_id | url}
 * @param {number|string} userId
 * @returns {{text:string, message_id:number}}
 */
export async function transcribe(payload, userId) {
  const { messageId, voiceUrl, transcript } = resolveVoiceMessage(payload, userId);

  // 缓存命中：已转写过直接返回，避免重复调用 whisper
  const cached = String(transcript ?? '').trim();
  if (cached) {
    return { text: toSimplified(cached), message_id: messageId };
  }

  const srcPath = resolveLocalPath(voiceUrl);

  const wavPath = await convertToWav(srcPath);
  let text = '';
  try {
    text = toSimplified(await callWhisper(wavPath)).trim();
  } finally {
    // 无论成功失败都清理临时 wav
    try {
      fs.rmSync(path.dirname(wavPath), { recursive: true, force: true });
    } catch {
      /* 忽略清理失败 */
    }
  }

  // 转简后再校验一次空值（极少数情况下可能是纯符号/繁简转换后为空）
  if (!text) {
    throw new ApiError(502, 'ASR_FAILED', '未能识别出有效文本');
  }

  tx(() => {
    db.prepare('UPDATE messages SET transcript = ? WHERE id = ?').run(text, messageId);
  });

  return { text, message_id: messageId };
}

export default { transcribe };
