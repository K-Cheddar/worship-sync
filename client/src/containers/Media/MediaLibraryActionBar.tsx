import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Button from "../../components/Button/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/DropdownMenu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "../../components/ui/Popover";
import {
  ChevronLeft,
  Folder,
  FolderInput,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import type { Option } from "../../types";
import { MEDIA_LIBRARY_MOVE_TO_NEW_FOLDER } from "../../utils/mediaLibraryFolderOptions";
import {
  MEDIA_LIBRARY_ORANGE_FOLDER_CLASS,
  MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE,
} from "./mediaLibraryOrangeFolderIcon";
import type {
  MediaLibraryBarAction,
  MediaLibraryBarMenuEntry,
} from "./mediaLibraryActions";
import {
  MEDIA_LIBRARY_ACTION_BAR_BTN_BASE_CLASS,
  MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS,
  MEDIA_LIBRARY_ACTION_MENU_ITEM_CLASS,
  MEDIA_LIBRARY_ACTION_MENU_MOVE_ITEM_CLASS,
  MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
  MEDIA_LIBRARY_MEDIA_ACTION_RENAME_ICON_CLASS,
  classNameForMediaLibraryBarAction,
  classNameForMediaLibraryOverflowMenuItem,
} from "./mediaLibraryMediaActionUi";
import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import cn from "classnames";

export { MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS } from "./mediaLibraryMediaActionUi";

/** Controlled folder form shown in the action bar’s anchored popover (not a nested Popover). */
export type MediaLibraryFolderPopoverPanel = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  content: ReactNode;
  contentClassName: string;
};

type FolderToolbarSlot =
  | { kind: "folderNew"; panel: MediaLibraryFolderPopoverPanel }
  | { kind: "folderRename"; panel: MediaLibraryFolderPopoverPanel }
  | { kind: "folderDelete" };

function SectionColorBadge({ typeKey }: { typeKey?: string }) {
  if (!typeKey) return null;
  const bgClass =
    itemSectionBgColorMap.get(typeKey) ?? "bg-stone-600";
  return (
    <span
      className={cn(
        "size-3 shrink-0 rounded-sm shadow-sm ring-1 ring-black/40",
        bgClass,
      )}
      aria-hidden
    />
  );
}

const ACTION_GAP_PX = 4;
/** Matches `gap-2` between media action buttons in the live toolbar. */
const MEDIA_ACTION_GAP_PX = 8;
/** Matches `gap-1` between folder action buttons in the live toolbar. */
const FOLDER_ACTION_GAP_PX = 4;
/** `gap-1` between folder group, Done, and media group. */
const TOOLBAR_SECTION_GAP_PX = 4;
/** Reserve width for the More (⋯) trigger; keep in sync with mobile button height. */
const OVERFLOW_TRIGGER_PX = 52;
/** Ignore flex width until layout is real (avoids sending every action to overflow on first paint). */
const MIN_MEASURED_ROW_WIDTH_PX = 24;

const DELETE_IDS = new Set(["delete", "delete-multiple"]);

type MediaActionSlot =
  | { kind: "action"; action: MediaLibraryBarAction }
  | { kind: "renameMedia" }
  | { kind: "move" };

/** Primary actions, then Rename (single selection), then Move to folder, then Delete — overflow follows that priority. */
function buildMediaActionSlots(
  mediaActions: MediaLibraryBarAction[],
  showMoveSelect: boolean,
  showMediaRename: boolean,
): MediaActionSlot[] {
  const nonDelete = mediaActions.filter((a) => !DELETE_IDS.has(a.id));
  const deleteActions = mediaActions.filter((a) => DELETE_IDS.has(a.id));
  const slots: MediaActionSlot[] = [];
  for (const a of nonDelete) slots.push({ kind: "action", action: a });
  if (showMediaRename) slots.push({ kind: "renameMedia" });
  if (showMoveSelect) slots.push({ kind: "move" });
  for (const a of deleteActions) slots.push({ kind: "action", action: a });
  return slots;
}

function isMenuAction(
  a: MediaLibraryBarAction,
): a is MediaLibraryBarAction & { menuItems: MediaLibraryBarMenuEntry[] } {
  return Array.isArray(a.menuItems) && a.menuItems.length > 0;
}

