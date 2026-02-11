import Button from "../../components/Button/Button";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import HistorySuggestField from "../../components/HistorySuggestField";
import Input from "../../components/Input/Input";
import { OverlayInfo, Option } from "../../types";
import { SquarePen, Sparkles, Maximize2 } from "lucide-react";
import Drawer from "../../components/Drawer";
import StyleEditor from "../../components/StyleEditor";
import cn from "classnames";
import { useCallback, useContext, useState } from "react";
import Select from "../../components/Select/Select";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { OverlayHistoryKey, OverlayType } from "../../types";
import { putOverlayHistoryDoc } from "../../utils/dbUtils";
import { useWindowWidth, useDispatch, useSelector } from "../../hooks";
import { updateOverlayHistoryEntry } from "../../store/overlaysSlice";
import { useToast } from "../../context/toastContext";
import {
  overlayBorderColorMap,
  overlayTypeLabelMap,
} from "../../utils/itemTypeMaps";
import { RootState } from "../../store/store";

type OverlayEditorProps = {
  selectedOverlay: OverlayInfo;
  isOverlayLoading: boolean;
  setShowPreview: (val: boolean) => void;
  showPreview: boolean;
  setIsStyleDrawerOpen: (val: boolean) => void;
  setIsTemplateDrawerOpen: (val: boolean) => void;
  isMobile: boolean;
  handleOverlayUpdate: (overlay: OverlayInfo) => void;
  handleFormattingChange: (formatting: any) => void;
};
const OverlayEditor = ({
  selectedOverlay,
  isOverlayLoading,
  setShowPreview,
  showPreview,
  setIsStyleDrawerOpen,
  setIsTemplateDrawerOpen,
  isMobile,
  handleOverlayUpdate,
  handleFormattingChange,
}: OverlayEditorProps) => {
  const dispatch = useDispatch();
  const { db } = useContext(ControllerInfoContext) ?? {};
  const [isExpandedDrawerOpen, setIsExpandedDrawerOpen] = useState(false);
  const isDisabled = isOverlayLoading || !selectedOverlay.id;

  const overlayHistory = useSelector(
    (state: RootState) => state.undoable.present.overlays.overlayHistory
  );
  const { windowWidth: desktopWidth, windowRef: desktopRef } = useWindowWidth();
  const { showToast } = useToast();

  const historyValues = (key: string) => overlayHistory[key] ?? [];

  const removeFromHistory = useCallback(
    (key: OverlayHistoryKey) => (value: string) => {
      const current = overlayHistory[key] ?? [];
      const newValues = current.filter((v) => v.trim() !== value.trim());
      if (JSON.stringify(newValues) === JSON.stringify(current)) return;
      dispatch(updateOverlayHistoryEntry({ key, values: newValues }));
      if (db) putOverlayHistoryDoc(db, key, newValues).catch(console.error);
    },
    [dispatch, overlayHistory, db]
  );

  const overlayTypeOptions: Option[] = [
    "participant",
    "stick-to-bottom",
    "qr-code",
    "image",
  ].map((type) => ({
    value: type,
    label: overlayTypeLabelMap.get(type) ?? type,
    className: cn(
      "flex items-center gap-2 pl-2 border-l-4",
      overlayBorderColorMap.get(type) ?? "border-l-gray-400"
    ),
  }));

  const commonInputProps = {
    className: "text-sm flex gap-2 items-center w-full",
    labelClassName: "w-24",
    "data-ignore-undo": "true",
    disabled: isDisabled,
  };

  const overlayPropertyHandler = () => (
    <div className="bg-gray-800 p-4 border-t border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-4">
        Overlay Properties
      </h3>
      <div className="space-y-3">
        {selectedOverlay.type === "participant" && (
          <>
            <HistorySuggestField
              label="Name"
              value={selectedOverlay.name || ""}
              onChange={(val) =>
                handleOverlayUpdate({ ...selectedOverlay, name: val })
              }
              historyValues={historyValues("participant.name")}
              onRemoveHistoryValue={removeFromHistory("participant.name")}
              multiline={false}
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
              disabled={isDisabled}
              data-ignore-undo="true"
            />
            <HistorySuggestField
              label="Title"
              value={selectedOverlay.title || ""}
              onChange={(val) =>
                handleOverlayUpdate({ ...selectedOverlay, title: val })
              }
              historyValues={historyValues("participant.title")}
              onRemoveHistoryValue={removeFromHistory("participant.title")}
              multiline={false}
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
              disabled={isDisabled}
              data-ignore-undo="true"
            />
            <HistorySuggestField
              label="Event"
              value={selectedOverlay.event || ""}
              onChange={(val) =>
                handleOverlayUpdate({ ...selectedOverlay, event: val })
              }
              historyValues={historyValues("participant.event")}
              onRemoveHistoryValue={removeFromHistory("participant.event")}
              multiline={false}
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
              disabled={isDisabled}
              data-ignore-undo="true"
            />
          </>
        )}
        {selectedOverlay.type === "stick-to-bottom" && (
          <>
            <HistorySuggestField
              label="Heading"
              value={selectedOverlay.heading || ""}
              onChange={(val) =>
                handleOverlayUpdate({ ...selectedOverlay, heading: val })
              }
              historyValues={historyValues("stick-to-bottom.heading")}
              onRemoveHistoryValue={removeFromHistory("stick-to-bottom.heading")}
              multiline={false}
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
              disabled={isDisabled}
              data-ignore-undo="true"
            />
            <HistorySuggestField
              label="Subheading"
              value={selectedOverlay.subHeading || ""}
              onChange={(val) =>
                handleOverlayUpdate({ ...selectedOverlay, subHeading: val })
              }
              historyValues={historyValues("stick-to-bottom.subHeading")}
              onRemoveHistoryValue={removeFromHistory("stick-to-bottom.subHeading")}
              multiline={false}
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
              disabled={isDisabled}
              data-ignore-undo="true"
            />
          </>
        )}
        {selectedOverlay.type === "qr-code" && (
          <>
            <HistorySuggestField
              label="URL"
              value={selectedOverlay.url || ""}
              onChange={(val) =>
                handleOverlayUpdate({ ...selectedOverlay, url: val })
              }
              historyValues={historyValues("qr-code.url")}
              onRemoveHistoryValue={removeFromHistory("qr-code.url")}
              multiline={false}
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
              disabled={isDisabled}
              data-ignore-undo="true"
            />
            <HistorySuggestField
              label="Description"
              value={selectedOverlay.description || ""}
              onChange={(val) =>
                handleOverlayUpdate({ ...selectedOverlay, description: val })
              }
              historyValues={historyValues("qr-code.description")}
              onRemoveHistoryValue={removeFromHistory("qr-code.description")}
              multiline
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
              disabled={isDisabled}
              data-ignore-undo="true"
            />
          </>
        )}
        {selectedOverlay.type === "image" && (
          <>
            <HistorySuggestField
              label="Name"
              value={selectedOverlay.name || ""}
              onChange={(val) =>
                handleOverlayUpdate({ ...selectedOverlay, name: val })
              }
              historyValues={historyValues("image.name")}
              onRemoveHistoryValue={removeFromHistory("image.name")}
              multiline={false}
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
              disabled={isDisabled}
              data-ignore-undo="true"
            />
            <Input
              label="Image URL"
              value={selectedOverlay.imageUrl || ""}
              onChange={(val) =>
                handleOverlayUpdate({
                  ...selectedOverlay,
                  imageUrl: val as string,
                })
              }
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
            />
          </>
        )}
        <Input
          label="Duration"
          type="number"
          value={selectedOverlay.duration || ""}
          onChange={(val) =>
            handleOverlayUpdate({
              ...selectedOverlay,
              duration: Number(val),
            })
          }
          className="text-sm flex gap-2 items-center w-full"
          labelClassName="w-20"
        />
      </div>
    </div>
  );

  return (
    <div className={"flex flex-col items-center gap-4 relative"}>
      <Button
        className="lg:hidden text-sm w-full justify-center"
        variant="tertiary"
        onClick={() => setShowPreview(!showPreview)}
        disabled={isDisabled}
      >
        {showPreview ? "Hide" : "Show"} Preview
      </Button>
      <div className={cn("lg:block", !showPreview && "max-lg:hidden")}>
        <div className="bg-gray-900 relative flex">
          <h2 className="font-semibold text-base text-white text-center flex-1">
            Preview
          </h2>
          <Button
            svg={Maximize2}
            variant="primary"
            onClick={() => setIsExpandedDrawerOpen(true)}
            iconSize="sm"
            title="Expand to full screen"
            color="#22d3ee"
          />
        </div>
        <DisplayWindow
          showBorder
          width={isMobile ? 70 : 25}
          displayType="stream"
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
        />
      </div>
      <section
        className={cn(
          "scrollbar-variable flex flex-col gap-2 bg-gray-800 p-4 rounded-md items-stretch overflow-y-auto w-full min-w-0",
          !selectedOverlay.id && "hidden"
        )}
      >
        {selectedOverlay.type === "participant" && (
          <>
            <HistorySuggestField
              {...commonInputProps}
              label="Name"
              value={selectedOverlay.name || ""}
              onChange={(val) =>
                handleOverlayUpdate({ ...selectedOverlay, name: val })
              }
              historyValues={historyValues("participant.name")}
              onRemoveHistoryValue={removeFromHistory("participant.name")}
              multiline={false}
            />
            <HistorySuggestField
              {...commonInputProps}
              label="Title"
              value={selectedOverlay.title || ""}
              onChange={(val) =>
                handleOverlayUpdate({ ...selectedOverlay, title: val })
              }
              historyValues={historyValues("participant.title")}
              onRemoveHistoryValue={removeFromHistory("participant.title")}
              multiline={false}
            />
            <HistorySuggestField
              {...commonInputProps}
              label="Event"
              value={selectedOverlay.event || ""}
              onChange={(val) =>
                handleOverlayUpdate({ ...selectedOverlay, event: val })
              }
              historyValues={historyValues("participant.event")}
              onRemoveHistoryValue={removeFromHistory("participant.event")}
              multiline={false}
            />
          </>
        )}
        {selectedOverlay.type === "stick-to-bottom" && (
          <>
            <HistorySuggestField
              {...commonInputProps}
              label="Heading"
              value={selectedOverlay.heading || ""}
              onChange={(val) =>
                handleOverlayUpdate({ ...selectedOverlay, heading: val })
              }
              historyValues={historyValues("stick-to-bottom.heading")}
              onRemoveHistoryValue={removeFromHistory("stick-to-bottom.heading")}
              multiline={false}
            />
            <HistorySuggestField
              {...commonInputProps}
              label="Subheading"
              value={selectedOverlay.subHeading || ""}
              onChange={(val) =>
                handleOverlayUpdate({ ...selectedOverlay, subHeading: val })
              }
              historyValues={historyValues("stick-to-bottom.subHeading")}
              onRemoveHistoryValue={removeFromHistory("stick-to-bottom.subHeading")}
              multiline={false}
            />
          </>
        )}
        {selectedOverlay.type === "qr-code" && (
          <>
            <HistorySuggestField
              {...commonInputProps}
              label="URL"
              value={selectedOverlay.url || ""}
              onChange={(val) =>
                handleOverlayUpdate({ ...selectedOverlay, url: val })
              }
              historyValues={historyValues("qr-code.url")}
              onRemoveHistoryValue={removeFromHistory("qr-code.url")}
              multiline={false}
            />
            <HistorySuggestField
              {...commonInputProps}
              label="Info"
              value={selectedOverlay.description || ""}
              onChange={(val) =>
                handleOverlayUpdate({ ...selectedOverlay, description: val })
              }
              historyValues={historyValues("qr-code.description")}
              onRemoveHistoryValue={removeFromHistory("qr-code.description")}
              multiline={false}
            />
          </>
        )}
        {selectedOverlay.type === "image" && (
          <>
            <HistorySuggestField
              {...commonInputProps}
              label="Name"
              value={selectedOverlay.name || ""}
              onChange={(val) =>
                handleOverlayUpdate({ ...selectedOverlay, name: val })
              }
              historyValues={historyValues("image.name")}
              onRemoveHistoryValue={removeFromHistory("image.name")}
              multiline={false}
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
              onClick={() => showToast(`Select from the available media. ${isMobile ? "Long press and Set Image Overlay." : "Right click and Set Image Overlay."}`)}
            />
          </>
        )}
        <Input
          {...commonInputProps}
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
        <Select
          label="Type"
          options={overlayTypeOptions}
          value={selectedOverlay.type || "participant"}
          onChange={(value) =>
            handleOverlayUpdate({
              ...selectedOverlay,
              type: value as OverlayType,
            })
          }
          disabled={isDisabled}
          className="w-full flex text-sm"
          selectClassName="flex-1"
          labelClassName="w-20"
        />
        <div className="flex gap-2 w-full">
          <Button
            className="flex-1 justify-center text-sm"
            svg={SquarePen}
            color="#22d3ee"
            onClick={() => setIsStyleDrawerOpen(true)}
            disabled={isDisabled}
          >
            Edit Style
          </Button>
          <Button
            className="flex-1 justify-center text-sm"
            variant="secondary"
            svg={Sparkles}
            color="#22d3ee"
            onClick={() => setIsTemplateDrawerOpen(true)}
            disabled={isDisabled}
          >
            Templates
          </Button>
        </div>
      </section>

      <Drawer
        isOpen={isExpandedDrawerOpen}
        onClose={() => setIsExpandedDrawerOpen(false)}
        size="full"
        position="bottom"
        title="Overlay Preview & Editor"
        showBackdrop
        closeOnBackdropClick
        closeOnEscape
        contentPadding="p-0"
        contentClassName="flex-1 min-h-0"
      >
        <div className="flex flex-col lg:flex-row h-full">
          <div className="w-full lg:w-[70vw] flex flex-col">
            <div
              ref={desktopRef}
              className="flex items-center justify-center bg-gray-600 lg:h-2/3"
            >
              <DisplayWindow
                showBorder
                displayType="stream"
                width={isMobile ? 95 : desktopWidth}
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
              />
            </div>
            {!isMobile && overlayPropertyHandler()}
          </div>

          <div className="w-full lg:w-[30vw] bg-gray-800 lg:border-l border-t lg:border-t-0 border-gray-700 flex flex-col max-lg:overflow-y-auto flex-1">
            {isMobile && overlayPropertyHandler()}
            <h3 className="text-lg font-semibold text-white mb-4 p-2">
              Style Editor
            </h3>
            <StyleEditor
              formatting={selectedOverlay.formatting || {}}
              onChange={handleFormattingChange}
              overlayType={selectedOverlay.type}
              className="p-2 flex-1 lg:overflow-y-auto"
            />
          </div>
        </div>
      </Drawer>
    </div>
  );
};

export default OverlayEditor;
