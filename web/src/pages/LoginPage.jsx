/**
 * 登录 / 注册页：
 *   - 全屏白底，顶部绿色气泡 Logo + 「微聊」；
 *   - 输入框底部 1px 线，聚焦变绿；
 *   - 主按钮绿色圆角 8px 高 46px，提交中 loading 禁用；
 *   - 登录失败 423 时显示「锁定中，X 秒后重试」倒计时；
 *   - 注册支持「用户名 / 手机号」两种方式（Tab 单选）。
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../store/useAuth';
import { SERVER_URL } from '../config';
import Spinner from '../components/Spinner';
import Icon from '../components/Icon';

/** 下载页地址（同源时为相对路径，App 内为远端绝对地址） */
const DOWNLOAD_PAGE_URL = `${SERVER_URL}/dl`;

/** 三端安装包：文件名与体积文案，链接由 SERVER_URL 拼出 */
const CLIENTS = [
  {
    key: 'android',
    name: '安卓',
    meta: 'APK · 3 MB',
    file: 'WeiLiao-Android-1.1.10.apk',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#3DDC84" aria-hidden="true">
        <path d="M17.6 9.5l1.7-3a.4.4 0 0 0-.7-.4l-1.7 3a10.4 10.4 0 0 0-9.8 0l-1.7-3a.4.4 0 0 0-.7.4l1.7 3A8.7 8.7 0 0 0 2 16.5h20a8.7 8.7 0 0 0-4.4-7zM7 13.6a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zm10 0a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z" />
      </svg>
    ),
  },
  {
    key: 'windows',
    name: 'Windows',
    meta: 'EXE · 75 MB',
    file: 'WeiLiao-Setup-1.1.10.exe',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#00A4EF" aria-hidden="true">
        <path d="M3 5.5l7.5-.9v7.1H3V5.5zm8.4-1l9.6-1.3v8.6h-9.6V4.5zM3 12.6h7.5v7.1L3 18.8v-6.2zm8.4 0H21v8.6l-9.6-1.3v-7.3z" />
      </svg>
    ),
  },
  {
    key: 'ios',
    name: '苹果',
    meta: 'ZIP · 需 Mac 签名',
    file: 'WeiLiao-iOS-Xcode-1.1.10.zip',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#191919" aria-hidden="true">
        <path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.5 0-2.9.9-3.7 2.2-1.6 2.7-.4 6.7 1.1 8.9.7 1.1 1.6 2.3 2.8 2.2 1.1 0 1.5-.7 2.9-.7 1.3 0 1.7.7 2.9.7 1.2 0 2-1.1 2.7-2.2.9-1.2 1.2-2.5 1.2-2.5-.1 0-2.4-.9-2.4-3.4zM14.1 5.8c.6-.8 1.1-1.9 1-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.7-1.3z" />
      </svg>
    ),
  },
];

/** 是否运行在已安装的原生客户端里（App 内不需要再下载自己） */
const isNativeShell =
  typeof window !== 'undefined' &&
  ((window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
    Boolean(window.weiliaoDesktop));

/**
 * 底部单线的输入框。
 * @param {{value: string, onChange: (e: any) => void, placeholder: string, type?: string, maxLength?: number, autoComplete?: string, inputMode?: any}} props
 * @returns {JSX.Element}
 */
function LineInput({ value, onChange, placeholder, type = 'text', maxLength, autoComplete, inputMode }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      maxLength={maxLength}
      autoComplete={autoComplete}
      inputMode={inputMode}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={`h-[50px] w-full border-b bg-transparent text-[16px] text-[#111] transition-colors placeholder:text-[#B2B2B2] ${
        focused ? 'border-[#07C160]' : 'border-[#E5E5E5]'
      }`}
    />
  );
}

