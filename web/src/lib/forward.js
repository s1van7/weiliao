/**
 * 转发与合并转发共享工具。
 *
 * 约定（与后端 server/lib/messages.js 的 merged 校验保持一致）：
 *   - merged content 是 JSON 字符串：{ v:1, title, source_type, source_name, source_conv_id, items[] }
 *   - 单次合并条数 ≤ MERGED_MAX_ITEMS，content 总字节 ≤ MERGED_MAX_BYTES（utf8）
 *   - 每条 item 的 summary 在转发时预生成（快照冻结，原消息撤回/删除不影响卡片）
 */

/** 合并转发消息类型（与后端 MERGED_TYPE 保持一致） */
export const MERGED_TYPE = 'merged';
/** 单次合并条数上限 */
export const MERGED_MAX_ITEMS = 100;
/** merged content 总字节上限（utf8） */
export const MERGED_MAX_BYTES = 64 * 1024;
/** 每条文本摘要截断字数（码点） */
export const MERGED_TEXT_PREVIEW_MAX = 50;

/**
 * 计算字符串的 utf8 字节长度（浏览器无 Buffer，用 TextEncoder + 兜底）。
 * @param {string} text
 * @returns {number}
 */
function utf8ByteLength(text) {
  const value = String(text ?? '');
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.codePointAt(i);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else {
      bytes += 4;
      i += 1;
    }
  }
  return bytes;
}

/**
 * 逐条转发 payload（不含 client_id，由 _send / api.sendMessage 统一追加）。
 * 规则：sender 恒为当前用户；文本丢弃 mentions；媒体复用 /uploads 地址不重传。
 * @param {Record<string, any>} message
 * @returns {{type: string, content: string, voice_duration?: number, video_duration?: number, file_name?: string, file_size?: number}|null}
 */
export function forwardPayloadOf(message) {
  if (!message) return null;
  const type = String(message.type || '');
  const content = String(message.content || '');

  switch (type) {
    case 'text':
      return { type: 'text', content };
    case 'image':
    case 'sticker':
      return { type, content };
    case 'card':
      return { type: 'card', content };
    case 'voice': {
      const url = String(message.voice_url || content).trim();
      const duration = Math.max(1, Math.min(60, Number(message.voice_duration) || 1));
      return { type: 'voice', content: url, voice_duration: duration };
    }
    case 'video': {
      const url = String(message.video_url || content).trim();
      const duration = Math.max(0, Number(message.video_duration) || 0);
      return { type: 'video', content: url, video_duration: duration };
    }
    case 'file': {
      const url = String(message.file_url || content).trim();
      const name = String(message.file_name || '');
      const size = Number(message.file_size) || 0;
      return { type: 'file', content: url, file_name: name, file_size: size };
    }
    case 'merged':
      // 单条转发合并卡片：原样复制其 content JSON（服务端重新校验）
      return { type: 'merged', content };
    default:
      return null;
  }
}

/**
 * 单条消息在合并卡片内的摘要（快照，转发时预生成）。
 * @param {Record<string, any>} message
 * @returns {string}
 */
export function mergedSummaryOf(message) {
  const type = String((message && message.type) || '');
  const content = String((message && message.content) || '');

  switch (type) {
    case 'text': {
      const text = content.trim();
      const chars = [...text];
      if (chars.length <= MERGED_TEXT_PREVIEW_MAX) return text || '[文本]';
      return `${chars.slice(0, MERGED_TEXT_PREVIEW_MAX).join('')}…`;
    }
    case 'image':
      return '[图片]';
    case 'sticker':
      return '[表情]';
    case 'voice':
      return '[语音]';
    case 'video':
      return '[视频]';
    case 'file':
      return '[文件]';
    case 'card':
      return '[名片]';
    case 'merged':
      return '[聊天记录]';
    default:
      return '[消息]';
  }
}

/**
 * 取源会话名（单聊=对方展示名，群聊=群名）。
 * @param {{type?: string, name?: string, peer?: {nickname?: string, remark_name?: string}|null}|null} source
 * @returns {string}
 */
function sourceNameOf(source) {
  if (!source) return '';
  if (source.type === 'group') return String(source.name || '群聊');
  if (source.peer) return String(source.peer.remark_name || source.peer.nickname || '');
  return String(source.name || '');
}

/**
 * 合并转发标题：单聊 `{对方昵称}的聊天记录`，群聊 `{群名}的聊天记录`。
 * @param {{type?: string, name?: string, title?: string, peer?: {nickname?: string, remark_name?: string}|null}|null} source
 * @returns {string}
 */
export function mergedTitleOf(source) {
  if (!source) return '聊天记录';
  if (source.title) return String(source.title);
  const name = sourceNameOf(source) || '对方';
  return `${name}的聊天记录`;
}

