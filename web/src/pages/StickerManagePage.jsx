/**
 * 我的表情管理页：
 *   - 4 列网格展示自定义表情；
 *   - 右上「编辑 / 完成」切换删除态，删除态每格右上角红叉（二次确认）；
 *   - 网格末尾「+ 上传」格子，上传后立即入库并刷新；
 *   - 顶部展示剩余额度 x/100。
 */
import { useEffect, useRef, useState } from 'react';
import { useUI } from '../store/useUI';
import { useStickers } from '../store/useStickers';
import { api } from '../api';
import { STICKER_MIME, mediaUrl } from '../config';
import PageHeader from '../components/PageHeader';
import Icon from '../components/Icon';
import Spinner from '../components/Spinner';
import Modal from '../components/Modal';

/**
 * @param {{embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function StickerManagePage({ embedded = false }) {
  const back = useUI((state) => state.back);
  const showToast = useUI((state) => state.showToast);

  const stickers = useStickers((state) => state.stickers);
  const loading = useStickers((state) => state.loading);
  const loaded = useStickers((state) => state.loaded);
  const load = useStickers((state) => state.load);
  const addSticker = useStickers((state) => state.add);
  const removeSticker = useStickers((state) => state.remove);

  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    load({ force: true }).catch((err) => showToast((err && err.message) || '加载失败', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 上传自定义表情。
   * @param {React.ChangeEvent<HTMLInputElement>} event
   * @returns {Promise<void>}
   */
  const handleUpload = async (event) => {
    const input = event.target;
    const file = input && input.files ? input.files[0] : null;
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
      showToast('已添加表情', 'success');
    } catch (err) {
      showToast((err && err.message) || '表情上传失败', 'error');
    } finally {
      setUploading(false);
    }
  };

  /**
   * 删除确认。
   * @returns {Promise<void>}
   */
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await removeSticker(pendingDelete.id);
      showToast('已删除');
      setPendingDelete(null);
      if (stickers.length <= 1) setEditing(false);
    } catch (err) {
      showToast((err && err.message) || '删除失败', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const headerRight = stickers.length > 0 ? (
    <button
      type="button"
      onClick={() => setEditing((prev) => !prev)}
      className="flex h-11 items-center justify-center px-2 text-[15px] text-[#111] active:opacity-60"
    >
      {editing ? '完成' : '编辑'}
    </button>
  ) : null;

  const body = (
    <div className="mx-auto w-full max-w-[620px]">
      {/* 额度 */}
      <div className="mt-2 flex items-center justify-between bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="text-[14px] text-[#111]">自定义表情</p>
          <p className="mt-[2px] text-[11px] leading-4 text-[#B2B2B2]">
            不限数量，支持 jpg / png / gif / webp
          </p>
        </div>
        <span className="shrink-0 text-[13px] text-[#999]">{stickers.length} 个</span>
      </div>

      {/* 网格 */}
      <div className="mt-2 bg-white px-3 py-3">
        {loading && !loaded ? (
          <div className="flex justify-center py-10">
            <Spinner size={22} className="text-[#B2B2B2]" />
          </div>
        ) : stickers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <p className="text-[13px] text-[#B2B2B2]">还没有表情，上传一张试试</p>
            <button
              type="button"
              onClick={() => fileRef.current && fileRef.current.click()}
              className="rounded-[6px] bg-[#07C160] px-4 py-1.5 text-[13px] text-white active:bg-[#06AD56]"
            >
              上传表情
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {stickers.map((sticker) => (
              <div key={sticker.id} className="relative flex h-[86px] items-center justify-center">
                <img
                  src={mediaUrl(sticker.url)}
                  alt="表情"
                  className="max-h-[80px] max-w-full object-contain"
                  draggable="false"
                  loading="lazy"
                />
                {editing ? (
                  <button
                    type="button"
                    aria-label="删除表情"
                    onClick={() => setPendingDelete(sticker)}
                    className="absolute right-0 top-0 flex h-6 w-6 items-center justify-center rounded-full bg-[#FA5151] text-white active:bg-[#E04545]"
                  >
                    <Icon name="close" size={12} />
                  </button>
                ) : null}
              </div>
            ))}

            {remaining > 0 ? (
              <button
                type="button"
                onClick={() => fileRef.current && fileRef.current.click()}
                disabled={uploading}
                aria-label="上传表情"
                className="flex h-[86px] flex-col items-center justify-center gap-1 rounded-[4px] border border-dashed border-[#D0D0D0] text-[#B2B2B2] active:bg-black/5 disabled:opacity-50"
              >
                {uploading ? <Spinner size={18} className="text-[#B2B2B2]" /> : <Icon name="plus" size={24} />}
                <span className="text-[11px] leading-3">上传</span>
              </button>
            ) : null}
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

      <p className="px-4 py-4 text-[11px] leading-4 text-[#B2B2B2]">
        删除表情不会删除历史消息里已经发送的图片。
      </p>
    </div>
  );

  return (
    <div className={`flex h-full flex-col ${embedded ? 'bg-[#F5F5F5]' : 'bg-[#EDEDED]'}`}>
      {embedded ? (
        <div className="flex h-[52px] shrink-0 items-center border-b border-[#E0E0E0] bg-[#F5F5F5] px-4">
          <button
            type="button"
            onClick={back}
            className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
            aria-label="返回"
          >
            <Icon name="back" size={20} className="text-[#111]" />
          </button>
          <h1 className="ml-1 min-w-0 flex-1 truncate text-[16px] font-semibold text-[#111]">我的表情</h1>
          {headerRight}
        </div>
      ) : (
        <PageHeader title="我的表情" onBack={back} right={headerRight} />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">{body}</div>

      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title="删除表情"
        width={300}
        footer={
          <div className="flex h-[48px] items-stretch">
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="flex-1 border-r border-[#E5E5E5] text-[16px] text-[#333] active:bg-black/5"
            >
              取消
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              className="flex flex-1 items-center justify-center text-[16px] font-medium text-[#FA5151] active:bg-black/5 disabled:opacity-50"
            >
              {deleting ? '删除中…' : '删除'}
            </button>
          </div>
        }
      >
        <p className="py-1 text-[14px] leading-relaxed text-[#555]">删除后该表情将从面板移除，确定删除吗？</p>
      </Modal>
    </div>
  );
}
