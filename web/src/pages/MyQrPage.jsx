/**
 * 我的二维码：GET /api/me/qr → qrcode 生成 dataURL + 刷新按钮。
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api';
import { useAuth } from '../store/useAuth';
import { useUI } from '../store/useUI';
import Avatar from '../components/Avatar';
import PageHeader from '../components/PageHeader';
import Spinner from '../components/Spinner';
import Icon from '../components/Icon';

/**
 * @param {{embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function MyQrPage({ embedded = false }) {
  const user = useAuth((state) => state.user);
  const back = useUI((state) => state.back);
  const showToast = useUI((state) => state.showToast);

  const [qrDataUrl, setQrDataUrl] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * 拉取 token 并生成二维码。
   * @param {{refresh?: boolean}} [options]
   * @returns {Promise<void>}
   */
  const load = async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = refresh ? await api.refreshQr() : await api.meQr();
      const nextToken = data.token || data.qr_content || '';
      const url = await QRCode.toDataURL(nextToken, { width: 240, margin: 1 });
      setToken(nextToken);
      setQrDataUrl(url);
    } catch (err) {
      showToast((err && err.message) || '二维码加载失败', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const body = (
    <div className={`mx-auto w-full ${embedded ? 'max-w-[560px] pt-6' : ''} pb-8`}>
      <div className="mx-4 flex flex-col items-center gap-3 rounded-[12px] bg-white px-6 py-8">
        <Avatar
          name={user ? user.nickname : ''}
          color={user ? user.avatar_color : '#07C160'}
          src={user ? user.avatar_url : ''}
          size={64}
          radius={6}
        />
        <p className="text-[17px] font-semibold text-[#111]">{user ? user.nickname : '我'}</p>
        <p className="text-[12px] text-[#999]">扫一扫二维码，添加我为好友</p>

        {loading ? (
          <div className="flex h-[240px] w-[240px] items-center justify-center rounded-[8px] bg-[#F7F7F7]">
            <Spinner size={22} className="text-[#B2B2B2]" />
          </div>
        ) : (
          <img
            src={qrDataUrl}
            alt="我的二维码"
            className="h-[240px] w-[240px] rounded-[8px] border border-[#F0F0F0]"
            draggable="false"
          />
        )}

        <button
          type="button"
          onClick={() => load({ refresh: true })}
          disabled={refreshing}
          className="mt-1 flex h-9 items-center gap-1.5 rounded-full bg-[#07C160] px-5 text-[14px] text-white active:bg-[#06AD56] disabled:opacity-60"
        >
          {refreshing ? <Spinner size={14} className="text-white" /> : <Icon name="refresh" size={15} className="text-white" />}
          刷新二维码
        </button>

        {token ? (
          <p className="mt-2 max-w-full break-all px-4 text-center text-[11px] leading-4 text-[#C8C8C8]">{token}</p>
        ) : null}
      </div>
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
          <h1 className="ml-1 text-[16px] font-semibold text-[#111]">我的二维码</h1>
        </div>
      ) : (
        <PageHeader title="我的二维码" onBack={back} />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </div>
  );
}
