/**
 * 设置页：
 *   - 账号与安全：修改密码、退出登录；
 *   - 消息通知：通知 / 声音 / 震动（声音与震动真实生效）；
 *   - 通用：深色模式（真实生效）、字体 / 多语言 / 清缓存（占位）；
 *   - 隐私：加好友方式三选一；
 *   - 关于：版本号（构建时由 web/package.json 的 version 注入）。
 */
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../store/useAuth';
import { useSettings } from '../store/useSettings';
import { useDiscover } from '../store/useDiscover';
import { useUI } from '../store/useUI';
import { AVATAR_COLORS, FRIEND_REQUEST_MODES, FRIEND_REQUEST_MODE_LABELS, NOTIFICATION_SOUNDS } from '../config';
import { getNotificationSound, setNotificationSound, playNotificationSound } from '../audio';
import { APP_VERSION } from '../lib/version';
import { currentPlatform, isNewerVersion, openDownload, pickDownload, platformLabel } from '../lib/update';
import PageHeader from '../components/PageHeader';
import SettingRow, { SettingSwitch } from '../components/SettingRow';
import Modal, { ModalActions } from '../components/Modal';
import Spinner from '../components/Spinner';
import Icon from '../components/Icon';

/** 性别可选项（与后端 GENDERS 对齐） */
const GENDER_OPTIONS = Object.freeze([
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'secret', label: '保密' },
]);

/** 合法 #RRGGBB 颜色（自定义取色校验用） */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** 发现页三项展示配置 */
const DISCOVER_LABELS = Object.freeze({ scan: '扫一扫', moments: '朋友圈', emoji: '我的表情' });
const DISCOVER_ICONS = Object.freeze({ scan: 'scan', moments: 'moments', emoji: 'sticker' });
const DISCOVER_COLORS = Object.freeze({ scan: '#07C160', moments: '#4C7DE0', emoji: '#F2B33D' });

