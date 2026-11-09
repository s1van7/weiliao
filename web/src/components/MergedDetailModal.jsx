/**
 * 合并转发明细（只读弹层）：复用 MessageBubble 逐条渲染被合并的消息快照。
 * 不传 onMessageAction，禁止在明细内二次长按操作。
 */
import { useAuth } from '../store/useAuth';
import { useUI } from '../store/useUI';
import Modal from './Modal';
import MessageBubble from './MessageBubble';

/**
 * @param {{title?: string, items?: Array<Record<string, any>>, onClose?: () => void}} props
 * @returns {JSX.Element}
 */
export default function MergedDetailModal({ title = '聊天记录', items = [], onClose }) {
  const myId = useAuth((state) => (state.user ? Number(state.user.id) : 0));
  const navigate = useUI((state) => state.navigate);

  const list = Array.isArray(items) ? items : [];

  return (
    <Modal open onClose={onClose} title={title} width={360}>
      <div className="flex flex-col gap-2">
        {list.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-[#999]">暂无明细</div>
        ) : (
          list.map((item, index) => {
            const message = {
              ...item,
              id: item.id || `merged-${index}`,
              _status: 'sent',
              revoked: 0,
              mentions: null,
            };
            const isMine = Number(item.sender_id) === myId;
            return (
              <MessageBubble
                key={`${item.created_at || index}-${index}`}
                message={message}
                isMine={isMine}
                onImageClick={(src) => useUI.getState().openImage(src)}
                onCardOpen={(userId) => navigate(`userInfo/${Number(userId)}`)}
              />
            );
          })
        )}
      </div>
    </Modal>
  );
}
