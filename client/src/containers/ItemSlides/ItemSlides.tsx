import { ImageOff, Plus, Trash2, Copy, ZoomIn, ZoomOut } from "lucide-react";
import Button from "../../components/Button/Button";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import {
  clearBackgroundTargetSelection,
  clearSlideBackgroundsOnSubset,
  removeSlidesByIds,
  setBackgroundTargetSlideIds,
  setBackgroundTargetRangeAnchorId,
  setMobileBackgroundTargetSelectMode,
  setSelectedSlide,
  toggleBackgroundTargetSlideId,
  updateSlides,
  updateSlideVideoBackgroundSendMode,
} from "../../store/itemSlice";
import {
  setSlides,
  setSlidesMobile,
  setMonitorTimerId,
} from "../../store/preferencesSlice";
import { useDispatch, useSelector } from "../../hooks";
import {
  updateBibleDisplayInfo,
  updateFormattedTextDisplayInfo,
  updateMonitor,
  updateProjector,
  updateStream,
  selectOutputSlots,
} from "../../store/presentationSlice";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import {
  resolveOutputDefaults,
  shouldSendNextSlideForOutput,
} from "../../utils/displaySettings";
import {
  getSendTargetIdsForType,
  shouldSendToType,
} from "../../utils/sendTargets";
import { useActiveControllerProfile } from "../../context/activeController";
import { createNewSlide } from "../../utils/slideCreation";
import { addSlide as addSlideAction } from "../../store/itemSlice";
import ItemSlide from "./ItemSlide";
import ItemSlidesSkeleton from "./ItemSlidesSkeleton";
import OutlineItemSlidesScroller from "./OutlineItemSlidesScroller";
import {
  DndContext,
  useDroppable,
  DragEndEvent,
  DragStartEvent,
} from "@dnd-kit/core";

import { useSensors } from "../../utils/dndUtils";

import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { keepElementInView } from "../../utils/generalUtils";
import { RootState } from "../../store/store";
import generateRandomId from "../../utils/generateRandomId";
import { useLocation } from "react-router-dom";
import { GlobalInfoContext } from "../../context/globalInfo";
import { cn } from "../../utils/cnHelper";
import ActionBar, {
  type ActionBarItem as ActionBarItemDef,
} from "../../components/ActionBar/ActionBar";
import {
  MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS,
  MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
} from "../Media/mediaLibraryMediaActionUi";
import { DEFAULT_FONT_PX } from "../../constants";
import { didTimerJustExpire } from "../../utils/timerUtils";
import { ensureSlidesHaveMonitorBandFormatting } from "../../utils/overflow";
import { inclusiveRangeIndicesFromAnchor } from "../../utils/backgroundTargetResolution";
import { Slider } from "../../components/ui/Slider";
import type { Presentation as PresentationType } from "../../types";
import {
  buildLocalVideoInputPresentation,
  getLocalVideoSourceErrorMessage,
  isDesktopCaptureKind,
  resolveLocalVideoInputBinding,
} from "../../utils/localVideoInput";
import {
  acquireWarmLocalVideoCapture,
  LocalVideoCaptureOwnedError,
  releaseWarmLocalVideoCapture,
} from "../../utils/localVideoCapturePool";
import { getOrCreateDeviceId } from "../../utils/authStorage";
import { getTrustedDeviceLabel } from "../../utils/deviceInfo";
import { ToastContext } from "../../context/toastContext";
import {
  buildVideoPlaybackCueForSend,
  getSlideVideoBackgroundSendMode,
  getSlideVideoBackgroundMedia,
  getVideoBackgroundMediaKey,
  resolveSyncedVideoPlayback,
} from "../../utils/videoBackgroundPlayback";
import VideoBackgroundControls from "../../components/VideoBackgroundControls/VideoBackgroundControls";

type SizeConfig = {
  borderWidth: string;
  hSize: string;
  cols: string;
};

const LOCAL_VIDEO_TRANSMIT_HANDOFF_MS = 5_000;

/**
 * Builds the send cue for a slide, letting any output already playing this
 * video supply the playhead. Without the live cue a controller that just
 * joined — or one whose editor preview has not mounted — would send position
 * zero and restart a video that is already on screen.
 */
const withVideoPlayback = <T extends { slide?: PresentationType["slide"] }>(
  payload: T,
  outputs: Parameters<typeof resolveSyncedVideoPlayback>[0],
) => ({
  ...payload,
  videoPlayback: buildVideoPlaybackCueForSend(payload.slide, {
    liveCue: resolveSyncedVideoPlayback(
      outputs,
      getVideoBackgroundMediaKey(getSlideVideoBackgroundMedia(payload.slide)),
    ),
  }),
});

function slideToolbarButton({
  id,
  label,
  onClick,
  icon,
  disabled,
  destructive,
  title,
}: {
  id: string;
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  title?: string;
}): ActionBarItemDef {
  return {
    id,
    label,
    disabled,
    overflowMenuItemClassName: destructive
      ? "[&_svg]:text-red-400!"
      : undefined,
    renderButton: (isMeasure) => (
      <Button
        variant="tertiary"
        className={cn(
          "shrink-0",
          MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS,
          destructive && "text-white [&_svg]:text-red-400!",
        )}
        onClick={isMeasure ? undefined : onClick}
        disabled={disabled}
        title={title ?? label}
        tabIndex={isMeasure ? -1 : undefined}
      >
        <span className="flex items-center gap-1">
          {icon}
          {label}
        </span>
      </Button>
    ),
    onOverflowSelect: disabled ? undefined : onClick,
    renderOverflowItem: () => (
      <span className="flex items-center gap-1.5">
        {icon}
        {label}
      </span>
    ),
  };
}

