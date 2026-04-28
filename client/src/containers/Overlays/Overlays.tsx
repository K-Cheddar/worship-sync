import Button from "../../components/Button/Button";
import { Plus, Check, FolderOpen, History } from "lucide-react";

import { useDispatch, useSelector } from "../../hooks";
import { useStore } from "react-redux";
import {
  addOverlayToList,
  deleteOverlayFromList,
  getOverlayHistoryKeysForType,
  mergeOverlayIntoHistory,
  mergeOverlaysIntoHistory,
  updateInitialList,
  updateList,
  updateOverlayInList,
  updateOverlayListFromRemote,
} from "../../store/overlaysSlice";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import Overlay from "./Overlay";
import { DndContext, useDroppable, DragEndEvent } from "@dnd-kit/core";

import { useSensors } from "../../utils/dndUtils";

import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import generateRandomId from "../../utils/generateRandomId";
import { applyPouchAudit } from "../../utils/pouchAudit";
import { keepElementInView } from "../../utils/generalUtils";
import { RootState } from "../../store/store";
import Drawer from "../../components/Drawer";
import StyleEditor from "../../components/StyleEditor";
import {
  DBOverlay,
  OverlayFormatting,
  OverlayInfo,
  OverlayType,
} from "../../types";
import AddExistingOverlayDrawer from "./ExistingOverlaysDrawer";
import OverlayHistoryDrawer from "./OverlayHistoryDrawer";
import OverlayTemplatesDrawer from "./OverlayTemplatesDrawer";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import {
  deleteOverlay,
  selectOverlay,
  setIsOverlayLoading,
  updateOverlay,
} from "../../store/overlaySlice";
import { updateTemplatesFromRemote } from "../../store/overlayTemplatesSlice";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import OverlayEditor from "./OverlayEditor";
import OverlaysListSkeleton from "./OverlaysListSkeleton";
import { getDefaultFormatting } from "../../utils/overlayUtils";
import {
  shouldKeepLocalListRowForRemoteOverlay,
  syncSelectedOverlayFromRemote,
  type OverlaySyncRootSlice,
} from "../../utils/overlayRemoteSync";
import { normalizeOverlayForSync } from "../../utils/overlayUtils";
import { putOverlayHistoryDocs } from "../../utils/dbUtils";
import { DBOverlayTemplates } from "../../types";

