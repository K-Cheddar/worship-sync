import "./ServiceItems.scss";
import { useDispatch, useSelector } from "../../hooks";
import { updateItemList } from "../../store/itemListSlice";
import { useLocation } from "react-router-dom";
import { DndContext, useDroppable, DragEndEvent } from "@dnd-kit/core";
import { useRef } from "react";

import { useSensors } from "../../utils/dndUtils";

import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import ServiceItem from "./ServiceItem";
import { keepElementInView } from "../../utils/generalUtils";
import { useEffect } from "react";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";

const ServiceItems = () => {
  const dispatch = useDispatch();
  const location = useLocation();
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

    const { id } = over;
    const { id: activeId } = active;
    const updatedServiceItems = [...serviceItems];
    const newIndex = updatedServiceItems.findIndex(
      (item) => item.listId === id
    );
    const oldIndex = updatedServiceItems.findIndex(
      (item) => item.listId === activeId
    );
    const element = serviceItems[oldIndex];
    updatedServiceItems.splice(oldIndex, 1);
    updatedServiceItems.splice(newIndex, 0, element);
    dispatch(updateItemList(updatedServiceItems));
  };

  useEffect(() => {
    const itemElement = document.getElementById(
      `service-item-${selectedItemListId}`
    );
    const parentElement = document.getElementById("service-items-list");

    const isNewItem = serviceItems.length > prevItemsLengthRef.current;
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
    } else {
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
        {!isLoading && serviceItems.length === 0 && (
          <p className="text-sm p-2">
            This outline is empty. Create a new item or add an existing one
            using the buttons above.
          </p>
        )}
        {isLoading ? (
          <div className="text-lg text-center mt-2">Loading items...</div>
        ) : (
          <ul
            ref={setNodeRef}
            className={"service-items-list"}
            id="service-items-list"
          >
            <SortableContext
              items={serviceItems.map((item) => item.listId)}
              strategy={verticalListSortingStrategy}
            >
              {serviceItems.map((item) => {
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
                    initialItems={initialItems}
                    location={location}
                  />
                );
              })}
            </SortableContext>
          </ul>
        )}
      </DndContext>
    </ErrorBoundary>
  );
};

export default ServiceItems;