export default function LoginPage() {
  const login = useAuth((state) => state.login);
  const register = useAuth((state) => state.register);

  const [mode, setMode] = useState('login'); // login | register
  const [regWay, setRegWay] = useState('username'); // username | phone

  const [account, setAccount] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(0);

  // 锁定倒计时
  useEffect(() => {
    if (lockSeconds <= 0) return undefined;
    const timer = setInterval(() => {
      setLockSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [lockSeconds > 0]);

  /**
   * 本地校验，减少无效请求。
   * @returns {string} 错误文案，空串表示通过
   */
  const validate = () => {
    if (mode === 'login') {
      if (!account.trim()) return '请输入账号';
      if (!password) return '请输入密码';
      return '';
    }
    if (regWay === 'username') {
      if (!/^[A-Za-z0-9_]{4,16}$/.test(username.trim())) return '用户名需为 4-16 位字母、数字或下划线';
    } else if (!/^1\d{10}$/.test(phone.trim())) {
      return '请输入 11 位手机号';
    }
    const nick = nickname.trim();
    if (!nick || [...nick].length > 20) return '昵称长度需在 1-20 个字符之间';
    if (password.length < 8 || password.length > 32) return '密码长度需在 8-32 位之间';
    if (!inviteCode.trim()) return '请输入邀请码';
    return '';
  };

  /**
   * 提交登录 / 注册。
   * @param {import('react').FormEvent} event
   * @returns {Promise<void>}
   */
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting || lockSeconds > 0) return;

    const message = validate();
    if (message) {
      setError(message);
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(account.trim(), password);
      } else {
        await register({
          mode: regWay,
          username: username.trim(),
          phone: phone.trim(),
          nickname: nickname.trim(),
          password,
          inviteCode: inviteCode.trim(),
        });
      }
    } catch (err) {
      if (err && err.status === 423) {
        const remain = Number(err.payload && err.payload.retry_after) || 60;
        setLockSeconds(remain);
        setError(`锁定中，${remain} 秒后重试`);
      } else {
        setError(err && err.message ? err.message : '操作失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next) => {
    if (submitting) return;
    setMode(next);
    setError('');
  };

  const disabled = submitting || lockSeconds > 0;

  return (
    <div className="h-full w-full overflow-y-auto bg-white">
      <div className="mx-auto flex min-h-full w-full max-w-[360px] flex-col px-6 py-8">
        <div className="my-auto">
          {/* Logo */}
          <div className="flex flex-col items-center">
            <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
              <rect width="72" height="72" rx="18" fill="#07C160" />
              <path
                d="M36 16.5c-11.3 0-20.5 7.4-20.5 16.5 0 5.2 3.1 9.9 7.9 12.9-.5 2.7-2 5.7-4.1 8.1 4-.4 7.6-1.8 10.4-3.8 2 .5 4.2.8 6.3.8 11.3 0 20.5-7.4 20.5-16.5S47.3 16.5 36 16.5Z"
                fill="#FFFFFF"
              />
              <circle cx="28.6" cy="32.6" r="2.7" fill="#07C160" />
              <circle cx="43.4" cy="32.6" r="2.7" fill="#07C160" />
            </svg>
            <h1 className="mt-3 text-[28px] font-semibold leading-9 tracking-wide text-[#111]">微聊</h1>
            <p className="mt-1 text-[12px] text-[#B2B2B2]">简简单单，聊得开心</p>
          </div>

          {/* 注册方式 Tab */}
          {mode === 'register' ? (
            <div className="mt-6 flex gap-2">
              {[
                { key: 'username', label: '用用户名注册' },
                { key: 'phone', label: '用手机号注册' },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setRegWay(item.key);
                    setError('');
                  }}
                  className={`h-[32px] flex-1 rounded-full text-[13px] transition-colors ${
                    regWay === item.key ? 'bg-[#07C160] text-white' : 'bg-[#F2F2F2] text-[#666]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-7">
            {mode === 'login' ? (
              <>
                <LineInput
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="账号（用户名或手机号）"
                  autoComplete="username"
                  maxLength={20}
                />
                <LineInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="密码"
                  type="password"
                  autoComplete="current-password"
                  maxLength={32}
                />
              </>
            ) : (
              <>
                {regWay === 'username' ? (
                  <LineInput
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="用户名（4-16 位字母、数字或下划线）"
                    autoComplete="username"
                    maxLength={16}
                  />
                ) : (
                  <LineInput
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="手机号"
                    inputMode="numeric"
                    autoComplete="tel"
                    maxLength={11}
                  />
                )}
                <LineInput
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="昵称（1-20 个字符）"
                  maxLength={20}
                />
                <LineInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="密码（8-32 位）"
                  type="password"
                  autoComplete="new-password"
                  maxLength={32}
                />
                <LineInput
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="邀请码（需向管理员索取）"
                  autoComplete="off"
                  maxLength={32}
                />
              </>
            )}

            <div className="min-h-[28px] pt-2 text-[12px] leading-4 text-[#FA5151]">
              {lockSeconds > 0 ? `锁定中，${lockSeconds} 秒后重试` : error}
            </div>

            <button
              type="submit"
              disabled={disabled}
              className={`mt-2 flex h-[46px] w-full items-center justify-center gap-2 rounded-lg text-[16px] font-medium text-white transition-colors ${
                disabled ? 'bg-[#7FDBAA]' : 'bg-[#07C160] active:bg-[#06AD56]'
              }`}
            >
              {submitting ? <Spinner size={18} className="text-white" /> : null}
              {mode === 'login' ? '登录' : '注册并登录'}
            </button>
          </form>

          <div className="mt-5 text-center text-[13px]">
            {mode === 'login' ? (
              <button type="button" onClick={() => switchMode('register')} className="text-[#576B95]">
                没有账号？注册一个
              </button>
            ) : (
              <button type="button" onClick={() => switchMode('login')} className="text-[#576B95]">
                已有账号？直接登录
              </button>
            )}
          </div>

          {/* 客户端下载入口：原生 App 内不展示 */}
          {isNativeShell ? null : (
            <div className="mt-8">
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-[#EDEDED]" />
                <span className="text-[11px] tracking-wide text-[#B2B2B2]">下载客户端</span>
                <span className="h-px flex-1 bg-[#EDEDED]" />
              </div>

              <div className="mt-3.5 grid grid-cols-3 gap-2">
                {CLIENTS.map((item) => (
                  <a
                    key={item.key}
                    href={`${SERVER_URL}/downloads/${item.file}`}
                    download
                    className="flex h-[62px] flex-col items-center justify-center gap-0.5 rounded-[10px] bg-[#F7F7F7] transition-colors active:bg-[#EDEDED]"
                  >
                    <span className="flex items-center gap-1.5 text-[13px] font-medium text-[#333]">
                      {item.icon}
                      {item.name}
                    </span>
                    <span className="text-[10px] text-[#B2B2B2]">{item.meta}</span>
                  </a>
                ))}
              </div>

              <a
                href={DOWNLOAD_PAGE_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-2.5 block text-center text-[12px] text-[#576B95] active:opacity-60"
              >
                查看安装说明，或直接用网页版 →
              </a>
            </div>
          )}

          <div className="mt-7 flex items-center justify-center gap-1 text-[11px] text-[#C8C8C8]">
            <Icon name="lock" size={12} className="text-[#C8C8C8]" />
            登录状态将保存在本机
          </div>
        </div>
      </div>
    </div>
  );
}
