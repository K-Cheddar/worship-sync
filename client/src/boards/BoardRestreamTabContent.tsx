import { useCallback, useEffect, useMemo, useState } from "react";
import cn from "classnames";
import { LoaderCircle, Sparkles, StarOff } from "lucide-react";
import Button from "../components/Button/Button";
import { useStickToBottomScroll } from "../hooks/useStickToBottomScroll";
import { updateRestreamMessageHighlighted } from "./api";
import { BoardModeratorReplyBadge } from "./BoardModeratorReplyBadge";
import { BoardPostMessage } from "./BoardPostMessage";
import { formatBoardTimestamp, getBoardAuthorNameColorClass } from "./boardUtils";
import type { RestreamMessage } from "../types";
import type { UseRestreamSessionResult } from "./useRestreamSession";

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

export type RestreamTabContentProps = {
  churchId: string;
  showToast: (message: string, variant: "success" | "error") => void;
  restreamSession: UseRestreamSessionResult;
};

export const RestreamTabContent = ({
  churchId,
  showToast,
  restreamSession,
}: RestreamTabContentProps) => {
  const {
    session,
    messages,
    isLoading,
    error,
    oauthConfigured,
    reload,
  } = restreamSession;
  const [localMessages, setLocalMessages] = useState<RestreamMessage[]>([]);
  const [actingIds, setActingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLocalMessages(filterRestreamMessagesForDisplay(messages));
  }, [messages]);

  const displayMessages = useMemo(() => {
    return [...localMessages].sort((a, b) => {
      const at = a.postedAt ?? 0;
      const bt = b.postedAt ?? 0;
      if (at !== bt) return at - bt;
      return String(a.id).localeCompare(String(b.id));
    });
  }, [localMessages]);

  const restreamScrollTrigger = useMemo(
    () =>
      displayMessages
        .map((m) => `${m.id}:${m.isHighlighted ? 1 : 0}:${m.hidden ? 1 : 0}`)
        .join("|"),
    [displayMessages],
  );

  const restreamScrollResetKey = `${churchId}:${session?.sessionId ?? ""}`;

  const {
    scrollRef: restreamScrollRef,
    endRef: restreamEndRef,
    onScroll: onRestreamScroll,
  } = useStickToBottomScroll({
    scrollTrigger: restreamScrollTrigger,
    resetKey: restreamScrollResetKey,
  });

  const runMessageAction = useCallback(
    async (
      messageId: string,
      optimisticFn: (message: RestreamMessage) => RestreamMessage,
      request: () => Promise<unknown>,
    ) => {
      setActingIds((prev) => new Set(prev).add(messageId));
      setLocalMessages((prev) =>
        prev.map((message) =>
          message.id === messageId ? optimisticFn(message) : message,
        ),
      );
      try {
        await request();
      } catch (nextError) {
        await reload();
        showToast(
          nextError instanceof Error
            ? nextError.message
            : "Could not update the Restream message.",
          "error",
        );
      } finally {
        setActingIds((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }
    },
    [reload, showToast],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="shrink-0 space-y-2">
        {session?.streamTitle ? (
          <p className="text-sm text-gray-200">
            Stream name:{" "}
            <span className="font-semibold text-white">{session.streamTitle}</span>
          </p>
        ) : null}
        {!oauthConfigured ? (
          <p className="text-xs text-amber-100/90">
            Restream is not configured yet.
          </p>
        ) : null}
        {session?.connectionIssues?.length ? (
          <div className="rounded-lg border border-amber-300/20 bg-amber-950/20 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-100/90">
              Connection issues
            </p>
            <div className="mt-2 space-y-1 text-xs text-amber-100/90">
              {session.connectionIssues.map((issue) => (
                <p key={issue}>{issue}</p>
              ))}
            </div>
          </div>
        ) : null}
        {session?.lastError ? (
          <p className="text-xs text-amber-100/90">{session.lastError}</p>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex shrink-0 items-center gap-2 text-gray-300">
          <LoaderCircle className="animate-spin" size={18} />
          Loading Restream messages…
        </div>
      ) : error ? (
        <div className="shrink-0 rounded-xl border border-red-300/25 bg-red-950/20 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : !session?.enabled ? (
        <div className="shrink-0 rounded-xl border border-dashed border-gray-500 bg-gray-800/50 p-6 text-center">
          <p className="text-lg font-semibold">Restream is not connected.</p>
          <p className="mt-2 text-sm text-gray-300">
            Ask a church admin to connect Restream in Church administration under Integrations.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <div
            ref={restreamScrollRef}
            onScroll={onRestreamScroll}
            className="scrollbar-variable flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
          >
            {displayMessages.length === 0 ? (
              <div className="flex min-h-full flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-gray-500 bg-gray-800/50 p-6 text-center">
                <p className="text-lg font-semibold">No Restream messages yet.</p>
                <p className="mt-2 text-sm text-gray-300">
                  New live comments will appear here as this server receives them.
                </p>
              </div>
            ) : (
              <div className="space-y-3 pr-0.5 pb-1">
                {displayMessages.map((message) => {
                  const isModeratorReply = message.kind === "moderator_reply";
                  return (
                    <article
                      key={message.id}
                      className={cn(
                        "rounded-xl border p-4",
                        message.hidden &&
                        "border-gray-600 bg-gray-800/60 opacity-75",
                        !message.hidden &&
                        !isModeratorReply &&
                        "border-gray-500 bg-gray-800/90",
                        isModeratorReply && "border-amber-500/20 bg-gray-800/90",
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "font-semibold",
                              message.hidden
                                ? "text-gray-400"
                                : getBoardAuthorNameColorClass(message),
                            )}
                          >
                            {message.author}
                          </span>
                          {isModeratorReply ? (
                            <BoardModeratorReplyBadge />
                          ) : (
                            <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-xs font-semibold text-cyan-100">
                              Restream · {message.platform}
                            </span>
                          )}
                          <span className="text-xs text-gray-300">
                            {formatBoardTimestamp(message.postedAt)}
                          </span>
                          {message.isHighlighted ? (
                            <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-semibold text-amber-200">
                              Highlighted
                            </span>
                          ) : null}
                          {message.hidden ? (
                            <span className="rounded-full bg-gray-600 px-2 py-0.5 text-xs font-semibold text-gray-100">
                              Hidden
                            </span>
                          ) : null}
                          {isModeratorReply &&
                            message.replyDeliveryStatus === "sending" ? (
                            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-semibold text-sky-100">
                              Sending…
                            </span>
                          ) : null}
                          {isModeratorReply &&
                            message.replyDeliveryStatus === "sent" ? (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-100">
                              Sent
                            </span>
                          ) : null}
                          {isModeratorReply &&
                            message.replyDeliveryStatus === "failed" ? (
                            <span
                              className="max-w-full rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-100"
                              title={
                                message.replyFailureReason
                                  ? formatRestreamReplyFailureReason(
                                    message.replyFailureReason,
                                  )
                                  : undefined
                              }
                            >
                              Failed
                            </span>
                          ) : null}
                        </div>
                        {!isModeratorReply ? (
                          <div className="flex shrink-0 gap-2">
                            <Button
                              variant="tertiary"
                              svg={message.isHighlighted ? StarOff : Sparkles}
                              onClick={() =>
                                void runMessageAction(
                                  message.id,
                                  (current) => ({
                                    ...current,
                                    isHighlighted: !current.isHighlighted,
                                  }),
                                  () =>
                                    updateRestreamMessageHighlighted(
                                      churchId,
                                      message.id,
                                      !message.isHighlighted,
                                    ),
                                )
                              }
                              disabled={
                                actingIds.has(message.id) || message.hidden
                              }
                            >
                              {message.isHighlighted ? "Unhighlight" : "Highlight"}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      {isModeratorReply &&
                        message.replyDeliveryStatus === "failed" &&
                        message.replyFailureReason ? (
                        <p className="mt-2 text-xs text-red-100/90">
                          {formatRestreamReplyFailureReason(
                            message.replyFailureReason,
                          )}
                        </p>
                      ) : null}
                      <div className="mt-3 min-w-0">
                        <BoardPostMessage
                          text={message.text}
                          isMine={false}
                          tone="moderator"
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            <div
              ref={restreamEndRef}
              className="h-px shrink-0"
              aria-hidden
            />
          </div>
        </div>
      )}
    </div>
  );
};
