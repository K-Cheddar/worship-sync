import { useState } from "react";
import { Send } from "lucide-react";
import Button from "../components/Button/Button";
import TextArea from "../components/TextArea/TextArea";
import { cn } from "../utils/cnHelper";
import type { ChatMessage } from "./types";

const MAX_MESSAGE_LENGTH = 1000;

const previewText = (text: string) =>
  text.length > 140 ? `${text.slice(0, 137).trimEnd()}…` : text;

const messagePreview = (message: ChatMessage, truncate: boolean) => {
  const text = truncate ? previewText(message.text) : message.text;
  if (!message.attachment) return text;
  return text ? `Photo: ${text}` : "Sent a photo";
};

const ChatMessageNotification = ({
  message,
  onOpen,
  onReply,
  onReplyStart,
}: {
  message: ChatMessage;
  onOpen: () => void;
  onReply: (text: string) => Promise<boolean>;
  onReplyStart?: () => void;
}) => {
  const [isReplying, setIsReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  const beginReply = () => {
    onReplyStart?.();
    setIsReplying(true);
  };

  const submitReply = async () => {
    if (!draft.trim() || draft.length > MAX_MESSAGE_LENGTH || isSending) return;
    setIsSending(true);
    setError("");
    try {
      const sent = await onReply(draft);
      if (!sent) {
        setError("Could not send your reply. Try again.");
      }
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      className="flex w-full min-w-[16rem] max-w-sm flex-col gap-2 text-left"
      role="group"
      aria-label={`Team chat message from ${message.authorName}`}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-cyan-200">
          {message.authorName}
        </span>
        <span
          className={cn(
            "whitespace-pre-wrap break-words text-sm leading-snug text-gray-100",
            !isReplying && "line-clamp-3",
          )}
        >
          {messagePreview(message, !isReplying)}
        </span>
      </div>

      {isReplying ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <TextArea
              label={`Reply to ${message.authorName}`}
              hideLabel
              value={draft}
              onChange={setDraft}
              placeholder="Write a reply"
              maxLength={MAX_MESSAGE_LENGTH}
              autoResize
              rows={1}
              autoFocus
              className="min-w-0 flex-1"
              textareaClassName="max-h-24 min-h-0 bg-zinc-950 px-2 py-2 leading-5"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submitReply();
                }
              }}
            />
            <Button
              type="button"
              variant="none"
              svg={Send}
              iconSize="md"
              color="#082f49"
              padding="p-0"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cyan-400 hover:bg-cyan-300 max-md:!min-h-10 max-md:!min-w-10"
              isLoading={isSending}
              disabled={
                !draft.trim() ||
                draft.length > MAX_MESSAGE_LENGTH ||
                isSending
              }
              aria-label="Send reply"
              onClick={() => void submitReply()}
            />
          </div>
          {error ? (
            <p className="text-xs text-amber-200" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            variant="tertiary"
            className="self-start px-0 text-sm text-cyan-300 max-md:!min-h-9"
            disabled={isSending}
            onClick={onOpen}
          >
            Open chat
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            className="justify-center text-sm max-md:!min-h-10"
            onClick={beginReply}
          >
            Reply
          </Button>
          <Button
            type="button"
            variant="tertiary"
            className="px-0 text-sm text-cyan-300 max-md:!min-h-10"
            onClick={onOpen}
          >
            Open chat
          </Button>
        </div>
      )}
    </div>
  );
};

export default ChatMessageNotification;
