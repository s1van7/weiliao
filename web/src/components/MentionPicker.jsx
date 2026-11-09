/**
 * @ 成员选择弹层：浮在输入框上方，点击插入「@昵称 」并记录目标 id。
 *
 * 显示规则：
 *   - 第一项「所有人」在 allowAll 为 true 时出现（任何群成员都可 @全体人员）；
 *   - 其余为群成员（含自己，微信同样可选自己），按昵称关键字过滤；
 *   - 关键字命中前缀的排在前面，方便 @ 时快速定位。
 */
import { useMemo } from 'react';
import Avatar from './Avatar';

/**
 * @param {{
 *   members: Array<Record<string, any>>,
 *   allowAll?: boolean,
 *   keyword?: string,
 *   onPick: (target: {all: boolean, id: number, nickname: string}) => void,
 *   onClose?: () => void,
 * }} props
 * @returns {JSX.Element}
 */
export default function MentionPicker({ members, allowAll = false, keyword = '', onPick, onClose }) {
  const list = useMemo(() => {
    const source = Array.isArray(members) ? members : [];
    const text = String(keyword || '').trim().toLowerCase();

    const normalized = source.map((member) => ({
      id: Number(member.user_id || member.id || 0),
      nickname: String(member.nickname || ''),
      avatar_color: member.avatar_color || '#07C160',
      avatar_url: member.avatar_url || '',
      role: member.role || 'member',
    }));

    if (!text) return normalized;

    const matched = normalized.filter((member) => member.nickname.toLowerCase().includes(text));
    // 前缀命中优先
    return [...matched].sort((left, right) => {
      const leftPrefix = left.nickname.toLowerCase().startsWith(text) ? 0 : 1;
      const rightPrefix = right.nickname.toLowerCase().startsWith(text) ? 0 : 1;
      return leftPrefix - rightPrefix;
    });
  }, [members, keyword]);

  const showAll = allowAll && (!keyword || '所有人'.includes(String(keyword).trim()));

  return (
    <div className="absolute inset-x-2 bottom-full z-30 mb-1 overflow-hidden rounded-[8px] border border-[#E0E0E0] bg-white shadow-[0_4px_16px_rgba(0,0,0,0.14)]">
      <div className="flex items-center justify-between border-b border-[#F0F0F0] px-3 py-1.5">
        <span className="text-[11px] leading-4 text-[#999]">选择要提醒的人</span>
        {onClose ? (
          <button type="button" onClick={onClose} className="text-[11px] leading-4 text-[#576B95] active:opacity-60">
            取消
          </button>
        ) : null}
      </div>

      <div className="max-h-[196px] overflow-y-auto">
        {showAll ? (
          <button
            type="button"
            onClick={() => onPick({ all: true, id: 0, nickname: '所有人' })}
            className="flex min-h-[46px] w-full items-center gap-2.5 px-3 text-left active:bg-black/5"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] bg-[#FA9D3B] text-[15px] leading-none text-white">
              @
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] text-[#111]">所有人</span>
            <span className="shrink-0 rounded-[3px] bg-[#FFF1E0] px-1 text-[10px] leading-[15px] text-[#C87A21]">
              提醒全群
            </span>
          </button>
        ) : null}

        {list.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-[#B2B2B2]">没有匹配的成员</p>
        ) : (
          list.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => onPick({ all: false, id: member.id, nickname: member.nickname })}
              className="flex min-h-[46px] w-full items-center gap-2.5 px-3 text-left active:bg-black/5"
            >
              <Avatar name={member.nickname} color={member.avatar_color} src={member.avatar_url} size={30} />
              <span className="min-w-0 flex-1 truncate text-[14px] text-[#111]">{member.nickname}</span>
              {member.role === 'owner' ? (
                <span className="shrink-0 rounded-[3px] bg-[#FFF1E0] px-1 text-[10px] leading-[15px] text-[#C87A21]">
                  群主
                </span>
              ) : member.role === 'admin' ? (
                <span className="shrink-0 rounded-[3px] bg-[#EAF6FF] px-1 text-[10px] leading-[15px] text-[#1E7FBF]">
                  管理员
                </span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
