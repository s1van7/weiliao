/**
 * 群聊信息（群设置）：
 *   1. 顶部群头像：群主 / 管理员头像上有相机角标，点击上传；无权限点击 toast；
 *   2. 群名称：群主 / 管理员可点击编辑（≤30 字），普通成员只读；
 *   3. 群公告：右侧红点（announcement_unread），点开抽屉查看 / 编辑，打开即清红点；
 *   4. 群成员：九宫格 + 群主 / 管理员徽章，点击成员弹操作菜单（设 / 取消管理员、移出群聊）；
 *   5. 群权限：仅群主可见，三个开关改动即时提交，失败回滚并 toast；
 *   6. 「+」邀请好友：受 permissions.invite 控制，无权限时隐藏并提示；
 *   7. 底部退出群聊（群主退出后群主身份自动移交给最早加入的成员）。
 *
 * 数据全部走 useChat 的 detailsByConv 缓存，任何变更统一用 applyGroupUpdate 回写，
 * 保证「群设置改了群名 → 会话说列表 / 顶栏同步」。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api';
import { useAuth } from '../store/useAuth';
import { useChat } from '../store/useChat';
import { useUI } from '../store/useUI';
import { GROUP_AVATAR_FILE_MAX, GROUP_NAME_MAX } from '../config';
import { errorText } from '../lib/errorText';
import {
  canInvite as canInviteMembers,
  canManageProfile,
  canManagePermissions,
  memberActions,
  permissionsOf,
} from '../lib/groupPerm';
import Avatar from '../components/Avatar';
import PageHeader from '../components/PageHeader';
import SettingRow, { SettingSwitch } from '../components/SettingRow';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';
import Icon from '../components/Icon';
import AnnouncementSheet from '../components/AnnouncementSheet';

/** 群头像允许的 MIME（与后端 upload 白名单一致） */
const GROUP_AVATAR_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * 权限开关行：左侧文案 + 右侧二选一分段按钮。
 * @param {{
 *   label: string,
 *   value: string,
 *   options: Array<{value: string, label: string}>,
 *   busy?: boolean,
 *   last?: boolean,
 *   onChange: (value: string) => void,
 * }} props
 * @returns {JSX.Element}
 */