function slideToolbarIcon(Icon: typeof Plus, className = "text-cyan-400") {
  return (
    <Icon
      className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, className)}
      aria-hidden
    />
  );
}

function resolveSlideActionTargetIds(
  subsetIds: string[] | undefined,
  slides: { id?: string }[],
  selectedSlide: number,
): string[] {
  if (subsetIds && subsetIds.length > 0) return subsetIds;
  const focusedId = slides[selectedSlide]?.id;
  return focusedId ? [focusedId] : [];
}

const ItemSlides = () => {
  const {
    arrangements,
    selectedArrangement,
    selectedSlide,
    type,
    name,
    slides: __slides,
    isLoading,
    _id,
    shouldSendTo,
    isEditMode,
    backgroundTargetSlideIds: backgroundTargetSlideIdsRaw,
    backgroundTargetRangeAnchorId,
    mobileBackgroundTargetSelectMode: mobileBgSelectModeRaw,
  } = useSelector((state: RootState) => state.undoable.present.item);

  const backgroundTargetSlideIds = backgroundTargetSlideIdsRaw ?? [];
  const mobileBackgroundTargetSelectMode = mobileBgSelectModeRaw ?? false;
  /** Subset selection chrome (count and Done). */
  const showBackgroundTargetActionBar =
    mobileBackgroundTargetSelectMode || backgroundTargetSlideIds.length > 0;

  // Every slot, so live-slide highlighting can follow whichever displays this
  // item targets rather than only the built-in three.
  const outputSlots = useSelector((state: RootState) =>
    selectOutputSlots(state),
  );

  const timers = useSelector((state: RootState) => state.timers.timers);
  const timerInfo = timers.find((timer) => timer.id === _id);

  const arrangement = arrangements[selectedArrangement];

  const slides = useMemo(() => {
    const _slides = arrangement?.slides || __slides || [];
    return isLoading ? [] : _slides;
  }, [isLoading, __slides, arrangement?.slides]);

  const videoBackgroundMedia = useMemo(
    () => getSlideVideoBackgroundMedia(slides[selectedSlide]),
    [slides, selectedSlide],
  );
  const videoBackgroundMediaKey = useMemo(
    () => getVideoBackgroundMediaKey(videoBackgroundMedia),
    [videoBackgroundMedia],
  );
  const videoBackgroundSendMode = getSlideVideoBackgroundSendMode(
    slides[selectedSlide],
  );

  const {
    slidesPerRow,
    slidesPerRowMobile,
    shouldShowStreamFormat,
    shouldShowItemEditor,
    monitorSettings: churchMonitorSettings,
  } = useSelector((state: RootState) => state.undoable.present.preferences);

  const { isMobile } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};
  const showToast = useContext(ToastContext)?.showToast;

  const canEdit =
    access === "full" ||
    (access === "music" && (type === "song" || type === "free"));
  const isMusic = useMemo(() => access === "music", [access]);
  // Send-time setting: it shapes the payload before it goes out, so prepare the
  // band when any monitor display wants it and let each screen decide whether to
  // render it.
  const displayOutputs = useSelector(selectDisplayOutputs);
  const monitorShowNextSlide = useMemo(() => {
    return displayOutputs
      .filter((output) => output.enabled && output.type === "monitor")
      .some((output) =>
        shouldSendNextSlideForOutput(
          resolveOutputDefaults(output.settings, churchMonitorSettings),
        ),
      );
  }, [churchMonitorSettings, displayOutputs]);
  // Targeting resolves against the controller this grid is being operated from,
  // so an auxiliary controller can only ever reach its own displays.
  const controllerProfile = useActiveControllerProfile();
  const sendTargets = useMemo(
    () => ({
      projector: getSendTargetIdsForType(
        shouldSendTo,
        displayOutputs,
        "projector",
        controllerProfile,
      ),
      monitor: getSendTargetIdsForType(
        shouldSendTo,
        displayOutputs,
        "monitor",
        controllerProfile,
      ),
      stream: getSendTargetIdsForType(
        shouldSendTo,
        displayOutputs,
        "stream",
        controllerProfile,
      ),
    }),
    [displayOutputs, shouldSendTo, controllerProfile],
  );
  const sendsToProjector = shouldSendToType(
    shouldSendTo,
    displayOutputs,
    "projector",
    controllerProfile,
  );
  const sendsToMonitor = shouldSendToType(
    shouldSendTo,
    displayOutputs,
    "monitor",
    controllerProfile,
  );
  const sendsToStream = shouldSendToType(
    shouldSendTo,
    displayOutputs,
    "stream",
    controllerProfile,
  );

  const shouldPrepareFreeMonitorSlides =
    type === "free" && sendsToMonitor && monitorShowNextSlide;

  const monitorReadySlides = useMemo(() => {
    return shouldPrepareFreeMonitorSlides
      ? ensureSlidesHaveMonitorBandFormatting(slides)
      : slides;
  }, [slides, shouldPrepareFreeMonitorSlides]);

  /**
   * Slide ids currently on outputs for this item (last pushed payload per
   * surface).
   *
   * Reads the displays this item actually targets rather than the three
   * built-ins, so an operator driving only a second projector still sees which
   * slide is live.
   */
  const liveSlideIds = useMemo(() => {
    const ids = new Set<string>();
    const addLiveSlides = (
      outputIds: string[],
      accept?: (info: PresentationType) => boolean,
    ) => {
      for (const outputId of outputIds) {
        const info = outputSlots[outputId]?.info;
        if (!info?.slide?.id) continue;
        if (accept && !accept(info)) continue;
        ids.add(info.slide.id);
      }
    };

    if (sendsToProjector) addLiveSlides(sendTargets.projector);
    if (sendsToMonitor) {
      // A monitor showing a different item must not light up this item's slide.
      addLiveSlides(
        sendTargets.monitor,
        (info) => !info.itemId || info.itemId === _id,
      );
    }
    if (sendsToStream && type !== "bible" && type !== "free") {
      addLiveSlides(sendTargets.stream);
    }
    return ids;
  }, [
    _id,
    outputSlots,
    sendTargets,
    sendsToProjector,
    sendsToMonitor,
    sendsToStream,
    type,
  ]);

  const liveVideoSyncOutputIds = useMemo(() => {
    const selectedId = slides[selectedSlide]?.id;
    if (!selectedId || !liveSlideIds.has(selectedId) || !videoBackgroundMediaKey) {
      return [];
    }
    const ids: string[] = [];
    const collect = (
      outputIds: string[],
      accept?: (info: PresentationType) => boolean,
    ) => {
      for (const outputId of outputIds) {
        const slot = outputSlots[outputId];
        if (!slot?.isTransmitting || slot.info.slide?.id !== selectedId) continue;
        if (accept && !accept(slot.info)) continue;
        const slideKey = getVideoBackgroundMediaKey(
          getSlideVideoBackgroundMedia(slot.info.slide),
        );
        if (slideKey !== videoBackgroundMediaKey) continue;
        ids.push(outputId);
      }
    };
    if (sendsToProjector) collect(sendTargets.projector);
    if (sendsToMonitor) {
      collect(
        sendTargets.monitor,
        (info) => !info.itemId || info.itemId === _id,
      );
    }
    if (sendsToStream && type !== "bible" && type !== "free") {
      collect(sendTargets.stream);
    }
    return ids;
  }, [
    _id,
    liveSlideIds,
    outputSlots,
    selectedSlide,
    sendTargets,
    sendsToMonitor,
    sendsToProjector,
    sendsToStream,
    slides,
    type,
    videoBackgroundMediaKey,
  ]);

  const isCollapsedContinuous = shouldShowItemEditor === false;
  const _size = isMobile ? slidesPerRowMobile : slidesPerRow;
  const isTimerLike = type === "timer" || type === "service-time";
  const size = isTimerLike ? Math.min(_size, 3) : _size;

  const slidesGridColsMin = 1;
  const slidesGridColsMax = isTimerLike ? 3 : 7;
  /** Slider is inverted so moving right = zoom in (fewer columns, larger thumbnails). */
  const slideZoomSliderValue = slidesGridColsMax + slidesGridColsMin - size;

  const sizeConfig: SizeConfig = useMemo(() => {
    const configs: Record<number, SizeConfig> = {
      7: {
        cols: "grid-cols-7",
        hSize: "text-xs",
        borderWidth: "clamp(0.2rem, 0.2vw, 0.4rem)",
      },
      6: {
        cols: "grid-cols-6",
        hSize: isMusic ? "text-sm" : "text-xs",
        borderWidth: "clamp(0.25rem, 0.25vw, 0.5rem)",
      },
      5: {
        cols: "grid-cols-5",
        hSize: isMusic ? "text-sm" : "text-xs",
        borderWidth: "clamp(0.25rem, 0.25vw, 0.5rem)",
      },
      4: {
        cols: "grid-cols-4",
        hSize: "text-sm",
        borderWidth: "clamp(0.25rem, 0.25vw, 0.5rem)",
      },
      3: {
        cols: "grid-cols-3",
        hSize: "text-base",
        borderWidth: "clamp(0.3rem, 0.35vw, 0.7rem)",
      },
      2: {
        cols: "grid-cols-2",
        hSize: "text-base",
        borderWidth: "clamp(0.35rem, 0.45vw, 0.9rem)",
      },
      1: {
        cols: "grid-cols-1",
        hSize: "text-base",
        borderWidth: "clamp(0.4rem, 0.5vw, 1rem)",
      },
    };
    return configs[size] || configs[7];
  }, [size, isMusic]);

  const slidesListClassName = useMemo(
    () =>
      cn(
        "scrollbar-variable max-h-full px-2 overflow-y-auto grid pb-2 focus-visible:outline-none",
        sizeConfig.cols,
      ),
    [sizeConfig.cols],
  );

  const debounceTime = useRef(0);

  const dispatch = useDispatch();
  const location = useLocation();
  const setSlideGridSize = useCallback(
    (nextSize: number) => {
      const clampedSize = Math.min(
        slidesGridColsMax,
        Math.max(slidesGridColsMin, nextSize),
      );
      if (isMobile) {
        dispatch(setSlidesMobile(clampedSize));
      } else {
        dispatch(setSlides(clampedSize));
      }
    },
    [dispatch, isMobile, slidesGridColsMax, slidesGridColsMin],
  );

  /** Latest selected slide; read in selectSlide before dispatch so transitionDirection uses the prior index. */
  const selectedSlideRef = useRef(selectedSlide);
  selectedSlideRef.current = selectedSlide;

  /** After a touch long-press, ignore the synthetic click so it does not toggle selection off. */
  const skipNextSlideGridClickRef = useRef(false);
  /** Ignore duplicate enter for the same slide when long-press and context-menu handling both fire. */
  const lastEnterSameSlideAtRef = useRef<{ index: number; t: number } | null>(
    null,
  );

  const [debouncedSlides, setDebouncedSlides] = useState(slides);
  const [draggedSection, setDraggedSection] = useState<string | null>(null);

  const hasSlides = slides.length > 0;
  /** Avoid one paint with an empty list after load: debounced state clears while loading and syncs in an effect. */
  const slidesToRender =
    hasSlides && debouncedSlides.length === 0 ? slides : debouncedSlides;

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSlides(slides);
    }, debounceTime.current);

    return () => clearTimeout(timeout);
  }, [slides]);

  const getBibleInfo = useCallback(
    (index: number) => {
      const slide = slides[index];

      if (!slide) return { title: "", text: "" };

      const titleSlideText = slides[0].boxes[1]?.words?.trim();
      const slideText = slide.boxes[1]?.words?.trim();

      const title = (slideText ? titleSlideText : "") || "";
      const text = index > 0 ? slideText || "" : "";
      return { title, text };
    },
    [slides],
  );

  const selectSlide = useCallback(
    (
      index: number,
      options?: { preserveBackgroundTargetRangeAnchor?: boolean },
    ) => {
      if (!options?.preserveBackgroundTargetRangeAnchor) {
        dispatch(setBackgroundTargetRangeAnchorId(slides[index]?.id ?? null));
      }
      const prevSelected = selectedSlideRef.current;
      dispatch(setSelectedSlide(index));
      const slide = slides[index];

      if (slide?.mediaSource?.kind === "local-video-input") {
        const localVideoInput = buildLocalVideoInputPresentation(
          slide.mediaSource,
          getOrCreateDeviceId(),
          getTrustedDeviceLabel(),
        );
        if (!localVideoInput) {
          showToast?.(
            isDesktopCaptureKind(slide.mediaSource.captureKind)
              ? `Share ${slide.mediaSource.label} again on this computer, then try again.`
              : `Relink ${slide.mediaSource.label} on this computer, then try again.`,
            "warning",
          );
          return;
        }
        const presentation = {
          slide,
          type: "local-video-input",
          name,
          slideIndex: index,
          slideCount: slides.length,
          localVideoInput,
        };
        const sendPresentation = () => {
          if (sendsToProjector) {
            dispatch(
              updateProjector(
                withVideoPlayback({
                  ...presentation,
                  outputIds: sendTargets.projector,
                }, outputSlots),
              ),
            );
          }
          if (sendsToMonitor) {
            dispatch(
              updateMonitor(
                withVideoPlayback({
                  ...presentation,
                  outputIds: sendTargets.monitor,
                  itemId: _id,
                  transitionDirection: "jump",
                }, outputSlots),
              ),
            );
          }
          if (sendsToStream) {
            dispatch(
              updateStream(
                withVideoPlayback({
                  ...presentation,
                  outputIds: sendTargets.stream,
                }, outputSlots),
              ),
            );
          }
        };
        const localVideoSourceId = slide.mediaSource.sourceId;
        const binding = resolveLocalVideoInputBinding(localVideoSourceId);
        if (!binding) return;
        const transmitConsumerId = `slide-transmit:${localVideoSourceId}:${generateRandomId()}`;
        const releaseTransmitCapture = () => {
          window.setTimeout(() => {
            void releaseWarmLocalVideoCapture(
              localVideoSourceId,
              transmitConsumerId,
            );
          }, LOCAL_VIDEO_TRANSMIT_HANDOFF_MS);
        };
        void acquireWarmLocalVideoCapture(
          localVideoSourceId,
          binding,
          true,
          transmitConsumerId,
        )
          .then(() => {
            try {
              sendPresentation();
            } finally {
              releaseTransmitCapture();
            }
          })
          .catch(async (error: unknown) => {
            await releaseWarmLocalVideoCapture(
              localVideoSourceId,
              transmitConsumerId,
            );
            if (error instanceof LocalVideoCaptureOwnedError) {
              sendPresentation();
              return;
            }
            showToast?.(
              getLocalVideoSourceErrorMessage(
                error,
                slide.mediaSource?.captureKind,
              ),
              "warning",
            );
          });
        return;
      }

      if (sendsToStream) {
        if (type === "bible") {
          const { title, text } = getBibleInfo(index);
          dispatch(
            updateBibleDisplayInfo({
              outputIds: sendTargets.stream,
              title,
              text,
            }),
          );
        } else {
          dispatch(
            updateBibleDisplayInfo({
              title: "",
              text: "",
              outputIds: sendTargets.stream,
            }),
          );
        }

        if (type === "free") {
          dispatch(
            updateFormattedTextDisplayInfo({
              outputIds: sendTargets.stream,
              text: slide.boxes[1]?.words || "",
              backgroundColor:
                slide.formattedTextDisplayInfo?.backgroundColor || "#eb8934",
              textColor: slide.formattedTextDisplayInfo?.textColor || "#ffffff",
              fontSize: slide.formattedTextDisplayInfo?.fontSize || 1.5,
              paddingX: slide.formattedTextDisplayInfo?.paddingX || 2,
              paddingY: slide.formattedTextDisplayInfo?.paddingY || 1,
              isBold: slide.formattedTextDisplayInfo?.isBold || false,
              isItalic: slide.formattedTextDisplayInfo?.isItalic || false,
              align: slide.formattedTextDisplayInfo?.align || "left",
            }),
          );
        } else {
          dispatch(
            updateFormattedTextDisplayInfo({
              outputIds: sendTargets.stream,
              text: "",
            }),
          );
        }

        if (type !== "free" && type !== "bible") {
          dispatch(
            updateStream(
              withVideoPlayback({
                outputIds: sendTargets.stream,
                slide,
                type,
                name,
                timerId: timerInfo?.id,
                slideIndex: index,
                slideCount: slides.length,
              }, outputSlots),
            ),
          );
        }
      }

      if (sendsToProjector) {
        dispatch(
          updateProjector(
            withVideoPlayback({
              outputIds: sendTargets.projector,
              slide,
              type,
              name,
              timerId: timerInfo?.id,
              slideIndex: index,
              slideCount: slides.length,
            }, outputSlots),
          ),
        );
      }

      if (type === "timer") {
        dispatch(setMonitorTimerId(timerInfo?.id || null));
      } else if (type === "service-time") {
        dispatch(setMonitorTimerId(null));
      }

      if (sendsToMonitor) {
        let transitionDirection: "next" | "prev" | "jump";
        if (index === prevSelected + 1) transitionDirection = "next";
        else if (index === prevSelected - 1) transitionDirection = "prev";
        else transitionDirection = "jump";
        const monitorSlide = monitorReadySlides[index] ?? slide;
        const canShowNextSlide =
          (type === "song" || type === "bible" || type === "free") &&
          monitorShowNextSlide &&
          index + 1 < slides.length &&
          (slide?.boxes ?? []).every((box, i) => i === 0 || box.height <= 55);
        const nextSlideSlide = canShowNextSlide
          ? (monitorReadySlides[index + 1] ?? slides[index + 1])
          : null;
        const nextSlideForMonitor = nextSlideSlide
          ? {
            ...nextSlideSlide,
            boxes:
              nextSlideSlide.monitorNextBandBoxes ?? nextSlideSlide.boxes,
          }
          : undefined;
        // Only use band-formatted boxes when using next-slide layout; single-slide uses DisplayBox at 1080p
        const slideForMonitor = {
          ...monitorSlide,
          boxes:
            nextSlideForMonitor != null
              ? (monitorSlide.monitorCurrentBandBoxes ?? monitorSlide.boxes)
              : monitorSlide.boxes,
        };
        dispatch(
          updateMonitor(
            withVideoPlayback({
              outputIds: sendTargets.monitor,
              slide: slideForMonitor,
              type,
              name,
              timerId: timerInfo?.id,
              itemId: _id,
              slideIndex: index,
              slideCount: slides.length,
              nextSlide: nextSlideForMonitor,
              transitionDirection,
              bibleInfoBox:
                type === "bible" && nextSlideForMonitor
                  ? (slide.boxes?.[2] ?? null)
                  : undefined,
            }, outputSlots),
          ),
        );
      }
    },
    [
      dispatch,
      sendsToStream,
      sendsToProjector,
      sendsToMonitor,
      sendTargets.projector,
      sendTargets.monitor,
      sendTargets.stream,
      monitorShowNextSlide,
      type,
      name,
      timerInfo?.id,
      getBibleInfo,
      slides,
      _id,
      monitorReadySlides,
      outputSlots,
      showToast,
    ],
  );

  const enterBackgroundTargetSelectModeFromSlide = useCallback(
    (index: number, options?: { skipNextClick?: boolean }) => {
      const pressedId = slides[index]?.id;
      if (!pressedId || !canEdit) return;

      const now = Date.now();
      const last = lastEnterSameSlideAtRef.current;
      if (last && last.index === index && now - last.t < 400) return;
      lastEnterSameSlideAtRef.current = { index, t: now };

      const currentSelectedIndex = selectedSlideRef.current;
      const selectedId = slides[currentSelectedIndex]?.id;

      const ids =
        index !== currentSelectedIndex && selectedId
          ? [selectedId, pressedId]
          : [pressedId];

      dispatch(setBackgroundTargetSlideIds([...new Set(ids)]));
      dispatch(setBackgroundTargetRangeAnchorId(pressedId));
      dispatch(setMobileBackgroundTargetSelectMode(true));
      if (options?.skipNextClick) {
        skipNextSlideGridClickRef.current = true;
      }
      selectSlide(index);
    },
    [slides, canEdit, dispatch, selectSlide],
  );

  const slideActionTargetIds = useMemo(
    () =>
      resolveSlideActionTargetIds(
        backgroundTargetSlideIdsRaw,
        slides,
        selectedSlide,
      ),
    [backgroundTargetSlideIdsRaw, selectedSlide, slides],
  );

  const cannotDeleteTargetSlides = useMemo(() => {
    if (type !== "free") return true;
    if (slideActionTargetIds.length === 0) return true;
    const idSet = new Set(slideActionTargetIds);
    return slides.filter((s) => !idSet.has(s.id)).length < 1;
  }, [slideActionTargetIds, slides, type]);

  const onSlideGridClick = useCallback(
    (e: React.MouseEvent, index: number) => {
      if (skipNextSlideGridClickRef.current) {
        skipNextSlideGridClickRef.current = false;
        e.preventDefault();
        return;
      }
      if (!canEdit) {
        selectSlide(index);
        return;
      }
      // Modifier order matches `useMediaSelection`: Shift (range) before touch-toggle and Ctrl/Cmd.
      if (e.shiftKey) {
        e.preventDefault();
        const resolvedAnchorId =
          backgroundTargetRangeAnchorId ?? slides[selectedSlide]?.id ?? null;
        if (!backgroundTargetRangeAnchorId && resolvedAnchorId) {
          dispatch(setBackgroundTargetRangeAnchorId(resolvedAnchorId));
        }
        const indices = inclusiveRangeIndicesFromAnchor(
          slides,
          resolvedAnchorId,
          index,
          selectedSlide,
        );
        dispatch(
          setBackgroundTargetSlideIds(
            indices.map((i) => slides[i]?.id).filter(Boolean) as string[],
          ),
        );
        selectSlide(index, { preserveBackgroundTargetRangeAnchor: true });
        return;
      }
      if (mobileBackgroundTargetSelectMode) {
        e.preventDefault();
        const id = slides[index]?.id;
        if (id) dispatch(toggleBackgroundTargetSlideId(id));
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const id = slides[index]?.id;
        if (id) {
          dispatch(toggleBackgroundTargetSlideId(id));
          selectSlide(index, { preserveBackgroundTargetRangeAnchor: true });
        }
        return;
      }
      // Plain click: focus one slide and drop background subset selection.
      if (backgroundTargetSlideIds.length > 0) {
        dispatch(clearBackgroundTargetSelection());
      }
      selectSlide(index);
    },
    [
      canEdit,
      mobileBackgroundTargetSelectMode,
      slides,
      backgroundTargetRangeAnchorId,
      selectedSlide,
      backgroundTargetSlideIds.length,
      dispatch,
      selectSlide,
    ],
  );

  const advanceSlide = useCallback(() => {
    const nextSlide = Math.min(selectedSlide + 1, slides.length - 1);
    selectSlide(nextSlide);
  }, [selectedSlide, slides, selectSlide]);

  const previousSlide = useCallback(() => {
    const nextSlide = Math.max(selectedSlide - 1, 0);
    selectSlide(nextSlide);
  }, [selectedSlide, selectSlide]);

  // Advance to wrap-up when this timer auto-expires (running → stopped with
  // endTime in the past). Remaining time is already restored to duration by
  // tickTimers; do not key off remainingTime === 0 or manual Stop would also
  // jump here after an early stop resets duration.
  const prevTimerForExpireRef = useRef(timerInfo);
  useEffect(() => {
    const previous = prevTimerForExpireRef.current;
    prevTimerForExpireRef.current = timerInfo;
    if (
      type === "timer" &&
      didTimerJustExpire(previous, timerInfo) &&
      slides.length > 1 &&
      selectedSlide === 0
    ) {
      selectSlide(1);
    }
  }, [type, timerInfo, slides.length, selectedSlide, selectSlide]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (!location.pathname.includes("item") || isEditMode || isTyping) return;
      if (e.key === " ") {
        e.preventDefault();
        advanceSlide();
      }
      if (e.key === " " && e.shiftKey) {
        e.preventDefault();
        previousSlide();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [advanceSlide, previousSlide, isEditMode, location.pathname]);

  useEffect(() => {
    let timeout: NodeJS.Timeout | null = null;

    if (isLoading) {
      if (timeout) {
        clearTimeout(timeout);
      }
      setDebouncedSlides([]);
      debounceTime.current = 0;
    } else {
      timeout = setTimeout(() => {
        debounceTime.current = 150;
      }, 250);
    }

    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [isLoading]);

  const sensors = useSensors();

  const { setNodeRef } = useDroppable({
    id: "item-slides-list",
  });
  const slidesScrollRef = useRef<HTMLElement | null>(null);
  const setSlidesContainerRef = useCallback(
    (node: HTMLElement | null) => {
      setNodeRef(node);
      slidesScrollRef.current = node;
    },
    [setNodeRef],
  );

  useEffect(() => {
    if (isMobile) {
      dispatch(setSlidesMobile(slidesPerRowMobile));
    } else {
      dispatch(setSlides(slidesPerRow));
    }
    // Only run if isMobile change
    // eslint-disable-next-line
  }, [isMobile, dispatch]);

  useEffect(() => {
    if (isCollapsedContinuous) return;
    const parentElement = document.getElementById("item-slides-container");
    if (!parentElement) return;
    const runScroll = () => {
      const slideElement = document.getElementById(
        `item-slide-${selectedSlide}`,
      );
      if (slideElement && parentElement) {
        keepElementInView({
          child: slideElement,
          parent: parentElement,
          shouldScrollToCenter: true,
        });
      }
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(runScroll);
    });
  }, [selectedSlide, isMobile, slidesToRender.length, isCollapsedContinuous]);

  const addSlide = useCallback(() => {
    // Find the highest section number among existing slides
    const sectionNumbers = slides
      .map((slide) => {
        const match = slide.name.match(/Section (\d+)/);
        return match ? parseInt(match[1]) : null;
      })
      .filter((n) => n !== null) as number[];
    const maxSection =
      sectionNumbers.length > 0 ? Math.max(...sectionNumbers) : 0;
    const newSectionNum = maxSection + 1;
    const slide = createNewSlide({
      type: "Section",
      fontSize: DEFAULT_FONT_PX,
      words: [""],
      name: `Section ${newSectionNum}`,
      overflow: "separate",
    });
    dispatch(addSlideAction({ slide }));
  }, [dispatch, slides]);

  const copySlide = useCallback(() => {
    if (selectedSlide === -1 || !slides[selectedSlide]) return;

    if (
      slides[selectedSlide].type === "Media" ||
      slides[selectedSlide].mediaSource?.kind === "local-video-input"
    ) {
      dispatch(
        addSlideAction({
          slide: {
            ...slides[selectedSlide],
            id: generateRandomId(),
          },
        }),
      );
      return;
    }

    // Find the highest section number among existing slides
    const sectionNumbers = slides
      .map((slide) => {
        const match = slide.name.match(/Section (\d+)/);
        return match ? parseInt(match[1]) : null;
      })
      .filter((n) => n !== null) as number[];
    const maxSection =
      sectionNumbers.length > 0 ? Math.max(...sectionNumbers) : 0;
    const newSectionNum = maxSection + 1;

    const slideToCopy = slides[selectedSlide];
    const newSlide = {
      ...slideToCopy,
      id: generateRandomId(), // Generate a temporary ID
      name: `Section ${newSectionNum}`,
    };

    dispatch(addSlideAction({ slide: newSlide }));
  }, [dispatch, selectedSlide, slides]);

  const handleClearTargetBackgrounds = useCallback(() => {
    if (slideActionTargetIds.length === 0) return;
    dispatch(
      clearSlideBackgroundsOnSubset({
        slideIds: [...slideActionTargetIds],
      }),
    );
  }, [dispatch, slideActionTargetIds]);

  const handleDeleteTargetSlides = useCallback(() => {
    if (slideActionTargetIds.length === 0) return;
    dispatch(
      removeSlidesByIds({
        slideIds: [...slideActionTargetIds],
      }),
    );
  }, [dispatch, slideActionTargetIds]);

  const handleSelectionDone = useCallback(() => {
    dispatch(clearBackgroundTargetSelection());
  }, [dispatch]);

  const actionBarItemDefs = useMemo((): ActionBarItemDef[] => {
    if (!canEdit) return [];

    const items: ActionBarItemDef[] = [];
    const isFree = type === "free";
    const targetCount = slideActionTargetIds.length;

    if (!showBackgroundTargetActionBar && isFree) {
      items.push(
        slideToolbarButton({
          id: "add",
          label: "Add",
          icon: slideToolbarIcon(Plus),
          onClick: addSlide,
        }),
        slideToolbarButton({
          id: "copy",
          label: "Copy",
          icon: slideToolbarIcon(Copy),
          onClick: copySlide,
        }),
      );
    }

    if (hasSlides) {
      items.push(
        slideToolbarButton({
          id: "clear-background",
          label: "Clear background",
          icon: slideToolbarIcon(ImageOff),
          onClick: handleClearTargetBackgrounds,
          disabled: targetCount === 0,
        }),
      );
      if (isFree) {
        const deleteLabel =
          targetCount > 1 ? `Delete (${targetCount})` : "Delete";
        let deleteTitle = "Delete this slide";
        if (cannotDeleteTargetSlides) {
          deleteTitle = "Keep at least one slide in the item";
        } else if (targetCount > 1) {
          deleteTitle = "Delete selected slides";
        }
        items.push(
          slideToolbarButton({
            id: "delete",
            label: deleteLabel,
            icon: slideToolbarIcon(Trash2, "text-red-400"),
            onClick: handleDeleteTargetSlides,
            disabled: cannotDeleteTargetSlides,
            destructive: true,
            title: deleteTitle,
          }),
        );
      }
    }

    if (showBackgroundTargetActionBar) {
      items.push(
        slideToolbarButton({
          id: "done",
          label: "Done",
          onClick: handleSelectionDone,
        }),
      );
    }

    return items;
  }, [
    addSlide,
    canEdit,
    cannotDeleteTargetSlides,
    copySlide,
    handleClearTargetBackgrounds,
    handleDeleteTargetSlides,
    handleSelectionDone,
    hasSlides,
    showBackgroundTargetActionBar,
    slideActionTargetIds.length,
    type,
  ]);

  const onDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const draggedSlide = slides.find((slide) => slide.id === active.id);
    if (draggedSlide) {
      const sectionMatch = draggedSlide.name.match(/Section (\d+)/);
      if (sectionMatch) {
        setDraggedSection(sectionMatch[1]);
      }
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDraggedSection(null);
    const { over, active } = event;
    if (!over || !active) return;

    const { id: overId } = over;
    const { id: activeId } = active;
    const updatedSlides = [...slides];

    // Find the dragged slide and its section
    const draggedSlide = slides.find((slide) => slide.id === activeId);
    if (!draggedSlide) return;

    // Extract section number from the dragged slide's name
    const sectionMatch = draggedSlide.name.match(/Section (\d+)/);
    if (!sectionMatch) return;
    const sectionNum = sectionMatch[1];

    // Find all slides in the same section
    const sectionSlides = slides.filter((slide) =>
      slide.name.includes(`Section ${sectionNum}`),
    );

    // Find the target position
    const targetSlide = slides.find((slide) => slide.id === overId);
    if (!targetSlide) return;

    // Get the target index
    const targetIndex = slides.findIndex((slide) => slide.id === overId);

    // Check if target position is within another section
    const targetSectionMatch = targetSlide.name.match(/Section (\d+)/);
    if (targetSectionMatch) {
      const targetSectionNum = targetSectionMatch[1];
      if (targetSectionNum !== sectionNum) {
        // Find the boundaries of the target section
        const targetSectionStart = slides.findIndex((slide) =>
          slide.name.includes(`Section ${targetSectionNum}`),
        );
        const targetSectionEnd = slides.findIndex(
          (slide, index) =>
            index > targetSectionStart &&
            !slide.name.includes(`Section ${targetSectionNum}`),
        );

        // If target is within another section, adjust the target index to be before or after that section
        if (
          targetIndex > targetSectionStart &&
          targetIndex < targetSectionEnd
        ) {
          // If we're closer to the start of the target section, place before it
          if (
            targetIndex - targetSectionStart <
            targetSectionEnd - targetIndex
          ) {
            return; // Don't allow dropping in the middle of another section
          } else {
            return; // Don't allow dropping in the middle of another section
          }
        }
      }
    }

    // Get the indices of the first and last slides in the section
    const firstSectionIndex = slides.findIndex((slide) =>
      slide.name.includes(`Section ${sectionNum}`),
    );

    // Remove all slides in the section
    updatedSlides.splice(firstSectionIndex, sectionSlides.length);

    // Insert the section slides at the target position
    updatedSlides.splice(targetIndex, 0, ...sectionSlides);

    setDebouncedSlides(updatedSlides);
    dispatch(updateSlides({ slides: updatedSlides }));
  };

  return (
    <ErrorBoundary>
      <DndContext
        sensors={sensors}
        onDragEnd={canEdit ? onDragEnd : undefined}
        onDragStart={canEdit ? onDragStart : undefined}
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-homepage-canvas">
          <div className="mb-2 flex w-full shrink-0 flex-col border-b border-white/20 bg-black/60">
            {videoBackgroundMedia && videoBackgroundMediaKey ? (
              <div className="px-2 pt-1">
                <VideoBackgroundControls
                  media={videoBackgroundMedia}
                  mediaKey={videoBackgroundMediaKey}
                  syncOutputIds={liveVideoSyncOutputIds}
                  sendMode={videoBackgroundSendMode}
                  onSendModeChange={(mode) =>
                    dispatch(updateSlideVideoBackgroundSendMode({ mode }))
                  }
                />
              </div>
            ) : null}
            <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1">
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="tertiary"
                  className="min-h-0 h-7 w-7 justify-center p-0"
                  svg={ZoomOut}
                  title="Zoom out"
                  aria-label="Zoom out slide thumbnails"
                  disabled={size >= slidesGridColsMax}
                  onClick={() => setSlideGridSize(size + 1)}
                />
                <div className="w-36 shrink-0">
                  <Slider
                    className="w-full"
                    value={[slideZoomSliderValue]}
                    min={slidesGridColsMin}
                    max={slidesGridColsMax}
                    step={1}
                    onValueChange={(v: number[]) => {
                      const raw = v[0];
                      if (raw == null) return;
                      setSlideGridSize(
                        slidesGridColsMax + slidesGridColsMin - raw,
                      );
                    }}
                    aria-label="Slide thumbnail zoom"
                  />
                </div>
                <Button
                  variant="tertiary"
                  className="min-h-0 h-7 w-7 justify-center p-0"
                  svg={ZoomIn}
                  title="Zoom in"
                  aria-label="Zoom in slide thumbnails"
                  disabled={size <= slidesGridColsMin}
                  onClick={() => setSlideGridSize(size - 1)}
                />
              </div>
              {canEdit && showBackgroundTargetActionBar && (
                <div
                  className="flex shrink-0 items-baseline gap-1 whitespace-nowrap text-xs"
                  aria-live="polite"
                  aria-label={
                    backgroundTargetSlideIds.length === 1
                      ? "1 slide selected"
                      : `${backgroundTargetSlideIds.length} slides selected`
                  }
                >
                  <span className="font-semibold tabular-nums text-cyan-400">
                    {backgroundTargetSlideIds.length}
                  </span>
                  <span className="text-gray-400">
                    {backgroundTargetSlideIds.length === 1
                      ? "slide selected"
                      : "slides selected"}
                  </span>
                </div>
              )}
              {actionBarItemDefs.length > 0 && (
                <ActionBar
                  items={actionBarItemDefs}
                  className="min-w-0 flex-1 justify-end"
                  overflowMenuClassName="min-w-48"
                />
              )}
            </div>
          </div>
          {isLoading ? (
            <ItemSlidesSkeleton
              className={slidesListClassName}
              placeholderCount={Math.min(size * 2, 16)}
            />
          ) : isCollapsedContinuous ? (
            <div
              ref={setSlidesContainerRef}
              tabIndex={0}
              id="item-slides-container"
              className="scrollbar-variable max-h-full min-h-0 flex-1 overflow-y-auto px-2 pb-2 focus-visible:outline-none"
            >
              <OutlineItemSlidesScroller
                scrollRef={slidesScrollRef}
                cols={size}
                size={size}
                sizeConfig={sizeConfig}
                isMobile={isMobile || false}
                isStreamFormat={shouldShowStreamFormat}
                canEdit={canEdit}
                selectedSlide={selectedSlide}
                liveSlideIds={liveSlideIds}
                backgroundTargetSlideIds={backgroundTargetSlideIds}
                draggedSection={draggedSection}
                timers={timers}
                selectSlide={selectSlide}
                onSlideGridClick={onSlideGridClick}
                onEnterBackgroundTargetSelectMode={
                  canEdit && hasSlides
                    ? enterBackgroundTargetSelectModeFromSlide
                    : undefined
                }
              />
            </div>
          ) : hasSlides ? (
            <ul
              ref={setSlidesContainerRef}
              tabIndex={0}
              id="item-slides-container"
              className={slidesListClassName}
            >
              <SortableContext
                items={slides.map((slide) => slide.id || "")}
                strategy={rectSortingStrategy}
              >
                {slidesToRender.map((slide, index) => (
                  <ItemSlide
                    timerInfo={timerInfo}
                    key={slide.id}
                    slide={slide}
                    index={index}
                    selectSlide={selectSlide}
                    isSelected={index === selectedSlide}
                    isLive={liveSlideIds.has(slide.id)}
                    size={size}
                    itemType={type}
                    isMobile={isMobile || false}
                    draggedSection={draggedSection}
                    isStreamFormat={shouldShowStreamFormat}
                    getBibleInfo={getBibleInfo}
                    borderWidth={sizeConfig.borderWidth}
                    hSize={sizeConfig.hSize}
                    canEdit={canEdit}
                    isBackgroundTargetSelected={backgroundTargetSlideIds.includes(
                      slide.id,
                    )}
                    onSlideGridClick={onSlideGridClick}
                    onEnterBackgroundTargetSelectMode={
                      canEdit && hasSlides
                        ? enterBackgroundTargetSelectModeFromSlide
                        : undefined
                    }
                  />
                ))}
              </SortableContext>
            </ul>
          ) : (
            <div className="flex w-full items-center justify-center h-6 mb-2 gap-1 shrink-0">
              <p className="text-gray-300">No slides for selected item</p>
            </div>
          )}
        </div>
      </DndContext>
    </ErrorBoundary>
  );
};

export default ItemSlides;
