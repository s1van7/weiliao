/**
 * 新的朋友：待处理申请卡片（同意 / 拒绝），已处理显示状态。
 */
import { useEffect, useState } from 'react';
import { useChat } from '../store/useChat';
import { useUI } from '../store/useUI';
import Avatar from '../components/Avatar';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Spinner from '../components/Spinner';
import { formatDateOnly } from '../lib/time';

/**
 * @param {{embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function NewFriendsPage({ embedded = false }) {
  const requests = useChat((state) => state.friendRequests);
  const loadFriendRequests = useChat((state) => state.loadFriendRequests);
  const back = useUI((state) => state.back);
  const showToast = useUI((state) => state.showToast);

  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadFriendRequests('all')
      .catch((err) => {
        if (!cancelled) showToast((err && err.message) || '加载失败', 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadFriendRequests, showToast]);

  /**
   * 同意申请。
   * @param {Record<string, any>} request
   * @returns {Promise<void>}
   */
  const handleAccept = async (request) => {
    if (processing) return;
    setProcessing(request.id);
    try {
      await useChat.getState().acceptFriendRequest(request.id);
      showToast('已添加为好友');
    } catch (err) {
      showToast((err && err.message) || '操作失败', 'error');
    } finally {
      setProcessing(0);
    }
  };

  /**
   * 拒绝申请。
   * @param {Record<string, any>} request
   * @returns {Promise<void>}
   */
  const handleReject = async (request) => {
    if (processing) return;
    setProcessing(request.id);
    try {
      await useChat.getState().rejectFriendRequest(request.id);
      showToast('已拒绝');
    } catch (err) {
      showToast((err && err.message) || '操作失败', 'error');
    } finally {
      setProcessing(0);
    }
  };

  const sorted = [...requests].sort((a, b) => {
    const rank = (item) => (item.status === 'pending' ? 0 : 1);
    return rank(a) - rank(b) || Number(b.created_at) - Number(a.created_at);
  });

  const content = (
    <>
      {loading && sorted.length === 0 ? (
        <div className="flex justify-center py-10">
          <Spinner size={22} className="text-[#B2B2B2]" />
        </div>
      ) : null}

      {!loading && sorted.length === 0 ? (
        <EmptyState title="暂无好友申请" description="通过「添加朋友」搜索昵称或账号添加好友" variant="contact" />
      ) : null}

      {sorted.length > 0 ? (
        <div className="divide-y divide-[#F0F0F0] bg-white">
          {sorted.map((request) => {
            const pending = request.status === 'pending';
            const person = request.user || {};
            return (
              <div key={request.id} className="flex items-center gap-3 px-3 py-3">
                <Avatar name={person.nickname} color={person.avatar_color} src={person.avatar_url} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] text-[#111]">{person.nickname || '用户'}</p>
                  <p className="mt-[2px] truncate text-[12px] text-[#999]">
                    {request.message || '请求添加你为好友'}
                  </p>
                  <p className="mt-[2px] truncate text-[11px] text-[#B2B2B2]">
                    {request.status === 'accepted'
                      ? formatDateOnly(request.accepted_at)
                      : request.status === 'rejected'
                        ? formatDateOnly(request.updated_at)
                        : formatDateOnly(request.created_at)}
                  </p>
                </div>

                {pending ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleReject(request)}
                      disabled={processing === request.id}
                      className="wx-tap h-8 rounded-[4px] border border-[#E5E5E5] px-3 text-[13px] text-[#333] active:bg-black/5 disabled:opacity-50"
                    >
                      拒绝
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAccept(request)}
                      disabled={processing === request.id}
                      className="wx-tap flex h-8 items-center gap-1 rounded-[4px] bg-[#07C160] px-3 text-[13px] text-white active:bg-[#06AD56] disabled:opacity-60"
                    >
                      {processing === request.id ? <Spinner size={13} className="text-white" /> : null}
                      同意
                    </button>
                  </div>
                ) : (
                  <span className="shrink-0 text-[13px] text-[#B2B2B2]">
                    {request.status === 'accepted' ? '已添加' : '已拒绝'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return (
      <div className="h-full overflow-y-auto bg-[#F5F5F5]">
        <div className="mx-auto w-full max-w-[620px] py-4">{content}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#EDEDED]">
      <PageHeader title="新的朋友" onBack={back} />
      <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
    </div>
  );
}