function PermissionRow({ label, value, options, busy = false, last = false, onChange }) {
  return (
    <div>
      <div className="flex min-h-[52px] items-center gap-2 px-4">
        <span className="min-w-0 flex-1 text-[14px] leading-5 text-[#333]">{label}</span>
        <div className="flex shrink-0 overflow-hidden rounded-[4px] border border-[#E0E0E0]">
          {options.map((option) => {
            const active = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={busy}
                onClick={() => onChange(option.value)}
                className={`h-8 px-2.5 text-[12px] leading-none transition-colors ${
                  active ? 'bg-[#07C160] text-white' : 'bg-white text-[#666] active:bg-black/5'
                } ${busy ? 'opacity-60' : ''}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      {last ? null : <div className="ml-4 h-px bg-[#E5E5E5]" />}
    </div>
  );
}

/**
 * @param {{conversationId: number, embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function GroupInfoPage({ conversationId, embedded = false }) {
  const id = Number(conversationId) || 0;
  const me = useAuth((state) => state.user);
  const myId = me ? Number(me.id) : 0;
  const detail = useChat((state) => state.detailsByConv[id] || null);
  const friends = useChat((state) => state.friends);
  const conversations = useChat((state) => state.conversations);
  const back = useUI((state) => state.back);
  const navigate = useUI((state) => state.navigate);
  const showToast = useUI((state) => state.showToast);

  const [loading, setLoading] = useState(true);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [annOpen, setAnnOpen] = useState(false);
  const [savingAnn, setSavingAnn] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteSelected, setInviteSelected] = useState([]);
  const [inviting, setInviting] = useState(false);
  const [memberMenu, setMemberMenu] = useState(null);
  const [permBusy, setPermBusy] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const [invite, setInvite] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [muteBusy, setMuteBusy] = useState(false);
  const avatarInputRef = useRef(null);

  /**
   * 拉取群详情（store 内缓存，重复进入不重复请求）。
   * @param {boolean} [force] 是否强制刷新
   * @returns {Promise<void>}
   */
  const loadDetail = useCallback(
    async (force = false) => {
      if (!id) return;
      try {
        await useChat.getState().groupDetail(id, { force });
      } catch (err) {
        showToast(errorText(err, '加载群信息失败'), 'error');
      } finally {
        setLoading(false);
      }
    },
    [id, showToast],
  );

  useEffect(() => {
    setLoading(true);
    loadDetail();
  }, [loadDetail]);

  const summary = useMemo(() => conversations.find((item) => item.id === id) || null, [conversations, id]);
  const members = (detail && detail.members) || [];
  const memberIds = useMemo(() => new Set(members.map((member) => Number(member.user_id))), [members]);
  const invitableFriends = useMemo(
    () => friends.filter((friend) => !memberIds.has(Number(friend.id))),
    [friends, memberIds],
  );
  const ownerMember = members.find((member) => member.role === 'owner');
  const groupName = (detail && detail.name) || (summary && summary.name) || '群聊';

  const manageable = canManageProfile(detail);
  const canEditAnn = canManageProfile(detail);
  const ownerOnly = canManagePermissions(detail);
  const inviteAllowed = canInviteMembers(detail);
  const perms = permissionsOf(detail);
  const announcement = (detail && detail.announcement) || '';

  /**
   * 统一回写群资料。
   * @param {Record<string, any>} patch
   * @returns {void}
   */
  const apply = (patch) => useChat.getState().applyGroupUpdate(id, patch);

  /**
   * 点击群头像：无权限提示，有权限打开选图。
   * @returns {void}
   */
  const handleAvatarClick = () => {
    if (!manageable) {
      showToast('没有权限，找群主聊聊', 'error');
      return;
    }
    if (avatarBusy) return;
    const input = avatarInputRef.current;
    if (!input) return;
    input.value = '';
    input.click();
  };

  /**
   * 上传群头像 → 写入会话头像。
   * @param {React.ChangeEvent<HTMLInputElement>} event
   * @returns {Promise<void>}
   */
  const handleAvatarChange = async (event) => {
    const input = event.target;
    const file = input && input.files ? input.files[0] : null;
    if (input) input.value = '';
    if (!file) return;

    if (!GROUP_AVATAR_MIME.includes(file.type)) {
      showToast('仅支持 jpg / png / webp 图片', 'error');
      return;
    }
    if (file.size > GROUP_AVATAR_FILE_MAX) {
      showToast('群头像不能超过 2MB', 'error');
      return;
    }

    setAvatarBusy(true);
    try {
      const uploaded = await api.uploadGroupAvatar(file);
      if (!uploaded || !uploaded.url) throw new Error('群头像上传失败');
      const data = await api.updateConversation(id, { avatar_url: uploaded.url });
      if (data && data.conversation) apply(data.conversation);
      else apply({ avatar_url: uploaded.url });
      showToast('群头像已更新', 'success');
    } catch (err) {
      showToast(errorText(err, '群头像上传失败'), 'error');
    } finally {
      setAvatarBusy(false);
    }
  };

  /**
   * 点击群名称：无权限时给出明确反馈（原先静默失败），有权限才打开编辑弹层。
   * @returns {void}
   */
  const openNameEditor = () => {
    if (!manageable) {
      showToast('没有权限，找群主聊聊', 'error');
      return;
    }
    setNameDraft(groupName);
    setNameOpen(true);
  };

  /**
   * 保存群名称。
   * @returns {Promise<void>}
   */
  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name) {
      showToast('群名称不能为空', 'error');
      return;
    }
    if ([...name].length > GROUP_NAME_MAX) {
      showToast(`群名称最多 ${GROUP_NAME_MAX} 个字符`, 'error');
      return;
    }
    if (name === groupName) {
      setNameOpen(false);
      return;
    }

    setSavingName(true);
    try {
      const data = await api.updateConversation(id, { name });
      if (data && data.conversation) apply(data.conversation);
      else apply({ name });
      showToast('群名称已更新', 'success');
      setNameOpen(false);
    } catch (err) {
      showToast(errorText(err, '保存失败'), 'error');
    } finally {
      setSavingName(false);
    }
  };

  /**
   * 打开公告：有未读时顺带标记已读并清红点。
   * @returns {Promise<void>}
   */
  const openAnnouncement = async () => {
    setAnnOpen(true);
    if (!detail || !detail.announcement_unread) return;
    try {
      await api.readAnnouncement(id);
      apply({ announcement_unread: false });
    } catch {
      /* 已读上报失败不阻塞阅读 */
    }
  };

  /**
   * 保存公告（失败时抛出，由抽屉保持编辑态）。
   * @param {string} text
   * @returns {Promise<void>}
   */
  const saveAnnouncement = async (text) => {
    setSavingAnn(true);
    try {
      const data = await api.updateAnnouncement(id, text);
      apply({
        announcement: data && data.announcement !== undefined ? data.announcement : text,
        announcement_at: (data && data.announcement_at) || Date.now(),
        announcement_unread: false,
      });
      showToast('公告已更新', 'success');
    } catch (err) {
      showToast(errorText(err, '保存公告失败'), 'error');
      throw err;
    } finally {
      setSavingAnn(false);
    }
  };

  /**
   * 点击成员：无可用操作时只 toast，不弹空菜单。
   * @param {Record<string, any>} member
   * @returns {void}
   */
  const openMemberMenu = (member) => {
    const actions = memberActions(detail, myId, member);
    if (actions.length === 0) {
      showToast('没有可执行的操作');
      return;
    }
    setMemberMenu({ member, actions });
  };

  /**
   * 执行成员操作（设 / 取消管理员、移出群聊）。
   * @param {string} actionKey 'promote' | 'demote' | 'remove'
   * @returns {Promise<void>}
   */
  const runMemberAction = async (actionKey) => {
    const target = memberMenu ? memberMenu.member : null;
    setMemberMenu(null);
    if (!target) return;
    const targetId = Number(target.user_id);

    try {
      if (actionKey === 'promote' || actionKey === 'demote') {
        const data = await api.setMemberRole(id, targetId, actionKey === 'promote' ? 'admin' : 'member');
        const nextMembers = (data && data.members) || [];
        apply({ members: nextMembers, member_count: nextMembers.length });
        showToast(actionKey === 'promote' ? '已设为管理员' : '已取消管理员');
        return;
      }
      if (actionKey === 'remove') {
        const data = await api.removeMember(id, targetId);
        const nextMembers =
          (data && data.members) || members.filter((member) => Number(member.user_id) !== targetId);
        apply({ members: nextMembers, member_count: nextMembers.length });
        showToast('已移出群聊');
      }
    } catch (err) {
      showToast(errorText(err, '操作失败'), 'error');
    }
  };

  /**
   * 修改群权限：先乐观更新，失败回滚。
   * @param {string} field 'speak' | 'invite' | 'remove'
   * @param {string} value 目标取值
   * @returns {Promise<void>}
   */
  const changePermission = async (field, value) => {
    if (!ownerOnly) return;
    const prev = { ...perms };
    if (prev[field] === value) return;

    setPermBusy(field);
    apply({ permissions: { ...prev, [field]: value } });
    try {
      const data = await api.updatePermissions(id, { [field]: value });
      apply({ permissions: (data && data.permissions) || { ...prev, [field]: value } });
      showToast('群权限已更新', 'success');
    } catch (err) {
      apply({ permissions: prev });
      showToast(errorText(err, '权限修改失败'), 'error');
    } finally {
      setPermBusy('');
    }
  };

  /**
   * 邀请好友入群。
   * @returns {Promise<void>}
   */
  const handleInvite = async () => {
    if (inviteSelected.length === 0 || inviting) return;
    setInviting(true);
    try {
      await useChat.getState().addGroupMembers(id, inviteSelected);
      setInviteOpen(false);
      setInviteSelected([]);
      await loadDetail(true);
      await useChat
        .getState()
        .loadConversations()
        .catch(() => {});
      showToast('已发送邀请');
    } catch (err) {
      showToast(errorText(err, '邀请失败'), 'error');
    } finally {
      setInviting(false);
    }
  };

  /**
   * 拉取群邀请（refresh=true 时刷新并吊销旧码）。
   * @param {boolean} [refresh]
   * @returns {Promise<void>}
   */
  const loadInvite = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setInviteLoading(true);
    try {
      const data = await api.createGroupInvite(id, refresh);
      setInvite(data);
      const url = await QRCode.toDataURL(data.qr_content || data.token || '', { width: 220, margin: 1 });
      setQrDataUrl(url);
    } catch (err) {
      showToast(errorText(err, '群二维码加载失败'), 'error');
    } finally {
      setInviteLoading(false);
      setRefreshing(false);
    }
  };

  /**
   * 打开群二维码弹层并加载邀请。
   * @returns {void}
   */
  const openInvite = () => {
    setQrOpen(true);
    loadInvite(false);
  };

  /**
   * 复制邀请链接。
   * @returns {Promise<void>}
   */
  const copyLink = async () => {
    if (!invite) return;
    const full = `${window.location.origin}${window.location.pathname}${invite.link}`;
    try {
      await navigator.clipboard.writeText(full);
      showToast('邀请链接已复制', 'success');
    } catch {
      showToast('复制失败，请手动复制', 'error');
    }
  };

  /**
   * 切换消息免打扰（群维度、只影响本人）。
   * @param {boolean} next
   * @returns {Promise<void>}
   */
  const toggleMute = async (next) => {
    if (muteBusy || !id) return;
    setMuteBusy(true);
    try {
      await useChat.getState().setConversationPrefs(id, { muted: Boolean(next) });
      showToast(next ? '已开启消息免打扰' : '已取消消息免打扰', 'success');
    } catch (err) {
      showToast(errorText(err, '设置失败'), 'error');
    } finally {
      setMuteBusy(false);
    }
  };

  /**
   * 退出群聊（二次确认；群主退出后群主身份自动移交）。
   * @returns {void}
   */
  const handleLeave = () => {
    const isOwnerNow = detail && detail.my_role === 'owner';
    useUI.getState().openModal({
      title: '退出群聊',
      content: isOwnerNow
        ? '你是群主，退出后群主身份将移交给最早加入的成员；聊天记录将从会话列表移除。确定退出吗？'
        : '退出后将不再接收该群消息，聊天记录将从会话列表移除。确定退出吗？',
      confirmText: '退出',
      danger: true,
      onConfirm: async () => {
        try {
          await useChat.getState().leaveGroup(id);
          showToast('已退出群聊');
          navigate('chats', { replace: true });
        } catch (err) {
          showToast(errorText(err, '退出失败'), 'error');
        }
      },
    });
  };

  /* ------------------------------------------------------------------ */
  /* 内容                                                                */
  /* ------------------------------------------------------------------ */

  const content = (
    <>
      {loading && !detail ? (
        <div className="flex justify-center py-10">
          <Spinner size={22} className="text-[#B2B2B2]" />
        </div>
      ) : (
        <>
          {/* 群头像 + 群名概要 */}
          <div className="flex flex-col items-center gap-2 bg-white px-4 pb-4 pt-5">
            <button
              type="button"
              onClick={handleAvatarClick}
              aria-label="更换群头像"
              className="wx-tap relative block overflow-hidden rounded-[6px]"
            >
              <Avatar
                name={groupName}
                group
                src={(detail && detail.avatar_url) || ''}
                size={64}
                radius={6}
              />
              {manageable ? (
                <span className="absolute bottom-0 right-0 flex h-[20px] w-[20px] items-center justify-center rounded-tl-[6px] bg-black/45 text-white">
                  <Icon name="camera" size={12} />
                </span>
              ) : null}
              {avatarBusy ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/35">
                  <Spinner size={18} className="text-white" />
                </span>
              ) : null}
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <p className="max-w-full truncate text-[17px] font-semibold text-[#111]">{groupName}</p>
            <p className="text-[12px] text-[#999]">
              共 {members.length} 人{ownerMember ? ` · 群主：${ownerMember.nickname}` : ''}
            </p>
            {manageable ? (
              <p className="text-[11px] leading-4 text-[#B2B2B2]">点击头像可更换群头像</p>
            ) : (
              <p className="text-[11px] leading-4 text-[#B2B2B2]">仅群主与管理员可修改群资料</p>
            )}
          </div>

          {/* 群名称 / 群公告 */}
          <div className="mt-2 bg-white">
            {/* 群名称：无权限时不给出可编辑暗示（无按压反馈 / 无箭头），点击只 toast */}
            <button
              type="button"
              onClick={openNameEditor}
              aria-disabled={!manageable}
              className={`flex min-h-[52px] w-full items-center gap-3 px-4 text-left ${
                manageable ? 'active:bg-black/5' : 'cursor-default'
              }`}
            >
              <span className="w-[80px] shrink-0 text-[14px] text-[#333]">群聊名称</span>
              <span className="min-w-0 flex-1 truncate text-[15px] text-[#111]">{groupName}</span>
              {manageable ? <Icon name="chevronRight" size={17} className="shrink-0 text-[#C8C8C8]" /> : null}
            </button>

            <div className="ml-4 h-px bg-[#E5E5E5]" />

            <button
              type="button"
              onClick={openAnnouncement}
              className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left active:bg-black/5"
            >
              <span className="w-[80px] shrink-0 text-[14px] text-[#333]">群公告</span>
              <span className="min-w-0 flex-1 truncate text-[14px] text-[#888]">
                {announcement ? announcement.replace(/\s+/g, ' ') : '暂无公告'}
              </span>
              {detail && detail.announcement_unread ? (
                <span className="h-[8px] w-[8px] shrink-0 rounded-full bg-[#FA5151]" />
              ) : null}
              <Icon name="chevronRight" size={17} className="shrink-0 text-[#C8C8C8]" />
            </button>
          </div>

          {/* 群二维码 / 邀请链接 */}
          <div className="mt-2 bg-white">
            <button
              type="button"
              onClick={openInvite}
              className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left active:bg-black/5"
            >
              <Icon name="qrcode" size={19} className="text-[#07C160]" />
              <span className="min-w-0 flex-1 text-[15px] text-[#111]">群二维码 / 邀请链接</span>
              <Icon name="chevronRight" size={18} className="text-[#C8C8C8]" />
            </button>
          </div>

          {/* 消息免打扰（只影响本人接收提醒的方式） */}
          <div className="mt-2 bg-white">
            <SettingRow
              icon="volumeOff"
              iconColor="#8E8E93"
              title="消息免打扰"
              subtitle="开启后新消息不响铃、不弹通知"
              last
              right={<SettingSwitch checked={Boolean(summary && summary.muted)} disabled={muteBusy} onChange={toggleMute} />}
            />
          </div>

          {/* 群成员 */}
          <div className="mt-2 bg-white px-4 py-3">
            <p className="mb-3 text-[12px] text-[#888]">群成员（{members.length}）</p>
            <div className="grid grid-cols-5 gap-x-2 gap-y-4">
              {members.map((member) => {
                const isMe = Number(member.user_id) === myId;
                const role = member.role === 'owner' ? 'owner' : member.role === 'admin' ? 'admin' : 'member';
                return (
                  <button
                    key={member.user_id}
                    type="button"
                    onClick={() => openMemberMenu(member)}
                    className="flex flex-col items-center gap-1"
                  >
                    <span className="relative block h-12 w-12">
                      <Avatar
                        name={member.nickname}
                        color={member.avatar_color}
                        src={member.avatar_url}
                        size={48}
                      />
                      {role !== 'member' ? (
                        <span
                          className={`absolute inset-x-0 bottom-0 flex items-center justify-center overflow-hidden whitespace-nowrap rounded-b-[4px] py-[1px] text-[9px] leading-[12px] text-white ${
                            role === 'owner' ? 'bg-[#FF9F0A]' : 'bg-[#10AEFF]'
                          }`}
                        >
                          {role === 'owner' ? '群主' : '管理员'}
                        </span>
                      ) : null}
                    </span>
                    <span className="w-full truncate text-center text-[11px] leading-3 text-[#666]">
                      {isMe ? '我' : member.nickname}
                    </span>
                  </button>
                );
              })}

              {inviteAllowed ? (
                <button
                  type="button"
                  onClick={() => setInviteOpen(true)}
                  className="flex flex-col items-center gap-1"
                  aria-label="邀请好友"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-[4px] border border-dashed border-[#C8C8C8] text-[#B2B2B2] active:bg-black/5">
                    <Icon name="plus" size={22} />
                  </span>
                  <span className="text-[11px] leading-3 text-[#B2B2B2]">邀请</span>
                </button>
              ) : null}
            </div>

            {inviteAllowed ? null : (
              <p className="mt-3 text-[11px] leading-4 text-[#B2B2B2]">仅群主和管理员可邀请新成员入群</p>
            )}
          </div>

          {/* 群权限（仅群主） */}
          {ownerOnly ? (
            <div className="mt-2 bg-white">
              <div className="px-4 pb-1 pt-3 text-[12px] text-[#888]">群权限</div>
              <PermissionRow
                label="谁可以发言"
                value={perms.speak}
                busy={permBusy === 'speak'}
                options={[
                  { value: 'all', label: '全员' },
                  { value: 'admin', label: '仅群主与管理员' },
                ]}
                onChange={(value) => changePermission('speak', value)}
              />
              <PermissionRow
                label="谁可以邀请好友入群"
                value={perms.invite}
                busy={permBusy === 'invite'}
                options={[
                  { value: 'all', label: '全员' },
                  { value: 'admin', label: '仅群主与管理员' },
                ]}
                onChange={(value) => changePermission('invite', value)}
              />
              <PermissionRow
                label="谁可以移除成员"
                value={perms.remove}
                busy={permBusy === 'remove'}
                last
                options={[
                  { value: 'owner', label: '仅群主' },
                  { value: 'owner_admin', label: '群主与管理员' },
                ]}
                onChange={(value) => changePermission('remove', value)}
              />
            </div>
          ) : null}

          {/* 退出群聊 */}
          <div className="mt-4 bg-white">
            <button
              type="button"
              onClick={handleLeave}
              className="flex h-[52px] w-full items-center justify-center gap-2 text-[16px] text-[#FA5151] active:bg-black/5"
            >
              <Icon name="logout" size={18} className="text-[#FA5151]" />
              退出群聊
            </button>
          </div>
        </>
      )}
    </>
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
          <h1 className="ml-1 text-[16px] font-semibold text-[#111]">群聊信息</h1>
        </div>
      ) : (
        <PageHeader title="群聊信息" onBack={back} />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {embedded ? <div className="mx-auto w-full max-w-[620px] pt-4">{content}</div> : content}
      </div>

      {/* 群名称编辑 */}
      <Modal
        open={nameOpen}
        onClose={() => setNameOpen(false)}
        title="修改群聊名称"
        width={320}
        footer={
          <div className="flex h-[48px] items-stretch">
            <button
              type="button"
              onClick={() => setNameOpen(false)}
              className="flex-1 border-r border-[#E5E5E5] text-[16px] text-[#333] active:bg-black/5"
            >
              取消
            </button>
            <button
              type="button"
              onClick={saveName}
              disabled={savingName}
              className="flex flex-1 items-center justify-center gap-1 text-[16px] font-medium text-[#07C160] active:bg-black/5 disabled:opacity-50"
            >
              {savingName ? <Spinner size={14} className="text-[#07C160]" /> : null}
              保存
            </button>
          </div>
        }
      >
        <input
          value={nameDraft}
          onChange={(event) => setNameDraft([...event.target.value].slice(0, GROUP_NAME_MAX).join(''))}
          maxLength={GROUP_NAME_MAX}
          placeholder="请输入群聊名称"
          className="h-[44px] w-full rounded-[6px] bg-[#F7F7F7] px-3 text-[15px] text-[#111] placeholder:text-[#B2B2B2]"
        />
        <p className="mt-1 text-right text-[11px] leading-4 text-[#B2B2B2]">
          {[...nameDraft].length}/{GROUP_NAME_MAX}
        </p>
      </Modal>

      {/* 群公告 */}
      <AnnouncementSheet
        open={annOpen}
        announcement={announcement}
        announcementAt={(detail && detail.announcement_at) || 0}
        canEdit={canEditAnn}
        saving={savingAnn}
        onClose={() => setAnnOpen(false)}
        onSave={saveAnnouncement}
      />

      {/* 成员操作 */}
      <Modal open={Boolean(memberMenu)} onClose={() => setMemberMenu(null)} width={300}>
        <div className="-mx-5 -my-3">
          {memberMenu ? (
            <p className="truncate border-b border-[#F0F0F0] px-5 py-2.5 text-center text-[13px] text-[#999]">
              {memberMenu.member.nickname}
            </p>
          ) : null}
          {(memberMenu ? memberMenu.actions : []).map((action) => (
            <div key={action.key}>
              <button
                type="button"
                onClick={() => runMemberAction(action.key)}
                className={`flex h-[48px] w-full items-center justify-center text-[16px] active:bg-black/5 ${
                  action.danger ? 'text-[#FA5151]' : 'text-[#333]'
                }`}
              >
                {action.label}
              </button>
              <div className="h-px bg-[#E5E5E5]" />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setMemberMenu(null)}
            className="flex h-[48px] w-full items-center justify-center text-[16px] text-[#333] active:bg-black/5"
          >
            取消
          </button>
        </div>
      </Modal>

      {/* 邀请好友 */}
      <Modal
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
          setInviteSelected([]);
        }}
        title="邀请好友"
        width={340}
        footer={
          <div className="flex h-[48px] items-stretch">
            <button
              type="button"
              onClick={() => {
                setInviteOpen(false);
                setInviteSelected([]);
              }}
              className="flex-1 border-r border-[#E5E5E5] text-[16px] text-[#333] active:bg-black/5"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleInvite}
              disabled={inviteSelected.length === 0 || inviting}
              className="flex flex-1 items-center justify-center gap-1 text-[16px] font-medium text-[#07C160] active:bg-black/5 disabled:opacity-50"
            >
              {inviting ? <Spinner size={15} className="text-[#07C160]" /> : null}
              邀请({inviteSelected.length})
            </button>
          </div>
        }
      >
        {invitableFriends.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[#999]">好友都已在群里了</p>
        ) : (
          <div className="-mx-5 -my-3 max-h-[46vh] overflow-y-auto divide-y divide-[#F0F0F0]">
            {invitableFriends.map((friend) => {
              const checked = inviteSelected.includes(friend.id);
              return (
                <button
                  key={friend.id}
                  type="button"
                  onClick={() =>
                    setInviteSelected((prev) =>
                      prev.includes(friend.id) ? prev.filter((item) => item !== friend.id) : [...prev, friend.id],
                    )
                  }
                  className="flex w-full items-center gap-3 px-5 py-2.5 text-left active:bg-black/5"
                >
                  <span
                    className={`flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border ${
                      checked ? 'border-[#07C160] bg-[#07C160]' : 'border-[#D0D0D0] bg-white'
                    }`}
                  >
                    {checked ? <Icon name="check" size={13} className="text-white" /> : null}
                  </span>
                  <Avatar name={friend.nickname} color={friend.avatar_color} src={friend.avatar_url} size={36} />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{friend.nickname}</span>
                </button>
              );
            })}
          </div>
        )}
      </Modal>

      {/* 群二维码 / 邀请链接 */}
      <Modal open={qrOpen} onClose={() => setQrOpen(false)} title="群二维码" width={320}>
        <div className="flex flex-col items-center gap-2 py-1">
          {inviteLoading && !invite ? (
            <div className="flex h-[220px] w-[220px] items-center justify-center">
              <Spinner size={22} className="text-[#B2B2B2]" />
            </div>
          ) : (
            <>
              <img
                src={qrDataUrl}
                alt="群二维码"
                className="h-[220px] w-[220px] rounded-[8px] border border-[#F0F0F0]"
                draggable="false"
              />
              <p className="text-[12px] text-[#999]">扫一扫二维码，加入群聊</p>
              {invite ? (
                <button
                  type="button"
                  onClick={copyLink}
                  className="mt-1 flex h-9 items-center gap-1.5 rounded-full bg-[#07C160] px-5 text-[14px] text-white active:bg-[#06AD56]"
                >
                  复制邀请链接
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => loadInvite(true)}
                disabled={refreshing}
                className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-full bg-[#F2F2F2] px-5 text-[14px] text-[#333] active:bg-[#E5E5E5] disabled:opacity-60"
              >
                {refreshing ? <Spinner size={14} className="text-[#333]" /> : <Icon name="refresh" size={15} className="text-[#333]" />}
                刷新二维码
              </button>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
