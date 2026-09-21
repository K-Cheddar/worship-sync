import { ImageOff, Plus, Trash2, Copy, ZoomIn, ZoomOut } from "lucide-react";
import ActionBar, {
  type ActionBarItem as ActionBarItemDef,
} from "../../components/ActionBar/ActionBar";
import Button from "../../components/Button/Button";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import {
  clearBackgroundTargetSelection,
  clearSlideBackgroundsOnSubset,
  removeSlidesByIds,
  setActiveItem,
  setBackgroundTargetSlideIds,
  setBackgroundTargetRangeAnchorId,
  setMobileBackgroundTargetSelectMode,
  setSelectedSlide,
  toggleBackgroundTargetSlideId,
  updateSlides,
  updateSlideVideoBackgroundSendMode,
} from "../../store/itemSlice";
import {
  MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS,
  MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
} from "../Media/mediaLibraryMediaActionUi";
import {
  setSlides,
  setSlidesMobile,
  setMonitorTimerId,
} from "../../store/preferencesSlice";
import { setActiveItemInList } from "../../store/itemListSlice";
import { useDispatch, useSelector } from "../../hooks";
import {
  selectOutputSlots,
  updateBibleDisplayInfo,
  updateFormattedTextDisplayInfo,
  updateMonitor,
  updateProjector,
  updateStream,
} from "../../store/presentationSlice";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import {
  createNewSlide,
  createSlideFromMedia,
  insertSlidesAt,
} from "../../utils/slideCreation";
import { addSlide as addSlideAction } from "../../store/itemSlice";
import ItemSlide from "./ItemSlide";
import ItemSlidesSkeleton from "./ItemSlidesSkeleton";
import OutlineItemSlidesScroller from "./OutlineItemSlidesScroller";
import {
  DndContext,
  DragOverlay,
  useDndMonitor,
  useDroppable,
  useDndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";

import { useSensors } from "../../utils/dndUtils";

import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import {
  useCallback,
  useContext,
  Fragment,
  createContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import {
  useActiveControllerProfile,
  useControllerBasePath,
} from "../../context/activeController";
import { keepElementInView } from "../../utils/generalUtils";
import { RootState } from "../../store/store";
import generateRandomId from "../../utils/generateRandomId";
import { useLocation, useNavigate } from "react-router-dom";
import { GlobalInfoContext } from "../../context/globalInfo";
import { cn } from "../../utils/cnHelper";
import { updateTimer } from "../../store/timersSlice";
import { DEFAULT_FONT_PX } from "../../constants";
import {
  ensureSlidesHaveMonitorBandFormatting,
  getFormattedSections,
} from "../../utils/overflow";
import { inclusiveRangeIndicesFromAnchor } from "../../utils/backgroundTargetResolution";
import { Slider } from "../../components/ui/Slider";
import {
  getSendTargetIdsForType,
  shouldSendToType,
} from "../../utils/sendTargets";
import {
  resolveOutputDefaults,
  shouldSendNextSlideForOutput,
} from "../../utils/displaySettings";
import {
  ItemSlideType,
  Presentation as PresentationType,
  ShouldSendTo,
} from "../../types";
import { getFreeSectionNumber } from "../../utils/freeSectionNames";
import {
  buildLocalVideoInputPresentation,
  getLocalVideoSourceErrorMessage,
  isDesktopCaptureSourceMissingError,
  isDesktopCaptureKind,
  resolveLocalVideoInputBinding,
} from "../../utils/localVideoInput";
import { mediaHasSendableContent } from "../../utils/localVideoMediaLibrary";
import {
  isMediaDragData,
  isSlideContainerData,
  isSlideDragData,
  isSlideInsertData,
  presentationCollisionDetection,
} from "../../utils/presentationDnd";
import {
  acquireWarmLocalVideoCaptureWithBusyRetry,
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
import { useOutlineItemDocs } from "../../hooks/useOutlineItemDocs";
import {
  getControllerItemPath,
  getNonHeadingOutlineItems,
  prepareItemForEditor,
  resolveSlidesForOutlineItem,
} from "../../utils/outlineSlideSections";
import MediaDragPreview from "../Media/MediaDragPreview";
import { usePresentationControllerMode } from "../../context/presentationControllerMode";
import { useStaticThumbnailScaleFactor } from "./staticThumbnailGeometry";

/** Keep capture warm while the display window takes over the stream. */
const LOCAL_VIDEO_TRANSMIT_HANDOFF_MS = 5_000;

const haveSameSlideOrder = (
  firstSlides: ItemSlideType[],
  secondSlides: ItemSlideType[],
) =>
  firstSlides.length === secondSlides.length &&
  firstSlides.every((slide, index) => slide.id === secondSlides[index]?.id);

/** Preserve the existing custom-item reorder unit: a named section moves as a block. */
const reorderSlidesForDrag = (
  slides: ItemSlideType[],
  activeId: string,
  overId: string,
) => {
  const draggedSlide = slides.find((slide) => slide.id === activeId);
  if (!draggedSlide) return slides;

  const targetSlide = slides.find((slide) => slide.id === overId);
  if (!targetSlide) return slides;

  const getReorderUnit = (slide: ItemSlideType) => {
    const sectionNum = getFreeSectionNumber(slide);
    return sectionNum == null
      ? [slide]
      : slides.filter(
          (candidate) => getFreeSectionNumber(candidate) === sectionNum,
        );
  };
  const draggedUnit = getReorderUnit(draggedSlide);
  const targetUnit = getReorderUnit(targetSlide);
  const draggedIds = new Set(draggedUnit.map((slide) => slide.id));

  // Hovering over another slide in the same reorder unit is a no-op.
  if (targetUnit.some((slide) => draggedIds.has(slide.id))) return slides;

  // The target boundary must be found after removal so movement in either
  // direction uses the same hover semantics and never splits a section.
  const remainingSlides = slides.filter((slide) => !draggedIds.has(slide.id));
  const targetIds = new Set(targetUnit.map((slide) => slide.id));
  let targetStartIndex = -1;
  let targetEndIndex = -1;
  remainingSlides.forEach((slide, index) => {
    if (targetIds.has(slide.id)) {
      if (targetStartIndex < 0) targetStartIndex = index;
      targetEndIndex = index;
    }
  });
  if (targetStartIndex < 0 || targetEndIndex < 0) return slides;

  const draggedStartIndex = slides.findIndex(
    (slide) => slide.id === draggedUnit[0]?.id,
  );
  const targetStartInOriginal = slides.findIndex(
    (slide) => slide.id === targetUnit[0]?.id,
  );
  const insertionIndex =
    draggedStartIndex < targetStartInOriginal
      ? targetEndIndex + 1
      : targetStartIndex;
  const reorderedSlides = [
    ...remainingSlides.slice(0, insertionIndex),
    ...draggedUnit,
    ...remainingSlides.slice(insertionIndex),
  ];
  return haveSameSlideOrder(slides, reorderedSlides)
    ? slides
    : reorderedSlides;
};

type SizeConfig = {
  borderWidth: string;
  hSize: string;
  cols: string;
};

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

export const ItemSlidesDndContext = createContext<"local" | "ancestor">(
  "local",
);

const ItemSlidesContent = () => {
  const { mode } = usePresentationControllerMode();
  const isPresentMode = mode === "present";
  const dndMode = useContext(ItemSlidesDndContext);
  const { active, over } = useDndContext();
  const {
    arrangements,
    selectedArrangement,
    selectedSlide,
    type,
    name,
    slides: __slides,
    isLoading,
    _id,
    listId,
    shouldSendTo,
    formattedSections = [],
    isLyricsEditorOpen,
    backgroundTargetSlideIds: backgroundTargetSlideIdsRaw,
    backgroundTargetRangeAnchorId,
    mobileBackgroundTargetSelectMode: mobileBgSelectModeRaw,
  } = useSelector((state: RootState) => state.undoable.present.item);

  const dispatch = useDispatch();

  const backgroundTargetSlideIds = backgroundTargetSlideIdsRaw ?? [];
  const mobileBackgroundTargetSelectMode = mobileBgSelectModeRaw ?? false;
  /** Multi-select chrome + Done: subset selected or mobile long-press select mode. */
  const isSlideSubsetSelecting =
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

  const renameFreeSection = useCallback(
    (sectionNum: number, name: string) => {
      const nextFormattedSections = formattedSections.length
        ? [...formattedSections]
        : getFormattedSections(slides, 1);
      const sectionIndex = nextFormattedSections.findIndex(
        (section) => section.sectionNum === sectionNum,
      );
      const nextName = name.trim();
      if (sectionIndex >= 0) {
        const section = nextFormattedSections[sectionIndex];
        nextFormattedSections[sectionIndex] = nextName
          ? { ...section, name: nextName }
          : (({ name: _name, ...withoutName }) => withoutName)(section);
      } else {
        const sourceSlide = slides.find(
          (slide) => getFreeSectionNumber(slide) === sectionNum,
        );
        if (!sourceSlide) return;
        nextFormattedSections.push({
          sectionNum,
          name: nextName || undefined,
          words: "",
          slideSpan: slides.filter(
            (slide) => getFreeSectionNumber(slide) === sectionNum,
          ).length,
        });
      }
      dispatch(
        updateSlides({ slides, formattedSections: nextFormattedSections }),
      );
    },
    [dispatch, formattedSections, slides],
  );

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

  const mediaList = useSelector((state: RootState) => state.media.list);

  const { isMobile } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};
  const showToast = useContext(ToastContext)?.showToast;

  const canEdit =
    access === "full" ||
    (access === "music" && (type === "song" || type === "free"));
  const canInsertMedia = dndMode === "ancestor" && type === "free" && canEdit;
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
    if (
      !selectedId ||
      !liveSlideIds.has(selectedId) ||
      !videoBackgroundMediaKey
    ) {
      return [];
    }
    const ids: string[] = [];
    const collect = (
      outputIds: string[],
      accept?: (info: PresentationType) => boolean,
    ) => {
      for (const outputId of outputIds) {
        const slot = outputSlots[outputId];
        if (!slot?.isTransmitting || slot.info.slide?.id !== selectedId)
          continue;
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
  const navigate = useNavigate();
  const controllerBasePath = useControllerBasePath();
  const outlineList = useSelector(
    (state: RootState) => state.undoable.present.itemList?.list,
  );
  const outlineItems = useMemo(
    () => getNonHeadingOutlineItems(outlineList),
    [outlineList],
  );
  const neighborPrefetchIds = useMemo(() => {
    if (!isCollapsedContinuous || !listId) return [] as string[];
    const index = outlineItems.findIndex((item) => item.listId === listId);
    if (index < 0) return [];
    return [outlineItems[index - 1]?._id, outlineItems[index + 1]?._id].filter(
      (id): id is string => Boolean(id),
    );
  }, [isCollapsedContinuous, listId, outlineItems]);
  const neighborDocsById = useOutlineItemDocs(neighborPrefetchIds);
  const pendingOutlineSelectRef = useRef<{
    listId: string;
    index: number;
  } | null>(null);

  const _size = isMobile ? slidesPerRowMobile : slidesPerRow;
  const isTimerLike = type === "timer" || type === "service-time";
  // Timer/service-time items use a tighter zoom range in single-item mode.
  // Continuous mode shows mixed item types, so keep the shared preference stable.
  const applyTimerLikeZoom = isTimerLike && !isCollapsedContinuous;
  const size = applyTimerLikeZoom ? Math.min(_size, 3) : _size;

  const slidesGridColsMin = 1;
  const slidesGridColsMax = applyTimerLikeZoom ? 3 : 7;
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
  const [dragPreviewSlides, setDragPreviewSlides] = useState<
    ItemSlideType[] | null
  >(null);

  const hasSlides = slides.length > 0;
  /** Avoid one paint with an empty list after load: debounced state clears while loading and syncs in an effect. */
  const slidesToRender =
    hasSlides && debouncedSlides.length === 0 ? slides : debouncedSlides;
  const renderedSlides = dragPreviewSlides ?? slidesToRender;

  useEffect(() => {
    if (isCollapsedContinuous) {
      // Continuous mode renders from its own outline document model. Keep the
      // single-item mirror current without scheduling a delayed parent update.
      setDebouncedSlides(slides);
      return;
    }
    const timeout = setTimeout(() => {
      setDebouncedSlides(slides);
    }, debounceTime.current);

    return () => clearTimeout(timeout);
  }, [isCollapsedContinuous, slides]);

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
      options?: {
        preserveBackgroundTargetRangeAnchor?: boolean;
        presentation?: {
          slides: ItemSlideType[];
          type: string;
          name: string;
          itemId: string;
          listId: string;
          timerId?: string;
          shouldSendTo?: ShouldSendTo;
        };
        presentationOnly?: boolean;
      },
    ) => {
      const presentationSlides = options?.presentation?.slides ?? slides;
      const presentationType = options?.presentation?.type ?? type;
      const presentationName = options?.presentation?.name ?? name;
      const presentationItemId = options?.presentation?.itemId ?? _id;
      const presentationListId = options?.presentation?.listId ?? listId;
      const presentationShouldSendTo =
        options?.presentation?.shouldSendTo ?? shouldSendTo;
      const presentationSendTargets = options?.presentation
        ? {
            projector: getSendTargetIdsForType(
              presentationShouldSendTo,
              displayOutputs,
              "projector",
              controllerProfile,
            ),
            monitor: getSendTargetIdsForType(
              presentationShouldSendTo,
              displayOutputs,
              "monitor",
              controllerProfile,
            ),
            stream: getSendTargetIdsForType(
              presentationShouldSendTo,
              displayOutputs,
              "stream",
              controllerProfile,
            ),
          }
        : sendTargets;
      const presentationSendsToProjector = options?.presentation
        ? shouldSendToType(
            presentationShouldSendTo,
            displayOutputs,
            "projector",
            controllerProfile,
          )
        : sendsToProjector;
      const presentationSendsToMonitor = options?.presentation
        ? shouldSendToType(
            presentationShouldSendTo,
            displayOutputs,
            "monitor",
            controllerProfile,
          )
        : sendsToMonitor;
      const presentationSendsToStream = options?.presentation
        ? shouldSendToType(
            presentationShouldSendTo,
            displayOutputs,
            "stream",
            controllerProfile,
          )
        : sendsToStream;
      const getPresentationBibleInfo = (slideIndex: number) => {
        const selected = presentationSlides[slideIndex];
        const titleSlideText = presentationSlides[0]?.boxes[1]?.words?.trim();
        const slideText = selected?.boxes[1]?.words?.trim();
        return {
          title: slideText ? titleSlideText || "" : "",
          text: slideIndex > 0 ? slideText || "" : "",
        };
      };

      if (
        !options?.presentationOnly &&
        !options?.preserveBackgroundTargetRangeAnchor
      ) {
        dispatch(setBackgroundTargetRangeAnchorId(slides[index]?.id ?? null));
      }
      const prevSelected = selectedSlideRef.current;
      if (!options?.presentationOnly) dispatch(setSelectedSlide(index));
      const slide = presentationSlides[index];
      if (slide?.mediaSource?.kind === "local-video-input") {
        const mediaSource = slide.mediaSource;
        const localVideoInput = buildLocalVideoInputPresentation(
          mediaSource,
          getOrCreateDeviceId(),
          getTrustedDeviceLabel(),
        );
        if (!localVideoInput) {
          showToast?.(
            isDesktopCaptureKind(mediaSource.captureKind)
              ? `The ${mediaSource.label} share is unavailable. Use Edit in the slide details to choose it again.`
              : `Relink ${mediaSource.label} on this computer, then try again.`,
            "warning",
          );
          return;
        }
        const presentation = {
          slide,
          type: "local-video-input",
          name: presentationName,
          slideIndex: index,
          slideCount: presentationSlides.length,
          localVideoInput,
        };
        const sendPresentation = () => {
          if (presentationSendsToProjector) {
            dispatch(
              updateProjector(
                withVideoPlayback(
                  {
                    ...presentation,
                    outputIds: presentationSendTargets.projector,
                  },
                  outputSlots,
                ),
              ),
            );
          }
          if (presentationSendsToMonitor) {
            dispatch(
              updateMonitor(
                withVideoPlayback(
                  {
                    ...presentation,
                    outputIds: presentationSendTargets.monitor,
                    itemId: presentationItemId,
                    transitionDirection: "jump",
                  },
                  outputSlots,
                ),
              ),
            );
          }
          if (presentationSendsToStream) {
            dispatch(
              updateStream(
                withVideoPlayback(
                  {
                    ...presentation,
                    outputIds: presentationSendTargets.stream,
                  },
                  outputSlots,
                ),
              ),
            );
          }
        };
        const localVideoSourceId = mediaSource.sourceId;
        const binding = resolveLocalVideoInputBinding(localVideoSourceId);
        if (!binding) {
          showToast?.(
            isDesktopCaptureKind(mediaSource.captureKind)
              ? `The ${mediaSource.label} share is unavailable. Use Edit in the slide details to choose it again.`
              : `Relink ${mediaSource.label} on this computer, then try again.`,
            "warning",
          );
          return;
        }
        const transmitConsumerId = `slide-transmit:${localVideoSourceId}:${generateRandomId()}`;
        const releaseTransmitCapture = () => {
          window.setTimeout(() => {
            void releaseWarmLocalVideoCapture(
              localVideoSourceId,
              transmitConsumerId,
            );
          }, LOCAL_VIDEO_TRANSMIT_HANDOFF_MS);
        };
        void acquireWarmLocalVideoCaptureWithBusyRetry(
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
              isDesktopCaptureSourceMissingError(error)
                ? `The ${mediaSource.label} share is unavailable. Use Edit in the slide details to choose it again.`
                : getLocalVideoSourceErrorMessage(
                    error,
                    mediaSource.captureKind,
                  ),
              "warning",
            );
          });
        return;
      }

      if (presentationSendsToStream) {
        if (presentationType === "bible") {
          const { title, text } = getPresentationBibleInfo(index);
          dispatch(
            updateBibleDisplayInfo({
              title,
              text,
              outputIds: presentationSendTargets.stream,
            }),
          );
        } else {
          dispatch(
            updateBibleDisplayInfo({
              title: "",
              text: "",
              outputIds: presentationSendTargets.stream,
            }),
          );
        }

        if (presentationType === "free") {
          dispatch(
            updateFormattedTextDisplayInfo({
              outputIds: presentationSendTargets.stream,
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
              outputIds: presentationSendTargets.stream,
              text: "",
            }),
          );
        }

        if (presentationType !== "free" && presentationType !== "bible") {
          dispatch(
            updateStream(
              withVideoPlayback(
                {
                  outputIds: presentationSendTargets.stream,
                  slide,
                  type: presentationType,
                  name: presentationName,
                  timerId: options?.presentation?.timerId ?? timerInfo?.id,
                  slideIndex: index,
                  slideCount: presentationSlides.length,
                },
                outputSlots,
              ),
            ),
          );
        }
      }

      if (presentationSendsToProjector) {
        dispatch(
          updateProjector(
            withVideoPlayback(
              {
                outputIds: presentationSendTargets.projector,
                slide,
                type: presentationType,
                name: presentationName,
                timerId: options?.presentation?.timerId ?? timerInfo?.id,
                slideIndex: index,
                slideCount: presentationSlides.length,
              },
              outputSlots,
            ),
          ),
        );
      }

      if (presentationType === "timer") {
        dispatch(
          setMonitorTimerId(
            options?.presentation?.timerId ?? timerInfo?.id ?? null,
          ),
        );
      } else if (presentationType === "service-time") {
        dispatch(setMonitorTimerId(null));
      }

      if (presentationSendsToMonitor) {
        let transitionDirection: "next" | "prev" | "jump";
        if (options?.presentation) transitionDirection = "jump";
        else if (index === prevSelected + 1) transitionDirection = "next";
        else if (index === prevSelected - 1) transitionDirection = "prev";
        else transitionDirection = "jump";
        const presentationMonitorSlides = options?.presentation
          ? presentationType === "free" && monitorShowNextSlide
            ? ensureSlidesHaveMonitorBandFormatting(presentationSlides)
            : presentationSlides
          : monitorReadySlides;
        const monitorSlide = presentationMonitorSlides[index] ?? slide;
        const canShowNextSlide =
          (presentationType === "song" || presentationType === "bible" || presentationType === "free") &&
          monitorShowNextSlide &&
          index + 1 < presentationSlides.length &&
          (slide?.boxes ?? []).every((box, i) => i === 0 || box.height <= 55);
        const nextSlideSlide = canShowNextSlide
          ? (presentationMonitorSlides[index + 1] ?? presentationSlides[index + 1])
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
            withVideoPlayback(
              {
                outputIds: presentationSendTargets.monitor,
                slide: slideForMonitor,
                type: presentationType,
                name: presentationName,
                timerId: options?.presentation?.timerId ?? timerInfo?.id,
                itemId: presentationItemId,
                listId: presentationListId,
                slideIndex: index,
                slideCount: presentationSlides.length,
                nextSlide: nextSlideForMonitor,
                transitionDirection,
                bibleInfoBox:
                  presentationType === "bible" && nextSlideForMonitor
                    ? (slide.boxes?.[2] ?? null)
                    : undefined,
              },
              outputSlots,
            ),
          ),
        );
      }
    },
    [
      dispatch,
      sendsToStream,
      sendsToProjector,
      sendsToMonitor,
      sendTargets,
      displayOutputs,
      controllerProfile,
      shouldSendTo,
      monitorShowNextSlide,
      type,
      name,
      timerInfo?.id,
      slides,
      _id,
      listId,
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

  /** Clear/Delete target: multi-select subset, else the focused slide. */
  const actionTargetSlideIds = useMemo(() => {
    const subset = backgroundTargetSlideIdsRaw ?? [];
    if (subset.length > 0) {
      return subset;
    }
    const id = slides[selectedSlide]?.id;
    return id ? [id] : [];
  }, [backgroundTargetSlideIdsRaw, slides, selectedSlide]);

  const cannotDeleteSelectedSlides = useMemo(() => {
    if (type !== "free") return true;
    if (actionTargetSlideIds.length === 0) return true;
    const idSet = new Set(actionTargetSlideIds);
    const remaining = slides.filter((s) => !idSet.has(s.id)).length;
    return remaining < 1;
  }, [type, actionTargetSlideIds, slides]);

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

  const activateOutlineNeighbor = useCallback(
    (direction: 1 | -1) => {
      if (!isCollapsedContinuous || !listId) return false;
      const currentIndex = outlineItems.findIndex(
        (item) => item.listId === listId,
      );
      if (currentIndex < 0) return false;
      const neighbor = outlineItems[currentIndex + direction];
      if (!neighbor) return false;

      const neighborSlides = resolveSlidesForOutlineItem(neighbor, {
        activeItem: { _id, listId },
        docsById: neighborDocsById,
      });
      const targetIndex =
        direction === 1 ? 0 : Math.max(0, neighborSlides.length - 1);
      pendingOutlineSelectRef.current = {
        listId: neighbor.listId,
        index: targetIndex,
      };

      dispatch(setActiveItemInList(neighbor.listId));
      const doc = neighborDocsById.get(neighbor._id);
      if (doc) {
        dispatch(
          setActiveItem({
            ...prepareItemForEditor(doc, neighbor.listId),
            selectedSlide: targetIndex,
          }),
        );
      }
      navigate(getControllerItemPath(neighbor, controllerBasePath), {
        replace: true,
      });
      return true;
    },
    [
      _id,
      controllerBasePath,
      dispatch,
      isCollapsedContinuous,
      listId,
      navigate,
      neighborDocsById,
      outlineItems,
    ],
  );

  useEffect(() => {
    const pending = pendingOutlineSelectRef.current;
    if (!pending || pending.listId !== listId) return;
    pendingOutlineSelectRef.current = null;
    selectSlide(pending.index);
  }, [listId, _id, selectSlide]);

  // Automatically switch to slide 1 (wrap up slide) when timer reaches 0
  useEffect(() => {
    if (
      type === "timer" &&
      timerInfo &&
      timerInfo.remainingTime === 0 &&
      timerInfo.status === "stopped" &&
      slides.length > 1 &&
      selectedSlide === 0
    ) {
      dispatch(
        updateTimer({
          id: timerInfo.id,
          timerInfo: { ...timerInfo, status: "stopped" },
        }),
      );
      selectSlide(1);
    }
  }, [type, timerInfo, slides.length, selectedSlide, selectSlide, dispatch]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (!location.pathname.includes("item") || isLyricsEditorOpen || isTyping) return;
      if (e.key === " ") {
        e.preventDefault();
        if (e.shiftKey) {
          previousSlide();
        } else {
          advanceSlide();
        }
        return;
      }
      if (!isCollapsedContinuous) return;
      // Left outline already owns Up/Down while focused.
      if (target instanceof Element && target.closest("#service-items-list")) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activateOutlineNeighbor(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        activateOutlineNeighbor(-1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    activateOutlineNeighbor,
    advanceSlide,
    isCollapsedContinuous,
    isLyricsEditorOpen,
    location.pathname,
    previousSlide,
  ]);

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

  const { setNodeRef } = useDroppable({
    id: "item-slides-list",
    data: { kind: "slide-container" },
    disabled: !canInsertMedia || isCollapsedContinuous,
  });
  const slidesScrollRef = useRef<HTMLElement | null>(null);
  const [slidesContainer, setSlidesContainer] = useState<HTMLElement | null>(
    null,
  );
  const setSlidesContainerRef = useCallback(
    (node: HTMLElement | null) => {
      setNodeRef(node);
      slidesScrollRef.current = node;
      setSlidesContainer(node);
    },
    [setNodeRef],
  );
  const thumbnailScaleFactor = useStaticThumbnailScaleFactor(
    slidesContainer,
    size,
    `${isCollapsedContinuous ? "continuous" : "single"}:${size}`,
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

  const clearTargetSlideBackgrounds = useCallback(() => {
    if (actionTargetSlideIds.length === 0) return;
    dispatch(
      clearSlideBackgroundsOnSubset({
        slideIds: [...actionTargetSlideIds],
      }),
    );
  }, [actionTargetSlideIds, dispatch]);

  const deleteTargetSlides = useCallback(() => {
    if (cannotDeleteSelectedSlides) return;
    dispatch(
      removeSlidesByIds({
        slideIds: [...actionTargetSlideIds],
      }),
    );
  }, [actionTargetSlideIds, cannotDeleteSelectedSlides, dispatch]);

  const slideActionBarItems = useMemo((): ActionBarItemDef[] => {
    if (isCollapsedContinuous || !canEdit) return [];

    const items: ActionBarItemDef[] = [];
    const isFree = type === "free";

    // Keep Done first while selecting so it stays inline under overflow pressure.
    if (isSlideSubsetSelecting) {
      items.push({
        id: "done-selecting",
        label: "Done",
        renderButton: (isMeasure) => (
          <Button
            variant="tertiary"
            className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)}
            onClick={
              isMeasure
                ? undefined
                : () => dispatch(clearBackgroundTargetSelection())
            }
            title="Done"
            tabIndex={isMeasure ? -1 : undefined}
          >
            Done
          </Button>
        ),
        onOverflowSelect: () => dispatch(clearBackgroundTargetSelection()),
      });
    }

    if (isFree && !isPresentMode) {
      items.push({
        id: "add-slide",
        label: "Add",
        renderButton: (isMeasure) => (
          <Button
            variant="tertiary"
            className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)}
            onClick={isMeasure ? undefined : () => addSlide()}
            title="Add"
            tabIndex={isMeasure ? -1 : undefined}
          >
            <span className="flex items-center gap-1">
              <Plus
                className={cn(
                  MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
                  "text-cyan-400",
                )}
                aria-hidden
              />
              Add
            </span>
          </Button>
        ),
        onOverflowSelect: () => addSlide(),
        renderOverflowItem: () => (
          <span className="flex items-center gap-1.5">
            <Plus
              className={cn(
                MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
                "text-cyan-400",
              )}
              aria-hidden
            />
            Add
          </span>
        ),
      });
      items.push({
        id: "copy-slide",
        label: "Copy",
        disabled: selectedSlide < 0 || !slides[selectedSlide],
        renderButton: (isMeasure) => (
          <Button
            variant="tertiary"
            className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)}
            onClick={isMeasure ? undefined : copySlide}
            disabled={selectedSlide < 0 || !slides[selectedSlide]}
            title="Copy"
            tabIndex={isMeasure ? -1 : undefined}
          >
            <span className="flex items-center gap-1">
              <Copy
                className={cn(
                  MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
                  "text-cyan-400",
                )}
                aria-hidden
              />
              Copy
            </span>
          </Button>
        ),
        onOverflowSelect: () => copySlide(),
        renderOverflowItem: () => (
          <span className="flex items-center gap-1.5">
            <Copy
              className={cn(
                MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
                "text-cyan-400",
              )}
              aria-hidden
            />
            Copy
          </span>
        ),
      });
    }

    if (!isPresentMode && hasSlides) {
      items.push({
        id: "clear-background",
        label: "Clear background",
        disabled: actionTargetSlideIds.length === 0,
        renderButton: (isMeasure) => (
          <Button
            variant="tertiary"
            className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)}
            onClick={isMeasure ? undefined : clearTargetSlideBackgrounds}
            disabled={actionTargetSlideIds.length === 0}
            title="Clear background"
            tabIndex={isMeasure ? -1 : undefined}
          >
            <span className="flex items-center gap-1">
              <ImageOff
                className={cn(
                  MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
                  "text-cyan-400",
                )}
                aria-hidden
              />
              Clear background
            </span>
          </Button>
        ),
        onOverflowSelect: () => clearTargetSlideBackgrounds(),
        renderOverflowItem: () => (
          <span className="flex items-center gap-1.5">
            <ImageOff
              className={cn(
                MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
                "text-cyan-400",
              )}
              aria-hidden
            />
            Clear background
          </span>
        ),
      });

      if (isFree) {
        items.push({
          id: "delete-slides",
          label: "Delete",
          disabled: cannotDeleteSelectedSlides,
          overflowMenuItemClassName: "[&_svg]:text-red-400!",
          renderButton: (isMeasure) => (
            <Button
              variant="tertiary"
              className={cn(
                "shrink-0 text-white [&_svg]:text-red-400!",
                MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS,
              )}
              onClick={isMeasure ? undefined : deleteTargetSlides}
              disabled={cannotDeleteSelectedSlides}
              title={
                cannotDeleteSelectedSlides
                  ? "Select at least one slide and keep one slide in the item"
                  : "Delete selected slides"
              }
              tabIndex={isMeasure ? -1 : undefined}
            >
              <span className="flex items-center gap-1">
                <Trash2
                  className={cn(
                    MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
                    "text-red-400",
                  )}
                  aria-hidden
                />
                Delete
              </span>
            </Button>
          ),
          onOverflowSelect: () => deleteTargetSlides(),
          renderOverflowItem: () => (
            <span className="flex items-center gap-1.5">
              <Trash2
                className={cn(
                  MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE,
                  "text-red-400",
                )}
                aria-hidden
              />
              Delete
            </span>
          ),
        });
      }
    }

    return items;
  }, [
    actionTargetSlideIds.length,
    addSlide,
    canEdit,
    cannotDeleteSelectedSlides,
    clearTargetSlideBackgrounds,
    copySlide,
    deleteTargetSlides,
    dispatch,
    hasSlides,
    isCollapsedContinuous,
    isPresentMode,
    isSlideSubsetSelecting,
    selectedSlide,
    slides,
    type,
  ]);

  const onDragStart = (event: DragStartEvent) => {
    const { active } = event;
    if (!isSlideDragData(active.data.current)) return;
    if (type === "free") {
      setDragPreviewSlides(slides);
    }
    const draggedSlide = slides.find((slide) => slide.id === active.id);
    if (draggedSlide) {
      const sectionMatch = draggedSlide.name.match(/Section (\d+)/);
      if (sectionMatch) {
        setDraggedSection(sectionMatch[1]);
      }
    }
  };

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (
      type !== "free" ||
      !over ||
      !isSlideDragData(active.data.current) ||
      !isSlideDragData(over.data.current)
    ) {
      return;
    }

    setDragPreviewSlides((currentSlides) => {
      const sourceSlides = currentSlides ?? slides;
      const nextSlides = reorderSlidesForDrag(
        sourceSlides,
        String(active.id),
        String(over.id),
      );
      return nextSlides === sourceSlides ? currentSlides : nextSlides;
    });
  };

  const activeMediaData = isMediaDragData(active?.data.current)
    ? active.data.current
    : null;
  const activeSlide =
    type === "free" && isSlideDragData(active?.data.current)
      ? renderedSlides.find((slide) => slide.id === active.id)
      : null;
  const getContainerInsertionIndex = () => {
    if (!active?.rect?.current?.translated || slides.length === 0) {
      return slides.length;
    }
    const draggedRect = active.rect.current.translated;
    const pointerX = draggedRect.left + draggedRect.width / 2;
    const pointerY = draggedRect.top + draggedRect.height / 2;
    for (let index = 0; index < slides.length; index += 1) {
      const slideRect = document
        .getElementById(`item-slide-${index}`)
        ?.getBoundingClientRect();
      if (!slideRect) continue;

      const midpointY = slideRect.top + slideRect.height / 2;
      const midpointX = slideRect.left + slideRect.width / 2;
      if (
        pointerY < midpointY ||
        (pointerY <= slideRect.bottom && pointerX < midpointX)
      ) {
        return index;
      }
    }
    return slides.length;
  };

  const mediaInsertIndex =
    canInsertMedia && !isCollapsedContinuous && activeMediaData
      ? isSlideInsertData(over?.data.current)
        ? over.data.current.index
        : isSlideContainerData(over?.data.current)
          ? getContainerInsertionIndex()
          : null
      : null;
  const draggedMediaItems = activeMediaData
    ? activeMediaData.mediaIds
        .map((mediaId) => mediaList.find((media) => media.id === mediaId))
        .filter((media): media is (typeof mediaList)[number] => Boolean(media))
    : [];

  const insertMediaSlides = (event: DragEndEvent) => {
    const { active, over } = event;
    const activeData = active.data.current;
    const overData = over?.data.current;
    if (
      !canInsertMedia ||
      isCollapsedContinuous ||
      !isMediaDragData(activeData)
    )
      return;
    if (!over) return;
    const insertionIndex = isSlideInsertData(overData)
      ? overData.index
      : isSlideContainerData(overData)
        ? getContainerInsertionIndex()
        : null;
    if (insertionIndex == null) return;

    const mediaById = new Map(mediaList.map((media) => [media.id, media]));
    const mediaItems = activeData.mediaIds
      .map((mediaId) => mediaById.get(mediaId))
      .filter((media): media is (typeof mediaList)[number] =>
        Boolean(media && mediaHasSendableContent(media)),
      );
    if (mediaItems.length === 0) return;

    const insertedSlides = mediaItems.map((media) =>
      createSlideFromMedia(media),
    );
    const updatedSlides = insertSlidesAt(
      slides,
      insertedSlides,
      insertionIndex,
    );
    setDebouncedSlides(updatedSlides);
    dispatch(updateSlides({ slides: updatedSlides }));
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDraggedSection(null);
    const { over, active } = event;
    if (!over || !active) {
      setDragPreviewSlides(null);
      return;
    }

    const activeData = active.data.current;
    if (isMediaDragData(activeData)) {
      insertMediaSlides(event);
      return;
    }
    if (
      !isSlideDragData(activeData) ||
      !isSlideDragData(over.data.current)
    ) {
      setDragPreviewSlides(null);
      return;
    }

    if (!dragPreviewSlides) return;
    const updatedSlides = dragPreviewSlides;
    setDragPreviewSlides(null);
    if (haveSameSlideOrder(slides, updatedSlides)) return;
    setDebouncedSlides(updatedSlides);
    dispatch(updateSlides({ slides: updatedSlides }));
  };

  const onDragCancel = () => {
    setDraggedSection(null);
    setDragPreviewSlides(null);
  };

  useDndMonitor({
    onDragStart: canEdit ? onDragStart : undefined,
    onDragOver: canEdit ? onDragOver : undefined,
    onDragEnd: canEdit ? onDragEnd : undefined,
    onDragCancel: canEdit ? onDragCancel : undefined,
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-homepage-canvas">
      <div className="mb-2 flex w-full shrink-0 flex-col border-b border-white/20 bg-black/60">
        {!isPresentMode && !isCollapsedContinuous &&
        videoBackgroundMedia &&
        videoBackgroundMediaKey ? (
          <div className="px-2 pt-1">
            <VideoBackgroundControls
              media={videoBackgroundMedia}
              mediaKey={videoBackgroundMediaKey}
              syncOutputIds={liveVideoSyncOutputIds}
              sendMode={videoBackgroundSendMode}
              onSendModeChange={(mode) =>
                dispatch(updateSlideVideoBackgroundSendMode({ mode }))
              }
              showSendMode={!isPresentMode}
            />
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 px-2 py-1 max-md:content-start">
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
                  setSlideGridSize(slidesGridColsMax + slidesGridColsMin - raw);
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
          {isPresentMode && videoBackgroundMedia && videoBackgroundMediaKey ? (
            <VideoBackgroundControls
              media={videoBackgroundMedia}
              mediaKey={videoBackgroundMediaKey}
              syncOutputIds={liveVideoSyncOutputIds}
              sendMode={videoBackgroundSendMode}
              onSendModeChange={(mode) =>
                dispatch(updateSlideVideoBackgroundSendMode({ mode }))
              }
              showSendMode={false}
              className="min-w-0 flex-1 max-md:order-3 max-md:basis-full md:rounded-none md:border-0 md:bg-transparent md:p-0"
            />
          ) : null}
          {slideActionBarItems.length > 0 ? (
            <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
              {isSlideSubsetSelecting ? (
                <div
                  className="flex shrink-0 items-baseline gap-1 text-xs"
                  aria-live="polite"
                >
                  <span className="font-semibold tabular-nums text-cyan-400">
                    {backgroundTargetSlideIds.length}
                  </span>
                  <span className="hidden text-gray-400 sm:inline">
                    {backgroundTargetSlideIds.length === 1
                      ? "slide selected"
                      : "slides selected"}
                  </span>
                </div>
              ) : null}
              <ActionBar
                items={slideActionBarItems}
                className="min-w-0 flex-1 justify-end"
                overflowMenuClassName="min-w-48"
              />
            </div>
          ) : null}
        </div>
      </div>
      {isLoading && !isCollapsedContinuous ? (
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
            onRenameSection={isPresentMode ? undefined : renameFreeSection}
            timers={timers}
            selectSlide={selectSlide}
            onSlideGridClick={onSlideGridClick}
            thumbnailScaleFactor={thumbnailScaleFactor}
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
          className={cn(slidesListClassName, "flex-1 min-h-0 content-start")}
        >
          <SortableContext
            items={renderedSlides.map((slide) => slide.id || "")}
            strategy={rectSortingStrategy}
          >
            {renderedSlides.map((slide, index) => (
              <Fragment key={slide.id}>
                {mediaInsertIndex === index && draggedMediaItems.length > 0 ? (
                  <li className="relative w-full list-none rounded-lg">
                    <MediaDragPreview
                      mediaItems={draggedMediaItems}
                      variant="ghost"
                      insertionIndex={mediaInsertIndex}
                    />
                  </li>
                ) : null}
                <ItemSlide
                  timerInfo={timerInfo}
                  slide={slide}
                  index={index}
                  selectSlide={selectSlide}
                  isSelected={index === selectedSlide}
                  isLive={liveSlideIds.has(slide.id)}
                  size={size}
                  itemType={type}
                  isMobile={isMobile || false}
                  draggedSection={draggedSection}
                  formattedSections={formattedSections}
                  onRenameSection={
                    isPresentMode ? undefined : renameFreeSection
                  }
                  isStreamFormat={shouldShowStreamFormat}
                  getBibleInfo={getBibleInfo}
                  borderWidth={sizeConfig.borderWidth}
                  hSize={sizeConfig.hSize}
                  canEdit={canEdit}
                  mediaInsertEnabled={canInsertMedia}
                  isBackgroundTargetSelected={backgroundTargetSlideIds.includes(
                    slide.id,
                  )}
                  onSlideGridClick={onSlideGridClick}
                  onEnterBackgroundTargetSelectMode={
                    canEdit && hasSlides
                      ? enterBackgroundTargetSelectModeFromSlide
                      : undefined
                  }
                  thumbnailScaleFactor={thumbnailScaleFactor}
                />
              </Fragment>
            ))}
            {mediaInsertIndex === renderedSlides.length &&
            draggedMediaItems.length > 0 ? (
              <li className="relative w-full list-none rounded-lg">
                <MediaDragPreview
                  mediaItems={draggedMediaItems}
                  variant="ghost"
                  insertionIndex={mediaInsertIndex}
                />
              </li>
            ) : null}
          </SortableContext>
        </ul>
      ) : (
        <div
          ref={setSlidesContainerRef}
          tabIndex={0}
          id="item-slides-container"
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-2 pb-2"
        >
          {mediaInsertIndex === 0 && draggedMediaItems.length > 0 ? (
            <div className="w-full">
              <MediaDragPreview
                mediaItems={draggedMediaItems}
                variant="ghost"
                insertionIndex={0}
              />
            </div>
          ) : null}
          <p className="text-gray-300">No slides for selected item</p>
        </div>
      )}
      <DragOverlay dropAnimation={null} className="pointer-events-none">
        {activeSlide ? (
          <div
            className="shrink-0"
            style={{
              width: active?.rect?.current?.initial?.width,
            }}
          >
            <ItemSlide
              timerInfo={timerInfo}
              slide={activeSlide}
              index={renderedSlides.findIndex(
                (slide) => slide.id === activeSlide.id,
              )}
              selectSlide={selectSlide}
              isSelected={false}
              isLive={liveSlideIds.has(activeSlide.id)}
              size={size}
              itemType={type}
              isMobile={isMobile || false}
              draggedSection={null}
              formattedSections={formattedSections}
              isStreamFormat={shouldShowStreamFormat}
              getBibleInfo={getBibleInfo}
              borderWidth={sizeConfig.borderWidth}
              hSize={sizeConfig.hSize}
              canEdit={false}
              mediaInsertEnabled={false}
              onSlideGridClick={() => undefined}
              isDragOverlay
              thumbnailScaleFactor={thumbnailScaleFactor}
            />
          </div>
        ) : null}
      </DragOverlay>
    </div>
  );
};

const ItemSlides = () => {
  const dndMode = useContext(ItemSlidesDndContext);
  const sensors = useSensors();
  const content = <ItemSlidesContent />;

  return (
    <ErrorBoundary>
      {dndMode === "ancestor" ? (
        content
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={presentationCollisionDetection}
        >
          {content}
        </DndContext>
      )}
    </ErrorBoundary>
  );
};

export default ItemSlides;
