import Spinner from "@/components/Spinner/Spinner";
import type { CSSProperties } from "react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import cn from "classnames";
import {
  Eye,
  EyeOff,
  ChevronDown,
  Info,
  LayoutList,
  MessagesSquare,
  SlidersHorizontal,
  Sparkles,
  StarOff,
} from "lucide-react";
import PouchDB from "pouchdb-browser";
import Button from "../components/Button/Button";
import DeleteModal from "../components/Modal/DeleteModal";
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
  boardHasOnlyPreviousDayPosts,
  isCurrentBoardView,
  isWorshipSyncModeratorBoardPost,
  setStoredBoardDisplayAliasId,
  sortBoardPostsAscending,
  getRestreamStatusIssues,
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
import RestreamSessionSuggestionBanner from "../boards/RestreamSessionSuggestionBanner";
import { BoardPostingDock } from "../boards/BoardPostingDock";
import { BoardActivitySourceBadge } from "../boards/BoardActivitySourceBadge";
import { ManageBoardsPanelBody } from "../boards/BoardControllerManageBoardsPanel";
import {
  filterRestreamMessagesForDisplay,
  RestreamActivityCard,
} from "../boards/BoardRestreamTabContent";
import {
  useRestreamSession,
} from "../boards/useRestreamSession";
import { useYouTubeConnectionStatus } from "../boards/useYouTubeConnectionStatus";
import { classifyBoardControllerChange } from "../boards/boardControllerChangeHandling";
import { getLocalBoardPosts } from "../boards/boardSyncData";

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

const getHighlightedBoardPostCount = (posts: DBBoardPost[]): number =>
  filterHighlightedBoardPosts(posts).length;

const getBoardAliasRevision = (alias: DBBoardAlias): string =>
  alias._rev || `updated-at:${alias.updatedAt}`;

