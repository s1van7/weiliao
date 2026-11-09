/**
 * 用户信息页（个人资料卡）：
 *   - GET /api/users/:id 拉取资料与当前用户关系（relation）；
 *   - 白底资料卡：大头像 + 昵称 + 用户名 + 手机号 + 个性签名；
 *   - 底部按 relation 显示操作区：self 编辑资料 / friend 发消息 / none 添加 / pending 状态展示。
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useChat } from '../store/useChat';
import { useUI } from '../store/useUI';
import { useClickOutside } from '../lib/hooks';
import Avatar from '../components/Avatar';
import PageHeader from '../components/PageHeader';
import Spinner from '../components/Spinner';
import Icon from '../components/Icon';
import ShareCardPicker from '../components/ShareCardPicker';
import FriendPermissionSheet from '../components/FriendPermissionSheet';
import { SettingSwitch } from '../components/SettingRow';
import Modal, { ModalActions } from '../components/Modal';
import { formatDateOnly } from '../lib/time';

/**
 * @param {{userId: number, embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function UserInfoPage({ userId, embedded = false }) {
  const id = Number(userId) || 0;
  const navigate = useUI((state) => state.navigate);
  const back = useUI((state) => state.back);
  const showToast = useUI((state) => state.showToast);
  const qrToken = useUI((state) => state.qrToken);
  const setQrToken = useUI((state) => state.setQrToken);

  const [user, setUser] = useState(null);
  const [relation, setRelation] = useState('none');
  const [remarkName, setRemarkName] = useState('');
  const [remarkPhone, setRemarkPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteName, setNoteName] = useState('');
  const [notePhone, setNotePhone] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [addedAt, setAddedAt] = useState(null);
  const [commonGroups, setCommonGroups] = useState([]);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [starred, setStarred] = useState(false);
  const [starBusy, setStarBusy] = useState(false);
  const [muteBusy, setMuteBusy] = useState(false);
  const menuRef = useRef(null);

  // 我与该好友的单聊会话（可能还不存在）：用于读取 / 切换「消息免打扰」
  const peerConversationId = useChat((state) => {
    const found = state.conversations.find(
      (item) => item.type === 'single' && item.peer && Number(item.peer.id) === id,
    );
    return found ? Number(found.id) : 0;
  });
  const muted = useChat((state) => {
    const found = state.conversations.find((item) => item.id === peerConversationId);
    return found ? found.muted === true : false;
  });

  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen);

  useEffect(() => {
    if (!id) return undefined;

    let alive = true;
    setLoading(true);
    api
      .getUser(id)
      .then((data) => {
        if (!alive) return;
        setUser(data.user || null);
        setRelation(data.relation || 'none');
        setRemarkName(data.remark_name || '');
        setRemarkPhone(data.remark_phone || '');
        setStarred(data.starred === true);
        setAddedAt(data.added_at || null);
        setCommonGroups(Array.isArray(data.common_groups) ? data.common_groups : []);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        showToast(err && err.message ? err.message : '加载用户信息失败', 'error');
        back();
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /**
   * 发消息：幂等创建 / 复用单聊会话后进入聊天页。
   * @returns {Promise<void>}
   */
  const handleMessage = async () => {
    if (busy || !user) return;
    setBusy(true);
    try {
      const conversationId = await useChat.getState().ensureSingleConversation(user.id);
      if (conversationId) navigate(`chat/${conversationId}`);
    } catch (err) {
      showToast(err && err.message ? err.message : '打开会话失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 发送好友申请，成功后按钮变为「等待验证」。
   * @returns {Promise<void>}
   */
  const handleAddFriend = async () => {
    if (busy || !user) return;
    setBusy(true);
    try {
      await useChat.getState().sendFriendRequest(user.id, '', qrToken || undefined);
      setQrToken('');
      setRelation('pending_out');
      showToast('好友申请已发送', 'success');
    } catch (err) {
      showToast(err && err.message ? err.message : '发送好友申请失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 打开设置备注弹窗。
   * @returns {void}
   */
  const handleOpenNote = () => {
    setNoteName(remarkName);
    setNotePhone(remarkPhone);
    setNoteOpen(true);
  };

  /**
   * 保存备注（两者均空 = 删除备注）。
   * @returns {Promise<void>}
   */
  const handleSaveNote = async () => {
    if (savingNote || !user) return;
    if ([...noteName.trim()].length > 20) {
      showToast('备注名最多 20 个字符', 'error');
      return;
    }
    const phone = notePhone.trim();
    if (phone && !/^1\d{10}$/.test(phone)) {
      showToast('备注手机号格式不正确', 'error');
      return;
    }

    setSavingNote(true);
    try {
      const data = await api.updateFriendNote(user.id, {
        remark_name: noteName.trim(),
        remark_phone: phone,
      });
      setRemarkName(data.note ? data.note.remark_name : '');
      setRemarkPhone(data.note ? data.note.remark_phone : '');
      setNoteOpen(false);
      showToast('备注已保存', 'success');
      // 备注变更后刷新好友列表，通讯录 / 会话标题能立即体现
      useChat.getState().loadFriends().catch(() => {});
      useChat.getState().loadConversations().catch(() => {});
    } catch (err) {
      showToast(err && err.message ? err.message : '保存失败', 'error');
    } finally {
      setSavingNote(false);
    }
  };

  /**
   * 切换星标朋友：成功后刷新好友列表，通讯录分组与排序立即生效。
   * @param {boolean} next
   * @returns {Promise<void>}
   */
  const toggleStarred = async (next) => {
    if (starBusy || !user) return;
    setStarBusy(true);
    const previous = starred;
    setStarred(next);
    try {
      await api.setFriendStarred(user.id, next);
      await useChat.getState().loadFriends();
      showToast(next ? '已设为星标朋友' : '已取消星标', 'success');
    } catch (err) {
      setStarred(previous);
      showToast(err && err.message ? err.message : '设置失败', 'error');
    } finally {
      setStarBusy(false);
    }
  };

  /**
   * 切换与该好友的消息免打扰；会话不存在时先幂等创建单聊。
   * @param {boolean} next
   * @returns {Promise<void>}
   */
  const toggleMuted = async (next) => {
    if (muteBusy || !user) return;
    setMuteBusy(true);
    try {
      const conversationId = peerConversationId || (await useChat.getState().ensureSingleConversation(user.id));
      if (!conversationId) throw new Error('打开会话失败');
      await useChat.getState().setConversationPrefs(conversationId, { muted: next });
      showToast(next ? '已开启消息免打扰' : '已取消消息免打扰', 'success');
    } catch (err) {
      showToast(err && err.message ? err.message : '设置失败', 'error');
    } finally {
      setMuteBusy(false);
    }
  };

  /**
   * 打开分享名片选择器。
   * @returns {void}
   */
  const handleShareCard = () => {
    setMenuOpen(false);
    setShareOpen(true);
  };

  /** 按 relation 渲染底部操作区 */
  let action = null;
  if (relation === 'self') {
    action = (
      <button
        type="button"
        onClick={() => navigate('me')}
        className="flex h-[46px] w-full items-center justify-center rounded-lg bg-[#07C160] text-[16px] font-medium text-white active:bg-[#06AD56]"
      >
        编辑资料
      </button>
    );
  } else if (relation === 'friend') {
    action = (
      <button
        type="button"
        onClick={handleMessage}
        disabled={busy}
        className="flex h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-[#07C160] text-[16px] font-medium text-white active:bg-[#06AD56] disabled:opacity-60"
      >
        {busy ? <Spinner size={18} className="text-white" /> : null}
        发消息
      </button>
    );
  } else if (relation === 'none') {
    action = (
      <button
        type="button"
        onClick={handleAddFriend}
        disabled={busy}
        className="flex h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-[#07C160] text-[16px] font-medium text-white active:bg-[#06AD56] disabled:opacity-60"
      >
        {busy ? <Spinner size={18} className="text-white" /> : null}
        添加到通讯录
      </button>
    );
  } else if (relation === 'pending_out') {
    action = (
      <button
        type="button"
        disabled
        className="flex h-[46px] w-full cursor-default items-center justify-center rounded-lg bg-[#E0E0E0] text-[16px] font-medium text-[#B2B2B2]"
      >
        等待验证
      </button>
    );
  } else if (relation === 'pending_in') {
    action = (
      <button
        type="button"
        onClick={() => navigate('newFriends')}
        className="flex h-[46px] w-full items-center justify-center gap-1 rounded-lg bg-[#07C160] text-[16px] font-medium text-white active:bg-[#06AD56]"
      >
        对方请求添加你
        <Icon name="chevronRight" size={16} className="text-white" />
      </button>
    );
  }

  const body = (
    <>
      {loading || !user ? (
        <div className="flex justify-center py-16">
          <Spinner size={22} className="text-[#B2B2B2]" />
        </div>
      ) : (
        <>
          {/* 资料卡 */}
          <div className="flex flex-col items-center gap-1.5 bg-white px-4 pb-5 pt-6">
            <Avatar
              name={user.nickname}
              color={user.avatar_color}
              src={user.avatar_url}
              size={64}
              radius={6}
            />
            <p className="mt-1 text-[18px] font-semibold text-[#111]">
              {relation === 'friend' && remarkName ? remarkName : user.nickname || '未设置昵称'}
            </p>
            {relation === 'friend' && remarkName ? (
              <p className="text-[12px] text-[#999]">昵称：{user.nickname || '未设置昵称'}</p>
            ) : null}
            {user.username ? <p className="text-[12px] text-[#999]">用户名：{user.username}</p> : null}
            {user.phone ? <p className="text-[12px] text-[#999]">手机号：{user.phone}</p> : null}
            {relation === 'friend' && remarkPhone ? (
              <p className="text-[12px] text-[#999]">备注手机号：{remarkPhone}</p>
            ) : null}
            <p className="mt-2 max-w-[260px] px-4 text-center text-[13px] leading-relaxed text-[#666]">
              {user.signature || '这个人很懒，什么都没写'}
            </p>
          </div>

          {/* 好友：设置备注 + 朋友圈 + 朋友权限 */}
          {relation === 'friend' ? (
            <div className="mt-2 bg-white">
              <button
                type="button"
                onClick={handleOpenNote}
                className="flex min-h-[52px] w-full items-center gap-3 px-4 active:bg-black/5"
              >
                <Icon name="user" size={19} className="text-[#07C160]" />
                <span className="min-w-0 flex-1 text-left text-[15px] text-[#111]">设置备注和标签</span>
                <Icon name="chevronRight" size={18} className="text-[#C8C8C8]" />
              </button>
              <div className="ml-[50px] h-px bg-[#E5E5E5]" />
              <button
                type="button"
                onClick={() => navigate(`userMoments/${user.id}`)}
                className="flex min-h-[52px] w-full items-center gap-3 px-4 active:bg-black/5"
              >
                <Icon name="moments" size={19} className="text-[#4C7DE0]" />
                <span className="min-w-0 flex-1 text-left text-[15px] text-[#111]">朋友圈</span>
                <Icon name="chevronRight" size={18} className="text-[#C8C8C8]" />
              </button>
              <div className="ml-[50px] h-px bg-[#E5E5E5]" />
              <button
                type="button"
                onClick={() => setPermissionOpen(true)}
                className="flex min-h-[52px] w-full items-center gap-3 px-4 active:bg-black/5"
              >
                <Icon name="lock" size={19} className="text-[#07C160]" />
                <span className="min-w-0 flex-1 text-left text-[15px] text-[#111]">朋友权限</span>
                <Icon name="chevronRight" size={18} className="text-[#C8C8C8]" />
              </button>
              <div className="ml-[50px] h-px bg-[#E5E5E5]" />
              {/* 星标朋友：通讯录里排在字母分组之前 */}
              <div className="flex min-h-[52px] w-full items-center gap-3 px-4">
                <Icon name="star" size={19} className="text-[#F2B33D]" />
                <span className="min-w-0 flex-1 text-left text-[15px] text-[#111]">设为星标朋友</span>
                <SettingSwitch checked={starred} disabled={starBusy} onChange={toggleStarred} />
              </div>
              <div className="ml-[50px] h-px bg-[#E5E5E5]" />
              {/* 消息免打扰：只影响本人，不影响对方 */}
              <div className="flex min-h-[52px] w-full items-center gap-3 px-4">
                <Icon name="volumeOff" size={19} className="text-[#8E8E93]" />
                <span className="min-w-0 flex-1 text-left text-[15px] text-[#111]">消息免打扰</span>
                <SettingSwitch checked={muted} disabled={muteBusy} onChange={toggleMuted} />
              </div>
            </div>
          ) : null}

          {/* 好友：添加日期 + 共同群聊 */}
          {relation === 'friend' && (addedAt || commonGroups.length > 0) ? (
            <div className="mt-2 bg-white px-4 py-1">
              {addedAt ? (
                <div className="flex min-h-[48px] items-center gap-3">
                  <span className="shrink-0 text-[14px] text-[#333]">添加日期</span>
                  <span className="min-w-0 flex-1 text-right text-[14px] text-[#999]">
                    {formatDateOnly(addedAt)}
                  </span>
                </div>
              ) : null}
              {commonGroups.length > 0 ? (
                <div className={`${addedAt ? 'border-t border-[#F0F0F0]' : ''} py-3`}>
                  <div className="text-[13px] text-[#888]">共同群聊（{commonGroups.length}）</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {commonGroups.map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => navigate(`groupInfo/${group.id}`)}
                        className="max-w-full rounded-[4px] bg-[#F2F2F2] px-2.5 py-1.5 text-[13px] text-[#333] active:bg-[#E5E5E5]"
                      >
                        <span className="truncate">{group.name || '群聊'}</span>
                        <span className="text-[#B2B2B2]">（{group.member_count}）</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 操作区 */}
          <div className="px-4 pt-5">{action}</div>
        </>
      )}
    </>
  );

  const noteModal = (
    <Modal
      open={noteOpen}
      onClose={() => setNoteOpen(false)}
      title="设置备注"
      footer={
        <ModalActions
          onCancel={() => setNoteOpen(false)}
          onConfirm={handleSaveNote}
          confirmText="保存"
          loading={savingNote}
        />
      }
    >
      <div className="space-y-2 py-1">
        <input
          value={noteName}
          onChange={(event) => setNoteName(event.target.value)}
          maxLength={20}
          placeholder="备注名（20 字以内）"
          className="h-11 w-full rounded-[6px] bg-[#F7F7F7] px-3 text-[15px]"
        />
        <input
          value={notePhone}
          onChange={(event) => setNotePhone(event.target.value)}
          placeholder="备注手机号（可选）"
          className="h-11 w-full rounded-[6px] bg-[#F7F7F7] px-3 text-[15px]"
        />
        <p className="text-[11px] leading-4 text-[#B2B2B2]">备注名与手机号都留空将删除备注</p>
      </div>
    </Modal>
  );

  /** 好友态右上角「···」菜单：分享名片 */
  const headerMore =
    relation === 'friend' && user ? (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          aria-label="更多"
          onClick={() => setMenuOpen((prev) => !prev)}
          className="flex h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
        >
          <Icon name="more" size={20} className="text-[#111]" />
        </button>
        {menuOpen ? (
          <div className="wx-pop absolute right-0 top-[44px] z-30 w-[160px] overflow-hidden rounded-[8px] bg-white py-1 shadow-[0_6px_20px_rgba(0,0,0,0.16)]">
            <button
              type="button"
              onClick={handleShareCard}
              className="flex h-[42px] w-full items-center px-4 text-[15px] text-[#333] active:bg-black/5"
            >
              分享名片
            </button>
          </div>
        ) : null}
      </div>
    ) : null;

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
          <h1 className="ml-1 text-[16px] font-semibold text-[#111]">用户信息</h1>
          <div className="ml-auto">{headerMore}</div>
        </div>
      ) : (
        <PageHeader title="用户信息" onBack={back} right={headerMore} />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {embedded ? <div className="mx-auto w-full max-w-[620px] pt-4">{body}</div> : body}
      </div>
      {noteModal}
      <ShareCardPicker open={shareOpen} userId={id} onClose={() => setShareOpen(false)} />
      <FriendPermissionSheet open={permissionOpen} userId={id} onClose={() => setPermissionOpen(false)} />
    </div>
  );
}
