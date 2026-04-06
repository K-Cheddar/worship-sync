import { useEffect, useMemo, useRef } from "react";
import Button from "../components/Button/Button";
import { cn } from "@/utils/cnHelper";
import { useBoardData } from "./useBoardData";
import { useBoardEventStream } from "./useBoardEventStream";
import {
  filterHighlightedBoardPosts,
  formatBoardTimestamp,
  getBoardAuthorNameColorClass,
  normalizeBoardPresentationFontScale,
} from "./boardUtils";

type BoardPresentationScreenProps = {
  aliasId: string;
  missingAliasTitle?: string;
  missingAliasDescription?: string;
};

const BoardPresentationScreen = ({
  aliasId,
  missingAliasTitle = "No discussion board selected.",
  missingAliasDescription = "Select a discussion board before opening this screen.",
}: BoardPresentationScreenProps) => {
  const {
    alias,
    posts,
    hasLoadedOnce,
    error,
    connectionStatus,
    loadBoard,
    loadPosts,
    retryNow,
    updateAlias,
  } = useBoardData(aliasId);
  const endRef = useRef<HTMLDivElement | null>(null);

  useBoardEventStream(aliasId, (event) => {
    if (event.type === "connected") return;

    if (
      event.type === "board-presentation-updated" &&
      typeof event.presentationFontScale === "number"
    ) {
      updateAlias((currentAlias) =>
        currentAlias
          ? {
              ...currentAlias,
              presentationFontScale: event.presentationFontScale,
            }
          : currentAlias,
      );
      return;
    }

    if (
      event.type === "post-created" ||
      event.type === "post-updated" ||
      event.type === "board-soft-reset"
    ) {
      void loadPosts();
      return;
    }

    void loadBoard();
  });

  const highlightedPosts = useMemo(
    () => filterHighlightedBoardPosts(posts),
    [posts],
  );
  const presentationFontScale = normalizeBoardPresentationFontScale(
    alias?.presentationFontScale,
  );

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [highlightedPosts]);

  return (
    <main className="h-dvh overflow-hidden bg-[linear-gradient(160deg,#111827_0%,#0f172a_45%,#020617_100%)] text-white">
      <div className="flex h-full flex-col px-8 py-8">
        <header className="shrink-0">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-cyan-200/80">
            Discussion Board
          </p>
          <h1 className="mt-3 text-4xl font-semibold md:text-5xl">
            {alias?.title || "Presentation"}
          </h1>
        </header>

        {!aliasId ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-3xl rounded-[2rem] border border-slate-700/70 bg-slate-900/60 px-10 py-12 text-center shadow-2xl">
              <p className="text-3xl font-semibold md:text-4xl">
                {missingAliasTitle}
              </p>
              <p className="mt-4 text-lg leading-relaxed text-slate-300 md:text-xl">
                {missingAliasDescription}
              </p>
            </div>
          </div>
        ) : !hasLoadedOnce && connectionStatus.status !== "failed" ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-3xl rounded-[2rem] border border-slate-700/70 bg-slate-900/60 px-10 py-12 text-center shadow-2xl">
              <p className="text-3xl font-semibold md:text-4xl">
                {connectionStatus.status === "retrying"
                  ? "Connection failed. Retrying..."
                  : "Connecting to presentation..."}
              </p>
              <p className="mt-4 text-lg leading-relaxed text-slate-300 md:text-xl">
                {connectionStatus.status === "retrying"
                  ? "The presentation will reconnect automatically when the server is available."
                  : "Loading highlighted posts from the discussion board."}
              </p>
            </div>
          </div>
        ) : !hasLoadedOnce ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-3xl rounded-[2rem] border border-red-300/30 bg-red-950/20 px-10 py-12 text-center shadow-2xl">
              <p className="text-3xl font-semibold md:text-4xl">
                {error || "Could not load presentation."}
              </p>
              <p className="mt-4 text-lg leading-relaxed text-red-100/80 md:text-xl">
                Check the server connection, then try again.
              </p>
              <Button className="mt-6 justify-center" onClick={retryNow}>
                Try Again
              </Button>
            </div>
          </div>
        ) : highlightedPosts.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-3xl rounded-[2rem] border border-slate-700/70 bg-slate-900/60 px-10 py-12 text-center shadow-2xl">
              <p className="text-3xl font-semibold md:text-4xl">
                No highlighted posts yet.
              </p>
              <p className="mt-4 text-lg leading-relaxed text-slate-300 md:text-xl">
                When a moderator highlights a post from the discussion board controls, it appears here.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-8 flex-1 overflow-y-auto pr-2">
            <div className="space-y-6 pb-12">
              {highlightedPosts.map((post, index) => (
                <article
                  key={post._id}
                  className={`rounded-[2rem] border border-cyan-300/20 bg-white/8 px-8 py-7 shadow-2xl backdrop-blur-sm ${index === highlightedPosts.length - 1 ? "ring-2 ring-cyan-300/40" : ""}`}
                >
                  <div
                    className="flex flex-wrap items-center gap-3 text-cyan-100/80"
                    style={{
                      fontSize: `clamp(${0.95 * presentationFontScale}rem, ${1.1 * presentationFontScale}vw, ${1.125 * presentationFontScale}rem)`,
                    }}
                  >
                    <span
                      className={cn(
                        "font-semibold",
                        getBoardAuthorNameColorClass(post),
                      )}
                    >
                      {post.author}
                    </span>
                    <span>{formatBoardTimestamp(post.timestamp)}</span>
                  </div>
                  <p
                    className="mt-5 whitespace-pre-wrap font-medium leading-[1.25] text-white"
                    style={{
                      fontSize: `clamp(${2.25 * presentationFontScale}rem, ${3 * presentationFontScale}vw, ${5 * presentationFontScale}rem)`,
                    }}
                  >
                    {post.text}
                  </p>
                </article>
              ))}
              <div ref={endRef} />
            </div>
          </div>
        )}

        {aliasId && hasLoadedOnce && connectionStatus.status === "retrying" && (
          <div className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            Connection failed. Retrying to refresh the presentation.
          </div>
        )}

        {aliasId && hasLoadedOnce && connectionStatus.status === "failed" && (
          <div className="mt-4 rounded-2xl border border-red-300/30 bg-red-950/20 px-4 py-3 text-sm text-red-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{error || "Could not refresh the presentation."}</span>
              <Button variant="tertiary" onClick={retryNow}>
                Try Again
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
};

export default BoardPresentationScreen;
