/**
 * 展示与数据处理工具：会话标题、消息摘要、头像首字、图片压缩、关系文案等。
 */

/**
 * 未读数展示：>99 显示 99+。
 * @param {number} count
 * @returns {string}
 */
export function formatUnread(count) {
  const value = Number(count) || 0;
  if (value <= 0) return '';
  return value > 99 ? '99+' : String(value);
}

/**
 * 展示名统一规则：remark_name || nickname。
 * @param {{nickname?: string, remark_name?: string, display_name?: string}|null|undefined} person
 * @returns {string}
 */
export function displayNameOf(person) {
  if (!person) return '';
  if (person.display_name) return person.display_name;
  const remark = String(person.remark_name || '').trim();
  if (remark) return remark;
  return String(person.nickname || '');
}

/**
 * 会话标题：单聊取对方展示名（备注优先），群聊取群名。
 * @param {{type: string, name?: string, peer?: {nickname: string, remark_name?: string}|null}} conversation
 * @returns {string}
 */
export function conversationTitle(conversation) {
  if (!conversation) return '';
  if (conversation.type === 'group') return conversation.name || '群聊';
  return displayNameOf(conversation.peer) || '聊天';
}

/**
 * 会话头像色：单聊取对方头像色，群聊用中性灰。
 * @param {{type: string, peer?: {avatar_color: string}|null}} conversation
 * @returns {string}
 */
export function conversationColor(conversation) {
  if (!conversation) return '#07C160';
  if (conversation.type === 'group') return '#B9B9B9';
  return (conversation.peer && conversation.peer.avatar_color) || '#07C160';
}

/**
 * 会话头像图：单聊取对方自定义头像，群聊取群头像，未设置时返回空串。
 * 返回相对路径，由 Avatar 组件统一经 config.mediaUrl 拼成绝对地址。
 * @param {{type: string, avatar_url?: string, peer?: {avatar_url?: string}|null}} conversation
 * @returns {string}
 */
export function conversationAvatarUrl(conversation) {
  if (!conversation) return '';
  if (conversation.type === 'group') return conversation.avatar_url || '';
  return (conversation.peer && conversation.peer.avatar_url) || '';
}

/**
 * 会话最后一条消息摘要。
 * 规则：撤回 → 消息已撤回；图片 → [图片]；表情 → [表情]；系统 → 原文；
 *       文本 → 原文，自己发的加「我: 」前缀。
 * @param {Record<string, any>|null} lastMessage 会话 last_message 字段
 * @param {number} myId 当前用户 id
 * @returns {string}
 */
export function summarizeLastMessage(lastMessage, myId) {
  if (!lastMessage) return '';
  if (Number(lastMessage.revoked) === 1) return '消息已撤回';

  const type = lastMessage.type;
  const content = String(lastMessage.content || '');
  const mine = lastMessage.sender_id === myId;

  if (type === 'system') return content;
  if (type === 'image') return mine ? '我: [图片]' : '[图片]';
  if (type === 'sticker') return mine ? '我: [表情]' : '[表情]';
  if (type === 'card') return mine ? '我: [名片]' : '[名片]';
  if (type === 'voice') return mine ? '我: [语音]' : '[语音]';
  if (type === 'video') return mine ? '我: [视频]' : '[视频]';
  if (type === 'file') return mine ? '我: [文件]' : '[文件]';
  if (type === 'merged') return mine ? '我: [聊天记录]' : '[聊天记录]';
  return mine ? `我: ${content}` : content;
}

/**
 * 文件大小人性化展示（B/KB/MB/GB）。
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * 取昵称首字符作为头像文字。
 * @param {string} name
 * @returns {string}
 */
export function initials(name) {
  const text = String(name || '').trim();
  if (!text) return '';
  return [...text][0].toUpperCase();
}

/**
 * 关系文案（用于加好友按钮）。
 * @param {'self'|'friend'|'pending_out'|'pending_in'|'none'|undefined} relation
 * @returns {{text: string, disabled: boolean, action: 'add'|'verify'|'pending'|'friend'|'self'}}
 */
export function relationMeta(relation) {
  switch (relation) {
    case 'friend':
      return { text: '已是好友', disabled: true, action: 'friend' };
    case 'pending_out':
      return { text: '已申请', disabled: true, action: 'pending' };
    case 'pending_in':
      return { text: '去验证', disabled: false, action: 'verify' };
    case 'self':
      return { text: '自己', disabled: true, action: 'self' };
    default:
      return { text: '加好友', disabled: false, action: 'add' };
  }
}

/**
 * 图片压缩：canvas 重绘，长边限制 1600px，JPEG 质量 0.8。
 * GIF 与非图片文件原样返回；任何失败都降级为原文件，保证不阻断发送。
 * @param {File} file
 * @param {{maxSide?: number, quality?: number}} [options]
 * @returns {Promise<File|Blob>}
 */
export function compressImage(file, { maxSide = 1600, quality = 0.8 } = {}) {
  return new Promise((resolve) => {
    if (!file || !/^image\//i.test(file.type || '')) {
      resolve(file);
      return;
    }
    // GIF 压缩会丢失动画，直接上传
    if (file.type === 'image/gif') {
      resolve(file);
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
          resolve(file);
          return;
        }

        const scale = Math.min(1, maxSide / Math.max(width, height));
        const targetWidth = Math.max(1, Math.round(width * scale));
        const targetHeight = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }
        // 透明图转 JPEG 会变黑，先铺白底
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            resolve(new File([blob], `image-${Date.now()}.jpg`, { type: 'image/jpeg' }));
          },
          'image/jpeg',
          quality,
        );
      } catch (err) {
        console.warn('[format] compressImage failed:', err);
        resolve(file);
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    image.src = objectUrl;
  });
}

/**
 * 判断文件是否为图片。
 * @param {File|null} file
 * @returns {boolean}
 */
export function isImageFile(file) {
  return Boolean(file && /^image\//i.test(file.type || ''));
}

export default {
  formatUnread,
  displayNameOf,
  conversationTitle,
  conversationColor,
  conversationAvatarUrl,
  summarizeLastMessage,
  initials,
  relationMeta,
  compressImage,
  isImageFile,
};
