import Button from "../../components/Button/Button";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import { ReactComponent as CheckSVG } from "../../assets/icons/check.svg";
import { ReactComponent as EditSVG } from "../../assets/icons/edit.svg";
import { ReactComponent as TemplateSVG } from "../../assets/icons/style.svg";
import { useDispatch, useSelector } from "../../hooks";
import {
  addOverlayToList,
  deleteOverlayFromList,
  updateInitialList,
  updateList,
  updateOverlayInList,
  updateOverlayListFromRemote,
} from "../../store/overlaysSlice";
import Input from "../../components/Input/Input";
import "./Overlays.scss";
import {
  CSSProperties,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import Overlay from "./Overlay";
import { DndContext, useDroppable, DragEndEvent } from "@dnd-kit/core";

import { useSensors } from "../../utils/dndUtils";

import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import RadioButton from "../../components/RadioButton/RadioButton";
import { ControllerInfoContext } from "../../context/controllerInfo";
import generateRandomId from "../../utils/generateRandomId";
import TextArea from "../../components/TextArea/TextArea";
import { keepElementInView } from "../../utils/generalUtils";
import { RootState } from "../../store/store";
import Drawer from "../../components/Drawer";
import StyleEditor from "../../components/StyleEditor";
import { DBOverlay, OverlayFormatting, OverlayInfo } from "../../types";
import {
  defaultImageOverlayStyles,
  defaultParticipantOverlayStyles,
  defaultQrCodeOverlayStyles,
  defaultStbOverlayStyles,
} from "../../components/DisplayWindow/defaultOverlayStyles";
import OverlayPreview from "./OverlayPreview";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import {
  deleteOverlay,
  selectOverlay,
  setIsOverlayLoading,
  updateOverlay,
} from "../../store/overlaySlice";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";

const typeToName = {
  participant: "Participant",
  "stick-to-bottom": "Stick to Bottom",
  "qr-code": "QR Code",
  image: "Image",
};

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

  const [overlayEditorHeight, setOverlayEditorHeight] = useState(0);
  const [overlayHeaderHeight, setOverlayHeaderHeight] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [isStyleDrawerOpen, setIsStyleDrawerOpen] = useState(false);
  const [isTemplateDrawerOpen, setIsTemplateDrawerOpen] = useState(false);

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

  const overlayEditorRef = useCallback((node: HTMLDivElement) => {
    if (node) {
      const resizeObserver = new ResizeObserver((entries) => {
        setOverlayEditorHeight(entries[0].borderBoxSize[0].blockSize);
      });

      resizeObserver.observe(node);
    }
  }, []);

  const overlayHeaderRef = useCallback((node: HTMLDivElement) => {
    if (node) {
      const resizeObserver = new ResizeObserver((entries) => {
        setOverlayHeaderHeight(entries[0].borderBoxSize[0].blockSize);
      });

      resizeObserver.observe(node);
    }
  }, []);

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

  const handleDeleteOverlay = (overlayId: string) => {
    dispatch(deleteOverlayFromList(overlayId));
    dispatch(deleteOverlay(overlayId));
  };

  const selectAndLoadOverlay = async (overlayId: string) => {
    try {
      dispatch(setIsOverlayLoading(true));
      const loadedOverlay: DBOverlay | undefined = await db?.get(
        `overlay-${overlayId}`
      );
      if (loadedOverlay) {
        dispatch(selectOverlay(loadedOverlay));
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

  const commonInputProps = {
    className: "text-sm flex gap-2 items-center w-full",
    labelClassName: "w-24",
    "data-ignore-undo": "true",
  };

  const addButtonText =
    selectedOverlay.name || selectedOverlay.url
      ? "Copy Overlay"
      : "Add Overlay";

  const justAddedText =
    selectedOverlay.name || selectedOverlay.url ? "Copied!" : "Added!";

  return (
    <ErrorBoundary>
      <DndContext onDragEnd={onDragEnd} sensors={sensors}>
        <div
          className="flex flex-col w-full h-full p-2 gap-2"
          style={
            {
              "--overlay-editor-height": `${overlayEditorHeight}px`,
              "--overlay-header-height": `${overlayHeaderHeight}px`,
            } as CSSProperties
          }
        >
          <h2
            ref={overlayHeaderRef}
            className="text-xl font-semibold text-center h-fit"
          >
            Overlays
          </h2>
          {!isLoading && list.length === 0 && (
            <p className="text-sm px-2">
              This outline doesn't have any overlays yet. Click the button below
              to add some.
            </p>
          )}
          {isLoading ? (
            <h3 className="text-lg text-center">Loading overlays...</h3>
          ) : (
            <div className="overlays-list-container">
              <section className="flex-1 flex flex-col gap-2">
                <ul
                  id="overlays-list"
                  className="overlays-list"
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
                  svg={justAdded ? CheckSVG : AddSVG}
                  color={justAdded ? "#84cc16" : "#22d3ee"}
                  disabled={justAdded}
                  onClick={createNewOverlay}
                >
                  {justAdded ? justAddedText : addButtonText}
                </Button>
              </section>
              <div
                ref={overlayEditorRef}
                className="flex flex-col items-center gap-4 flex-1"
              >
                {isOverlayLoading && (
                  <h3 className="text-lg text-center min-h-[250px]">
                    Loading overlay...
                  </h3>
                )}
                {selectedOverlay.id &&
                  !isOverlayLoading &&
                  !selectedOverlay.isHidden && (
                    <>
                      <Button
                        className="lg:hidden text-sm w-full justify-center"
                        variant="tertiary"
                        onClick={() => setShowPreview((val) => !val)}
                      >
                        {showPreview ? "Hide" : "Show"} Preview
                      </Button>
                      {(!isMobile || showPreview) && (
                        <div>
                          <h2 className="bg-gray-900 text-center font-semibold text-base">
                            Preview
                          </h2>
                          <DisplayWindow
                            showBorder
                            width={isMobile ? 50 : 25}
                            participantOverlayInfo={
                              selectedOverlay.type === "participant"
                                ? {
                                    name: selectedOverlay.name,
                                    title: selectedOverlay.title,
                                    event: selectedOverlay.event,
                                    duration: selectedOverlay.duration,
                                    type: selectedOverlay.type,
                                    id: selectedOverlay.id,
                                    formatting: selectedOverlay.formatting,
                                  }
                                : undefined
                            }
                            stbOverlayInfo={
                              selectedOverlay.type === "stick-to-bottom"
                                ? {
                                    heading: selectedOverlay.heading,
                                    subHeading: selectedOverlay.subHeading,
                                    duration: selectedOverlay.duration,
                                    type: selectedOverlay.type,
                                    id: selectedOverlay.id,
                                    formatting: selectedOverlay.formatting,
                                  }
                                : undefined
                            }
                            qrCodeOverlayInfo={
                              selectedOverlay.type === "qr-code"
                                ? {
                                    url: selectedOverlay.url,
                                    description: selectedOverlay.description,
                                    duration: selectedOverlay.duration,
                                    type: selectedOverlay.type,
                                    id: selectedOverlay.id,
                                    formatting: selectedOverlay.formatting,
                                  }
                                : undefined
                            }
                            imageOverlayInfo={
                              selectedOverlay.type === "image"
                                ? {
                                    imageUrl: selectedOverlay.imageUrl,
                                    name: selectedOverlay.name,
                                    duration: selectedOverlay.duration,
                                    type: selectedOverlay.type,
                                    id: selectedOverlay.id,
                                    formatting: selectedOverlay.formatting,
                                  }
                                : undefined
                            }
                            displayType="stream"
                          />
                        </div>
                      )}
                      <section className="overlays-editing-section">
                        {selectedOverlay.type === "participant" && (
                          <>
                            <Input
                              {...commonInputProps}
                              label="Name"
                              value={selectedOverlay.name || ""}
                              onChange={(val) =>
                                handleOverlayUpdate({
                                  ...selectedOverlay,
                                  name: val as string,
                                })
                              }
                            />
                            <Input
                              {...commonInputProps}
                              label="Title"
                              value={selectedOverlay.title || ""}
                              onChange={(val) =>
                                handleOverlayUpdate({
                                  ...selectedOverlay,
                                  title: val as string,
                                })
                              }
                            />
                            <Input
                              {...commonInputProps}
                              label="Event"
                              value={selectedOverlay.event || ""}
                              onChange={(val) =>
                                handleOverlayUpdate({
                                  ...selectedOverlay,
                                  event: val as string,
                                })
                              }
                            />
                          </>
                        )}
                        {selectedOverlay.type === "stick-to-bottom" && (
                          <>
                            <Input
                              {...commonInputProps}
                              label="Heading"
                              value={selectedOverlay.heading || ""}
                              onChange={(val) =>
                                handleOverlayUpdate({
                                  ...selectedOverlay,
                                  heading: val as string,
                                })
                              }
                            />
                            <Input
                              {...commonInputProps}
                              label="Subheading"
                              value={selectedOverlay.subHeading || ""}
                              onChange={(val) =>
                                handleOverlayUpdate({
                                  ...selectedOverlay,
                                  subHeading: val as string,
                                })
                              }
                            />
                          </>
                        )}
                        {selectedOverlay.type === "qr-code" && (
                          <>
                            <Input
                              {...commonInputProps}
                              label="URL"
                              value={selectedOverlay.url || ""}
                              onChange={(val) =>
                                handleOverlayUpdate({
                                  ...selectedOverlay,
                                  url: val as string,
                                })
                              }
                            />
                            <TextArea
                              {...commonInputProps}
                              label="Info"
                              value={selectedOverlay.description || ""}
                              onChange={(val) =>
                                handleOverlayUpdate({
                                  ...selectedOverlay,
                                  description: val as string,
                                })
                              }
                            />
                          </>
                        )}
                        {selectedOverlay.type === "image" && ( // TODO - Select from image library
                          <>
                            <Input
                              {...commonInputProps}
                              label="Name"
                              value={selectedOverlay.name || ""}
                              onChange={(val) =>
                                handleOverlayUpdate({
                                  ...selectedOverlay,
                                  name: val as string,
                                })
                              }
                            />
                            <Input
                              {...commonInputProps}
                              label="Image URL"
                              value={selectedOverlay.imageUrl || ""}
                              onChange={(val) =>
                                handleOverlayUpdate({
                                  ...selectedOverlay,
                                  imageUrl: val as string,
                                })
                              }
                            />
                          </>
                        )}
                        <Input
                          className="text-sm flex gap-2 items-center"
                          labelClassName="w-24"
                          label="Duration"
                          value={selectedOverlay.duration || ""}
                          type="number"
                          onChange={(val) =>
                            handleOverlayUpdate({
                              ...selectedOverlay,
                              duration: val as number,
                            })
                          }
                          data-ignore-undo="true"
                        />
                        <div className="flex gap-2 w-full">
                          <Button
                            className="flex-1 justify-center text-sm"
                            svg={EditSVG}
                            color="#22d3ee"
                            onClick={() => setIsStyleDrawerOpen(true)}
                          >
                            Edit Style
                          </Button>
                          <Button
                            className="flex-1 justify-center text-sm"
                            variant="secondary"
                            svg={TemplateSVG}
                            color="#22d3ee"
                            onClick={() => setIsTemplateDrawerOpen(true)}
                          >
                            Templates
                          </Button>
                        </div>
                        <h4 className="text-center text-base">Type:</h4>
                        <div className="flex gap-2 justify-between flex-col">
                          <RadioButton
                            label="Participant"
                            className="w-full"
                            value={selectedOverlay.type === "participant"}
                            onChange={(val) =>
                              handleOverlayUpdate({
                                ...selectedOverlay,
                                type: "participant",
                              })
                            }
                          />
                          <RadioButton
                            label="Stick to Bottom"
                            className="w-full"
                            value={selectedOverlay.type === "stick-to-bottom"}
                            onChange={(val) =>
                              handleOverlayUpdate({
                                ...selectedOverlay,
                                type: "stick-to-bottom",
                              })
                            }
                          />
                          <RadioButton
                            label="QR Code"
                            className="w-full"
                            value={selectedOverlay.type === "qr-code"}
                            onChange={(val) =>
                              handleOverlayUpdate({
                                ...selectedOverlay,
                                type: "qr-code",
                              })
                            }
                          />
                          <RadioButton
                            label="Image"
                            className="w-full"
                            value={selectedOverlay.type === "image"}
                            onChange={(val) =>
                              handleOverlayUpdate({
                                ...selectedOverlay,
                                type: "image",
                              })
                            }
                          />
                        </div>
                      </section>
                    </>
                  )}
              </div>
            </div>
          )}
        </div>

        <Drawer
          isOpen={isStyleDrawerOpen}
          onClose={() => setIsStyleDrawerOpen(false)}
          size={isMobile ? "lg" : "xl"}
          position={isMobile ? "bottom" : "right"}
          title="Edit Overlay Style"
          closeOnBackdropClick={false}
          closeOnEscape
        >
          <StyleEditor
            formatting={selectedOverlay.formatting || {}}
            onChange={handleFormattingChange}
          />
        </Drawer>
        <Drawer
          isOpen={isTemplateDrawerOpen}
          onClose={() => setIsTemplateDrawerOpen(false)}
          size={isMobile ? "lg" : "xl"}
          position={isMobile ? "bottom" : "right"}
          title={`${typeToName[selectedOverlay.type as keyof typeof typeToName]} Templates`}
          showBackdrop
          closeOnBackdropClick
          closeOnEscape
        >
          {selectedOverlay.type === "participant" && (
            <OverlayPreview
              overlay={selectedOverlay}
              defaultStyles={defaultParticipantOverlayStyles}
              onApply={() => {
                handleOverlayUpdate({
                  ...selectedOverlay,
                  formatting: defaultParticipantOverlayStyles,
                });
                setIsTemplateDrawerOpen(false);
              }}
              isMobile={isMobile}
            />
          )}
          {selectedOverlay.type === "stick-to-bottom" && (
            <OverlayPreview
              overlay={selectedOverlay}
              defaultStyles={defaultStbOverlayStyles}
              onApply={() => {
                handleOverlayUpdate({
                  ...selectedOverlay,
                  formatting: defaultStbOverlayStyles,
                });
                setIsTemplateDrawerOpen(false);
              }}
              isMobile={isMobile}
            />
          )}
          {selectedOverlay.type === "qr-code" && (
            <OverlayPreview
              overlay={selectedOverlay}
              defaultStyles={defaultQrCodeOverlayStyles}
              onApply={() => {
                handleOverlayUpdate({
                  ...selectedOverlay,
                  formatting: defaultQrCodeOverlayStyles,
                });
                setIsTemplateDrawerOpen(false);
              }}
              isMobile={isMobile}
            />
          )}
          {selectedOverlay.type === "image" && (
            <OverlayPreview
              overlay={selectedOverlay}
              defaultStyles={defaultImageOverlayStyles}
              onApply={() => {
                handleOverlayUpdate({
                  ...selectedOverlay,
                  formatting: defaultImageOverlayStyles,
                });
                setIsTemplateDrawerOpen(false);
              }}
              isMobile={isMobile}
            />
          )}
        </Drawer>
      </DndContext>
    </ErrorBoundary>
  );
};

export default Overlays;
