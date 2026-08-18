import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, TimerInfo } from "../../types";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import cn from "classnames";
import TimerDisplay from "./TimerDisplay";
import VerseDisplay from "./VerseDisplay";
import NowDisplay from "./NowDisplay";
import {
  REFERENCE_WIDTH,
  REFERENCE_HEIGHT,
  DEFAULT_FONT_PX,
} from "../../constants";
import { useCachedMediaUrl } from "../../hooks/useCachedMediaUrl";
import { useLocalImageUrl } from "../../hooks/useLocalImageUrl";
import { useLocalVideoFileUrl } from "../../hooks/useLocalVideoFileUrl";

const DISPLAY_IMAGE_CACHE_SWAP_DEFER_MS = 650;

/**
 * Shared start for every layer of a box transition.
 *
 * Layers may run for different lengths, but they all begin here — that is what
 * makes a box read as one cross-fade rather than several unrelated fades.
 */
const TRANSITION_LABEL_IN = "fadeIn";
const TRANSITION_LABEL_OUT = "fadeOut";
const TRANSITION_EASE = "power1.inOut";
/** Per-layer durations, in seconds. The seam for making these configurable. */
const TEXT_FADE_SECONDS = 0.35;
const BACKGROUND_FADE_SECONDS = 0.5;

/**
 * One animatable layer of a display box.
 *
 * Adding a layer should mean adding an entry, not rewriting the timeline.
 */
type BoxTransitionLayer = {
  /** Scoped to the box, so it only reaches this box's own layer. */
  selector: string;
  durationSeconds: number;
  /** True when this layer's content is unchanged and should not re-animate. */
  hold: boolean;
  /**
   * `keepVisible` leaves the layer up — identical words across a change would
   * otherwise flicker. `snapToEnd` jumps to the settled value, which is right
   * for media the incoming layer is already showing.
   */
  holdBehavior: "keepVisible" | "snapToEnd";
  /** Where the incoming layer settles. */
  targetOpacity: number;
  enabled: boolean;
};
const LOCAL_IMAGE_BACKGROUND_FADE_MS = 500;

const hasDynamicDisplayText = (words?: string) =>
  Boolean(
    words?.includes("{{timer}}") ||
    words?.includes("{{service-time}}") ||
    words?.includes("\u200C"),
  );

const getBackgroundTransitionIdentity = (
  box: Box | undefined,
  rawImage?: string,
) => {
  const localImage = box?.mediaInfo?.localImage;
  if (localImage) {
    return `local:${localImage.id}:${localImage.contentRevision ?? "legacy"}`;
  }
  const localVideoFile = box?.mediaInfo?.localVideoFile;
  if (localVideoFile) {
    return `local-video:${localVideoFile.id}:${localVideoFile.contentRevision ?? "legacy"}`;
  }
  return `remote:${rawImage ?? ""}`;
};

type DisplayBoxProps = {
  prevBox?: Box;
  box: Box;
  width: number;
  showBackground: boolean;
  index: number;
  shouldAnimate?: boolean;
  isPrev?: boolean;
  time?: number;
  timerInfo?: TimerInfo;
  activeVideoUrl?: string;
  isWindowVideoLoaded?: boolean;
  referenceWidth?: number;
  referenceHeight?: number;
  scaleFactor?: number;
  brightness?: number;
  isSimpleFont?: boolean;
};

