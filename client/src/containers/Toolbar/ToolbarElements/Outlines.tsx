import { useCallback, useContext, useEffect, useState } from "react";
import { Plus, Check, List } from "lucide-react";
import { useDispatch, useSelector } from "../../../hooks";
import {
  initiateItemLists,
  removeFromItemLists,
  selectItemList,
  setInitialItemList,
  updateItemLists,
  updateItemListsFromRemote,
  setActiveItemList,
} from "../../../store/itemListsSlice";
import PopOver from "../../../components/PopOver/PopOver";
import Button from "../../../components/Button/Button";
import Outline from "./Outline";
import { DBItemListDetails, ItemLists, ItemList } from "../../../types";
import { ControllerInfoContext } from "../../../context/controllerInfo";
import {
  createItemListFromExisting,
  createNewItemList,
} from "../../../utils/itemUtil";
import { DndContext, DragEndEvent, useDroppable } from "@dnd-kit/core";
import { useSensors } from "../../../utils/dndUtils";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useGlobalBroadcast } from "../../../hooks/useGlobalBroadcast";
import { ActionCreators } from "redux-undo";
import { GlobalInfoContext } from "../../../context/globalInfo";

const Services = ({ className }: { className: string }) => {
  const { currentLists, activeList } = useSelector(
    (state) => state.undoable.present.itemLists
  );
  const { selectedList } = useSelector(
    (state) => state.undoable.present.itemLists
  );

  const heading = `Current Outlines (${currentLists.length})`;

  const dispatch = useDispatch();

  const { db, updater } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};
  const [justAdded, setJustAdded] = useState(false);

  const { setNodeRef } = useDroppable({
    id: "items-lists",
  });

  const sensors = useSensors();

  const onDragEnd = (event: DragEndEvent) => {
    const { over, active } = event;
    if (!over || !active) return;

    const { id } = over;
    const { id: activeId } = active;
    const updatedItemLists = [...currentLists];
    const newIndex = updatedItemLists.findIndex((list) => list._id === id);
    const oldIndex = updatedItemLists.findIndex(
      (list) => list._id === activeId
    );
    const element = currentLists[oldIndex];
    updatedItemLists.splice(oldIndex, 1);
    updatedItemLists.splice(newIndex, 0, element);
    dispatch(updateItemLists(updatedItemLists));
  };

  useEffect(() => {
    const getItemLists = async () => {
      if (!db) return;
      try {
        const response: ItemLists | undefined = await db?.get("ItemLists");
        const _itemLists = response?.itemLists || [];
        const _activeList = response?.activeList;
        dispatch(initiateItemLists(_itemLists));
        if (_activeList) {
          dispatch(setInitialItemList(_activeList._id));
        }
      } catch (e) {
        console.error(e);
      }
    };

    getItemLists();
  }, [db, dispatch, updater]);

  const updateItemListsFromExternal = useCallback(
    async (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        for (const _update of updates) {
          if (_update._id === "ItemLists") {
            console.log("updating item lists from remote");
            const update = _update as ItemLists;
            dispatch(updateItemListsFromRemote(update.itemLists));
          }
        }
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch]
  );

  useEffect(() => {
    if (!updater) return;
    updater.addEventListener("update", updateItemListsFromExternal);

    return () =>
      updater.removeEventListener("update", updateItemListsFromExternal);
  }, [updater, updateItemListsFromExternal]);

  useGlobalBroadcast(updateItemListsFromExternal);

  const _updateItemLists = (list: ItemList) => {
    dispatch(
      updateItemLists(
        currentLists.map((item) => (item._id === list._id ? list : item))
      )
    );
    if (list._id === selectedList?._id) {
      dispatch(selectItemList(list._id));
    }
  };

  return (
    <DndContext
      onDragEnd={access === "full" ? onDragEnd : undefined}
      sensors={sensors}
    >
      <div className={`flex gap-2 items-center ${className || ""}`}>
        <PopOver
          TriggeringButton={
            <Button
              svg={List}
              iconSize="lg"
              variant="primary"
              className="max-lg:max-w-40 lg:max-w-64"
              truncate
            >
              {selectedList?.name}
            </Button>
          }
        >
          <div className="flex flex-col gap-2">
            <div className="flex gap-4 flex-1">
              <section className="flex-1 h-full p-1 flex flex-col">
                <h3 className="text-lg font-semibold mb-2 text-center">
                  {heading}
                </h3>
                <ul
                  ref={setNodeRef}
                  className="scrollbar-variable flex-1 overflow-y-auto max-h-64 overflow-x-hidden"
                >
                  <SortableContext
                    items={currentLists.map((list) => list._id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {currentLists.map((list, index) => (
                      <Outline
                        key={list._id}
                        list={list}
                        canEdit={access === "full"}
                        isSelected={list._id === selectedList?._id}
                        selectList={(listId: string) =>
                          dispatch(selectItemList(listId))
                        }
                        setActiveList={(listId: string) =>
                          dispatch(setActiveItemList(listId))
                        }
                        isActive={list._id === activeList?._id}
                        copyList={async (list) => {
                          const newList = await createItemListFromExisting({
                            db,
                            currentLists,
                            list,
                          });
                          if (newList) {
                            dispatch(
                              updateItemLists([...currentLists, newList])
                            );
                          }
                        }}
                        deleteList={
                          index === 0
                            ? undefined
                            : async (id) => {
                                dispatch(removeFromItemLists(id));
                                if (db) {
                                  const existingList: DBItemListDetails =
                                    await db.get(id);
                                  db.remove(existingList);
                                  if (selectedList?._id === id) {
                                    dispatch(
                                      selectItemList(currentLists[0]._id)
                                    );
                                  }
                                  if (activeList?._id === id) {
                                    dispatch(
                                      setActiveItemList(currentLists[0]._id)
                                    );
                                  }
                                }
                                dispatch(ActionCreators.clearHistory());
                              }
                        }
                        updateList={(list) => {
                          _updateItemLists(list);
                        }}
                      />
                    ))}
                  </SortableContext>
                </ul>
              </section>
            </div>
            {access === "full" && (
              <Button
                svg={justAdded ? Check : Plus}
                color={justAdded ? "#84cc16" : "#22d3ee"}
                className="w-full justify-center text-base"
                disabled={justAdded}
                onClick={async () => {
                  const newList = await createNewItemList({
                    db,
                    name: "New Outline",
                    currentLists,
                  });
                  setJustAdded(true);

                  dispatch(updateItemLists([...currentLists, newList]));
                  setTimeout(() => setJustAdded(false), 2000);
                }}
              >
                {justAdded ? "Added!" : "Add New Service"}
              </Button>
            )}
          </div>
        </PopOver>
      </div>
    </DndContext>
  );
};

export default Services;