const Overlays = () => {
  const { list, initialList, overlayHistory } = useSelector(
    (state: RootState) => state.undoable.present.overlays
  );

  const { selectedOverlay: _selectedOverlay, isOverlayLoading } = useSelector(
    (state: RootState) => state.undoable.present.overlay
  );

  const { isStreamTransmitting } = useSelector(
    (state: RootState) => state.presentation
  );
  const { isLoading } = useSelector(
    (state: RootState) => state.undoable.present.itemList
  );

  const defaultSelectedOverlay = useMemo(
    (): OverlayInfo => ({
      name: "",
      url: "",
      type: "participant",
      duration: 7,
      imageUrl: "",
      heading: "",
      subHeading: "",
      event: "",
      title: "",
      description: "",
      id: "",
      formatting: getDefaultFormatting("participant"),
    }),
    []
  );
  const selectedOverlay = _selectedOverlay ?? defaultSelectedOverlay;

  const dispatch = useDispatch();
  const store = useStore();
  const { isMobile, db, updater } = useContext(ControllerInfoContext) || {
    isMobile: false,
  };
  const { access } = useContext(GlobalInfoContext) || {};
  const canMutateOverlays = access !== "view";

  const [showPreview, setShowPreview] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [isStyleDrawerOpen, setIsStyleDrawerOpen] = useState(false);
  const [isTemplateDrawerOpen, setIsTemplateDrawerOpen] = useState(false);
  const [isAddExistingOpen, setIsAddExistingOpen] = useState(false);
  const [isOverlayHistoryDrawerOpen, setIsOverlayHistoryDrawerOpen] =
    useState(false);
  const [isApplyingFormattingToAll, setIsApplyingFormattingToAll] =
    useState(false);
  useEffect(() => {
    if (isTemplateDrawerOpen) {
      setIsStyleDrawerOpen(false);
      setIsAddExistingOpen(false);
    }
  }, [isTemplateDrawerOpen]);
  useEffect(() => {
    if (isAddExistingOpen) {
      setIsStyleDrawerOpen(false);
      setIsTemplateDrawerOpen(false);
    }
  }, [isAddExistingOpen]);

  useEffect(() => {
    if (!selectedOverlay.id) {
      setIsStyleDrawerOpen(false);
      setIsTemplateDrawerOpen(false);
    }
  }, [selectedOverlay.id]);

  const updateOverlayFromExternal = useCallback(
    async (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        for (const _update of updates) {
          // check if the list we have selected was updated
          if (_update._id?.startsWith("overlay-")) {
            const update = _update as DBOverlay;

            const overlayIndex = list.findIndex(
              (overlay) => overlay.id === update.id
            );

            if (overlayIndex === -1) {
              continue;
            }

            const normalized = normalizeOverlayForSync(update);
            const getState = store.getState as () => OverlaySyncRootSlice;
            const keepLocalRow =
              shouldKeepLocalListRowForRemoteOverlay(getState, normalized);

            const updatedOverlayList = list.map((overlay, index) => {
              if (index === overlayIndex) {
                if (keepLocalRow) {
                  return overlay;
                }
                return update;
              }
              return overlay;
            });

            dispatch(updateOverlayListFromRemote(updatedOverlayList));
            syncSelectedOverlayFromRemote(
              dispatch,
              store.getState as () => OverlaySyncRootSlice,
              update,
            );
          }
        }
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch, list, store]
  );

  useEffect(() => {
    if (!updater) return;

    updater.addEventListener("update", updateOverlayFromExternal);

    return () =>
      updater.removeEventListener("update", updateOverlayFromExternal);
  }, [updater, updateOverlayFromExternal]);

  useGlobalBroadcast(updateOverlayFromExternal);

  const updateTemplatesFromExternal = useCallback(
    async (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        for (const _update of updates) {
          if (_update._id === "overlay-templates") {
            console.log("updating overlay templates from remote", event);
            const update = _update as DBOverlayTemplates;
            dispatch(updateTemplatesFromRemote(update.templatesByType));
          }
        }
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch]
  );

  useGlobalBroadcast(updateTemplatesFromExternal);

  const { setNodeRef } = useDroppable({
    id: "overlays-list",
  });

  const sensors = useSensors();

  const onDragEnd = (event: DragEndEvent) => {
    if (!canMutateOverlays) return;
    const { over, active } = event;
    if (!over || !active) return;

    const { id: overId } = over;
    const { id: activeId } = active;
    const updatedOverlays = [...list];
    const newIndex = updatedOverlays.findIndex(
      (overlay) => overlay.id === overId
    );
    const oldIndex = updatedOverlays.findIndex(
      (overlay) => overlay.id === activeId
    );
    const element = list[oldIndex];
    updatedOverlays.splice(oldIndex, 1);
    updatedOverlays.splice(newIndex, 0, element);
    dispatch(updateList(updatedOverlays));
  };

  useEffect(() => {
    const selectedOverlayId = selectedOverlay.id;
    if (!selectedOverlayId) return;

    const scrollToElement = () => {
      const overlayElement = document.getElementById(
        `overlay-${selectedOverlayId}`
      );
      const parentElement = document.getElementById("overlays-list");

      if (selectedOverlayId && overlayElement && parentElement) {
        keepElementInView({
          child: overlayElement,
          parent: parentElement,
        });
      }
    };

    if (isMobile) {
      const timeoutId = window.setTimeout(scrollToElement, 100);
      return () => window.clearTimeout(timeoutId);
    }

    scrollToElement();
  }, [selectedOverlay.id, isMobile]);

  useEffect(() => {
    return () => {
      dispatch(updateInitialList());
    };
  }, [dispatch]);

  const handleOverlayUpdate = useCallback(
    async (overlay: OverlayInfo) => {
      if (!overlay.id) return;

      // Draft flushes can arrive after selection swaps; persist by payload id so edits are not dropped.
      if (selectedOverlay.id && overlay.id !== selectedOverlay.id) {
        dispatch(updateOverlayInList(overlay));
        if (!db) return;
        try {
          const dbOverlay: DBOverlay = await db.get(`overlay-${overlay.id}`);
          const updatedAt = new Date().toISOString();
          const merged = applyPouchAudit(
            dbOverlay,
            { ...dbOverlay, ...overlay, updatedAt },
            { isNew: false },
          );
          await db.put(merged);
        } catch (error) {
          console.error("Error persisting non-selected overlay", error);
        }
        return;
      }

      dispatch(updateOverlay(overlay));
      dispatch(updateOverlayInList(overlay));
    },
    [db, dispatch, selectedOverlay.id],
  );

  const handleApplyFormattingToAll = async (formatting: OverlayFormatting) => {
    const type = selectedOverlay.type as OverlayType;
    const overlaysOfType = list.filter(
      (o) => (o.type ?? "participant") === type
    );
    setIsApplyingFormattingToAll(true);
    dispatch(updateOverlay({
      ...selectedOverlay,
      formatting: formatting,
    }));
    for (const overlay of overlaysOfType) {
      dispatch(updateOverlayInList({ id: overlay.id, formatting }));
    }
    if (db) {
      for (const overlay of overlaysOfType) {
        try {
          const db_overlay: DBOverlay = await db.get(`overlay-${overlay.id}`);
          const updatedAt = new Date().toISOString();
          const toSave = applyPouchAudit(
            db_overlay,
            { ...db_overlay, formatting, updatedAt },
            { isNew: false },
          );
          await db.put(toSave);
        } catch (e) {
          console.error("Failed to update overlay in db", overlay.id, e);
        }
      }
    }
    setIsApplyingFormattingToAll(false);
  };

  const handleFormattingChange = (formatting: OverlayFormatting) => {
    handleOverlayUpdate({
      ...selectedOverlay,
      formatting: formatting,
    });
  };

  const saveCurrentOverlayToHistory = useCallback(async () => {
    if (!selectedOverlay.id || !db) return;
    const keys = getOverlayHistoryKeysForType(selectedOverlay.type);
    const merged = mergeOverlaysIntoHistory(overlayHistory, [selectedOverlay]);
    const keysToSave = keys.filter(
      (k) =>
        JSON.stringify(merged[k]) !== JSON.stringify(overlayHistory[k])
    );
    if (keysToSave.length === 0) return;
    dispatch(mergeOverlayIntoHistory(selectedOverlay));
    putOverlayHistoryDocs(db, merged, keysToSave).catch(console.error);
  }, [dispatch, selectedOverlay, overlayHistory, db]);

  const handleDeleteOverlay = (overlayId: string) => {
    if (selectedOverlay.id === overlayId) {
      saveCurrentOverlayToHistory();
    }
    dispatch(deleteOverlayFromList(overlayId));
    if (selectedOverlay.id === overlayId) {
      dispatch(deleteOverlay(overlayId));
    }
  };

  const handleAfterAddToOverlayList = (overlay: OverlayInfo) => {
    saveCurrentOverlayToHistory();
    dispatch(
      selectOverlay({
        ...overlay,
        formatting: {
          ...getDefaultFormatting(overlay.type || "participant"),
          ...overlay.formatting,
        },
      })
    );
  };

  const selectAndLoadOverlay = async (overlayId: string) => {
    if (
      selectedOverlay.id &&
      selectedOverlay.id !== overlayId
    ) {
      await saveCurrentOverlayToHistory();
    }
    try {
      dispatch(setIsOverlayLoading(true));
      const loadedOverlay: DBOverlay | undefined = await db?.get(
        `overlay-${overlayId}`
      );
      if (loadedOverlay) {
        dispatch(
          selectOverlay({
            ...loadedOverlay,
            formatting: {
              ...getDefaultFormatting(loadedOverlay.type || "participant"),
              ...loadedOverlay.formatting,
            },
          })
        );
      }
    } catch (error) {
      dispatch(selectOverlay(undefined));
      console.error("Error loading overlay", error);
    } finally {
      dispatch(setIsOverlayLoading(false));
    }
  };

  const createNewOverlay = async () => {
    setJustAdded(true);
    const newId = generateRandomId();
    try {
      dispatch(setIsOverlayLoading(true));
      const newOverlay: OverlayInfo = {
        ...selectedOverlay,
        id: newId,
      };

      await db?.put({
        _id: `overlay-${newId}`,
        ...selectedOverlay,
        id: newId,
      });
      dispatch(
        addOverlayToList({ newOverlay, selectedOverlayId: selectedOverlay.id })
      );
    } catch (error) {
      console.error("Error creating new overlay", error);
    } finally {
      dispatch(setIsOverlayLoading(false));
      setTimeout(() => {
        setJustAdded(false);
      }, 500);
    }
  };

  const addButtonText =
    selectedOverlay.name || selectedOverlay.url
      ? "Copy Overlay"
      : "Add Overlay";

  const justAddedText =
    selectedOverlay.name || selectedOverlay.url ? "Copied." : "Added.";

  return (
    <ErrorBoundary>
      <DndContext onDragEnd={onDragEnd} sensors={sensors}>
        <div className="flex flex-col w-full h-full p-2 gap-2">
          <div
            className={
              access === "view"
                ? "mx-auto flex w-full max-w-[70%] flex-1 min-h-0 min-w-0 flex-col gap-2"
                : "flex w-full flex-1 min-h-0 min-w-0 flex-col gap-2"
            }
          >
            <div className="relative flex w-full items-center">
              <h2 className="flex-1 text-xl font-semibold text-center h-fit">
                Overlays
              </h2>
              <div className="absolute right-0 flex items-center gap-2">
                {canMutateOverlays && (
                  <Button
                    variant="tertiary"
                    padding="px-2 py-1"
                    color="#f59e0b"
                    svg={History}
                    onClick={() => setIsOverlayHistoryDrawerOpen(true)}
                    title="Overlay history"
                    iconSize="sm"
                  />
                )}
              </div>
            </div>
            <OverlayHistoryDrawer
              isOpen={isOverlayHistoryDrawerOpen}
              onClose={() => setIsOverlayHistoryDrawerOpen(false)}
              size={isMobile ? "xl" : "lg"}
              position={isMobile ? "bottom" : "right"}
            />
            {!isLoading && list.length === 0 && (
              <p className="text-sm px-2">
                {canMutateOverlays
                  ? "This outline doesn't have any overlays yet. Click the button below to add some."
                  : "This outline doesn't have any overlays yet."}
              </p>
            )}
            <div className="flex min-h-0 flex-1 gap-2 pb-2 max-lg:flex-col-reverse">
              <section className="flex min-h-0 flex-1 flex-col gap-2">
                {isLoading ? (
                  <OverlaysListSkeleton
                    ref={setNodeRef}
                    readOnly={!canMutateOverlays}
                  />
                ) : (
                  <ul
                    id="overlays-list"
                    className="scrollbar-variable flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-2"
                    ref={setNodeRef}
                  >
                    <SortableContext
                      items={list.map((overlay) => overlay.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {list.map((overlay) => {
                        return (
                          <Overlay
                            key={overlay.id}
                            initialList={initialList}
                            overlay={overlay}
                            selectedId={selectedOverlay.id}
                            isStreamTransmitting={isStreamTransmitting}
                            selectAndLoadOverlay={selectAndLoadOverlay}
                            handleDeleteOverlay={handleDeleteOverlay}
                            readOnly={!canMutateOverlays}
                          />
                        );
                      })}
                    </SortableContext>
                  </ul>
                )}
                {canMutateOverlays &&
                  (isLoading ? (
                    <div className="mt-2 flex gap-2" aria-hidden="true">
                      <div className="h-9 min-h-9 flex-1 animate-pulse rounded-md bg-white/10" />
                      <div className="h-9 min-h-9 flex-1 animate-pulse rounded-md bg-white/10" />
                    </div>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <Button
                        className="flex-1 justify-center text-sm"
                        svg={justAdded ? Check : Plus}
                        color={justAdded ? "#84cc16" : "#22d3ee"}
                        disabled={justAdded}
                        onClick={createNewOverlay}
                      >
                        {justAdded ? justAddedText : addButtonText}
                      </Button>
                      <Button
                        className="flex-1 justify-center text-sm"
                        svg={FolderOpen}
                        color="#a78bfa"
                        onClick={() => setIsAddExistingOpen(true)}
                      >
                        Existing overlays
                      </Button>
                    </div>
                  ))}
              </section>
              <OverlayEditor
                selectedOverlay={selectedOverlay}
                isOverlayLoading={isOverlayLoading}
                setShowPreview={setShowPreview}
                showPreview={showPreview}
                setIsStyleDrawerOpen={setIsStyleDrawerOpen}
                setIsTemplateDrawerOpen={setIsTemplateDrawerOpen}
                isMobile={isMobile}
                handleOverlayUpdate={handleOverlayUpdate}
                handleFormattingChange={handleFormattingChange}
                readOnly={!canMutateOverlays}
              />
            </div>
          </div>
        </div>

        <Drawer
          isOpen={isStyleDrawerOpen}
          onClose={() => setIsStyleDrawerOpen(false)}
          size={isMobile ? "lg" : "md"}
          position={isMobile ? "bottom" : "right"}
          title="Edit Overlay Style"
          closeOnBackdropClick={false}
          closeOnEscape
          contentPadding="p-0"
          contentClassName="flex-1 min-h-0"
        >
          <StyleEditor
            formatting={selectedOverlay.formatting || {}}
            onChange={handleFormattingChange}
            overlayType={selectedOverlay.type}
            className="p-4 flex-1 overflow-y-auto"
          />
        </Drawer>
        <OverlayTemplatesDrawer
          isOpen={isTemplateDrawerOpen}
          onClose={() => setIsTemplateDrawerOpen(false)}
          isMobile={isMobile}
          selectedOverlay={selectedOverlay}
          onApplyFormatting={(overlay) => handleOverlayUpdate(overlay)}
          onApplyFormattingToAll={handleApplyFormattingToAll}
          isApplyingFormattingToAll={isApplyingFormattingToAll}
        />
        <AddExistingOverlayDrawer
          isOpen={isAddExistingOpen}
          onClose={() => setIsAddExistingOpen(false)}
          db={db}
          currentListIds={list.map((o) => o.id)}
          selectedOverlayId={selectedOverlay.id || undefined}
          onAddToOverlayList={handleAfterAddToOverlayList}
          isMobile={isMobile}
        />
      </DndContext>
    </ErrorBoundary>
  );
};

export default Overlays;
