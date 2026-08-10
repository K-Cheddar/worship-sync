import { useMemo } from "react";
import { LoaderCircle } from "lucide-react";
import Button from "../../components/Button/Button";
import {
  filterRestreamMessagesForDisplay,
  RestreamActivityCard,
} from "../../boards/BoardRestreamTabContent";
import {
  BoardYouTubeChatComposer,
} from "../../boards/BoardYouTubeChatComposer";
import { useRestreamSession } from "../../boards/useRestreamSession";
import { useStickToBottomScroll } from "../../hooks/useStickToBottomScroll";
import type { RestreamSession } from "../../types";

type CurrentServiceRestreamPanelProps = {
  churchId: string;
  youtubeConnected: boolean;
  youtubeAccountLabel?: string;
  showToast: (message: string, variant: "success" | "error") => void;
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
  showToast,
}: CurrentServiceRestreamPanelProps) => {
  const restream = useRestreamSession(churchId);
  const messages = useMemo(
    () =>
      filterRestreamMessagesForDisplay(restream.messages)
        .slice()
        .sort((a, b) => a.postedAt - b.postedAt || a.id.localeCompare(b.id)),
    [restream.messages],
  );
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
    resetKey: restream.session?.sessionId ?? churchId,
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
