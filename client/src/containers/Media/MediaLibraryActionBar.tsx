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
  /** Each wraps `PopoverTrigger` + `PopoverContent` (same pattern as new-folder flow). */
  newFolderPopover: React.ReactNode;
  /** Rename popover; omit when not in a folder. */
  renameFolderPopover?: React.ReactNode | null;
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

function sumInlineWidths(widths: number[], count: number): number {
  if (count <= 0) return 0;
  let s = 0;
  for (let i = 0; i < count; i++) s += widths[i] ?? 0;
  return s + (count > 1 ? (count - 1) * ACTION_GAP_PX : 0);
}

const MediaLibraryActionBar = ({
  className,
  detailsRow,
  showFolderActions,
  newFolderPopover,
  renameFolderPopover = null,
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
  const actionsFlexRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const slots = useMemo(
    () =>
      buildMediaActionSlots(
        mediaActions,
        showMoveSelect,
        showMediaRename,
      ),
    [mediaActions, showMoveSelect, showMediaRename],
  );
  const [inlineCount, setInlineCount] = useState(slots.length);
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

  const handlePickMoveToNewFolder = useCallback(() => {
    if (overflowMenuOpen && overflowMenuView === "moveFolders") {
      pendingMoveToNewFolderAfterOverflowCloseRef.current = true;
      suppressOverflowCloseAutoFocusRef.current = true;
    } else {
      pendingMoveToNewFolderAfterInlineMoveCloseRef.current = true;
    }
  }, [overflowMenuOpen, overflowMenuView]);

  const recalcInline = useCallback(() => {
    const flex = actionsFlexRef.current;
    const measure = measureRef.current;
    if (!flex || !measure || slots.length === 0) {
      setInlineCount(slots.length);
      return;
    }
    const buttons = measure.querySelectorAll<HTMLElement>(
      "[data-measure-action-btn]",
    );
    const widths = [...buttons].map((b) => b.offsetWidth);
    const available = flex.clientWidth;

    if (available < MIN_MEASURED_ROW_WIDTH_PX) {
      setInlineCount(slots.length);
      return;
    }

    let n = widths.length;
    while (n >= 0) {
      const needOverflowMenu = n < widths.length;
      const reserve = needOverflowMenu ? OVERFLOW_TRIGGER_PX + ACTION_GAP_PX : 0;
      const used = sumInlineWidths(widths, n) + reserve;
      if (used <= available || n === 0) {
        setInlineCount(n);
        break;
      }
      n -= 1;
    }
  }, [slots]);

  useLayoutEffect(() => {
    recalcInline();
  }, [recalcInline, slots]);

  useLayoutEffect(() => {
    const flex = actionsFlexRef.current;
    if (!flex) return;
    const ro = new ResizeObserver(() => recalcInline());
    ro.observe(flex);
    return () => ro.disconnect();
  }, [recalcInline]);

  const inlineSlots = slots.slice(0, inlineCount);
  const overflowSlots = slots.slice(inlineCount);
  const renameIsInInlineSlots = useMemo(
    () => inlineSlots.some((s) => s.kind === "renameMedia"),
    [inlineSlots],
  );
  const moveIsInInlineSlots = useMemo(
    () => inlineSlots.some((s) => s.kind === "move"),
    [inlineSlots],
  );

  const anchoredPopoverOpen = Boolean(mediaRenameOpen || moveToNewFolderOpen);
  const anchoredContentAlign =
    (mediaRenameOpen && renameIsInInlineSlots) ||
      (moveToNewFolderOpen && moveIsInInlineSlots)
      ? "start"
      : "end";

  useLayoutEffect(() => {
    if (overflowSlots.length === 0) setOverflowMenuOpen(false);
  }, [overflowSlots.length]);

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

  return (
    <Popover
      open={anchoredPopoverOpen}
      onOpenChange={(open) => {
        if (!open) {
          if (mediaRenameOpen) onMediaRenameOpenChange?.(false);
          if (moveToNewFolderOpen) onMoveToNewFolderOpenChange?.(false);
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

        <div className="relative flex min-h-8 max-md:min-h-12 min-w-0 flex-wrap items-center gap-1">
          {showFolderActions && (
            <>
              {newFolderPopover}
              {showFolderRenameDelete && renameFolderPopover}
              {showFolderRenameDelete && (
                <Button
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
              )}
            </>
          )}
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
            className="flex min-h-8 max-md:min-h-12 min-w-0 flex-1 items-center gap-2"
          >
            <div
              ref={measureRef}
              data-media-library-inline-measure-row
              className="pointer-events-none fixed left-[-9999px] top-0 z-[-1] flex gap-1 opacity-0"
              aria-hidden
            >
              {slots.map((slot, i) =>
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

            {inlineSlots.map((slot, i) => {
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

            {overflowSlots.length > 0 && (
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
                      {overflowSlots.map((slot) =>
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
          {((showMediaRename && renameMediaContent && mediaRenameOpen) ||
            (moveToNewFolderOpen && moveToNewFolderContent)) && (
              <PopoverContent
                align={anchoredContentAlign}
                className="w-72 border border-gray-600 bg-gray-900 p-3 text-white"
              >
                {mediaRenameOpen ? renameMediaContent : moveToNewFolderContent}
              </PopoverContent>
            )}
        </div>
      </div>
    </Popover>
  );
};

export default MediaLibraryActionBar;
