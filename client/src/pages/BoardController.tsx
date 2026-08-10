import type { CSSProperties } from "react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import cn from "classnames";
import {
  Eye,
  EyeOff,
  LayoutList,
  LoaderCircle,
  Menu as MenuIcon,
  MessagesSquare,
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
  filterHighlightedBoardPosts,
  filterHighlightedRestreamMessages,
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
  RestreamMessage,
} from "../types";
import { BoardControllerMenu } from "../boards/BoardControllerMenu";
import { BoardToolsPanelBody } from "../boards/BoardControllerToolsPanel";
import { BoardDiscussionPostComposer } from "../boards/BoardDiscussionPostComposer";
import { BoardYouTubeChatComposer } from "../boards/BoardYouTubeChatComposer";
import { BoardActivitySourceBadge } from "../boards/BoardActivitySourceBadge";
import { ManageBoardsPanelBody } from "../boards/BoardControllerManageBoardsPanel";
import {
  filterRestreamMessagesForDisplay,
  RestreamActivityCard,
} from "../boards/BoardRestreamTabContent";
import {
  useRestreamSession,
} from "../boards/useRestreamSession";

type AllDocsResult<T> = {
  rows: Array<{ doc?: T }>;
};

type LiveActivityItem =
  | {
    id: string;
    source: "board";
    timestamp: number;
    post: DBBoardPost;
  }
  | {
    id: string;
    source: "restream";
    timestamp: number;
    message: RestreamMessage;
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

const getHighlightedBoardPostCount = (posts: DBBoardPost[]): number =>
  filterHighlightedBoardPosts(posts).length;

const getCurrentBoardHighlightedCount = async (
  db: PouchDB.Database,
  currentBoardId: string,
  boardIdToView: string,
  viewedPosts: DBBoardPost[],
): Promise<number> => {
  if (boardIdToView === currentBoardId) {
    return getHighlightedBoardPostCount(viewedPosts);
  }

  return getHighlightedBoardPostCount(await getBoardPosts(db, currentBoardId));
};

const getSelectedAliasViewData = async (
  db: PouchDB.Database,
  alias: DBBoardAlias,
  selectedBoardId: string,
) => {
  const boardIds = Array.from(new Set([alias.currentBoardId, ...alias.history]));
  const boardIdToView =
    selectedBoardId && boardIds.includes(selectedBoardId)
      ? selectedBoardId
      : alias.currentBoardId;
  const [boardsById, posts] = await Promise.all([
    getBoardDocsById(db, boardIds),
    getBoardPosts(db, boardIdToView),
  ]);
  const currentBoardHighlightedCount = await getCurrentBoardHighlightedCount(
    db,
    alias.currentBoardId,
    boardIdToView,
    posts,
  );

  return {
    boardIdToView,
    boardsById,
    posts,
    currentBoardHighlightedCount,
  };
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
  <div className="mt-3 flex flex-wrap justify-center gap-2">
    <Button variant="primary" className="text-sm" wrap onClick={onKeep}>
      {keepLabel}
    </Button>
    <Button variant="cta" className="text-sm" wrap onClick={onConfirm}>
      {confirmLabel}
    </Button>
  </div>
);

export const BoardControllerContent = () => {
  const { db, status, pullFromRemote, retryNow } = useBoardSync() || {};
  const { database, loginState, churchId, userId, logout, churchIntegrations } =
    useContext(GlobalInfoContext) || {};
  const { showToast, removeToast } = useToast();
  const scrollbarWidth = useSelector(
    (state: RootState) => state.undoable.present.preferences.scrollbarWidth,
  );
  const restreamSession = useRestreamSession(churchId || "");
  const {
    session: restreamSessionData,
    isLoading: isRestreamSessionLoading,
    reload: reloadRestreamSession,
  } = restreamSession;
  const [currentBoardHighlightedCount, setCurrentBoardHighlightedCount] =
    useState(0);

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
  const [manageBoardsOpen, setManageBoardsOpen] = useState(false);
  const [boardToolsOpen, setBoardToolsOpen] = useState(false);
  const [restreamResetConfirmOpen, setRestreamResetConfirmOpen] =
    useState(false);
  const [combinedResetConfirmOpen, setCombinedResetConfirmOpen] =
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
      setCurrentBoardHighlightedCount(0);
      setIsLoading(false);
      return;
    }

    const requestId = ++loadRequestIdRef.current;
    setIsLoading(true);
    try {
      const alias = (await db.get(getAliasDocId(selectedAliasId))) as DBBoardAlias;
      const nextViewData = await getSelectedAliasViewData(
        db,
        alias,
        selectedBoardId,
      );

      if (requestId !== loadRequestIdRef.current) {
        return;
      }

      setSelectedAlias(alias);
      setBoardsById(nextViewData.boardsById);
      setPosts(nextViewData.posts);
      setCurrentBoardHighlightedCount(
        nextViewData.currentBoardHighlightedCount,
      );
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
            const selectedBoardId = selectedBoardIdRef.current;

            setSelectedAlias(updatedAlias);

            void (async () => {
              try {
                const nextViewData = await getSelectedAliasViewData(
                  db,
                  updatedAlias,
                  selectedBoardId,
                );
                if (selectedAliasIdRef.current !== updatedAlias.aliasId) return;
                setSelectedBoardId(
                  nextViewData.boardIdToView === updatedAlias.currentBoardId
                    ? ""
                    : nextViewData.boardIdToView,
                );
                setBoardsById(nextViewData.boardsById);
                setPosts(nextViewData.posts);
                setCurrentBoardHighlightedCount(
                  nextViewData.currentBoardHighlightedCount,
                );
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

  // Resets the board and Restream chat together as one confirmed action, so an
  // operator who confirms once from the combined stale-session toast doesn't
  // see the board archive immediately followed by a second, separate confirm
  // gate for Restream. Both changes land only after this single confirm.
  const handleConfirmCombinedReset = useCallback(async () => {
    if (!selectedAlias || !churchId) return;
    const aliasId = selectedAlias.aliasId;
    try {
      await hardResetBoardAlias(aliasId);
      await resetRestreamSession(churchId);
      await reloadRestreamSession();
      setSelectedBoardId("");
      setCombinedResetConfirmOpen(false);
      showToast("Started a fresh session and cleared Restream chat.", "success");
      pullFromRemote?.();
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Could not start a fresh session.",
        "error",
      );
    }
  }, [selectedAlias, churchId, reloadRestreamSession, showToast, pullFromRemote]);

  // Prompt (never force) a fresh start when either the current board or
  // Restream chat only holds content from an earlier day. Wait for both sources
  // to load before prompting so a board-only prompt cannot appear before a
  // stale Restream session is known. Confirming always resets both sources,
  // giving the operator one explicit fresh-start action.
  useEffect(() => {
    if (isLoading || isRestreamSessionLoading) return;

    const boardIsStale =
      isViewingCurrent &&
      !!currentBoard &&
      boardHasOnlyPreviousDayPosts(posts);
    const staleBoardId = boardIsStale ? currentBoard!.id : "";
    const promptBoard =
      !!staleBoardId &&
      !promptedFreshSessionBoardIdsRef.current.has(staleBoardId);

    const staleSessionId = isRestreamChatFromPreviousDay(restreamSessionData)
      ? restreamSessionData?.sessionId ?? ""
      : "";
    const promptRestream =
      !!staleSessionId &&
      !promptedRestreamResetSessionIdsRef.current.has(staleSessionId);

    if (!promptBoard && !promptRestream) return;

    if (staleBoardId) promptedFreshSessionBoardIdsRef.current.add(staleBoardId);
    if (staleSessionId) {
      promptedRestreamResetSessionIdsRef.current.add(staleSessionId);
    }

    const staleSources = [
      promptBoard ? "board" : "",
      promptRestream ? "Restream chat" : "",
    ].filter(Boolean);
    const sourceLabel = staleSources.join(" and ");

    showToast({
      message: `Earlier-day comments are still in the ${sourceLabel}. Start fresh for today?`,
      variant: "info",
      duration: 15000,
      showCloseButton: false,
      children: (toastId) => (
        <SessionResetToastAction
          keepLabel="Keep current session"
          confirmLabel="Start fresh for today"
          onKeep={() => removeToast(toastId)}
          onConfirm={() => {
            removeToast(toastId);
            setCombinedResetConfirmOpen(true);
          }}
        />
      ),
    });
  }, [
    isLoading,
    isRestreamSessionLoading,
    isViewingCurrent,
    currentBoard,
    posts,
    restreamSessionData,
    showToast,
    removeToast,
  ]);

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

  useEffect(() => {
    if (isViewingCurrent) {
      setCurrentBoardHighlightedCount(getHighlightedBoardPostCount(posts));
    }
  }, [isViewingCurrent, posts]);

  const highlightedPresentationCount = useMemo(
    () =>
      currentBoardHighlightedCount +
      filterHighlightedRestreamMessages(restreamSession.messages).length,
    [currentBoardHighlightedCount, restreamSession.messages],
  );
  const liveActivityItems = useMemo<LiveActivityItem[]>(() => {
    const boardItems: LiveActivityItem[] = posts.map((post) => ({
      id: post._id,
      source: "board",
      timestamp: post.timestamp,
      post,
    }));
    const restreamItems: LiveActivityItem[] = filterRestreamMessagesForDisplay(
      restreamSession.messages,
    ).map((message) => ({
      id: message.id,
      source: "restream",
      timestamp: message.postedAt,
      message,
    }));

    return [...boardItems, ...restreamItems].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      if (a.source !== b.source) return a.source.localeCompare(b.source);
      return a.id.localeCompare(b.id);
    });
  }, [posts, restreamSession.messages]);
  const liveActivityScrollTrigger = useMemo(
    () =>
      liveActivityItems
        .map((item) =>
          item.source === "board"
            ? `${item.source}:${item.id}:${item.post._rev ?? ""}`
            : `${item.source}:${item.id}:${item.message.isHighlighted ? 1 : 0}:${item.message.hidden ? 1 : 0}`,
        )
        .join("|"),
    [liveActivityItems],
  );
  const stickToBottomResetKey = `${selectedAliasId}:${boardIdToView}:${restreamSession.session?.sessionId ?? ""}`;
  const {
    scrollRef,
    endRef,
    onScroll,
    isPinnedToBottom,
    scrollToBottom,
  } = useStickToBottomScroll({
    scrollTrigger: liveActivityScrollTrigger,
    resetKey: stickToBottomResetKey,
  });
  const previousLiveActivityScrollTriggerRef = useRef<string | null>(null);
  const [hasNewActivity, setHasNewActivity] = useState(false);

  useEffect(() => {
    const previousTrigger = previousLiveActivityScrollTriggerRef.current;
    previousLiveActivityScrollTriggerRef.current = liveActivityScrollTrigger;
    if (
      previousTrigger !== null &&
      previousTrigger !== liveActivityScrollTrigger &&
      !isPinnedToBottom
    ) {
      setHasNewActivity(true);
    }
  }, [isPinnedToBottom, liveActivityScrollTrigger]);

  useEffect(() => {
    if (isPinnedToBottom) setHasNewActivity(false);
  }, [isPinnedToBottom]);
  const renameAlias = aliases.find((alias) => alias.aliasId === renameAliasId) ?? null;
  const showBoardDiscussionComposer =
    Boolean(selectedAliasId) &&
    isViewingCurrent &&
    loginState === "success" &&
    Boolean(String(userId || "").trim());
  const showYouTubeChatComposer =
    showBoardDiscussionComposer &&
    Boolean(churchId) &&
    Boolean(churchIntegrations?.youtube?.connected);

  let boardSyncEmptyTitle = "Connecting discussion board data…";
  let boardSyncEmptyDescription = "Loading the latest posts from the server.";
  if (status === "failed") {
    boardSyncEmptyTitle = "Could not connect discussion board data.";
    boardSyncEmptyDescription = "Check the server connection, then try again.";
  } else if (status === "paused") {
    boardSyncEmptyTitle = "Sign-in required.";
    boardSyncEmptyDescription = "Sign in again to load and moderate posts.";
  } else if (status === "retrying") {
    boardSyncEmptyTitle = "Connection failed. Retrying…";
    boardSyncEmptyDescription = "This page will keep trying automatically.";
  }

  const restreamStatusItems = (
    <>
      {restreamSession.isOffline ? (
        <p className="text-xs text-amber-100/90">
          You appear to be offline. Live messages may not update until you reconnect.
        </p>
      ) : null}
      {restreamSession.session?.streamTitle ? (
        <p className="text-sm text-gray-200">
          Stream name:{" "}
          <span className="font-semibold text-white">
            {restreamSession.session.streamTitle}
          </span>
        </p>
      ) : null}
      {!restreamSession.oauthConfigured ? (
        <p className="text-xs text-amber-100/90">
          Restream is not configured yet.
        </p>
      ) : null}
      {restreamSession.session?.connectionIssues?.length ? (
        <div className="rounded-lg border border-amber-300/20 bg-amber-950/20 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-100/90">
            Connection issues
          </p>
          <div className="mt-2 space-y-1 text-xs text-amber-100/90">
            {restreamSession.session.connectionIssues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
        </div>
      ) : null}
      {restreamSession.session?.lastError ? (
        <p className="text-xs text-amber-100/90">
          {restreamSession.session.lastError}
        </p>
      ) : null}
      {restreamSession.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-300">
          <LoaderCircle className="animate-spin" size={16} />
          Loading Restream messages…
        </div>
      ) : null}
      {restreamSession.error ? (
        <div className="rounded-xl border border-red-300/25 bg-red-950/20 p-3 text-sm text-red-100">
          {restreamSession.error}
        </div>
      ) : null}
      {!restreamSession.isLoading &&
        !restreamSession.error &&
        !restreamSession.session?.enabled ? (
        <div className="rounded-xl border border-dashed border-gray-500 bg-gray-800/50 p-3 text-sm">
          <p className="font-semibold">Restream is not connected.</p>
          <p className="mt-1 text-gray-300">
            Ask a church admin to connect Restream in Church administration under Integrations.
          </p>
        </div>
      ) : null}
    </>
  );
  const hasRestreamStatus =
    restreamSession.isOffline ||
    Boolean(restreamSession.session?.streamTitle) ||
    !restreamSession.oauthConfigured ||
    Boolean(restreamSession.session?.connectionIssues?.length) ||
    Boolean(restreamSession.session?.lastError) ||
    restreamSession.isLoading ||
    Boolean(restreamSession.error) ||
    (!restreamSession.isLoading &&
      !restreamSession.error &&
      !restreamSession.session?.enabled);

  const liveActivityContent = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-500 bg-gray-900/60 px-4 py-2">
        <div>
          <h3 className="text-base font-semibold">Live activity</h3>
          <p className="mt-0.5 text-sm text-gray-300">
            Discussion board posts and Restream chat appear in time order.
          </p>
        </div>
        {hasNewActivity ? (
          <Button variant="tertiary" onClick={scrollToBottom}>
            New activity
          </Button>
        ) : null}
      </div>
      {hasRestreamStatus ? (
        <div className="shrink-0 space-y-2 border-b border-gray-600 bg-gray-900/40 px-4 py-2">
          {restreamStatusItems}
        </div>
      ) : null}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scrollbar-variable min-h-0 flex-1 overflow-y-auto py-2 pr-4 pl-9"
      >
        {isLoading ? (
          <div className="flex items-center gap-2 text-gray-300">
            <LoaderCircle className="animate-spin" size={18} />
            Loading posts…
          </div>
        ) : liveActivityItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-500 bg-gray-800/50 p-6 text-center">
            <p className="text-lg font-semibold">No activity yet.</p>
            <p className="mt-2 text-sm text-gray-300">
              Share the board link to start receiving questions.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {liveActivityItems.map((item) => {
              if (item.source === "restream") {
                return (
                  <RestreamActivityCard
                    key={`restream:${item.id}`}
                    churchId={churchId || ""}
                    message={item.message}
                    showToast={showToast}
                    reload={restreamSession.reload}
                  />
                );
              }

              const { post } = item;
              const isModeratorPost = isWorshipSyncModeratorBoardPost(post);
              return (
                <article
                  key={`board:${post._id}`}
                  aria-label={
                    isModeratorPost
                      ? "Moderator discussion board post"
                      : "Discussion board post"
                  }
                  className={cn(
                    "relative rounded-lg border px-3 py-2.5",
                    post.deleted &&
                    "border-rose-900/50 bg-rose-950/25 ring-1 ring-rose-500/15",
                    !post.deleted &&
                    post.hidden &&
                    "border-gray-600 bg-gray-800/60 opacity-70",
                    !post.deleted &&
                    !post.hidden &&
                    "border-gray-500 bg-gray-800/90",
                  )}
                >
                  <BoardActivitySourceBadge
                    kind={isModeratorPost ? "moderator" : "discussion"}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "text-sm font-semibold",
                          (post.hidden || post.deleted) && "text-gray-400",
                          !post.hidden &&
                          !post.deleted &&
                          getBoardAuthorNameColorClass(post),
                        )}
                      >
                        {post.author}
                      </span>
                      <span className="text-[11px] text-gray-300">
                        {formatBoardTimestamp(post.timestamp)}
                      </span>
                      {post.deleted && (
                        <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-rose-100">
                          Deleted by author
                        </span>
                      )}
                      {post.highlighted && !post.deleted && (
                        <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[11px] font-semibold text-amber-200">
                          Highlighted
                        </span>
                      )}
                      {post.hidden && (
                        <span className="rounded-full bg-gray-600 px-1.5 py-0.5 text-[11px] font-semibold text-gray-100">
                          Hidden
                        </span>
                      )}
                    </div>
                    {isViewingCurrent && (
                      <div className="flex shrink-0 gap-1.5">
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
                            actingPostIds.has(post._id) ||
                            post.hidden ||
                            post.deleted
                          }
                        >
                          {post.highlighted ? "Unhighlight" : "Highlight"}
                        </Button>
                      </div>
                    )}
                  </div>
                  <div
                    className={cn(
                      "min-w-0",
                      post.deleted && "opacity-80",
                    )}
                  >
                    <BoardPostMessage
                      text={post.text}
                      isMine={false}
                      tone="moderator"
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <div ref={endRef} className="h-px shrink-0" aria-hidden />
      </div>
      {(showYouTubeChatComposer || showBoardDiscussionComposer) ? (
        <div className="sticky bottom-0 z-10 shrink-0 space-y-2">
          {showYouTubeChatComposer ? (
            <BoardYouTubeChatComposer
              churchId={churchId || ""}
              accountLabel={churchIntegrations?.youtube?.accountLabel || ""}
            />
          ) : null}
          {showBoardDiscussionComposer ? (
            <BoardDiscussionPostComposer
              aliasId={selectedAliasId}
              showToast={showToast}
              userId={String(userId || "").trim()}
              pullFromRemote={pullFromRemote}
            />
          ) : null}
        </div>
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

      {combinedResetConfirmOpen && (
        <DeleteModal
          isOpen
          onClose={() => setCombinedResetConfirmOpen(false)}
          onConfirm={() => void handleConfirmCombinedReset()}
          itemName="today's session"
          title="Start fresh for today"
          message="Are you sure you want to start fresh for"
          warningMessage="Restream chat is permanently cleared. Board posts move to history, not deleted."
          impacts={[
            "Discussion board archives its current posts and starts empty",
            "Restream chat is permanently cleared",
          ]}
          confirmText="Start fresh"
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

      <header className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-gray-500 bg-gray-800 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <BoardControllerMenu
            canOpenBoard={Boolean(selectedAliasId)}
            prepareBoardDisplay={() => {
              if (selectedAliasId) {
                setStoredBoardDisplayAliasId(selectedAliasId);
              }
            }}
          />
          <h1 className="flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
            <Icon
              svg={MessagesSquare}
              size="md"
              className="shrink-0 text-sky-400"
            />
            <span className="truncate">Discussion Board</span>
          </h1>
        </div>
        <UserSection />
      </header>

      {(isMobileStack || selectedAlias) && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-500 bg-gray-950/70 px-3 py-2">
          {isMobileStack ? (
            selectedAlias ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  svg={LayoutList}
                  gap="gap-1.5"
                  iconSize="sm"
                  className="hidden sm:flex max-md:min-h-0"
                  onClick={() => setManageBoardsOpen(true)}
                >
                  Manage boards
                </Button>
                <Button
                  variant="secondary"
                  svg={SlidersHorizontal}
                  gap="gap-1.5"
                  iconSize="sm"
                  className="hidden sm:flex max-md:min-h-0"
                  onClick={() => setBoardToolsOpen(true)}
                >
                  Board tools
                </Button>
                <Menu
                  align="start"
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
                      variant="secondary"
                      svg={MenuIcon}
                      gap="gap-1.5"
                      iconSize="sm"
                      className="sm:hidden max-md:min-h-0"
                      aria-label="Board tools and management"
                    >
                      Tools
                    </Button>
                  }
                />
              </div>
            ) : (
              <Button
                variant="secondary"
                svg={LayoutList}
                gap="gap-1.5"
                iconSize="sm"
                className="max-md:min-h-0"
                onClick={() => setManageBoardsOpen(true)}
              >
                Manage boards
              </Button>
            )
          ) : null}
          {selectedAlias ? (
            <div className="min-w-0 flex-1">
              <h2 className="min-w-0 truncate text-sm font-semibold text-gray-100 sm:text-base">
                {selectedAlias.title}
              </h2>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <p className="truncate text-xs text-gray-300 sm:text-sm">
                  Current session: {getBoardLabel(currentBoard)}
                </p>
                <div
                  className="rounded-md border border-gray-500 px-2 py-0.5 text-xs text-gray-200"
                  aria-live="polite"
                >
                  {posts.length} total · {visibleCount} visible ·{" "}
                  {highlightedPresentationCount} highlighted
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        {/* Left aside — xl+ only */}
        <aside
          className="scrollbar-variable hidden min-h-0 w-full overflow-x-hidden overflow-y-auto overscroll-contain border-b-2 border-gray-500 bg-gray-800 p-4 xl:flex xl:w-88 xl:shrink-0 xl:flex-col xl:border-b-0 xl:border-r-2"
          aria-label="Manage boards"
        >
          {manageBoardsContent}
        </aside>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!db && (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <div>
                <p className="text-lg font-semibold">{boardSyncEmptyTitle}</p>
                <p className="mt-2 text-sm text-gray-300">
                  {boardSyncEmptyDescription}
                </p>
                {status === "paused" && logout ? (
                  <Button
                    className="mt-4 justify-center"
                    variant="cta"
                    onClick={() => void logout()}
                  >
                    Sign in again
                  </Button>
                ) : null}
                {(status === "failed" || status === "retrying") && retryNow ? (
                  <Button
                    className="mt-4 justify-center"
                    onClick={() => retryNow()}
                  >
                    Try again
                  </Button>
                ) : null}
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
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {!isViewingCurrent ? (
                <p className="shrink-0 border-b border-amber-500/30 bg-amber-950/25 px-4 py-2 text-xs text-amber-100/90">
                  Posts below are from an earlier session (
                  {getBoardLabel(boardsById[boardIdToView])}).{" "}
                  {isMobileStack
                    ? "Open Board tools to switch."
                    : "Use Board tools on the right to switch."}
                </p>
              ) : null}

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
                {liveActivityContent}
              </div>
            </div>
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
