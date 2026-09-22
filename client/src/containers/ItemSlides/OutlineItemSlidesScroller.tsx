import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { shallowEqual } from "react-redux";
import { File } from "lucide-react";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useDispatch, useSelector } from "../../hooks";
import { setActiveItem } from "../../store/itemSlice";
import { setActiveItemInList } from "../../store/itemListSlice";
import { useOutlineItemDocs } from "../../hooks/useOutlineItemDocs";
import { useControllerBasePath } from "../../context/activeController";
import type {
  Arrangment,
  FormattedSection,
  ItemSlideType,
  ShouldSendTo,
  TimerInfo,
} from "../../types";
import { iconColorMap, svgMap } from "../../utils/itemTypeMaps";
import { cn } from "../../utils/cnHelper";
import { keepElementInView } from "../../utils/generalUtils";
import {
  OUTLINE_INITIAL_ANCHOR_MS,
  OUTLINE_SCROLL_SETTLE_MS,
  OUTLINE_SMOOTH_SCROLL_MS,
  buildOutlineSlideSections,
  buildOutlineVirtualRowIndex,
  buildOutlineVirtualRows,
  captureOutlineScrollAnchorFromVirtualItems,
  captureOutlineScrollAnchor,
  captureOutlineSlideFocalPoint,
  findOutlineRowIndexForItem,
  getControllerItemPath,
  getOutlineVirtualRowKey,
  getNonHeadingOutlineItems,
  getPinnedListIdFromVirtualItems,
  getPrefetchItemIds,
  prepareItemForEditor,
  resolveOutlineScrollTopFromAnchor,
  type OutlineScrollAnchor,
  type OutlineSlideSection,
  type OutlineSlideFocalPoint,
} from "../../utils/outlineSlideSections";
import { subscribeOutlineSelectionScroll } from "../../utils/outlineSelectionScroll";
import ItemSlide from "./ItemSlide";
import ContinuousStaticItemSlide from "./ContinuousStaticItemSlide";

const SECTION_LABEL_HEIGHT = 36;
const EMPTY_ROW_HEIGHT = 28;
const INITIAL_TILE_ROW_HEIGHT = 140;
const ROW_GAP = 4;

type SizeConfig = {
  borderWidth: string;
  hSize: string;
  cols: string;
};

type OutlineItemSlidesScrollerProps = {
  scrollRef: React.RefObject<HTMLElement | null>;
  cols: number;
  size: number;
  sizeConfig: SizeConfig;
  isMobile: boolean;
  isStreamFormat: boolean;
  canEdit: boolean;
  selectedSlide: number;
  liveSlideIds: Set<string>;
  backgroundTargetSlideIds: string[];
  draggedSection: string | null;
  timers: TimerInfo[];
  selectSlide: (
    index: number,
    options?: {
      preserveBackgroundTargetRangeAnchor?: boolean;
      presentationOnly?: boolean;
      presentation?: {
        slides: ItemSlideType[];
        type: string;
        name: string;
        itemId: string;
        listId: string;
        timerId?: string;
        shouldSendTo?: ShouldSendTo;
      };
    },
  ) => void;
  onSlideGridClick: (e: React.MouseEvent, index: number) => void;
  onEnterBackgroundTargetSelectMode?: (
    index: number,
    options?: { skipNextClick?: boolean },
  ) => void;
  onRenameSection?: (sectionNum: number, name: string) => void;
  thumbnailScaleFactor?: number;
};

type OutlineActiveItemSource = {
  _id?: string;
  listId?: string;
  name?: string;
  type?: string;
  slides?: ItemSlideType[];
  arrangements?: Arrangment[];
  selectedArrangement?: number;
  formattedSections?: FormattedSection[];
  shouldSendTo?: ShouldSendTo;
};

type PendingDirectSlideClick = {
  listId: string;
  slideIndex: number;
  wasVisible: boolean;
};

const isElementFullyVisibleWithinParent = (
  child: HTMLElement,
  parent: HTMLElement,
) => {
  const parentRect = parent.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  return (
    childRect.top >= parentRect.top &&
    childRect.bottom <= parentRect.bottom
  );
};

const getBibleInfoFromSlides = (slides: ItemSlideType[], index: number) => {
  const slide = slides[index];
  if (!slide) return { title: "", text: "" };
  const titleSlideText = slides[0]?.boxes[1]?.words?.trim();
  const slideText = slide.boxes[1]?.words?.trim();
  return {
    title: (slideText ? titleSlideText : "") || "",
    text: index > 0 ? slideText || "" : "",
  };
};

const bibleInfoGetterCache = new WeakMap<
  ItemSlideType[],
  (index: number) => { title: string; text: string }
>();

const getBibleInfoGetter = (slides: ItemSlideType[]) => {
  let getter = bibleInfoGetterCache.get(slides);
  if (!getter) {
    getter = (index: number) => getBibleInfoFromSlides(slides, index);
    bibleInfoGetterCache.set(slides, getter);
  }
  return getter;
};

type OutlineVirtualSlideProps = {
  section: OutlineSlideSection;
  slide: ItemSlideType;
  index: number;
  selectedSlide: number;
  isLive: boolean;
  size: number;
  sizeConfig: SizeConfig;
  isMobile: boolean;
  isStreamFormat: boolean;
  canEdit: boolean;
  draggedSection: string | null;
  timerInfo?: TimerInfo;
  backgroundTargetSlideIds: string[];
  onTileClick: (
    event: React.MouseEvent,
    section: OutlineSlideSection,
    index: number,
  ) => void;
  selectSlide: OutlineItemSlidesScrollerProps["selectSlide"];
  onEnterBackgroundTargetSelectMode?: OutlineItemSlidesScrollerProps["onEnterBackgroundTargetSelectMode"];
  onRenameSection?: (sectionNum: number, name: string) => void;
  thumbnailScaleFactor: number;
};

