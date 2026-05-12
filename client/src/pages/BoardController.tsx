import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import cn from "classnames";
import {
  CircleAlert,
  Copy,
  Home,
  Eye,
  EyeOff,
  LayoutList,
  LoaderCircle,
  Menu as MenuIcon,
  MessageSquarePlus,
  Minus,
  Pencil,
  Plus,
  Presentation,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  StarOff,
  Trash2,
} from "lucide-react";
import PouchDB from "pouchdb-browser";
import Button from "../components/Button/Button";
import Icon from "../components/Icon/Icon";
import Select from "../components/Select/Select";
import Menu from "../components/Menu/Menu";
import DeleteModal from "../components/Modal/DeleteModal";
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
  BOARD_PANEL_BODY,
  BOARD_PANEL_CARD,
  BOARD_PANEL_HEADER,
} from "../boards/boardPanelTheme";
import {
  deleteBoardAlias,
  hardResetBoardAlias,
  resetRestreamSession,
  softResetBoardAlias,
  updateBoardPresentationFontScale,
  updateBoardPostHidden,
  updateBoardPostHighlighted,
  updateRestreamMessageHighlighted,
} from "../boards/api";
import {
  DBBoard,
  DBBoardAlias,
  DBBoardPost,
  MenuItemType,
  Option,
  RestreamMessage,
} from "../types";
import type { WindowType } from "../types/electron";
import { getDisplayLabel } from "../utils/displayUtils";
import { isElectronDisplayWindowOpen } from "../utils/isElectronDisplayWindowOpen";
import { useAboutChangelogMenu } from "../hooks/useAboutChangelogMenu";
import {
  useRestreamSession,
  type UseRestreamSessionResult,
} from "../boards/useRestreamSession";

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

type ManageBoardsPanelBodyProps = {
  database: string | undefined;
  isActing: boolean;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onCreated: (aliasId: string) => void;
  aliases: DBBoardAlias[];
  selectedAliasId: string;
  onSelectAlias: (aliasId: string) => void;
  onRenameAlias: (aliasId: string) => void;
  onDeleteAlias: (alias: DBBoardAlias) => void;
};

const ManageBoardsPanelBody = ({
  database,
  isActing,
  runAction,
  onCreated,
  aliases,
  selectedAliasId,
  onSelectAlias,
  onRenameAlias,
  onDeleteAlias,
}: ManageBoardsPanelBodyProps) => (
  <>
    <BoardCreateDiscussionForm
      database={database}
      isActing={isActing}
      runAction={runAction}
      onCreated={onCreated}
    />
    <div className={cn("mt-4", BOARD_PANEL_CARD)}>
      <div className={BOARD_PANEL_HEADER}>
        <h2 className="text-base font-semibold">Discussion Boards</h2>
      </div>
      <div
        className={cn(
          "max-h-[55dvh] overflow-x-hidden overflow-y-auto overscroll-contain xl:max-h-[40dvh]",
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
              onClick={() => onSelectAlias(alias.aliasId)}
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
                onClick={() => onRenameAlias(alias.aliasId)}
                disabled={isActing}
              />
              <Button
                variant="destructive"
                svg={Trash2}
                padding="p-2"
                className="min-h-0!"
                aria-label={`Delete ${alias.title}`}
                onClick={() => onDeleteAlias(alias)}
                disabled={isActing}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  </>
);

const BoardControllerMenu = ({
  canOpenBoard,
  prepareBoardDisplay,
}: {
  canOpenBoard: boolean;
  prepareBoardDisplay: () => void;
}) => {
  const {
    aboutChangelogMenuItems,
    aboutChangelogModals,
    updateReadyVersion,
  } = useAboutChangelogMenu();
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
    ...aboutChangelogMenuItems,
  ];

  return (
    <>
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
            {updateReadyVersion ? (
              <Icon svg={CircleAlert} color="#f59e0b" size="sm" />
            ) : null}
          </Button>
        }
      />
      {aboutChangelogModals}
    </>
  );
};

type BoardToolsPanelBodyProps = {
  isMobileStack: boolean;
  churchId: string;
  restreamSession: UseRestreamSessionResult;
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
  onFontScaleChange: (scale: number) => void;
  runAction: (action: () => Promise<void>) => Promise<void>;
  isActing: boolean;
  showToast: (message: string, variant: "success" | "error") => void;
};

