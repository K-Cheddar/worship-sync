import Button from "../../components/Button/Button";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import Input from "../../components/Input/Input";
import { OverlayInfo } from "../../types";
import { ReactComponent as EditSVG } from "../../assets/icons/edit.svg";
import { ReactComponent as TemplateSVG } from "../../assets/icons/style.svg";
import RadioButton from "../../components/RadioButton/RadioButton";
import TextArea from "../../components/TextArea/TextArea";

type OverlayEditorProps = {
  selectedOverlay: OverlayInfo;
  isOverlayLoading: boolean;
  setShowPreview: (val: boolean) => void;
  showPreview: boolean;
  setIsStyleDrawerOpen: (val: boolean) => void;
  setIsTemplateDrawerOpen: (val: boolean) => void;
  isMobile: boolean;
  handleOverlayUpdate: (overlay: OverlayInfo) => void;
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
}: OverlayEditorProps) => {
  const commonInputProps = {
    className: "text-sm flex gap-2 items-center w-full",
    labelClassName: "w-24",
    "data-ignore-undo": "true",
    disabled: isOverlayLoading,
  };

  return (
    <div className="flex flex-col items-center gap-4 relative">
      {selectedOverlay.id && !selectedOverlay.isHidden && (
        <>
          <Button
            className="lg:hidden text-sm w-full justify-center"
            variant="tertiary"
            onClick={() => setShowPreview(!showPreview)}
            disabled={isOverlayLoading}
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
            <div className="flex gap-2 w-full">
              <Button
                className="flex-1 justify-center text-sm"
                svg={EditSVG}
                color="#22d3ee"
                onClick={() => setIsStyleDrawerOpen(true)}
                disabled={isOverlayLoading}
              >
                Edit Style
              </Button>
              <Button
                className="flex-1 justify-center text-sm"
                variant="secondary"
                svg={TemplateSVG}
                color="#22d3ee"
                onClick={() => setIsTemplateDrawerOpen(true)}
                disabled={isOverlayLoading}
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
                disabled={isOverlayLoading}
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
                disabled={isOverlayLoading}
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
                disabled={isOverlayLoading}
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
                disabled={isOverlayLoading}
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
  );
};

export default OverlayEditor;