const OutlineVirtualSlide = memo(
  ({
    section,
    slide,
    index,
    selectedSlide,
    isLive,
    size,
    sizeConfig,
    isMobile,
    isStreamFormat,
    canEdit,
    draggedSection,
    timerInfo,
    backgroundTargetSlideIds,
    onTileClick,
    selectSlide,
    onEnterBackgroundTargetSelectMode,
    onRenameSection,
    thumbnailScaleFactor,
  }: OutlineVirtualSlideProps) => {
    const isActive = section.isActive;
    const handleClick = useCallback(
      (event: React.MouseEvent, clickedIndex: number) =>
        onTileClick(event, section, clickedIndex),
      [onTileClick, section],
    );
    const bibleInfo =
      section.type === "bible"
        ? getBibleInfoFromSlides(section.slides, index)
        : undefined;

    if (!isActive) {
      return (
        <ContinuousStaticItemSlide
          slide={slide}
          index={index}
          itemType={section.type}
          isStreamFormat={isStreamFormat}
          timerInfo={timerInfo}
          formattedSections={section.formattedSections}
          isLive={isLive}
          onSlideGridClick={handleClick}
          slideDomId={`item-slide-${section.listId}-${index}`}
          bibleInfo={bibleInfo}
          hSize={sizeConfig.hSize}
          borderWidth={sizeConfig.borderWidth}
          thumbnailScaleFactor={thumbnailScaleFactor}
        />
      );
    }

    return (
      <ItemSlide
        key={`${section.listId}-${slide.id || index}`}
        timerInfo={timerInfo}
        slide={slide}
        index={index}
        selectSlide={selectSlide}
        isSelected={index === selectedSlide}
        isLive={isLive}
        size={size}
        itemType={section.type}
        isMobile={isMobile}
        draggedSection={draggedSection}
        formattedSections={section.formattedSections}
        onRenameSection={onRenameSection}
        isStreamFormat={isStreamFormat}
        getBibleInfo={getBibleInfoGetter(section.slides)}
        borderWidth={sizeConfig.borderWidth}
        hSize={sizeConfig.hSize}
        canEdit={canEdit}
        isBackgroundTargetSelected={backgroundTargetSlideIds.includes(slide.id)}
        slideDomId={`item-slide-${section.listId}-${index}`}
        onSlideGridClick={handleClick}
        onEnterBackgroundTargetSelectMode={
          canEdit ? onEnterBackgroundTargetSelectMode : undefined
        }
        thumbnailScaleFactor={thumbnailScaleFactor}
      />
    );
  },
);

