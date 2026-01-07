import Button from "../../components/Button/Button";
import { Save } from "lucide-react";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import generateRandomId from "../../utils/generateRandomId";

interface OverlayPreviewProps {
  overlay: any;
  defaultStyles: any;
  onApply: () => void;
  isMobile: boolean;
  secondaryAction?: React.ReactNode;
}

const OverlayPreview = ({
  overlay,
  defaultStyles,
  onApply,
  isMobile,
  secondaryAction,
}: OverlayPreviewProps) => {
  const getOverlayInfo = () => {
    const baseInfo = {
      id: generateRandomId(),
      formatting: defaultStyles,
      duration: overlay.duration,
      type: overlay.type,
    };

    switch (overlay.type) {
      case "participant":
        return {
          ...baseInfo,
          name: overlay.name,
          title: overlay.title,
          event: overlay.event,
        };
      case "stick-to-bottom":
        return {
          ...baseInfo,
          heading: overlay.heading,
          subHeading: overlay.subHeading,
        };
      case "qr-code":
        return {
          ...baseInfo,
          url: overlay.url,
          description: overlay.description,
        };
      case "image":
        return {
          ...baseInfo,
          imageUrl: overlay.imageUrl,
          name: overlay.name,
        };
      default:
        return baseInfo;
    }
  };

  const getOverlayInfoKey = () => {
    switch (overlay.type) {
      case "participant":
        return "participantOverlayInfo";
      case "stick-to-bottom":
        return "stbOverlayInfo";
      case "qr-code":
        return "qrCodeOverlayInfo";
      case "image":
        return "imageOverlayInfo";
      default:
        return "overlayInfo";
    }
  };

  const overlayInfo = getOverlayInfo();
  const overlayInfoKey = getOverlayInfoKey();

  return (
    <div className="flex flex-col gap-2 w-fit">
      <div className="bg-gray-600 w-fit relative">
        <DisplayWindow
          showBorder
          displayType="stream"
          width={isMobile ? 85 : 25}
          {...{ [overlayInfoKey]: overlayInfo }}
        />
      </div>
      <div className="flex gap-2">
        {secondaryAction}
        <Button
          svg={Save}
          color="#22d3ee"
          className="justify-center flex-1 text-sm"
          onClick={onApply}
        >
          Apply
        </Button>
      </div>
    </div>
  );
};

export default OverlayPreview;
