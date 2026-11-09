/**
 * 面对面配对页：传文件（1 对 1）/ 面对面建群（≥3 含自己）。
 *   - 创建配对：生成 4 位数字码，5 分钟有效；
 *   - 输入对方码加入；
 *   - file 凑满 2 人由服务端创建/复用单聊并推送 face-pair:ready，前端自动进入会话；
 *   - group 成员 ≥3 后「确认成组」调用 createGroupFromPairing 建群。
 */
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useUI } from '../store/useUI';
import { onSocket } from '../socket';
import { errorText } from '../lib/errorText';
import { FACE_PAIR_CODE_LEN } from '../config';
import Avatar from '../components/Avatar';
import PageHeader from '../components/PageHeader';
import Spinner from '../components/Spinner';
import Icon from '../components/Icon';

/**
 * @param {{embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function FacePairPage({ embedded = false }) {
  const back = useUI((state) => state.back);
  const navigate = useUI((state) => state.navigate);
  const showToast = useUI((state) => state.showToast);
  const initialKind = useUI((state) => state.facePairKind);

  const [kind, setKind] = useState(initialKind === 'group' ? 'group' : 'file');
  const [pairing, setPairing] = useState(null);
  const [members, setMembers] = useState([]);
  const [codeInput, setCodeInput] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * 切换配对类型并重置本地状态。
   * @param {'file'|'group'} next
   * @returns {void}
   */
  const switchKind = (next) => {
    setKind(next);
    setPairing(null);
    setMembers([]);
    setCodeInput('');
    setCountdown(0);
  };

  /**
   * 拉取配对详情（用于补齐 code / expires_at / 成员列表）。
   * @param {number} pairingId
   * @returns {Promise<void>}
   */
  const refreshPairing = async (pairingId) => {
    const data = await api.facePairDetail(pairingId);
    setPairing(data.pairing || null);
    setMembers(Array.isArray(data.members) ? data.members : []);
  };

  /**
   * 创建配对。
   * @returns {Promise<void>}
   */
  const handleCreate = async () => {
    if (loading || busy) return;
    setLoading(true);
    try {
      const data = await api.facePairCreate(kind);
      await refreshPairing(data.pairing_id);
    } catch (err) {
      showToast(errorText(err, '创建失败'), 'error');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 加入配对。
   * @returns {Promise<void>}
   */
  const handleJoin = async () => {
    const code = codeInput.trim();
    if (code.length !== FACE_PAIR_CODE_LEN || !/^\d+$/.test(code)) {
      showToast(`请输入 ${FACE_PAIR_CODE_LEN} 位数字码`, 'error');
      return;
    }
    if (loading || busy) return;
    setLoading(true);
    try {
      const data = await api.facePairJoin(kind, code);
      // 面对面传文件凑满 2 人：服务端返回会话 id，直接进入
      if (data.conversation_id) {
        navigate(`chat/${data.conversation_id}`);
        return;
      }
      await refreshPairing(data.pairing_id);
    } catch (err) {
      showToast(errorText(err, '加入失败'), 'error');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 面对面建群确认成组。
   * @returns {Promise<void>}
   */
  const handleConfirmGroup = async () => {
    if (!pairing || members.length < 3 || busy) return;
    setBusy(true);
    try {
      const data = await api.facePairCreateGroup(pairing.pairing_id);
      navigate(`chat/${data.conversation_id}`);
    } catch (err) {
      showToast(errorText(err, '建群失败'), 'error');
    } finally {
      setBusy(false);
    }
  };

  // 实时事件：成员变化 / 传文件就绪 / 建群成功关闭
  useEffect(() => {
    const offUpdate = onSocket('face-pair:update', (payload) => {
      if (!payload || !pairing) return;
      if (Number(payload.pairing_id) !== Number(pairing.pairing_id)) return;
      setMembers(Array.isArray(payload.members) ? payload.members : []);
    });
    const offReady = onSocket('face-pair:ready', (payload) => {
      if (!payload || !payload.conversation_id) return;
      if (pairing && Number(payload.pairing_id) !== Number(pairing.pairing_id)) return;
      navigate(`chat/${payload.conversation_id}`);
    });
    const offResolved = onSocket('face-pair:resolved', (payload) => {
      if (!payload || !payload.conversation_id) return;
      if (pairing && Number(payload.pairing_id) !== Number(pairing.pairing_id)) return;
      navigate(`chat/${payload.conversation_id}`);
    });
    return () => {
      offUpdate();
      offReady();
      offResolved();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing]);

  // 倒计时：过期后清空配对
  useEffect(() => {
    if (!pairing || !pairing.expires_at) return undefined;
    const tick = () => {
      const remain = Math.max(0, Math.ceil((Number(pairing.expires_at) - Date.now()) / 1000));
      setCountdown(remain);
      if (remain <= 0) {
        setPairing(null);
        setMembers([]);
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [pairing]);

  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const codeDigits = pairing ? String(pairing.code || '').padStart(FACE_PAIR_CODE_LEN, '0').split('') : [];

  const content = (
    <div className="pb-8">
      {/* 类型切换 */}
      <div className="mx-4 mt-3 flex rounded-[8px] bg-black/[0.06] p-[3px]">
        {[
          { key: 'file', label: '面对面传文件' },
          { key: 'group', label: '面对面建群' },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => switchKind(item.key)}
            className={`h-9 flex-1 rounded-[6px] text-[14px] transition-colors ${
              kind === item.key ? 'bg-white font-medium text-[#111] shadow-sm' : 'text-[#666]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {!pairing ? (
        <div className="mx-4 mt-3 space-y-3">
          <div className="rounded-[10px] bg-white px-4 py-5">
            <p className="text-center text-[13px] text-[#999]">
              生成一个 {FACE_PAIR_CODE_LEN} 位数字码，让身边的朋友输入后配对
              {kind === 'file' ? '，凑满 2 人即可互传文件' : '，凑满 3 人即可建群'}
            </p>
            <button
              type="button"
              onClick={handleCreate}
              disabled={loading}
              className="mt-4 flex h-[44px] w-full items-center justify-center gap-2 rounded-[8px] bg-[#07C160] text-[16px] font-medium text-white active:bg-[#06AD56] disabled:opacity-60"
            >
              {loading ? <Spinner size={17} className="text-white" /> : null}
              生成我的数字码
            </button>
          </div>

          <div className="rounded-[10px] bg-white px-4 py-4">
            <p className="mb-2 text-[13px] text-[#888]">输入对方数字码加入</p>
            <div className="flex items-center gap-2">
              <input
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value.replace(/\D/g, '').slice(0, FACE_PAIR_CODE_LEN))}
                inputMode="numeric"
                maxLength={FACE_PAIR_CODE_LEN}
                placeholder="4 位数字"
                className="h-[44px] min-w-0 flex-1 rounded-[8px] bg-[#F7F7F7] px-3 text-center text-[18px] tracking-[0.4em] text-[#111] placeholder:text-[#C8C8C8] placeholder:tracking-normal"
              />
              <button
                type="button"
                onClick={handleJoin}
                disabled={loading || codeInput.length !== FACE_PAIR_CODE_LEN}
                className="flex h-[44px] shrink-0 items-center justify-center rounded-[8px] bg-[#07C160] px-5 text-[15px] font-medium text-white active:bg-[#06AD56] disabled:bg-[#D8D8D8]"
              >
                加入
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-4 mt-3 space-y-3">
          {/* 我的数字码 */}
          <div className="rounded-[10px] bg-white px-4 py-6 text-center">
            <p className="text-[13px] text-[#999]">我的数字码（{kind === 'file' ? '传文件' : '建群'}）</p>
            <div className="mt-3 flex items-center justify-center gap-3">
              {codeDigits.map((digit, index) => (
                <span
                  key={index}
                  className="flex h-14 w-11 items-center justify-center rounded-[8px] bg-[#07C160] text-[26px] font-semibold text-white"
                >
                  {digit}
                </span>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-[#B2B2B2]">
              {countdown > 0 ? `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒后过期` : '已过期'}
            </p>
            <button
              type="button"
              onClick={handleCreate}
              disabled={loading}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-[#F2F2F2] px-4 text-[13px] text-[#333] active:bg-[#E5E5E5] disabled:opacity-60"
            >
              {loading ? <Spinner size={13} className="text-[#333]" /> : <Icon name="refresh" size={14} className="text-[#333]" />}
              刷新码
            </button>
          </div>

          {/* 成员列表 */}
          <div className="rounded-[10px] bg-white px-4 py-4">
            <p className="mb-3 text-[13px] text-[#888]">
              已加入（{members.length}
              {kind === 'file' ? '/2' : ''}）
            </p>
            {members.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-[#B2B2B2]">等待成员加入…</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {members.map((member) => (
                  <div key={member.user_id} className="flex w-[56px] flex-col items-center gap-1">
                    <Avatar
                      name={member.nickname}
                      color={member.avatar_color}
                      src={member.avatar_url}
                      size={48}
                    />
                    <span className="w-full truncate text-center text-[11px] leading-3 text-[#666]">
                      {member.nickname}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {kind === 'group' ? (
            <button
              type="button"
              onClick={handleConfirmGroup}
              disabled={members.length < 3 || busy}
              className={`flex h-[46px] w-full items-center justify-center gap-2 rounded-[8px] text-[16px] font-medium text-white ${
                members.length >= 3 ? 'bg-[#07C160] active:bg-[#06AD56]' : 'bg-[#D8D8D8]'
              }`}
            >
              {busy ? <Spinner size={17} className="text-white" /> : null}
              确认成组({members.length})
            </button>
          ) : (
            <p className="rounded-[8px] bg-black/[0.04] px-4 py-3 text-center text-[13px] text-[#888]">
              等待对方加入，凑满 2 人后自动进入传文件会话
            </p>
          )}
        </div>
      )}
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
          <h1 className="ml-1 text-[16px] font-semibold text-[#111]">面对面</h1>
        </div>
      ) : (
        <PageHeader title="面对面" onBack={back} />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {embedded ? <div className="mx-auto w-full max-w-[620px]">{content}</div> : content}
      </div>
    </div>
  );
}
