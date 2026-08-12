import { useEffect, useMemo, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import Button from "../../components/Button/Button";
import {
  filterRestreamMessagesForDisplay,
  RestreamActivityCard,
} from "../../boards/BoardRestreamTabContent";
import { BoardYouTubeChatComposer } from "../../boards/BoardYouTubeChatComposer";
import { useRestreamSession } from "../../boards/useRestreamSession";
import { useStickToBottomScroll } from "../../hooks/useStickToBottomScroll";
import type { RestreamMessage, RestreamSession } from "../../types";

type CurrentServiceRestreamPanelProps = {
  churchId: string;
  youtubeConnected: boolean;
  youtubeAccountLabel?: string;
  isVisible?: boolean;
  onUnreadCountChange?: (count: number) => void;
  showToast: (message: string, variant: "success" | "error") => void;
};

type ChatReadMarker = {
  churchId: string;
  sessionId: string;
  receivedAt: number;
  messageId: string;
};

type StoredChatReadMarker = Partial<ChatReadMarker> & {
  messageIds?: unknown;
};

const getChatReadStorageKey = (churchId: string) =>
  `worshipsync:current-service-chat-read:v1:${churchId}`;

const getMessageReadTime = (message: RestreamMessage) =>
  Number.isFinite(message.receivedAt) ? message.receivedAt : message.postedAt;

const getLatestViewerMessage = (messages: RestreamMessage[]) =>
  messages.reduce<RestreamMessage | null>((latest, message) => {
    if (!latest) return message;

    const timeDifference =
      getMessageReadTime(message) - getMessageReadTime(latest);
    if (timeDifference !== 0) return timeDifference > 0 ? message : latest;

    return message.id.localeCompare(latest.id) > 0 ? message : latest;
  }, null);

const createReadMarker = (
  churchId: string,
  sessionId: string,
  message: RestreamMessage | null,
): ChatReadMarker => ({
  churchId,
  sessionId,
  receivedAt: message ? getMessageReadTime(message) : 0,
  messageId: message?.id ?? "",
});

const isMessageAfterMarker = (
  message: RestreamMessage,
  marker: ChatReadMarker,
) => {
  const timeDifference = getMessageReadTime(message) - marker.receivedAt;
  if (timeDifference !== 0) return timeDifference > 0;
  return message.id.localeCompare(marker.messageId) > 0;
};

const parseStoredReadMarker = (
  stored: string,
  churchId: string,
  sessionId: string,
  viewerMessages: RestreamMessage[],
): ChatReadMarker | null => {
  const parsed = JSON.parse(stored) as StoredChatReadMarker;
  if (parsed.churchId !== churchId || parsed.sessionId !== sessionId) {
    return null;
  }

  if (
    typeof parsed.receivedAt === "number" &&
    Number.isFinite(parsed.receivedAt) &&
    typeof parsed.messageId === "string"
  ) {
    return {
      churchId,
      sessionId,
      receivedAt: parsed.receivedAt,
      messageId: parsed.messageId,
    };
  }

  if (Array.isArray(parsed.messageIds)) {
    const legacyReadIds = new Set(
      parsed.messageIds.filter(
        (messageId): messageId is string => typeof messageId === "string",
      ),
    );
    const latestLegacyMessage = getLatestViewerMessage(
      viewerMessages.filter((message) => legacyReadIds.has(message.id)),
    );
    return latestLegacyMessage
      ? createReadMarker(churchId, sessionId, latestLegacyMessage)
      : null;
  }

  return null;
};

const getConnectionLabel = (
  session: RestreamSession | null,
  isLoading: boolean,
  isOffline: boolean,
) => {
  if (isOffline) return "Offline";
  if (isLoading) return "Loading";
  if (!session?.enabled) return "Not connected";
  if (session.connected) return "Connected";

  switch (session.connectionState) {
    case "connected":
      return "Waiting for chat";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    default:
      return "Disconnected";
  }
};

const getConnectionTone = (label: string) => {
  if (label === "Connected") {
    return "border-emerald-400/30 bg-emerald-500/15 text-emerald-100";
  }
  if (
    label === "Connecting" ||
    label === "Reconnecting" ||
    label === "Loading"
  ) {
    return "border-sky-400/30 bg-sky-500/15 text-sky-100";
  }
  return "border-amber-400/30 bg-amber-500/15 text-amber-100";
};

const CurrentServiceRestreamPanel = ({
  churchId,
  youtubeConnected,
  youtubeAccountLabel = "",
  isVisible = false,
  onUnreadCountChange,
  showToast,
}: CurrentServiceRestreamPanelProps) => {
  const restream = useRestreamSession(churchId);
  const readMarkerFallbackRef = useRef<ChatReadMarker | null>(null);
  const messages = useMemo(
    () =>
      filterRestreamMessagesForDisplay(restream.messages)
        .slice()
        .sort((a, b) => a.postedAt - b.postedAt || a.id.localeCompare(b.id)),
    [restream.messages],
  );
  const viewerMessages = useMemo(
    () => messages.filter((message) => message.kind === "viewer_message"),
    [messages],
  );
  const latestViewerMessage = useMemo(
    () => getLatestViewerMessage(viewerMessages),
    [viewerMessages],
  );
  const sessionId = restream.session?.sessionId;

  useEffect(() => {
    if (!churchId || !sessionId) {
      onUnreadCountChange?.(0);
      return;
    }

    let readMarker =
      readMarkerFallbackRef.current?.churchId === churchId &&
        readMarkerFallbackRef.current.sessionId === sessionId
        ? readMarkerFallbackRef.current
        : null;
    try {
      const stored = window.sessionStorage.getItem(
        getChatReadStorageKey(churchId),
      );
      if (stored) {
        const storedMarker = parseStoredReadMarker(
          stored,
          churchId,
          sessionId,
          viewerMessages,
        );
        if (storedMarker) {
          readMarker = storedMarker;
          readMarkerFallbackRef.current = storedMarker;
        }
      }
    } catch {
      // Session storage can be unavailable in privacy-restricted browsers.
    }

    if (!isVisible) {
      onUnreadCountChange?.(
        readMarker
          ? viewerMessages.filter((message) =>
            isMessageAfterMarker(message, readMarker),
          ).length
          : viewerMessages.length,
      );
      return;
    }

    readMarkerFallbackRef.current = createReadMarker(
      churchId,
      sessionId,
      latestViewerMessage,
    );
    onUnreadCountChange?.(0);
  }, [
    churchId,
    isVisible,
    latestViewerMessage,
    onUnreadCountChange,
    sessionId,
    viewerMessages,
  ]);

  useEffect(() => {
    if (!churchId || !sessionId || !isVisible) return;

    const persistReadMarker = () => {
      const marker = readMarkerFallbackRef.current;
      if (
        marker?.churchId !== churchId ||
        marker.sessionId !== sessionId
      ) {
        return;
      }

      try {
        window.sessionStorage.setItem(
          getChatReadStorageKey(churchId),
          JSON.stringify(marker),
        );
      } catch {
        // Keep the in-memory marker for this mounted workspace as a fallback.
      }
    };

    window.addEventListener("pagehide", persistReadMarker);
    return () => {
      window.removeEventListener("pagehide", persistReadMarker);
      persistReadMarker();
    };
  }, [churchId, isVisible, sessionId]);
  const scrollTrigger = useMemo(
    () =>
      messages
        .map(
          (message) =>
            `${message.id}:${message.isHighlighted ? 1 : 0}:${message.hidden ? 1 : 0}`,
        )
        .join("|"),
    [messages],
  );
  const { scrollRef, endRef, onScroll } = useStickToBottomScroll({
    scrollTrigger,
    // Jump to latest when opening the Chat tab; hidden panels lose scroll layout.
    resetKey: `${restream.session?.sessionId ?? churchId}:${isVisible ? "open" : "closed"}`,
  });
  const connectionLabel = getConnectionLabel(
    restream.session,
    restream.isLoading,
    restream.isOffline,
  );
  const showEmptyFeed =
    !restream.isLoading &&
    !restream.error &&
    Boolean(restream.session?.enabled) &&
    messages.length === 0;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/60">
      <div className="shrink-0 border-b border-gray-700 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">Restream chat</h2>
            <p className="mt-0.5 text-xs text-gray-300">
              Live messages and connection details.
            </p>
          </div>
          <span
            className={`rounded-full border px-2 py-1 text-xs font-semibold ${getConnectionTone(connectionLabel)}`}
          >
            {connectionLabel}
          </span>
        </div>

        {restream.session?.streamTitle ? (
          <p className="mt-2 truncate text-xs text-gray-300">
            Stream: <span className="font-semibold text-white">{restream.session.streamTitle}</span>
          </p>
        ) : null}
        {restream.session?.accountLabel ? (
          <p className="mt-1 truncate text-xs text-gray-300">
            Account: <span className="font-semibold text-white">{restream.session.accountLabel}</span>
          </p>
        ) : null}
        {restream.session?.platformSummary.length ? (
          <p className="mt-1 truncate text-xs text-gray-300">
            Sources: {restream.session.platformSummary.join(" \u00b7 ")}
          </p>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scrollbar-variable min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
        aria-label="Restream chat messages"
      >
        <div className="space-y-3">
          {restream.isOffline ? (
            <p className="rounded-lg border border-amber-300/20 bg-amber-950/20 p-3 text-xs text-amber-100/90">
              You are offline. Live messages will resume when this device reconnects.
            </p>
          ) : null}

          {restream.session?.connectionIssues?.length ? (
            <div className="rounded-lg border border-amber-300/20 bg-amber-950/20 p-3">
              <p className="text-xs font-semibold text-amber-100">Connection issues</p>
              <div className="mt-1.5 space-y-1 text-xs text-amber-100/90">
                {restream.session.connectionIssues.map((issue) => (
                  <p key={issue}>{issue}</p>
                ))}
              </div>
            </div>
          ) : null}

          {restream.session?.lastError ? (
            <p className="rounded-lg border border-amber-300/20 bg-amber-950/20 p-3 text-xs text-amber-100/90">
              {restream.session.lastError}
            </p>
          ) : null}

          {restream.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-300">
              <LoaderCircle className="animate-spin" size={18} aria-hidden="true" />
              Loading Restream chat…
            </div>
          ) : null}

          {restream.error ? (
            <div className="rounded-xl border border-red-300/25 bg-red-950/20 p-3 text-sm text-red-100">
              <p>{restream.error}</p>
              <Button
                variant="tertiary"
                className="mt-3"
                onClick={() => void restream.reload()}
              >
                Try again
              </Button>
            </div>
          ) : null}

          {!restream.isLoading && !restream.error && !restream.oauthConfigured ? (
            <div className="rounded-xl border border-dashed border-gray-500 bg-gray-800/50 p-4 text-sm">
              <p className="font-semibold">Restream is not configured.</p>
              <p className="mt-1 text-gray-300">
                Ask a church admin to configure Restream, then connect the church account.
              </p>
            </div>
          ) : null}

          {!restream.isLoading &&
            !restream.error &&
            restream.oauthConfigured &&
            !restream.session?.enabled ? (
            <div className="rounded-xl border border-dashed border-gray-500 bg-gray-800/50 p-4 text-sm">
              <p className="font-semibold">Restream is not connected.</p>
              <p className="mt-1 text-gray-300">
                Ask a church admin to connect Restream under Church administration and Integrations.
              </p>
            </div>
          ) : null}

          {showEmptyFeed ? (
            <div className="rounded-xl border border-dashed border-gray-500 bg-gray-800/50 p-5 text-center">
              <p className="font-semibold">No Restream messages yet.</p>
              <p className="mt-1 text-sm text-gray-300">
                Messages will appear here when the live chat starts.
              </p>
            </div>
          ) : null}

          {messages.length ? (
            <div className="space-y-2 px-7">
              {messages.map((message) => (
                <RestreamActivityCard
                  key={message.id}
                  churchId={churchId}
                  message={message}
                  showToast={showToast}
                  reload={restream.reload}
                />
              ))}
            </div>
          ) : null}
          <div ref={endRef} className="h-px" aria-hidden="true" />
        </div>
      </div>

      {youtubeConnected ? (
        <div className="shrink-0 border-t border-gray-700 p-2.5">
          <BoardYouTubeChatComposer
            churchId={churchId}
            accountLabel={youtubeAccountLabel}
          />
        </div>
      ) : null}
    </section>
  );
};

export default CurrentServiceRestreamPanel;
