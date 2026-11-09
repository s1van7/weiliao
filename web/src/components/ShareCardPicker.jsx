/**
 * 分享名片选择器：把指定好友的名片发送到「好友单聊」或「群聊」。
 * 由 UserInfoPage「··· → 分享名片」打开；好友目标会自动复用 / 创建单聊会话。
 */
import Modal from './Modal';
import Avatar from './Avatar';
import { useChat } from '../store/useChat';
import { useUI } from '../store/useUI';
import { displayNameOf } from '../lib/format';

/**
 * @param {{
 *   open: boolean,
 *   userId: number,
 *   onClose: () => void,
 * }} props
 * @returns {JSX.Element}
 */
export default function ShareCardPicker({ open, userId, onClose }) {
  const friends = useChat((state) => state.friends);
  const conversations = useChat((state) => state.conversations);
  const showToast = useUI((state) => state.showToast);

  const cardUserId = Number(userId) || 0;
  const groups = conversations.filter((item) => item.type === 'group');

  /**
   * 分享到单聊好友。
   * @param {number} friendId
   * @returns {Promise<void>}
   */
  const shareToFriend = async (friendId) => {
    const targetId = Number(friendId);
    if (!targetId) return;
    try {
      const conversationId = await useChat.getState().ensureSingleConversation(targetId);
      if (!conversationId) throw new Error('会话创建失败');
      await useChat.getState().shareCard(conversationId, cardUserId);
      onClose();
      showToast('已分享', 'success');
    } catch (err) {
      showToast((err && err.message) || '分享失败', 'error');
    }
  };

  /**
   * 分享到群聊。
   * @param {number} conversationId
   * @returns {Promise<void>}
   */
  const shareToGroup = async (conversationId) => {
    const convId = Number(conversationId);
    if (!convId) return;
    try {
      await useChat.getState().shareCard(convId, cardUserId);
      onClose();
      showToast('已分享', 'success');
    } catch (err) {
      showToast((err && err.message) || '分享失败', 'error');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="分享名片" width={340}>
      <div className="-mx-5 -my-3">
        <p className="px-5 pb-1 pt-1 text-[12px] text-[#999]">好友</p>
        {friends.length === 0 ? (
          <p className="px-5 py-3 text-[13px] text-[#999]">暂无好友</p>
        ) : (
          <div className="max-h-[32vh] overflow-y-auto">
            {friends.map((friend) => (
              <button
                key={friend.id}
                type="button"
                onClick={() => shareToFriend(Number(friend.id))}
                className="flex min-h-[52px] w-full items-center gap-3 px-5 text-left active:bg-black/5"
              >
                <Avatar
                  name={friend.nickname}
                  color={friend.avatar_color}
                  src={friend.avatar_url}
                  size={36}
                  radius={4}
                />
                <span className="min-w-0 flex-1 truncate text-[15px] text-[#111]">{displayNameOf(friend)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mx-5 my-1 h-px bg-[#F0F0F0]" />
        <p className="px-5 pb-1 pt-1 text-[12px] text-[#999]">群聊</p>
        {groups.length === 0 ? (
          <p className="px-5 py-3 text-[13px] text-[#999]">暂无群聊</p>
        ) : (
          <div className="max-h-[32vh] overflow-y-auto">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => shareToGroup(Number(group.id))}
                className="flex min-h-[52px] w-full items-center gap-3 px-5 text-left active:bg-black/5"
              >
                <Avatar name={group.name || '群聊'} group src={group.avatar_url} size={36} radius={4} />
                <span className="min-w-0 flex-1 truncate text-[15px] text-[#111]">
                  {group.name || '群聊'}({group.member_count || 0})
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}