const getCurrentBoardHighlightedCount = async (
  db: PouchDB.Database,
  currentBoardId: string,
  boardIdToView: string,
  viewedPosts: DBBoardPost[],
): Promise<number> => {
  if (boardIdToView === currentBoardId) {
    return getHighlightedBoardPostCount(viewedPosts);
  }

  return getHighlightedBoardPostCount(
    await getLocalBoardPosts(db, currentBoardId),
  );
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
    getLocalBoardPosts(db, boardIdToView),
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
  const { db, status, pullFromRemote, retryNow, subscribeToChanges } =
    useBoardSync() || {};
  const { database, loginState, churchId, userId, logout, churchIntegrations } =
    useContext(GlobalInfoContext) || {};
  const { showToast, removeToast } = useToast();
  const scrollbarWidth = useSelector(
    (state: RootState) => state.undoable.present.preferences.scrollbarWidth,
  );
  const restreamSession = useRestreamSession(churchId || "");
  const youtubeConnection = useYouTubeConnectionStatus(
    churchId || "",
    Boolean(loginState === "success" && churchIntegrations?.youtube?.connected),
    churchIntegrations?.youtube?.accountLabel || "",
    {
      reconcile: Boolean(
        restreamSession.session?.enabled ||
        restreamSession.session?.connected ||
        restreamSession.messages.length > 0,
      ),
    },
  );
  const { reload: reloadRestreamSession } = restreamSession;
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
  const [isConfirmingRestreamReset, setIsConfirmingRestreamReset] =
    useState(false);
  const [freshBoardConfirmTarget, setFreshBoardConfirmTarget] = useState<{
    aliasId: string;
    boardId: string;
    churchId: string;
  } | null>(null);
  const [isConfirmingFreshBoardSession, setIsConfirmingFreshBoardSession] =
    useState(false);
  const loadRequestIdRef = useRef(0);
  const activeDbRef = useRef<PouchDB.Database | undefined>(db);
  const activeDatabaseRef = useRef(database);
  const boardIdToViewRef = useRef("");
  const selectedBoardIdRef = useRef("");
  const selectedAliasIdRef = useRef("");
  const churchIdRef = useRef(churchId || "");
  const selectedAliasRevisionRef = useRef<string | null>(null);
  const selectedAliasBoardIdsRef = useRef<Set<string>>(new Set());
  const currentBoardIdRef = useRef("");
  // Toasts already queued in this mount. localStorage also carries an
  // acknowledgment across remounts for the same board session and local day.
  const promptedFreshSessionKeysRef = useRef<Set<string>>(new Set());

  activeDbRef.current = db;
  activeDatabaseRef.current = database;
  churchIdRef.current = churchId || "";

  const isXlUp = useMediaQuery("(min-width: 1280px)");
  const isMobileStack = !isXlUp;
  const isLgUp = useMediaQuery("(min-width: 1024px)");
  const { setIsMobile } = useContext(ControllerInfoContext) || {};
  useEffect(() => {
    setIsMobile?.(!isLgUp);
    return () => setIsMobile?.(false);
  }, [isLgUp, setIsMobile]);

  const [controllerViewportHeight, setControllerViewportHeight] = useState<number>();
  useEffect(() => {
    const viewport = window.visualViewport;
    const updateHeight = () => setControllerViewportHeight(viewport?.height || window.innerHeight);
    updateHeight();
    viewport?.addEventListener("resize", updateHeight);
    viewport?.addEventListener("scroll", updateHeight);
    window.addEventListener("resize", updateHeight);
    return () => {
      viewport?.removeEventListener("resize", updateHeight);
      viewport?.removeEventListener("scroll", updateHeight);
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

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
      selectedAliasRevisionRef.current = null;
      setSelectedAlias(null);
      setBoardsById({});
      setPosts([]);
      setCurrentBoardHighlightedCount(0);
      setIsLoading(false);
      return;
    }

    const requestId = ++loadRequestIdRef.current;
    const requestAliasId = selectedAliasId;
    const requestDb = db;
    const requestDatabase = database;
    let requestAliasRevision = selectedAliasRevisionRef.current;
    const isCurrentRequest = () =>
      requestId === loadRequestIdRef.current &&
      activeDbRef.current === requestDb &&
      activeDatabaseRef.current === requestDatabase &&
      selectedAliasIdRef.current === requestAliasId &&
      selectedAliasRevisionRef.current === requestAliasRevision;

    setIsLoading(true);
    try {
      const alias = (await requestDb.get(
        getAliasDocId(requestAliasId),
      )) as DBBoardAlias;
      const nextViewData = await getSelectedAliasViewData(
        requestDb,
        alias,
        selectedBoardId,
      );

      if (!isCurrentRequest()) {
        return;
      }

      requestAliasRevision = getBoardAliasRevision(alias);
      selectedAliasRevisionRef.current = requestAliasRevision;
      setSelectedAlias(alias);
      setBoardsById(nextViewData.boardsById);
      setPosts(nextViewData.posts);
      setCurrentBoardHighlightedCount(
        nextViewData.currentBoardHighlightedCount,
      );
      const nextSelectedBoardId =
        nextViewData.boardIdToView === alias.currentBoardId
          ? ""
          : nextViewData.boardIdToView;
      if (selectedBoardIdRef.current !== nextSelectedBoardId) {
        setSelectedBoardId(nextSelectedBoardId);
      }
    } catch (error) {
      if (isCurrentRequest()) {
        console.warn("Board link is not ready in local sync yet:", error);
      }
    } finally {
      if (isCurrentRequest()) {
        setIsLoading(false);
      }
    }
  }, [database, db, selectedAliasId, selectedBoardId]);

  useEffect(() => {
    selectedBoardIdRef.current = selectedBoardId;
  }, [selectedBoardId]);

  useEffect(() => {
    selectedAliasIdRef.current = selectedAliasId;
    selectedAliasRevisionRef.current = null;
  }, [selectedAliasId]);

  useEffect(() => {
    void loadAliases();
  }, [loadAliases]);

  useEffect(() => {
    if (!db) return;
    const unsubscribe = subscribeToChanges?.((change) => {
      const action = classifyBoardControllerChange(change, {
        viewedBoardId: boardIdToViewRef.current,
        currentBoardId: currentBoardIdRef.current,
        selectedAliasBoardIds: selectedAliasBoardIdsRef.current,
      });

      if (action.type === "ignore") {
        return;
      }

      if (action.type === "reload-aliases-and-selected") {
        void loadAliases();
        void loadSelectedAlias();
        return;
      }

      if (action.type === "reload-selected") {
        void loadSelectedAlias();
        return;
      }

      if (action.type === "active-board-post") {
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
        return;
      }

      // alias-doc
      if (!change.deleted && change.doc && typeof change.id === "string") {
        const updatedAlias = change.doc as unknown as DBBoardAlias;
        setAliases((prev) => {
          const idx = prev.findIndex((a) => a.aliasId === updatedAlias.aliasId);
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = updatedAlias;
            return next;
          }
          return [...prev, updatedAlias].sort((a, b) =>
            a.title.localeCompare(b.title),
          );
        });
        if (selectedAliasIdRef.current === updatedAlias.aliasId) {
          selectedAliasRevisionRef.current = getBoardAliasRevision(updatedAlias);
          setSelectedAlias(updatedAlias);
          void loadSelectedAlias();
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [db, loadAliases, loadSelectedAlias, subscribeToChanges]);

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
  currentBoardIdRef.current = selectedAlias?.currentBoardId || "";
  selectedAliasBoardIdsRef.current = selectedAlias
    ? new Set([selectedAlias.currentBoardId, ...selectedAlias.history])
    : new Set();
  const isViewingCurrent = !selectedBoardId || isCurrentBoardView(selectedAlias, selectedBoardId);
  const currentFreshBoardTarget = useMemo(
    () => selectedAlias && churchId
      ? {
          aliasId: selectedAlias.aliasId,
          boardId: selectedAlias.currentBoardId,
          churchId,
        }
      : null,
    [churchId, selectedAlias],
  );
  const isFreshBoardTargetCurrent = useCallback((target: {
    aliasId: string;
    boardId: string;
    churchId: string;
  }) =>
    selectedAliasIdRef.current === target.aliasId &&
    currentBoardIdRef.current === target.boardId &&
    selectedBoardIdRef.current === "" &&
    churchIdRef.current === target.churchId,
  []);
  const openFreshBoardConfirmation = useCallback((target: {
    aliasId: string;
    boardId: string;
    churchId: string;
  } | null) => {
    if (target && isFreshBoardTargetCurrent(target)) {
      setFreshBoardConfirmTarget(target);
    }
  }, [isFreshBoardTargetCurrent]);

  useEffect(() => {
    if (
      freshBoardConfirmTarget &&
      !isFreshBoardTargetCurrent(freshBoardConfirmTarget)
    ) {
      setFreshBoardConfirmTarget(null);
    }
  }, [freshBoardConfirmTarget, isFreshBoardTargetCurrent, selectedAliasId, selectedBoardId, churchId, selectedAlias?.currentBoardId]);
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
    if (!churchId || isConfirmingRestreamReset) return;
    setIsConfirmingRestreamReset(true);
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
    } finally {
      setIsConfirmingRestreamReset(false);
    }
  }, [churchId, isConfirmingRestreamReset, reloadRestreamSession, showToast]);

  // Automatic stream detection remains the normal Restream reset path. This
  // explicit fresh-start action resets both sources as a reliable fallback for
  // platforms that do not expose a stable broadcast identity.
  const handleConfirmFreshBoardSession = useCallback(async () => {
    const target = freshBoardConfirmTarget;
    if (!target || !isFreshBoardTargetCurrent(target) || isConfirmingFreshBoardSession) return;
    setIsConfirmingFreshBoardSession(true);
    try {
      await resetRestreamSession(target.churchId);
      await hardResetBoardAlias(target.aliasId);
      await reloadRestreamSession();
      if (isFreshBoardTargetCurrent(target)) {
        setSelectedBoardId("");
        setFreshBoardConfirmTarget(null);
        showToast("Started fresh for today and cleared earlier Restream chat.", "success");
      }
      pullFromRemote?.();
    } catch (error) {
      if (isFreshBoardTargetCurrent(target)) {
        showToast(
          error instanceof Error
            ? error.message
            : "Could not start a fresh session.",
          "error",
        );
      }
    } finally {
      setIsConfirmingFreshBoardSession(false);
    }
  }, [
    freshBoardConfirmTarget,
    isFreshBoardTargetCurrent,
    isConfirmingFreshBoardSession,
    reloadRestreamSession,
    showToast,
    pullFromRemote,
  ]);

  // Prompt (never force) a fresh start when the current board only holds
  // content from an earlier day.
  useEffect(() => {
    if (isLoading) return;

    const boardIsStale =
      isViewingCurrent &&
      !!currentBoard &&
      boardHasOnlyPreviousDayPosts(posts);
    const staleBoardId = boardIsStale ? currentBoard!.id : "";
    const today = new Date();
    const localDayKey = [today.getFullYear(), today.getMonth() + 1, today.getDate()]
      .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, "0"))
      .join("-");
    const promptKey = currentFreshBoardTarget && staleBoardId
      ? `worshipsync:fresh-session-prompt:${currentFreshBoardTarget.churchId}:${currentFreshBoardTarget.aliasId}:${staleBoardId}:${localDayKey}`
      : "";
    const promptBoard =
      !!promptKey &&
      !promptedFreshSessionKeysRef.current.has(promptKey) &&
      localStorage.getItem(promptKey) !== "acknowledged";

    if (!promptBoard) return;

    promptedFreshSessionKeysRef.current.add(promptKey);
    localStorage.setItem(promptKey, "acknowledged");

    const target = currentFreshBoardTarget;
    if (!target) return;

    showToast({
      message: "Earlier-day comments are still in the board. Start fresh for today?",
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
            openFreshBoardConfirmation(target);
          }}
        />
      ),
    });
  }, [isLoading, isViewingCurrent, currentBoard, currentFreshBoardTarget, posts, showToast, removeToast, openFreshBoardConfirmation]);

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
    youtubeConnection.connected;

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
      {churchId && restreamSession.session?.sessionSuggestion ? (
        <RestreamSessionSuggestionBanner
          churchId={churchId}
          suggestion={restreamSession.session.sessionSuggestion}
          onResolved={reloadRestreamSession}
          showToast={showToast}
        />
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
      {getRestreamStatusIssues(
        restreamSession.session?.connectionIssues,
        restreamSession.session?.lastError,
      ).length ? (
        <div className="rounded-lg border border-amber-300/20 bg-amber-950/20 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-100/90">
            Connection issues
          </p>
          <div className="mt-2 space-y-1 text-xs text-amber-100/90">
            {getRestreamStatusIssues(
              restreamSession.session?.connectionIssues,
              restreamSession.session?.lastError,
            ).map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
        </div>
      ) : null}
      {restreamSession.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-300">
          <Spinner size="sm" className="shrink-0" />
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
        !restreamSession.session?.enabled &&
        restreamSession.messages.length === 0 ? (
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
    Boolean(restreamSession.session?.sessionSuggestion) ||
    Boolean(restreamSession.session?.streamTitle) ||
    !restreamSession.oauthConfigured ||
    getRestreamStatusIssues(
      restreamSession.session?.connectionIssues,
      restreamSession.session?.lastError,
    ).length > 0 ||
    restreamSession.isLoading ||
    Boolean(restreamSession.error) ||
    (!restreamSession.isLoading &&
      !restreamSession.error &&
      !restreamSession.session?.enabled &&
      restreamSession.messages.length === 0);

  const liveActivityContent = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-[48px] shrink-0 items-center justify-between gap-2 border-b border-gray-500 bg-gray-900/60 px-3 py-0">
        <div className="flex min-w-0 items-center gap-1">
          <h3 className="truncate text-base font-semibold">Live activity</h3>
          <details className="relative shrink-0">
            <summary className="flex size-[44px] cursor-pointer list-none items-center justify-center rounded-md text-gray-300 hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400" aria-label="About live activity">
              <Info className="size-4" aria-hidden="true" />
            </summary>
            <p className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-gray-600 bg-gray-900 p-3 text-xs text-gray-200 shadow-lg">
              Discussion board posts and Restream chat appear in time order.
            </p>
          </details>
        </div>
        {!isPinnedToBottom ? (
          <Button variant="tertiary" onClick={scrollToBottom} className="min-h-[44px] shrink-0 px-2">
            {hasNewActivity ? "New activity" : "Latest activity"}
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
        role="region"
        aria-label="Live activity feed"
        className="scrollbar-variable min-h-0 flex-1 overflow-y-auto overscroll-contain py-2 pr-3 pl-9 md:pr-4"
      >
        {isLoading ? (
          <div className="flex items-center gap-2 text-gray-300">
            <Spinner size="sm" width="18px" className="shrink-0" />
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
          <div className="space-y-1.5">
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
                    "relative rounded-lg border px-2.5 py-1.5 md:px-3 md:py-2",
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
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
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
                  </div>
                  <div className="min-w-0">
                    <BoardPostMessage
                      text={post.text}
                      isMine={false}
                      tone="moderator"
                      unbounded
                    />
                  </div>
                  {isViewingCurrent && (
                    <div className="flex justify-end gap-1 pt-0.5">
                      <Button
                          variant="tertiary"
                          svg={post.hidden ? Eye : EyeOff}
                          iconSize="sm"
                          style={{ minHeight: 32, transition: "none" }}
                          className="relative min-h-7 max-md:min-h-[32px] px-1.5 py-0 text-xs transition-colors after:absolute after:-inset-y-1 after:content-['']"
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
                          iconSize="sm"
                          style={{ minHeight: 32, transition: "none" }}
                          className="relative min-h-7 max-md:min-h-[32px] px-1.5 py-0 text-xs transition-colors after:absolute after:-inset-y-1 after:content-['']"
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
                </article>
              );
            })}
          </div>
        )}
        <div ref={endRef} className="h-px shrink-0" aria-hidden />
      </div>
      <BoardPostingDock
        aliasId={selectedAliasId}
        boardSessionId={selectedAlias?.currentBoardId || ""}
        churchId={churchId || ""}
        userId={String(userId || "").trim()}
        accountLabel={youtubeConnection.accountLabel}
        showBoardPost={showBoardDiscussionComposer}
        showYouTubeChat={showYouTubeChatComposer}
        isCompact={isMobileStack}
        showToast={showToast}
        pullFromRemote={pullFromRemote}
        isFeedPinned={isPinnedToBottom}
        onFeedLayoutComplete={scrollToBottom}
      />
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
      className="flex h-dvh flex-col overflow-hidden bg-homepage-canvas text-white"
      style={
        {
          "--scrollbar-width": scrollbarWidth,
          ...(controllerViewportHeight ? { height: `${controllerViewportHeight}px`, maxHeight: `${controllerViewportHeight}px` } : {}),
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
          confirmingLabel="Clearing chat..."
          isConfirming={isConfirmingRestreamReset}
        />
      )}

      {freshBoardConfirmTarget && (
        <DeleteModal
          isOpen
          onClose={() => setFreshBoardConfirmTarget(null)}
          onConfirm={() => void handleConfirmFreshBoardSession()}
          itemName="today's session"
          title="Start fresh for today"
          message="Are you sure you want to start fresh for"
          warningMessage="Board posts move to history. Earlier Restream chat is cleared."
          impacts={[
            "Discussion board archives its current posts and starts empty",
            "Restream chat starts a new session",
          ]}
          confirmText="Start fresh"
          confirmingLabel="Starting fresh..."
          isConfirming={isConfirmingFreshBoardSession}
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

      <header data-board-toolbar className="flex h-[48px] min-h-[48px] shrink-0 items-center justify-between gap-3 border-b border-gray-600 bg-gray-800 px-2 py-0 xl:h-auto xl:min-h-0 xl:border-b-2 xl:px-4 xl:py-3">
        <div className="flex min-w-0 items-center gap-3">
          <BoardControllerMenu
            canOpenBoard={Boolean(selectedAliasId)}
            prepareBoardDisplay={() => {
              if (selectedAliasId) {
                setStoredBoardDisplayAliasId(selectedAliasId);
              }
            }}
          />
          <h1 className="hidden min-w-0 items-center gap-2 text-base font-semibold tracking-tight sm:text-lg xl:flex">
            <Icon
              svg={MessagesSquare}
              size="md"
              className="shrink-0 text-sky-400"
            />
            <span className="truncate">Discussion Board</span>
          </h1>
        </div>
        <UserSection variant="responsiveCompact" />
      </header>

      {isMobileStack ? (
        <div className="shrink-0 border-b border-gray-600 bg-gray-950/80 px-2 py-1.5">
          <div className="flex min-h-[44px] items-center justify-between gap-2">
            {selectedAlias ? (
              <Button variant="tertiary" svg={ChevronDown} iconPosition="right" className="min-h-[44px] max-md:min-h-[44px]! min-w-0 flex-1 justify-between truncate px-2 text-base font-semibold text-white" aria-label={`Manage boards. Current board: ${selectedAlias.title}`} aria-haspopup="dialog" onClick={() => setManageBoardsOpen(true)}>
                <span className="truncate">{selectedAlias.title}</span>
              </Button>
            ) : (
              <Button variant="secondary" svg={LayoutList} className="min-h-[44px] max-md:min-h-[44px]!" onClick={() => setManageBoardsOpen(true)}>Manage boards</Button>
            )}
            {selectedAlias ? <Button variant="secondary" svg={SlidersHorizontal} className="min-h-[44px] max-md:min-h-[44px]! shrink-0 px-2" onClick={() => setBoardToolsOpen(true)}>Board tools</Button> : null}
          </div>
          {selectedAlias ? <div className="space-y-1 px-1 text-xs">
            <div className="min-w-0 truncate text-gray-300">Session: {getBoardLabel(currentBoard)}</div>
            <div className="flex flex-wrap gap-1.5 tabular-nums text-gray-200" aria-live="polite">
              <span className="rounded-full border border-gray-600 px-2 py-0.5">{posts.length} total</span>
              <span className="rounded-full border border-gray-600 px-2 py-0.5">{visibleCount} visible</span>
              <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-amber-100">{highlightedPresentationCount} highlighted</span>
            </div>
          </div> : null}
        </div>
      ) : selectedAlias ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-500 bg-gray-950/70 px-3 py-2">
          <div className="min-w-0 flex-1">
            <h2 className="min-w-0 truncate text-sm font-semibold text-gray-100 sm:text-base">{selectedAlias.title}</h2>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <p className="min-w-0 truncate text-xs text-gray-300 sm:text-sm">Current session: {getBoardLabel(currentBoard)}</p>
              <div className="flex flex-wrap gap-1.5 text-xs text-gray-200" aria-live="polite">
                <span className="rounded-full border border-gray-500 px-2 py-0.5">{posts.length} total</span>
                <span className="rounded-full border border-gray-500 px-2 py-0.5">{visibleCount} visible</span>
                <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-amber-100">{highlightedPresentationCount} highlighted</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
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
