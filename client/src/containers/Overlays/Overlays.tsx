import Button from "../../components/Button/Button";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import { useDispatch, useSelector } from "../../hooks";
import {
  addOverlay,
  updateList,
  updateOverlay,
} from "../../store/overlaysSlice";
import Input from "../../components/Input/Input";
import "./Overlays.scss";
import {
  CSSProperties,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Toggle from "../../components/Toggle/Toggle";
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

const Overlays = () => {
  const { list, id, name, title, event, showDelete, duration, type } =
    useSelector((state) => state.undoable.present.overlays);
  const { isStreamTransmitting } = useSelector((state) => state.presentation);
  const { isLoading } = useSelector((state) => state.undoable.present.itemList);
  const [localName, setLocalName] = useState(name || "");
  const [localTitle, setLocalTitle] = useState(title || "");
  const [localEvent, setLocalEvent] = useState(event || "");
  const [localShowDelete, setLocalShowDelete] = useState(showDelete || false);
  const [localDuration, setLocalDuration] = useState(duration || 7);
  const [localType, setLocalType] = useState(type);
  const dispatch = useDispatch();
  const { isMobile } = useContext(ControllerInfoContext) || {};

  const [overlayEditorHeight, setOverlayEditorHeight] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    setLocalName(name || "");
    setLocalTitle(title || "");
    setLocalEvent(event || "");
    setLocalShowDelete(showDelete || false);
    setLocalDuration(duration || 7);
    setLocalType(type);
  }, [name, title, event, id, showDelete, duration, type]);

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

  return (
    <DndContext onDragEnd={onDragEnd} sensors={sensors}>
      <div
        className="flex flex-col w-full h-full p-2 gap-2"
        style={
          {
            "--overlay-editor-height": `${overlayEditorHeight}px`,
          } as CSSProperties
        }
      >
        <h2 className="text-xl font-semibold text-center h-fit">Overlays</h2>
        {isLoading ? (
          <h3 className="text-lg text-center">Loading overlays...</h3>
        ) : (
          <div className="flex gap-2 lg:h-full max-lg:flex-col-reverse">
            <section className="flex-1 flex flex-col gap-2">
              <ul className="overlays-list" ref={setNodeRef}>
                <SortableContext
                  items={list.map((overlay) => overlay.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {list.map((overlay) => {
                    return (
                      <Overlay
                        key={overlay.id}
                        overlay={overlay}
                        selectedId={id}
                        isStreamTransmitting={isStreamTransmitting}
                      />
                    );
                  })}
                </SortableContext>
              </ul>
              <Button
                className="text-sm w-full justify-center mt-2"
                svg={AddSVG}
                onClick={() => dispatch(addOverlay())}
              >
                Add Overlay
              </Button>
            </section>
            <div
              ref={overlayEditorRef}
              className="flex flex-col items-center gap-4 flex-1"
            >
              {id && (
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
                      <h2 className="bg-slate-900 text-center font-semibold text-base">
                        Preview
                      </h2>
                      <DisplayWindow
                        showBorder
                        width={isMobile ? 50 : 25}
                        participantOverlayInfo={
                          localType === "participant"
                            ? {
                                name: localName,
                                title: localTitle,
                                event: localEvent,
                                duration: localDuration,
                                type: localType,
                                id,
                              }
                            : undefined
                        }
                        stbOverlayInfo={
                          localType === "stick-to-bottom"
                            ? {
                                name: localName,
                                title: localTitle,
                                event: localEvent,
                                duration: localDuration,
                                type: localType,
                                id,
                              }
                            : undefined
                        }
                        displayType="stream"
                      />
                    </div>
                  )}
                  <section className="flex flex-col gap-2 bg-slate-800 p-2 rounded-md min-w-1/2 items-center">
                    <Input
                      className="text-sm flex gap-2 items-center"
                      lableClassName="w-24"
                      label="Name"
                      value={localName}
                      onChange={(val) => setLocalName(val as string)}
                      data-ignore-undo="true"
                    />
                    <Input
                      className="text-sm flex gap-2 items-center"
                      lableClassName="w-24"
                      label="Title"
                      disabled={localType === "stick-to-bottom"}
                      value={localTitle}
                      onChange={(val) => setLocalTitle(val as string)}
                      data-ignore-undo="true"
                    />
                    <Input
                      className="text-sm flex gap-2 items-center"
                      lableClassName="w-24"
                      label="Event"
                      value={localEvent}
                      onChange={(val) => setLocalEvent(val as string)}
                      data-ignore-undo="true"
                    />
                    <Input
                      className="text-sm flex gap-2 items-center"
                      lableClassName="w-24"
                      label="Duration"
                      value={localDuration}
                      type="number"
                      onChange={(val) => setLocalDuration(val as number)}
                      data-ignore-undo="true"
                    />
                    <h4 className="text-center text-base">Type:</h4>
                    <div className="flex gap-2 justify-center">
                      <RadioButton
                        label="Participant"
                        value={localType === "participant"}
                        onChange={(val) => setLocalType("participant")}
                      />
                      <RadioButton
                        label="Stick to Bottom"
                        value={localType === "stick-to-bottom"}
                        onChange={(val) => setLocalType("stick-to-bottom")}
                      />
                    </div>
                    <Toggle
                      label="Show Delete"
                      className="my-2"
                      value={localShowDelete}
                      onChange={(val) => setLocalShowDelete(val)}
                    />

                    <Button
                      className="text-sm w-full justify-center"
                      onClick={() =>
                        dispatch(
                          updateOverlay({
                            id,
                            name: localName,
                            title: localTitle,
                            event: localEvent,
                            showDelete: localShowDelete,
                            duration: localDuration,
                            type: localType,
                          })
                        )
                      }
                    >
                      Update Overlay
                    </Button>
                  </section>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </DndContext>
  );
};

export default Overlays;