/**
 * 把一条消息固化进合并快照 item。
 * @param {Record<string, any>} message
 * @returns {Record<string, any>}
 */
function snapshotItemOf(message) {
  const type = String((message && message.type) || 'text');
  const content = String((message && message.content) || '');

  const item = {
    type,
    sender_id: Number((message && message.sender_id) || 0),
    sender_nickname: String((message && message.sender_nickname) || ''),
    sender_avatar_color: String((message && message.sender_avatar_color) || ''),
    sender_avatar_url: String((message && message.sender_avatar_url) || ''),
    content,
    summary: mergedSummaryOf(message),
    voice_url: '',
    voice_duration: 0,
    video_url: '',
    video_duration: 0,
    file_url: '',
    file_name: '',
    file_size: 0,
    transcript: '',
    created_at: Number((message && message.created_at) || 0),
  };

  if (type === 'voice') {
    item.content = String((message && message.voice_url) || content);
    item.voice_url = item.content;
    item.voice_duration = Math.max(0, Number((message && message.voice_duration) || 0));
  } else if (type === 'video') {
    item.content = String((message && message.video_url) || content);
    item.video_url = item.content;
    item.video_duration = Math.max(0, Number((message && message.video_duration) || 0));
  } else if (type === 'file') {
    item.content = String((message && message.file_url) || content);
    item.file_url = item.content;
    item.file_name = String((message && message.file_name) || '');
    item.file_size = Number((message && message.file_size) || 0);
  } else if (type === 'merged') {
    // 嵌套合并不递归展开，只保留摘要（summary=[聊天记录]），避免 64KB 膨胀与无限嵌套
    item.content = '';
  }

  return item;
}

/**
 * 合并转发 content（返回 JSON 字符串）。
 * @param {Array<Record<string, any>>} messages 被合并的消息（会按 created_at 升序）
 * @param {{type?: string, name?: string, title?: string, id?: number|string, peer?: {nickname?: string, remark_name?: string}|null}|null} source 源会话
 * @returns {string|null} 无有效消息时返回 null
 */
export function mergedContentOf(messages, source) {
  const list = Array.isArray(messages) ? messages.filter(Boolean) : [];
  if (list.length === 0) return null;

  const ordered = [...list].sort(
    (a, b) => (Number(a.created_at) || 0) - (Number(b.created_at) || 0),
  );
  const capped = ordered.slice(0, MERGED_MAX_ITEMS);

  const title = mergedTitleOf(source);
  const sourceType = source && source.type === 'group' ? 'group' : 'single';
  const sourceName = sourceNameOf(source);
  const sourceConvId = Number((source && source.id) || 0);

  const items = [];
  for (const message of capped) {
    const item = snapshotItemOf(message);
    const candidate = JSON.stringify({
      v: 1,
      title,
      source_type: sourceType,
      source_name: sourceName,
      source_conv_id: sourceConvId,
      items: [...items, item],
    });
    if (utf8ByteLength(candidate) > MERGED_MAX_BYTES) break;
    items.push(item);
  }

  // 极端情况下（首条即超限）至少保留一条，保证后端 items.length >= 1 校验通过
  if (items.length === 0 && capped.length > 0) {
    items.push(snapshotItemOf(capped[0]));
  }

  return JSON.stringify({
    v: 1,
    title,
    source_type: sourceType,
    source_name: sourceName,
    source_conv_id: sourceConvId,
    items,
  });
}

/**
 * 解析合并 content（MergedMessage / MergedDetailModal 复用，容错返回 null）。
 * @param {string} content
 * @returns {{title: string, source_type: string, source_name: string, source_conv_id: number, items: Array<Record<string, any>>}|null}
 */
export function parseMergedContent(content) {
  try {
    const parsed = JSON.parse(String(content ?? ''));
    if (!parsed || typeof parsed !== 'object' || parsed.v !== 1 || !Array.isArray(parsed.items)) {
      return null;
    }
    return {
      title: String(parsed.title || '聊天记录'),
      source_type: parsed.source_type === 'group' ? 'group' : 'single',
      source_name: String(parsed.source_name || ''),
      source_conv_id: Number(parsed.source_conv_id) || 0,
      items: parsed.items.filter((item) => item && typeof item === 'object'),
    };
  } catch {
    return null;
  }
}

export default {
  MERGED_TYPE,
  MERGED_MAX_ITEMS,
  MERGED_MAX_BYTES,
  MERGED_TEXT_PREVIEW_MAX,
  forwardPayloadOf,
  mergedSummaryOf,
  mergedTitleOf,
  mergedContentOf,
  parseMergedContent,
};
