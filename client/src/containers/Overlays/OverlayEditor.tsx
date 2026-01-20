import Button from "../../components/Button/Button";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import Input from "../../components/Input/Input";
import { OverlayInfo } from "../../types";
import { SquarePen, Sparkles, Maximize2 } from "lucide-react";
import TextArea from "../../components/TextArea/TextArea";
import Drawer from "../../components/Drawer";
import StyleEditor from "../../components/StyleEditor";
import cn from "classnames";
import { useState } from "react";
import Select from "../../components/Select/Select";
import { OverlayType } from "../../types";
import { useWindowWidth } from "../../hooks";
import { useToast } from "../../context/toastContext";

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
  const [isExpandedDrawerOpen, setIsExpandedDrawerOpen] = useState(false);
  const isDisabled =
    isOverlayLoading || !selectedOverlay.id || selectedOverlay.isHidden;

  const { windowWidth: desktopWidth, windowRef: desktopRef } = useWindowWidth();
  const { showToast } = useToast();

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
            <Input
              label="Name"
              value={selectedOverlay.name || ""}
              onChange={(val) =>
                handleOverlayUpdate({
                  ...selectedOverlay,
                  name: val as string,
                })
              }
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
            />
            <Input
              label="Title"
              value={selectedOverlay.title || ""}
              onChange={(val) =>
                handleOverlayUpdate({
                  ...selectedOverlay,
                  title: val as string,
                })
              }
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
            />
            <Input
              label="Event"
              value={selectedOverlay.event || ""}
              onChange={(val) =>
                handleOverlayUpdate({
                  ...selectedOverlay,
                  event: val as string,
                })
              }
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
            />
          </>
        )}
        {selectedOverlay.type === "stick-to-bottom" && (
          <>
            <Input
              label="Heading"
              value={selectedOverlay.heading || ""}
              onChange={(val) =>
                handleOverlayUpdate({
                  ...selectedOverlay,
                  heading: val as string,
                })
              }
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
            />
            <Input
              label="Subheading"
              value={selectedOverlay.subHeading || ""}
              onChange={(val) =>
                handleOverlayUpdate({
                  ...selectedOverlay,
                  subHeading: val as string,
                })
              }
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
            />
          </>
        )}
        {selectedOverlay.type === "qr-code" && (
          <>
            <Input
              label="URL"
              value={selectedOverlay.url || ""}
              onChange={(val) =>
                handleOverlayUpdate({
                  ...selectedOverlay,
                  url: val as string,
                })
              }
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
            />
            <TextArea
              label="Description"
              value={selectedOverlay.description || ""}
              onChange={(val) =>
                handleOverlayUpdate({
                  ...selectedOverlay,
                  description: val as string,
                })
              }
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
            />
          </>
        )}
        {selectedOverlay.type === "image" && (
          <>
            <Input
              label="Name"
              value={selectedOverlay.name || ""}
              onChange={(val) =>
                handleOverlayUpdate({
                  ...selectedOverlay,
                  name: val as string,
                })
              }
              className="text-sm flex gap-2 items-center w-full"
              labelClassName="w-20"
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
      <section
        className={cn(
          "scrollbar-variable flex flex-col gap-2 bg-gray-800 p-4 rounded-md items-center overflow-y-auto w-full",
          (!selectedOverlay.id || selectedOverlay.isHidden) && "hidden"
        )}
      >
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
        {selectedOverlay.type === "image" && (
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
              onClick={() => showToast("Select from the available media.")}
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
          options={[
            { label: "Participant", value: "participant" },
            { label: "Stick to Bottom", value: "stick-to-bottom" },
            { label: "QR Code", value: "qr-code" },
            { label: "Image", value: "image" },
          ]}
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
              className="p-2 flex-1 lg:overflow-y-auto"
            />
          </div>
        </div>
      </Drawer>
    </div>
  );
};

export default OverlayEditor;
