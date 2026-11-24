import { memo } from "react";
import type {
  FormattedTextDisplayInfo,
  ItemSlideType,
  TimerInfo,
} from "../../types";
import DisplayBox from "../../components/DisplayWindow/DisplayBox";
import DisplayStreamBible from "../../components/DisplayWindow/DisplayStreamBible";
import DisplayStreamFormattedText from "../../components/DisplayWindow/DisplayStreamFormattedText";
import DisplayStreamText from "../../components/DisplayWindow/DisplayStreamText";
import {
  REFERENCE_HEIGHT,
  REFERENCE_WIDTH,
} from "../../constants";
import { resolveDisplayRenderProfile } from "../../components/DisplayWindow/displayRenderProfile";
import StaticMonitorThumbnail from "./StaticMonitorThumbnail";
import {
  resolveDisplaySettings,
  type ResolvedDisplaySettings,
} from "../../utils/displaySettings";
import type { ThumbnailPreviewMode } from "../../context/thumbnailPreviewMode";
import LocalSourceStatus from "../../components/DisplayWindow/LocalSourceStatus";
import LocalVideoInputSlideBadge from "../../components/LocalVideoInputSlideBadge/LocalVideoInputSlideBadge";
import { getLocalVideoInputPreviewStatus } from "../../utils/localVideoInput";
import { useLocalVideoFileUrl } from "../../hooks/useLocalVideoFileUrl";

type StaticSlideThumbnailProps = {
  slide: ItemSlideType;
  itemType: string;
  previewMode: ThumbnailPreviewMode;
  monitorSlide?: ItemSlideType;
  nextSlide?: ItemSlideType;
  monitorSettings?: ResolvedDisplaySettings;
  timerInfo?: TimerInfo;
  bibleInfo?: { title: string; text: string };
  scaleFactor?: number;
  localVideoInputThumbnailUrl?: string;
};

const getFormattedTextDisplayInfo = (
  slide: ItemSlideType,
  itemType: string,
): FormattedTextDisplayInfo | undefined => {
  if (itemType !== "free") return undefined;

  const stored = slide.formattedTextDisplayInfo;
  return {
    text: stored?.text?.trim() || slide.boxes[1]?.words?.trim() || "",
    backgroundColor: stored?.backgroundColor || "#eb8934",
    textColor: stored?.textColor || "#ffffff",
    fontSize: stored?.fontSize || 1.5,
    paddingX: stored?.paddingX || 2,
    paddingY: stored?.paddingY || 1,
    isBold: stored?.isBold || false,
    isItalic: stored?.isItalic || false,
    align: stored?.align || "left",
  };
};

