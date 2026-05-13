import { useCallback, useMemo, useState } from "react";
import cn from "classnames";
import { Send } from "lucide-react";
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
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const authorId = useMemo(
    () => buildWorshipSyncModeratorBoardPostAuthorId(userId),
    [userId],
  );

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

  return (
    <div className="sticky bottom-0 z-10 shrink-0 rounded-xl border border-gray-600 bg-gray-900/95 p-3 shadow-[0_-12px_24px_-12px_rgba(0,0,0,0.45)] backdrop-blur-sm">
      <TextArea
        label="Add to discussion board"
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
