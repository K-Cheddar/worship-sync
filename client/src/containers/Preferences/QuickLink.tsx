import Button from "../../components/Button/Button";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import Input from "../../components/Input/Input";
import Select from "../../components/Select/Select";
import { DisplayType, LinkType, QuickLinkType, TimerInfo } from "../../types";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";
import cn from "classnames";
import { useMemo, useState } from "react";
import QuickLinkButton from "./QuickLinkButton";

const baseImgUrl =
  "https://res.cloudinary.com/portable-media/image/upload/v1/backgrounds";

const baseLinkTypeOptions = [
  { label: "Media", value: "media" },
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
  index: number;
};

const QuickLink = ({
  canDelete,
  displayType,
  label,
  presentationInfo,
  updateQuickLink,
  removeQuickLink,
  index,
  isMobile,
  isSelected,
  setSelectedQuickLink,
  linkType: _linkType,
  timers,
  id,
}: QuickLinkProps) => {
  const [linkType, setLinkType] = useState<LinkType>(() => {
    if (displayType === "projector") {
      return _linkType || "media";
    }
    if (displayType === "monitor") {
      return _linkType || "slide";
    }
    if (displayType === "stream") {
      return _linkType || "overlay";
    }
    return "media";
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
        "flex gap-4 items-center justify-around flex-wrap border-b-2 border-gray-400 p-2 max-lg:pb-6 rounded-md",
        index % 2 === 0 && "bg-gray-600"
      )}
      id={`quick-link-${id}`}
    >
      <Select
        className="flex flex-col"
        selectClassName="bg-gray-900 text-white"
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
        label="Type"
        options={linkTypeOptions}
        value={linkType}
        onChange={(val) => {
          setLinkType(val as LinkType);
          updateQuickLink("linkType", val as LinkType);
        }}
      />

      {linkType === "media" && (
        <QuickLinkButton
          title="Media"
          content={
            presentationInfo?.slide?.boxes[0]?.background?.replace(
              baseImgUrl,
              ""
            ) || ""
          }
          helpText="Click to select media."
          selectedText="Now select media and click set."
          isSelected={isSelected}
          onClick={setSelectedQuickLink}
        />
      )}

      {linkType === "slide" && (
        <QuickLinkButton
          title="Slide"
          content={presentationInfo?.name || ""}
          helpText="Click to select slide from item."
          selectedText="Now select a slide and click select."
          isSelected={isSelected}
          onClick={setSelectedQuickLink}
        />
      )}

      {linkType === "overlay" && (
        <QuickLinkButton
          title="Overlay"
          content={presentationInfo?.name || ""}
          helpText="Click to select overlay."
          selectedText="Now select an overlay and click select."
          isSelected={isSelected}
          onClick={setSelectedQuickLink}
        />
      )}

      <section className="flex flex-col gap-2 items-center">
        <p className="font-semibold">Presentation:</p>
        <DisplayWindow
          displayType={displayType}
          showBorder
          width={isMobile ? 24 : 12}
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
        <Button
          variant="tertiary"
          iconSize="lg"
          svg={DeleteSVG}
          color="red"
          onClick={removeQuickLink}
        />
      )}
    </li>
  );
};

export default QuickLink;
