import { useEffect } from "react";
import "./ServiceItems.scss";
import { useDispatch, useSelector } from "../../hooks";
import { initiateItemList, updateItemList } from "../../store/itemList";
import { mockItemList } from "../../store/mockItemList";
import { useLocation } from "react-router-dom";
import { DndContext, useDroppable, DragEndEvent } from "@dnd-kit/core";

import { useSensors } from "../../utils/dndUtils";

import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import ServiceItem from "./ServiceItem";

const ServiceItems = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const { list: serviceItems } = useSelector(
    (state) => state.undoable.present.itemList
  );
  const { listId } = useSelector((state) => state.undoable.present.item);

  const { setNodeRef } = useDroppable({
    id: "service-items-list",
  });

  const sensors = useSensors();

  useEffect(() => {
    dispatch(initiateItemList(mockItemList));
  }, [dispatch]);

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

  return (
    <DndContext onDragEnd={onDragEnd} sensors={sensors}>
      <h3 className="font-bold text-center p-1 text-base bg-slate-800">
        Service Items
      </h3>

      <ul
        ref={setNodeRef}
        className={`overflow-y-auto overflow-x-hidden flex-1 service-items-list`}
      >
        <SortableContext
          items={serviceItems.map((item) => item.listId)}
          strategy={verticalListSortingStrategy}
        >
          {serviceItems.map((item) => {
            return (
              <ServiceItem
                key={item.listId}
                item={item}
                listId={listId}
                location={location}
              />
            );
          })}
        </SortableContext>
      </ul>
    </DndContext>
  );
};

export default ServiceItems;
