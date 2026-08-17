import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Expand,
  ImagePlus,
  MoreVertical,
  Pencil,
  Send,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import Button from "../components/Button/Button";
import Input from "../components/Input/Input";
import PopOver from "../components/PopOver/PopOver";
import TextArea from "../components/TextArea/TextArea";
import { cn } from "../utils/cnHelper";
import {
  earliestDayKey,
  formatChatDayLabel,
  shiftDayKey,
} from "./chatDayUtils";
import { getChatMessageGroupPosition } from "./chatMessageLayout";
import { useChat } from "./ChatContext";
import ChatImageAttachment from "./ChatImageAttachment";
import type { ChatMessage } from "./types";

const MAX_MESSAGE_LENGTH = 1000;

const operatorFacingError = (message: string, canUseChat: boolean) => {
  if (!canUseChat) return message;
  if (/unavailable/i.test(message)) {
    return "Could not finish that request. Try again.";
  }
  return message;
};

const typingLabel = (names: string[]) => {
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return "Several teammates are typing";
};

const ChatMessageRow = ({
  message,
  canMutate,
  startsGroup,
  endsGroup,
}: {
  message: ChatMessage;
  canMutate: boolean;
  startsGroup: boolean;
  endsGroup: boolean;
}) => {
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
      className={cn(
        "flex flex-col",
        startsGroup ? "mt-2.5" : "mt-0.5",
        isOwn ? "items-end" : "items-start",
      )}
      aria-label={`${message.authorName} at ${time}`}
    >
      {!isOwn && startsGroup ? (
        <span className="mb-1 px-2 text-xs font-semibold text-cyan-300">
          {message.authorName}
        </span>
      ) : null}

      <div
        className={cn(
          "max-w-[88%] rounded-2xl px-3 py-2 text-sm",
          isOwn ? "bg-cyan-800 text-white" : "bg-gray-700 text-gray-100",
          endsGroup && isOwn && "rounded-br-sm",
          endsGroup && !isOwn && "rounded-bl-sm",
          message.deletedAt && "italic text-gray-300",
        )}
      >
        {isEditing ? (
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
                  (!editText.trim() && !message.attachment) ||
                  editText.length > MAX_MESSAGE_LENGTH
                }
                aria-label="Save message"
                onClick={() => void saveEdit()}
              />
            </div>
          </div>
        ) : (
          <>
            {message.attachment && !message.deletedAt ? (
              <ChatImageAttachment
                churchId={message.churchId}
                messageId={message.messageId}
                authorName={message.authorName}
                attachment={message.attachment}
              />
            ) : null}
            <div className="flex items-end gap-2">
              {message.deletedAt || message.text ? (
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words leading-relaxed">
                  {message.deletedAt ? "Message removed." : message.text}
                </p>
              ) : (
                <span className="flex-1" />
              )}
              <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] not-italic leading-none text-gray-300/80">
                {message.editedAt && !message.deletedAt ? (
                  <span>edited</span>
                ) : null}
                <time dateTime={new Date(message.createdAt).toISOString()}>
                  {time}
                </time>
              </span>
            </div>
          </>
        )}
      </div>

      {canMutate && !message.deletedAt && !isEditing ? (
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

      {!canMutate && !message.deletedAt && message.reactions.length > 0 ? (
        <div className="mt-1 flex max-w-[92%] flex-wrap items-center gap-1 px-1">
          {message.reactions.map((reaction) => (
            <span
              key={reaction.emoji}
              className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-300"
              title={reaction.actors.map((actor) => actor.name).join(", ")}
            >
              {reaction.emoji} {reaction.actors.length}
            </span>
          ))}
        </div>
      ) : null}

      {canMutate && showReactions && !message.deletedAt ? (
        <div
          className="mt-1 grid max-w-[16rem] grid-cols-6 gap-1 rounded-lg bg-gray-800 p-2"
          aria-label="Reactions"
        >
          {chat.context.reactionEmojis.map((emoji) => (
            <Button
              key={emoji}
              variant="tertiary"
              className="px-1.5 py-1 text-base max-md:!min-h-9"
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

const ChatWindow = ({
  onOpenFullPage,
}: {
  onOpenFullPage?: () => void;
}) => {
  const chat = useChat();
  const [draft, setDraft] = useState("");
  const [showComposerEmojis, setShowComposerEmojis] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState("");
  const [imageError, setImageError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const updateTypingDraft = chat?.updateTypingDraft;

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
  const canGoEarlier = Boolean(
    chat?.context && minDay && chat.selectedDayKey > minDay,
  );
  const canGoLater = Boolean(chat?.context && !isToday);
  const dayLabel =
    chat?.context && chat.selectedDayKey
      ? formatChatDayLabel(
        chat.selectedDayKey,
        chat.context.todayKey,
        chat.context.timeZone,
      )
      : "";

  useEffect(() => {
    if (isToday) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [chat?.messages.length, chat?.typingUsers.length, isToday]);

  useEffect(
    () => () => {
      updateTypingDraft?.(false);
    },
    [updateTypingDraft],
  );

  useEffect(() => {
    if (!selectedImage) {
      setSelectedImageUrl("");
      return undefined;
    }
    const url = URL.createObjectURL(selectedImage);
    setSelectedImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedImage]);

  if (!chat?.context) {
    const blockingError = chat?.error
      ? operatorFacingError(chat.error, false)
      : "";
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-gray-900 p-6 text-center text-sm text-gray-300">
        <p>{blockingError || "Connecting to team chat…"}</p>
        {blockingError && chat ? (
          <Button variant="secondary" onClick={chat.retry}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  }

  const submit = async () => {
    if ((!draft.trim() && !selectedImage) || draft.length > MAX_MESSAGE_LENGTH)
      return;
    const sent = await chat.sendMessage(draft, selectedImage || undefined);
    if (sent) {
      setDraft("");
      setSelectedImage(null);
      setImageError("");
      setShowComposerEmojis(false);
    }
  };

  const chooseImage = (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setImageError("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setImageError("Images must be 10 MB or smaller.");
      return;
    }
    setImageError("");
    setSelectedImage(file);
  };

  const updateDraft = (value: string) => {
    setDraft(value);
    chat.updateTypingDraft(Boolean(value.trim()));
  };

  const goToDay = (dayKey: string) => {
    void chat.selectDay(dayKey);
    setMenuOpen(false);
  };

  const bannerError = chat.error
    ? operatorFacingError(chat.error, true)
    : "";

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-900 text-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-700 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{dayLabel}</p>
          <p className="truncate text-[11px] text-gray-400">
            {isToday ? "Team messages" : "History · read-only"}
          </p>
        </div>
        <span
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            chat.connectionStatus === "connected"
              ? "bg-emerald-400"
              : "bg-amber-400",
          )}
          title={
            chat.connectionStatus === "connected"
              ? "Live updates connected"
              : "Reconnecting to live updates. You can still send."
          }
          aria-label={
            chat.connectionStatus === "connected"
              ? "Live updates connected"
              : "Reconnecting to live updates. You can still send."
          }
        />
        <PopOver
          open={menuOpen}
          onOpenChange={setMenuOpen}
          align="end"
          portal={false}
          contentClassName="w-64"
          bodyClassName="px-3 pb-3 pt-0"
          headerRowClassName="pr-1 pt-1"
          TriggeringButton={
            <Button
              variant="tertiary"
              svg={MoreVertical}
              iconSize="sm"
              className="max-md:!min-h-9 max-md:!min-w-9"
              aria-label="Chat options"
              aria-expanded={menuOpen}
            />
          }
        >
          <div className="flex flex-col gap-3">
            {onOpenFullPage ? (
              <Button
                variant="secondary"
                svg={Expand}
                iconSize="sm"
                className="w-full justify-center text-sm"
                onClick={onOpenFullPage}
              >
                Open full chat
              </Button>
            ) : null}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Day
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="tertiary"
                  svg={ChevronLeft}
                  iconSize="sm"
                  className="max-md:!min-h-9 max-md:!min-w-9"
                  disabled={!canGoEarlier || chat.isLoading}
                  aria-label="Earlier day"
                  onClick={() =>
                    goToDay(shiftDayKey(chat.selectedDayKey, -1))
                  }
                />
                <span className="min-w-0 flex-1 truncate text-center text-sm text-white">
                  {dayLabel}
                </span>
                <Button
                  variant="tertiary"
                  svg={ChevronRight}
                  iconSize="sm"
                  className="max-md:!min-h-9 max-md:!min-w-9"
                  disabled={!canGoLater || chat.isLoading}
                  aria-label="Later day"
                  onClick={() => goToDay(shiftDayKey(chat.selectedDayKey, 1))}
                />
              </div>
              {!isToday ? (
                <Button
                  variant="secondary"
                  className="mt-2 w-full justify-center text-sm"
                  onClick={() => goToDay(chat.context!.todayKey)}
                >
                  Back to today
                </Button>
              ) : null}
            </div>
            <Input
              type="date"
              label="Jump to day"
              value={chat.selectedDayKey}
              min={minDay}
              max={chat.context.todayKey}
              inputClassName="bg-gray-900"
              onChange={(value) => goToDay(String(value))}
            />
            <p className="text-[11px] text-gray-400">
              Earlier days are read-only. Choose today to send.
            </p>
          </div>
        </PopOver>
      </div>

      {bannerError ? (
        <div
          className="m-3 flex shrink-0 items-start gap-2 rounded-lg border border-amber-500/60 bg-amber-950/50 p-2 text-xs text-amber-100"
          role="alert"
        >
          <p className="min-w-0 flex-1">{bannerError}</p>
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
        className="scrollbar-variable flex min-h-0 flex-1 flex-col overflow-y-auto bg-gray-900 px-3 py-2"
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
        {chat.messages.map((message, index) => {
          const group = getChatMessageGroupPosition(chat.messages, index);
          return (
            <ChatMessageRow
              key={message.messageId}
              message={message}
              canMutate={isToday}
              startsGroup={group.startsGroup}
              endsGroup={group.endsGroup}
            />
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-gray-700 bg-gray-800 p-2">
        {isToday ? (
          <>
            {chat.typingUsers.length ? (
              <div
                className="mb-1.5 flex min-h-5 items-center gap-1.5 px-2 text-xs text-cyan-300"
                role="status"
                aria-label={typingLabel(
                  chat.typingUsers.map((typer) => typer.name),
                )}
              >
                <span>
                  {typingLabel(chat.typingUsers.map((typer) => typer.name))}
                </span>
                <span className="flex items-center gap-0.5" aria-hidden="true">
                  <span className="size-1 animate-pulse rounded-full bg-cyan-300" />
                  <span className="size-1 animate-pulse rounded-full bg-cyan-300 [animation-delay:150ms]" />
                  <span className="size-1 animate-pulse rounded-full bg-cyan-300 [animation-delay:300ms]" />
                </span>
              </div>
            ) : null}
            {selectedImage && selectedImageUrl ? (
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-gray-900 p-2">
                <img
                  src={selectedImageUrl}
                  alt="Selected attachment"
                  className="size-14 rounded-md object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-gray-200">
                    {selectedImage.name}
                  </p>
                  {chat.imageUploadProgress != null ? (
                    <div className="mt-1" role="status">
                      <div className="h-1.5 overflow-hidden rounded-full bg-gray-700">
                        <div
                          className="h-full rounded-full bg-cyan-400 transition-[width]"
                          style={{ width: `${chat.imageUploadProgress}%` }}
                        />
                      </div>
                      <span className="mt-0.5 block text-[10px] text-gray-400">
                        Uploading photo… {chat.imageUploadProgress}%
                      </span>
                    </div>
                  ) : null}
                </div>
                <Button
                  variant="tertiary"
                  svg={X}
                  iconSize="sm"
                  className="rounded-full max-md:!min-h-9 max-md:!min-w-9"
                  disabled={chat.isSending}
                  aria-label="Remove selected photo"
                  onClick={() => setSelectedImage(null)}
                />
              </div>
            ) : null}
            {imageError ? (
              <p className="mb-1.5 px-2 text-xs text-amber-200" role="alert">
                {imageError}
              </p>
            ) : null}
            {showComposerEmojis ? (
              <div
                className="mb-2 grid max-h-36 grid-cols-7 gap-1 overflow-y-auto rounded-lg bg-gray-900 p-2"
                aria-label="Message emojis"
              >
                {chat.context.reactionEmojis.map((emoji) => (
                  <Button
                    key={emoji}
                    variant="tertiary"
                    className="px-1.5 py-1 text-base max-md:!min-h-9"
                    aria-label={`Add ${emoji} to message`}
                    onClick={() => updateDraft(`${draft}${emoji}`)}
                  >
                    {emoji}
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <div className="flex min-w-0 flex-1 items-end rounded-xl bg-gray-900 px-1">
                {chat.context.imageUploadsEnabled ? (
                  <>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      aria-label="Choose a photo"
                      onChange={(event) => {
                        chooseImage(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                    <Button
                      variant="none"
                      svg={ImagePlus}
                      iconSize="md"
                      color="#cbd5e1"
                      className="mb-0.5 shrink-0 rounded-full p-2 max-md:!min-h-10 max-md:!min-w-10"
                      disabled={chat.isSending}
                      aria-label="Add a photo"
                      onClick={() => imageInputRef.current?.click()}
                    />
                  </>
                ) : null}
                <Button
                  variant="none"
                  svg={SmilePlus}
                  iconSize="md"
                  color="#cbd5e1"
                  className="mb-0.5 shrink-0 rounded-full p-2 max-md:!min-h-10 max-md:!min-w-10"
                  aria-label="Add an emoji"
                  onClick={() =>
                    setShowComposerEmojis((current) => !current)
                  }
                />
                <TextArea
                  label="Message"
                  hideLabel
                  value={draft}
                  onChange={updateDraft}
                  placeholder="Message"
                  maxLength={MAX_MESSAGE_LENGTH}
                  autoResize
                  rows={1}
                  className="min-w-0 flex-1"
                  textareaClassName="max-h-28 min-h-0 border-0 bg-transparent px-2 py-2.5 leading-5 shadow-none focus-visible:ring-0"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                />
              </div>
              <Button
                variant="none"
                svg={Send}
                iconSize="md"
                color="#082f49"
                padding="p-0"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-cyan-400 hover:bg-cyan-300 max-md:!min-h-11 max-md:!min-w-11"
                isLoading={chat.isSending}
                disabled={
                  (!draft.trim() && !selectedImage) ||
                  draft.length > MAX_MESSAGE_LENGTH ||
                  chat.isSending
                }
                aria-label="Send message"
                onClick={() => void submit()}
              />
            </div>
            {draft.length >= 900 ? (
              <p className="mt-1 pr-14 text-right text-[11px] text-gray-400">
                {draft.length}/{MAX_MESSAGE_LENGTH}
              </p>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-1">
            <p className="text-center text-sm text-gray-400">
              History is read-only.
            </p>
            <Button
              variant="secondary"
              className="text-sm"
              onClick={() => goToDay(chat.context!.todayKey)}
            >
              Back to today
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatWindow;
