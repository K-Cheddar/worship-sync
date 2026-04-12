import Button from "../../components/Button/Button";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import HistorySuggestField from "../../components/HistorySuggestField";
import Input from "../../components/Input/Input";
import { OverlayFormatting, OverlayInfo, Option } from "../../types";
import { SquarePen, Sparkles, Maximize2 } from "lucide-react";
import Drawer from "../../components/Drawer";
import StyleEditor from "../../components/StyleEditor";
import cn from "classnames";
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import Select from "../../components/Select/Select";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { OverlayHistoryKey, OverlayType } from "../../types";
import { putOverlayHistoryDoc } from "../../utils/dbUtils";
import { useStore } from "react-redux";
import { useWindowWidth, useDispatch, useSelector } from "../../hooks";
import { useOverlayDraft } from "../../hooks/useOverlayDraft";
import { updateOverlayHistoryEntry } from "../../store/overlaysSlice";
import {
  applyPendingRemoteOverlay,
  discardPendingRemoteOverlay,
} from "../../store/overlaySlice";
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
  readOnly?: boolean;
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
  readOnly = false,
}: OverlayEditorProps) => {
  const dispatch = useDispatch();
  const store = useStore();
  const { db } = useContext(ControllerInfoContext) ?? {};
  const [isExpandedDrawerOpen, setIsExpandedDrawerOpen] = useState(false);
  const isDisabled = isOverlayLoading || !selectedOverlay.id || readOnly;

  const overlayHistory = useSelector(
    (state: RootState) => state.undoable.present.overlays.overlayHistory
  );
  const hasRemoteUpdate = useSelector(
    (state: RootState) => state.undoable.present.overlay.hasRemoteUpdate
  );
  const { windowWidth: desktopWidth, windowRef: desktopRef } = useWindowWidth();
  const { showToast, removeToast } = useToast();
  const remoteUpdateToastIdRef = useRef<string | null>(null);

  const handleKeepLocalEdits = useCallback(() => {
    dispatch(discardPendingRemoteOverlay());
  }, [dispatch]);

  const { draft, patchDraft, flushDraft, mergeDraftLocal, replaceDraft } =
    useOverlayDraft(
      selectedOverlay,
      handleOverlayUpdate,
    );

  const handleReloadRemote = useCallback(() => {
    const pendingOverlay = (store.getState() as RootState).undoable.present
      .overlay.pendingRemoteOverlay;
    if (!pendingOverlay?.id) return;

    // User explicitly accepted remote state; discard dirty local draft first.
    replaceDraft(pendingOverlay);
    dispatch(applyPendingRemoteOverlay());
    const overlay = (store.getState() as RootState).undoable.present.overlay
      .selectedOverlay;
    if (overlay?.id) {
      dispatch(updateOverlayInList(overlay));
    }
  }, [dispatch, replaceDraft, store]);

  const handleFormattingChangeLocal = useCallback(
    (formatting: OverlayFormatting) => {
      handleFormattingChange(formatting);
      mergeDraftLocal({ formatting });
    },
    [handleFormattingChange, mergeDraftLocal],
  );

  const handleSectionBlur = useCallback(
    (e: FocusEvent<HTMLElement>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      flushDraft();
    },
    [flushDraft],
  );

  useEffect(() => {
    if (!hasRemoteUpdate || readOnly) {
      if (remoteUpdateToastIdRef.current && removeToast) {
        removeToast(remoteUpdateToastIdRef.current);
        remoteUpdateToastIdRef.current = null;
      }
      return;
    }

    if (remoteUpdateToastIdRef.current || !showToast || !removeToast) return;

    remoteUpdateToastIdRef.current = showToast({
      message: "Someone else updated this overlay.",
      variant: "info",
      persist: true,
      showCloseButton: false,
      children: (toastId) => (
        <div className="mt-2 flex gap-2">
          <Button
            variant="primary"
            className="text-sm"
            onClick={() => {
              handleKeepLocalEdits();
              removeToast(toastId);
              remoteUpdateToastIdRef.current = null;
            }}
          >
            Keep Editing Mine
          </Button>
          <Button
            variant="cta"
            className="text-sm"
            onClick={() => {
              handleReloadRemote();
              removeToast(toastId);
              remoteUpdateToastIdRef.current = null;
            }}
          >
            Use Their Changes
          </Button>
        </div>
      ),
    });
  }, [
    handleKeepLocalEdits,
    handleReloadRemote,
    hasRemoteUpdate,
    readOnly,
    removeToast,
    showToast,
  ]);

  useEffect(() => {
    return () => {
      if (remoteUpdateToastIdRef.current && removeToast) {
        removeToast(remoteUpdateToastIdRef.current);
        remoteUpdateToastIdRef.current = null;
      }
    };
  }, [removeToast]);

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
    <div
      className="border-t border-white/10 bg-transparent p-4"
      onBlurCapture={handleSectionBlur}
    >
      <h3 className="text-lg font-semibold text-white mb-4">
        Overlay Properties
      </h3>
      <div className="space-y-3">
        {draft.type === "participant" && (
          <>
            <HistorySuggestField
              label="Name"
              value={draft.name || ""}
              onChange={(val) => patchDraft({ name: val })}
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
              value={draft.title || ""}
              onChange={(val) => patchDraft({ title: val })}
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
              value={draft.event || ""}
              onChange={(val) => patchDraft({ event: val })}
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
        {draft.type === "stick-to-bottom" && (
          <>
            <HistorySuggestField
              label="Heading"
              value={draft.heading || ""}
              onChange={(val) => patchDraft({ heading: val })}
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
              value={draft.subHeading || ""}
              onChange={(val) => patchDraft({ subHeading: val })}
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
        {draft.type === "qr-code" && (
          <>
            <HistorySuggestField
              label="URL"
              value={draft.url || ""}
              onChange={(val) => patchDraft({ url: val })}
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
              value={draft.description || ""}
              onChange={(val) => patchDraft({ description: val })}
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
        {draft.type === "image" && (
          <>
            <HistorySuggestField
              label="Name"
              value={draft.name || ""}
              onChange={(val) => patchDraft({ name: val })}
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
              value={draft.imageUrl || ""}
              onChange={(val) => patchDraft({ imageUrl: val as string })}
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
            />
          </>
        )}
        <Input
          label="Duration"
          type="number"
          value={draft.duration || ""}
          onChange={(val) =>
            patchDraft({
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
        <div className="relative flex bg-black/40">
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
            disabled={isDisabled}
          />
        </div>
        <div className="bg-gray-500/35">
          <DisplayWindow
            showBorder
            width={isMobile ? 70 : 25}
            displayType="stream"
            participantOverlayInfo={
              draft.type === "participant"
                ? {
                  name: draft.name,
                  title: draft.title,
                  event: draft.event,
                  duration: draft.duration,
                  type: draft.type,
                  id: draft.id,
                  formatting: draft.formatting,
                }
                : undefined
            }
            stbOverlayInfo={
              draft.type === "stick-to-bottom"
                ? {
                  heading: draft.heading,
                  subHeading: draft.subHeading,
                  duration: draft.duration,
                  type: draft.type,
                  id: draft.id,
                  formatting: draft.formatting,
                }
                : undefined
            }
            qrCodeOverlayInfo={
              draft.type === "qr-code"
                ? {
                  url: draft.url,
                  description: draft.description,
                  duration: draft.duration,
                  type: draft.type,
                  id: draft.id,
                  formatting: draft.formatting,
                }
                : undefined
            }
            imageOverlayInfo={
              draft.type === "image"
                ? {
                  imageUrl: draft.imageUrl,
                  name: draft.name,
                  duration: draft.duration,
                  type: draft.type,
                  id: draft.id,
                  formatting: draft.formatting,
                }
                : undefined
            }
          />
        </div>
      </div>
      <section
        className={cn(
          "scrollbar-variable flex min-w-0 w-full flex-col items-stretch gap-2 overflow-y-auto rounded-md border border-white/12 bg-transparent p-4",
          !selectedOverlay.id && "hidden"
        )}
        onBlurCapture={handleSectionBlur}
      >
        {draft.type === "participant" && (
          <>
            <HistorySuggestField
              {...commonInputProps}
              label="Name"
              value={draft.name || ""}
              onChange={(val) => patchDraft({ name: val })}
              historyValues={historyValues("participant.name")}
              onRemoveHistoryValue={removeFromHistory("participant.name")}
              multiline={false}
            />
            <HistorySuggestField
              {...commonInputProps}
              label="Title"
              value={draft.title || ""}
              onChange={(val) => patchDraft({ title: val })}
              historyValues={historyValues("participant.title")}
              onRemoveHistoryValue={removeFromHistory("participant.title")}
              multiline={false}
            />
            <HistorySuggestField
              {...commonInputProps}
              label="Event"
              value={draft.event || ""}
              onChange={(val) => patchDraft({ event: val })}
              historyValues={historyValues("participant.event")}
              onRemoveHistoryValue={removeFromHistory("participant.event")}
              multiline={false}
            />
          </>
        )}
        {draft.type === "stick-to-bottom" && (
          <>
            <HistorySuggestField
              {...commonInputProps}
              label="Heading"
              value={draft.heading || ""}
              onChange={(val) => patchDraft({ heading: val })}
              historyValues={historyValues("stick-to-bottom.heading")}
              onRemoveHistoryValue={removeFromHistory("stick-to-bottom.heading")}
              multiline={false}
            />
            <HistorySuggestField
              {...commonInputProps}
              label="Subheading"
              value={draft.subHeading || ""}
              onChange={(val) => patchDraft({ subHeading: val })}
              historyValues={historyValues("stick-to-bottom.subHeading")}
              onRemoveHistoryValue={removeFromHistory("stick-to-bottom.subHeading")}
              multiline={false}
            />
          </>
        )}
        {draft.type === "qr-code" && (
          <>
            <HistorySuggestField
              {...commonInputProps}
              label="URL"
              value={draft.url || ""}
              onChange={(val) => patchDraft({ url: val })}
              historyValues={historyValues("qr-code.url")}
              onRemoveHistoryValue={removeFromHistory("qr-code.url")}
              multiline={false}
            />
            <HistorySuggestField
              {...commonInputProps}
              label="Info"
              value={draft.description || ""}
              onChange={(val) => patchDraft({ description: val })}
              historyValues={historyValues("qr-code.description")}
              onRemoveHistoryValue={removeFromHistory("qr-code.description")}
              multiline={false}
            />
          </>
        )}
        {draft.type === "image" && (
          <>
            <HistorySuggestField
              {...commonInputProps}
              label="Name"
              value={draft.name || ""}
              onChange={(val) => patchDraft({ name: val })}
              historyValues={historyValues("image.name")}
              onRemoveHistoryValue={removeFromHistory("image.name")}
              multiline={false}
            />
            <Input
              {...commonInputProps}
              label="Image URL"
              value={draft.imageUrl || ""}
              onChange={(val) => patchDraft({ imageUrl: val as string })}
              onClick={() => showToast(`Select from the available media. ${isMobile ? "Long press and Set Image Overlay." : "Right click and Set Image Overlay."}`)}
            />
          </>
        )}
        <Input
          {...commonInputProps}
          label="Duration"
          value={draft.duration || ""}
          type="number"
          onChange={(val) =>
            patchDraft({
              duration: Number(val),
            })
          }
          data-ignore-undo="true"
        />
        <Select
          label="Type"
          options={overlayTypeOptions}
          value={draft.type || "participant"}
          onChange={(value) =>
            patchDraft({
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
              className="flex items-center justify-center bg-gray-500/35 lg:h-2/3"
            >
              <DisplayWindow
                showBorder
                displayType="stream"
                width={isMobile ? 95 : desktopWidth}
                participantOverlayInfo={
                  draft.type === "participant"
                    ? {
                      name: draft.name,
                      title: draft.title,
                      event: draft.event,
                      duration: draft.duration,
                      type: draft.type,
                      id: draft.id,
                      formatting: draft.formatting,
                    }
                    : undefined
                }
                stbOverlayInfo={
                  draft.type === "stick-to-bottom"
                    ? {
                      heading: draft.heading,
                      subHeading: draft.subHeading,
                      duration: draft.duration,
                      type: draft.type,
                      id: draft.id,
                      formatting: draft.formatting,
                    }
                    : undefined
                }
                qrCodeOverlayInfo={
                  draft.type === "qr-code"
                    ? {
                      url: draft.url,
                      description: draft.description,
                      duration: draft.duration,
                      type: draft.type,
                      id: draft.id,
                      formatting: draft.formatting,
                    }
                    : undefined
                }
                imageOverlayInfo={
                  draft.type === "image"
                    ? {
                      imageUrl: draft.imageUrl,
                      name: draft.name,
                      duration: draft.duration,
                      type: draft.type,
                      id: draft.id,
                      formatting: draft.formatting,
                    }
                    : undefined
                }
              />
            </div>
            {!isMobile && overlayPropertyHandler()}
          </div>

          <div className="flex w-full max-lg:overflow-y-auto flex-1 flex-col border-t border-white/10 bg-black/30 lg:w-[30vw] lg:border-l lg:border-t-0">
            {isMobile && overlayPropertyHandler()}
            <h3 className="text-lg font-semibold text-white mb-4 p-2">
              Style Editor
            </h3>
            <StyleEditor
              formatting={draft.formatting || {}}
              onChange={handleFormattingChangeLocal}
              overlayType={draft.type}
              className="p-2 flex-1 lg:overflow-y-auto"
            />
          </div>
        </div>
      </Drawer>
    </div>
  );
};

export default OverlayEditor;