function MediaActionDropdownMenuItems({
  items,
}: {
  items: MediaLibraryBarMenuEntry[];
}) {
  return (
    <>
      {items.map((mi) => (
        <DropdownMenuItem
          key={mi.id}
          disabled={mi.disabled}
          variant="default"
          className={MEDIA_LIBRARY_ACTION_MENU_ITEM_CLASS}
          onSelect={(e) => {
            e.preventDefault();
            mi.onClick();
          }}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {mi.sectionBadgeType ? (
              <SectionColorBadge typeKey={mi.sectionBadgeType} />
            ) : (
              <span className="size-3 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 leading-snug">{mi.label}</span>
          </span>
        </DropdownMenuItem>
      ))}
    </>
  );
}

function MoveToFolderMenuItems({
  options,
  onMoveTo,
  onPickMoveToNewFolder,
}: {
  options: Option[];
  onMoveTo: (targetFolderId: string | null) => void;
  onPickMoveToNewFolder?: () => void;
}) {
  return (
    <>
      {options.map((opt) => {
        const isNewFolderRow = opt.value === MEDIA_LIBRARY_MOVE_TO_NEW_FOLDER;
        return (
          <Fragment key={opt.value}>
            <DropdownMenuItem
              variant="default"
              className={MEDIA_LIBRARY_ACTION_MENU_MOVE_ITEM_CLASS}
              onSelect={() => {
                if (opt.value === "__root__") onMoveTo(null);
                else if (isNewFolderRow) onPickMoveToNewFolder?.();
                else onMoveTo(opt.value);
              }}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {isNewFolderRow ? (
                  <FolderPlus
                    {...MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE}
                    className={MEDIA_LIBRARY_ORANGE_FOLDER_CLASS}
                    aria-hidden
                  />
                ) : (
                  <Folder
                    {...MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE}
                    className={MEDIA_LIBRARY_ORANGE_FOLDER_CLASS}
                    aria-hidden
                  />
                )}
                <span className="min-w-0">{opt.label}</span>
              </span>
            </DropdownMenuItem>
            {isNewFolderRow ? (
              <DropdownMenuSeparator className="my-1 bg-gray-600" />
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
}

type MediaLibraryActionBarProps = {
  className?: string;
  detailsRow: React.ReactNode;
  showFolderActions: boolean;
  /** New-folder form; shown in the anchored popover when `open`. */
  folderNew?: MediaLibraryFolderPopoverPanel | null;
  /** Rename-folder form when a real folder is selected. */
  folderRename?: MediaLibraryFolderPopoverPanel | null;
  /** Rename popover for a single selected media item. */
  renameMediaContent?: React.ReactNode | null;
  /** Rename / Delete folder — only for a real folder, not library root */
  showFolderRenameDelete: boolean;
  /** Show Rename control for the selected library item (exactly one). */
  showMediaRename: boolean;
  mediaRenameOpen?: boolean;
  onMediaRenameOpenChange?: (open: boolean) => void;
  onDeleteFolder: () => void;
  mediaActions: MediaLibraryBarAction[];
  showMoveSelect: boolean;
  moveSelectOptions: Option[];
  onMoveTo: (targetFolderId: string | null) => void;
  /** Remount Move menu after move so Radix state resets cleanly */
  moveSelectResetKey?: number;
  moveToNewFolderOpen?: boolean;
  onMoveToNewFolderOpenChange?: (open: boolean) => void;
  moveToNewFolderContent?: ReactNode | null;
  /** Exit media selection mode (long-press / right-click) and clear selection. */
  showMultiSelectDone?: boolean;
  onMultiSelectDone?: () => void;
};

function sumInlineWidths(
  widths: number[],
  count: number,
  gapPx: number = ACTION_GAP_PX,
): number {
  if (count <= 0) return 0;
  let s = 0;
  for (let i = 0; i < count; i++) s += widths[i] ?? 0;
  return s + (count > 1 ? (count - 1) * gapPx : 0);
}

/** Width for a folder or media segment including optional trailing More (⋯) control. */
function segmentUsedWidth(
  widths: number[],
  inlineCount: number,
  gapPx: number,
): number {
  const total = widths.length;
  if (total === 0) return 0;
  const base = sumInlineWidths(widths, inlineCount, gapPx);
  if (inlineCount < total) {
    return base + OVERFLOW_TRIGGER_PX + ACTION_GAP_PX;
  }
  return base;
}

function toolbarUsedWidthPx(args: {
  folderWidths: number[];
  folderInline: number;
  mediaWidths: number[];
  mediaInline: number;
  wDone: number;
}): number {
  const { folderWidths, folderInline, mediaWidths, mediaInline, wDone } = args;
  const fu = segmentUsedWidth(folderWidths, folderInline, FOLDER_ACTION_GAP_PX);
  const mu = segmentUsedWidth(mediaWidths, mediaInline, MEDIA_ACTION_GAP_PX);
  const parts = [fu, wDone, mu].filter((v) => v > 0);
  if (parts.length === 0) return 0;
  return (
    parts.reduce((a, b) => a + b, 0) +
    (parts.length - 1) * TOOLBAR_SECTION_GAP_PX
  );
}

function bestToolbarSplit(
  rowWidth: number,
  folderWidths: number[],
  mediaWidths: number[],
  wDone: number,
): { folderInline: number; mediaInline: number } {
  const F = folderWidths.length;
  const M = mediaWidths.length;
  let bestScore = -1;
  let bestFolder = 0;
  let bestMedia = 0;
  for (let f = 0; f <= F; f++) {
    for (let m = 0; m <= M; m++) {
      const used = toolbarUsedWidthPx({
        folderWidths,
        folderInline: f,
        mediaWidths,
        mediaInline: m,
        wDone,
      });
      if (used <= rowWidth) {
        const score = f + m;
        if (score > bestScore) {
          bestScore = score;
          bestFolder = f;
          bestMedia = m;
        }
      }
    }
  }
  return { folderInline: bestFolder, mediaInline: bestMedia };
}

const MediaLibraryActionBar = ({
  className,
  detailsRow,
  showFolderActions,
  folderNew = null,
  folderRename = null,
  renameMediaContent = null,
  showFolderRenameDelete,
  showMediaRename,
  mediaRenameOpen = false,
  onMediaRenameOpenChange,
  onDeleteFolder,
  mediaActions,
  showMoveSelect,
  moveSelectOptions,
  onMoveTo,
  moveSelectResetKey = 0,
  moveToNewFolderOpen = false,
  onMoveToNewFolderOpenChange,
  moveToNewFolderContent = null,
  showMultiSelectDone = false,
  onMultiSelectDone,
}: MediaLibraryActionBarProps) => {
  const toolbarRowRef = useRef<HTMLDivElement>(null);
  const actionsFlexRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const doneMeasureRef = useRef<HTMLButtonElement>(null);
  const folderSlots = useMemo((): FolderToolbarSlot[] => {
    const out: FolderToolbarSlot[] = [];
    if (showFolderActions && folderNew) {
      out.push({ kind: "folderNew", panel: folderNew });
    }
    if (showFolderActions && showFolderRenameDelete && folderRename) {
      out.push({ kind: "folderRename", panel: folderRename });
    }
    if (showFolderActions && showFolderRenameDelete) {
      out.push({ kind: "folderDelete" });
    }
    return out;
  }, [showFolderActions, showFolderRenameDelete, folderNew, folderRename]);
  const mediaSlots = useMemo(
    () =>
      buildMediaActionSlots(
        mediaActions,
        showMoveSelect,
        showMediaRename,
      ),
    [mediaActions, showMoveSelect, showMediaRename],
  );
  const [folderInlineCount, setFolderInlineCount] = useState(folderSlots.length);
  const [mediaInlineCount, setMediaInlineCount] = useState(mediaSlots.length);
  /** More (⋯) menu: drill-in panels replace content (no side submenus). */
  const [overflowMenuView, setOverflowMenuView] = useState<
    "actions" | "moveFolders" | "nestedActionMenu"
  >("actions");
  const [overflowNestedMenu, setOverflowNestedMenu] = useState<{
    label: string;
    icon?: React.ReactNode;
    items: MediaLibraryBarMenuEntry[];
  } | null>(null);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const [folderOverflowMenuOpen, setFolderOverflowMenuOpen] = useState(false);
  /** Set on New folder (⋯); open anchored popover after folder overflow menu closes. */
  const pendingFolderNewAfterOverflowCloseRef = useRef(false);
  /** Set on Rename folder (⋯); open anchored popover after folder overflow menu closes. */
  const pendingFolderRenameAfterOverflowCloseRef = useRef(false);
  /** Prevent focus restore to folder More when a folder form popover is taking over. */
  const suppressFolderOverflowCloseAutoFocusRef = useRef(false);
  /** Set on Rename (⋯); open rename popover only after controlled menu reports closed. */
  const pendingMediaRenameAfterOverflowCloseRef = useRef(false);
  /** Open move-to-new-folder popover after overflow move list closes (same timing as rename). */
  const pendingMoveToNewFolderAfterOverflowCloseRef = useRef(false);
  /** Open move-to-new-folder popover after inline Move dropdown closes. */
  const pendingMoveToNewFolderAfterInlineMoveCloseRef = useRef(false);
  /** Prevent focus restore to More when the rename popover is taking over. */
  const suppressOverflowCloseAutoFocusRef = useRef(false);
  const pendingAnchoredPopoverOpenTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (pendingAnchoredPopoverOpenTimeoutRef.current != null) {
        window.clearTimeout(pendingAnchoredPopoverOpenTimeoutRef.current);
      }
    },
    [],
  );

  const handleOverflowMenuOpenChange = useCallback(
    (open: boolean) => {
      setOverflowMenuOpen(open);
      if (!open) {
        setOverflowMenuView("actions");
        setOverflowNestedMenu(null);
        if (pendingMoveToNewFolderAfterOverflowCloseRef.current) {
          pendingMoveToNewFolderAfterOverflowCloseRef.current = false;
          if (pendingAnchoredPopoverOpenTimeoutRef.current != null) {
            window.clearTimeout(pendingAnchoredPopoverOpenTimeoutRef.current);
          }
          pendingAnchoredPopoverOpenTimeoutRef.current = window.setTimeout(
            () => {
              pendingAnchoredPopoverOpenTimeoutRef.current = null;
              onMoveToNewFolderOpenChange?.(true);
            },
            0,
          );
        } else if (pendingMediaRenameAfterOverflowCloseRef.current) {
          pendingMediaRenameAfterOverflowCloseRef.current = false;
          if (pendingAnchoredPopoverOpenTimeoutRef.current != null) {
            window.clearTimeout(pendingAnchoredPopoverOpenTimeoutRef.current);
          }
          pendingAnchoredPopoverOpenTimeoutRef.current = window.setTimeout(
            () => {
              pendingAnchoredPopoverOpenTimeoutRef.current = null;
              onMediaRenameOpenChange?.(true);
            },
            0,
          );
        } else {
          suppressOverflowCloseAutoFocusRef.current = false;
        }
      } else {
        pendingMediaRenameAfterOverflowCloseRef.current = false;
        pendingMoveToNewFolderAfterOverflowCloseRef.current = false;
        suppressOverflowCloseAutoFocusRef.current = false;
      }
    },
    [onMediaRenameOpenChange, onMoveToNewFolderOpenChange],
  );

  const handleFolderOverflowMenuOpenChange = useCallback(
    (open: boolean) => {
      setFolderOverflowMenuOpen(open);
      if (!open) {
        if (pendingFolderNewAfterOverflowCloseRef.current) {
          pendingFolderNewAfterOverflowCloseRef.current = false;
          if (pendingAnchoredPopoverOpenTimeoutRef.current != null) {
            window.clearTimeout(pendingAnchoredPopoverOpenTimeoutRef.current);
          }
          pendingAnchoredPopoverOpenTimeoutRef.current = window.setTimeout(
            () => {
              pendingAnchoredPopoverOpenTimeoutRef.current = null;
              folderNew?.onOpenChange(true);
            },
            0,
          );
        } else if (pendingFolderRenameAfterOverflowCloseRef.current) {
          pendingFolderRenameAfterOverflowCloseRef.current = false;
          if (pendingAnchoredPopoverOpenTimeoutRef.current != null) {
            window.clearTimeout(pendingAnchoredPopoverOpenTimeoutRef.current);
          }
          pendingAnchoredPopoverOpenTimeoutRef.current = window.setTimeout(
            () => {
              pendingAnchoredPopoverOpenTimeoutRef.current = null;
              folderRename?.onOpenChange(true);
            },
            0,
          );
        } else {
          suppressFolderOverflowCloseAutoFocusRef.current = false;
        }
      } else {
        pendingFolderNewAfterOverflowCloseRef.current = false;
        pendingFolderRenameAfterOverflowCloseRef.current = false;
        suppressFolderOverflowCloseAutoFocusRef.current = false;
      }
    },
    [folderNew, folderRename],
  );

  const handlePickMoveToNewFolder = useCallback(() => {
    if (overflowMenuOpen && overflowMenuView === "moveFolders") {
      pendingMoveToNewFolderAfterOverflowCloseRef.current = true;
      suppressOverflowCloseAutoFocusRef.current = true;
    } else {
      pendingMoveToNewFolderAfterInlineMoveCloseRef.current = true;
    }
  }, [overflowMenuOpen, overflowMenuView]);

  const recalcToolbarLayout = useCallback(() => {
    const row = toolbarRowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) {
      setFolderInlineCount(folderSlots.length);
      setMediaInlineCount(mediaSlots.length);
      return;
    }
    const folderBtns = measure.querySelectorAll<HTMLElement>(
      "[data-measure-folder-action-btn]",
    );
    const mediaBtns = measure.querySelectorAll<HTMLElement>(
      "[data-measure-action-btn]",
    );
    const folderWidths = [...folderBtns].map((b) => b.offsetWidth);
    const mediaWidths = [...mediaBtns].map((b) => b.offsetWidth);
    const wDone =
      showMultiSelectDone && doneMeasureRef.current
        ? doneMeasureRef.current.offsetWidth
        : 0;
    const W = row.clientWidth;
    if (W < MIN_MEASURED_ROW_WIDTH_PX) {
      setFolderInlineCount(folderSlots.length);
      setMediaInlineCount(mediaSlots.length);
      return;
    }
    const { folderInline, mediaInline } = bestToolbarSplit(
      W,
      folderWidths,
      mediaWidths,
      wDone,
    );
    setFolderInlineCount(folderInline);
    setMediaInlineCount(mediaInline);
  }, [folderSlots, mediaSlots, showMultiSelectDone]);

  useLayoutEffect(() => {
    recalcToolbarLayout();
  }, [recalcToolbarLayout]);

  useLayoutEffect(() => {
    const row = toolbarRowRef.current;
    if (!row) return;
    const ro = new ResizeObserver(() => recalcToolbarLayout());
    ro.observe(row);
    return () => ro.disconnect();
  }, [recalcToolbarLayout]);

  const inlineFolderSlots = folderSlots.slice(0, folderInlineCount);
  const folderOverflowSlots = folderSlots.slice(folderInlineCount);
  const inlineMediaSlots = mediaSlots.slice(0, mediaInlineCount);
  const overflowMediaSlots = mediaSlots.slice(mediaInlineCount);
  const renameIsInInlineSlots = useMemo(
    () => inlineMediaSlots.some((s) => s.kind === "renameMedia"),
    [inlineMediaSlots],
  );
  const moveIsInInlineSlots = useMemo(
    () => inlineMediaSlots.some((s) => s.kind === "move"),
    [inlineMediaSlots],
  );
  const folderNewSlotIndex = useMemo(
    () => folderSlots.findIndex((s) => s.kind === "folderNew"),
    [folderSlots],
  );
  const folderRenameSlotIndex = useMemo(
    () => folderSlots.findIndex((s) => s.kind === "folderRename"),
    [folderSlots],
  );
  const folderNewIsInline =
    folderNewSlotIndex >= 0 && folderNewSlotIndex < folderInlineCount;
  const folderRenameIsInline =
    folderRenameSlotIndex >= 0 && folderRenameSlotIndex < folderInlineCount;

  const anchoredPopoverOpen = Boolean(
    mediaRenameOpen ||
    moveToNewFolderOpen ||
    Boolean(folderNew?.open) ||
    Boolean(folderRename?.open),
  );
  const anchoredContentAlign =
    (mediaRenameOpen && renameIsInInlineSlots) ||
      (moveToNewFolderOpen && moveIsInInlineSlots) ||
      (Boolean(folderNew?.open) && folderNewIsInline) ||
      (Boolean(folderRename?.open) && folderRenameIsInline)
      ? "start"
      : "end";

  useLayoutEffect(() => {
    if (overflowMediaSlots.length === 0) setOverflowMenuOpen(false);
  }, [overflowMediaSlots.length]);

  useLayoutEffect(() => {
    if (folderOverflowSlots.length === 0) setFolderOverflowMenuOpen(false);
  }, [folderOverflowSlots.length]);

  const renderActionButton = (a: MediaLibraryBarAction) => {
    if (isMenuAction(a)) {
      return (
        <div key={a.id} className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="tertiary"
                className={classNameForMediaLibraryBarAction(a)}
                disabled={a.disabled}
                title={a.label}
              >
                <span className="flex items-center gap-1">
                  {a.icon}
                  {a.label}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="min-w-48 text-xs [&_svg]:text-cyan-400"
            >
              <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-normal text-gray-400 [&_svg]:text-cyan-400">
                {a.icon}
                {a.label}
              </DropdownMenuLabel>
              <MediaActionDropdownMenuItems items={a.menuItems} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    }
    return (
      <Button
        key={a.id}
        variant="tertiary"
        className={classNameForMediaLibraryBarAction(a)}
        disabled={a.disabled}
        onClick={a.onClick}
        title={a.label}
      >
        <span className="flex items-center gap-1">
          {a.icon}
          {a.label}
        </span>
      </Button>
    );
  };

  const renderMoveToDropdown = (keySuffix: string) => (
    <PopoverAnchor asChild key={`move-dd-${moveSelectResetKey}-${keySuffix}`}>
      <div className="shrink-0" data-media-library-move-ui>
        <DropdownMenu
          onOpenChange={(open) => {
            if (
              !open &&
              pendingMoveToNewFolderAfterInlineMoveCloseRef.current
            ) {
              pendingMoveToNewFolderAfterInlineMoveCloseRef.current = false;
              if (pendingAnchoredPopoverOpenTimeoutRef.current != null) {
                window.clearTimeout(pendingAnchoredPopoverOpenTimeoutRef.current);
              }
              pendingAnchoredPopoverOpenTimeoutRef.current = window.setTimeout(
                () => {
                  pendingAnchoredPopoverOpenTimeoutRef.current = null;
                  onMoveToNewFolderOpenChange?.(true);
                },
                0,
              );
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="tertiary"
              className={cn(
                "shrink-0",
                MEDIA_LIBRARY_ACTION_BAR_BTN_BASE_CLASS,
              )}
              title="Choose a folder to move selected media into"
            >
              <span className="flex items-center gap-1">
                <Folder
                  {...MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE}
                  className={MEDIA_LIBRARY_ORANGE_FOLDER_CLASS}
                  aria-hidden
                />
                Move to folder
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-64 min-w-48 overflow-y-auto text-xs"
          >
            <MoveToFolderMenuItems
              options={moveSelectOptions}
              onMoveTo={onMoveTo}
              onPickMoveToNewFolder={handlePickMoveToNewFolder}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </PopoverAnchor>
  );

  const folderFormsNeedOverflowAnchor =
    (Boolean(folderNew?.open) && !folderNewIsInline) ||
    (Boolean(folderRename?.open) && !folderRenameIsInline);

  const anchoredFormSurfaceClass =
    "w-72 border border-gray-600 bg-gray-900 p-3 text-white";

  const getAnchoredPopoverClassName = (): string => {
    if (mediaRenameOpen && renameMediaContent) return anchoredFormSurfaceClass;
    if (moveToNewFolderOpen && moveToNewFolderContent) {
      return anchoredFormSurfaceClass;
    }
    if (folderRename?.open) return folderRename.contentClassName;
    if (folderNew?.open) return folderNew.contentClassName;
    return anchoredFormSurfaceClass;
  };

  const getAnchoredPopoverBody = (): ReactNode => {
    if (mediaRenameOpen && renameMediaContent) return renameMediaContent;
    if (moveToNewFolderOpen && moveToNewFolderContent) {
      return moveToNewFolderContent;
    }
    if (folderRename?.open) return folderRename.content;
    if (folderNew?.open) return folderNew.content;
    return null;
  };

  const renderFolderToolbarSlot = (slot: FolderToolbarSlot, index: number) => {
    if (slot.kind === "folderNew") {
      return (
        <PopoverAnchor asChild key={`fn-${index}`}>
          <Button
            variant="tertiary"
            className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)}
            svg={FolderPlus}
            title="New folder"
            onClick={() => slot.panel.onOpenChange(true)}
          >
            New folder
          </Button>
        </PopoverAnchor>
      );
    }
    if (slot.kind === "folderRename") {
      return (
        <PopoverAnchor asChild key={`fr-${index}`}>
          <Button
            variant="tertiary"
            className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)}
            svg={FolderInput}
            title="Rename folder"
            onClick={() => slot.panel.onOpenChange(true)}
          >
            Rename
          </Button>
        </PopoverAnchor>
      );
    }
    return (
      <Button
        key={`fd-${index}`}
        variant="tertiary"
        className={cn(
          MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS,
          "text-red-400 [&_svg]:text-red-400!",
        )}
        svg={Trash2}
        onClick={onDeleteFolder}
        title="Delete folder"
      >
        Delete folder
      </Button>
    );
  };

  const renderFolderMeasureClone = (slot: FolderToolbarSlot, index: number) => {
    if (slot.kind === "folderNew") {
      return (
        <Button
          key={`mf-${index}`}
          data-measure-folder-action-btn
          variant="tertiary"
          className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)}
          svg={FolderPlus}
          tabIndex={-1}
          aria-hidden
        >
          New folder
        </Button>
      );
    }
    if (slot.kind === "folderRename") {
      return (
        <Button
          key={`mfr-${index}`}
          data-measure-folder-action-btn
          variant="tertiary"
          className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)}
          svg={FolderInput}
          tabIndex={-1}
          aria-hidden
        >
          Rename
        </Button>
      );
    }
    return (
      <Button
        key={`mfd-${index}`}
        data-measure-folder-action-btn
        variant="tertiary"
        className={cn(
          MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS,
          "text-red-400 [&_svg]:text-red-400!",
        )}
        svg={Trash2}
        tabIndex={-1}
        aria-hidden
      >
        Delete folder
      </Button>
    );
  };

  return (
    <Popover
      open={anchoredPopoverOpen}
      onOpenChange={(open) => {
        if (!open) {
          if (mediaRenameOpen) onMediaRenameOpenChange?.(false);
          if (moveToNewFolderOpen) onMoveToNewFolderOpenChange?.(false);
          folderNew?.onOpenChange(false);
          folderRename?.onOpenChange(false);
        }
      }}
    >
      <div
        data-media-library-action-bar
        className={cn(
          "mx-2 flex flex-col gap-2 border-b border-gray-500 bg-black/60 px-2 py-2",
          className,
        )}
      >
        <div className="min-w-0 text-xs leading-snug">{detailsRow}</div>

        <div
          ref={toolbarRowRef}
          data-media-library-toolbar-row
          className="relative flex min-h-8 max-md:min-h-12 min-w-0 flex-nowrap items-center gap-1"
        >
          <div
            ref={measureRef}
            data-media-library-inline-measure-row
            className="pointer-events-none fixed left-[-9999px] top-0 z-[-1] flex flex-nowrap items-center gap-1 opacity-0"
            aria-hidden
          >
            <div className="flex flex-nowrap items-center gap-1">
              {folderSlots.map((slot, i) => renderFolderMeasureClone(slot, i))}
            </div>
            {showMultiSelectDone && onMultiSelectDone ? (
              <Button
                ref={doneMeasureRef}
                variant="tertiary"
                type="button"
                className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)}
                tabIndex={-1}
                aria-hidden
              >
                Done
              </Button>
            ) : null}
            <div className="flex flex-nowrap items-center gap-2">
              {mediaSlots.map((slot, i) =>
                slot.kind === "action" ? (
                  <Button
                    key={`m-${slot.action.id}-${i}`}
                    data-measure-action-btn
                    variant="tertiary"
                    className={classNameForMediaLibraryBarAction(slot.action)}
                    tabIndex={-1}
                    aria-hidden
                  >
                    <span className="flex items-center gap-1">
                      {slot.action.icon}
                      {slot.action.label}
                    </span>
                  </Button>
                ) : slot.kind === "renameMedia" ? (
                  <Button
                    key={`m-rename-${i}`}
                    data-measure-action-btn
                    variant="tertiary"
                    className={cn(
                      "shrink-0",
                      MEDIA_LIBRARY_ACTION_BAR_BTN_BASE_CLASS,
                    )}
                    tabIndex={-1}
                    aria-hidden
                  >
                    <span className="flex items-center gap-1">
                      <Pencil
                        className={MEDIA_LIBRARY_MEDIA_ACTION_RENAME_ICON_CLASS}
                        aria-hidden
                      />
                      Rename
                    </span>
                  </Button>
                ) : (
                  <Button
                    key={`m-move-${i}`}
                    data-measure-action-btn
                    variant="tertiary"
                    className={cn(
                      "shrink-0",
                      MEDIA_LIBRARY_ACTION_BAR_BTN_BASE_CLASS,
                    )}
                    tabIndex={-1}
                    aria-hidden
                  >
                    <span className="flex items-center gap-1">
                      <Folder
                        {...MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE}
                        className={MEDIA_LIBRARY_ORANGE_FOLDER_CLASS}
                        aria-hidden
                      />
                      Move to folder
                    </span>
                  </Button>
                ),
              )}
            </div>
          </div>

          {folderSlots.length > 0 ? (
            <div className="flex min-w-0 shrink items-center gap-1">
              {inlineFolderSlots.map((slot, i) => renderFolderToolbarSlot(slot, i))}
              {folderOverflowSlots.length > 0 ? (
                <DropdownMenu
                  open={folderOverflowMenuOpen}
                  onOpenChange={handleFolderOverflowMenuOpenChange}
                >
                  <DropdownMenuTrigger asChild>
                    {folderFormsNeedOverflowAnchor ? (
                      <PopoverAnchor asChild>
                        <Button
                          variant="tertiary"
                          className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)}
                          svg={MoreHorizontal}
                          title="More folder actions"
                          aria-label="More folder actions"
                        />
                      </PopoverAnchor>
                    ) : (
                      <Button
                        variant="tertiary"
                        className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)}
                        svg={MoreHorizontal}
                        title="More folder actions"
                        aria-label="More folder actions"
                      />
                    )}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="min-w-48 text-xs"
                    onCloseAutoFocus={(e) => {
                      if (!suppressFolderOverflowCloseAutoFocusRef.current) return;
                      suppressFolderOverflowCloseAutoFocusRef.current = false;
                      e.preventDefault();
                    }}
                  >
                    {folderOverflowSlots.map((slot) => {
                      if (slot.kind === "folderNew") {
                        return (
                          <DropdownMenuItem
                            key="folder-new-overflow"
                            variant="default"
                            className={MEDIA_LIBRARY_ACTION_MENU_ITEM_CLASS}
                            onSelect={() => {
                              pendingFolderNewAfterOverflowCloseRef.current = true;
                              suppressFolderOverflowCloseAutoFocusRef.current = true;
                            }}
                          >
                            <span className="flex items-center gap-1.5">
                              <FolderPlus
                                className={cn(
                                  MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
                                  "text-cyan-400",
                                )}
                                aria-hidden
                              />
                              New folder
                            </span>
                          </DropdownMenuItem>
                        );
                      }
                      if (slot.kind === "folderRename") {
                        return (
                          <DropdownMenuItem
                            key="folder-rename-overflow"
                            variant="default"
                            className={MEDIA_LIBRARY_ACTION_MENU_ITEM_CLASS}
                            onSelect={() => {
                              pendingFolderRenameAfterOverflowCloseRef.current = true;
                              suppressFolderOverflowCloseAutoFocusRef.current = true;
                            }}
                          >
                            <span className="flex items-center gap-1.5">
                              <FolderInput
                                className={cn(
                                  MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
                                  "text-cyan-400",
                                )}
                                aria-hidden
                              />
                              Rename
                            </span>
                          </DropdownMenuItem>
                        );
                      }
                      return (
                        <DropdownMenuItem
                          key="folder-delete-overflow"
                          variant="destructive"
                          className={cn(
                            MEDIA_LIBRARY_ACTION_MENU_ITEM_CLASS,
                            "[&_svg]:text-red-500!",
                          )}
                          onSelect={(e) => {
                            e.preventDefault();
                            onDeleteFolder();
                          }}
                        >
                          <span className="flex items-center gap-1.5">
                            <Trash2
                              className={cn(
                                MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
                                "text-red-500",
                              )}
                              aria-hidden
                            />
                            Delete folder
                          </span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          ) : null}
          {showMultiSelectDone && onMultiSelectDone ? (
            <Button
              variant="tertiary"
              type="button"
              className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)}
              onClick={onMultiSelectDone}
              title="Done selecting"
              aria-label="Done"
            >
              Done
            </Button>
          ) : null}
          <div
            ref={actionsFlexRef}
            data-media-library-actions-flex
            className="flex min-h-8 max-md:min-h-12 min-w-0 flex-1 flex-nowrap items-center gap-2"
          >
            {inlineMediaSlots.map((slot, i) => {
              if (slot.kind === "action") {
                return renderActionButton(slot.action);
              }
              if (slot.kind === "renameMedia") {
                return (
                  <PopoverAnchor asChild key={`rename-inline-${i}`}>
                    <Button
                      variant="tertiary"
                      className={cn(
                        "shrink-0",
                        MEDIA_LIBRARY_ACTION_BAR_BTN_BASE_CLASS,
                      )}
                      onClick={() => onMediaRenameOpenChange?.(true)}
                      title="Rename media"
                    >
                      <span className="flex items-center gap-1">
                        <Pencil
                          className={MEDIA_LIBRARY_MEDIA_ACTION_RENAME_ICON_CLASS}
                          aria-hidden
                        />
                        Rename
                      </span>
                    </Button>
                  </PopoverAnchor>
                );
              }
              return renderMoveToDropdown(`inline-${i}`);
            })}

            {overflowMediaSlots.length > 0 && (
              <DropdownMenu
                open={overflowMenuOpen}
                onOpenChange={handleOverflowMenuOpenChange}
              >
                <DropdownMenuTrigger asChild>
                  <PopoverAnchor asChild>
                    <Button
                      variant="tertiary"
                      className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)}
                      svg={MoreHorizontal}
                      title="More actions"
                      aria-label="More actions"
                    />
                  </PopoverAnchor>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className={cn(
                    "min-w-48 text-xs",
                    (overflowMenuView === "moveFolders" ||
                      overflowMenuView === "nestedActionMenu") &&
                    "max-h-64 overflow-y-auto",
                  )}
                  onCloseAutoFocus={(e) => {
                    if (!suppressOverflowCloseAutoFocusRef.current) return;
                    suppressOverflowCloseAutoFocusRef.current = false;
                    e.preventDefault();
                  }}
                >
                  {overflowMenuView === "actions" ? (
                    <>
                      {overflowMediaSlots.map((slot) =>
                        slot.kind === "action" ? (
                          isMenuAction(slot.action) ? (
                            <DropdownMenuItem
                              key={slot.action.id}
                              disabled={slot.action.disabled}
                              variant="default"
                              className={classNameForMediaLibraryOverflowMenuItem(
                                slot.action,
                              )}
                              onSelect={(e) => {
                                e.preventDefault();
                                const a = slot.action;
                                if (!isMenuAction(a)) return;
                                setOverflowNestedMenu({
                                  label: a.label,
                                  icon: a.icon,
                                  items: a.menuItems,
                                });
                                setOverflowMenuView("nestedActionMenu");
                              }}
                            >
                              <span className="flex items-center gap-1.5">
                                {slot.action.icon}
                                {slot.action.label}
                              </span>
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              key={slot.action.id}
                              disabled={slot.action.disabled}
                              variant="default"
                              className={classNameForMediaLibraryOverflowMenuItem(
                                slot.action,
                              )}
                              onSelect={(e) => {
                                e.preventDefault();
                                slot.action.onClick?.();
                              }}
                            >
                              <span className="flex items-center gap-1.5">
                                {slot.action.icon}
                                {slot.action.label}
                              </span>
                            </DropdownMenuItem>
                          )
                        ) : slot.kind === "renameMedia" ? (
                          <DropdownMenuItem
                            key="rename-media-overflow"
                            variant="default"
                            className={MEDIA_LIBRARY_ACTION_MENU_MOVE_ITEM_CLASS}
                            onSelect={() => {
                              // No preventDefault — menu closes; parent opens rename in
                              // handleOverflowMenuOpenChange(false) after pending ref is set.
                              pendingMediaRenameAfterOverflowCloseRef.current = true;
                              suppressOverflowCloseAutoFocusRef.current = true;
                            }}
                          >
                            <span className="flex items-center gap-1.5">
                              <Pencil
                                className={MEDIA_LIBRARY_MEDIA_ACTION_RENAME_ICON_CLASS}
                                aria-hidden
                              />
                              Rename
                            </span>
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            key="move-to-folder-overflow"
                            variant="default"
                            className={MEDIA_LIBRARY_ACTION_MENU_MOVE_ITEM_CLASS}
                            onSelect={(e) => {
                              e.preventDefault();
                              setOverflowNestedMenu(null);
                              setOverflowMenuView("moveFolders");
                            }}
                          >
                            <span className="flex items-center gap-1.5">
                              <Folder
                                {...MEDIA_LIBRARY_ORANGE_FOLDER_LUCIDE}
                                className={MEDIA_LIBRARY_ORANGE_FOLDER_CLASS}
                              />
                              Move to folder
                            </span>
                          </DropdownMenuItem>
                        ),
                      )}
                    </>
                  ) : overflowMenuView === "nestedActionMenu" &&
                    overflowNestedMenu ? (
                    <>
                      <DropdownMenuItem
                        variant="default"
                        className={MEDIA_LIBRARY_ACTION_MENU_ITEM_CLASS}
                        onSelect={(e) => {
                          e.preventDefault();
                          setOverflowMenuView("actions");
                          setOverflowNestedMenu(null);
                        }}
                      >
                        <span className="flex items-center gap-1.5">
                          <ChevronLeft
                            className={MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE}
                            aria-hidden
                          />
                          Back
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-normal text-gray-400 [&_svg]:text-cyan-400">
                        {overflowNestedMenu.icon}
                        {overflowNestedMenu.label}
                      </DropdownMenuLabel>
                      <MediaActionDropdownMenuItems
                        items={overflowNestedMenu.items}
                      />
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem
                        variant="default"
                        className={MEDIA_LIBRARY_ACTION_MENU_ITEM_CLASS}
                        onSelect={(e) => {
                          e.preventDefault();
                          setOverflowMenuView("actions");
                        }}
                      >
                        <span className="flex items-center gap-1.5">
                          <ChevronLeft
                            className={MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE}
                            aria-hidden
                          />
                          Back
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs font-normal text-gray-400">
                        Move to folder
                      </DropdownMenuLabel>
                      <MoveToFolderMenuItems
                        options={moveSelectOptions}
                        onMoveTo={onMoveTo}
                        onPickMoveToNewFolder={handlePickMoveToNewFolder}
                      />
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {(Boolean(mediaRenameOpen && renameMediaContent) ||
            Boolean(moveToNewFolderOpen && moveToNewFolderContent) ||
            Boolean(folderRename?.open && folderRename.content) ||
            Boolean(folderNew?.open && folderNew.content)) && (
              <PopoverContent
                align={anchoredContentAlign}
                className={getAnchoredPopoverClassName()}
              >
                {getAnchoredPopoverBody()}
              </PopoverContent>
            )}
        </div>
      </div>
    </Popover>
  );
};

export default MediaLibraryActionBar;