const OutlineItemSlidesScroller = ({
  scrollRef,
  cols,
  size,
  sizeConfig,
  isMobile,
  isStreamFormat,
  canEdit,
  selectedSlide,
  liveSlideIds,
  backgroundTargetSlideIds,
  draggedSection,
  timers,
  selectSlide,
  onSlideGridClick,
  onEnterBackgroundTargetSelectMode,
  onRenameSection,
  thumbnailScaleFactor = 0,
}: OutlineItemSlidesScrollerProps) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const controllerBasePath = useControllerBasePath();
  const outlineList = useSelector(
    (state) => state.undoable.present.itemList?.list,
  );
  const selectedItemListId = useSelector(
    (state) => state.undoable.present.itemList?.selectedItemListId,
  );
  // Ignore selection-only item updates so choosing a slide does not rebuild the
  // whole outline virtual list (major jank with long services).
  const activeItem = useSelector((state): OutlineActiveItemSource => {
    const item = state.undoable.present.item;
    return {
      _id: item._id,
      listId: item.listId,
      name: item.name,
      type: item.type,
      slides: item.slides,
      arrangements: item.arrangements,
      selectedArrangement: item.selectedArrangement,
      formattedSections: item.formattedSections,
      shouldSendTo: item.shouldSendTo,
    };
  }, shallowEqual);
  const activeItemListId = activeItem.listId;

  const outlineItems = useMemo(
    () => getNonHeadingOutlineItems(outlineList),
    [outlineList],
  );
  const outlineItemByListId = useMemo(() => {
    const map = new Map<string, (typeof outlineItems)[number]>();
    for (const item of outlineItems) map.set(item.listId, item);
    return map;
  }, [outlineItems]);
  const sectionCacheRef = useRef<
    Map<
      string,
      {
        item: (typeof outlineItems)[number];
        source: OutlineActiveItemSource | undefined;
        section: OutlineSlideSection;
      }
    >
  >(new Map());
  const rowCacheRef = useRef<
    Map<
      string,
      { section: OutlineSlideSection; cols: number; rows: ReturnType<typeof buildOutlineVirtualRows> }
    >
  >(new Map());
  // Prefetch follows where the operator is browsing, not only the selected item.
  const [browsePinListId, setBrowsePinListId] = useState(
    () => selectedItemListId || activeItemListId,
  );
  const browsePinListIdRef = useRef(browsePinListId);
  browsePinListIdRef.current = browsePinListId;
  const prefetchIds = useMemo(
    () =>
      getPrefetchItemIds(
        outlineItems,
        browsePinListId || selectedItemListId,
      ),
    [browsePinListId, outlineItems, selectedItemListId],
  );
  const docsById = useOutlineItemDocs(prefetchIds);

  const sections = useMemo(
    () =>
      buildOutlineSlideSections(outlineItems, {
        activeItem,
        docsById,
        sectionCache: sectionCacheRef.current,
      }),
    [outlineItems, activeItem, docsById],
  );
  const sectionsByListId = useMemo(() => {
    const map = new Map<string, OutlineSlideSection>();
    for (const section of sections) map.set(section.listId, section);
    return map;
  }, [sections]);
  const sectionsByListIdRef = useRef(sectionsByListId);
  sectionsByListIdRef.current = sectionsByListId;

  const rows = useMemo(
    () => buildOutlineVirtualRows(sections, cols, rowCacheRef.current),
    [sections, cols],
  );
  const rowIndexData = useMemo(
    () => buildOutlineVirtualRowIndex(rows, sectionsByListId),
    [rows, sectionsByListId],
  );
  const rowIndexDataRef = useRef(rowIndexData);
  rowIndexDataRef.current = rowIndexData;
  const rowsRef = useRef(rows);
  const previousRenderInputsRef = useRef({
    cols,
    activeSlides: activeItem.slides,
    activeArrangements: activeItem.arrangements,
    activeFormattedSections: activeItem.formattedSections,
  });
  const virtualizerRef = useRef<Virtualizer<HTMLElement, Element> | null>(
    null,
  );
  const pendingFocalPointRef = useRef<OutlineSlideFocalPoint | null>(null);
  const isFocalPointRestoringRef = useRef(false);
  const focalPointRestoreTimerRef = useRef<number | null>(null);
  const pendingDirectSlideClickRef =
    useRef<PendingDirectSlideClick | null>(null);

  const [tileRowHeight, setTileRowHeight] = useState(INITIAL_TILE_ROW_HEIGHT);
  const tileRowHeightRef = useRef(tileRowHeight);
  tileRowHeightRef.current = tileRowHeight;
  const representativeTileRowKeyRef = useRef<string | null>(null);
  const tileRowMeasureFrameRef = useRef<number | null>(null);

  const didInitialScrollRef = useRef(false);
  const isInitialAnchoringRef = useRef(false);

  // Capture from the previous row geometry before this render's rows/virtualizer
  // replace it. Layout effects run too late: the new DOM is already committed.
  // This covers both zoom reflows and remote content updates.
  const previousRenderInputs = previousRenderInputsRef.current;
  const contentChanged =
    previousRenderInputs.activeSlides !== activeItem.slides ||
    previousRenderInputs.activeArrangements !== activeItem.arrangements ||
    previousRenderInputs.activeFormattedSections !==
      activeItem.formattedSections;
  if (
    rowsRef.current !== rows &&
    (previousRenderInputs.cols !== cols || contentChanged)
  ) {
    if (pendingDirectSlideClickRef.current != null) {
      // A direct click can cause an intermediate local browse-pin render before
      // the active-item selection arrives. The selection effect below owns
      // visibility for the whole direct-click lifecycle.
      pendingFocalPointRef.current = null;
      isFocalPointRestoringRef.current = false;
    } else {
      const element = scrollRef.current;
      const previousVirtualizer = virtualizerRef.current;
      if (
        element &&
        previousVirtualizer &&
        didInitialScrollRef.current &&
        rowsRef.current.length > 0
      ) {
        const getRowStart = (index: number) =>
          previousVirtualizer.getOffsetForIndex(index)?.[0] ?? 0;
        const getRowHeight = (index: number) => {
          const start = getRowStart(index);
          const next = previousVirtualizer.getOffsetForIndex(index + 1)?.[0];
          if (next != null) return Math.max(1, next - start - ROW_GAP);
          const row = rowsRef.current[index];
          if (row?.type === "sectionLabel") return SECTION_LABEL_HEIGHT;
          if (row?.type === "empty") return EMPTY_ROW_HEIGHT;
          return tileRowHeightRef.current;
        };
        pendingFocalPointRef.current = captureOutlineSlideFocalPoint(
          rowsRef.current,
          getRowStart,
          getRowHeight,
          element.scrollTop,
          element.clientHeight,
          selectedItemListId || activeItemListId,
          selectedSlide,
          sectionsByListId,
        );
        isFocalPointRestoringRef.current =
          pendingFocalPointRef.current != null;
      }
    }
  }
  rowsRef.current = rows;
  previousRenderInputsRef.current = {
    cols,
    activeSlides: activeItem.slides,
    activeArrangements: activeItem.arrangements,
    activeFormattedSections: activeItem.formattedSections,
  };

  const virtualizerChangeRef = useRef<
    ((instance: Virtualizer<HTMLElement, Element>, sync: boolean) => void) | null
  >(null);

  const timersByItemId = useMemo(() => {
    const map = new Map<string, TimerInfo>();
    for (const timer of timers) {
      if (timer.id) map.set(timer.id, timer);
    }
    return map;
  }, [timers]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => {
      const row = rowsRef.current[index];
      return row ? getOutlineVirtualRowKey(row) : index;
    },
    estimateSize: (index) => {
      const row = rowsRef.current[index];
      if (row?.type === "sectionLabel") return SECTION_LABEL_HEIGHT;
      if (row?.type === "empty") return EMPTY_ROW_HEIGHT;
      return tileRowHeightRef.current;
    },
    overscan: 2,
    gap: ROW_GAP,
    initialRect: { width: 0, height: 600 },
    useFlushSync: false,
    onChange: (instance, sync) => {
      virtualizerChangeRef.current?.(instance, sync);
    },
  });
  virtualizerRef.current = virtualizer;

  const measureVirtualRow = useCallback((element: Element | null) => {
    if (!element || element.getAttribute("data-row-type") !== "tiles") return;
    const rowKey = element.getAttribute("data-row-key");
    if (!rowKey || representativeTileRowKeyRef.current) return;
    representativeTileRowKeyRef.current = rowKey;
    virtualizerRef.current?.measureElement(element);
    const height = element.getBoundingClientRect().height;
    if (height > 0 && Math.abs(height - tileRowHeightRef.current) > 1) {
      setTileRowHeight(height);
    }
  }, []);

  const prevTileRowHeightRef = useRef(tileRowHeight);
  useLayoutEffect(() => {
    if (prevTileRowHeightRef.current !== tileRowHeight) {
      prevTileRowHeightRef.current = tileRowHeight;
      virtualizerRef.current?.measure();
    }
  }, [tileRowHeight]);

  const invalidateTileRowGeometry = useCallback(() => {
    if (tileRowMeasureFrameRef.current != null) return;

    tileRowMeasureFrameRef.current = window.requestAnimationFrame(() => {
      tileRowMeasureFrameRef.current = null;
      representativeTileRowKeyRef.current = null;

      const element = scrollRef.current;
      const representativeRow =
        element?.querySelector<HTMLElement>('[data-row-type="tiles"]');
      const nextHeight = representativeRow?.getBoundingClientRect().height ?? 0;
      if (nextHeight > 0) {
        tileRowHeightRef.current = nextHeight;
        setTileRowHeight((current) =>
          Math.abs(current - nextHeight) > 1 ? nextHeight : current,
        );
      }

      // Tile rows share one height estimate. Clear TanStack's per-row cache so
      // all offsets are rebuilt from the newly measured representative row.
      virtualizerRef.current?.measure();
    });
  }, [scrollRef]);

  const targetListId =
    selectedItemListId || activeItemListId || undefined;
  const lastPinnedListIdRef = useRef(targetListId);
  const selectedItemListIdRef = useRef(targetListId);
  selectedItemListIdRef.current = targetListId;
  const selectedSlideRef = useRef(selectedSlide);
  selectedSlideRef.current = selectedSlide;
  const ignorePinTimerRef = useRef<number | null>(null);
  const initialAnchorTimerRef = useRef<number | null>(null);
  const lastSelectionScrollKeyRef = useRef<string>("");
  const selectionScrollCleanupRef = useRef<(() => void) | null>(null);
  const ignorePinRef = useRef(true);
  const browsePinTimerRef = useRef<number | null>(null);
  const viewportAnchorRef = useRef<OutlineScrollAnchor | null>(null);

  const readRowOffset = useCallback((rowIndex: number) => {
    if (rowIndex < 0) return null;
    return virtualizerRef.current?.getOffsetForIndex(rowIndex)?.[0] ?? null;
  }, []);

  const readRowStart = useCallback(
    (index: number) =>
      virtualizerRef.current?.getOffsetForIndex(index)?.[0] ?? 0,
    [],
  );

  const captureViewportAnchor = useCallback(
    (options?: { force?: boolean }) => {
      if (isFocalPointRestoringRef.current && !options?.force) return;
      const element = scrollRef.current;
      if (!element) return;
      viewportAnchorRef.current = captureOutlineScrollAnchor(
        rowsRef.current,
        readRowStart,
        element.scrollTop,
        sectionsByListIdRef.current,
      );
    },
    [readRowStart, scrollRef],
  );

  const beginIgnorePin = useCallback((durationMs = OUTLINE_SCROLL_SETTLE_MS) => {
    ignorePinRef.current = true;
    if (ignorePinTimerRef.current != null) {
      window.clearTimeout(ignorePinTimerRef.current);
    }
    ignorePinTimerRef.current = window.setTimeout(() => {
      ignorePinTimerRef.current = null;
      ignorePinRef.current = false;
      captureViewportAnchor();
    }, durationMs);
  }, [captureViewportAnchor]);

  const beginFocalPointRestoreWindow = useCallback(() => {
    isFocalPointRestoringRef.current = true;
    ignorePinRef.current = true;
    if (focalPointRestoreTimerRef.current != null) {
      window.clearTimeout(focalPointRestoreTimerRef.current);
    }
    focalPointRestoreTimerRef.current = window.setTimeout(() => {
      focalPointRestoreTimerRef.current = null;
      isFocalPointRestoringRef.current = false;
      pendingFocalPointRef.current = null;
      ignorePinRef.current = false;
      captureViewportAnchor({ force: true });
    }, OUTLINE_INITIAL_ANCHOR_MS);
  }, [captureViewportAnchor]);

  const layoutColsRef = useRef(cols);
  useLayoutEffect(() => {
    if (layoutColsRef.current !== cols) {
      layoutColsRef.current = cols;
      representativeTileRowKeyRef.current = null;
      setTileRowHeight(INITIAL_TILE_ROW_HEIGHT);
      prevTileRowHeightRef.current = INITIAL_TILE_ROW_HEIGHT;
      virtualizerRef.current?.measure();
    }
    if (pendingFocalPointRef.current) {
      beginFocalPointRestoreWindow();
    }
  }, [beginFocalPointRestoreWindow, cols, rows]);

  const extendInitialAnchoring = useCallback(() => {
    isInitialAnchoringRef.current = true;
    if (initialAnchorTimerRef.current != null) {
      window.clearTimeout(initialAnchorTimerRef.current);
    }
    initialAnchorTimerRef.current = window.setTimeout(() => {
      initialAnchorTimerRef.current = null;
      isInitialAnchoringRef.current = false;
    }, OUTLINE_INITIAL_ANCHOR_MS);
  }, []);

  const activateItem = useCallback(
    (listId: string, options?: { selectedSlide?: number }) => {
      const item = outlineItemByListId.get(listId);
      if (!item) return;
      beginIgnorePin(OUTLINE_SMOOTH_SCROLL_MS);
      lastPinnedListIdRef.current = listId;
      setBrowsePinListId(listId);
      browsePinListIdRef.current = listId;
      if (browsePinTimerRef.current != null) {
        window.clearTimeout(browsePinTimerRef.current);
        browsePinTimerRef.current = null;
      }
      dispatch(setActiveItemInList(listId));
      const doc = docsById.get(item._id);
      if (doc) {
        const prepared = prepareItemForEditor(doc, listId);
        dispatch(
          setActiveItem(
            options?.selectedSlide != null
              ? { ...prepared, selectedSlide: options.selectedSlide }
              : prepared,
          ),
        );
      }
      navigate(getControllerItemPath(item, controllerBasePath), {
        replace: true,
      });
    },
    [
      beginIgnorePin,
      dispatch,
      docsById,
      navigate,
      outlineItemByListId,
      controllerBasePath,
    ],
  );

  const handleVirtualizerChange = useCallback(
    (instance: Virtualizer<HTMLElement, Element>) => {
      const scrollTop = instance.scrollOffset ?? scrollRef.current?.scrollTop ?? 0;
      const virtualItems = instance.getVirtualItems();
      if (!isFocalPointRestoringRef.current) {
        viewportAnchorRef.current = captureOutlineScrollAnchorFromVirtualItems(
          rowsRef.current,
          virtualItems,
          scrollTop,
        );
      }
      if (!didInitialScrollRef.current || ignorePinRef.current) return;
      const pinned = getPinnedListIdFromVirtualItems(
        rowsRef.current,
        virtualItems,
        scrollTop,
      );
      if (!pinned || pinned === browsePinListIdRef.current) return;
      browsePinListIdRef.current = pinned;
      if (browsePinTimerRef.current != null) {
        window.clearTimeout(browsePinTimerRef.current);
      }
      browsePinTimerRef.current = window.setTimeout(() => {
        browsePinTimerRef.current = null;
        setBrowsePinListId(pinned);
      }, OUTLINE_SCROLL_SETTLE_MS);
    },
    [scrollRef],
  );
  virtualizerChangeRef.current = handleVirtualizerChange;

  useEffect(() => {
    return () => {
      if (ignorePinTimerRef.current != null) {
        window.clearTimeout(ignorePinTimerRef.current);
      }
      if (initialAnchorTimerRef.current != null) {
        window.clearTimeout(initialAnchorTimerRef.current);
      }
      if (focalPointRestoreTimerRef.current != null) {
        window.clearTimeout(focalPointRestoreTimerRef.current);
      }
      if (browsePinTimerRef.current != null) {
        window.clearTimeout(browsePinTimerRef.current);
      }
      selectionScrollCleanupRef.current?.();
      selectionScrollCleanupRef.current = null;
    };
  }, []);

  const scrollToListId = useCallback(
    (
      listId: string | undefined,
      slideIndex?: number,
      options?: { behavior?: ScrollBehavior },
    ) => {
      if (!listId) return;
      const rowIndex = findOutlineRowIndexForItem(
        rowsRef.current,
        listId,
        slideIndex,
        rowIndexDataRef.current,
      );
      if (rowIndex < 0) return;
      const behavior: ScrollBehavior =
        options?.behavior ??
        (isInitialAnchoringRef.current ? "auto" : "smooth");
      const offset = readRowOffset(rowIndex);
      if (offset == null) return;
      beginIgnorePin(
        behavior === "smooth"
          ? OUTLINE_SMOOTH_SCROLL_MS
          : isInitialAnchoringRef.current
            ? OUTLINE_INITIAL_ANCHOR_MS
            : OUTLINE_SCROLL_SETTLE_MS,
      );
      const element = scrollRef.current;
      if (behavior === "auto" && element) {
        // Instant placement for collapse/open — smooth would still be mid-flight
        // while measurements keep shifting.
        element.scrollTop = offset;
        virtualizerRef.current?.scrollToIndex(rowIndex, {
          align: "start",
          behavior: "auto",
        });
        if (Math.abs(element.scrollTop - offset) > 1) {
          element.scrollTop = offset;
        }
      } else {
        virtualizerRef.current?.scrollToIndex(rowIndex, {
          align: "start",
          behavior: "smooth",
        });
      }
      captureViewportAnchor();
    },
    [beginIgnorePin, captureViewportAnchor, readRowOffset, scrollRef],
  );

  const applyPinnedScroll = useCallback(
    (slideIndex?: number, behavior: ScrollBehavior = "auto") => {
      const listId = lastPinnedListIdRef.current;
      if (!listId) return;
      scrollToListId(listId, slideIndex, { behavior });
    },
    [scrollToListId],
  );

  const applyFocalPoint = useCallback(
    (focal: OutlineSlideFocalPoint) => {
      const element = scrollRef.current;
      const currentVirtualizer = virtualizerRef.current;
      if (!element || !currentVirtualizer) return false;

      beginIgnorePin(OUTLINE_INITIAL_ANCHOR_MS);

      if (focal.kind === "selected") {
        const rowIndex = findOutlineRowIndexForItem(
          rowsRef.current,
          focal.listId,
          focal.slideIndex,
          rowIndexData,
        );
        if (rowIndex < 0) return false;
        const rowStart = readRowOffset(rowIndex);
        if (rowStart == null) return false;
        const nextRowStart = currentVirtualizer.getOffsetForIndex(rowIndex + 1)?.[0];
        const rowHeight =
          nextRowStart != null
            ? Math.max(1, nextRowStart - rowStart - ROW_GAP)
            : tileRowHeightRef.current;
        const targetViewportCenter =
          focal.viewportCenter ?? element.clientHeight / 2;
        currentVirtualizer.scrollToIndex(rowIndex, {
          align: "center",
          behavior: "auto",
        });
        element.scrollTop = Math.max(
          0,
          rowStart + rowHeight / 2 - targetViewportCenter,
        );
        const child = document.getElementById(
          `item-slide-${focal.listId}-${focal.slideIndex}`,
        );
        if (child) {
          const parentRect = element.getBoundingClientRect();
          const childRect = child.getBoundingClientRect();
          element.scrollTop = Math.max(
            0,
            element.scrollTop +
              childRect.top +
              childRect.height / 2 -
              (parentRect.top + targetViewportCenter),
          );
        }
        captureViewportAnchor({ force: true });
        return true;
      }

      const nextTop = resolveOutlineScrollTopFromAnchor(
        rowsRef.current,
        readRowStart,
        focal.anchor,
        rowIndexData,
      );
      if (nextTop == null) return false;
      const rowIndex = findOutlineRowIndexForItem(
        rowsRef.current,
        focal.anchor.listId,
        focal.anchor.startIndex,
        rowIndexData,
      );
      if (rowIndex >= 0) {
        currentVirtualizer.scrollToIndex(rowIndex, {
          align: "start",
          behavior: "auto",
        });
      }
      element.scrollTop = nextTop;
      captureViewportAnchor({ force: true });
      return true;
    },
    [
      beginIgnorePin,
      captureViewportAnchor,
      readRowOffset,
      readRowStart,
      rowIndexData,
      scrollRef,
    ],
  );

  useLayoutEffect(() => {
    if (rows.length === 0) return;
    const listId = selectedItemListIdRef.current;
    if (!listId) return;

    const tryScroll = () => {
      // Parent attaches the scroll element ref; child layout can run first.
      if (!scrollRef.current) return false;
      if (isFocalPointRestoringRef.current) return true;
      if (!didInitialScrollRef.current) {
        didInitialScrollRef.current = true;
        lastPinnedListIdRef.current = listId;
        extendInitialAnchoring();
        scrollToListId(listId, selectedSlideRef.current, { behavior: "auto" });
        return true;
      }
      if (isInitialAnchoringRef.current) {
        extendInitialAnchoring();
        applyPinnedScroll(selectedSlideRef.current, "auto");
      }
      return true;
    };

    if (tryScroll()) return;

    const rafId = window.requestAnimationFrame(() => {
      tryScroll();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [
    applyPinnedScroll,
    extendInitialAnchoring,
    rows,
    scrollRef,
    scrollToListId,
    tileRowHeight,
  ]);

  // useEffect runs after parent refs attach, so collapse/open still lands on
  // the selected item when child layout raced ahead of the scroll element.
  useEffect(() => {
    if (rows.length === 0) return;
    const listId = selectedItemListIdRef.current;
    if (!listId || !scrollRef.current) return;
    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true;
      lastPinnedListIdRef.current = listId;
      extendInitialAnchoring();
      scrollToListId(listId, selectedSlideRef.current, { behavior: "auto" });
      return;
    }
    if (isFocalPointRestoringRef.current) return;
    if (isInitialAnchoringRef.current) {
      applyPinnedScroll(selectedSlideRef.current, "auto");
    }
  }, [
    applyPinnedScroll,
    extendInitialAnchoring,
    rows,
    scrollRef,
    scrollToListId,
    tileRowHeight,
  ]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let lastHeight = element.clientHeight;
    let lastWidth = element.clientWidth;
    const observer = new ResizeObserver(() => {
      const nextHeight = element.clientHeight;
      if (nextHeight <= 0) return;
      const heightChanged = nextHeight !== lastHeight;
      const widthChanged =
        element.clientWidth > 0 && element.clientWidth !== lastWidth;
      lastHeight = nextHeight;
      lastWidth = element.clientWidth;

      if (widthChanged) invalidateTileRowGeometry();
      if (isFocalPointRestoringRef.current) return;
      if (!heightChanged && didInitialScrollRef.current && !isInitialAnchoringRef.current) {
        return;
      }
      if (!didInitialScrollRef.current) {
        const listId = selectedItemListIdRef.current;
        if (!listId) return;
        didInitialScrollRef.current = true;
        lastPinnedListIdRef.current = listId;
      }
      extendInitialAnchoring();
      applyPinnedScroll(selectedSlideRef.current, "auto");
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (tileRowMeasureFrameRef.current != null) {
        window.cancelAnimationFrame(tileRowMeasureFrameRef.current);
        tileRowMeasureFrameRef.current = null;
      }
    };
  }, [
    applyPinnedScroll,
    extendInitialAnchoring,
    invalidateTileRowGeometry,
    scrollRef,
  ]);

  // After the initial anchor window, restore the frozen selected-slide focal
  // point when virtual geometry rebuilds (zoom or remote content updates).
  // Direct slide selection owns visibility during its active-item rebuild;
  // missing selections still fall back to the existing viewport anchor.
  useLayoutEffect(() => {
    if (!didInitialScrollRef.current) return;

    const restore = () => {
      if (pendingDirectSlideClickRef.current != null) {
        captureViewportAnchor({ force: true });
        return true;
      }

      const focalPoint = pendingFocalPointRef.current;
      if (isFocalPointRestoringRef.current && focalPoint) {
        return applyFocalPoint(focalPoint);
      }
      if (isInitialAnchoringRef.current) return false;

      const element = scrollRef.current;
      const anchor = viewportAnchorRef.current;
      if (!element || !anchor) {
        captureViewportAnchor();
        return false;
      }
      const nextTop = resolveOutlineScrollTopFromAnchor(
        rowsRef.current,
        readRowStart,
        anchor,
        rowIndexData,
      );
      if (nextTop != null && Math.abs(element.scrollTop - nextTop) >= 1) {
        element.scrollTop = nextTop;
      }
      captureViewportAnchor();
      return true;
    };

    if (restore()) return;

    // Parent scroll ref can lag one frame behind child layout (same race as
    // initial anchor). Retry once after refs attach.
    const rafId = window.requestAnimationFrame(() => {
      restore();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [
    applyFocalPoint,
    captureViewportAnchor,
    readRowStart,
    rowIndexData,
    rows,
    scrollRef,
    tileRowHeight,
  ]);

  // Parent scroll ref can attach after child layout (same race as collapse/open).
  useEffect(() => {
    if (!didInitialScrollRef.current) return;
    const focalPoint = pendingFocalPointRef.current;
    if (!isFocalPointRestoringRef.current || !focalPoint) return;
    applyFocalPoint(focalPoint);
  }, [applyFocalPoint, rows, tileRowHeight]);

  // Left-list / route item changes: update browse pin only. Scrolling to the
  // selection is owned by the activeItemListId + selectedSlide effect below so
  // we never start a second smooth scroll toward a stale slide index.
  useEffect(() => {
    if (!didInitialScrollRef.current) return;
    if (
      selectedItemListId === lastPinnedListIdRef.current &&
      isInitialAnchoringRef.current
    ) {
      return;
    }
    if (selectedItemListId !== lastPinnedListIdRef.current) {
      beginIgnorePin(OUTLINE_SMOOTH_SCROLL_MS);
    }
    lastPinnedListIdRef.current = selectedItemListId;
    setBrowsePinListId(selectedItemListId);
  }, [beginIgnorePin, selectedItemListId]);

  const scrollSelectedSlideIntoView = useCallback(
    (options?: { force?: boolean }) => {
      selectionScrollCleanupRef.current?.();
      selectionScrollCleanupRef.current = null;

      if (!didInitialScrollRef.current) return;

      const slideIndex = selectedSlideRef.current;
      if (slideIndex < 0) return;
      const listId = activeItemListId || selectedItemListIdRef.current;
      if (!listId) return;
      const pendingDirectSlideClick = pendingDirectSlideClickRef.current;
      const isPendingDirectSlideClick =
        pendingDirectSlideClick?.listId === listId &&
        pendingDirectSlideClick.slideIndex === slideIndex;
      const clearPendingDirectSlideClick = () => {
        const current = pendingDirectSlideClickRef.current;
        if (
          current?.listId === listId &&
          current.slideIndex === slideIndex
        ) {
          pendingDirectSlideClickRef.current = null;
        }
      };
      if (
        isInitialAnchoringRef.current &&
        !options?.force &&
        !isPendingDirectSlideClick
      ) {
        return;
      }

      const scrollKey = `${listId}:${slideIndex}`;
      if (!options?.force && lastSelectionScrollKeyRef.current === scrollKey) {
        return;
      }
      lastSelectionScrollKeyRef.current = scrollKey;

      const parent = scrollRef.current;
      const childId = `item-slide-${listId}-${slideIndex}`;
      const mountedChild = document.getElementById(childId);
      beginIgnorePin(OUTLINE_SMOOTH_SCROLL_MS);

      // Tile already in the DOM (typical after browsing then clicking): one smooth
      // keep-in-view. Far/unmounted tiles: jump the virtualizer, then smooth-center.
      if (parent && mountedChild) {
        keepElementInView({
          child: mountedChild,
          parent,
          shouldScrollToCenter: true,
        });
        captureViewportAnchor();
        clearPendingDirectSlideClick();
        return;
      }

      const rowIndex = findOutlineRowIndexForItem(
        rowsRef.current,
        listId,
        slideIndex,
        rowIndexDataRef.current,
      );
      if (rowIndex < 0) {
        clearPendingDirectSlideClick();
        return;
      }

      virtualizerRef.current?.scrollToIndex(rowIndex, {
        align: "center",
        behavior: "auto",
      });

      let settled = false;
      const runKeepInView = () => {
        if (settled) return;
        const scrollParent = scrollRef.current;
        const child = document.getElementById(childId);
        if (!scrollParent || !child) return;
        keepElementInView({
          child,
          parent: scrollParent,
          shouldScrollToCenter: true,
        });
        captureViewportAnchor();
        settled = true;
        clearPendingDirectSlideClick();
      };

      const outerRaf = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(runKeepInView);
      });
      const retryTimer = window.setTimeout(() => {
        if (!settled) runKeepInView();
      }, 80);
      selectionScrollCleanupRef.current = () => {
        settled = true;
        window.cancelAnimationFrame(outerRaf);
        window.clearTimeout(retryTimer);
      };
    },
    [activeItemListId, beginIgnorePin, captureViewportAnchor, scrollRef],
  );

  // Single scroll authority for selection changes after the initial anchor.
  // Direct slide selection owns slide visibility; item-list navigation owns
  // item navigation; viewport restoration only preserves layout geometry.
  useEffect(() => {
    scrollSelectedSlideIntoView();
    return () => {
      selectionScrollCleanupRef.current?.();
      selectionScrollCleanupRef.current = null;
    };
  }, [activeItemListId, scrollSelectedSlideIntoView, selectedSlide]);

  useEffect(() => {
    return subscribeOutlineSelectionScroll(() => {
      scrollSelectedSlideIntoView({ force: true });
    });
  }, [scrollSelectedSlideIntoView]);

  const handleTileClick = useCallback(
    (
      event: React.MouseEvent,
      section: OutlineSlideSection,
      index: number,
    ) => {
      if (!section.isActive) {
        const parent = scrollRef.current;
        const clickedSlide = document.getElementById(
          `item-slide-${section.listId}-${index}`,
        );
        pendingDirectSlideClickRef.current = {
          listId: section.listId,
          slideIndex: index,
          wasVisible:
            parent != null &&
            clickedSlide != null &&
            isElementFullyVisibleWithinParent(clickedSlide, parent),
        };
        // Transmit from the already available section before activating the
        // editor item. This keeps the live path independent of navigation and
        // the pending-selection effect.
        selectSlide(index, {
          presentationOnly: true,
          presentation: {
            slides: section.slides,
            type: section.type,
            name: section.name,
            itemId: section.itemId,
            listId: section.listId,
            shouldSendTo: section.shouldSendTo,
            timerId: timersByItemId.get(section.itemId)?.id,
          },
        });
        activateItem(section.listId, { selectedSlide: index });
        return;
      }
      onSlideGridClick(event, index);
    },
    [
      activateItem,
      onSlideGridClick,
      scrollRef,
      selectSlide,
      timersByItemId,
    ],
  );

  const activeSlideIds = useMemo(
    () =>
      sections
        .find((section) => section.isActive)
        ?.slides.map((slide) => slide.id || "") ?? [],
    [sections],
  );

  return (
    <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
      <SortableContext items={activeSlideIds} strategy={rectSortingStrategy}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          const section = sectionsByListId.get(row.listId);

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              data-row-type={row.type}
              data-row-key={getOutlineVirtualRowKey(row)}
              ref={measureVirtualRow}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {row.type === "sectionLabel" && (
                <div
                  data-testid={`outline-slide-section-${row.listId}`}
                  className="flex h-9 items-center gap-2 border-b border-white/15 bg-black/50 px-1 text-sm font-semibold text-gray-100"
                >
                  <SectionTypeIcon itemType={row.itemType} />
                  <span className="min-w-0 truncate">{row.name}</span>
                </div>
              )}
              {row.type === "empty" && (
                <p className="px-1 py-1 text-xs text-gray-400">
                  No slides for this item
                </p>
              )}
              {row.type === "tiles" && section && (
                <ul className={cn("grid", sizeConfig.cols)}>
                  {section.slides
                    .slice(row.startIndex, row.startIndex + row.count)
                    .map((slide, offset) => {
                    const index = row.startIndex + offset;
                    const isActive = section.isActive;
                    return (
                      <OutlineVirtualSlide
                        key={`${section.listId}-${slide.id || index}`}
                        section={section}
                        slide={slide}
                        index={index}
                        selectedSlide={selectedSlide}
                        isLive={isActive && liveSlideIds.has(slide.id)}
                        size={size}
                        sizeConfig={sizeConfig}
                        isMobile={isMobile}
                        isStreamFormat={isStreamFormat}
                        canEdit={isActive && canEdit}
                        draggedSection={isActive ? draggedSection : null}
                        timerInfo={timersByItemId.get(section.itemId)}
                        backgroundTargetSlideIds={backgroundTargetSlideIds}
                        onTileClick={handleTileClick}
                        selectSlide={selectSlide}
                        onEnterBackgroundTargetSelectMode={
                          isActive && canEdit
                            ? onEnterBackgroundTargetSelectMode
                            : undefined
                        }
                        onRenameSection={isActive ? onRenameSection : undefined}
                        thumbnailScaleFactor={thumbnailScaleFactor}
                      />
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </SortableContext>
    </div>
  );
};

function SectionTypeIcon({ itemType }: { itemType: string }) {
  const Icon = svgMap.get(itemType) ?? File;
  return (
    <Icon
      className="h-4 w-4 shrink-0"
      style={{ color: iconColorMap.get(itemType) }}
      aria-hidden
    />
  );
}

export default OutlineItemSlidesScroller;
