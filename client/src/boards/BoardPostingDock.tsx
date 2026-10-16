import { useCallback, useEffect, useRef, useState } from "react";
import cn from "classnames";
import { Cast, MessageSquarePlus, X } from "lucide-react";
import Button from "../components/Button/Button";
import { BoardDiscussionPostComposer } from "./BoardDiscussionPostComposer";
import { BoardYouTubeChatComposer } from "./BoardYouTubeChatComposer";

type BoardPostingDockProps = {
  aliasId: string;
  boardSessionId: string;
  churchId: string;
  userId: string;
  accountLabel?: string;
  showBoardPost: boolean;
  showYouTubeChat: boolean;
  isCompact: boolean;
  showToast: (message: string, variant: "success" | "error") => void;
  pullFromRemote?: () => void | Promise<void>;
  isFeedPinned: boolean;
  onFeedLayoutComplete: () => void;
};

type Destination = "board" | "youtube";

export const BoardPostingDock = ({
  aliasId,
  boardSessionId,
  churchId,
  userId,
  accountLabel = "",
  showBoardPost,
  showYouTubeChat,
  isCompact,
  showToast,
  pullFromRemote,
  isFeedPinned,
  onFeedLayoutComplete,
}: BoardPostingDockProps) => {
  const [activeDestination, setActiveDestination] = useState<Destination | null>(null);
  const activeDestinationRef = useRef<Destination | null>(null);
  const preserveFeedPinRef = useRef(false);
  const boardButtonRef = useRef<HTMLButtonElement | null>(null);
  const youtubeButtonRef = useRef<HTMLButtonElement | null>(null);
  activeDestinationRef.current = activeDestination;

  const selectDestination = useCallback((destination: Destination) => {
    preserveFeedPinRef.current = preserveFeedPinRef.current || isFeedPinned;
    const nextDestination = activeDestinationRef.current === destination ? null : destination;
    activeDestinationRef.current = nextDestination;
    setActiveDestination(nextDestination);
    if (!nextDestination) {
      (destination === "board" ? boardButtonRef : youtubeButtonRef).current?.focus();
    }
  }, [isFeedPinned]);

  const closeDestination = useCallback((destination: Destination) => {
    if (activeDestinationRef.current === destination) {
      preserveFeedPinRef.current = preserveFeedPinRef.current || isFeedPinned;
      activeDestinationRef.current = null;
      setActiveDestination(null);
      (destination === "board" ? boardButtonRef : youtubeButtonRef).current?.focus();
    }
  }, [isFeedPinned]);

  const handleComposerTransitionEnd = useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      if (event.propertyName !== "grid-template-rows" || !preserveFeedPinRef.current) return;
      preserveFeedPinRef.current = false;
      onFeedLayoutComplete();
    },
    [onFeedLayoutComplete],
  );

  useEffect(() => {
    const destinationIsUnavailable =
      (activeDestination === "board" && !showBoardPost) ||
      (activeDestination === "youtube" && !showYouTubeChat);
    if (!destinationIsUnavailable) return;
    activeDestinationRef.current = null;
    setActiveDestination(null);
  }, [activeDestination, showBoardPost, showYouTubeChat]);

  const boardOpen = showBoardPost && activeDestination === "board";
  const youtubeOpen = showYouTubeChat && activeDestination === "youtube";
  const composerMotion = "grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-200 ease-out motion-reduce:transition-none";

  return (
    <section
      aria-label="Posting dock"
      data-posting-dock
      className={cn(
        "z-10 shrink-0 bg-gray-950",
        !showBoardPost && !showYouTubeChat && "hidden",
        isCompact
          ? "border-t border-gray-700 px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          : "border-t-0 px-3 py-0 shadow-[inset_0_1px_0_#374151]",
      )}
    >
      <div
        aria-hidden={!boardOpen}
        inert={!boardOpen}
        className={cn(
          composerMotion,
          boardOpen
            ? "grid-rows-[1fr] opacity-100 translate-y-0"
            : "grid-rows-[0fr] opacity-0 -translate-y-1",
        )}
        onTransitionEnd={handleComposerTransitionEnd}
      >
        <div className={cn("min-h-0 overflow-hidden", boardOpen && "pt-2")}>
          <BoardDiscussionPostComposer
            key={`${aliasId}:${boardSessionId}`}
            dockMode
            dockOpen={boardOpen}
            onDockClose={() => closeDestination("board")}
            aliasId={aliasId}
            showToast={showToast}
            userId={userId}
            pullFromRemote={pullFromRemote}
          />
        </div>
      </div>

      <div
        aria-hidden={!youtubeOpen}
        inert={!youtubeOpen}
        className={cn(
          composerMotion,
          youtubeOpen
            ? "grid-rows-[1fr] opacity-100 translate-y-0"
            : "grid-rows-[0fr] opacity-0 -translate-y-1",
        )}
        onTransitionEnd={handleComposerTransitionEnd}
      >
        <div className={cn("min-h-0 overflow-hidden", youtubeOpen && "pt-2")}>
          <BoardYouTubeChatComposer
            dockMode
            dockOpen={youtubeOpen}
            onDockClose={() => closeDestination("youtube")}
            churchId={churchId}
            accountLabel={accountLabel}
          />
        </div>
      </div>

      <div
        data-posting-dock-actions
        className={cn(
          "flex h-8 items-center gap-2",
          isCompact ? "" : "justify-end",
          isCompact && "min-h-[36px] h-auto",
        )}
      >
        {showBoardPost ? (
          <Button
            ref={boardButtonRef}
            variant="tertiary"
            svg={MessageSquarePlus}
            iconSize="sm"
            aria-pressed={boardOpen}
            style={{ minHeight: isCompact ? 36 : 32, transition: "none" }}
            className={cn(
              "relative min-h-8 max-md:min-h-[36px] px-2 py-1 text-xs transition-colors after:absolute after:-inset-y-1 after:content-['']",
              isCompact && "flex-1 justify-center",
              boardOpen && "rounded-md ring-1 ring-cyan-400/50 bg-cyan-950/25 text-cyan-100 no-underline",
            )}
            onClick={() => selectDestination("board")}
          >
            <span>Board post</span>
            {boardOpen ? <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
          </Button>
        ) : null}
        {showYouTubeChat ? (
          <Button
            ref={youtubeButtonRef}
            variant="tertiary"
            svg={Cast}
            iconSize="sm"
            aria-pressed={youtubeOpen}
            style={{ minHeight: isCompact ? 36 : 32, transition: "none" }}
            className={cn(
              "relative min-h-8 max-md:min-h-[36px] px-2 py-1 text-xs transition-colors after:absolute after:-inset-y-1 after:content-['']",
              isCompact && "flex-1 justify-center",
              youtubeOpen && "rounded-md ring-1 ring-cyan-400/50 bg-cyan-950/25 text-cyan-100 no-underline",
            )}
            onClick={() => selectDestination("youtube")}
          >
            <span>YouTube chat</span>
            {youtubeOpen ? <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
          </Button>
        ) : null}
      </div>
    </section>
  );
};
