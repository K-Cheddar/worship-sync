import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import cn from "classnames";
import {
  Copy,
  Home,
  Eye,
  EyeOff,
  LoaderCircle,
  Menu as MenuIcon,
  MessageSquarePlus,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Presentation,
  RotateCcw,
  Sparkles,
  StarOff,
  Trash2,
} from "lucide-react";
import PouchDB from "pouchdb-browser";
import Button from "../components/Button/Button";
import Select from "../components/Select/Select";
import Menu from "../components/Menu/Menu";
import DeleteModal from "../components/Modal/DeleteModal";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../components/ui/sheet";
import UserSection from "../containers/Toolbar/ToolbarElements/UserSection";
import { useToast } from "../context/toastContext";
import { GlobalInfoContext } from "../context/globalInfo";
import { useElectronWindows } from "../hooks/useElectronWindows";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useStickToBottomScroll } from "../hooks/useStickToBottomScroll";
import BoardSyncProvider, { useBoardSync } from "../boards/BoardSyncContext";
import { BoardCreateDiscussionForm } from "../boards/BoardCreateDiscussionForm";
import { BoardRenameModal } from "../boards/BoardRenameModal";
import { BoardPostMessage } from "../boards/BoardPostMessage";
import {
  BOARD_PRESENTATION_FONT_SCALE_STEP,
  buildBoardDisplayRoute,
  buildBoardDisplayUrl,
  buildBoardPublicUrl,
  DEFAULT_BOARD_PRESENTATION_FONT_SCALE,
  filterVisibleBoardPosts,
  formatBoardTimestamp,
  getAliasDocId,
  getBoardAuthorNameColorClass,
  getBoardDocId,
  getBoardLabel,
  MAX_BOARD_PRESENTATION_FONT_SCALE,
  MIN_BOARD_PRESENTATION_FONT_SCALE,
  normalizeBoardPresentationFontScale,
  getBoardPostRange,
  isCurrentBoardView,
  setStoredBoardDisplayAliasId,
  sortBoardPostsAscending,
} from "../boards/boardUtils";
import {
  deleteBoardAlias,
  hardResetBoardAlias,
  softResetBoardAlias,
  updateBoardPresentationFontScale,
  updateBoardPostHidden,
  updateBoardPostHighlighted,
} from "../boards/api";
import {
  BOARD_PANEL_BODY,
  BOARD_PANEL_CARD,
  BOARD_PANEL_HEADER,
} from "../boards/boardPanelTheme";
import {
  DBBoard,
  DBBoardAlias,
  DBBoardPost,
  MenuItemType,
  Option,
} from "../types";
import type { WindowType } from "../types/electron";
import { getDisplayLabel } from "../utils/displayUtils";
import { isElectronDisplayWindowOpen } from "../utils/isElectronDisplayWindowOpen";

const BOARD_COPY_LINK_ICON_COLOR = "#22d3ee";

type BoardShareLinkGroupProps = {
  heading: string;
  onCopy: () => void | Promise<void>;
  onView: () => void;
  disabled: boolean;
  className?: string;
};

const BoardShareLinkGroup = ({
  heading,
  onCopy,
  onView,
  disabled,
  className,
}: BoardShareLinkGroupProps) => (
  <div
    className={cn(
      "w-fit max-w-full shrink-0 rounded-lg border border-gray-600 bg-gray-900/50 p-3",
      className,
    )}
  >
    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
      {heading}
    </p>
    <div className="mt-2 flex flex-row flex-wrap gap-2">
      <Button
        type="button"
        variant="primary"
        svg={Copy}
        color={BOARD_COPY_LINK_ICON_COLOR}
        onClick={() => void onCopy()}
        disabled={disabled}
        className="w-fit shrink-0 justify-center px-3"
      >
        Copy
      </Button>
      <Button
        type="button"
        variant="secondary"
        svg={Eye}
        color={BOARD_COPY_LINK_ICON_COLOR}
        onClick={onView}
        disabled={disabled}
        className="w-fit shrink-0 justify-center px-3"
      >
        View
      </Button>
    </div>
  </div>
);

