import type { CSSProperties } from "react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import cn from "classnames";
import {
  Eye,
  EyeOff,
  LayoutList,
  LoaderCircle,
  Menu as MenuIcon,
  SlidersHorizontal,
  Sparkles,
  StarOff,
} from "lucide-react";
import PouchDB from "pouchdb-browser";
import Button from "../components/Button/Button";
import DeleteModal from "../components/Modal/DeleteModal";
import Menu from "../components/Menu/Menu";
import Icon from "../components/Icon/Icon";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet";
import { SectionTabs } from "../components/SectionTabs/SectionTabs";
import UserSection from "../containers/Toolbar/ToolbarElements/UserSection";
import { useToast } from "../context/toastContext";
import { GlobalInfoContext } from "../context/globalInfo";
import { useSelector } from "../hooks";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type { RootState } from "../store/store";
import { useStickToBottomScroll } from "../hooks/useStickToBottomScroll";
import BoardSyncProvider, { useBoardSync } from "../boards/BoardSyncContext";
import { ControllerInfoContext } from "../context/controllerInfo";
import { BoardRenameModal } from "../boards/BoardRenameModal";
import { BoardPostMessage } from "../boards/BoardPostMessage";
import {
  buildBoardPublicUrl,
  filterVisibleBoardPosts,
  formatBoardTimestamp,
  getAliasDocId,
  getBoardAuthorNameColorClass,
  getBoardDocId,
  getBoardLabel,
  normalizeBoardPresentationFontScale,
  getBoardPostRange,
  boardHasOnlyPreviousDayPosts,
  isCurrentBoardView,
  isRestreamChatFromPreviousDay,
  isWorshipSyncModeratorBoardPost,
  setStoredBoardDisplayAliasId,
  sortBoardPostsAscending,
} from "../boards/boardUtils";
import {
  BOARD_PANEL_BODY,
  BOARD_PANEL_CARD,
  BOARD_PANEL_HEADER,
} from "../boards/boardPanelTheme";
import {
  deleteBoardAlias,
  hardResetBoardAlias,
  resetRestreamSession,
  updateBoardPresentationFontScale,
  updateBoardPostHidden,
  updateBoardPostHighlighted,
} from "../boards/api";
import {
  DBBoard,
  DBBoardAlias,
  DBBoardPost,
} from "../types";
import { BoardControllerMenu } from "../boards/BoardControllerMenu";
import { BoardToolsPanelBody } from "../boards/BoardControllerToolsPanel";
import { BoardDiscussionPostComposer } from "../boards/BoardDiscussionPostComposer";
import { BoardModeratorReplyBadge } from "../boards/BoardModeratorReplyBadge";
import { ManageBoardsPanelBody } from "../boards/BoardControllerManageBoardsPanel";
import { BoardShareLinkGroup } from "../boards/BoardShareLinkGroup";
import {
  filterRestreamMessagesForDisplay,
  RestreamTabContent,
} from "../boards/BoardRestreamTabContent";
import {
  useRestreamSession,
} from "../boards/useRestreamSession";

type AllDocsResult<T> = {
  rows: Array<{ doc?: T }>;
};

const getAliasRangeEndKey = () => `alias:${String.fromCharCode(0xffff)}`;