const BoardToolsPanelBody = ({
  isMobileStack,
  churchId,
  restreamSession,
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
  onFontScaleChange,
  runAction,
  isActing,
  showToast,
}: BoardToolsPanelBodyProps) => {
  const [restreamResetOpen, setRestreamResetOpen] = useState(false);
  const { session: restreamSessionState, reload: reloadRestream } =
    restreamSession;

  const handleRestreamResetConfirm = useCallback(async () => {
    if (!churchId) return;
    try {
      await resetRestreamSession(churchId);
      await reloadRestream();
      setRestreamResetOpen(false);
      showToast("Started a new Restream session.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Could not start a new Restream session.",
        "error",
      );
    }
  }, [churchId, reloadRestream, showToast]);

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
      {restreamResetOpen ? (
        <DeleteModal
          isOpen
          onClose={() => setRestreamResetOpen(false)}
          onConfirm={() => void handleRestreamResetConfirm()}
          itemName="Restream session history"
          title="Start a new Restream session"
          message="Are you sure you want to clear"
          warningMessage="This only clears the current Restream session history. Discussion board posts stay the same."
          confirmText="Start new session"
          isConfirming={false}
        />
      ) : null}

      <div className="xl:hidden">
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
          selectClassName="w-full max-xl:min-h-14"
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
              onFontScaleChange(
                presentationFontScale - BOARD_PRESENTATION_FONT_SCALE_STEP,
              )
            }
            disabled={presentationFontScale <= MIN_BOARD_PRESENTATION_FONT_SCALE}
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
              onFontScaleChange(
                DEFAULT_BOARD_PRESENTATION_FONT_SCALE,
              )
            }
            disabled={presentationFontScale === DEFAULT_BOARD_PRESENTATION_FONT_SCALE}
          >
            Reset
          </Button>
          <Button
            variant="tertiary"
            svg={Plus}
            padding="p-2"
            className="min-h-0!"
            onClick={() =>
              onFontScaleChange(
                presentationFontScale + BOARD_PRESENTATION_FONT_SCALE_STEP,
              )
            }
            disabled={presentationFontScale >= MAX_BOARD_PRESENTATION_FONT_SCALE}
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

      <div className="mt-6 border-t border-gray-600 pt-6">
        <p
          className="text-sm font-semibold text-gray-100"
          id="board-tools-restream-label"
        >
          Restream
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Clears Restream chat history for moderation. Discussion board posts stay the same.
        </p>
        <div
          className="mt-3 flex flex-col gap-1"
          role="group"
          aria-labelledby="board-tools-restream-label"
        >
          <Button
            variant="tertiary"
            className="w-full justify-center"
            svg={RotateCcw}
            aria-describedby="board-tools-restream-hint"
            onClick={() => setRestreamResetOpen(true)}
            disabled={!churchId || !restreamSessionState?.enabled}
          >
            New Restream session
          </Button>
        </div>
      </div>
    </>
  );
};

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

const filterRestreamMessagesForDisplay = (messages: RestreamMessage[]) =>
  messages.filter((message) => !isLegacyModeratorPipelineRow(message));

type RestreamTabContentProps = {
  churchId: string;
  showToast: (message: string, variant: "success" | "error") => void;
  restreamSession: UseRestreamSessionResult;
};

const RestreamTabContent = ({
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
    <div className="space-y-4">
      <div className="space-y-2">
        {session?.streamTitle ? (
          <p className="text-sm text-gray-200">
            Stream name:{" "}
            <span className="font-semibold text-white">{session.streamTitle}</span>
          </p>
        ) : null}
        {session?.enabled &&
          !session.connected &&
          session?.totalConnectionCount === 0 &&
          !session?.messageCount ? (
          <p className="text-xs text-amber-100/90">
            Restream is connected, but no live chat sources are attached yet.
          </p>
        ) : null}
        {!oauthConfigured ? (
          <p className="text-xs text-amber-100/90">
            Restream OAuth is not configured on this server yet.
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
        <div className="flex items-center gap-2 text-gray-300">
          <LoaderCircle className="animate-spin" size={18} />
          Loading Restream messages…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-300/25 bg-red-950/20 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : !session?.enabled ? (
        <div className="rounded-xl border border-dashed border-gray-500 bg-gray-800/50 p-6 text-center">
          <p className="text-lg font-semibold">Restream is not connected.</p>
          <p className="mt-2 text-sm text-gray-300">
            Ask a church admin to connect Restream in Church administration under Integrations.
          </p>
        </div>
      ) : localMessages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-500 bg-gray-800/50 p-6 text-center">
          <p className="text-lg font-semibold">No Restream messages yet.</p>
          <p className="mt-2 text-sm text-gray-300">
            New live comments will appear here as this server receives them.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {localMessages.map((message) => {
            const isModeratorReply = message.kind === "moderator_reply";
            return (
              <article
                key={message.id}
                className={cn(
                  "rounded-xl border p-4",
                  message.hidden &&
                  "border-gray-600 bg-gray-800/60 opacity-75",
                  !message.hidden && !isModeratorReply &&
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
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-50">
                        Moderator reply
                      </span>
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
                        disabled={actingIds.has(message.id) || message.hidden}
                      >
                        {message.isHighlighted ? "Unhighlight" : "Highlight"}
                      </Button>
                    </div>
                  ) : null}
                </div>
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
    </div>
  );
};

export const BoardControllerContent = () => {
  const { db, status, pullFromRemote } = useBoardSync() || {};
  const { database, loginState, churchId } = useContext(GlobalInfoContext) || {};
  const { showToast } = useToast();
  const restreamSession = useRestreamSession(churchId || "");
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
  const loadRequestIdRef = useRef(0);
  const boardIdToViewRef = useRef("");
  const selectedBoardIdRef = useRef("");
  const selectedAliasIdRef = useRef("");

  const isXlUp = useMediaQuery("(min-width: 1280px)");
  const isMobileStack = !isXlUp;

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
  const boardPostsTabContent = (
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
          ))}
        </div>
      )}
      <div ref={endRef} className="h-px shrink-0" aria-hidden />
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
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
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
                "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4",
                BOARD_PANEL_BODY,
              )}
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
                                <div className="flex items-center gap-2">
                                  <LayoutList className="size-4 text-gray-300" />
                                  Manage boards
                                </div>
                              ),
                              onClick: () => setManageBoardsOpen(true),
                            },
                            {
                              element: (
                                <div className="flex items-center gap-2">
                                  <SlidersHorizontal className="size-4 text-gray-300" />
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
                  tabsContentClassName="mt-4 min-h-0 flex-1"
                  items={[
                    {
                      value: "boardPosts",
                      label: `Board Posts (${posts.length})`,
                      description:
                        "Moderate attendee posts for the current discussion board session.",
                      content: boardPostsTabContent,
                      contentClassName: "min-h-0 flex-1",
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
                      contentClassName: "space-y-4",
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
                  "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4",
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
