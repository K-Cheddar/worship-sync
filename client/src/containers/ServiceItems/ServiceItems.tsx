import { useDispatch, useSelector } from "../../hooks";
import {
  updateItemList,
  addItemToItemList,
  removeItemsFromList,
  setActiveItemInList,
} from "../../store/itemListSlice";
import { addItemToAllItemsList } from "../../store/allItemsSlice";
import { useNavigate } from "react-router-dom";
import { DndContext, useDroppable, DragEndEvent, DragStartEvent, DragOverlay } from "@dnd-kit/core";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PanelsTopLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS } from "../../constants/nextServiceTimer";

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
import LeftPanelButton from "../../components/LeftPanelButton/LeftPanelButton";
import ServiceOutlineSkeleton from "./ServiceOutlineSkeleton";
import Outlines from "../Toolbar/ToolbarElements/Outlines";
import { ServiceItem as ServiceItemType } from "../../types";
import FloatingWindow, { FloatingWindowHandle } from "../../components/FloatingWindow/FloatingWindow";
import cn from "classnames";
import ActionBar, { type ActionBarItem as ActionBarItemDef } from "../../components/ActionBar/ActionBar";
import { setServicePlanningFloatingWindowDismissed } from "../../store/servicePlanningImportSlice";
import {
  MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS,
  MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
} from "../Media/mediaLibraryMediaActionUi";
import useDisplayedUpcomingService from "../../hooks/useDisplayedUpcomingService";
import useNextServiceCountdownText from "../../hooks/useNextServiceCountdownText";
import type { ServiceTime } from "../../types";

