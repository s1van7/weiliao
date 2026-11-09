/**
 * 朋友权限弹层：4 个开关（方向均为「我对该好友」）。
 *   - 不让他看我的朋友圈（hide_my_moments）
 *   - 不看他朋友圈（hide_his_moments）
 *   - 仅聊天（chat_only，等价前两项同时生效）
 *   - 加入黑名单（blocked，二次确认；拉黑后保留好友与会话、只读）
 * 后端返回「生效值」：chat_only / blocked 已折叠进两个 hide 字段。
 */
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useUI } from '../store/useUI';
import { errorText } from '../lib/errorText';
import Modal from './Modal';
import Spinner from './Spinner';

/**
 * 开关行。
 * @param {{
 *   label: string,
 *   checked: boolean,
 *   danger?: boolean,
 *   disabled?: boolean,
 *   last?: boolean,
 *   onChange: (next: boolean) => void,
 * }} props
 * @returns {JSX.Element}
 */
function ToggleRow({ label, checked, danger = false, disabled = false, last = false, onChange }) {
  return (
    <div>
      <div className="flex min-h-[52px] items-center gap-3">
        <span className={`min-w-0 flex-1 text-[15px] ${danger ? 'text-[#FA5151]' : 'text-[#111]'}`}>{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={`relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${
            checked ? 'bg-[#07C160]' : 'bg-[#E5E5E5]'
          }`}
        >
          <span
            className={`absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all ${
              checked ? 'left-[22px]' : 'left-[2px]'
            }`}
          />
        </button>
      </div>
      {last ? null : <div className="h-px bg-[#E5E5E5]" />}
    </div>
  );
}

/**
 * @param {{open: boolean, userId: number, onClose: () => void}} props
 * @returns {JSX.Element}
 */
export default function FriendPermissionSheet({ open, userId, onClose }) {
  const id = Number(userId) || 0;
  const showToast = useUI((state) => state.showToast);

  const [permission, setPermission] = useState(null);
  const [loading, setLoading] = useState(false);
  /** 正在提交的字段 key，用于禁用交互 */
  const [busy, setBusy] = useState('');

  // 打开时拉取当前生效权限
  useEffect(() => {
    if (!open || !id) return undefined;
    let alive = true;
    setLoading(true);
    setPermission(null);
    api
      .friendsPermission(id)
      .then((data) => {
        if (!alive) return;
        setPermission(data.permission || { hide_my_moments: false, hide_his_moments: false, chat_only: false, blocked: false });
      })
      .catch((err) => {
        if (!alive) return;
        showToast(errorText(err, '加载朋友权限失败'), 'error');
        onClose();
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id]);

  /**
   * 提交单个权限字段并回填服务端生效值。
   * @param {string} key 权限字段
   * @param {boolean} value 目标值
   * @returns {Promise<void>}
   */
  const apply = async (key, value) => {
    if (!id || busy) return;
    setBusy(key);
    try {
      const data = await api.updateFriendsPermission(id, { [key]: value });
      setPermission(data.permission || { ...(permission || {}), [key]: value });
    } catch (err) {
      showToast(errorText(err, '设置失败'), 'error');
    } finally {
      setBusy('');
    }
  };

  /**
   * 加入 / 移出黑名单：先二次确认再提交。
   * @param {boolean} next
   * @returns {void}
   */
  const handleBlocked = (next) => {
    useUI.getState().openModal({
      title: next ? '加入黑名单' : '移出黑名单',
      content: next
        ? '加入黑名单后，对方将无法给你发送消息或拨打通话，且你看不到对方的朋友圈。'
        : '移出黑名单后，对方可重新与你发送消息与通话。',
      confirmText: next ? '加入' : '移出',
      danger: next,
      onConfirm: () => apply('blocked', next),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="朋友权限" width={340} closeOnOverlay={!busy}>
      {loading || !permission ? (
        <div className="flex justify-center py-8">
          <Spinner size={20} className="text-[#B2B2B2]" />
        </div>
      ) : (
        <div className="-mx-1 py-1">
          <ToggleRow
            label="不让他看我的朋友圈"
            checked={permission.hide_my_moments}
            disabled={Boolean(busy)}
            onChange={(next) => apply('hide_my_moments', next)}
          />
          <ToggleRow
            label="不看他朋友圈"
            checked={permission.hide_his_moments}
            disabled={Boolean(busy)}
            onChange={(next) => apply('hide_his_moments', next)}
          />
          <ToggleRow
            label="仅聊天"
            checked={permission.chat_only}
            disabled={Boolean(busy)}
            onChange={(next) => apply('chat_only', next)}
          />
          <ToggleRow
            label="加入黑名单"
            danger
            checked={permission.blocked}
            disabled={Boolean(busy)}
            last
            onChange={handleBlocked}
          />
        </div>
      )}
    </Modal>
  );
}
