/**
 * 表情面板（移动端 / 桌面端共用的底部面板）：
 *   - 顶部横向分组条：最近使用 / 笑脸 / 手势 / 食物 / 动物 / 符号 / 我的表情；
 *   - 系统 emoji 走 8 列网格，点击立刻插入输入框光标处；
 *   - 「我的表情」展示自定义表情图片，提供「+ 上传」与「管理」入口；
 *   - 「最近使用」由 localStorage 维护（最多 16 条），emoji 与自定义表情混排。
 *
 * 不引入任何字体 / 图标库：emoji 用系统字符，自定义表情用服务端图片。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { EMOJI_GROUPS } from '../lib/emojiGroups';
import { useStickers } from '../store/useStickers';
import { useUI } from '../store/useUI';
import { useAuth } from '../store/useAuth';
import { api } from '../api';
import { STICKER_MIME, mediaUrl } from '../config';
import Icon from './Icon';
import Spinner from './Spinner';

/** 「最近使用」Tab 标识 */
const TAB_RECENT = 'recent';
/** 「我的表情」Tab 标识 */
const TAB_MINE = 'mine';

/**
 * 表情面板。
 * @param {{
 *   onPickEmoji?: (emoji: string) => void,
 *   onPickSticker?: (url: string) => void,
 *   onManage?: () => void,
 * }} props
 * @returns {JSX.Element}
 */
