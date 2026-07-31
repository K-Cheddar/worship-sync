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
  showToast: (message: string, variant: "success" | "error") => void;
  userId: string;
  pullFromRemote?: () => void | Promise<void>;
};

export const BoardDiscussionPostComposer = ({
  aliasId,
  showToast,
  userId,
  pullFromRemote,
}: BoardDiscussionPostComposerProps) => {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const authorId = useMemo(
    () => buildWorshipSyncModeratorBoardPostAuthorId(userId),
    [userId],
  );

  useEffect(() => {
    if (!expanded) return;
    textareaRef.current?.focus();
  }, [expanded]);

  const collapse = useCallback(() => {
    setExpanded(false);
  }, []);

  const handlePost = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !aliasId || busy) return;
    if (trimmed.length > BOARD_POST_MAX_LENGTH) {
      showToast(
        `Message is too long (max ${BOARD_POST_MAX_LENGTH} characters).`,
        "error",
      );
      return;
    }
    setBusy(true);
    try {
      await createBoardPost(aliasId, {
        author: MODERATOR_DISCUSSION_BOARD_AUTHOR,
        authorId,
        text: trimmed,
      });
      setText("");
      setExpanded(false);
      await Promise.resolve(pullFromRemote?.());
      showToast("Message posted to the discussion board.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Could not post to the discussion board.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }, [aliasId, authorId, busy, text, showToast, pullFromRemote]);

  if (!expanded) {
    return (
      <div className="sticky bottom-0 z-10 shrink-0">
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
      </div>
    );
  }

  return (
    <div
      className="sticky bottom-0 z-10 shrink-0 rounded-xl border border-gray-600 bg-gray-900/95 p-3 shadow-[0_-12px_24px_-12px_rgba(0,0,0,0.45)] backdrop-blur-sm"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          collapse();
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-200">
          Add to discussion board
        </p>
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
      <TextArea
        ref={textareaRef}
        label="Add to discussion board"
        hideLabel
        labelClassName="text-xs font-semibold text-gray-200"
        value={text}
        onChange={(value) => setText(value)}
        rows={2}
        maxLength={BOARD_POST_MAX_LENGTH}
        placeholder="Visible to attendees in this board session…"
        disabled={busy}
        textareaClassName={cn(
          "min-h-[4.5rem] resize-y rounded-lg border-gray-600 bg-gray-900/80 px-3 py-2 text-sm text-gray-100 shadow-none placeholder:text-gray-500",
          "focus-visible:border-cyan-500/40 focus-visible:ring-1 focus-visible:ring-cyan-500/30",
        )}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
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
      </div>
    </div>
  );
};
