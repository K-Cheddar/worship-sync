import Button from "../../components/Button/Button";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import Input from "../../components/Input/Input";
import Select from "../../components/Select/Select";
import { DisplayType, LinkType, QuickLinkType, TimerInfo } from "../../types";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import cn from "classnames";
import { useMemo, useState } from "react";

const baseImgUrl =
  "https://res.cloudinary.com/portable-media/image/upload/v1/backgrounds";

const baseLinkTypeOptions = [
  { label: "Image", value: "image" },
  { label: "Slide", value: "slide" },
  { label: "Overlay", value: "overlay" },
];

type QuickLinkProps = QuickLinkType & {
  removeQuickLink: () => void;
  updateQuickLink: (key: keyof QuickLinkType, value: any) => void;
  isMobile?: boolean;
  isSelected: boolean;
  setSelectedQuickLink: () => void;
  timers: TimerInfo[];
};

const QuickLink = ({
  canDelete,
  displayType,
  label,
  presentationInfo,
  updateQuickLink,
  removeQuickLink,
  isMobile,
  isSelected,
  setSelectedQuickLink,
  linkType: _linkType,
  timers,
}: QuickLinkProps) => {
  const [linkType, setLinkType] = useState<LinkType>(() => {
    if (displayType === "projector") {
      return _linkType || "image";
    }
    if (displayType === "monitor") {
      return _linkType || "slide";
    }
    if (displayType === "stream") {
      return _linkType || "overlay";
    }
    return "image";
  });

  const linkTypeOptions = useMemo(() => {
    if (displayType === "projector") {
      return [baseLinkTypeOptions[0], baseLinkTypeOptions[1]];
    }
    if (displayType === "monitor") {
      return [baseLinkTypeOptions[1]];
    }
    if (displayType === "stream") {
      return [baseLinkTypeOptions[1], baseLinkTypeOptions[2]];
    }
    return baseLinkTypeOptions;
  }, [displayType]);

  const timerInfo = useMemo(() => {
    if (_linkType === "slide") {
      return timers.find((t) => t.id === presentationInfo?.timerId);
    }
    return undefined;
  }, [timers, presentationInfo, _linkType]);

  return (
    <li
      className={cn(
        "flex gap-4 items-center justify-around flex-wrap",
        "border-b-2 border-gray-400 pb-2 max-lg:pb-6"
      )}
    >
      <Select
        className="flex flex-col"
        label="Display Type"
        disabled={!canDelete}
        options={[
          {
            label: "Projector",
            value: "projector",
          },
          {
            label: "Monitor",
            value: "monitor",
          },
          {
            label: "Stream",
            value: "stream",
          },
        ]}
        value={displayType || "projector"}
        onChange={(val) => updateQuickLink("displayType", val as DisplayType)}
      />
      <Input
        label="Label"
        type="text"
        className="w-32"
        value={label}
        onChange={(val) => updateQuickLink("label", val as string)}
        disabled={!canDelete}
      />
      <Select
        className="flex flex-col"
        label="Link Type"
        options={linkTypeOptions}
        value={linkType}
        onChange={(val) => {
          setLinkType(val as LinkType);
          updateQuickLink("linkType", val as LinkType);
        }}
      />

      {linkType === "image" && (
        <Button
          variant="tertiary"
          className={cn(
            "flex flex-col gap-2 items-center border-2",
            isSelected ? "border-cyan-500" : "border-transparent"
          )}
          onClick={setSelectedQuickLink}
        >
          <p className="text-sm">Image:</p>
          <p className="text-xs w-48 overflow-hidden text-ellipsis whitespace-nowrap bg-gray-200 p-2 rounded-md text-black">
            {presentationInfo?.slide?.boxes[0]?.background?.replace(
              baseImgUrl,
              ""
            )}
          </p>
          <p className="text-xs">Select image from media.</p>
        </Button>
      )}

      {linkType === "slide" && (
        <Button
          variant="tertiary"
          className={cn(
            "flex flex-col gap-2 items-center border-2",
            isSelected ? "border-cyan-500" : "border-transparent"
          )}
          onClick={setSelectedQuickLink}
        >
          <p className="text-sm">Slide:</p>
          <p className="text-xs w-48 overflow-hidden text-ellipsis whitespace-nowrap bg-gray-200 p-2 rounded-md text-black">
            {presentationInfo?.name}
          </p>
          <p className="text-xs">Select slide from item</p>
        </Button>
      )}

      {linkType === "overlay" && (
        <Button
          variant="tertiary"
          className={cn(
            "flex flex-col gap-2 items-center border-2",
            isSelected ? "border-cyan-500" : "border-transparent"
          )}
          onClick={setSelectedQuickLink}
        >
          <p className="text-sm">Overlay:</p>
          <p className="text-xs w-48 overflow-hidden text-ellipsis whitespace-nowrap bg-gray-200 p-2 rounded-md text-black">
            {presentationInfo?.name}
          </p>
          <p className="text-xs">Select overlay</p>
        </Button>
      )}

      <section className="flex flex-col gap-2 items-center">
        <p className="font-semibold">Presentation:</p>
        <DisplayWindow
          displayType={displayType}
          showBorder
          width={isMobile ? 12 : 8}
          boxes={presentationInfo?.slide?.boxes}
          bibleDisplayInfo={presentationInfo?.bibleDisplayInfo}
          participantOverlayInfo={presentationInfo?.participantOverlayInfo}
          stbOverlayInfo={presentationInfo?.stbOverlayInfo}
          qrCodeOverlayInfo={presentationInfo?.qrCodeOverlayInfo}
          imageOverlayInfo={presentationInfo?.imageOverlayInfo}
          timerInfo={timerInfo}
        />
      </section>
      {canDelete && (
        <Button variant="tertiary" svg={DeleteSVG} onClick={removeQuickLink} />
      )}
    </li>
  );
};

export default QuickLink;
