import { useDispatch, useSelector } from "../../hooks";
import {
  updateItemList,
  addItemToItemList,
  removeItemsFromList,
  setActiveItemInList,
} from "../../store/itemListSlice";
import { addItemToAllItemsList } from "../../store/allItemsSlice";
import { useNavigate } from "react-router-dom";
import { DndContext, useDroppable, DragEndEvent } from "@dnd-kit/core";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

import { useSensors } from "../../utils/dndUtils";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import ServiceItem from "./ServiceItem";
import { keepElementInView } from "../../utils/generalUtils";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createNewHeading, updateHeadingName } from "../../utils/itemUtil";
import generateRandomId from "../../utils/generateRandomId";
import HeadingItem from "./HeadingItem";
import ServiceOutlineSkeleton from "./ServiceOutlineSkeleton";
import Outlines from "../Toolbar/ToolbarElements/Outlines";
import { ServiceItem as ServiceItemType } from "../../types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/DropdownMenu";
import FloatingWindow from "../../components/FloatingWindow/FloatingWindow";
import cn from "classnames";
import {
  MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS,
  MEDIA_LIBRARY_ACTION_MENU_ITEM_CLASS,
  MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
} from "../Media/mediaLibraryMediaActionUi";

/** Matches LeftPanelButton link target (`/controller/${to}`) so keyboard nav is not relative to bible/songs/etc. */
const getControllerItemPath = (item: Pick<ServiceItemType, "_id" | "listId">) =>
  `/controller/item/${window.btoa(encodeURI(item._id))}/${window.btoa(
    encodeURI(item.listId)
  )}`;