const StaticSlideThumbnail = ({
  slide,
  itemType,
  previewMode,
  monitorSlide,
  nextSlide,
  monitorSettings,
  timerInfo,
  bibleInfo,
  scaleFactor = 0,
  localVideoInputThumbnailUrl,
}: StaticSlideThumbnailProps) => {
  const isStreamFormat = previewMode === "stream";
  const streamVideoReference = isStreamFormat
    ? slide.boxes[0]?.mediaInfo?.localVideoFile
    : undefined;
  const streamVideoSource = useLocalVideoFileUrl(
    streamVideoReference,
    "display",
  );
  if (previewMode === "monitor") {
    return (
      <StaticMonitorThumbnail
        slide={slide}
        monitorSlide={monitorSlide}
        nextSlide={nextSlide}
        itemType={itemType}
        settings={
          monitorSettings ?? resolveDisplaySettings(undefined, undefined, "monitor")
        }
        timerInfo={timerInfo}
        scaleFactor={scaleFactor}
        localVideoInputThumbnailUrl={localVideoInputThumbnailUrl}
      />
    );
  }

  // Preserve the historical `slide` profile for the default Projector preview.
  const displayType = isStreamFormat ? "stream" : "slide";
  const profile = resolveDisplayRenderProfile(displayType, slide.boxes);
  const formatted = getFormattedTextDisplayInfo(slide, itemType);
  const localVideoInputStatus = getLocalVideoInputPreviewStatus(
    slide.mediaSource?.kind === "local-video-input"
      ? slide.mediaSource
      : undefined,
  );
  return (
    <div
      className={`relative isolate aspect-video w-full overflow-hidden overflow-anywhere border border-gray-500 text-white ${
        isStreamFormat ? "bg-transparent" : "bg-black"
      }`}
      style={{ fontFamily: "Inter, sans-serif" }}
      data-testid="static-slide-thumbnail"
      data-preview-mode={previewMode}
    >
      <div
        data-testid="static-slide-reference-canvas"
        style={{
          width: `${REFERENCE_WIDTH}px`,
          height: `${REFERENCE_HEIGHT}px`,
          transform: `translate(-50%, -50%) scale(${scaleFactor})`,
          transformOrigin: "center center",
          position: "absolute",
          top: "50%",
          left: "50%",
          isolation: "isolate",
        }}
      >
        {localVideoInputThumbnailUrl ? (
          <img
            src={localVideoInputThumbnailUrl}
            alt=""
            aria-hidden
            data-testid="static-video-input-thumbnail"
            className={`absolute inset-0 h-full w-full ${
              slide.mediaSource?.fit === "cover" ? "object-cover" : "object-contain"
            }`}
            style={{
              filter: `brightness(${profile.backgroundBrightness ?? slide.boxes[0]?.brightness ?? 100}%)`,
            }}
          />
        ) : null}
        {!isStreamFormat ? (
          slide.boxes.map((box, index) => (
            <DisplayBox
              key={box.id || index}
              box={box}
              width={100}
              showBackground={
                profile.supportsBackground || Boolean(localVideoInputThumbnailUrl)
              }
              showLocalSourceStatus={profile.supportsBackground}
              statusScaleFactor={scaleFactor}
              localSourceStatusSize="thumbnail"
              allowLocalVideoThumbnailGeneration
              index={index}
              paintBackground={!(localVideoInputThumbnailUrl && index === 0)}
              timerInfo={timerInfo}
              shouldAnimate={false}
              brightness={
                index === 0 ? profile.backgroundBrightness : undefined
              }
              isSimpleFont={profile.isSimpleFont}
            />
          ))
        ) : itemType === "bible" ? (
          bibleInfo?.text ? (
            <DisplayStreamBible
              width={100}
              bibleDisplayInfo={bibleInfo}
              isStatic
            />
          ) : null
        ) : itemType === "free" ? (
          formatted?.text ? (
            <DisplayStreamFormattedText
              width={100}
              formattedTextDisplayInfo={formatted}
              isStatic
            />
          ) : null
        ) : (
          slide.boxes.map((box, index) => (
            <DisplayStreamText
              key={box.id || index}
              box={box}
              width={100}
              timerInfo={timerInfo}
              isStatic
            />
          ))
        )}
        {localVideoInputStatus && !localVideoInputThumbnailUrl ? (
          <LocalSourceStatus
            {...localVideoInputStatus}
            size="thumbnail"
            scaleFactor={scaleFactor}
            transparentBackground={isStreamFormat}
            testId="local-video-input-thumbnail-status"
          />
        ) : null}
        {isStreamFormat &&
        streamVideoSource.isLocalVideoFile &&
        streamVideoSource.status !== "ready" &&
        streamVideoSource.status !== "not-local" ? (
          <LocalSourceStatus
            sourceLabel={`Local video · ${slide.boxes[0]?.mediaInfo?.localVideoFile?.fileName || "Background"}`}
            ownerLabel={
              streamVideoSource.isOwner
                ? undefined
                : slide.boxes[0]?.mediaInfo?.localVideoFile?.ownerLabel
            }
            heading={
              streamVideoSource.status === "loading"
                ? "Loading local video"
                : streamVideoSource.isOwner
                  ? "Local video unavailable"
                  : undefined
            }
            state={
              streamVideoSource.status === "loading" ? "loading" : undefined
            }
            detail={
              streamVideoSource.isOwner
                ? "Open Media on this device and relink the file."
                : undefined
            }
            size="thumbnail"
            scaleFactor={scaleFactor}
            transparentBackground
          />
        ) : null}
      </div>
      {localVideoInputStatus && localVideoInputThumbnailUrl ? (
        <LocalSourceStatus
          {...localVideoInputStatus}
          variant="indicator"
        />
      ) : null}
      {slide.mediaSource?.kind === "local-video-input" &&
      !localVideoInputStatus ? (
        <LocalVideoInputSlideBadge
          label={slide.mediaSource.label}
          captureKind={slide.mediaSource.captureKind}
          variant={localVideoInputThumbnailUrl ? "indicator" : "overlay"}
          coverTitleBar={!localVideoInputThumbnailUrl}
          className={
            localVideoInputThumbnailUrl
              ? "!bottom-2 !left-2 !right-auto !max-w-[65%]"
              : undefined
          }
        />
      ) : null}
    </div>
  );
};

export default memo(StaticSlideThumbnail);
