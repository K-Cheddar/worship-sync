import Button from "../../components/Button/Button";
import { Plus, Check, Download, RefreshCw } from "lucide-react";

import { useDispatch, useSelector } from "../../hooks";
import {
  addOverlayToList,
  deleteOverlayFromList,
  updateInitialList,
  updateList,
  updateOverlayInList,
  updateOverlayListFromRemote,
} from "../../store/overlaysSlice";
import { useCallback, useContext, useEffect, useState } from "react";
import Overlay from "./Overlay";
import { DndContext, useDroppable, DragEndEvent } from "@dnd-kit/core";

import { useSensors } from "../../utils/dndUtils";

import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ControllerInfoContext } from "../../context/controllerInfo";
import generateRandomId from "../../utils/generateRandomId";
import { keepElementInView } from "../../utils/generalUtils";
import { RootState } from "../../store/store";
import Drawer from "../../components/Drawer";
import StyleEditor from "../../components/StyleEditor";
import { DBOverlay, OverlayFormatting, OverlayInfo } from "../../types";
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
import { getDefaultFormatting } from "../../utils/overlayUtils";
import { DBOverlayTemplates } from "../../types";
import PopOver from "../../components/PopOver/PopOver";
import Input from "../../components/Input/Input";
import { getNamesFromUrl } from "./eventParser";

