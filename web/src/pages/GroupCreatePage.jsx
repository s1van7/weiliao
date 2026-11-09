/**
 * 发起群聊：三种方式切换。
 *   - 选择好友：好友多选（复选圆点，选中变绿勾），至少选 2 位好友；
 *   - 面对面建群：跳转到 FacePairPage（kind=group）；
 *   - 从已有群聊建群：先选源群，再在源群成员中多选「同时是我的好友」的成员，非好友置灰。
 * 后端要求群聊至少 3 人（含自己），因此至少选择 2 位成员。
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../store/useAuth';
import { useChat } from '../store/useChat';
import { useUI } from '../store/useUI';
import Avatar from '../components/Avatar';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Spinner from '../components/Spinner';
import Icon from '../components/Icon';

const MIN_MEMBERS = 2;

/**
 * @param {{embedded?: boolean}} props
 * @returns {JSX.Element}
 */
export default function GroupCreatePage({ embedded = false }) {
  const me = useAuth((state) => state.user);
  const myId = me ? Number(me.id) : 0;
  const friends = useChat((state) => state.friends);
  const conversations = useChat((state) => state.conversations);
  const detailsByConv = useChat((state) => state.detailsByConv);
  const back = useUI((state) => state.back);
  const navigate = useUI((state) => state.navigate);
  const showToast = useUI((state) => state.showToast);
  const setFacePairKind = useUI((state) => state.setFacePairKind);

  const [mode, setMode] = useState('friends'); // 'friends' | 'fromGroup'
  const [selected, setSelected] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [sourceGroupId, setSourceGroupId] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const myGroups = useMemo(() => conversations.filter((item) => item.type === 'group'), [conversations]);
  const friendIds = useMemo(() => new Set(friends.map((friend) => Number(friend.id))), [friends]);
  const sourceDetail = sourceGroupId ? (detailsByConv[sourceGroupId] || null) : null;
  const sourceMembers = useMemo(() => {
    if (!sourceDetail || !Array.isArray(sourceDetail.members)) return [];
    return sourceDetail.members.filter((member) => Number(member.user_id) !== myId);
  }, [sourceDetail, myId]);

  // 拉取源群成员
  useEffect(() => {
    if (mode !== 'fromGroup' || !sourceGroupId) return;
    useChat
      .getState()
      .groupDetail(sourceGroupId, { force: true })
      .catch(() => {});
  }, [mode, sourceGroupId]);

  /**
   * 切换建群方式（清空已选）。
   * @param {'friends'|'fromGroup'} next
   * @returns {void}
   */
  const switchMode = (next) => {
    setMode(next);
    setSelected([]);
    setSourceGroupId(0);
  };

  /**
   * 进入面对面建群。
   * @returns {void}
   */
  const openFacePair = () => {
    setFacePairKind('group');
    navigate('facePair');
  };

  /**
   * 选中 / 取消选中。
   * @param {number} memberId
   * @returns {void}
   */
  const toggle = (memberId) => {
    setSelected((prev) => (prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]));
  };

  const canSubmit =
    selected.length >= MIN_MEMBERS && !submitting && (mode === 'friends' || sourceGroupId > 0);

  /**
   * 创建群聊并进入会话。
   * @returns {Promise<void>}
   */
  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const sourceId = mode === 'fromGroup' ? sourceGroupId : null;
      const conversationId = await useChat.getState().createGroup(selected, groupName.trim(), sourceId);
      showToast('群聊已创建');
      navigate(`chat/${conversationId}`);
    } catch (err) {
      showToast((err && err.message) || '创建群聊失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const content = (
    <>
      {/* 方式切换 */}
      <div className="mx-3 mt-3 flex rounded-[8px] bg-black/[0.06] p-[3px]">
        {[
          { key: 'friends', label: '选择好友' },
          { key: 'facePair', label: '面对面建群' },
          { key: 'fromGroup', label: '从已有群聊建群' },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => (item.key === 'facePair' ? openFacePair() : switchMode(item.key))}
            className={`h-9 flex-1 rounded-[6px] text-[13px] transition-colors ${
              mode === item.key ? 'bg-white font-medium text-[#111] shadow-sm' : 'text-[#666]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* 已选成员 + 群名 */}
      <div className="mx-3 mt-3 bg-white px-3 py-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {selected.map((memberId) => {
            const friend = friends.find((item) => Number(item.id) === memberId);
            const sourceMember = sourceMembers.find((item) => Number(item.user_id) === memberId);
            const nickname = friend
              ? friend.nickname
              : sourceMember
                ? sourceMember.nickname
                : '';
            return (
              <button
                key={memberId}
                type="button"
                onClick={() => toggle(memberId)}
                className="relative shrink-0"
                aria-label={`移除 ${nickname}`}
              >
                <Avatar
                  name={nickname}
                  color={friend ? friend.avatar_color : sourceMember ? sourceMember.avatar_color : '#07C160'}
                  src={friend ? friend.avatar_url : sourceMember ? sourceMember.avatar_url : ''}
                  size={44}
                />
                <span className="absolute -right-1 -top-1 flex h-[16px] w-[16px] items-center justify-center rounded-full bg-[#FA5151] text-[10px] leading-none text-white">
                  <Icon name="close" size={10} className="text-white" />
                </span>
              </button>
            );
          })}
          {selected.length === 0 ? (
            <span className="py-2 text-[13px] text-[#B2B2B2]">至少选择 2 位成员</span>
          ) : null}
        </div>

        <div className="mt-3 flex items-center gap-3 border-t border-[#F0F0F0] pt-3">
          <span className="shrink-0 text-[14px] text-[#333]">群名称</span>
          <input
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            maxLength={40}
            placeholder="不填将自动生成"
            className="h-7 min-w-0 flex-1 text-[15px] placeholder:text-[#B2B2B2]"
          />
        </div>
      </div>

      {/* 从已有群聊建群：先选源群 */}
      {mode === 'fromGroup' ? (
        <div className="mx-3 mt-2 bg-white px-3 py-2">
          <p className="pb-1 pt-2 text-[12px] text-[#888]">选择源群聊</p>
          {myGroups.length === 0 ? (
            <EmptyState title="还没有群聊" description="你还没有加入任何群聊" variant="contact" />
          ) : (
            <div className="flex flex-wrap gap-2 pb-2">
              {myGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => {
                    setSourceGroupId(group.id);
                    setSelected([]);
                  }}
                  className={`max-w-full rounded-[6px] px-3 py-1.5 text-[13px] ${
                    sourceGroupId === group.id
                      ? 'bg-[#07C160] text-white'
                      : 'bg-[#F2F2F2] text-[#333] active:bg-[#E5E5E5]'
                  }`}
                >
                  {group.name || '群聊'}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* 成员多选 */}
      <div className="mx-3 mt-2 min-h-0 flex-1 overflow-y-auto bg-white">
        <div className="px-3 pb-1 pt-3 text-[12px] text-[#888]">
          {mode === 'friends' ? `选择好友（${selected.length}）` : `选择源群成员（${selected.length}）`}
        </div>

        {mode === 'friends' ? (
          friends.length === 0 ? (
            <EmptyState title="还没有好友" description="先去添加好友，再来发起群聊" variant="contact" />
          ) : (
            friends.map((friend) => {
              const checked = selected.includes(Number(friend.id));
              return (
                <button
                  key={friend.id}
                  type="button"
                  onClick={() => toggle(Number(friend.id))}
                  className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left active:bg-black/5"
                >
                  <span
                    className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border transition-colors ${
                      checked ? 'border-[#07C160] bg-[#07C160]' : 'border-[#D0D0D0] bg-white'
                    }`}
                  >
                    {checked ? <Icon name="check" size={14} className="text-white" /> : null}
                  </span>
                  <Avatar name={friend.nickname} color={friend.avatar_color} src={friend.avatar_url} size={40} />
                  <span className="min-w-0 flex-1 truncate text-[15px] text-[#111]">{friend.nickname}</span>
                </button>
              );
            })
          )
        ) : !sourceGroupId ? (
          <p className="px-3 py-6 text-center text-[13px] text-[#B2B2B2]">请先选择源群聊</p>
        ) : sourceMembers.length === 0 ? (
          <EmptyState title="源群没有其他成员" description="换个群试试吧" variant="contact" />
        ) : (
          sourceMembers.map((member) => {
            const memberId = Number(member.user_id);
            const isFriend = friendIds.has(memberId);
            const checked = selected.includes(memberId);
            return (
              <button
                key={memberId}
                type="button"
                disabled={!isFriend}
                onClick={() => isFriend && toggle(memberId)}
                className={`flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left ${
                  isFriend ? 'active:bg-black/5' : 'cursor-not-allowed opacity-45'
                }`}
              >
                <span
                  className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border transition-colors ${
                    checked ? 'border-[#07C160] bg-[#07C160]' : 'border-[#D0D0D0] bg-white'
                  }`}
                >
                  {checked ? <Icon name="check" size={14} className="text-white" /> : null}
                </span>
                <Avatar name={member.nickname} color={member.avatar_color} src={member.avatar_url} size={40} />
                <span className="min-w-0 flex-1 truncate text-[15px] text-[#111]">{member.nickname}</span>
                {!isFriend ? <span className="shrink-0 text-[12px] text-[#B2B2B2]">非好友</span> : null}
              </button>
            );
          })
        )}
      </div>

      {/* 完成 */}
      <div
        className="shrink-0 border-t border-[#E5E5E5] bg-white px-4 py-2.5"
        style={embedded ? undefined : { paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))' }}
      >
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`flex h-[44px] w-full items-center justify-center gap-2 rounded-lg text-[16px] font-medium text-white ${
            canSubmit ? 'bg-[#07C160] active:bg-[#06AD56]' : 'bg-[#D8D8D8]'
          }`}
        >
          {submitting ? <Spinner size={17} className="text-white" /> : null}
          完成({selected.length})
        </button>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className="flex h-full flex-col bg-[#F5F5F5]">
        <div className="mx-auto flex min-h-0 w-full max-w-[620px] flex-1 flex-col pt-2">{content}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#EDEDED]">
      <PageHeader title="发起群聊" onBack={back} />
      <div className="flex min-h-0 flex-1 flex-col">{content}</div>
    </div>
  );
}