export default function EmojiPicker({ onPickEmoji, onPickSticker, onManage }) {
  const stickers = useStickers((state) => state.stickers);
  const loading = useStickers((state) => state.loading);
  const recent = useStickers((state) => state.recent);
  const load = useStickers((state) => state.load);
  const addSticker = useStickers((state) => state.add);
  const pushRecent = useStickers((state) => state.pushRecent);
  const token = useAuth((state) => state.token);
  const showToast = useUI((state) => state.showToast);

  const [tab, setTab] = useState(recent.length > 0 ? TAB_RECENT : EMOJI_GROUPS[0].key);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  /** 分组条（最近使用 + 5 组 emoji + 我的表情） */
  const tabs = useMemo(
    () => [
      { key: TAB_RECENT, name: '最近使用', icon: '🕘' },
      ...EMOJI_GROUPS.map((group) => ({ key: group.key, name: group.name, icon: group.icon })),
      { key: TAB_MINE, name: '我的表情', icon: '🧩' },
    ],
    [],
  );

  // 打开面板就先预取自定义表情（静默失败：离线时不影响 emoji 使用）
  useEffect(() => {
    if (!token) return;
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /**
   * 选择一个系统 emoji。
   * @param {string} emoji
   * @returns {void}
   */
  const pickEmoji = (emoji) => {
    pushRecent({ t: 'emoji', v: emoji });
    if (onPickEmoji) onPickEmoji(emoji);
  };

  /**
   * 选择（发送）一个自定义表情。
   * @param {string} url
   * @returns {void}
   */
  const pickSticker = (url) => {
    pushRecent({ t: 'sticker', v: url });
    if (onPickSticker) onPickSticker(url);
  };

  /**
   * 上传自定义表情：校验大小 / 格式 / 额度 → 上传 → 入库。
   * @param {React.ChangeEvent<HTMLInputElement>} event
   * @returns {Promise<void>}
   */
  const handleUpload = async (event) => {
    const input = event.target;
    const file = input.files && input.files[0] ? input.files[0] : null;
    if (input) input.value = '';
    if (!file) return;

    if (!STICKER_MIME.includes(file.type)) {
      showToast('仅支持 jpg / png / gif / webp 图片', 'error');
      return;
    }

    setUploading(true);
    try {
      const uploaded = await api.uploadSticker(file);
      if (!uploaded || !uploaded.url) throw new Error('表情上传失败');
      await addSticker(uploaded.url);
      setTab(TAB_MINE);
      showToast('已添加表情', 'success');
    } catch (err) {
      showToast((err && err.message) || '表情上传失败', 'error');
    } finally {
      setUploading(false);
    }
  };

  /** 当前分组要渲染的 emoji 列表 */
  const emojis = useMemo(() => {
    if (tab === TAB_RECENT || tab === TAB_MINE) return [];
    const group = EMOJI_GROUPS.find((item) => item.key === tab);
    return group ? group.emojis : [];
  }, [tab]);

  return (
    <div className="border-t border-[#E5E5E5] bg-[#F7F7F7]">
      {/* 分组条 */}
      <div className="flex items-stretch overflow-x-auto border-b border-[#E9E9E9] px-1">
        {tabs.map((item) => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              aria-label={item.name}
              className={`relative flex h-9 min-w-[42px] shrink-0 items-center justify-center px-2 text-[16px] leading-none ${
                active ? '' : 'opacity-45'
              }`}
            >
              <span>{item.icon}</span>
              {active ? (
                <span className="absolute inset-x-1.5 bottom-0 h-[2px] rounded-full bg-[#07C160]" />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* 内容区 */}
      <div className="max-h-[212px] min-h-[132px] overflow-y-auto px-2 py-2">
        {tab === TAB_RECENT ? (
          recent.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-[#B2B2B2]">还没有最近使用的表情</p>
          ) : (
            <div className="grid grid-cols-8 gap-1">
              {recent.map((item) => (
                <button
                  key={`${item.t}-${item.v}`}
                  type="button"
                  onClick={() => (item.t === 'emoji' ? pickEmoji(item.v) : pickSticker(item.v))}
                  className="wx-tap flex h-9 items-center justify-center rounded-[6px] active:bg-black/10"
                  aria-label={item.t === 'emoji' ? item.v : '表情'}
                >
                  {item.t === 'emoji' ? (
                    <span className="text-[22px] leading-none">{item.v}</span>
                  ) : (
                    <img src={mediaUrl(item.v)} alt="表情" className="h-8 w-8 object-contain" draggable="false" />
                  )}
                </button>
              ))}
            </div>
          )
        ) : null}

        {tab === TAB_MINE ? (
          <div>
            {/* 工具条：上传 / 管理 */}
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[11px] leading-4 text-[#999]">
                已添加 {stickers.length} 个
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current && fileRef.current.click()}
                  disabled={uploading}
                  className="flex items-center gap-1 text-[12px] text-[#576B95] active:opacity-60 disabled:opacity-40"
                >
                  {uploading ? <Spinner size={12} className="text-[#576B95]" /> : <Icon name="plus" size={13} />}
                  上传
                </button>
                <button
                  type="button"
                  onClick={() => onManage && onManage()}
                  className="text-[12px] text-[#576B95] active:opacity-60"
                >
                  管理
                </button>
              </div>
            </div>

            {loading && stickers.length === 0 ? (
              <div className="flex justify-center py-8">
                <Spinner size={16} className="text-[#B2B2B2]" />
              </div>
            ) : stickers.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-[#B2B2B2]">还没有表情，上传一张试试</p>
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {stickers.map((sticker) => (
                  <button
                    key={sticker.id}
                    type="button"
                    onClick={() => pickSticker(sticker.url)}
                    className="wx-tap flex h-[104px] items-center justify-center rounded-[6px] active:bg-black/10"
                    aria-label="表情"
                  >
                    <img
                      src={mediaUrl(sticker.url)}
                      alt="表情"
                      className="max-h-[96px] max-w-full object-contain"
                      draggable="false"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            )}

            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={handleUpload}
            />
          </div>
        ) : null}

        {emojis.length > 0 ? (
          <div className="grid grid-cols-8 gap-1">
            {emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => pickEmoji(emoji)}
                className="wx-tap flex h-9 items-center justify-center rounded-[6px] text-[22px] leading-none active:bg-black/10"
                aria-label={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { EMOJI_GROUPS };