/**
 * @param {{embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function SettingsPage({ embedded = false }) {
  const back = useUI((state) => state.back);
  const showToast = useUI((state) => state.showToast);
  const logout = useAuth((state) => state.logout);
  const user = useAuth((state) => state.user);
  const updateProfile = useAuth((state) => state.updateProfile);

  const discover = useDiscover((state) => state.config);
  const loadDiscover = useDiscover((state) => state.load);
  const updateDiscover = useDiscover((state) => state.update);
  const reorderDiscover = useDiscover((state) => state.reorder);

  const settings = useSettings((state) => state.settings);
  const loadSettings = useSettings((state) => state.load);
  const updateSettings = useSettings((state) => state.update);

  const [pwdOpen, setPwdOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [sound, setSound] = useState(() => getNotificationSound());

  // 用户名（微聊号）修改：一年仅可一次
  const [usernameOpen, setUsernameOpen] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState(user ? user.username || '' : '');
  const [savingUsername, setSavingUsername] = useState(false);

  // 检查更新
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateError, setUpdateError] = useState('');

  // 个人信息（从 ProfilePage 迁移至此）
  const [nickname, setNickname] = useState(user ? user.nickname || '' : '');
  const [signature, setSignature] = useState(user ? user.signature || '' : '');
  const [gender, setGender] = useState(user ? user.gender || '' : '');
  const [region, setRegion] = useState(user ? user.region || '' : '');
  const [color, setColor] = useState(user ? user.avatar_color || AVATAR_COLORS[0] : AVATAR_COLORS[0]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [discoverBusy, setDiscoverBusy] = useState('');

  useEffect(() => {
    loadSettings().catch(() => {});
  }, [loadSettings]);

  useEffect(() => {
    loadDiscover().catch(() => {});
  }, [loadDiscover]);

  useEffect(() => {
    if (!user) return;
    setNickname(user.nickname || '');
    setSignature(user.signature || '');
    setGender(user.gender || '');
    setRegion(user.region || '');
    setColor(user.avatar_color || AVATAR_COLORS[0]);
  }, [user && user.id]);

  // 用户名冷却期：365 天一次（服务端为准，这里只做前端展示与提前拦截）
  const usernameChangedAt = user ? Number(user.username_changed_at) || 0 : 0;
  const usernameNextAllowedAt = usernameChangedAt > 0 ? usernameChangedAt + 365 * 24 * 60 * 60 * 1000 : 0;
  const usernameDaysLeft =
    usernameNextAllowedAt > Date.now()
      ? Math.max(1, Math.ceil((usernameNextAllowedAt - Date.now()) / (24 * 60 * 60 * 1000)))
      : 0;
  const usernameLocked = usernameDaysLeft > 0;

  /**
   * 打开用户名修改弹窗（冷却期内给出明确提示而不是静默禁用）。
   * @returns {void}
   */
  const openUsernameEditor = () => {
    if (usernameLocked) {
      showToast(`用户名一年只能修改一次，还需 ${usernameDaysLeft} 天`, 'error');
      return;
    }
    setUsernameDraft(user ? user.username || '' : '');
    setUsernameOpen(true);
  };

  /**
   * 提交用户名修改。
   * @returns {Promise<void>}
   */
  const submitUsername = async () => {
    if (savingUsername) return;
    const next = usernameDraft.trim();
    if (!/^[A-Za-z0-9_]{4,16}$/.test(next)) {
      showToast('用户名需为 4-16 位字母、数字或下划线', 'error');
      return;
    }
    if (user && next === user.username) {
      showToast('新用户名与当前用户名相同', 'error');
      return;
    }
    setSavingUsername(true);
    try {
      await updateProfile({ username: next });
      setUsernameOpen(false);
      showToast('用户名已修改，下次登录请使用新用户名', 'success');
    } catch (err) {
      showToast((err && err.message) || '修改失败', 'error');
    } finally {
      setSavingUsername(false);
    }
  };

  /**
   * 检查更新：拉取服务端最新版本与三端安装包地址。
   * @returns {Promise<void>}
   */
  const checkUpdate = async () => {
    if (updateLoading) return;
    setUpdateOpen(true);
    setUpdateLoading(true);
    setUpdateError('');
    try {
      const data = await api.checkUpdate();
      setUpdateInfo(data);
    } catch (err) {
      setUpdateError((err && err.message) || '检查更新失败，请稍后再试');
    } finally {
      setUpdateLoading(false);
    }
  };

  /**
   * 下载当前平台安装包。
   * @param {{url: string}} item
   * @returns {void}
   */
  const handleDownload = (item) => {
    if (!item || !openDownload(item.url)) {
      showToast('下载地址不可用，请稍后再试', 'error');
      return;
    }
    showToast('已开始下载，完成后安装即可覆盖升级', 'success');
  };

  /**
   * 更新一个设置项（声音 / 震动等开关）。
   * @param {string} key
   * @param {boolean|string} value
   * @returns {Promise<void>}
   */
  const patch = async (key, value) => {
    if (busyKey) return;
    setBusyKey(key);
    try {
      await updateSettings({ [key]: value });
    } catch (err) {
      showToast((err && err.message) || '设置保存失败', 'error');
    } finally {
      setBusyKey('');
    }
  };

  /**
   * 保存个人信息（PATCH /api/me）。
   * @returns {Promise<void>}
   */
  const handleSaveProfile = async () => {
    if (savingProfile) return;
    const nick = nickname.trim();
    if (!nick) {
      showToast('昵称不能为空', 'error');
      return;
    }
    if ([...nick].length > 20) {
      showToast('昵称最多 20 个字符', 'error');
      return;
    }
    if ([...signature.trim()].length > 50) {
      showToast('个性签名最多 50 个字符', 'error');
      return;
    }
    if ([...region.trim()].length > 30) {
      showToast('地区最多 30 个字符', 'error');
      return;
    }
    if (!HEX_COLOR_PATTERN.test(color)) {
      showToast('头像颜色必须是 #RRGGBB 格式', 'error');
      return;
    }

    setSavingProfile(true);
    try {
      await updateProfile({
        nickname: nick,
        signature: signature.trim(),
        avatar_color: color,
        gender,
        region: region.trim(),
      });
      showToast('已保存');
    } catch (err) {
      showToast((err && err.message) || '保存失败', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  /**
   * 切换发现页某项开关。
   * @param {string} key
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  const handleDiscoverToggle = async (key, enabled) => {
    if (discoverBusy) return;
    setDiscoverBusy(key);
    try {
      await updateDiscover(key, enabled);
    } catch (err) {
      showToast((err && err.message) || '保存失败', 'error');
    } finally {
      setDiscoverBusy('');
    }
  };

  /**
   * 上移 / 下移发现页某项。
   * @param {string} key
   * @param {'up'|'down'} direction
   * @returns {Promise<void>}
   */
  const handleDiscoverMove = async (key, direction) => {
    if (discoverBusy) return;
    setDiscoverBusy(key);
    try {
      await reorderDiscover(key, direction);
    } catch (err) {
      showToast((err && err.message) || '排序失败', 'error');
    } finally {
      setDiscoverBusy('');
    }
  };

  /**
   * 选择提示音音效并即时试听（静音音效不发声）。
   * @param {string} key default/crisp/water/xylo/silent
   * @returns {void}
   */
  const handlePickSound = (key) => {
    setSound(key);
    setNotificationSound(key);
    playNotificationSound(key);
  };

  /**
   * 修改密码。
   * @returns {Promise<void>}
   */
  const submitPassword = async () => {
    if (savingPwd) return;
    if (!oldPassword) {
      showToast('请输入旧密码', 'error');
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 32) {
      showToast('新密码长度需在 8-32 位之间', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('两次输入的新密码不一致', 'error');
      return;
    }

    setSavingPwd(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      showToast('密码已修改', 'success');
      setPwdOpen(false);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      showToast((err && err.message) || '修改失败', 'error');
    } finally {
      setSavingPwd(false);
    }
  };

  /**
   * 退出登录（二次确认）。
   * @returns {void}
   */
  const handleLogout = () => {
    useUI.getState().openModal({
      title: '退出登录',
      content: '退出后需要重新输入账号密码登录，确定退出吗？',
      confirmText: '退出',
      danger: true,
      onConfirm: () => logout(),
    });
  };

  const body = (
    <div className={`mx-auto w-full ${embedded ? 'max-w-[560px] pt-6' : ''} pb-8`}>
      {/* 个人信息 */}
      <div className="mt-2 bg-white">
        <p className="px-4 pb-1 pt-3 text-[12px] text-[#888]">个人信息</p>
        <div className="px-4 pb-3">
          <p className="mb-2 text-[14px] text-[#333]">头像颜色</p>
          <div className="flex flex-wrap gap-3">
            {AVATAR_COLORS.map((item) => (
              <button
                key={item}
                type="button"
                aria-label={`选择颜色 ${item}`}
                onClick={() => setColor(item)}
                className={`flex h-9 w-9 items-center justify-center rounded-[6px] ${
                  color === item ? 'ring-2 ring-offset-2 ring-[#07C160]' : ''
                }`}
                style={{ backgroundColor: item }}
              >
                {color === item ? <Icon name="check" size={16} className="text-white" /> : null}
              </button>
            ))}
            <label
              className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-[6px] border border-dashed ${
                !AVATAR_COLORS.includes(color) ? 'border-[#07C160] text-[#07C160]' : 'border-[#C8C8C8] text-[#B2B2B2]'
              }`}
              title="自定义颜色"
            >
              <Icon name="plus" size={16} />
              <input
                type="color"
                value={HEX_COLOR_PATTERN.test(color) ? color : AVATAR_COLORS[0]}
                onChange={(event) => setColor(event.target.value)}
                className="absolute h-0 w-0 opacity-0"
                aria-label="自定义头像颜色"
              />
            </label>
          </div>
        </div>
        <div className="flex min-h-[52px] items-center gap-3 px-4">
          <span className="w-[72px] shrink-0 text-[14px] text-[#333]">昵称</span>
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            maxLength={20}
            placeholder="请输入昵称"
            className="h-[52px] min-w-0 flex-1 text-[16px] text-[#111] placeholder:text-[#B2B2B2]"
          />
        </div>
        <div className="ml-4 h-px bg-[#E5E5E5]" />
        {/* 用户名（微聊号）：一年仅可修改一次 */}
        <button
          type="button"
          onClick={openUsernameEditor}
          className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left active:bg-black/5"
        >
          <span className="w-[72px] shrink-0 text-[14px] text-[#333]">用户名</span>
          <span className="min-w-0 flex-1 truncate text-[16px] text-[#111]">
            {user && user.username ? user.username : '未设置'}
          </span>
          <span className="shrink-0 text-[12px] text-[#999]">
            {usernameLocked ? `${usernameDaysLeft} 天后可改` : '一年可改一次'}
          </span>
          <Icon name="chevronRight" size={18} className="shrink-0 text-[#C8C8C8]" />
        </button>
        <div className="ml-4 h-px bg-[#E5E5E5]" />
        <div className="flex min-h-[52px] items-center gap-3 px-4">
          <span className="w-[72px] shrink-0 text-[14px] text-[#333]">性别</span>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {GENDER_OPTIONS.map((option) => {
              const active = gender === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setGender(option.value)}
                  className={`h-[32px] rounded-[6px] px-3 text-[14px] ${
                    active ? 'bg-[#07C160] text-white' : 'bg-[#F5F5F5] text-[#666] active:bg-black/5'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="ml-4 h-px bg-[#E5E5E5]" />
        <div className="flex min-h-[52px] items-center gap-3 px-4">
          <span className="w-[72px] shrink-0 text-[14px] text-[#333]">地区</span>
          <input
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            maxLength={30}
            placeholder="例如：广东 深圳"
            className="h-[52px] min-w-0 flex-1 text-[16px] text-[#111] placeholder:text-[#B2B2B2]"
          />
        </div>
        <div className="ml-4 h-px bg-[#E5E5E5]" />
        <div className="flex items-start gap-3 px-4 py-3">
          <span className="mt-1 w-[72px] shrink-0 text-[14px] text-[#333]">个性签名</span>
          <textarea
            value={signature}
            onChange={(event) => setSignature(event.target.value)}
            maxLength={50}
            rows={2}
            placeholder="介绍一下自己吧"
            className="min-h-[46px] min-w-0 flex-1 text-[16px] leading-[22px] text-[#111] placeholder:text-[#B2B2B2]"
          />
        </div>
        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={handleSaveProfile}
            disabled={savingProfile}
            className={`flex h-[46px] w-full items-center justify-center gap-2 rounded-lg text-[16px] font-medium text-white ${
              savingProfile ? 'bg-[#7FDBAA]' : 'bg-[#07C160] active:bg-[#06AD56]'
            }`}
          >
            {savingProfile ? <Spinner size={18} className="text-white" /> : null}
            保存
          </button>
        </div>
      </div>

      {/* 账号与安全 */}
      <div className="mt-2 bg-white">
        <p className="px-4 pb-1 pt-3 text-[12px] text-[#888]">账号与安全</p>
        <SettingRow icon="lock" title="修改密码" onClick={() => setPwdOpen(true)} />
        <SettingRow icon="logout" iconColor="#FA5151" title="退出登录" onClick={handleLogout} last danger />
      </div>

      {/* 消息通知 */}
      <div className="mt-2 bg-white">
        <p className="px-4 pb-1 pt-3 text-[12px] text-[#888]">消息通知</p>
        <SettingRow
          icon="chat"
          title="接收新消息通知"
          right={
            <SettingSwitch
              checked={Boolean(settings.notification_enabled)}
              onChange={(next) => patch('notification_enabled', next)}
              disabled={busyKey === 'notification_enabled'}
            />
          }
        />
        <SettingRow
          icon="volume"
          title="声音"
          right={
            <SettingSwitch
              checked={Boolean(settings.sound_enabled)}
              onChange={(next) => patch('sound_enabled', next)}
              disabled={busyKey === 'sound_enabled'}
            />
          }
        />
        <div className="border-b border-[#F0F0F0] px-4 py-3">
          <p className="mb-2 text-[14px] text-[#333]">提示音</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(NOTIFICATION_SOUNDS).map(([key, label]) => {
              const active = sound === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handlePickSound(key)}
                  className={`h-[32px] rounded-[6px] px-3 text-[13px] ${
                    active ? 'bg-[#07C160] text-white' : 'bg-[#F5F5F5] text-[#666] active:bg-black/5'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <SettingRow
          icon="refresh"
          iconColor="#10AEFF"
          title="震动"
          right={
            <SettingSwitch
              checked={Boolean(settings.vibrate_enabled)}
              onChange={(next) => patch('vibrate_enabled', next)}
              disabled={busyKey === 'vibrate_enabled'}
            />
          }
          last
        />
      </div>

      {/* 通用 */}
      <div className="mt-2 bg-white">
        <p className="px-4 pb-1 pt-3 text-[12px] text-[#888]">通用</p>
        <SettingRow
          icon="settings"
          iconColor="#8E8E93"
          title="深色模式"
          right={
            <SettingSwitch
              checked={Boolean(settings.dark_mode)}
              onChange={(next) => patch('dark_mode', next)}
              disabled={busyKey === 'dark_mode'}
            />
          }
        />
        <SettingRow icon="settings" iconColor="#8E8E93" title="字体大小" onClick={() => showToast('开发中，敬请期待')} />
        <SettingRow icon="settings" iconColor="#8E8E93" title="多语言" onClick={() => showToast('开发中，敬请期待')} />
        <SettingRow icon="trash" iconColor="#8E8E93" title="清理缓存" onClick={() => showToast('已是最新，无需清理')} last />
      </div>

      {/* 隐私 */}
      <div className="mt-2 bg-white">
        <p className="px-4 pb-1 pt-3 text-[12px] text-[#888]">隐私 · 加我为好友的方式</p>
        {FRIEND_REQUEST_MODES.map((mode, index) => (
          <SettingRow
            key={mode}
            icon="users"
            iconColor="#07C160"
            title={FRIEND_REQUEST_MODE_LABELS[mode]}
            onClick={() => patch('friend_request_mode', mode)}
            right={
              settings.friend_request_mode === mode ? (
                <Icon name="check" size={18} className="text-[#07C160]" />
              ) : (
                <Icon name="chevronRight" size={18} className="text-[#C8C8C8]" />
              )
            }
            last={index === FRIEND_REQUEST_MODES.length - 1}
          />
        ))}
      </div>

      {/* 发现页管理 */}
      <div className="mt-2 bg-white">
        <p className="px-4 pb-1 pt-3 text-[12px] text-[#888]">发现页管理</p>
        {[...discover]
          .sort((a, b) => Number(a.sort) - Number(b.sort))
          .map((item, index, list) => (
            <div
              key={item.key}
              className={`flex min-h-[52px] items-center gap-3 px-4 ${
                index === list.length - 1 ? '' : 'border-b border-[#F0F0F0]'
              }`}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px]"
                style={{ backgroundColor: DISCOVER_COLORS[item.key] || '#07C160' }}
              >
                <Icon name={DISCOVER_ICONS[item.key] || 'discover'} size={18} className="text-white" />
              </span>
              <span className="min-w-0 flex-1 text-[15px] text-[#111]">{DISCOVER_LABELS[item.key] || item.key}</span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  aria-label="上移"
                  onClick={() => handleDiscoverMove(item.key, 'up')}
                  disabled={item.sort === 0 || discoverBusy === item.key}
                  className={`flex h-8 w-8 items-center justify-center rounded-[4px] bg-[#F5F5F5] ${
                    item.sort === 0 ? 'text-[#C8C8C8]' : 'text-[#333] active:bg-black/5'
                  }`}
                >
                  <Icon name="chevronRight" size={14} className="rotate-[-90deg]" />
                </button>
                <button
                  type="button"
                  aria-label="下移"
                  onClick={() => handleDiscoverMove(item.key, 'down')}
                  disabled={item.sort === list.length - 1 || discoverBusy === item.key}
                  className={`flex h-8 w-8 items-center justify-center rounded-[4px] bg-[#F5F5F5] ${
                    item.sort === list.length - 1 ? 'text-[#C8C8C8]' : 'text-[#333] active:bg-black/5'
                  }`}
                >
                  <Icon name="chevronRight" size={14} className="rotate-90" />
                </button>
                <SettingSwitch
                  checked={Boolean(item.enabled)}
                  onChange={(next) => handleDiscoverToggle(item.key, next)}
                  disabled={discoverBusy === item.key}
                />
              </div>
            </div>
          ))}
      </div>

      {/* 关于 */}
      <div className="mt-2 bg-white">
        <SettingRow
          icon="settings"
          iconColor="#8E8E93"
          title="版本号"
          right={<span className="text-[13px] text-[#999]">{APP_VERSION}</span>}
        />
        <SettingRow
          icon="refresh"
          iconColor="#07C160"
          title="检查更新"
          subtitle={`当前版本 ${APP_VERSION} · ${platformLabel(currentPlatform())}`}
          onClick={checkUpdate}
          last
        />
      </div>

      <p className="px-4 py-5 text-center text-[11px] leading-4 text-[#C8C8C8]">
        微聊 · 数据存储在你的服务器
      </p>
    </div>
  );

  const usernameModal = (
    <Modal
      open={usernameOpen}
      onClose={() => setUsernameOpen(false)}
      title="修改用户名"
      footer={
        <ModalActions
          onCancel={() => setUsernameOpen(false)}
          onConfirm={submitUsername}
          confirmText="确定"
          loading={savingUsername}
        />
      }
    >
      <div className="space-y-2 py-1">
        <input
          value={usernameDraft}
          onChange={(event) => setUsernameDraft(event.target.value)}
          maxLength={16}
          placeholder="4-16 位字母、数字或下划线"
          className="h-11 w-full rounded-[6px] bg-[#F7F7F7] px-3 text-[15px]"
        />
        <p className="text-[12px] leading-5 text-[#999]">
          用户名（微聊号）一年只能修改一次，修改后旧用户名立即失效，登录请使用新用户名或手机号。
        </p>
      </div>
    </Modal>
  );

  const updateModal = (
    <Modal
      open={updateOpen}
      onClose={() => setUpdateOpen(false)}
      title="检查更新"
      width={340}
      footer={
        <button
          type="button"
          onClick={() => setUpdateOpen(false)}
          className="h-[48px] w-full text-[16px] text-[#333] active:bg-black/5"
        >
          关闭
        </button>
      }
    >
      <div className="py-1">
        {updateLoading ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <Spinner size={20} className="text-[#07C160]" />
            <p className="text-[13px] text-[#999]">正在检查更新…</p>
          </div>
        ) : updateError ? (
          <div className="py-4 text-center">
            <p className="text-[13px] leading-5 text-[#FA5151]">{updateError}</p>
            <button
              type="button"
              onClick={checkUpdate}
              className="mt-3 h-[36px] rounded-[6px] bg-[#F5F5F5] px-4 text-[14px] text-[#333] active:bg-black/5"
            >
              重试
            </button>
          </div>
        ) : (
          <>
            <p className="text-center text-[15px] text-[#111]">
              {updateInfo && isNewerVersion(updateInfo.version, APP_VERSION) ? '发现新版本' : '已是最新版本'}
            </p>
            <p className="mt-1 text-center text-[12px] text-[#999]">
              当前 {APP_VERSION}
              {updateInfo ? ` · 最新 ${updateInfo.version}` : ''}
            </p>

            {updateInfo &&
            isNewerVersion(updateInfo.version, APP_VERSION) &&
            Array.isArray(updateInfo.notes) &&
            updateInfo.notes.length > 0 ? (
              <ul className="mx-auto mt-3 max-w-[280px] space-y-1">
                {updateInfo.notes.map((note) => (
                  <li key={note} className="text-[12px] leading-5 text-[#666]">
                    · {note}
                  </li>
                ))}
              </ul>
            ) : null}

            {updateInfo && Array.isArray(updateInfo.downloads) && updateInfo.downloads.length > 0 ? (
              <div className="mt-4 space-y-2">
                {(() => {
                  const preferred = pickDownload(updateInfo.downloads, currentPlatform());
                  if (!preferred) {
                    return <p className="text-center text-[12px] text-[#999]">该版本暂未提供本平台安装包</p>;
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => handleDownload(preferred)}
                      className="flex h-[44px] w-full items-center justify-center rounded-lg bg-[#07C160] text-[16px] font-medium text-white active:bg-[#06AD56]"
                    >
                      {isNewerVersion(updateInfo.version, APP_VERSION) ? '下载' : '重新下载'} {preferred.label}
                    </button>
                  );
                })()}
                <div className="flex flex-wrap justify-center gap-2">
                  {(updateInfo.downloads || [])
                    .filter((item) => item !== pickDownload(updateInfo.downloads, currentPlatform()))
                    .map((item) => (
                      <button
                        key={item.platform}
                        type="button"
                        onClick={() => handleDownload(item)}
                        className="h-[30px] rounded-[6px] bg-[#F5F5F5] px-3 text-[12px] text-[#333] active:bg-black/5"
                      >
                        {item.label}
                      </button>
                    ))}
                </div>
                <p className="text-center text-[11px] leading-4 text-[#B2B2B2]">
                  下载完成后点击安装包即可覆盖升级，聊天记录不会丢失
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );

  const passwordModal = (
    <Modal
      open={pwdOpen}
      onClose={() => setPwdOpen(false)}
      title="修改密码"
      footer={
        <ModalActions
          onCancel={() => setPwdOpen(false)}
          onConfirm={submitPassword}
          confirmText="确定"
          loading={savingPwd}
        />
      }
    >
      <div className="space-y-2 py-1">
        <input
          type="password"
          value={oldPassword}
          onChange={(event) => setOldPassword(event.target.value)}
          placeholder="旧密码"
          className="h-11 w-full rounded-[6px] bg-[#F7F7F7] px-3 text-[15px]"
        />
        <input
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="新密码（8-32 位）"
          className="h-11 w-full rounded-[6px] bg-[#F7F7F7] px-3 text-[15px]"
        />
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="确认新密码"
          className="h-11 w-full rounded-[6px] bg-[#F7F7F7] px-3 text-[15px]"
        />
        {savingPwd ? (
          <div className="flex justify-center py-1">
            <Spinner size={16} className="text-[#07C160]" />
          </div>
        ) : null}
      </div>
    </Modal>
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
          <h1 className="ml-1 text-[16px] font-semibold text-[#111]">设置</h1>
        </div>
      ) : (
        <PageHeader title="设置" onBack={back} />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      {passwordModal}
      {usernameModal}
      {updateModal}
    </div>
  );
}
