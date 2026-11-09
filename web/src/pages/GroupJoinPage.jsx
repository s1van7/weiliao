/**
 * 群邀请入群页：打开 #/join/<token>（或扫码 wlgroup:<token>）后解析群信息并加入。
 */
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useUI } from '../store/useUI';
import { errorText } from '../lib/errorText';
import PageHeader from '../components/PageHeader';
import Avatar from '../components/Avatar';
import Spinner from '../components/Spinner';
import Icon from '../components/Icon';

/**
 * @param {{token: string, embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function GroupJoinPage({ token, embedded = false }) {
  const back = useUI((state) => state.back);
  const navigate = useUI((state) => state.navigate);
  const showToast = useUI((state) => state.showToast);

  const [group, setGroup] = useState(null);
  const [alreadyJoined, setAlreadyJoined] = useState(false);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [failed, setFailed] = useState('');

  // 解析邀请
  useEffect(() => {
    if (!token) {
      setLoading(false);
      setFailed('群邀请无效或已过期');
      return undefined;
    }
    let alive = true;
    setLoading(true);
    api
      .resolveGroupInvite(token)
      .then((data) => {
        if (!alive) return;
        setGroup(data.group || null);
        setAlreadyJoined(Boolean(data.already_joined));
      })
      .catch((err) => {
        if (!alive) return;
        setFailed(errorText(err, '群邀请无效或已过期'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /**
   * 加入群聊并进入会话。
   * @returns {Promise<void>}
   */
  const handleJoin = async () => {
    if (!group || joining) return;
    setJoining(true);
    try {
      const data = await api.joinGroupInvite(token);
      navigate(`chat/${data.conversation_id}`);
    } catch (err) {
      showToast(errorText(err, '加入群聊失败'), 'error');
      setJoining(false);
    }
  };

  const header = embedded ? (
    <div className="flex h-[52px] shrink-0 items-center border-b border-[#E0E0E0] bg-[#F5F5F5] px-4">
      <button
        type="button"
        onClick={back}
        className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
        aria-label="返回"
      >
        <Icon name="back" size={20} className="text-[#111]" />
      </button>
      <h1 className="ml-1 text-[16px] font-semibold text-[#111]">群邀请</h1>
    </div>
  ) : (
    <PageHeader title="群邀请" onBack={back} />
  );

  const content = (
    <div className={`mx-auto w-full ${embedded ? 'max-w-[560px] pt-6' : ''} pb-8`}>
      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size={22} className="text-[#B2B2B2]" />
        </div>
      ) : failed ? (
        <div className="mx-4 flex flex-col items-center gap-3 rounded-[12px] bg-white px-6 py-10">
          <p className="text-[15px] text-[#333]">{failed}</p>
          <button
            type="button"
            onClick={back}
            className="rounded-[6px] bg-[#07C160] px-5 py-2 text-[14px] text-white active:bg-[#06AD56]"
          >
            返回
          </button>
        </div>
      ) : group ? (
        <div className="mx-4 flex flex-col items-center gap-3 rounded-[12px] bg-white px-6 py-8">
          <Avatar name={group.name || '群聊'} group src={group.avatar_url} size={64} radius={6} />
          <p className="text-[17px] font-semibold text-[#111]">{group.name || '群聊'}</p>
          <p className="text-[12px] text-[#999]">群成员 · {group.member_count} 人</p>

          {alreadyJoined ? (
            <button
              type="button"
              onClick={() => navigate(`chat/${group.id}`)}
              className="mt-3 flex h-[46px] w-full items-center justify-center rounded-[8px] bg-[#07C160] text-[16px] font-medium text-white active:bg-[#06AD56]"
            >
              进入群聊
            </button>
          ) : (
            <button
              type="button"
              onClick={handleJoin}
              disabled={joining}
              className="mt-3 flex h-[46px] w-full items-center justify-center gap-2 rounded-[8px] bg-[#07C160] text-[16px] font-medium text-white active:bg-[#06AD56] disabled:opacity-60"
            >
              {joining ? <Spinner size={17} className="text-white" /> : null}
              加入群聊
            </button>
          )}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className={`flex h-full flex-col ${embedded ? 'bg-[#F5F5F5]' : 'bg-[#EDEDED]'}`}>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
    </div>
  );
}
