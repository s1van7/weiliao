/**
 * @ 机制前端渲染模块。
 *
 * 为什么不用正则：昵称是用户自由输入，可能包含 `. * + ? ( ) [ ] | \` 等正则元字符，
 * 拼进 RegExp 一旦转义遗漏就会错位甚至抛异常。这里改为「纯字符串 indexOf 从左到右扫描」，
 * 完全不经过正则引擎，任何字符都不会被特殊解释。
 *
 * 语义约定（与后端 lib/mentions.js 对齐）：
 *   - mentions = { all: boolean, ids: number[] } | null
 *   - all 为 true 时文本里出现的 `@所有人` 高亮；
 *   - ids 里每个 id 对应一个 `@昵称` token，昵称由调用方通过 nicknameById 提供；
 *   - 高亮只做视觉，不做点击跳转（纯文本消息不存偏移量）。
 */

/**
 * 构造 @ token 文本（不含尾部空格）。
 * @param {string} name 昵称（'所有人' 亦可）
 * @returns {string}
 */
export function buildMentionToken(name) {
  return `@${String(name || '')}`;
}

/**
 * 取昵称：兼容普通对象与 Map。
 * @param {Record<string|number, string>|Map<number, string>|null|undefined} nicknameById
 * @param {number} id
 * @returns {string}
 */
function nicknameOf(nicknameById, id) {
  if (!nicknameById) return '';
  if (typeof nicknameById.get === 'function') return String(nicknameById.get(id) ?? '');
  return String(nicknameById[id] ?? '');
}

/**
 * 把 mentions 展开成候选 token 列表（按 token 长度倒序，保证「@张三丰」先于「@张三」匹配）。
 * @param {{all?: boolean, ids?: number[]}|null|undefined} mentions
 * @param {Record<string|number, string>|Map<number, string>|null|undefined} nicknameById
 * @returns {string[]} 去重后的 token 文本
 */
export function buildMentionTokens(mentions, nicknameById) {
  if (!mentions || typeof mentions !== 'object') return [];

  const tokens = [];
  const seen = new Set();

  /**
   * 推入一个 token（去重）。
   * @param {string} token
   * @returns {void}
   */
  const push = (token) => {
    if (!token || token.length <= 1 || seen.has(token)) return;
    seen.add(token);
    tokens.push(token);
  };

  if (mentions.all === true) push(buildMentionToken('所有人'));

  const ids = Array.isArray(mentions.ids) ? mentions.ids : [];
  for (const rawId of ids) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) continue;
    const nickname = nicknameOf(nicknameById, id);
    if (!nickname) continue;
    push(buildMentionToken(nickname));
  }

  return tokens.sort((left, right) => right.length - left.length);
}

/**
 * 把消息正文切分为「普通文本 / @ 片段」，供气泡按片段渲染。
 *
 * 实现：单个指针从左到右推进，每一步先用 indexOf(token, index) === index 判断当前位置
 * 是否命中某个候选 token（候选已按长度倒序，因此最长匹配优先），命中则切出 mention 片段，
 * 否则把当前字符并入普通文本缓冲。整体 O(n × token 数)，消息级别完全够用。
 *
 * @param {string} content 消息正文
 * @param {{all?: boolean, ids?: number[]}|null|undefined} mentions 服务端返回的 @ 信息
 * @param {Record<string|number, string>|Map<number, string>|null|undefined} nicknameById id → 昵称映射
 * @returns {Array<{text: string, mention: boolean}>} 片段列表（连续普通文本会合并为一段）
 */
export function renderMentionSegments(content, mentions, nicknameById) {
  const text = String(content ?? '');
  if (!text) return [];

  const tokens = buildMentionTokens(mentions, nicknameById);
  if (tokens.length === 0) return [{ text, mention: false }];

  const segments = [];
  let plain = '';
  let index = 0;

  while (index < text.length) {
    let matched = '';
    for (const token of tokens) {
      if (text.indexOf(token, index) === index) {
        matched = token;
        break;
      }
    }

    if (matched) {
      if (plain) {
        segments.push({ text: plain, mention: false });
        plain = '';
      }
      segments.push({ text: matched, mention: true });
      index += matched.length;
    } else {
      plain += text[index];
      index += 1;
    }
  }

  if (plain) segments.push({ text: plain, mention: false });
  return segments;
}

/**
 * 发送前用正文过滤 mentions：正文里已经找不到 token 的目标一律剔除。
 *
 * 场景：用户插入 `@张三 ` 后又手动把这段文字删掉，此时不能还把它算作 @。
 *
 * @param {string} content 待发送正文
 * @param {{all: boolean, ids: number[]}} draft 本地维护的 @ 草稿
 * @param {Record<string|number, string>|Map<number, string>|null|undefined} nicknameById id → 昵称映射
 * @returns {{all: boolean, ids: number[]}|null} 过滤后的 mentions；无任何目标时返回 null
 */
export function filterMentionsByText(content, draft, nicknameById) {
  const text = String(content ?? '');
  if (!draft) return null;

  const all = draft.all === true && text.includes(buildMentionToken('所有人'));
  const ids = [];
  const rawIds = Array.isArray(draft.ids) ? draft.ids : [];
  for (const rawId of rawIds) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) continue;
    const nickname = nicknameOf(nicknameById, id);
    if (!nickname) continue;
    if (!text.includes(buildMentionToken(nickname))) continue;
    if (!ids.includes(id)) ids.push(id);
  }

  if (!all && ids.length === 0) return null;
  return { all, ids };
}

export default { buildMentionToken, buildMentionTokens, renderMentionSegments, filterMentionsByText };
