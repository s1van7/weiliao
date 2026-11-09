/**
 * 名片消息气泡：content 为服务端回填后的 JSON 字符串
 * {"type":"card","user_id":123,"nickname":"张三","avatar_url":"/uploads/xxx.jpg"}
 * 点击进入对方资料卡。
 */
import Avatar from './Avatar';

/**
 * @param {{content: string, onOpen?: (userId: number) => void}} props
 * @returns {JSX.Element}
 */
export default function CardMessage({ content, onOpen, ...rest }) {
  let card = null;
  try {
    card = JSON.parse(String(content || ''));
  } catch {
    card = null;
  }

  if (!card || card.type !== 'card' || !card.user_id) {
    return <span className="px-1 text-[13px] text-[#999]" {...rest}>[名片]</span>;
  }

  const userId = Number(card.user_id);

  return (
    <button
      type="button"
      onClick={() => {
        if (onOpen && Number.isInteger(userId) && userId > 0) onOpen(userId);
      }}
      className="flex w-[220px] items-center gap-3 rounded-[8px] border border-[#E5E5E5] bg-white px-3 py-2.5 text-left active:bg-black/5"
      {...rest}
    >
      <Avatar name={card.nickname || ''} color="#07C160" src={card.avatar_url || ''} size={36} radius={4} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] leading-5 text-[#111]">{card.nickname || '好友'}</p>
        <p className="mt-[2px] text-[11px] leading-4 text-[#999]">个人名片</p>
      </div>
      <span className="text-[12px] text-[#B2B2B2]">查看</span>
    </button>
  );
}
