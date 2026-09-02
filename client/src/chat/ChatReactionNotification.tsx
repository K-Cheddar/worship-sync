import { MessageCircle } from "lucide-react";
import Button from "../components/Button/Button";

export type ChatReactionNotice = {
  actorId: string;
  emoji: string;
  name: string;
};

const ChatReactionNotification = ({
  notices,
  onOpen,
}: {
  notices: ChatReactionNotice[];
  onOpen: () => void;
}) => {
  const names = [...new Set(notices.map((notice) => notice.name))];
  const emojis = notices.map((notice) => notice.emoji).join(" ");
  const summary =
    names.length === 1
      ? `${names[0]} reacted ${emojis}`
      : `${names[0]} and ${names.length - 1} others reacted ${emojis}`;

  return (
    <div
      className="flex w-full min-w-[16rem] max-w-sm flex-col gap-2 text-left"
      role="group"
      aria-label={`Reaction to your message from ${names.join(", ")}`}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <MessageCircle
            aria-hidden="true"
            className="size-5 shrink-0 text-cyan-400"
          />
          <span className="text-sm font-semibold text-cyan-200">
            Reaction to your message
          </span>
        </div>
        <span className="block text-sm leading-snug text-gray-100">
          {summary} in team chat
        </span>
      </div>
      <Button
        type="button"
        variant="tertiary"
        className="self-start px-0 text-sm text-cyan-300"
        onClick={onOpen}
      >
        Open chat
      </Button>
    </div>
  );
};

export default ChatReactionNotification;