const getSafeAliasDocs = async (
  db: PouchDB.Database,
  database: string,
): Promise<DBBoardAlias[]> => {
  const result = (await db.allDocs({
    include_docs: true,
    startkey: "alias:",
    endkey: getAliasRangeEndKey(),
  })) as AllDocsResult<DBBoardAlias>;

  return result.rows
    .flatMap((row) => (row.doc ? [row.doc] : []))
    .filter((doc) => doc.database === database)
    .sort((a, b) => a.title.localeCompare(b.title));
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getAliasDocs = async (
  db: PouchDB.Database,
  database: string,
): Promise<DBBoardAlias[]> => {
  const result = (await db.allDocs({
    include_docs: true,
    startkey: "alias:",
    endkey: "alias:￿",
  })) as AllDocsResult<DBBoardAlias>;

  return result.rows
    .flatMap((row) => (row.doc ? [row.doc] : []))
    .filter((doc) => doc.database === database)
    .sort((a, b) => a.title.localeCompare(b.title));
};

const getBoardDocsById = async (
  db: PouchDB.Database,
  boardIds: string[],
): Promise<Record<string, DBBoard>> => {
  if (boardIds.length === 0) return {};
  const result = (await db.allDocs({
    include_docs: true,
    keys: boardIds.map((boardId) => getBoardDocId(boardId)),
  })) as AllDocsResult<DBBoard>;

  return result.rows.reduce<Record<string, DBBoard>>((acc, row) => {
    if (row.doc) acc[row.doc.id] = row.doc;
    return acc;
  }, {});
};

const getBoardPosts = async (
  db: PouchDB.Database,
  boardId: string,
): Promise<DBBoardPost[]> => {
  const range = getBoardPostRange(boardId);
  const result = (await db.allDocs({
    include_docs: true,
    ...range,
  })) as AllDocsResult<DBBoardPost>;

  return sortBoardPostsAscending(
    result.rows.flatMap((row) => (row.doc ? [row.doc] : [])),
  );
};

const SessionResetToastAction = ({
  keepLabel,
  confirmLabel,
  onKeep,
  onConfirm,
}: {
  keepLabel: string;
  confirmLabel: string;
  onKeep: () => void;
  onConfirm: () => void;
}) => (
  <div className="mt-3 flex justify-center gap-2">
    <Button variant="primary" className="text-sm" onClick={onKeep}>
      {keepLabel}
    </Button>
    <Button variant="cta" className="text-sm" onClick={onConfirm}>
      {confirmLabel}
    </Button>
  </div>
);

export const BoardControllerContent = () => {
  const { db, status, pullFromRemote } = useBoardSync() || {};
  const { database, loginState, churchId, userId } =
    useContext(GlobalInfoContext) || {};
  const { showToast, removeToast } = useToast();
  const scrollbarWidth = useSelector(
    (state: RootState) => state.undoable.present.preferences.scrollbarWidth,
  );
  const restreamSession = useRestreamSession(churchId || "");
  const { session: restreamSessionData, reload: reloadRestreamSession } =
    restreamSession;
  const visibleRestreamMessageCount = useMemo(
    () =>
      filterRestreamMessagesForDisplay(restreamSession.messages).length,
    [restreamSession.messages],
  );

  const [aliases, setAliases] = useState<DBBoardAlias[]>([]);
  const [selectedAliasId, setSelectedAliasId] = useState<string>("");
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [selectedAlias, setSelectedAlias] = useState<DBBoardAlias | null>(null);
  const [boardsById, setBoardsById] = useState<Record<string, DBBoard>>({});
  const [posts, setPosts] = useState<DBBoardPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);
  const [actingPostIds, setActingPostIds] = useState<Set<string>>(new Set());
  const [renameAliasId, setRenameAliasId] = useState("");
  const [deleteAlias, setDeleteAlias] = useState<DBBoardAlias | null>(null);
  const [activeTab, setActiveTab] = useState<"boardPosts" | "restream">(
    "boardPosts",
  );
  const [manageBoardsOpen, setManageBoardsOpen] = useState(false);
  const [boardToolsOpen, setBoardToolsOpen] = useState(false);
  const [restreamResetConfirmOpen, setRestreamResetConfirmOpen] =
    useState(false);
  const loadRequestIdRef = useRef(0);
  const boardIdToViewRef = useRef("");
  const selectedBoardIdRef = useRef("");
  const selectedAliasIdRef = useRef("");
  // Board ids / Restream session ids we've already prompted about, so the
  // "start fresh session" / "clear Restream chat" toast appears once per stale
  // session rather than on every re-render or background sync.
  const promptedFreshSessionBoardIdsRef = useRef<Set<string>>(new Set());
  const promptedRestreamResetSessionIdsRef = useRef<Set<string>>(new Set());

  const isXlUp = useMediaQuery("(min-width: 1280px)");
  const isMobileStack = !isXlUp;
  const isLgUp = useMediaQuery("(min-width: 1024px)");
  const { setIsMobile } = useContext(ControllerInfoContext) || {};
  useEffect(() => {
    setIsMobile?.(!isLgUp);
  }, [isLgUp, setIsMobile]);

  const loadAliases = useCallback(async () => {
    if (!db || !database) return;
    const nextAliases = await getSafeAliasDocs(db, database);
    setAliases(nextAliases);
    setSelectedAliasId((currentAliasId) => {
      if (currentAliasId && nextAliases.some((alias) => alias.aliasId === currentAliasId)) {
        return currentAliasId;
      }
      return nextAliases[0]?.aliasId || "";
    });
  }, [db, database]);

  const loadSelectedAlias = useCallback(async () => {
    if (!db || !selectedAliasId) {
      loadRequestIdRef.current += 1;
      setSelectedAlias(null);
      setBoardsById({});
      setPosts([]);
      setIsLoading(false);
      return;
    }

    const requestId = ++loadRequestIdRef.current;
    setIsLoading(true);
    try {
      const alias = (await db.get(getAliasDocId(selectedAliasId))) as DBBoardAlias;
      const boardIds = Array.from(new Set([alias.currentBoardId, ...alias.history]));
      const nextBoards = await getBoardDocsById(db, boardIds);
      const boardIdToView =
        selectedBoardId && boardIds.includes(selectedBoardId)
          ? selectedBoardId
          : alias.currentBoardId;
      const nextPosts = await getBoardPosts(db, boardIdToView);

      if (requestId !== loadRequestIdRef.current) {
        return;
      }

      setSelectedAlias(alias);
      setBoardsById(nextBoards);
      setPosts(nextPosts);
    } catch (error) {
      if (requestId === loadRequestIdRef.current) {
        console.warn("Board link is not ready in local sync yet:", error);
      }
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [db, selectedAliasId, selectedBoardId]);

  useEffect(() => {
    selectedBoardIdRef.current = selectedBoardId;
  }, [selectedBoardId]);

  useEffect(() => {
    selectedAliasIdRef.current = selectedAliasId;
  }, [selectedAliasId]);

  useEffect(() => {
    void loadAliases();
  }, [loadAliases]);

  useEffect(() => {
    if (!db) return;
    const changes = db
      .changes({ since: "now", live: true, include_docs: true })
      .on("change", (change) => {
        if (!change || typeof change.id !== "string") {
          void loadAliases();
          void loadSelectedAlias();
          return;
        }
        const boardId = boardIdToViewRef.current;
        if (boardId && change.id.startsWith(`post:${boardId}:`)) {
          if (change.deleted) {
            setPosts((prev) => prev.filter((p) => p._id !== change.id));
          } else {
            const updated = change.doc as unknown as DBBoardPost;
            setPosts((prev) => {
              const idx = prev.findIndex((p) => p._id === updated._id);
              if (idx !== -1) {
                const next = [...prev];
                next[idx] = updated;
                return next;
              }
              return sortBoardPostsAscending([...prev, updated]);
            });
          }
        } else if (!change.deleted && change.doc && change.id.startsWith("alias:")) {
          const updatedAlias = change.doc as unknown as DBBoardAlias;
          setAliases((prev) => {
            const idx = prev.findIndex((a) => a.aliasId === updatedAlias.aliasId);
            if (idx !== -1) {
              const next = [...prev];
              next[idx] = updatedAlias;
              return next;
            }
            return [...prev, updatedAlias].sort((a, b) => a.title.localeCompare(b.title));
          });
          if (selectedAliasIdRef.current === updatedAlias.aliasId) {
            const boardIds = Array.from(
              new Set([updatedAlias.currentBoardId, ...updatedAlias.history]),
            );
            const selectedBoardId = selectedBoardIdRef.current;
            const boardIdToView =
              selectedBoardId && boardIds.includes(selectedBoardId)
                ? selectedBoardId
                : updatedAlias.currentBoardId;

            setSelectedAlias(updatedAlias);
            setSelectedBoardId(
              boardIdToView === updatedAlias.currentBoardId ? "" : boardIdToView,
            );

            void (async () => {
              try {
                const nextBoards = await getBoardDocsById(db, boardIds);
                const nextPosts = await getBoardPosts(db, boardIdToView);
                if (selectedAliasIdRef.current !== updatedAlias.aliasId) return;
                setBoardsById(nextBoards);
                setPosts(nextPosts);
              } catch (error) {
                console.warn("Board link is not ready in local sync yet:", error);
              }
            })();
          }
        } else {
          void loadAliases();
          void loadSelectedAlias();
        }
      });

    return () => {
      changes.cancel();
    };
  }, [db, loadAliases, loadSelectedAlias]);

  useEffect(() => {
    void loadSelectedAlias();
  }, [loadSelectedAlias]);

  useEffect(() => {
    setStoredBoardDisplayAliasId(selectedAliasId);
  }, [selectedAliasId]);

  useEffect(() => {
    if (isXlUp) {
      setManageBoardsOpen(false);
      setBoardToolsOpen(false);
    }
  }, [isXlUp]);

  const currentBoard = selectedAlias
    ? boardsById[selectedAlias.currentBoardId]
    : undefined;
  const boardIdToView = selectedBoardId || selectedAlias?.currentBoardId || "";
  boardIdToViewRef.current = boardIdToView;
  const isViewingCurrent = !selectedBoardId || isCurrentBoardView(selectedAlias, selectedBoardId);
  const publicBoardUrl = selectedAlias
    ? buildBoardPublicUrl(selectedAlias.aliasId, "board")
    : "";
  const publicPresentUrl = selectedAlias
    ? buildBoardPublicUrl(selectedAlias.aliasId, "present")
    : "";
  const presentationFontScale = normalizeBoardPresentationFontScale(
    selectedAlias?.presentationFontScale,
  );

  const archiveOptions = useMemo(() => {
    if (!selectedAlias) return [];
    return [
      selectedAlias.currentBoardId,
      ...selectedAlias.history.slice().reverse(),
    ];
  }, [selectedAlias]);

  const handleCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast(`${label} copied.`, "success");
    } catch {
      showToast(`Could not copy ${label.toLowerCase()}.`, "error");
    }
  };

  const handleOpenViewBoardLink = useCallback(() => {
    if (!publicPresentUrl) return;
    window.open(publicPresentUrl, "_blank", "noopener,noreferrer");
  }, [publicPresentUrl]);

  const handleOpenAttendeeLink = useCallback(() => {
    if (!publicBoardUrl) return;
    window.open(publicBoardUrl, "_blank", "noopener,noreferrer");
  }, [publicBoardUrl]);

  const runAction = useCallback(
    async (action: () => Promise<void>) => {
      setIsActing(true);
      try {
        await action();
        pullFromRemote?.();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not complete that action.";
        showToast(message, "error");
      } finally {
        setIsActing(false);
      }
    },
    [pullFromRemote, showToast],
  );

  const handleStartFreshSession = useCallback(() => {
    if (!selectedAlias) return;
    const aliasId = selectedAlias.aliasId;
    void runAction(async () => {
      await hardResetBoardAlias(aliasId);
      setSelectedBoardId("");
      showToast("Started a fresh session for today.", "success");
    });
  }, [selectedAlias, runAction, showToast]);

  const handleConfirmRestreamReset = useCallback(async () => {
    if (!churchId) return;
    try {
      await resetRestreamSession(churchId);
      await reloadRestreamSession();
      setRestreamResetConfirmOpen(false);
      showToast("Cleared earlier Restream chat.", "success");
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Could not clear the Restream chat.",
        "error",
      );
    }
  }, [churchId, reloadRestreamSession, showToast]);

  // Prompt (never force) a fresh board session when the current board only holds
  // posts from an earlier day — leftover content with no activity today. Keyed on
  // post activity, not the board's creation date, so a session created earlier
  // but actively collecting today's posts is never flagged. Start-new-session
  // archives posts to history, so this stays a one-tap toast.
  useEffect(() => {
    if (isLoading || !isViewingCurrent || !currentBoard) return;
    if (!boardHasOnlyPreviousDayPosts(posts)) return;
    const staleBoardId = currentBoard.id;
    if (promptedFreshSessionBoardIdsRef.current.has(staleBoardId)) return;
    promptedFreshSessionBoardIdsRef.current.add(staleBoardId);

    showToast({
      message:
        "This board only has posts from an earlier day. Start a fresh session for today?",
      variant: "info",
      duration: 15000,
      showCloseButton: false,
      children: (toastId) => (
        <SessionResetToastAction
          keepLabel="Keep this session"
          confirmLabel="Start fresh session"
          onKeep={() => removeToast(toastId)}
          onConfirm={() => {
            removeToast(toastId);
            handleStartFreshSession();
          }}
        />
      ),
    });
  }, [
    isLoading,
    isViewingCurrent,
    currentBoard,
    posts,
    showToast,
    removeToast,
    handleStartFreshSession,
  ]);

  // Prompt (never force) clearing Restream chat when its most recent activity was
  // on an earlier day. Clearing Restream chat is permanent, so confirming opens a
  // confirm dialog rather than clearing straight from the toast.
  useEffect(() => {
    if (!isRestreamChatFromPreviousDay(restreamSessionData)) return;
    const staleSessionId = restreamSessionData?.sessionId ?? "";
    if (!staleSessionId) return;
    if (promptedRestreamResetSessionIdsRef.current.has(staleSessionId)) return;
    promptedRestreamResetSessionIdsRef.current.add(staleSessionId);

    showToast({
      message: "Restream chat is from an earlier day. Clear it for today?",
      variant: "info",
      duration: 15000,
      showCloseButton: false,
      children: (toastId) => (
        <SessionResetToastAction
          keepLabel="Keep chat"
          confirmLabel="Clear Restream chat"
          onKeep={() => removeToast(toastId)}
          onConfirm={() => {
            removeToast(toastId);
            setRestreamResetConfirmOpen(true);
          }}
        />
      ),
    });
  }, [restreamSessionData, showToast, removeToast]);

  const runPostAction = useCallback(
    async (
      postId: string,
      action: () => Promise<unknown>,
      optimisticFn: (post: DBBoardPost) => DBBoardPost,
    ) => {
      setActingPostIds((prev) => new Set([...prev, postId]));
      setPosts((prev) => prev.map((p) => (p._id === postId ? optimisticFn(p) : p)));
      try {
        await action();
      } catch (error) {
        void loadSelectedAlias();
        const message = error instanceof Error ? error.message : "Could not complete that action.";
        showToast(message, "error");
      } finally {
        setActingPostIds((prev) => {
          const next = new Set(prev);
          next.delete(postId);
          return next;
        });
      }
    },
    [showToast, loadSelectedAlias],
  );

  const runFontScaleAction = useCallback(
    (newScale: number) => {
      if (!selectedAlias) return;
      const prevScale = selectedAlias.presentationFontScale;
      setSelectedAlias((prev) => prev ? { ...prev, presentationFontScale: newScale } : prev);
      void updateBoardPresentationFontScale(selectedAlias.aliasId, newScale)
        .catch(() => {
          setSelectedAlias((prev) => prev ? { ...prev, presentationFontScale: prevScale } : prev);
        });
    },
    [selectedAlias],
  );

  const handleBoardCreated = useCallback(
    (aliasId: string) => {
      setSelectedAliasId(aliasId);
      setSelectedBoardId("");
      if (isMobileStack) {
        setManageBoardsOpen(false);
      }
    },
    [isMobileStack],
  );

  const handleSelectAlias = useCallback(
    (aliasId: string) => {
      setSelectedAliasId(aliasId);
      setSelectedBoardId("");
      if (isMobileStack) {
        setManageBoardsOpen(false);
      }
    },
    [isMobileStack],
  );

  const handleCloseRename = useCallback(() => {
    setRenameAliasId("");
  }, []);

  const handleBoardRenamed = useCallback((updated: DBBoardAlias) => {
    setAliases((current) =>
      current.map((alias) =>
        alias.aliasId === updated.aliasId ? { ...alias, title: updated.title } : alias,
      ),
    );
    setSelectedAlias((current) =>
      current && current.aliasId === updated.aliasId
        ? { ...current, title: updated.title }
        : current,
    );
    setRenameAliasId("");
  }, []);

  const visibleCount = filterVisibleBoardPosts(posts).length;
  const postsScrollTrigger = useMemo(
    () => posts.map((p) => `${p._id}:${p._rev ?? ""}`).join("|"),
    [posts],
  );
  const stickToBottomResetKey = `${selectedAliasId}:${boardIdToView}`;
  const { scrollRef, endRef, onScroll } = useStickToBottomScroll({
    scrollTrigger: postsScrollTrigger,
    resetKey: stickToBottomResetKey,
  });
  const renameAlias = aliases.find((alias) => alias.aliasId === renameAliasId) ?? null;
  const showBoardDiscussionComposer =
    Boolean(selectedAliasId) &&
    isViewingCurrent &&
    loginState === "success" &&
    Boolean(String(userId || "").trim());

  const boardPostsTabContent = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scrollbar-variable min-h-0 flex-1 overflow-y-auto p-4"
      >
        {isLoading ? (
          <div className="flex items-center gap-2 text-gray-300">
            <LoaderCircle className="animate-spin" size={18} />
            Loading posts…
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-500 bg-gray-800/50 p-6 text-center">
            <p className="text-lg font-semibold">No posts yet.</p>
            <p className="mt-2 text-sm text-gray-300">
              Share the board link to start receiving questions.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => {
              const isModeratorPost = isWorshipSyncModeratorBoardPost(post);
              return (
                <article
                  key={post._id}
                  className={cn(
                    "rounded-xl border p-4",
                    post.deleted &&
                    "border-rose-900/50 bg-rose-950/25 ring-1 ring-rose-500/15",
                    !post.deleted &&
                    post.hidden &&
                    "border-gray-600 bg-gray-800/60 opacity-70",
                    !post.deleted &&
                    !post.hidden &&
                    !isModeratorPost &&
                    "border-gray-500 bg-gray-800/90",
                    !post.deleted &&
                    !post.hidden &&
                    isModeratorPost &&
                    "border-amber-500/20 bg-gray-800/90",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "font-semibold",
                        (post.hidden || post.deleted) && "text-gray-400",
                        !post.hidden &&
                        !post.deleted &&
                        getBoardAuthorNameColorClass(post),
                      )}
                    >
                      {post.author}
                    </span>
                    {isModeratorPost ? <BoardModeratorReplyBadge /> : null}
                    <span className="text-xs text-gray-300">
                      {formatBoardTimestamp(post.timestamp)}
                    </span>
                    {post.deleted && (
                      <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs font-semibold text-rose-100">
                        Deleted by author
                      </span>
                    )}
                    {post.highlighted && !post.deleted && (
                      <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-semibold text-amber-200">
                        Highlighted
                      </span>
                    )}
                    {post.hidden && (
                      <span className="rounded-full bg-gray-600 px-2 py-0.5 text-xs font-semibold text-gray-100">
                        Hidden
                      </span>
                    )}
                  </div>
                  {isViewingCurrent && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="tertiary"
                        svg={post.hidden ? Eye : EyeOff}
                        onClick={() => {
                          void runPostAction(
                            post._id,
                            () => updateBoardPostHidden(post._id, !post.hidden),
                            (p) => ({ ...p, hidden: !p.hidden }),
                          );
                        }}
                        disabled={actingPostIds.has(post._id) || post.deleted}
                      >
                        {post.hidden ? "Unhide" : "Hide"}
                      </Button>
                      <Button
                        variant="tertiary"
                        svg={post.highlighted ? StarOff : Sparkles}
                        onClick={() =>
                          void runPostAction(
                            post._id,
                            () =>
                              updateBoardPostHighlighted(
                                post._id,
                                !post.highlighted,
                              ),
                            (p) => ({ ...p, highlighted: !p.highlighted }),
                          )
                        }
                        disabled={
                          actingPostIds.has(post._id) || post.hidden || post.deleted
                        }
                      >
                        {post.highlighted ? "Unhighlight" : "Highlight"}
                      </Button>
                    </div>
                  )}
                </div>
                <div
                  className={cn(
                    "mt-3 min-w-0",
                    post.deleted && "opacity-80",
                  )}
                >
                  <BoardPostMessage text={post.text} isMine={false} tone="moderator" />
                </div>
              </article>
              );
            })}
          </div>
        )}
        <div ref={endRef} className="h-px shrink-0" aria-hidden />
      </div>
      {showBoardDiscussionComposer ? (
        <BoardDiscussionPostComposer
          aliasId={selectedAliasId}
          showToast={showToast}
          userId={String(userId || "").trim()}
          pullFromRemote={pullFromRemote}
        />
      ) : null}
    </div>
  );

  const manageBoardsContent = (
    <ManageBoardsPanelBody
      database={database}
      isActing={isActing}
      runAction={runAction}
      onCreated={handleBoardCreated}
      aliases={aliases}
      selectedAliasId={selectedAliasId}
      onSelectAlias={handleSelectAlias}
      onRenameAlias={setRenameAliasId}
      onDeleteAlias={setDeleteAlias}
    />
  );

  return (
    <main
      id="controller-main"
      className="flex h-dvh flex-col bg-homepage-canvas text-white"
      style={
        {
          "--scrollbar-width": scrollbarWidth,
        } as CSSProperties
      }
    >
      <BoardRenameModal
        alias={renameAlias}
        isActing={isActing}
        onClose={handleCloseRename}
        runAction={runAction}
        onRenamed={handleBoardRenamed}
      />

      {deleteAlias && (
        <DeleteModal
          isOpen
          onClose={() => {
            if (isActing) return;
            setDeleteAlias(null);
          }}
          onConfirm={() =>
            void runAction(async () => {
              await deleteBoardAlias(deleteAlias.aliasId);
              setAliases((current) =>
                current.filter((alias) => alias.aliasId !== deleteAlias.aliasId),
              );
              if (selectedAliasId === deleteAlias.aliasId) {
                setSelectedAliasId("");
                setSelectedBoardId("");
                setSelectedAlias(null);
                setBoardsById({});
                setPosts([]);
              }
              setDeleteAlias(null);
              showToast("Discussion board deleted.", "success");
            })
          }
          itemName={deleteAlias.title}
          title="Delete discussion board"
          message="Are you sure you want to delete"
          warningMessage="This removes the board, its sessions, and all posts."
          confirmText="Delete board"
          isConfirming={isActing}
        />
      )}

      {restreamResetConfirmOpen && (
        <DeleteModal
          isOpen
          onClose={() => setRestreamResetConfirmOpen(false)}
          onConfirm={() => void handleConfirmRestreamReset()}
          itemName="earlier Restream chat"
          title="Clear Restream chat"
          message="Are you sure you want to clear"
          warningMessage="This permanently removes the earlier Restream chat. Discussion board posts stay the same."
          confirmText="Clear chat"
          isConfirming={false}
        />
      )}

      {/* Manage boards sheet (below xl) */}
      <Sheet open={manageBoardsOpen} onOpenChange={setManageBoardsOpen}>
        <SheetContent
          side="left"
          className="flex flex-col p-0"
          aria-describedby={undefined}
        >
          <SheetHeader>
            <SheetTitle>Manage boards</SheetTitle>
          </SheetHeader>
          <div
            className="scrollbar-portal min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
            style={
              {
                "--scrollbar-width": scrollbarWidth,
              } as CSSProperties
            }
          >
            {manageBoardsContent}
          </div>
        </SheetContent>
      </Sheet>

      {/* Board tools sheet (below xl) */}
      {db && selectedAlias && (
        <Sheet open={boardToolsOpen} onOpenChange={setBoardToolsOpen}>
          <SheetContent
            side="right"
            className="flex flex-col p-0"
            aria-describedby={undefined}
          >
            <SheetHeader>
              <SheetTitle>Board tools</SheetTitle>
            </SheetHeader>
            <div
              className={cn(
                "scrollbar-portal min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4",
                BOARD_PANEL_BODY,
              )}
              style={
                {
                  "--scrollbar-width": scrollbarWidth,
                } as CSSProperties
              }
            >
              <BoardToolsPanelBody
                isMobileStack={true}
                churchId={churchId || ""}
                restreamSession={restreamSession}
                handleCopy={handleCopy}
                onOpenAttendeeLink={handleOpenAttendeeLink}
                onOpenViewBoardLink={handleOpenViewBoardLink}
                publicBoardUrl={publicBoardUrl}
                publicPresentUrl={publicPresentUrl}
                boardIdToView={boardIdToView}
                setSelectedBoardId={setSelectedBoardId}
                selectedAlias={selectedAlias}
                boardsById={boardsById}
                archiveOptions={archiveOptions}
                isViewingCurrent={isViewingCurrent}
                presentationFontScale={presentationFontScale}
                onFontScaleChange={runFontScaleAction}
                runAction={runAction}
                isActing={isActing}
                showToast={showToast}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      <header className="flex flex-nowrap items-center gap-3 border-b-2 border-gray-500 bg-gray-800 px-4 py-3">
        <BoardControllerMenu
          canOpenBoard={Boolean(selectedAliasId)}
          prepareBoardDisplay={() => {
            if (selectedAliasId) {
              setStoredBoardDisplayAliasId(selectedAliasId);
            }
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-nowrap items-center justify-between gap-3">
            <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">
              Discussion boards
            </h1>
            <UserSection />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        {/* Left aside — xl+ only */}
        <aside className="hidden w-full border-b-2 border-gray-500 bg-gray-800 p-4 xl:block xl:w-88 xl:border-b-0 xl:border-r-2">
          {manageBoardsContent}
        </aside>

        <section className="flex min-h-0 flex-1 flex-col">
          {!db && (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <div>
                <p className="text-lg font-semibold">
                  {status === "failed"
                    ? "Could not connect discussion board data."
                    : "Connecting discussion board data…"}
                </p>
                <p className="mt-2 text-sm text-gray-300">
                  {loginState === "loading"
                    ? "Checking your sign-in."
                    : "You can moderate posts when you are online."}
                </p>
              </div>
            </div>
          )}

          {db && !selectedAlias && !isLoading && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="text-lg font-semibold">Create a board to get started.</p>
              <p className="max-w-sm text-sm text-gray-300">
                Use the create form to add your first discussion board.
              </p>
            </div>
          )}

          {db && selectedAlias && (
            <>
              <div className="border-b-2 border-gray-500 bg-homepage-canvas px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <h2 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight">
                    {selectedAlias.title}
                  </h2>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {isMobileStack && (
                      <>
                        {/* Direct buttons at sm+ */}
                        <Button
                          variant="tertiary"
                          svg={LayoutList}
                          gap="gap-1.5"
                          className="hidden sm:flex"
                          onClick={() => setManageBoardsOpen(true)}
                        >
                          Manage boards
                        </Button>
                        <Button
                          variant="tertiary"
                          svg={SlidersHorizontal}
                          gap="gap-1.5"
                          className="hidden sm:flex"
                          onClick={() => setBoardToolsOpen(true)}
                        >
                          Board tools
                        </Button>
                        {/* Overflow menu below sm */}
                        <Menu
                          align="end"
                          menuItems={[
                            {
                              element: (
                                <div className="flex items-center gap-2 max-md:min-h-12">
                                  <Icon svg={LayoutList} color="#d1d5dc" />
                                  Manage boards
                                </div>
                              ),
                              onClick: () => setManageBoardsOpen(true),
                            },
                            {
                              element: (
                                <div className="flex items-center gap-2 max-md:min-h-12">
                                  <Icon svg={SlidersHorizontal} color="#d1d5dc" />
                                  Board tools
                                </div>
                              ),
                              onClick: () => setBoardToolsOpen(true),
                            },
                          ]}
                          TriggeringButton={
                            <Button
                              variant="tertiary"
                              svg={MenuIcon}
                              gap="gap-1.5"
                              className="sm:hidden"
                              aria-label="Board tools and management"
                            >
                              Tools
                            </Button>
                          }
                        />
                      </>
                    )}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-gray-300">
                      Current session: {getBoardLabel(currentBoard)}
                    </p>
                    <div
                      className="rounded-md border border-gray-500 px-3 py-0.5 text-sm text-gray-200"
                      aria-live="polite"
                    >
                      {posts.length} total · {visibleCount} visible
                    </div>

                  </div>
                  <p className="mt-2 hidden text-sm text-gray-300 xl:block">
                    Share attendee and board links, then moderate posts below. The links will stay the same even if you create a new session.
                  </p>
                  {!isViewingCurrent && (
                    <p className="mt-2 text-xs text-amber-100/90">
                      Posts below are from an earlier session (
                      {getBoardLabel(boardsById[boardIdToView])}).{" "}
                      {isMobileStack
                        ? "Open More tools to switch."
                        : "Use Board tools on the right to switch."}
                    </p>
                  )}
                  <div className="mt-3 hidden flex-wrap items-start gap-3 xl:flex">
                    <BoardShareLinkGroup
                      heading="Attendee link"
                      onCopy={() => handleCopy(publicBoardUrl, "Attendee link")}
                      onView={handleOpenAttendeeLink}
                      disabled={!publicBoardUrl}
                    />
                    <BoardShareLinkGroup
                      heading="Board link"
                      onCopy={() => handleCopy(publicPresentUrl, "Board link")}
                      onView={handleOpenViewBoardLink}
                      disabled={!publicPresentUrl}
                    />
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden p-4">
                <SectionTabs
                  value={activeTab}
                  onValueChange={setActiveTab}
                  tabsContentClassName="mt-4 flex min-h-0 flex-1 flex-col space-y-0 overflow-hidden"
                  items={[
                    {
                      value: "boardPosts",
                      label: `Board Posts (${posts.length})`,
                      description:
                        "Moderate attendee posts for the current discussion board session.",
                      content: boardPostsTabContent,
                      contentClassName: "flex min-h-0 flex-1 flex-col overflow-hidden",
                    },
                    {
                      value: "restream",
                      label: `Restream (${visibleRestreamMessageCount})`,
                      description:
                        "Watch incoming Restream chat for this church, then hide or highlight messages for the board display.",
                      content: (
                        <RestreamTabContent
                          churchId={churchId || ""}
                          showToast={showToast}
                          restreamSession={restreamSession}
                        />
                      ),
                      contentClassName:
                        "flex min-h-0 flex-1 flex-col overflow-hidden",
                    },
                  ]}
                  className="flex h-full min-h-0 flex-col"
                  tabBarClassName="mx-0 rounded-lg bg-transparent"
                  tabsListClassName="border-0 bg-gray-900"
                />
              </div>
            </>
          )}
        </section>

        {/* Right aside — xl+ only */}
        {!isMobileStack && db && selectedAlias && (
          <aside
            className="flex w-88 min-h-0 shrink-0 flex-col border-l-2 border-gray-500 bg-gray-800 p-4"
            aria-label="Board tools"
          >
            <div className={cn("flex min-h-0 flex-1 flex-col", BOARD_PANEL_CARD)}>
              <div className={BOARD_PANEL_HEADER}>
                <h2 className="text-base font-semibold">Board tools</h2>
              </div>
              <div
                className={cn(
                  "scrollbar-variable min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4",
                  BOARD_PANEL_BODY,
                )}
              >
                <BoardToolsPanelBody
                  isMobileStack={false}
                  churchId={churchId || ""}
                  restreamSession={restreamSession}
                  handleCopy={handleCopy}
                  onOpenAttendeeLink={handleOpenAttendeeLink}
                  onOpenViewBoardLink={handleOpenViewBoardLink}
                  publicBoardUrl={publicBoardUrl}
                  publicPresentUrl={publicPresentUrl}
                  boardIdToView={boardIdToView}
                  setSelectedBoardId={setSelectedBoardId}
                  selectedAlias={selectedAlias}
                  boardsById={boardsById}
                  archiveOptions={archiveOptions}
                  isViewingCurrent={isViewingCurrent}
                  presentationFontScale={presentationFontScale}
                  onFontScaleChange={runFontScaleAction}
                  runAction={runAction}
                  isActing={isActing}
                  showToast={showToast}
                />
              </div>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
};

const BoardController = () => (
  <BoardSyncProvider>
    <BoardControllerContent />
  </BoardSyncProvider>
);

export default BoardController;
