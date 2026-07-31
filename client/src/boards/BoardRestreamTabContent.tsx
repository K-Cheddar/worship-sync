import { useCallback, useEffect, useState } from "react";
import cn from "classnames";
import { Sparkles, StarOff } from "lucide-react";
import Button from "../components/Button/Button";
import { updateRestreamMessageHighlighted } from "./api";
import { BoardActivitySourceBadge } from "./BoardActivitySourceBadge";
import { BoardPostMessage } from "./BoardPostMessage";
import { formatBoardTimestamp, getBoardAuthorNameColorClass } from "./boardUtils";
import type { RestreamMessage } from "../types";

/** Legacy rows from earlier Restream reply lifecycle handling; no longer stored server-side. */
const isLegacyModeratorPipelineRow = (message: RestreamMessage) => {
  if (message.kind !== "moderator_reply") return false;
  const t = message.text.trim();
  return (
    t === "Reply accepted for delivery." ||
    t === "Reply delivered." ||
    /^reply failed:/i.test(t)
  );
};

export const filterRestreamMessagesForDisplay = (messages: RestreamMessage[]) =>
  messages.filter((message) => !isLegacyModeratorPipelineRow(message));

const formatRestreamReplyFailureReason = (reason: string) => {
  const key = String(reason || "").trim().toLowerCase();
  const hints: Record<string, string> = {
    connection_not_established_yet:
      "That chat connection is still starting. Try again in a few seconds.",
    facebook_event_not_live:
      "Facebook needs a live event before comments can go through.",
    connection_in_error_state:
      "That destination has a connection error. Fix it in Restream, then try again.",
    discord_rate_limit:
      "Discord rate limited this message. Wait a moment, then try again.",
    dlive_api_send_message_rate_limit:
      "DLive rate limited this message. Wait a moment, then try again.",
    internal: "Restream could not deliver this message. Try again once.",
  };
  return hints[key] || reason;
};

export type RestreamActivityCardProps = {
  churchId: string;
  message: RestreamMessage;
  showToast: (message: string, variant: "success" | "error") => void;
  reload: () => void | Promise<void>;
};

/** A single Restream row, reusable in the unified live activity feed. */
export const RestreamActivityCard = ({
  churchId,
  message,
  showToast,
  reload,
}: RestreamActivityCardProps) => {
  const [localMessage, setLocalMessage] = useState(message);
  const [isActing, setIsActing] = useState(false);

  useEffect(() => {
    setLocalMessage(message);
  }, [message]);

  const handleHighlight = useCallback(async () => {
    if (isActing || localMessage.kind === "moderator_reply") return;
    const nextHighlighted = !localMessage.isHighlighted;
    setIsActing(true);
    setLocalMessage((current) => ({
      ...current,
      isHighlighted: nextHighlighted,
    }));
    try {
      await updateRestreamMessageHighlighted(
        churchId,
        localMessage.id,
        nextHighlighted,
      );
    } catch (nextError) {
      await reload();
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Could not update the Restream message.",
        "error",
      );
    } finally {
      setIsActing(false);
    }
  }, [churchId, isActing, localMessage, reload, showToast]);

  const isModeratorReply = localMessage.kind === "moderator_reply";

  return (
    <article
      aria-label={
        isModeratorReply
          ? "Moderator Restream reply"
          : `Restream · ${localMessage.platform}`
      }
      className={cn(
        "relative rounded-lg border px-3 py-2.5",
        localMessage.hidden && "border-gray-600 bg-gray-800/60 opacity-75",
        !localMessage.hidden && "border-gray-500 bg-gray-800/90",
      )}
    >
      <BoardActivitySourceBadge
        kind={isModeratorReply ? "moderator" : "restream"}
        detail={isModeratorReply ? undefined : localMessage.platform}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "text-sm font-semibold",
              localMessage.hidden
                ? "text-gray-400"
                : getBoardAuthorNameColorClass(localMessage),
            )}
          >
            {localMessage.author}
          </span>
          <span className="text-[11px] text-gray-300">
            {formatBoardTimestamp(localMessage.postedAt)}
          </span>
          {localMessage.isHighlighted ? (
            <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[11px] font-semibold text-amber-200">
              Highlighted
            </span>
          ) : null}
          {localMessage.hidden ? (
            <span className="rounded-full bg-gray-600 px-1.5 py-0.5 text-[11px] font-semibold text-gray-100">
              Hidden
            </span>
          ) : null}
          {isModeratorReply &&
            localMessage.replyDeliveryStatus === "sending" ? (
            <span className="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-sky-100">
              Sending…
            </span>
          ) : null}
          {isModeratorReply && localMessage.replyDeliveryStatus === "sent" ? (
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-100">
              Sent
            </span>
          ) : null}
          {isModeratorReply && localMessage.replyDeliveryStatus === "failed" ? (
            <span
              className="max-w-full rounded-full bg-red-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-red-100"
              title={
                localMessage.replyFailureReason
                  ? formatRestreamReplyFailureReason(
                    localMessage.replyFailureReason,
                  )
                  : undefined
              }
            >
              Failed
            </span>
          ) : null}
        </div>
        {!isModeratorReply ? (
          <div className="flex shrink-0 gap-1.5">
            <Button
              variant="tertiary"
              svg={localMessage.isHighlighted ? StarOff : Sparkles}
              onClick={() => void handleHighlight()}
              disabled={isActing || localMessage.hidden}
            >
              {localMessage.isHighlighted ? "Unhighlight" : "Highlight"}
            </Button>
          </div>
        ) : null}
      </div>
      {isModeratorReply &&
        localMessage.replyDeliveryStatus === "failed" &&
        localMessage.replyFailureReason ? (
        <p className="mt-1.5 text-[11px] text-red-100/90">
          {formatRestreamReplyFailureReason(localMessage.replyFailureReason)}
        </p>
      ) : null}
      <div className="min-w-0">
        <BoardPostMessage
          text={localMessage.text}
          isMine={false}
          tone="moderator"
        />
      </div>
    </article>
  );
};