type AllDocsResult<T> = {
  rows: Array<{ doc?: T }>;
};

const getAliasDocs = async (
  db: PouchDB.Database,
  database: string,
): Promise<DBBoardAlias[]> => {
  const result = (await db.allDocs({
    include_docs: true,
    startkey: "alias:",
    endkey: "alias:\uffff",
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

const BoardControllerMenu = ({
  canOpenBoard,
  prepareBoardDisplay,
}: {
  canOpenBoard: boolean;
  prepareBoardDisplay: () => void;
}) => {
  const {
    isElectron,
    displays,
    windowStates,
    openWindow,
    closeWindow,
    focusWindow,
    moveWindowToDisplay,
    setDisplayPreference,
  } = useElectronWindows();

  const boardWindowOpen = isElectronDisplayWindowOpen(
    isElectron,
    windowStates,
    "board",
  );

  const openWindowOnLastUsedDisplay = async (windowType: WindowType) => {
    prepareBoardDisplay();
    try {
      if (isElectron) {
        await openWindow(windowType);
      } else {
        const webRoute =
          windowType === "board" ? buildBoardDisplayRoute() : "/projector";
        const webTarget = windowType === "board" ? "_board" : "_projector";
        const webUrl =
          windowType === "board" ? buildBoardDisplayUrl() : `#${webRoute}`;
        window.open(webUrl, webTarget, "width=1280,height=720");
      }
    } catch (error) {
      console.error(error);
    }
  };

  const openWindowOnDisplay = async (
    windowType: WindowType,
    displayId: number,
  ) => {
    prepareBoardDisplay();
    try {
      if (!isElectron) {
        await openWindowOnLastUsedDisplay(windowType);
        return;
      }

      const moved = await moveWindowToDisplay(windowType, displayId);
      if (moved) {
        await focusWindow(windowType);
        return;
      }

      await setDisplayPreference(windowType, displayId);
      await openWindow(windowType);
    } catch (error) {
      console.error(error);
    }
  };

  const buildDisplaySubItems = (windowType: WindowType) => [
    {
      text: "Last Used Display",
      onClick: () => openWindowOnLastUsedDisplay(windowType),
    },
    ...displays.map((display, index) => ({
      text: getDisplayLabel(display, index),
      onClick: () => openWindowOnDisplay(windowType, display.id),
    })),
  ];

  const menuItems: MenuItemType[] = [
    {
      element: (
        <div className="flex items-center gap-2">
          <Home className="size-4 text-gray-300" />
          Home
        </div>
      ),
      to: "/",
    },
    canOpenBoard || boardWindowOpen
      ? {
        text: boardWindowOpen ? "Close Board" : "Open Board",
        element: (
          <div className="flex items-center gap-2">
            <Presentation className="size-4 text-gray-300" />
            {boardWindowOpen ? "Close Board" : "Open Board"}
          </div>
        ),
        ...(boardWindowOpen
          ? {
            onClick: async () => {
              await closeWindow("board");
            },
          }
          : isElectron && displays.length > 0
            ? {
              subItems: buildDisplaySubItems("board"),
            }
            : {
              onClick: async () => {
                await openWindowOnLastUsedDisplay("board");
              },
            }),
      }
      : {
        text: "Open Board",
        element: (
          <div className="flex items-center gap-2 opacity-60">
            <Presentation className="size-4 text-gray-300" />
            Open Board
          </div>
        ),
        disabled: true,
      },
  ];

  return (
    <Menu
      menuItems={menuItems}
      align="start"
      TriggeringButton={
        <Button
          variant="tertiary"
          className="w-fit"
          aria-label="Open menu"
          svg={MenuIcon}
          gap="gap-1.5"
        >
          Menu
        </Button>
      }
    />
  );
};

type BoardToolsPanelBodyProps = {
  isMobileStack: boolean;
  handleCopy: (value: string, label: string) => Promise<void>;
  onOpenAttendeeLink: () => void;
  onOpenViewBoardLink: () => void;
  publicBoardUrl: string;
  publicPresentUrl: string;
  boardIdToView: string;
  setSelectedBoardId: (value: string) => void;
  selectedAlias: DBBoardAlias;
  boardsById: Record<string, DBBoard>;
  archiveOptions: string[];
  isViewingCurrent: boolean;
  presentationFontScale: number;
  runAction: (action: () => Promise<void>) => Promise<void>;
  isActing: boolean;
  showToast: (message: string, variant: "success" | "error") => void;
};

const BoardToolsPanelBody = ({
  isMobileStack,
  handleCopy,
  onOpenAttendeeLink,
  onOpenViewBoardLink,
  publicBoardUrl,
  publicPresentUrl,
  boardIdToView,
  setSelectedBoardId,
  selectedAlias,
  boardsById,
  archiveOptions,
  isViewingCurrent,
  presentationFontScale,
  runAction,
  isActing,
  showToast,
}: BoardToolsPanelBodyProps) => {
  const historyOptions: Option[] = useMemo(
    () =>
      archiveOptions.map((boardId) => ({
        value: boardId,
        label: `${boardId === selectedAlias.currentBoardId ? "Current session" : "Earlier session"}: ${getBoardLabel(boardsById[boardId])}`,
      })),
    [archiveOptions, boardsById, selectedAlias.currentBoardId],
  );

  return (
    <>
      <div className="lg:hidden">
        <p className="text-sm font-semibold text-gray-100" id="board-tools-share-label">
          Share links
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Copy or open the attendee page and the presentation screen. Links stay the same when you start a new session.
        </p>
        <div
          className="mt-3 flex flex-col items-start gap-3"
          role="group"
          aria-labelledby="board-tools-share-label"
        >
          <BoardShareLinkGroup
            heading="Attendee link"
            onCopy={() => handleCopy(publicBoardUrl, "Attendee link")}
            onView={onOpenAttendeeLink}
            disabled={!publicBoardUrl}
          />
          <BoardShareLinkGroup
            heading="Board link"
            onCopy={() => handleCopy(publicPresentUrl, "Board link")}
            onView={onOpenViewBoardLink}
            disabled={!publicPresentUrl}
          />
        </div>
      </div>

      <div
        className={cn(
          isMobileStack && "mt-6 border-t border-gray-600 pt-6",
        )}
      >
        <label
          className="text-sm font-semibold text-gray-100"
          htmlFor="board-history-select"
          id="board-tools-history-label"
        >
          Show posts from
        </label>
        <p className="mt-1 text-xs text-gray-400">
          Choose which session appears in the list of posts.
        </p>
        <Select
          className="mt-2 w-full"
          id="board-history-select"
          options={historyOptions}
          value={boardIdToView}
          onChange={(value) =>
            setSelectedBoardId(
              value === selectedAlias.currentBoardId ? "" : value,
            )
          }
          selectClassName="w-full max-md:min-h-14"
        />
        {!isViewingCurrent && (
          <Button
            className="mt-3 w-full justify-center"
            variant="tertiary"
            onClick={() => setSelectedBoardId("")}
          >
            Return to current session
          </Button>
        )}
      </div>

      <div className="mt-6 border-t border-gray-600 pt-6">
        <p className="text-sm font-semibold text-gray-100" id="board-tools-presentation-label">
          Presentation text
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Size on the presentation screen when posts are highlighted.
        </p>
        <div
          className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-600 bg-gray-900/60 px-3 py-2"
          role="group"
          aria-labelledby="board-tools-presentation-label"
        >
          <Button
            variant="tertiary"
            svg={Minus}
            padding="p-2"
            className="min-h-0!"
            onClick={() =>
              runAction(async () => {
                await updateBoardPresentationFontScale(
                  selectedAlias.aliasId,
                  presentationFontScale -
                  BOARD_PRESENTATION_FONT_SCALE_STEP,
                );
                showToast("Presentation text made smaller.", "success");
              })
            }
            disabled={
              isActing ||
              presentationFontScale <= MIN_BOARD_PRESENTATION_FONT_SCALE
            }
          />
          <span className="min-w-14 text-center text-sm font-semibold text-white">
            {Math.round(presentationFontScale * 100)}%
          </span>
          <Button
            variant="tertiary"
            padding="px-3 py-2"
            className="min-h-0!"
            aria-label="Reset presentation text size"
            onClick={() =>
              runAction(async () => {
                await updateBoardPresentationFontScale(
                  selectedAlias.aliasId,
                  DEFAULT_BOARD_PRESENTATION_FONT_SCALE,
                );
                showToast("Presentation text reset.", "success");
              })
            }
            disabled={
              isActing ||
              presentationFontScale === DEFAULT_BOARD_PRESENTATION_FONT_SCALE
            }
          >
            Reset
          </Button>
          <Button
            variant="tertiary"
            svg={Plus}
            padding="p-2"
            className="min-h-0!"
            onClick={() =>
              runAction(async () => {
                await updateBoardPresentationFontScale(
                  selectedAlias.aliasId,
                  presentationFontScale +
                  BOARD_PRESENTATION_FONT_SCALE_STEP,
                );
                showToast("Presentation text made larger.", "success");
              })
            }
            disabled={
              isActing ||
              presentationFontScale >= MAX_BOARD_PRESENTATION_FONT_SCALE
            }
          />
        </div>
      </div>

      <div className="mt-6 border-t border-gray-600 pt-6">
        <p className="text-sm font-semibold text-gray-100" id="board-tools-session-label">
          Session actions
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Share links stay the same.
        </p>
        <div
          className="mt-3 flex flex-col gap-4"
          role="group"
          aria-labelledby="board-tools-session-label"
        >
          <div className="flex flex-col gap-1">
            <Button
              className="w-full justify-center"
              svg={RotateCcw}
              aria-describedby="board-session-clear-hint"
              onClick={() =>
                runAction(async () => {
                  await softResetBoardAlias(selectedAlias.aliasId);
                  showToast("All posts removed.", "success");
                })
              }
              disabled={isActing || !isViewingCurrent}
            >
              Clear all posts
            </Button>
            <p
              id="board-session-clear-hint"
              className="text-xs leading-snug text-gray-400"
            >
              Remove every post from this session. Share links stay the same.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <Button
              variant="cta"
              className="w-full justify-center"
              svg={MessageSquarePlus}
              aria-describedby="board-session-new-hint"
              onClick={() =>
                runAction(async () => {
                  await hardResetBoardAlias(selectedAlias.aliasId);
                  setSelectedBoardId("");
                  showToast("New session started.", "success");
                })
              }
              disabled={isActing || !isViewingCurrent}
            >
              Start new session
            </Button>
            <p
              id="board-session-new-hint"
              className="text-xs leading-snug text-gray-400"
            >
              Start a new empty session with the same link. Earlier sessions and posts stay in the list above.
            </p>
          </div>
        </div>
        {!isViewingCurrent && (
          <p className="mt-3 text-xs text-amber-100/90">
            Switch to the current session to clear posts or start a new session.
          </p>
        )}
      </div>
    </>
  );
};

export const BoardControllerContent = () => {
  const { db, status, pullFromRemote } = useBoardSync() || {};
  const { database, loginState } = useContext(GlobalInfoContext) || {};
  const { showToast } = useToast();

  const [aliases, setAliases] = useState<DBBoardAlias[]>([]);
  const [selectedAliasId, setSelectedAliasId] = useState<string>("");
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [selectedAlias, setSelectedAlias] = useState<DBBoardAlias | null>(null);
  const [boardsById, setBoardsById] = useState<Record<string, DBBoard>>({});
  const [posts, setPosts] = useState<DBBoardPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);
  const [renameAliasId, setRenameAliasId] = useState("");
  const [deleteAlias, setDeleteAlias] = useState<DBBoardAlias | null>(null);
  const [mobileBoardPanel, setMobileBoardPanel] = useState<"manage" | "live">(
    "manage",
  );
  const loadRequestIdRef = useRef(0);

  const isLgUp = useMediaQuery("(min-width: 1024px)");
  const isMobileStack = !isLgUp;
  const hideAsideOnMobile =
    isMobileStack && (mobileBoardPanel === "live" || !db);
  const hideSectionOnMobile =
    isMobileStack && mobileBoardPanel === "manage" && Boolean(db);

  const loadAliases = useCallback(async () => {
    if (!db || !database) return;
    const nextAliases = await getAliasDocs(db, database);
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
    void loadAliases();
  }, [loadAliases]);

  useEffect(() => {
    if (!db) return;
    const changes = db
      .changes({ since: "now", live: true })
      .on("change", () => {
        void loadAliases();
        void loadSelectedAlias();
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
    if (isMobileStack && !selectedAliasId) {
      setMobileBoardPanel("manage");
    }
  }, [isMobileStack, selectedAliasId]);

  const currentBoard = selectedAlias
    ? boardsById[selectedAlias.currentBoardId]
    : undefined;
  const boardIdToView = selectedBoardId || selectedAlias?.currentBoardId || "";
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

  const handleBoardCreated = useCallback(
    (aliasId: string) => {
      setSelectedAliasId(aliasId);
      setSelectedBoardId("");
      if (isMobileStack) {
        setMobileBoardPanel("live");
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

  return (
    <main
      id="controller-main"
      className="flex h-dvh flex-col bg-homepage-canvas text-white"
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

      {isMobileStack && db && (
        <div
          role="tablist"
          aria-label="Discussion board views"
          className="flex shrink-0 border-b-2 border-gray-500 bg-gray-800 px-4 py-2 lg:hidden"
        >
          <div className="inline-flex w-full rounded-lg border border-gray-600 bg-gray-900/70 p-1">
            <button
              type="button"
              role="tab"
              aria-selected={mobileBoardPanel === "manage"}
              className={cn(
                "min-h-11 flex-1 rounded-md px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400",
                mobileBoardPanel === "manage"
                  ? "bg-gray-800 text-white shadow"
                  : "text-gray-400 hover:text-white",
              )}
              onClick={() => setMobileBoardPanel("manage")}
            >
              Boards
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobileBoardPanel === "live"}
              disabled={!selectedAliasId}
              className={cn(
                "min-h-11 flex-1 rounded-md px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400",
                mobileBoardPanel === "live"
                  ? "bg-gray-800 text-white shadow"
                  : "text-gray-400 hover:text-white",
                !selectedAliasId && "cursor-not-allowed opacity-50",
              )}
              onClick={() => {
                if (selectedAliasId) {
                  setMobileBoardPanel("live");
                }
              }}
            >
              Live
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside
          className={cn(
            "w-full border-b-2 border-gray-500 bg-gray-800 p-4 lg:w-88 lg:border-b-0 lg:border-r-2",
            hideAsideOnMobile && "hidden",
          )}
        >
          <BoardCreateDiscussionForm
            database={database}
            isActing={isActing}
            runAction={runAction}
            onCreated={handleBoardCreated}
          />

          <div className={cn("mt-4", BOARD_PANEL_CARD)}>
            <div className={BOARD_PANEL_HEADER}>
              <h2 className="text-base font-semibold">Discussion Boards</h2>
            </div>
            <div
              className={cn(
                "max-h-[55dvh] overflow-x-hidden overflow-y-auto overscroll-contain lg:max-h-[40dvh]",
                BOARD_PANEL_BODY,
              )}
            >
              {aliases.length === 0 && (
                <p className="px-4 py-4 text-sm text-gray-300">
                  No discussion boards yet.
                </p>
              )}
              {aliases.map((alias) => (
                <div
                  key={alias.aliasId}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 border-b border-gray-600 border-l-4 px-4 py-3 transition-colors last:border-b-0",
                    selectedAliasId === alias.aliasId
                      ? "border-l-cyan-500 bg-gray-900/55 hover:bg-gray-900/70"
                      : "border-l-transparent bg-gray-700/35 hover:bg-gray-700/50",
                  )}
                >
                  <button
                    type="button"
                    aria-current={selectedAliasId === alias.aliasId ? "true" : undefined}
                    className="min-w-0 flex-1 cursor-pointer overflow-hidden text-left transition-colors hover:text-white"
                    title={`${alias.title} (${alias.aliasId})`}
                    onClick={() => {
                      setSelectedAliasId(alias.aliasId);
                      setSelectedBoardId("");
                      if (isMobileStack) {
                        setMobileBoardPanel("live");
                      }
                    }}
                  >
                    <span className="block truncate font-semibold leading-snug">
                      {alias.title}
                    </span>
                    <span className="block truncate font-mono text-xs text-gray-400">
                      {alias.aliasId}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="tertiary"
                      svg={Pencil}
                      padding="p-2"
                      className="min-h-0!"
                      aria-label={`Rename ${alias.title}`}
                      onClick={() => setRenameAliasId(alias.aliasId)}
                      disabled={isActing}
                    />
                    <Button
                      variant="destructive"
                      svg={Trash2}
                      padding="p-2"
                      className="min-h-0!"
                      aria-label={`Delete ${alias.title}`}
                      onClick={() => setDeleteAlias(alias)}
                      disabled={isActing}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            hideSectionOnMobile && "hidden",
          )}
        >
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
                    <div
                      className="rounded-md border border-gray-500 px-3 py-1.5 text-sm text-gray-200"
                      aria-live="polite"
                    >
                      {posts.length} total · {visibleCount} visible
                    </div>
                    {isMobileStack && (
                      <Sheet>
                        <SheetTrigger asChild>
                          <Button
                            variant="tertiary"
                            svg={MoreHorizontal}
                            className="justify-center"
                            aria-label="More board tools"
                          >
                            More tools
                          </Button>
                        </SheetTrigger>
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
                              "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4",
                              BOARD_PANEL_BODY,
                            )}
                          >
                            <BoardToolsPanelBody
                              isMobileStack={isMobileStack}
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
                              runAction={runAction}
                              isActing={isActing}
                              showToast={showToast}
                            />
                          </div>
                        </SheetContent>
                      </Sheet>
                    )}
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="mt-1 text-sm text-gray-300">
                    Current session: {getBoardLabel(currentBoard)}
                  </p>
                  <p className="mt-2 hidden text-sm text-gray-300 lg:block">
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
                  <div className="mt-3 hidden flex-wrap items-start gap-3 lg:flex">
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

              <div
                ref={scrollRef}
                onScroll={onScroll}
                className="min-h-0 flex-1 overflow-y-auto p-4"
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
                    {posts.map((post) => (
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
                          "border-gray-500 bg-gray-800/90",
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
                                onClick={() =>
                                  runAction(async () => {
                                    await updateBoardPostHidden(post._id, !post.hidden);
                                  })
                                }
                                disabled={isActing || post.deleted}
                              >
                                {post.hidden ? "Unhide" : "Hide"}
                              </Button>
                              <Button
                                variant="tertiary"
                                svg={post.highlighted ? StarOff : Sparkles}
                                onClick={() =>
                                  runAction(async () => {
                                    await updateBoardPostHighlighted(
                                      post._id,
                                      !post.highlighted,
                                    );
                                  })
                                }
                                disabled={isActing || post.hidden || post.deleted}
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
                          <BoardPostMessage
                            text={post.text}
                            isMine={false}
                            tone="moderator"
                          />
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                <div ref={endRef} className="h-px shrink-0" aria-hidden />
              </div>
            </>
          )}
        </section>

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
                  "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4",
                  BOARD_PANEL_BODY,
                )}
              >
                <BoardToolsPanelBody
                  isMobileStack={false}
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
