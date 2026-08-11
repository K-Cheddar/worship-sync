import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil, Send, SmilePlus, Trash2, X } from "lucide-react";
import Button from "../components/Button/Button";
import Input from "../components/Input/Input";
import TextArea from "../components/TextArea/TextArea";
import { cn } from "../utils/cnHelper";
import { useChat } from "./ChatContext";
import type { ChatMessage } from "./types";

const MAX_MESSAGE_LENGTH = 1000;

const earliestDayKey = (todayKey: string, retentionDays: number) => {
  const date = new Date(`${todayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - retentionDays);
  return date.toISOString().slice(0, 10);
};

const ChatMessageRow = ({ message }: { message: ChatMessage }) => {
  const chat = useChat();
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const [showReactions, setShowReactions] = useState(false);
  if (!chat?.context) return null;

  const isOwn = message.authorId === chat.context.actorId;
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: chat.context.timeZone,
  }).format(message.createdAt);

  const saveEdit = async () => {
    const saved = await chat.editMessage(message.messageId, editText);
    if (saved) setIsEditing(false);
  };

  return (
    <article
      className={cn("flex flex-col", isOwn ? "items-end" : "items-start")}
      aria-label={`${message.authorName} at ${time}`}
    >
      <div className="mb-1 flex items-center gap-2 px-1 text-[11px] text-gray-400">
        {!isOwn ? (
          <span className="font-medium text-gray-300">
            {message.authorName}
          </span>
        ) : null}
        <time dateTime={new Date(message.createdAt).toISOString()}>{time}</time>
        {message.editedAt && !message.deletedAt ? <span>(edited)</span> : null}
      </div>

      <div
        className={cn(
          "max-w-[88%] rounded-xl px-3 py-2 text-sm shadow-sm",
          isOwn ? "bg-cyan-700 text-white" : "bg-gray-700 text-gray-100",
          message.deletedAt && "italic text-gray-300",
        )}
      >
        {message.deletedAt ? (
          "Message removed."
        ) : isEditing ? (
          <div className="flex min-w-56 flex-col gap-2">
            <TextArea
              label="Edit message"
              hideLabel
              value={editText}
              onChange={setEditText}
              maxLength={MAX_MESSAGE_LENGTH}
              autoResize
              textareaClassName="max-h-32 min-h-16 bg-gray-800"
            />
            <div className="flex justify-end gap-1">
              <Button
                variant="tertiary"
                svg={X}
                iconSize="sm"
                className="max-md:!min-h-8"
                aria-label="Cancel editing"
                onClick={() => {
                  setEditText(message.text);
                  setIsEditing(false);
                }}
              />
              <Button
                variant="secondary"
                svg={Check}
                iconSize="sm"
                className="max-md:!min-h-8"
                disabled={
                  !editText.trim() || editText.length > MAX_MESSAGE_LENGTH
                }
                aria-label="Save message"
                onClick={() => void saveEdit()}
              />
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.text}</p>
        )}
      </div>

      {!message.deletedAt && !isEditing ? (
        <div className="mt-1 flex max-w-[92%] flex-wrap items-center gap-1 px-1">
          {message.reactions.map((reaction) => {
            const selected = reaction.actors.some(
              (actor) => actor.actorId === chat.context?.actorId,
            );
            return (
              <Button
                key={reaction.emoji}
                variant="tertiary"
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs max-md:!min-h-8",
                  selected && "bg-cyan-900 ring-1 ring-cyan-400",
                )}
                aria-label={`${selected ? "Remove" : "Add"} ${reaction.emoji} reaction. ${reaction.actors.length} total.`}
                title={reaction.actors.map((actor) => actor.name).join(", ")}
                onClick={() =>
                  void chat.toggleReaction(message.messageId, reaction.emoji)
                }
              >
                {reaction.emoji} {reaction.actors.length}
              </Button>
            );
          })}
          <Button
            variant="tertiary"
            svg={SmilePlus}
            iconSize="xs"
            className="rounded-full max-md:!min-h-8"
            aria-label="Add a reaction"
            onClick={() => setShowReactions((current) => !current)}
          />
          {isOwn ? (
            <>
              <Button
                variant="tertiary"
                svg={Pencil}
                iconSize="xs"
                className="rounded-full max-md:!min-h-8"
                aria-label="Edit message"
                onClick={() => setIsEditing(true)}
              />
              <Button
                variant="tertiary"
                svg={Trash2}
                iconSize="xs"
                className="rounded-full max-md:!min-h-8"
                aria-label="Remove message"
                onClick={() => void chat.removeMessage(message.messageId)}
              />
            </>
          ) : null}
        </div>
      ) : null}

      {showReactions && !message.deletedAt ? (
        <div
          className="mt-1 flex flex-wrap gap-1 rounded-lg bg-gray-900 p-1"
          aria-label="Reactions"
        >
          {chat.context.reactionEmojis.map((emoji) => (
            <Button
              key={emoji}
              variant="tertiary"
              className="px-2 py-1 text-base max-md:!min-h-9"
              aria-label={`React with ${emoji}`}
              onClick={() => {
                setShowReactions(false);
                void chat.toggleReaction(message.messageId, emoji);
              }}
            >
              {emoji}
            </Button>
          ))}
        </div>
      ) : null}
    </article>
  );
};

const ChatWindow = () => {
  const chat = useChat();
  const [draft, setDraft] = useState("");
  const [showComposerEmojis, setShowComposerEmojis] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const isToday = Boolean(
    chat?.context && chat.selectedDayKey === chat.context.todayKey,
  );
  const minDay = useMemo(
    () =>
      chat?.context
        ? earliestDayKey(chat.context.todayKey, chat.context.retentionDays)
        : "",
    [chat?.context],
  );

  useEffect(() => {
    if (isToday) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [chat?.messages.length, isToday]);

  if (!chat?.context) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-gray-300">
        <p>{chat?.error || "Connecting to team chat…"}</p>
        {chat?.error ? (
          <Button variant="secondary" onClick={chat.retry}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  }

  const submit = async () => {
    if (!draft.trim() || draft.length > MAX_MESSAGE_LENGTH) return;
    const sent = await chat.sendMessage(draft);
    if (sent) {
      setDraft("");
      setShowComposerEmojis(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-900 text-white">
      <div className="flex shrink-0 items-end gap-2 border-b border-gray-700 p-3">
        <Input
          type="date"
          label="Chat date"
          value={chat.selectedDayKey}
          min={minDay}
          max={chat.context.todayKey}
          className="min-w-0 flex-1"
          inputClassName="bg-gray-800"
          onChange={(value) => void chat.selectDay(String(value))}
        />
        <span
          className={cn(
            "mb-2 h-2.5 w-2.5 shrink-0 rounded-full",
            chat.connectionStatus === "connected"
              ? "bg-emerald-400"
              : "bg-amber-400",
          )}
          title={
            chat.connectionStatus === "connected"
              ? "Live updates connected"
              : "Reconnecting to live updates"
          }
          aria-label={
            chat.connectionStatus === "connected"
              ? "Live updates connected"
              : "Reconnecting to live updates"
          }
        />
      </div>

      {chat.error ? (
        <div
          className="m-3 flex shrink-0 items-start gap-2 rounded-lg border border-amber-500/60 bg-amber-950/50 p-2 text-xs text-amber-100"
          role="alert"
        >
          <p className="min-w-0 flex-1">{chat.error}</p>
          <Button
            variant="tertiary"
            svg={X}
            iconSize="xs"
            className="max-md:!min-h-8"
            aria-label="Dismiss chat error"
            onClick={chat.clearError}
          />
        </div>
      ) : null}

      <div
        className="scrollbar-variable flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
        role="log"
        aria-label="Team chat messages"
        aria-live="polite"
      >
        {chat.hasMore ? (
          <Button
            variant="tertiary"
            className="mx-auto text-xs max-md:!min-h-9"
            isLoading={chat.isLoading}
            onClick={() => void chat.loadMore()}
          >
            Load earlier messages
          </Button>
        ) : null}
        {!chat.isLoading && chat.messages.length === 0 ? (
          <div className="m-auto max-w-xs text-center text-sm text-gray-400">
            {isToday
              ? "No messages yet today. Start the conversation below."
              : "There are no messages for this day."}
          </div>
        ) : null}
        {chat.messages.map((message) => (
          <ChatMessageRow key={message.messageId} message={message} />
        ))}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-gray-700 bg-gray-800 p-3">
        {isToday ? (
          <>
            {showComposerEmojis ? (
              <div
                className="mb-2 flex flex-wrap gap-1"
                aria-label="Message emojis"
              >
                {chat.context.reactionEmojis.map((emoji) => (
                  <Button
                    key={emoji}
                    variant="tertiary"
                    className="px-2 py-1 text-base max-md:!min-h-9"
                    aria-label={`Add ${emoji} to message`}
                    onClick={() => setDraft((current) => `${current}${emoji}`)}
                  >
                    {emoji}
                  </Button>
                ))}
              </div>
            ) : null}
            <TextArea
              label="Message"
              hideLabel
              value={draft}
              onChange={setDraft}
              placeholder="Message the team"
              maxLength={MAX_MESSAGE_LENGTH}
              autoResize
              textareaClassName="max-h-28 min-h-16 bg-gray-900"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <div className="mt-2 flex items-center gap-2">
              <Button
                variant="tertiary"
                svg={SmilePlus}
                iconSize="sm"
                className="max-md:!min-h-10"
                aria-label="Add an emoji"
                onClick={() => setShowComposerEmojis((current) => !current)}
              />
              <span className="min-w-0 flex-1 text-right text-[11px] text-gray-400">
                {draft.length}/{MAX_MESSAGE_LENGTH}
              </span>
              <Button
                variant="secondary"
                svg={Send}
                iconSize="sm"
                isLoading={chat.isSending}
                disabled={
                  !draft.trim() ||
                  draft.length > MAX_MESSAGE_LENGTH ||
                  chat.isSending
                }
                onClick={() => void submit()}
              >
                Send
              </Button>
            </div>
          </>
        ) : (
          <p className="text-center text-sm text-gray-400">
            History is read-only. Choose today to send a message.
          </p>
        )}
      </div>
    </div>
  );
};

export default ChatWindow;
