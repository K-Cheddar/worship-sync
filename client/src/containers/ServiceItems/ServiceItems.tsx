import { useDispatch, useSelector } from "../../hooks";
import {
  updateItemList,
  addItemToItemList,
  removeItemFromList,
  removeItemsFromList,
  setActiveItemInList,
} from "../../store/itemListSlice";
import { addItemToAllItemsList } from "../../store/allItemsSlice";
import { useLocation, useNavigate } from "react-router-dom";
import { DndContext, useDroppable, DragEndEvent } from "@dnd-kit/core";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { useSensors } from "../../utils/dndUtils";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import ServiceItem from "./ServiceItem";
import { keepElementInView } from "../../utils/generalUtils";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import Button from "../../components/Button/Button";
import ContextMenu from "../../components/ContextMenu/ContextMenu";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createNewHeading, updateHeadingName } from "../../utils/itemUtil";
import generateRandomId from "../../utils/generateRandomId";
import HeadingItem from "./HeadingItem";
import { ServiceItem as ServiceItemType } from "../../types";

const ServiceItems = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    list: serviceItems,
    isLoading,
    initialItems,
    selectedItemListId,
  } = useSelector((state) => state.undoable.present.itemList);
  const prevItemsLengthRef = useRef(serviceItems.length);

  const { selectedList } = useSelector(
    (state) => state.undoable.present.itemLists
  );
  const { db } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};
  const [isAddingHeading, setIsAddingHeading] = useState(false);
  const [collapsedHeadingListIds, setCollapsedHeadingListIds] = useState<
    Set<string>
  >(new Set());
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());
  const [anchorListId, setAnchorListId] = useState<string | null>(null);

  // Reset collapse and selection when switching outlines
  useEffect(() => {
    setCollapsedHeadingListIds(new Set());
    setSelectedListIds(new Set());
    setAnchorListId(null);
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

  const activeTimers = useSelector((state) => state.timers.timers).filter(
    (timer) => timer.status !== "stopped" && timer.remainingTime > 0
  );

  const { setNodeRef } = useDroppable({
    id: "service-items-list",
  });

  const sensors = useSensors();

  const onDragEnd = (event: DragEndEvent) => {
    const { over, active } = event;
    if (!over || !active) return;

    const overId = over.id as string;
    const activeId = active.id as string;
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

  const handleItemListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const currentIndex = serviceItems.findIndex(
        (item) => item.listId === selectedItemListId
      );
      const nextIndex = Math.min(
        currentIndex + 1,
        serviceItems.length - 1
      );
      const nextItem = serviceItems[nextIndex];
      if (nextItem) {
        navigate(
          `item/${window.btoa(encodeURI(nextItem._id))}/${window.btoa(
            encodeURI(nextItem.listId)
          )}`
        );
      }
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const currentIndex = serviceItems.findIndex(
        (item) => item.listId === selectedItemListId
      );
      const prevIndex = Math.max(currentIndex - 1, 0);
      const prevItem = serviceItems[prevIndex];
      if (prevItem) {
        navigate(
          `item/${window.btoa(encodeURI(prevItem._id))}/${window.btoa(
            encodeURI(prevItem.listId)
          )}`
        );
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

  const handleSaveHeadingName = async (
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
  };

  const handleDeleteHeading = (listId: string) => {
    dispatch(removeItemFromList(listId));
  };

  const handleItemClick = (listId: string, e: React.MouseEvent) => {
    if (e.shiftKey) {
      const clickedIndex = serviceItems.findIndex((i) => i.listId === listId);
      const anchorIndex = anchorListId
        ? serviceItems.findIndex((i) => i.listId === anchorListId)
        : clickedIndex;
      const start = Math.min(clickedIndex, anchorIndex);
      const end = Math.max(clickedIndex, anchorIndex);
      const rangeIds = new Set(
        serviceItems
          .slice(start, end + 1)
          .map((i) => i.listId)
      );
      setSelectedListIds(rangeIds);
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedListIds((prev) => {
        const next = new Set(prev);
        if (next.has(listId)) next.delete(listId);
        else next.add(listId);
        return next;
      });
      setAnchorListId(listId);
    } else {
      setSelectedListIds(new Set([listId]));
      setAnchorListId(listId);
      dispatch(setActiveItemInList(listId));
      // Link handles navigation on single click
    }
  };

  const handleDeleteSelected = () => {
    if (selectedListIds.size === 0) return;
    dispatch(removeItemsFromList(Array.from(selectedListIds)));
    setSelectedListIds(new Set());
    setAnchorListId(null);
  };

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
      setTimeout(scrollToItem, 500);
    } else if (isSameLength) {
      // Scroll immediately for other cases
      scrollToItem();
    }
  }, [selectedItemListId, serviceItems.length]);

  return (
    <ErrorBoundary>
      <DndContext onDragEnd={onDragEnd} sensors={sensors}>
        <h3 className="font-bold text-center p-1 text-base bg-gray-800">
          {selectedList?.name || "Service Items"}
        </h3>
        {selectedList && access === "full" && (
          <Button
            svg={Plus}
            variant="tertiary"
            className="w-full justify-center text-xs"
            iconSize="sm"
            onClick={handleAddHeading}
            disabled={isAddingHeading}
            isLoading={isAddingHeading}
          >
            Add heading
          </Button>
        )}
        {!isLoading && serviceItems.length === 0 && (
          <p className="text-sm p-2">
            This outline is empty. Create a new item or add an existing one
            using the buttons above.
          </p>
        )}
        {isLoading ? (
          <div className="text-lg text-center mt-2">Loading items...</div>
        ) : (
          <ContextMenu
            className="flex-1 min-h-0 flex flex-col overflow-hidden"
            menuItems={[
              ...(selectedListIds.size > 0
                ? [
                  {
                    label: `Delete selected (${selectedListIds.size})`,
                    onClick: handleDeleteSelected,
                    icon: <Trash2 className="w-4 h-4 shrink-0" />,
                    variant: "destructive" as const,
                  },
                ]
                : []),
            ]}
            header={
              selectedListIds.size > 0
                ? {
                  title: `${selectedListIds.size} item${selectedListIds.size === 1 ? "" : "s"} selected`,
                }
                : undefined
            }
            onContextMenuOpen={(e) => {
              const listId = (e.target as HTMLElement)
                .closest("[data-list-id]")
                ?.getAttribute("data-list-id");
              if (listId && serviceItems.some((i) => i.listId === listId)) {
                setSelectedListIds((prev) =>
                  prev.has(listId) ? prev : new Set([listId])
                );
                setAnchorListId(listId);
                dispatch(setActiveItemInList(listId));
              }
            }}
          >
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
                        isCollapsed={collapsedHeadingListIds.has(item.listId)}
                        onToggleCollapse={() =>
                          handleToggleHeadingCollapse(item.listId)
                        }
                        onSaveName={(newName) =>
                          handleSaveHeadingName(item, newName)
                        }
                        onDelete={() => handleDeleteHeading(item.listId)}
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
                      selectedItemListId={selectedItemListId}
                      selectedListIds={selectedListIds}
                      initialItems={initialItems}
                      location={location}
                      onItemClick={handleItemClick}
                    />
                  );
                })}
              </SortableContext>
            </ul>
          </ContextMenu>
        )}
      </DndContext>
    </ErrorBoundary>
  );
};

export default ServiceItems;
