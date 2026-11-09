/**
 * 添加朋友：搜索框（输入防抖 300ms）→ 结果列表（加好友 / 已是好友 / 已申请 / 去验证）。
 * 点击「加好友」弹窗填写验证语（默认「我是{我的昵称}」）。
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../store/useAuth';
import { useChat } from '../store/useChat';
import { useUI } from '../store/useUI';
import { useDebouncedValue } from '../lib/hooks';
import { relationMeta } from '../lib/format';
import Avatar from '../components/Avatar';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';
import Icon from '../components/Icon';

/**
 * @param {{embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function AddFriendPage({ embedded = false }) {
  const me = useAuth((state) => state.user);
  const searchUsers = useChat((state) => state.searchUsers);
  const back = useUI((state) => state.back);
  const navigate = useUI((state) => state.navigate);
  const showToast = useUI((state) => state.showToast);

  const [keyword, setKeyword] = useState('');
  const debounced = useDebouncedValue(keyword.trim(), 300);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState(null);
  const [verifyText, setVerifyText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!debounced) {
      setResults([]);
      setSearching(false);
      return () => {
        cancelled = true;
      };
    }

    setSearching(true);
    searchUsers(debounced)
      .then((list) => {
        if (!cancelled) setResults(list);
      })
      .catch((err) => {
        if (!cancelled) showToast((err && err.message) || '搜索失败', 'error');
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debounced, searchUsers, showToast]);

  /**
   * 打开验证语弹窗。
   * @param {Record<string, any>} person
   * @returns {void}
   */
  const openVerify = (person) => {
    setTarget(person);
    setVerifyText(`我是${(me && me.nickname) || ''}`);
  };

  /**
   * 发送好友申请。
   * @returns {Promise<void>}
   */
  const handleSend = async () => {
    if (!target || sending) return;
    setSending(true);
    try {
      await useChat.getState().sendFriendRequest(target.id, verifyText.trim());
      setResults((prev) => prev.map((item) => (item.id === target.id ? { ...item, relation: 'pending_out' } : item)));
      setTarget(null);
      showToast('申请已发送');
    } catch (err) {
      showToast((err && err.message) || '发送失败', 'error');
    } finally {
      setSending(false);
    }
  };

  const content = (
    <>
      {/* 搜索框 */}
      <div className="bg-[#EDEDED] px-3 py-2.5">
        <div className="flex h-9 items-center gap-2 rounded-[6px] bg-white px-3">
          <Icon name="search" size={16} className="text-[#8A8A8A]" />
          <input
            ref={inputRef}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="昵称 / 用户名 / 手机号"
            className="h-full min-w-0 flex-1 text-[15px] placeholder:text-[#B2B2B2]"
            autoFocus={!embedded}
          />
          {keyword ? (
            <button type="button" aria-label="清空" onClick={() => setKeyword('')} className="p-1">
              <Icon name="close" size={14} className="text-[#B2B2B2]" />
            </button>
          ) : null}
        </div>
      </div>

      {/* 结果 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {searching ? (
          <div className="flex justify-center py-10">
            <Spinner size={22} className="text-[#B2B2B2]" />
          </div>
        ) : null}

        {!searching && debounced && results.length === 0 ? (
          <EmptyState title="没有找到相关用户" description="试试对方完整的用户名或手机号" variant="search" />
        ) : null}

        {!debounced ? (
          <EmptyState title="搜索添加好友" description="输入昵称、用户名或手机号，找到后发送好友申请" variant="contact" />
        ) : null}

        {results.length > 0 ? (
          <div className="divide-y divide-[#F0F0F0] bg-white">
            {results.map((person) => {
              const meta = relationMeta(person.relation);
              return (
                <div key={person.id} className="flex items-center gap-3 px-3 py-3">
                  <Avatar name={person.nickname} color={person.avatar_color} src={person.avatar_url} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] text-[#111]">{person.nickname}</p>
                    <p className="mt-[2px] truncate text-[12px] text-[#999]">
                      {person.username ? `用户名：${person.username}` : person.phone ? `手机号：${person.phone}` : ''}
                    </p>
                  </div>

                  {meta.action === 'add' ? (
                    <button
                      type="button"
                      onClick={() => openVerify(person)}
                      className="wx-tap h-8 shrink-0 rounded-[4px] bg-[#07C160] px-3 text-[13px] text-white active:bg-[#06AD56]"
                    >
                      加好友
                    </button>
                  ) : null}

                  {meta.action === 'verify' ? (
                    <button
                      type="button"
                      onClick={() => navigate('newFriends')}
                      className="wx-tap h-8 shrink-0 rounded-[4px] bg-[#07C160] px-3 text-[13px] text-white active:bg-[#06AD56]"
                    >
                      去验证
                    </button>
                  ) : null}

                  {meta.action === 'friend' || meta.action === 'pending' || meta.action === 'self' ? (
                    <span className="h-8 shrink-0 rounded-[4px] border border-[#E5E5E5] px-3 text-[13px] leading-[30px] text-[#999]">
                      {meta.text}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </>
  );

  const verifyModal = (
    <Modal
      open={Boolean(target)}
      onClose={() => setTarget(null)}
      title="发送好友申请"
      width={320}
      footer={
        <div className="flex h-[48px] items-stretch">
          <button
            type="button"
            onClick={() => setTarget(null)}
            className="flex-1 border-r border-[#E5E5E5] text-[16px] text-[#333] active:bg-black/5"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending}
            className="flex flex-1 items-center justify-center gap-1 text-[16px] font-medium text-[#07C160] active:bg-black/5 disabled:opacity-60"
          >
            {sending ? <Spinner size={15} className="text-[#07C160]" /> : null}
            发送
          </button>
        </div>
      }
    >
      <div className="flex items-center gap-3 pb-2">
        <Avatar
          name={target ? target.nickname : ''}
          color={target ? target.avatar_color : '#07C160'}
          src={target ? target.avatar_url : ''}
          size={40}
        />
        <div className="min-w-0">
          <p className="truncate text-[15px] text-[#111]">{target ? target.nickname : ''}</p>
          <p className="truncate text-[12px] text-[#999]">{target && target.username ? `用户名：${target.username}` : ''}</p>
        </div>
      </div>
      <textarea
        value={verifyText}
        onChange={(event) => setVerifyText(event.target.value)}
        maxLength={50}
        rows={3}
        placeholder="填写验证语"
        className="w-full rounded-[6px] bg-[#F7F7F7] p-2.5 text-[15px] leading-[21px] text-[#111] placeholder:text-[#B2B2B2]"
      />
      <p className="mt-1 text-right text-[11px] text-[#B2B2B2]">{[...verifyText].length}/50</p>
    </Modal>
  );

  if (embedded) {
    return (
      <div className="flex h-full flex-col bg-[#F5F5F5]">
        <div className="mx-auto flex min-h-0 w-full max-w-[620px] flex-1 flex-col pt-3 pb-4">{content}</div>
        {verifyModal}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#EDEDED]">
      <PageHeader title="添加朋友" onBack={back} />
      <div className="flex min-h-0 flex-1 flex-col">{content}</div>
      {verifyModal}
    </div>
  );
}
