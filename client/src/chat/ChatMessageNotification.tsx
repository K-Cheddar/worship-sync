import Button from "../components/Button/Button";
import type { ChatMessage } from "./types";

const previewText = (text: string) =>
  text.length > 140 ? `${text.slice(0, 137).trimEnd()}…` : text;

const ChatMessageNotification = ({
  message,
  onOpen,
}: {
  message: ChatMessage;
  onOpen: () => void;
}) => (
  <Button
    type="button"
    variant="none"
    wrap
    className="w-full flex-col items-start gap-1 px-0 py-0 text-left font-normal max-md:!min-h-12"
    aria-label={`Open team chat. New message from ${message.authorName}: ${previewText(message.text)}`}
    onClick={onOpen}
  >
    <span className="text-sm font-semibold text-cyan-200">
      {message.authorName}
    </span>
    <span className="line-clamp-2 max-w-sm whitespace-pre-wrap break-words text-sm leading-snug text-gray-100">
      {previewText(message.text)}
    </span>
    <span className="text-xs font-medium text-cyan-300">Open team chat</span>
  </Button>
);

export default ChatMessageNotification;
