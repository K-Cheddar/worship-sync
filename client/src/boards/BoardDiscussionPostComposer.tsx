import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cn from "classnames";
import { MessageSquarePlus, Send, X } from "lucide-react";
import Button from "../components/Button/Button";
import TextArea from "../components/TextArea/TextArea";
import { createBoardPost } from "./api";
import {
  BOARD_POST_MAX_LENGTH,
  buildWorshipSyncModeratorBoardPostAuthorId,
} from "./boardUtils";

/** Shown on discussion posts sent from the board controller (not the signed-in display name). */
const MODERATOR_DISCUSSION_BOARD_AUTHOR = "Moderator";

export type BoardDiscussionPostComposerProps = {
  aliasId: string;
  boardSessionId?: string;
  showToast: (message: string, variant: "success" | "error") => void;
  userId: string;
  pullFromRemote?: () => void | Promise<void>;
  dockMode?: boolean;
  dockOpen?: boolean;
  onDockClose?: () => void;
};

export const BoardDiscussionPostComposer = ({
  aliasId,
  boardSessionId = "",
  showToast,
  userId,
  pullFromRemote,
  dockMode = false,
  dockOpen = false,
  onDockClose,
}: BoardDiscussionPostComposerProps) => {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sendInFlightRef = useRef(false);
  const authorId = useMemo(
    () => buildWorshipSyncModeratorBoardPostAuthorId(userId),
    [userId],
  );

  useEffect(() => {
    if (!(dockMode ? dockOpen : expanded)) return;
    textareaRef.current?.focus();
  }, [expanded, dockMode, dockOpen]);

  const collapse = useCallback(() => {
    if (dockMode) onDockClose?.();
    else setExpanded(false);
  }, [dockMode, onDockClose]);

  const handlePost = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !aliasId || sendInFlightRef.current || busy) return;
    if (trimmed.length > BOARD_POST_MAX_LENGTH) {
      showToast(
        `Message is too long (max ${BOARD_POST_MAX_LENGTH} characters).`,
        "error",
      );
      return;
    }
    sendInFlightRef.current = true;
    setBusy(true);
    setErrorMessage("");
    try {
      await createBoardPost(aliasId, {
        author: MODERATOR_DISCUSSION_BOARD_AUTHOR,
        authorId,
        text: trimmed,
        ...(boardSessionId ? { expectedBoardId: boardSessionId } : {}),
      });
      setText("");
      if (dockMode) onDockClose?.();
      else setExpanded(false);
      showToast("Message posted to the discussion board.", "success");
      try {
        await Promise.resolve(pullFromRemote?.());
      } catch {
        showToast("Message posted, but the feed could not refresh.", "error");
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Could not post to the discussion board.";
      setErrorMessage(message);
      showToast(message, "error");
    } finally {
      sendInFlightRef.current = false;
      setBusy(false);
    }
  }, [aliasId, authorId, boardSessionId, busy, text, showToast, pullFromRemote, dockMode, onDockClose]);

  const isExpanded = dockMode ? dockOpen : expanded;

  if (!dockMode && !isExpanded) {
    return (
      <Button
        variant="tertiary"
        svg={MessageSquarePlus}
        className="w-full justify-start rounded-xl border border-gray-600 bg-gray-900/95 px-3 py-2.5 text-left shadow-[0_-12px_24px_-12px_rgba(0,0,0,0.45)] backdrop-blur-sm"
        onClick={() => setExpanded(true)}
        disabled={!aliasId}
      >
        {text.trim()
          ? "Continue drafting…"
          : "Add to discussion board"}
      </Button>
    );
  }

  return (
    <div
      className="rounded-lg border border-gray-600 bg-gray-900/95 p-2 shadow-none"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          collapse();
        }
      }}
    >
      {!dockMode ? (
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-gray-200">Add to discussion board</p>
          <Button
            variant="tertiary"
            svg={X}
            padding="p-1.5"
            className="min-h-0!"
            aria-label="Close composer"
            onClick={collapse}
            disabled={busy}
          />
        </div>
      ) : null}
      <div className="flex min-w-0 items-end gap-1.5">
        <TextArea
          className="min-w-0 flex-1"
          ref={textareaRef}
          label="Add to discussion board"
          hideLabel
          value={text}
          onChange={(value) => setText(value)}
          rows={2}
          maxLength={BOARD_POST_MAX_LENGTH}
          placeholder="Write a message for this board session…"
          disabled={busy}
          autoResize
          textareaClassName={cn(
            "min-h-9 max-h-28 min-w-0 flex-1 resize-none overflow-y-auto rounded-lg border-gray-600 bg-gray-900/80 px-3 py-2 text-sm text-gray-100 shadow-none placeholder:text-gray-500",
            "focus-visible:border-cyan-500/40 focus-visible:ring-1 focus-visible:ring-cyan-500/30",
          )}
        />
        {dockMode ? (
          <>
            <div className="flex shrink-0 flex-col items-center gap-1">
              <span className="whitespace-nowrap text-[10px] leading-3 text-gray-400">
                {text.length}/{BOARD_POST_MAX_LENGTH}
              </span>
              <Button
                variant="cta"
                svg={Send}
                iconSize="sm"
                aria-label="Send to discussion board"
                style={{ minHeight: 36 }}
                className="relative min-h-9 max-md:min-h-[36px] shrink-0 px-2 py-1 text-xs after:absolute after:-inset-y-1 after:content-['']"
                isLoading={busy}
                onClick={() => void handlePost()}
                disabled={busy || !text.trim() || !aliasId}
              >
                {busy ? "Sending…" : "Send"}
              </Button>
            </div>
          </>
        ) : null}
      </div>
      {dockMode ? (
        errorMessage ? <p className="mt-1 text-[11px] leading-4 text-amber-200" role="alert">{errorMessage}</p> : null
      ) : null}
      {errorMessage && !dockMode ? <p role="alert" className="mt-1 text-xs text-amber-200">{errorMessage} Try sending again.</p> : null}
      {!dockMode ? <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-400">
          {text.length}/{BOARD_POST_MAX_LENGTH}
        </p>
        <Button
          variant="cta"
          svg={Send}
          onClick={() => void handlePost()}
          disabled={busy || !text.trim() || !aliasId}
        >
          Send
        </Button>
      </div> : null}
    </div>
  );
};