const DisplayBox = ({
  prevBox,
  box,
  width,
  showBackground,
  index,
  shouldAnimate,
  isPrev,
  time,
  timerInfo,
  activeVideoUrl,
  isWindowVideoLoaded,
  referenceWidth = REFERENCE_WIDTH,
  referenceHeight = REFERENCE_HEIGHT,
  brightness,
  isSimpleFont,
}: DisplayBoxProps) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const boxTimeline = useRef<GSAPTimeline | null>(null);
  const isVideoBg = box.mediaInfo?.type === "video";
  const videoUrl = box.mediaInfo?.background;
  // A local video file stores `background` as a local-video-file:// reference,
  // but the player is handed the resolved worshipsync-media:// URL. Comparing
  // the raw form never matches, so the placeholder stayed painted at full
  // opacity over a video that was playing fine underneath it.
  const localVideoDisplay = useLocalVideoFileUrl(box.mediaInfo?.localVideoFile);
  const resolvedVideoUrl = localVideoDisplay.isLocalVideoFile
    ? localVideoDisplay.url
    : videoUrl;
  const shouldImageBeHidden = useMemo(
    () =>
      isVideoBg &&
      resolvedVideoUrl &&
      resolvedVideoUrl === activeVideoUrl &&
      isWindowVideoLoaded,
    [isVideoBg, resolvedVideoUrl, activeVideoUrl, isWindowVideoLoaded],
  );

  const background = box.background;
  const shouldShowBackground = showBackground && background;
  const localVideoThumbnail = useLocalVideoFileUrl(
    box.mediaInfo?.localVideoFile,
    "thumbnail",
  );
  const prevLocalVideoThumbnail = useLocalVideoFileUrl(
    prevBox?.mediaInfo?.localVideoFile,
    "thumbnail",
  );
  const videoPlaceholderImage =
    localVideoThumbnail.url || box.mediaInfo?.placeholderImage;
  const rawImage = isVideoBg ? videoPlaceholderImage : background;
  const localImage = useLocalImageUrl(box.mediaInfo?.localImage);
  const prevIsVideoBg = prevBox?.mediaInfo?.type === "video";
  let prevRawImage = prevBox?.background;
  if (prevIsVideoBg) {
    prevRawImage =
      prevLocalVideoThumbnail.url || prevBox?.mediaInfo?.placeholderImage;
  }
  const prevLocalImage = useLocalImageUrl(prevBox?.mediaInfo?.localImage);
  const cachedPrevImage = useCachedMediaUrl(prevRawImage);
  let previousDisplayImage = cachedPrevImage;
  if (prevLocalImage.isLocalImage) {
    previousDisplayImage = prevLocalImage.url;
  } else if (prevLocalVideoThumbnail.url) {
    previousDisplayImage = prevLocalVideoThumbnail.url;
  }
  const cachedImage = useCachedMediaUrl(rawImage);
  // Object URLs already point at IndexedDB-backed bytes on this device. Sending
  // them through Electron's remote-media cache adds IPC and can retain the
  // previous URL for one render during a relink.
  const [deferredRemoteImage, setDeferredRemoteImage] = useState(cachedImage);
  let displayImage = deferredRemoteImage;
  if (localImage.isLocalImage) {
    displayImage = localImage.url;
  } else if (localVideoThumbnail.url) {
    displayImage = localVideoThumbnail.url;
  }
  const [loadedLocalImageUrl, setLoadedLocalImageUrl] = useState<string>();
  const [settledLocalImageUrl, setSettledLocalImageUrl] = useState<string>();
  const isLocalImageReadyToPaint = Boolean(
    displayImage && loadedLocalImageUrl === displayImage,
  );
  const backgroundImageRef = useRef<HTMLImageElement>(null);
  const displayImageBoxIdRef = useRef(box.id);
  const displayRawImageRef = useRef(rawImage);
  const targetCurrentImgOpacity = shouldImageBeHidden ? 0 : 1;
  const skipTextAnimation =
    prevBox &&
    prevBox.words?.trim() === box.words?.trim() &&
    !hasDynamicDisplayText(box.words) &&
    !hasDynamicDisplayText(prevBox.words);
  const backgroundTransitionIdentity = getBackgroundTransitionIdentity(
    box,
    rawImage,
  );
  const prevBackgroundTransitionIdentity = getBackgroundTransitionIdentity(
    prevBox,
    prevRawImage,
  );
  const skipBackgroundAnimation =
    (prevBox &&
      prevBackgroundTransitionIdentity === backgroundTransitionIdentity) ||
    shouldImageBeHidden;
  const initialBackgroundOpacity = !shouldAnimate
    ? undefined
    : isPrev || skipBackgroundAnimation
      ? targetCurrentImgOpacity
      : 0;
  const initialTextOpacity = !shouldAnimate
    ? undefined
    : isPrev || skipTextAnimation
      ? 1
      : 0;

  useEffect(() => {
    if (localImage.isLocalImage || localVideoThumbnail.url) {
      displayImageBoxIdRef.current = box.id;
      displayRawImageRef.current = rawImage;
      return;
    }

    if (
      displayImageBoxIdRef.current !== box.id ||
      displayRawImageRef.current !== rawImage
    ) {
      displayImageBoxIdRef.current = box.id;
      displayRawImageRef.current = rawImage;
      setDeferredRemoteImage(cachedImage);
      return;
    }

    if (deferredRemoteImage === cachedImage) return;

    if (!shouldAnimate) {
      setDeferredRemoteImage(cachedImage);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDeferredRemoteImage(cachedImage);
    }, DISPLAY_IMAGE_CACHE_SWAP_DEFER_MS);

    return () => window.clearTimeout(timeoutId);
  }, [
    box.id,
    cachedImage,
    deferredRemoteImage,
    localImage.isLocalImage,
    localVideoThumbnail.url,
    rawImage,
    shouldAnimate,
  ]);

  useLayoutEffect(() => {
    if (!localImage.isLocalImage || !displayImage) return;
    const image = backgroundImageRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      setLoadedLocalImageUrl(displayImage);
    }
  }, [displayImage, localImage.isLocalImage]);

  useEffect(() => {
    if (
      !shouldAnimate ||
      !localImage.isLocalImage ||
      !displayImage ||
      !isLocalImageReadyToPaint ||
      !previousDisplayImage
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSettledLocalImageUrl(displayImage);
    }, LOCAL_IMAGE_BACKGROUND_FADE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [
    displayImage,
    isLocalImageReadyToPaint,
    localImage.isLocalImage,
    previousDisplayImage,
    shouldAnimate,
  ]);

  /**
   * Every layer transitions on one timeline at one label.
   *
   * Layers may run for different lengths — text settles faster than media — but
   * they must start together or the box stops reading as a single cross-fade.
   * Placing each tween at `TRANSITION_LABEL` is what guarantees that, and it is
   * the seam to widen when durations become configurable or a layer needs a
   * transition other than a fade.
   */
  const layers: BoxTransitionLayer[] = [
    {
      selector: ".display-box-text",
      durationSeconds: TEXT_FADE_SECONDS,
      // Identical words: holding avoids a flicker between two frames that look
      // the same, so the outgoing copy stays up while the media changes under it.
      hold: Boolean(skipTextAnimation),
      holdBehavior: "keepVisible",
      targetOpacity: 1,
      enabled: true,
    },
    {
      selector: ".display-box-background",
      durationSeconds: BACKGROUND_FADE_SECONDS,
      hold: Boolean(skipBackgroundAnimation),
      holdBehavior: "snapToEnd",
      // 0 once the video is up: the still is only a placeholder for it.
      targetOpacity: targetCurrentImgOpacity,
      enabled: Boolean(shouldShowBackground),
    },
  ];

  useGSAP(
    () => {
      if (!boxRef.current || !shouldAnimate) return;

      boxTimeline.current?.clear();
      boxTimeline.current = gsap.timeline();
      const label = isPrev ? TRANSITION_LABEL_OUT : TRANSITION_LABEL_IN;
      boxTimeline.current.addLabel(label);

      for (const layer of layers) {
        if (!layer.enabled) continue;
        // Background can be "enabled" before its image node mounts; skip rather
        // than warn when the scoped selector does not match yet.
        if (!boxRef.current?.querySelector(layer.selector)) continue;

        const startOpacity = isPrev ? 1 : 0;
        const settledOpacity = isPrev ? 0 : layer.targetOpacity;
        const keepsVisible = layer.hold && layer.holdBehavior === "keepVisible";

        if (keepsVisible) {
          // Pinned at the label rather than tweened: identical content should
          // sit still for the transition, not re-animate to where it already is.
          boxTimeline.current.set(layer.selector, { opacity: 1 }, label);
          continue;
        }

        const settled = settledOpacity;
        // A held layer starts where it ends, so it stays put for the length of
        // the transition instead of re-animating identical content.
        const from = layer.hold ? settled : startOpacity;

        boxTimeline.current.fromTo(
          layer.selector,
          { opacity: from },
          {
            opacity: settledOpacity,
            duration: layer.hold ? 0 : layer.durationSeconds,
            ease: TRANSITION_EASE,
          },
          label,
        );
      }
    },
    {
      // The box identity, not the resolved image URL. Depending on the URL made
      // the transition restart when the media cache swapped a network copy for
      // its local one, long after the cross-fade had finished.
      scope: boxRef,
      dependencies: [box, isPrev, shouldAnimate, shouldImageBeHidden],
    },
  );

  const bWords = box.words || "";
  const words = bWords;
  const fontSizeInPx = box.fontSize ?? DEFAULT_FONT_PX;

  const tSS = fontSizeInPx / 32;

  const boxWidthPx = (referenceWidth * box.width) / 100;
  const boxHeightPx = (referenceHeight * box.height) / 100;
  const sideMarginPx = box.sideMargin ? (boxWidthPx * box.sideMargin) / 100 : 0;
  const topMarginPx = box.topMargin ? (boxHeightPx * box.topMargin) / 100 : 0;

  const boxWidth = `${boxWidthPx - sideMarginPx * 2}px`;
  const boxHeight = `${boxHeightPx - topMarginPx * 2}px`;
  const marginLeft = `${sideMarginPx}px`;
  const marginRight = `${sideMarginPx}px`;
  const marginTop = `${topMarginPx}px`;
  const marginBottom = `${topMarginPx}px`;
  const boxTop = `${(referenceHeight * (box.y || 0)) / 100}px`;
  const boxLeft = `${(referenceWidth * (box.x || 0)) / 100}px`;
  const textStyles = {
    ...(isSimpleFont
      ? {}
      : {
        textShadow: `${tSS}px ${tSS}px ${tSS}px #000, ${tSS}px ${tSS}px ${tSS}px #000`,
      }),
    textAlign: box.align || "center",
    lineHeight: 1.25,
    fontWeight: box.isBold ? "bold" : "normal",
    fontStyle: box.isItalic ? "italic" : "normal",
  };

  const renderContent = () => {
    if (words.includes("{{timer}}") || words.includes("{{service-time}}")) {
      return <TimerDisplay timerInfo={timerInfo} words={words} />;
    }
    if (words.includes("\u200B")) return <VerseDisplay words={words} />;
    if (words.includes("\u200C")) {
      return <NowDisplay words={words} timerInfo={timerInfo} />;
    }
    return words;
  };

  const brightnessValue = brightness ?? box.brightness;

  return (
    <div
      ref={boxRef}
      className="absolute leading-tight"
      style={{
        width: boxWidth,
        height: boxHeight,
        pointerEvents: "none",
        fontSize: `${fontSizeInPx}px`,
        marginTop,
        marginBottom,
        marginLeft,
        marginRight,
        color: box.fontColor,
        filter: `brightness(${brightnessValue}%)`,
        top: boxTop,
        left: boxLeft,
      }}
    >
      {shouldShowBackground &&
        localImage.isLocalImage &&
        !isPrev &&
        (!isLocalImageReadyToPaint ||
          (shouldAnimate && settledLocalImageUrl !== displayImage)) &&
        previousDisplayImage && (
          <img
            aria-hidden
            alt=""
            data-testid="display-box-background-fallback"
            className={cn(
              "display-box-background-fallback absolute h-full w-full",
              prevBox?.shouldKeepAspectRatio && "object-contain",
            )}
            src={previousDisplayImage}
          />
        )}
      {shouldShowBackground &&
        (localImage.isLocalImage && localImage.status === "unavailable" ? (
          <div
            className="display-box-background absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black px-12 text-center text-white"
            role="status"
            style={{ fontSize: 16, opacity: initialBackgroundOpacity }}
          >
            <p className="text-4xl font-semibold">Local image unavailable</p>
            <p className="text-2xl text-neutral-300">
              {localImage.isOwner
                ? "Open this item on the source device and choose Relink."
                : `Available on ${box.mediaInfo?.localImage?.ownerLabel || "the source device"} only.`}
            </p>
          </div>
        ) : displayImage ? (
          <img
            ref={backgroundImageRef}
            className={cn(
              "display-box-background h-full w-full absolute",
              box.shouldKeepAspectRatio && "object-contain",
              shouldImageBeHidden ? "opacity-0" : "opacity-100",
            )}
            src={displayImage}
            alt={box.label}
            onLoad={() => {
              if (localImage.isLocalImage) {
                setLoadedLocalImageUrl(displayImage);
              }
            }}
            style={{
              // Broken-image alt text inherits parent fontSize; keep it readable, not slide-sized.
              fontSize: 16,
              opacity:
                localImage.isLocalImage && !isLocalImageReadyToPaint
                  ? 0
                  : initialBackgroundOpacity,
            }}
          />
        ) : null)}
      <p
        className="display-box-text h-full w-full bg-transparent whitespace-pre-line absolute overflow-hidden"
        style={{
          ...textStyles,
          opacity: initialTextOpacity,
        }}
      >
        {renderContent()}
      </p>
    </div>
  );
};

export default DisplayBox;
