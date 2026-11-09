/**
 * 我的：头像预览（可更换 / 恢复纯色）、用户名/手机号（只读灰字）、
 * 朋友圈 / 收藏 / 设置入口、退出登录。
 * 资料编辑与头像颜色已迁移到设置页「个人信息」区块。
 * 桌面端作为右栏内容（embedded），不渲染顶部导航。
 */
import { useRef, useState } from 'react';
import { useAuth } from '../store/useAuth';
import { useUI } from '../store/useUI';
import { api } from '../api';
import { cropSquareAvatar } from '../lib/image';
import Avatar from '../components/Avatar';
import PageHeader from '../components/PageHeader';
import Spinner from '../components/Spinner';
import Icon from '../components/Icon';

export default function ProfilePage({ embedded = false }) {
  const user = useAuth((state) => state.user);
  const updateProfile = useAuth((state) => state.updateProfile);
  const logout = useAuth((state) => state.logout);
  const showToast = useUI((state) => state.showToast);
  const openModal = useUI((state) => state.openModal);

  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef(null);

  const nickname = user ? user.nickname || '' : '';
  const color = user ? user.avatar_color || '#07C160' : '#07C160';

  /**
   * 打开系统选图（同一文件可重复选择，需先清空 value）。
   * @returns {void}
   */
  const handlePickAvatar = () => {
    if (avatarBusy) return;
    const input = avatarInputRef.current;
    if (!input) return;
    input.value = '';
    input.click();
  };

  /**
   * 选图 → 居中裁剪 256x256 JPEG → 上传 → 保存 avatar_url → 同步 store。
   * @param {React.ChangeEvent<HTMLInputElement>} event
   * @returns {Promise<void>}
   */
  const handleAvatarChange = async (event) => {
    const input = event.target;
    const file = input && input.files ? input.files[0] : null;
    if (!file) return;
    if (!/^image\//i.test(file.type || '')) {
      showToast('请选择图片文件', 'error');
      input.value = '';
      return;
    }

    setAvatarBusy(true);
    try {
      const cropped = await cropSquareAvatar(file);
      const uploaded = await api.uploadAvatar(cropped);
      if (!uploaded || !uploaded.url) throw new Error('头像上传失败');
      await updateProfile({ avatar_url: uploaded.url });
      showToast('头像已更新');
    } catch (err) {
      showToast((err && err.message) || '头像上传失败', 'error');
    } finally {
      setAvatarBusy(false);
      if (input) input.value = '';
    }
  };

  /**
   * 清除自定义头像，回落到纯色 + 首字。
   * @returns {Promise<void>}
   */
  const handleResetAvatar = async () => {
    if (avatarBusy) return;
    setAvatarBusy(true);
    try {
      await updateProfile({ avatar_url: '' });
      showToast('已恢复纯色头像');
    } catch (err) {
      showToast((err && err.message) || '操作失败', 'error');
    } finally {
      setAvatarBusy(false);
    }
  };

  /**
   * 退出登录（二次确认）。
   * @returns {void}
   */
  const handleLogout = () => {
    openModal({
      title: '退出登录',
      content: '退出后需要重新输入账号密码登录，确定退出吗？',
      confirmText: '退出',
      danger: true,
      onConfirm: () => logout(),
    });
  };

  const body = (
    <div className={`mx-auto w-full ${embedded ? 'max-w-[560px] pt-6' : ''}`}>
      {/* 头像 + 昵称预览 */}
      <div className="flex flex-col items-center gap-2 bg-white px-4 py-5">
        <button
          type="button"
          onClick={handlePickAvatar}
          disabled={avatarBusy}
          aria-label="更换头像"
          className="wx-tap relative block overflow-hidden rounded-[6px]"
        >
          <Avatar name={nickname} color={color} src={(user && user.avatar_url) || ''} size={64} radius={6} />
          <span className="absolute inset-x-0 bottom-0 flex h-[18px] items-center justify-center bg-black/45 text-[10px] leading-none text-white">
            {avatarBusy ? '上传中' : '更换头像'}
          </span>
          {avatarBusy ? (
            <span className="absolute inset-0 flex items-center justify-center bg-black/35">
              <Spinner size={18} className="text-white" />
            </span>
          ) : null}
        </button>
        <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
        <p className="text-[18px] font-semibold text-[#111]">{nickname || '未设置昵称'}</p>
        <p className="text-[12px] text-[#999]">
          {user && user.username ? `用户名：${user.username}` : user && user.phone ? `手机号：${user.phone}` : ''}
        </p>
        {user && user.avatar_url ? (
          <button
            type="button"
            onClick={handleResetAvatar}
            disabled={avatarBusy}
            className="text-[12px] text-[#576B95] active:opacity-60"
          >
            恢复纯色头像
          </button>
        ) : null}
      </div>

      {/* 朋友圈 / 收藏 */}
      <div className="mt-2 bg-white">
        <button
          type="button"
          onClick={() => useUI.getState().navigate('moments')}
          className="flex min-h-[52px] w-full items-center gap-3 px-4 active:bg-black/5"
        >
          <Icon name="moments" size={20} className="text-[#07C160]" />
          <span className="min-w-0 flex-1 text-left text-[15px] text-[#111]">朋友圈</span>
          <Icon name="chevronRight" size={18} className="text-[#C8C8C8]" />
        </button>
        <div className="ml-4 h-px bg-[#F0F0F0]" />
        <button
          type="button"
          onClick={() => useUI.getState().navigate('favorites')}
          className="flex min-h-[52px] w-full items-center gap-3 px-4 active:bg-black/5"
        >
          <Icon name="star" size={20} className="text-[#FF9F0A]" />
          <span className="min-w-0 flex-1 text-left text-[15px] text-[#111]">收藏</span>
          <Icon name="chevronRight" size={18} className="text-[#C8C8C8]" />
        </button>
      </div>

      {/* 设置 */}
      <div className="mt-4 bg-white">
        <button
          type="button"
          onClick={() => useUI.getState().navigate('settings')}
          className="flex min-h-[52px] w-full items-center gap-3 px-4 active:bg-black/5"
        >
          <Icon name="settings" size={20} className="text-[#07C160]" />
          <span className="min-w-0 flex-1 text-left text-[15px] text-[#111]">设置</span>
          <Icon name="chevronRight" size={18} className="text-[#C8C8C8]" />
        </button>
      </div>

      {/* 退出 */}
      <div className="mt-4 bg-white">
        <button
          type="button"
          onClick={handleLogout}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 text-[16px] text-[#FA5151] active:bg-black/5"
        >
          <Icon name="logout" size={18} className="text-[#FA5151]" />
          退出登录
        </button>
      </div>

      <p className="px-4 py-5 text-center text-[11px] leading-4 text-[#C8C8C8]">
        微聊 · 数据存储在你的服务器
        <br />
        消息与文件仅在你自己的服务端留存
      </p>
    </div>
  );

  if (embedded) {
    return (
      <div className="flex h-full flex-col bg-[#F5F5F5]">
        <div className="mx-auto flex h-[52px] w-full max-w-[560px] shrink-0 items-center justify-between px-4">
          <h1 className="text-[16px] font-semibold text-[#111]">我</h1>
          <button
            type="button"
            aria-label="我的二维码"
            onClick={() => useUI.getState().navigate('myQr')}
            className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
          >
            <Icon name="qrcode" size={22} className="text-[#111]" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-8">{body}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#EDEDED]">
      <PageHeader
        title="我"
        onBack={null}
        right={
          <button
            type="button"
            aria-label="我的二维码"
            onClick={() => useUI.getState().navigate('myQr')}
            className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
          >
            <Icon name="qrcode" size={22} className="text-[#111]" />
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">{body}</div>
    </div>
  );
}