const ServiceItems = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const {
    list: serviceItems,
    isLoading,
    initialItems,
    selectedItemListId,
    insertPointIndex,
  } = useSelector((state) => state.undoable.present.itemList);
  const isServicePlanningOutlineSyncRunning = useSelector(
    (state) =>
      state.servicePlanningImport.sync.status === "running" &&
      state.servicePlanningImport.sync.phase === "outline"
  );
  const prevItemsLengthRef = useRef(serviceItems.length);

  const { selectedList } = useSelector(
    (state) => state.undoable.present.itemLists
  );
  const { db } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};
  const canMutateHeadingRow = access === "full";
  const musicCanOutlineMutateItem = (item: ServiceItemType) =>
    item.type === "song" || item.type === "free";
  const canMultiSelectItem = useCallback(
    (item: ServiceItemType) =>
      item.type !== "heading" &&
      (access === "full" ||
        (access === "music" && musicCanOutlineMutateItem(item))),
    [access],
  );
  const canMutateServiceItemRow = (item: ServiceItemType) =>
    access === "full" ||
    (access === "music" && musicCanOutlineMutateItem(item));
  const [isAddingHeading, setIsAddingHeading] = useState(false);
  const [collapsedHeadingListIds, setCollapsedHeadingListIds] = useState<
    Set<string>
  >(new Set());
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());
  const [anchorListId, setAnchorListId] = useState<string | null>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const skipNextServiceItemClickRef = useRef(false);
  const actionBarRowRef = useRef<HTMLDivElement>(null);
  const actionBarMeasureRef = useRef<HTMLDivElement>(null);
  const [actionBarInlineCount, setActionBarInlineCount] = useState(99);
  const [actionBarMenuOpen, setActionBarMenuOpen] = useState(false);
  const [headingRenameOpen, setHeadingRenameOpen] = useState(false);
  const [headingRenameDraft, setHeadingRenameDraft] = useState("");
  const [headingRenamePosition, setHeadingRenamePosition] = useState({
    x: Math.max(window.innerWidth - 340, 0),
    y: 80,
  });

  const selectedHeading = useMemo(
    () =>
      access === "full"
        ? serviceItems.find(
          (item) =>
            item.type === "heading" && item.listId === selectedItemListId,
        )
        : undefined,
    [access, selectedItemListId, serviceItems],
  );

  useEffect(() => {
    if (selectedHeading) {
      setHeadingRenameDraft(selectedHeading.name);
      return;
    }
    setHeadingRenameOpen(false);
    setHeadingRenameDraft("");
  }, [selectedHeading]);

  // Reset collapse and selection when switching outlines
  useEffect(() => {
    setCollapsedHeadingListIds(new Set());
    setSelectedListIds(new Set());
    setAnchorListId(null);
    setMultiSelectMode(false);
  }, [selectedList?._id]);

  const hiddenListIds = useMemo(() => {
    const hidden = new Set<string>();
    let hiding = false;
    for (let i = 0; i < serviceItems.length; i++) {
      const item = serviceItems[i];
      if (item.type === "heading") {
        hiding = collapsedHeadingListIds.has(item.listId);
      } else if (hiding) {
        hidden.add(item.listId);
      }
    }
    return hidden;
  }, [serviceItems, collapsedHeadingListIds]);

  const timers = useSelector((state) => state.timers.timers);
  const timerIdsInList = useMemo(
    () => new Set(serviceItems.map((item) => item._id)),
    [serviceItems]
  );
  const activeTimers = useMemo(
    () =>
      timers.filter(
        (timer) =>
          timerIdsInList.has(timer.id) &&
          timer.status !== "stopped" &&
          timer.remainingTime > 0
      ),
    [timers, timerIdsInList]
  );

  const { setNodeRef } = useDroppable({
    id: "service-items-list",
  });

  const sensors = useSensors();

  const onDragEnd = (event: DragEndEvent) => {
    if (access === "view") return;
    const { over, active } = event;
    if (!over || !active) return;

    const overId = over.id as string;
    const activeId = active.id as string;
    if (access === "music") {
      const activeItem = serviceItems.find((i) => i.listId === activeId);
      if (!activeItem || !musicCanOutlineMutateItem(activeItem)) return;
      const idsToMove = selectedListIds.has(activeId)
        ? selectedListIds
        : new Set([activeId]);
      for (const id of idsToMove) {
        const row = serviceItems.find((i) => i.listId === id);
        if (!row || !musicCanOutlineMutateItem(row)) return;
      }
    }
    const updatedServiceItems = [...serviceItems];
    const dropIndex = updatedServiceItems.findIndex(
      (item) => item.listId === overId
    );
    const activeIndex = updatedServiceItems.findIndex(
      (item) => item.listId === activeId
    );
    if (dropIndex === -1 || activeIndex === -1) return;

    const idsToMove = selectedListIds.has(activeId)
      ? selectedListIds
      : new Set([activeId]);
    const indicesToMove = updatedServiceItems
      .map((item, i) => (idsToMove.has(item.listId) ? i : -1))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    const elementsToMove = indicesToMove.map((i) => updatedServiceItems[i]);

    // Remove from high index to low to preserve indices
    for (let i = indicesToMove.length - 1; i >= 0; i--) {
      updatedServiceItems.splice(indicesToMove[i], 1);
    }
    const removedCountBeforeDrop =
      indicesToMove.filter((idx) => idx < dropIndex).length;
    const insertIndex =
      dropIndex -
      removedCountBeforeDrop +
      (activeIndex < dropIndex ? 1 : 0);
    const clampedInsert = Math.max(
      0,
      Math.min(insertIndex, updatedServiceItems.length)
    );
    updatedServiceItems.splice(clampedInsert, 0, ...elementsToMove);
    dispatch(updateItemList(updatedServiceItems));
  };

  const handleAddHeading = async () => {
    if (!db) return;
    setIsAddingHeading(true);
    try {
      const item = await createNewHeading({
        name: "New Heading",
        list: serviceItems,
        db,
      });
      const serviceItem = {
        name: item.name,
        _id: item._id,
        type: "heading",
        listId: generateRandomId(),
      };
      dispatch(addItemToItemList(serviceItem));
      dispatch(addItemToAllItemsList(serviceItem));
    } finally {
      setIsAddingHeading(false);
    }
  };

  const findNextNonHeadingIndex = (fromIndex: number) => {
    for (let i = fromIndex + 1; i < serviceItems.length; i++) {
      if (serviceItems[i].type !== "heading") return i;
    }
    return -1;
  };

  const findPrevNonHeadingIndex = (fromIndex: number) => {
    for (let i = fromIndex - 1; i >= 0; i--) {
      if (serviceItems[i].type !== "heading") return i;
    }
    return -1;
  };

  const findNextHeadingIndex = (fromIndex: number) => {
    for (let i = fromIndex + 1; i < serviceItems.length; i++) {
      if (serviceItems[i].type === "heading") return i;
    }
    return -1;
  };

  const findPrevHeadingIndex = (fromIndex: number) => {
    for (let i = fromIndex - 1; i >= 0; i--) {
      if (serviceItems[i].type === "heading") return i;
    }
    return -1;
  };

  const handleItemListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const currentIndex = serviceItems.findIndex(
        (item) => item.listId === selectedItemListId
      );
      if (currentIndex === -1) return;
      const nextIndex = findNextNonHeadingIndex(currentIndex);
      if (nextIndex >= 0) {
        const nextItem = serviceItems[nextIndex];
        setSelectedListIds(new Set([nextItem.listId]));
        setAnchorListId(nextItem.listId);
        dispatch(setActiveItemInList(nextItem.listId));
        navigate(getControllerItemPath(nextItem));
        return;
      }
      const nextHeadingIdx = findNextHeadingIndex(currentIndex);
      if (nextHeadingIdx >= 0) {
        const hid = serviceItems[nextHeadingIdx].listId;
        setSelectedListIds(new Set([hid]));
        setAnchorListId(hid);
        dispatch(setActiveItemInList(hid));
      }
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const currentIndex = serviceItems.findIndex(
        (item) => item.listId === selectedItemListId
      );
      if (currentIndex === -1) return;
      const prevIndex = findPrevNonHeadingIndex(currentIndex);
      if (prevIndex >= 0) {
        const prevItem = serviceItems[prevIndex];
        setSelectedListIds(new Set([prevItem.listId]));
        setAnchorListId(prevItem.listId);
        dispatch(setActiveItemInList(prevItem.listId));
        navigate(getControllerItemPath(prevItem));
        return;
      }
      const prevHeadingIdx = findPrevHeadingIndex(currentIndex);
      if (prevHeadingIdx >= 0) {
        const hid = serviceItems[prevHeadingIdx].listId;
        setSelectedListIds(new Set([hid]));
        setAnchorListId(hid);
        dispatch(setActiveItemInList(hid));
      }
    }
  };

  const handleToggleHeadingCollapse = (listId: string) => {
    setCollapsedHeadingListIds((prev) => {
      const next = new Set(prev);
      if (next.has(listId)) {
        next.delete(listId);
      } else {
        next.add(listId);
      }
      return next;
    });
  };

  const handleSaveHeadingName = useCallback(async (
    heading: ServiceItemType,
    newName: string
  ) => {
    dispatch(
      updateItemList(
        serviceItems.map((i) =>
          i.listId === heading.listId ? { ...i, name: newName } : i
        )
      )
    );
    if (db) {
      await updateHeadingName({
        db,
        headingId: heading._id,
        newName,
      });
    }
  }, [db, dispatch, serviceItems]);

  const openHeadingRenameWindow = useCallback(() => {
    if (!selectedHeading) return;
    const trigger = document.activeElement;
    if (trigger instanceof HTMLElement) {
      const rect = trigger.getBoundingClientRect();
      setHeadingRenamePosition({
        x: Math.min(Math.max(rect.left, 8), Math.max(window.innerWidth - 340, 0)),
        y: Math.min(rect.bottom + 8, Math.max(window.innerHeight - 240, 8)),
      });
    }
    setHeadingRenameDraft(selectedHeading.name);
    setHeadingRenameOpen(true);
  }, [selectedHeading]);

  const handleSaveHeadingRename = useCallback(() => {
    if (!selectedHeading) return;
    const trimmed = headingRenameDraft.trim();
    if (!trimmed) return;
    void handleSaveHeadingName(selectedHeading, trimmed);
    setHeadingRenameOpen(false);
  }, [headingRenameDraft, handleSaveHeadingName, selectedHeading]);

  const handleCancelHeadingRename = useCallback(() => {
    setHeadingRenameDraft(selectedHeading?.name ?? "");
    setHeadingRenameOpen(false);
  }, [selectedHeading]);

  const handleItemClick = (listId: string, e: React.MouseEvent) => {
    if (skipNextServiceItemClickRef.current) {
      skipNextServiceItemClickRef.current = false;
      e.preventDefault();
      return;
    }

    const row = serviceItems.find((item) => item.listId === listId);
    const canMultiSelectRow = row != null && canMultiSelectItem(row);

    if (access === "view" || !canMultiSelectRow) {
      setSelectedListIds(new Set([listId]));
      setAnchorListId(listId);
      dispatch(setActiveItemInList(listId));
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      const clickedIndex = serviceItems.findIndex((i) => i.listId === listId);
      const anchorIndex = anchorListId
        ? serviceItems.findIndex((i) => i.listId === anchorListId)
        : serviceItems.findIndex((i) => i.listId === selectedItemListId);
      const resolvedAnchorIndex = anchorIndex >= 0 ? anchorIndex : clickedIndex;
      const start = Math.min(clickedIndex, resolvedAnchorIndex);
      const end = Math.max(clickedIndex, resolvedAnchorIndex);
      const rangeIds = new Set(
        serviceItems
          .slice(start, end + 1)
          .filter(canMultiSelectItem)
          .map((i) => i.listId)
      );
      setSelectedListIds(rangeIds);
      setMultiSelectMode(rangeIds.size > 1);
      dispatch(setActiveItemInList(listId));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelectedListIds((prev) => {
        const next = new Set(prev);
        if (next.has(listId)) next.delete(listId);
        else next.add(listId);
        setMultiSelectMode(next.size > 1);
        return next;
      });
      setAnchorListId(listId);
      dispatch(setActiveItemInList(listId));
      return;
    }
    // Plain click in multi-select mode: toggle without navigating
    if (multiSelectMode) {
      e.preventDefault();
      setSelectedListIds((prev) => {
        const next = new Set(prev);
        if (next.has(listId)) next.delete(listId);
        else next.add(listId);
        if (next.size === 0) setMultiSelectMode(false);
        return next;
      });
      setAnchorListId(listId);
      return;
    }
    // Normal single click
    setSelectedListIds(new Set([listId]));
    setAnchorListId(listId);
    dispatch(setActiveItemInList(listId));
  };

  const handleEnterMultiSelectMode = useCallback(
    (listId: string, options?: { skipNextClick?: boolean }) => {
      const currentRow = selectedItemListId
        ? serviceItems.find((item) => item.listId === selectedItemListId)
        : undefined;
      const currentSelectionCanJoin =
        currentRow != null && canMultiSelectItem(currentRow);
      const ids =
        selectedItemListId &&
          selectedItemListId !== listId &&
          selectedListIds.size <= 1 &&
          currentSelectionCanJoin
          ? [selectedItemListId, listId]
          : [listId];
      setMultiSelectMode(true);
      setSelectedListIds(new Set(ids));
      setAnchorListId(listId);
      dispatch(setActiveItemInList(listId));
      if (options?.skipNextClick) {
        skipNextServiceItemClickRef.current = true;
      }
    },
    [
      canMultiSelectItem,
      dispatch,
      selectedItemListId,
      selectedListIds.size,
      serviceItems,
    ],
  );

  const handleMultiSelectDone = useCallback(() => {
    setMultiSelectMode(false);
    setSelectedListIds(new Set());
    setAnchorListId(null);
  }, []);

  const handleDeleteSelected = () => {
    if (selectedListIds.size === 0) return;
    if (access === "music") {
      const allowedIds = Array.from(selectedListIds).filter((id) => {
        const row = serviceItems.find((i) => i.listId === id);
        return row && musicCanOutlineMutateItem(row);
      });
      if (allowedIds.length === 0) return;
      dispatch(removeItemsFromList(allowedIds));
      setSelectedListIds(new Set());
      setAnchorListId(null);
      setMultiSelectMode(false);
      return;
    }
    dispatch(removeItemsFromList(Array.from(selectedListIds)));
    setSelectedListIds(new Set());
    setAnchorListId(null);
    setMultiSelectMode(false);
  };

  const showBulkDeleteMenu =
    access === "full" &&
      selectedListIds.size > 0 &&
      [...selectedListIds].every((id) => {
        const row = serviceItems.find((i) => i.listId === id);
        return Boolean(row && canMultiSelectItem(row));
      })
      ? true
      : access === "music" &&
      selectedListIds.size > 0 &&
      [...selectedListIds].every((id) => {
        const row = serviceItems.find((i) => i.listId === id);
        return Boolean(row && canMultiSelectItem(row));
      });

  type ActionBarItem = {
    id: "add-heading" | "edit-heading" | "delete-selected" | "delete-heading" | "done";
    label: string;
    destructive?: boolean;
    disabled?: boolean;
    isLoading?: boolean;
  };

  const actionBarItems = useMemo((): ActionBarItem[] => {
    const items: ActionBarItem[] = [];
    if (multiSelectMode) {
      items.push({ id: "done", label: "Done" });
    }
    if (selectedList && access === "full") {
      items.push({
        id: "add-heading",
        label: "Add heading",
        disabled: isAddingHeading,
        isLoading: isAddingHeading,
      });
    }
    if (selectedHeading) {
      items.push({
        id: "edit-heading",
        label: "Edit name",
      });
      items.push({
        id: "delete-heading",
        label: "Delete heading",
        destructive: true,
      })
    }
    if (showBulkDeleteMenu) {
      items.push({
        id: "delete-selected",
        label: `Delete selected (${selectedListIds.size})`,
        destructive: true,
      });
    }

    return items;
  }, [selectedList, access, selectedHeading, showBulkDeleteMenu, selectedListIds.size, isAddingHeading, multiSelectMode]);

  const recalcActionBarLayout = useCallback(() => {
    const row = actionBarRowRef.current;
    const measure = actionBarMeasureRef.current;
    const total = actionBarItems.length;
    if (!row || !measure || total === 0) {
      setActionBarInlineCount(total);
      return;
    }
    const btns = [...measure.querySelectorAll<HTMLElement>("[data-measure-si-action]")];
    const widths = btns.map((b) => b.offsetWidth);
    const W = row.clientWidth;
    if (W < 24) {
      setActionBarInlineCount(total);
      return;
    }
    const GAP = 4;
    const TRIGGER = 44;
    let used = 0;
    let inline = 0;
    for (let i = 0; i < widths.length; i++) {
      const gap = inline > 0 ? GAP : 0;
      const end = used + gap + widths[i];
      const isLast = i === widths.length - 1;
      if (isLast ? end <= W : end + GAP + TRIGGER <= W) {
        inline++;
        used = end;
      } else {
        break;
      }
    }
    setActionBarInlineCount(inline);
  }, [actionBarItems]);

  useLayoutEffect(() => {
    recalcActionBarLayout();
  }, [recalcActionBarLayout]);

  useLayoutEffect(() => {
    const row = actionBarRowRef.current;
    if (!row) return;
    const ro = new ResizeObserver(() => recalcActionBarLayout());
    ro.observe(row);
    return () => ro.disconnect();
  }, [recalcActionBarLayout]);

  useLayoutEffect(() => {
    if (actionBarItems.length === 0) setActionBarMenuOpen(false);
  }, [actionBarItems.length]);

  const inlineActionItems = actionBarItems.slice(0, actionBarInlineCount);
  const overflowActionItems = actionBarItems.slice(actionBarInlineCount);

  const getActionIcon = (id: ActionBarItem["id"]) => {
    if (id === "add-heading") return <Plus className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-cyan-400")} aria-hidden />;
    if (id === "edit-heading") return <Pencil className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-cyan-400")} aria-hidden />;
    if (id === "delete-selected") return <Trash2 className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-red-400")} aria-hidden />;
    if (id === "delete-heading") return <Trash2 className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-red-400")} aria-hidden />;
    return null;
  };

  const handleDeleteHeading = () => {
    if (!selectedHeading) return;
    dispatch(removeItemsFromList([selectedHeading.listId]));
  };

  const getActionHandler = (id: ActionBarItem["id"]) => {
    if (id === "add-heading") return handleAddHeading;
    if (id === "edit-heading") return openHeadingRenameWindow;
    if (id === "delete-selected") return handleDeleteSelected;
    if (id === "delete-heading") return handleDeleteHeading;
    return handleMultiSelectDone;
  };

  const handleActionBarMenuOpenChange = useCallback(
    (open: boolean) => {
      setActionBarMenuOpen(open);
    },
    [],
  );

  useEffect(() => {
    const itemElement = document.getElementById(
      `service-item-${selectedItemListId}`
    );
    const parentElement = document.getElementById("service-items-list");

    const isNewItem = serviceItems.length > prevItemsLengthRef.current;
    const isSameLength = serviceItems.length === prevItemsLengthRef.current;
    prevItemsLengthRef.current = serviceItems.length;

    const scrollToItem = () => {
      if (itemElement && parentElement) {
        keepElementInView({
          child: itemElement,
          parent: parentElement,
        });
      }
    };

    if (isNewItem) {
      // Only delay if a new item was added
      setTimeout(scrollToItem, isServicePlanningOutlineSyncRunning ? 50 : 500);
    } else if (isSameLength) {
      // Scroll immediately for other cases
      scrollToItem();
    }
  }, [
    isServicePlanningOutlineSyncRunning,
    selectedItemListId,
    serviceItems.length,
  ]);

  return (
    <ErrorBoundary>
      <DndContext onDragEnd={onDragEnd} sensors={sensors}>
        <div className="min-h-0 border-b-2 border-white/25 bg-black/55 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]">
          <Outlines servicePanel className="w-full min-w-0" />
        </div>
        {actionBarItems.length > 0 && (
          <div
            ref={actionBarRowRef}
            className="flex flex-nowrap items-center gap-1 border-b border-white/10 px-2 py-1 min-w-0"
          >
            {/* Hidden measure row for overflow calculation */}
            <div
              ref={actionBarMeasureRef}
              className="pointer-events-none fixed left-[-9999px] top-0 z-[-1] flex flex-nowrap items-center gap-1 opacity-0"
              aria-hidden
            >
              {actionBarItems.map((item) => (
                <Button
                  key={item.id}
                  data-measure-si-action
                  variant="tertiary"
                  color="red"
                  className={cn(
                    "shrink-0",
                    MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS,
                    item.destructive && "text-white [&_svg]:text-red-400!",
                  )}
                  tabIndex={-1}
                >
                  <span className="flex items-center gap-1">
                    {getActionIcon(item.id)}
                    {item.label}
                  </span>
                </Button>
              ))}
            </div>

            {/* Inline buttons */}
            {inlineActionItems.map((item) => {
              const button = (
                <Button
                  key={item.id}
                  variant="tertiary"
                  className={cn(
                    "shrink-0",
                    MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS,
                    item.destructive && "text-white [&_svg]:text-red-400!",
                  )}
                  onClick={getActionHandler(item.id)}
                  disabled={item.disabled}
                  isLoading={item.isLoading}
                  title={item.label}
                >
                  <span className="flex items-center gap-1">
                    {getActionIcon(item.id)}
                    {item.label}
                  </span>
                </Button>
              );
              return button;
            })}

            {/* Overflow menu */}
            {overflowActionItems.length > 0 && (
              <DropdownMenu
                open={actionBarMenuOpen}
                onOpenChange={handleActionBarMenuOpenChange}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="tertiary"
                    className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)}
                    title="More actions"
                    aria-label="More actions"
                  >
                    <MoreHorizontal
                      className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE)}
                      aria-hidden
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-48 text-xs"
                >
                  {overflowActionItems.map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      variant="default"
                      className={cn(
                        MEDIA_LIBRARY_ACTION_MENU_ITEM_CLASS,
                        item.destructive && "[&_svg]:text-red-400!",
                      )}
                      disabled={item.disabled}
                      onSelect={() => {
                        if (item.id === "edit-heading") {
                          openHeadingRenameWindow();
                          return;
                        }
                        getActionHandler(item.id)();
                      }}
                    >
                      <span className="flex items-center gap-1.5">
                        {getActionIcon(item.id)}
                        {item.label}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
        {selectedHeading && headingRenameOpen ? (
          <FloatingWindow
            title="Edit heading name"
            onClose={handleCancelHeadingRename}
            defaultWidth={320}
            defaultHeight={220}
            defaultPosition={headingRenamePosition}
            autoHeight
          >
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveHeadingRename();
              }}
            >
              <Input
                label="Heading name"
                value={headingRenameDraft}
                onChange={(value) => setHeadingRenameDraft(String(value))}
                placeholder="Name"
                inputTextSize="text-sm"
                inputWidth="w-full"
                data-ignore-undo="true"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="tertiary"
                  onClick={handleCancelHeadingRename}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="cta"
                  disabled={!headingRenameDraft.trim()}
                >
                  Save
                </Button>
              </div>
            </form>
          </FloatingWindow>
        ) : null}
        {!isLoading && serviceItems.length === 0 && (
          <p className="text-sm p-2">
            {access !== "view"
              ? "This outline is empty. Create a new item or add an existing one using the buttons above."
              : "This outline is empty."}
          </p>
        )}
        {isLoading ? (
          <ServiceOutlineSkeleton />
        ) : (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <ul
              ref={setNodeRef}
              className="scrollbar-variable overflow-y-auto overflow-x-hidden flex-1 pb-2 min-h-0"
              id="service-items-list"
              onKeyDown={handleItemListKeyDown}
            >
              <SortableContext
                items={serviceItems.map((item) => item.listId)}
                strategy={verticalListSortingStrategy}
              >
                {serviceItems.map((item, index) => {
                  if (item.type === "heading") {
                    return (
                      <HeadingItem
                        key={item.listId}
                        item={item}
                        index={index}
                        selectedItemListId={selectedItemListId}
                        insertPointIndex={insertPointIndex}
                        selectedListIds={selectedListIds}
                        isCollapsed={collapsedHeadingListIds.has(item.listId)}
                        onToggleCollapse={() =>
                          handleToggleHeadingCollapse(item.listId)
                        }
                        onItemClick={handleItemClick}
                        canMutateOutline={canMutateHeadingRow}
                      />
                    );
                  }
                  if (hiddenListIds.has(item.listId)) return null;
                  return (
                    <ServiceItem
                      isActive={activeTimers.some(
                        (timer) => timer.id === item._id
                      )}
                      timerValue={
                        activeTimers.find((timer) => timer.id === item._id)
                          ?.remainingTime
                      }
                      key={item.listId}
                      item={item}
                      index={index}
                      selectedItemListId={selectedItemListId}
                      insertPointIndex={insertPointIndex}
                      selectedListIds={selectedListIds}
                      initialItems={initialItems}
                      onItemClick={handleItemClick}
                      canMutateOutline={canMutateServiceItemRow(item)}
                      multiSelectMode={canMutateServiceItemRow(item) ? multiSelectMode : undefined}
                      onEnterMultiSelectMode={canMutateServiceItemRow(item) ? handleEnterMultiSelectMode : undefined}
                    />
                  );
                })}
              </SortableContext>
            </ul>
          </div>
        )}
      </DndContext>
    </ErrorBoundary>
  );
};

export default ServiceItems;
