import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import {
  useCachedMediaUrl,
  useResolvedCachedMediaUrl,
} from "../../hooks/useCachedMediaUrl";
import { useLocalImageUrl } from "../../hooks/useLocalImageUrl";
import { useLocalVideoFileUrl } from "../../hooks/useLocalVideoFileUrl";
import { shouldSkipDisplayTextAnimation } from "./utils";

const DISPLAY_IMAGE_CACHE_SWAP_DEFER_MS = 650;

type ManagedImage = {
  identity: string;
  url: string;
};

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
  /** Lane-hosted file video URL for this box's snapshot, when present. */
  activeVideoUrl?: string;
  /** True once the lane's full-frame file video has a usable frame. */
  isWindowVideoLoaded?: boolean;
  referenceWidth?: number;
  referenceHeight?: number;
  scaleFactor?: number;
  brightness?: number;
  isSimpleFont?: boolean;
  /** Reports whether this box's background has decoded pixels ready to reveal. */
  onPaintReadyChange?: (ready: boolean) => void;
  /** The parent owns opacity and requires a source that will not swap mid-fade. */
  isTransitionManaged?: boolean;
  /** When false, skip still/box backgrounds (stage already paints them). */
  paintBackground?: boolean;
  /** When false, hide lyrics/text (used for a non-fading still hold layer). */
  paintForeground?: boolean;
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
  onPaintReadyChange,
  isTransitionManaged = false,
  paintBackground = true,
  paintForeground = true,
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
  const shouldImageBeHidden = useMemo(() => {
    if (!isVideoBg || !resolvedVideoUrl) return false;
    // Hide the poster/thumbnail while this lane's real file-video surface is up.
    return (
      resolvedVideoUrl === activeVideoUrl && Boolean(isWindowVideoLoaded)
    );
  }, [
    isVideoBg,
    resolvedVideoUrl,
    activeVideoUrl,
    isWindowVideoLoaded,
  ]);

  const background = box.background;
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
  const shouldShowBackground = Boolean(
    paintBackground &&
      showBackground &&
      (background || (isVideoBg && rawImage)),
  );
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
  const resolvedCachedImage = useResolvedCachedMediaUrl(rawImage);
  const backgroundTransitionIdentity = getBackgroundTransitionIdentity(
    box,
    rawImage,
  );
  // Transition-managed stills must mount synchronously. If Electron has not
  // finished checking its cache, use the remote URL now and keep that choice
  // for this lane; cache promotion belongs to a later snapshot, never mid-fade.
  const [managedRemoteImage, setManagedRemoteImage] = useState<
    ManagedImage | undefined
  >(() => {
    const url = resolvedCachedImage ?? cachedImage ?? rawImage;
    return url ? { identity: backgroundTransitionIdentity, url } : undefined;
  });
  // Object URLs already point at IndexedDB-backed bytes on this device. Sending
  // them through Electron's remote-media cache adds IPC and can retain the
  // previous URL for one render during a relink.
  const [deferredRemoteImage, setDeferredRemoteImage] = useState(cachedImage);
  const managedImageForCurrentIdentity =
    managedRemoteImage?.identity === backgroundTransitionIdentity
      ? managedRemoteImage.url
      : undefined;
  const currentImageCandidate = resolvedCachedImage ?? cachedImage ?? rawImage;
  const currentTransitionImage =
    managedImageForCurrentIdentity ?? currentImageCandidate;
  let displayImage = isTransitionManaged
    ? currentTransitionImage
    : deferredRemoteImage;
  if (localImage.isLocalImage) {
    displayImage = localImage.url;
  } else if (localVideoThumbnail.url) {
    displayImage = localVideoThumbnail.url;
  }
  const [decodedImage, setDecodedImage] = useState<ManagedImage>();
  const isImageReadyToPaint = Boolean(
    displayImage &&
      decodedImage?.identity === backgroundTransitionIdentity &&
      decodedImage.url === displayImage,
  );
  const isLocalImageReadyToPaint =
    !localImage.isLocalImage || isImageReadyToPaint;
  const backgroundImageRef = useRef<HTMLImageElement>(null);
  const displayImageBoxIdRef = useRef(box.id);
  const displayRawImageRef = useRef(rawImage);
  const targetCurrentImgOpacity = shouldImageBeHidden ? 0 : 1;
  const skipTextAnimation =
    shouldAnimate &&
    Boolean(prevBox) &&
    shouldSkipDisplayTextAnimation(box.words, prevBox?.words);
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
  // Once a local image has decoded, GSAP owns its opacity for the rest of the
  // transition. Re-applying the initial value on a later React render could
  // reset the image to 0 and cause the transmit preview's visible flash.
  const renderedBackgroundOpacity = localImage.isLocalImage
    ? isLocalImageReadyToPaint
      ? undefined
      : 0
    : initialBackgroundOpacity;
  const initialTextOpacity = !shouldAnimate
    ? undefined
    : isPrev || skipTextAnimation
      ? 1
      : 0;

  useEffect(() => {
    if (isTransitionManaged && currentTransitionImage) {
      // Freeze the first URL selected for this background identity. A reused
      // DisplayBox must never let a URL acquired by another identity survive
      // into the next snapshot.
      if (
        managedRemoteImage?.identity !== backgroundTransitionIdentity ||
        managedRemoteImage?.url !== currentTransitionImage
      ) {
        setManagedRemoteImage({
          identity: backgroundTransitionIdentity,
          url: currentTransitionImage,
        });
      }
    }
  }, [
    backgroundTransitionIdentity,
    currentTransitionImage,
    isTransitionManaged,
    managedRemoteImage,
  ]);

  useEffect(() => {
    if (isTransitionManaged) return;
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
    isTransitionManaged,
    localImage.isLocalImage,
    localVideoThumbnail.url,
    rawImage,
    shouldAnimate,
  ]);

  const markImageDecoded = useCallback(
    (image: HTMLImageElement, imageUrl: string) => {
      const commitReady = () => {
        if (
          backgroundImageRef.current === image &&
          displayImage === imageUrl
        ) {
          setDecodedImage({
            identity: backgroundTransitionIdentity,
            url: imageUrl,
          });
        }
      };

      if (typeof image.decode !== "function") {
        commitReady();
        return;
      }

      void image.decode().then(commitReady).catch(() => {
        // `load` already established usable pixels. Some Electron/Chromium
        // versions reject decode() after a successful load when the resource
        // was satisfied by an object URL cache.
        if (image.complete && image.naturalWidth > 0) commitReady();
      });
    },
    [backgroundTransitionIdentity, displayImage],
  );

  useLayoutEffect(() => {
    if (!displayImage) return;
    const image = backgroundImageRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      markImageDecoded(image, displayImage);
    }
  }, [displayImage, markImageDecoded]);

  const backgroundPaintReady =
    !shouldShowBackground ||
    shouldImageBeHidden ||
    localImage.status === "unavailable" ||
    Boolean(displayImage && isImageReadyToPaint);

  useEffect(() => {
    onPaintReadyChange?.(backgroundPaintReady);
  }, [backgroundPaintReady, onPaintReadyChange]);

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
      // Same image: the incoming box stays painted (keepVisible). The outgoing
      // box must clear immediately (snapToEnd → 0) so it does not sit opaque
      // on top and hide the text crossfade. Video stills also snap away once
      // playback is up.
      holdBehavior:
        isPrev || shouldImageBeHidden ? "snapToEnd" : "keepVisible",
      // 0 once the video is up: the still is only a placeholder for it.
      targetOpacity: targetCurrentImgOpacity,
      // A local <img> exists before its pixels are ready. Starting the fade in
      // that state made Electron show the new frame, reset it to transparent at
      // `onLoad`, then run a second fade. Wait for paint readiness so there is
      // exactly one background transition.
      enabled: Boolean(shouldShowBackground) &&
        (!localImage.isLocalImage || isLocalImageReadyToPaint),
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
      //
      // `isLocalImageReadyToPaint` is the exception: a cold local image mounts
      // its background node only after IndexedDB resolves, so the first pass
      // has nothing to tween and must re-run once the bytes are ready to fade in.
      scope: boxRef,
      dependencies: [
        box,
        prevBox,
        isPrev,
        shouldAnimate,
        shouldImageBeHidden,
        isLocalImageReadyToPaint,
        skipTextAnimation,
        skipBackgroundAnimation,
      ],
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
  const brightnessValue = brightness ?? box.brightness;

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

  return (
    <div
      ref={boxRef}
      className="absolute leading-tight"
      data-testid="display-box"
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
        // Keep the faded fallback mounted for the rest of an animated slide.
        // Electron can composite one black frame when it removes this CSS-
        // animated image at the exact time the incoming GSAP layer settles.
        // A transparent fallback is visually inert and is replaced with the
        // next box, so it safely preserves the compositor's stable layers.
        (!isLocalImageReadyToPaint || shouldAnimate) &&
        previousDisplayImage && (
          <img
            aria-hidden
            alt=""
            data-testid="display-box-background-fallback"
            className={cn(
              "display-box-background-fallback absolute h-full w-full transition-opacity duration-500 ease-in-out",
              prevBox?.shouldKeepAspectRatio && "object-contain",
              isLocalImageReadyToPaint ? "opacity-0" : "opacity-100",
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
            alt={box.label || ""}
            onLoad={(event) => {
              markImageDecoded(event.currentTarget, displayImage);
            }}
            style={{
              // Broken-image alt text inherits parent fontSize; keep it readable, not slide-sized.
              fontSize: 16,
              opacity:
                renderedBackgroundOpacity,
            }}
          />
        ) : null)}
      {paintForeground ? (
        <p
          className="display-box-text h-full w-full bg-transparent whitespace-pre-line absolute overflow-hidden"
          style={{
            ...textStyles,
            opacity: initialTextOpacity,
          }}
        >
          {renderContent()}
        </p>
      ) : null}
    </div>
  );
};

export default DisplayBox;