const EMPTY_SERVICE_TIMES: ServiceTime[] = [];

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
  const allSongDocs = useSelector((state) => state.allDocs.allSongDocs);
  const serviceTimes = useSelector(
    (state) => state.undoable.present.serviceTimes.list,
  );
  const isServicePlanningOutlineSyncRunning = useSelector(
    (state) =>
      state.servicePlanningImport.sync.status === "running" &&
      state.servicePlanningImport.sync.phase === "outline"
  );
  const serviceOutline = useSelector(
    (state) => state.servicePlanningImport.serviceOutline,
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
  const [headingRenameOpen, setHeadingRenameOpen] = useState(false);
  const headingRenameWindowRef = useRef<FloatingWindowHandle>(null);
  const [headingRenameDraft, setHeadingRenameDraft] = useState("");
  const [headingRenamePosition, setHeadingRenamePosition] = useState({
    x: Math.max(window.innerWidth - 340, 0),
    y: 80,
  });
  const [activeId, setActiveId] = useState<string | null>(null);

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

  const arrangementSubtitlesByItemId = useMemo(() => {
    const subtitles = new Map<string, string>();

    for (const doc of allSongDocs) {
      const arrangement = doc.arrangements?.[doc.selectedArrangement];
      const name = arrangement?.name?.trim();
      if (!name || name.toLowerCase() === "master") continue;
      subtitles.set(doc._id, name);
    }

    return subtitles;
  }, [allSongDocs]);

  const hasServiceTimeItem = useMemo(
    () => serviceItems.some((item) => item.type === "service-time"),
    [serviceItems],
  );

  const upcomingService = useDisplayedUpcomingService(
    hasServiceTimeItem ? serviceTimes : EMPTY_SERVICE_TIMES,
    NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS,
    { keepRecentlyElapsedDuringGrace: true },
  );

  const upcomingServiceTargetIso = useMemo(() => {
    if (!hasServiceTimeItem) return null;
    return upcomingService?.nextAt.toISOString() ?? null;
  }, [hasServiceTimeItem, upcomingService]);

  const upcomingServiceTimeText = useNextServiceCountdownText(
    upcomingServiceTargetIso,
  );

  const serviceItemsByListId = useMemo(() => {
    const itemsByListId = new Map<string, ServiceItemType>();

    for (const item of serviceItems) {
      itemsByListId.set(item.listId, item);
    }

    return itemsByListId;
  }, [serviceItems]);

  const timers = useSelector((state) => state.timers.timers);
  const timerIdsInList = useMemo(
    () => new Set(serviceItems.map((item) => item._id)),
    [serviceItems]
  );
  const activeTimersByItemId = useMemo(() => {
    const activeTimers = new Map<string, (typeof timers)[number]>();

    for (const timer of timers) {
      if (
        timerIdsInList.has(timer.id) &&
        timer.status !== "stopped" &&
        timer.remainingTime > 0
      ) {
        activeTimers.set(timer.id, timer);
      }
    }

    return activeTimers;
  }, [timers, timerIdsInList]);

  const { setNodeRef } = useDroppable({
    id: "service-items-list",
  });

  const sensors = useSensors();

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    if (access === "view") return;
    const { over, active } = event;
    if (!over || !active) return;

    const overId = over.id as string;
    const activeId = active.id as string;
    if (access === "music") {
      const activeItem = serviceItemsByListId.get(activeId);
      if (!activeItem || !musicCanOutlineMutateItem(activeItem)) return;
      const idsToMove = selectedListIds.has(activeId)
        ? selectedListIds
        : new Set([activeId]);
      for (const id of idsToMove) {
        const row = serviceItemsByListId.get(id);
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

  const handleAddHeading = useCallback(async () => {
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
  }, [db, serviceItems, dispatch]);

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
    if (headingRenameOpen) {
      headingRenameWindowRef.current?.restore();
      return;
    }
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
  }, [selectedHeading, headingRenameOpen]);

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

    const row = serviceItemsByListId.get(listId);
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
        ? serviceItemsByListId.get(selectedItemListId)
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
      serviceItemsByListId,
    ],
  );

  const handleMultiSelectDone = useCallback(() => {
    setMultiSelectMode(false);
    setSelectedListIds(new Set());
    setAnchorListId(null);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (selectedListIds.size === 0) return;
    if (access === "music") {
      const allowedIds = Array.from(selectedListIds).filter((id) => {
        const row = serviceItemsByListId.get(id);
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
  }, [selectedListIds, access, dispatch, serviceItemsByListId]);

  const showBulkDeleteMenu =
    access === "full" &&
      selectedListIds.size > 0 &&
      [...selectedListIds].every((id) => {
        const row = serviceItemsByListId.get(id);
        return Boolean(row && canMultiSelectItem(row));
      })
      ? true
      : access === "music" &&
      selectedListIds.size > 0 &&
      [...selectedListIds].every((id) => {
        const row = serviceItemsByListId.get(id);
        return Boolean(row && canMultiSelectItem(row));
      });

  type ActionBarItem = {
    id: "add-heading" | "edit-heading" | "delete-selected" | "delete-heading" | "done" | "open-service-plan";
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

    items.push({
      id: "open-service-plan",
      label: "Open Service Plan",
      disabled: !serviceOutline,
    });

    return items;
  }, [selectedList, access, selectedHeading, showBulkDeleteMenu, selectedListIds.size, isAddingHeading, multiSelectMode, serviceOutline]);

  const handleDeleteHeading = useCallback(() => {
    if (!selectedHeading) return;
    dispatch(removeItemsFromList([selectedHeading.listId]));
  }, [dispatch, selectedHeading]);

  const getActionIcon = useCallback((id: ActionBarItem["id"]) => {
    if (id === "add-heading") return <Plus className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-cyan-400")} aria-hidden />;
    if (id === "edit-heading") return <Pencil className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-cyan-400")} aria-hidden />;
    if (id === "delete-selected") return <Trash2 className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-red-400")} aria-hidden />;
    if (id === "delete-heading") return <Trash2 className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-red-400")} aria-hidden />;
    if (id === "open-service-plan") return <PanelsTopLeft className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-cyan-400")} aria-hidden />;
    return null;
  }, []);

  const getActionHandler = useCallback((id: ActionBarItem["id"]) => {
    if (id === "add-heading") return handleAddHeading;
    if (id === "edit-heading") return openHeadingRenameWindow;
    if (id === "delete-selected") return handleDeleteSelected;
    if (id === "delete-heading") return handleDeleteHeading;
    if (id === "open-service-plan") return () => dispatch(setServicePlanningFloatingWindowDismissed(false));
    return handleMultiSelectDone;
  }, [dispatch, handleAddHeading, handleDeleteHeading, handleDeleteSelected, handleMultiSelectDone, openHeadingRenameWindow]);

  const actionBarItemDefs = useMemo((): ActionBarItemDef[] =>
    actionBarItems.map((item) => ({
      id: item.id,
      label: item.label,
      disabled: item.disabled,
      overflowMenuItemClassName: item.destructive ? "[&_svg]:text-red-400!" : undefined,
      renderButton: (isMeasure) => (
        <Button
          variant="tertiary"
          className={cn(
            "shrink-0",
            MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS,
            item.destructive && "text-white [&_svg]:text-red-400!",
          )}
          onClick={isMeasure ? undefined : getActionHandler(item.id)}
          disabled={item.disabled}
          isLoading={item.isLoading}
          title={item.label}
          tabIndex={isMeasure ? -1 : undefined}
        >
          <span className="flex items-center gap-1">
            {getActionIcon(item.id)}
            {item.label}
          </span>
        </Button>
      ),
      onOverflowSelect: () => {
        if (item.id === "edit-heading") { openHeadingRenameWindow(); return; }
        getActionHandler(item.id)();
      },
      renderOverflowItem: () => (
        <span className="flex items-center gap-1.5">
          {getActionIcon(item.id)}
          {item.label}
        </span>
      ),
    })),
  [actionBarItems, getActionHandler, getActionIcon, openHeadingRenameWindow]);

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
      <DndContext
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
        sensors={sensors}
      >
        <div className="min-h-0 border-b-2 border-white/25 bg-black/55 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]">
          <Outlines servicePanel className="w-full min-w-0" />
        </div>
        {actionBarItemDefs.length > 0 && (
          <div className="border-b border-white/10 px-2 py-1 min-w-0">
            <ActionBar items={actionBarItemDefs} overflowMenuClassName="min-w-48" />
          </div>
        )}
        {selectedHeading && headingRenameOpen ? (
          <FloatingWindow
            ref={headingRenameWindowRef}
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
                        dragActiveId={activeId}
                      />
                    );
                  }
                  if (hiddenListIds.has(item.listId)) return null;
                  const activeTimer = activeTimersByItemId.get(item._id);
                  const serviceTimeTimerText =
                    item.type === "service-time"
                      ? upcomingServiceTimeText ?? undefined
                      : undefined;
                  return (
                    <ServiceItem
                      isActive={activeTimer != null || serviceTimeTimerText != null}
                      timerValue={activeTimer?.remainingTime}
                      timerText={serviceTimeTimerText}
                      key={item.listId}
                      item={item}
                      subtitle={arrangementSubtitlesByItemId.get(item._id)}
                      index={index}
                      selectedItemListId={selectedItemListId}
                      insertPointIndex={insertPointIndex}
                      selectedListIds={selectedListIds}
                      initialItems={initialItems}
                      onItemClick={handleItemClick}
                      canMutateOutline={canMutateServiceItemRow(item)}
                      multiSelectMode={canMutateServiceItemRow(item) ? multiSelectMode : undefined}
                      onEnterMultiSelectMode={canMutateServiceItemRow(item) ? handleEnterMultiSelectMode : undefined}
                      dragActiveId={activeId}
                    />
                  );
                })}
              </SortableContext>
            </ul>
          </div>
        )}
        <DragOverlay dropAnimation={null}>
          {activeId ? (() => {
            const item = serviceItems.find((i) => i.listId === activeId);
            if (!item) return null;
            const isMulti = selectedListIds.has(activeId) && selectedListIds.size > 1;
            const stackCount = Math.min(selectedListIds.size - 1, 2);

            const itemGhost = item.type === "heading" ? (
              <li className="flex items-center gap-1 border-b-2 border-white/20 overflow-hidden pr-6 bg-black/40 shadow-lg cursor-grabbing">
                <p className="line-clamp-3 min-w-0 flex-1 wrap-break-word px-2 py-2 text-center text-[11px] font-semibold text-white">
                  {item.name}
                </p>
              </li>
            ) : (
              <LeftPanelButton
                isSelected={false}
                to={`item/${window.btoa(encodeURI(item._id))}/${window.btoa(encodeURI(item.listId))}`}
                title={item.name}
                subtitle={arrangementSubtitlesByItemId.get(item._id)}
                type={item.type}
                id={item.listId}
                image={item.background}
                className="border-b-2 border-transparent overflow-hidden cursor-grabbing"
              />
            );

            if (!isMulti) return itemGhost;

            return (
              <div className="relative cursor-grabbing">
                {Array.from({ length: stackCount }, (_, i) => (
                  <div
                    key={i}
                    className="absolute inset-0 rounded-sm bg-white/10 border border-white/15"
                    style={{
                      transform: `translate(${(i + 1) * 3}px, ${(i + 1) * 3}px)`,
                      zIndex: -(i + 1),
                    }}
                  />
                ))}
                <div className="relative z-0 shadow-lg">
                  {itemGhost}
                </div>
                <span className="absolute -top-2 -right-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan-500 px-1 text-[10px] font-bold text-white shadow">
                  {selectedListIds.size}
                </span>
              </div>
            );
          })() : null}
        </DragOverlay>
      </DndContext>
    </ErrorBoundary>
  );
};

export default ServiceItems;
