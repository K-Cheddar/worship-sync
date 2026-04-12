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
import { cn } from "../../../utils/cnHelper";
import { toolbarTabClassName } from "./ToolbarButton";

type OutlinesProps = {
  className?: string;
  /** Full-width header-style trigger for the service outline column (vs compact toolbar). */
  servicePanel?: boolean;
  /** Use the same tab styling as the main toolbar row (overlay controller). */
  matchToolbarTabs?: boolean;
};

const Services = ({
  className,
  servicePanel = false,
  matchToolbarTabs = false,
}: OutlinesProps) => {
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
  const [outlinePopoverOpen, setOutlinePopoverOpen] = useState(false);

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

        // Note: Video cache sync is handled in Controller.tsx when database is ready
        // No need to sync here as it would be redundant
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

  const triggerIconSize = servicePanel ? "sm" : matchToolbarTabs ? "md" : "lg";
  const triggerVariant = servicePanel
    ? "tertiary"
    : matchToolbarTabs
      ? outlinePopoverOpen
        ? "none"
        : "tertiary"
      : "primary";
  const triggerClass = cn(
    servicePanel
      ? "w-full max-w-none justify-center gap-2 border-0 px-3 py-2.5 text-xs font-bold uppercase tracking-widest text-white shadow-none hover:bg-white/10 active:bg-white/[0.12]"
      : matchToolbarTabs
        ? cn(toolbarTabClassName(outlinePopoverOpen, false), "max-w-64")
        : "max-w-64",
    access === "music" && "cursor-default",
  );
  const triggerColor =
    matchToolbarTabs && !servicePanel && outlinePopoverOpen
      ? "#ffffff"
      : undefined;

  return (
    <DndContext
      onDragEnd={access === "full" ? onDragEnd : undefined}
      sensors={sensors}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2",
          servicePanel && "w-full",
          className,
        )}
      >
        {access === "music" ? (
          <Button
            svg={List}
            iconSize={triggerIconSize}
            variant={
              matchToolbarTabs && !servicePanel ? "tertiary" : triggerVariant
            }
            className={
              matchToolbarTabs && !servicePanel
                ? cn(
                  toolbarTabClassName(false, false),
                  "max-w-64 cursor-default",
                )
                : triggerClass
            }
            truncate
            disabled
            title="Outline is managed by a full-access operator"
          >
            {selectedList?.name}
          </Button>
        ) : (
          <PopOver
            onOpenChange={matchToolbarTabs ? setOutlinePopoverOpen : undefined}
            TriggeringButton={
              <Button
                svg={List}
                iconSize={triggerIconSize}
                variant={triggerVariant}
                color={triggerColor}
                className={triggerClass}
                truncate
              >
                {selectedList?.name}
              </Button>
            }
            align={servicePanel ? "start" : "end"}
            contentClassName={
              servicePanel
                ? "min-w-[18rem] max-w-[min(26rem,calc(100vw-1.5rem))] overflow-x-visible border-gray-600 bg-gray-800 text-white shadow-md"
                : undefined
            }
            headerRowClassName={
              servicePanel ? "px-5 pt-2 pb-1.5" : undefined
            }
            bodyClassName={
              servicePanel ? "px-5 pb-3 pt-1.5" : undefined
            }
          >
            <div
              className={cn(
                "flex flex-col gap-2",
                servicePanel && "min-w-0 gap-1.5",
              )}
            >
              <div className={cn("flex flex-1 gap-4", servicePanel && "min-w-0")}>
                <section
                  className={cn(
                    "flex h-full flex-1 flex-col p-1",
                    servicePanel && "min-w-0 p-0",
                  )}
                >
                  <h3
                    className={cn(
                      "mb-2 text-center text-lg font-semibold",
                      servicePanel &&
                      "mb-1.5 border-b border-gray-600 pb-2 text-[11px] font-bold uppercase tracking-widest text-gray-100",
                    )}
                  >
                    {heading}
                  </h3>
                  <ul
                    ref={setNodeRef}
                    className={cn(
                      "scrollbar-variable max-h-64 flex-1 overflow-y-auto",
                      servicePanel
                        ? "min-w-0 max-h-[min(18rem,50vh)] overflow-x-visible"
                        : "overflow-x-hidden",
                    )}
                  >
                    <SortableContext
                      items={currentLists.map((list) => list._id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {currentLists.map((list, index) => (
                        <Outline
                          key={list._id}
                          list={list}
                          panel={servicePanel}
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
                  className={cn(
                    "w-full justify-center text-base",
                    servicePanel &&
                    "border border-gray-600 bg-gray-700/80 py-2 text-xs font-semibold uppercase tracking-wider shadow-none hover:bg-gray-600",
                  )}
                  variant={servicePanel ? "tertiary" : "primary"}
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
                  {justAdded ? "Added." : "Add New Service"}
                </Button>
              )}
            </div>
          </PopOver>
        )}
      </div>
    </DndContext>
  );
};

export default Services;
