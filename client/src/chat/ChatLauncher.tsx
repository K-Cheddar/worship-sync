import { MessageCircle } from "lucide-react";
import { useLocation } from "react-router-dom";
import Button from "../components/Button/Button";
import { isChatPageRoute, useChat } from "./ChatContext";

const ChatLauncher = ({ onOpen }: { onOpen?: () => void }) => {
  const chat = useChat();
  const location = useLocation();
  if (!chat?.available || isChatPageRoute(location.pathname)) return null;

  const unreadLabel = chat.unreadCount > 99 ? "99+" : String(chat.unreadCount);
  const ariaLabel = chat.unreadCount
    ? `Open team chat. ${chat.unreadCount} unread ${chat.unreadCount === 1 ? "message" : "messages"}.`
    : "Open team chat";

  return (
    <Button
      type="button"
      variant="tertiary"
      svg={MessageCircle}
      iconSize="md"
      wrap
      className="w-full items-center rounded-md border border-cyan-500/30 bg-cyan-950/30 px-3 py-2 text-left max-md:!min-h-14"
      aria-label={ariaLabel}
      onClick={() => {
        onOpen?.();
        chat.openChat();
      }}
    >
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <span className="text-sm font-semibold text-white">Team chat</span>
        <span className="text-xs font-normal text-gray-400">
          {chat.unreadCount > 0
            ? `${chat.unreadCount} unread ${chat.unreadCount === 1 ? "message" : "messages"}`
            : "Messages for your team"}
        </span>
      </span>
      {chat.unreadCount > 0 ? (
        <span
          className="min-w-5 shrink-0 rounded-full bg-cyan-400 px-1.5 py-0.5 text-center text-[10px] font-bold leading-none tabular-nums text-gray-950"
          aria-hidden="true"
        >
          {unreadLabel}
        </span>
      ) : null}
    </Button>
  );
};

export default ChatLauncher;