const Overlays = () => {
  const { list, initialList } = useSelector(
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

  const { selectedList } = useSelector(
    (state: RootState) => state.undoable.present.itemLists
  );

  const selectedOverlay = _selectedOverlay || {
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
  };

  const dispatch = useDispatch();
  const { isMobile, db, updater } = useContext(ControllerInfoContext) || {
    isMobile: false,
  };

  const [showPreview, setShowPreview] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [isStyleDrawerOpen, setIsStyleDrawerOpen] = useState(false);
  const [isTemplateDrawerOpen, setIsTemplateDrawerOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [isGettingNames, setIsGettingNames] = useState(false);
  useEffect(() => {
    if (isTemplateDrawerOpen) {
      setIsStyleDrawerOpen(false);
    }
  }, [isTemplateDrawerOpen]);

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
            console.log("updating overlay from remote", event);
            const update = _update as DBOverlay;

            const overlayIndex = list.findIndex(
              (overlay) => overlay.id === update.id
            );

            if (overlayIndex === -1) {
              continue;
            }

            let updatedOverlayList = list
              .map((overlay, index) => {
                if (index === overlayIndex) {
                  return update;
                }
                return overlay;
              })
              .filter((overlay) => !overlay.isHidden);

            dispatch(updateOverlayListFromRemote(updatedOverlayList));
          }
        }
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch, list]
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
    const overlayElement = document.getElementById(
      `overlay-${selectedOverlayId}`
    );
    const parentElement = document.getElementById("overlays-list");

    const scrollToElement = () => {
      if (selectedOverlayId && overlayElement && parentElement) {
        keepElementInView({
          child: overlayElement,
          parent: parentElement,
        });
      }
    };

    if (isMobile) {
      setTimeout(() => {
        scrollToElement();
      }, 100);
    } else {
      scrollToElement();
    }
  }, [selectedOverlay.id, list, isMobile]);

  useEffect(() => {
    return () => {
      dispatch(updateInitialList());
    };
  }, [dispatch]);

  const handleOverlayUpdate = (overlay: OverlayInfo) => {
    dispatch(updateOverlay(overlay));
    dispatch(updateOverlayInList(overlay));
  };

  const handleFormattingChange = (formatting: OverlayFormatting) => {
    handleOverlayUpdate({
      ...selectedOverlay,
      formatting: formatting,
    });
  };

  const handleDeleteOverlay = async (overlayId: string) => {
    dispatch(deleteOverlayFromList(overlayId));
    if (selectedOverlay.id === overlayId) {
      dispatch(deleteOverlay(overlayId));
    } else if (db) {
      const overlayDoc: DBOverlay | undefined = await db.get(
        `overlay-${overlayId}`
      );
      if (overlayDoc) {
        overlayDoc.isHidden = true;
        await db.put(overlayDoc);
      }
    }
  };

  const selectAndLoadOverlay = async (overlayId: string) => {
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

  const getNames = async (url: string) => {
    setIsGettingNames(true);
    const names = await getNamesFromUrl(url);

    console.log("Parsed event data:", names);

    // Compare names with existing overlays - find closest match for each element
    const matches: { leader: string; overlayEvent: string }[] = [];

    // Process each event data item sequentially to handle async database operations
    for (const eventData of names) {
      let bestOverlay: any = null;
      let bestSimilarity = 0;
      const elementLower = eventData.element.toLowerCase().trim();

      // Clean up the element text - remove extra song details and common prefixes
      const cleanElement = elementLower
        .replace(/song of praise.*?\([^)]+\)/g, "song of praise")
        .replace(/congregational hymn.*?\([^)]+\)/g, "hymn")
        .replace(/welcome song.*?\([^)]+\)/g, "welcome song")
        .replace(/appeal song.*?\([^)]+\)/g, "appeal song")
        .replace(/after glow.*?\([^)]+\)/g, "after glow")
        .replace(/appreciation.*?\([^)]+\)/g, "appreciation")
        .replace(/call to (praise|prayer)/g, "call to $1")
        .replace(/reading the word.*?-.*$/g, "reading")
        .replace(/sermon.*?-.*$/g, "sermon")
        .replace(/children.*?-.*$/g, "children")
        .replace(/mission.*?-.*$/g, "mission")
        .replace(/sabbath school.*?-.*$/g, "sabbath school")
        .replace(/pastoral greetings.*\/.*$/g, "announcements")
        .trim();

      list.forEach((overlay) => {
        const overlayEventLower = overlay.event?.toLowerCase().trim() || "";
        if (!overlayEventLower) return; // Skip empty events

        let similarity = 0;

        // Calculate similarity score with better matching logic
        if (cleanElement === overlayEventLower) {
          similarity = 100; // Exact match
        } else if (cleanElement.includes(overlayEventLower)) {
          // Element contains overlay event - reward longer matches
          similarity = Math.max(
            30,
            (overlayEventLower.length / cleanElement.length) * 80
          );
        } else if (overlayEventLower.includes(cleanElement)) {
          // Overlay contains element - reward longer overlay events
          similarity = Math.max(
            30,
            (cleanElement.length / overlayEventLower.length) * 80
          );
        } else {
          // Check for word-based similarity (split by spaces and check for word matches)
          const elementWords = cleanElement.split(/\s+/);
          const overlayWords = overlayEventLower.split(/\s+/);
          const matchingWords = elementWords.filter(
            (word) =>
              word.length > 2 &&
              overlayWords.some((ow) => ow.includes(word) || word.includes(ow))
          );

          if (matchingWords.length > 0) {
            similarity = Math.max(
              25,
              (matchingWords.length /
                Math.max(elementWords.length, overlayWords.length)) *
                60
            );
          }
        }

        // Keep track of the best match
        if (similarity > bestSimilarity && similarity >= 25) {
          // Minimum threshold
          bestOverlay = overlay;
          bestSimilarity = similarity;
        }
      });

      // Add the best match if found and update the overlay
      if (bestOverlay && bestSimilarity >= 25) {
        matches.push({
          leader: eventData.leader,
          overlayEvent: bestOverlay.event || "No event name",
        });

        // Update the overlay in the database
        try {
          if (db) {
            // Get the current overlay from database
            const dbOverlay = await db.get(`overlay-${bestOverlay.id}`);

            // Update with new name and timestamp
            const updatedOverlay = {
              ...dbOverlay,
              name: eventData.leader,
              updatedAt: new Date().toISOString(),
            };

            // Save back to database
            await db.put(updatedOverlay);

            // Update in Redux state
            dispatch(
              updateOverlayInList({
                ...bestOverlay,
                name: eventData.leader,
              })
            );
          }
        } catch (error) {
          console.error(`Failed to update overlay ${bestOverlay.id}:`, error);
        }
      }
    }

    if (matches.length > 0) {
      console.log(
        `Successfully updated ${matches.length} overlays with new names`
      );
    } else {
      console.log("No matches found - no overlays were updated");
    }

    setIsGettingNames(false);
  };

  const addButtonText =
    selectedOverlay.name || selectedOverlay.url
      ? "Copy Overlay"
      : "Add Overlay";

  const justAddedText =
    selectedOverlay.name || selectedOverlay.url ? "Copied!" : "Added!";

  console.log(list, selectedList);

  return (
    <ErrorBoundary>
      <DndContext onDragEnd={onDragEnd} sensors={sensors}>
        <div className="flex flex-col w-full h-full p-2 gap-2">
          <div className="flex w-full items-center gap-2 justify-center">
            <h2 className="text-xl font-semibold text-center h-fit">
              Overlays
            </h2>
            <PopOver
              TriggeringButton={
                <Button
                  className="text-sm hidden"
                  padding="px-1"
                  variant="tertiary"
                  color="#06b6d4"
                  svg={RefreshCw}
                >
                  Get Names
                </Button>
              }
            >
              <div className="flex gap-2">
                <Input
                  label="Service Planning URL"
                  className="flex gap-2"
                  value={url}
                  onChange={(val) => setUrl(val as string)}
                />
                <Button
                  variant="primary"
                  onClick={() => getNames(url)}
                  isLoading={isGettingNames}
                  svg={Download}
                  color="#06b6d4"
                />
              </div>
            </PopOver>
          </div>
          {!isLoading && list.length === 0 && (
            <p className="text-sm px-2">
              This outline doesn't have any overlays yet. Click the button below
              to add some.
            </p>
          )}
          {isLoading ? (
            <h3 className="text-lg text-center">Loading overlays...</h3>
          ) : (
            <div className="flex gap-2 max-lg:flex-col-reverse pb-2 flex-1 min-h-0">
              <section className="flex-1 flex flex-col gap-2 min-h-0">
                <ul
                  id="overlays-list"
                  className="scrollbar-variable flex flex-col gap-2 w-full overflow-y-auto overflow-x-hidden flex-1 min-h-0 pr-2"
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
                        />
                      );
                    })}
                  </SortableContext>
                </ul>
                <Button
                  className="text-sm w-full justify-center mt-2"
                  svg={justAdded ? Check : Plus}
                  color={justAdded ? "#84cc16" : "#22d3ee"}
                  disabled={justAdded}
                  onClick={createNewOverlay}
                >
                  {justAdded ? justAddedText : addButtonText}
                </Button>
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
              />
            </div>
          )}
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
            className="p-4 flex-1 overflow-y-auto"
          />
        </Drawer>
        <OverlayTemplatesDrawer
          isOpen={isTemplateDrawerOpen}
          onClose={() => setIsTemplateDrawerOpen(false)}
          isMobile={isMobile}
          selectedOverlay={selectedOverlay}
          onApplyFormatting={(overlay) => handleOverlayUpdate(overlay)}
        />
      </DndContext>
    </ErrorBoundary>
  );
};

export default Overlays;
