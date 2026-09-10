import { useVirtualizer } from "@tanstack/react-virtual";
import {
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
import type { Arrangment, ItemSlideType, TimerInfo } from "../../types";
import { iconColorMap, svgMap } from "../../utils/itemTypeMaps";
import { cn } from "../../utils/cnHelper";
import { keepElementInView } from "../../utils/generalUtils";
import {
  OUTLINE_INITIAL_ANCHOR_MS,
  OUTLINE_SCROLL_SETTLE_MS,
  OUTLINE_SMOOTH_SCROLL_MS,
  buildOutlineSlideSections,
  buildOutlineVirtualRows,
  captureOutlineScrollAnchor,
  findOutlineRowIndexForItem,
  getControllerItemPath,
  getNonHeadingOutlineItems,
  getPinnedListIdFromRowOffsets,
  getPrefetchItemIds,
  prepareItemForEditor,
  resolveOutlineScrollTopFromAnchor,
  type OutlineScrollAnchor,
  type OutlineSlideSection,
} from "../../utils/outlineSlideSections";
import ItemSlide from "./ItemSlide";

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
    options?: { preserveBackgroundTargetRangeAnchor?: boolean },
  ) => void;
  onSlideGridClick: (e: React.MouseEvent, index: number) => void;
  onEnterBackgroundTargetSelectMode?: (
    index: number,
    options?: { skipNextClick?: boolean },
  ) => void;
};

type OutlineActiveItemSource = {
  _id?: string;
  listId?: string;
  name?: string;
  type?: string;
  slides?: ItemSlideType[];
  arrangements?: Arrangment[];
  selectedArrangement?: number;
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
    };
  }, shallowEqual);
  const activeItemListId = activeItem.listId;
  const activeItemId = activeItem._id;

  const outlineItems = useMemo(
    () => getNonHeadingOutlineItems(outlineList),
    [outlineList],
  );
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
      }),
    [outlineItems, activeItem, docsById],
  );
  const sectionsByListId = useMemo(() => {
    const map = new Map<string, OutlineSlideSection>();
    for (const section of sections) map.set(section.listId, section);
    return map;
  }, [sections]);

  const rows = useMemo(
    () => buildOutlineVirtualRows(sections, cols),
    [sections, cols],
  );
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const timersByItemId = useMemo(() => {
    const map = new Map<string, TimerInfo>();
    for (const timer of timers) {
      if (timer.id) map.set(timer.id, timer);
    }
    return map;
  }, [timers]);

  const [tileRowHeight, setTileRowHeight] = useState(INITIAL_TILE_ROW_HEIGHT);
  const tileRowHeightRef = useRef(tileRowHeight);
  tileRowHeightRef.current = tileRowHeight;
  const shouldSyncTileRowHeightRef = useRef(true);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rowsRef.current[index];
      if (row?.type === "sectionLabel") return SECTION_LABEL_HEIGHT;
      if (row?.type === "empty") return EMPTY_ROW_HEIGHT;
      return tileRowHeightRef.current;
    },
    overscan: 2,
    gap: ROW_GAP,
    initialRect: { width: 0, height: 600 },
  });
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  const prevTileRowHeightRef = useRef(tileRowHeight);
  useLayoutEffect(() => {
    if (prevTileRowHeightRef.current !== tileRowHeight) {
      prevTileRowHeightRef.current = tileRowHeight;
      virtualizerRef.current.measure();
    }
  }, [tileRowHeight]);

  const prevColsRef = useRef(cols);
  useLayoutEffect(() => {
    if (prevColsRef.current !== cols) {
      prevColsRef.current = cols;
      shouldSyncTileRowHeightRef.current = true;
      setTileRowHeight(INITIAL_TILE_ROW_HEIGHT);
      prevTileRowHeightRef.current = INITIAL_TILE_ROW_HEIGHT;
      virtualizerRef.current.measure();
    }
  }, [cols]);

  const targetListId =
    selectedItemListId || activeItemListId || undefined;
  const lastPinnedListIdRef = useRef(targetListId);
  const selectedItemListIdRef = useRef(targetListId);
  selectedItemListIdRef.current = targetListId;
  const selectedSlideRef = useRef(selectedSlide);
  selectedSlideRef.current = selectedSlide;
  const ignorePinTimerRef = useRef<number | null>(null);
  const initialAnchorTimerRef = useRef<number | null>(null);
  const pendingSelectRef = useRef<{ listId: string; index: number } | null>(
    null,
  );
  const lastSelectionScrollKeyRef = useRef<string>("");
  const didInitialScrollRef = useRef(false);
  const isInitialAnchoringRef = useRef(false);
  const ignorePinRef = useRef(true);
  const pinRafRef = useRef<number | null>(null);
  const viewportAnchorRef = useRef<OutlineScrollAnchor | null>(null);

  const readRowOffset = useCallback((rowIndex: number) => {
    if (rowIndex < 0) return null;
    return virtualizerRef.current.getOffsetForIndex(rowIndex)?.[0] ?? null;
  }, []);

  const readRowStart = useCallback(
    (index: number) => virtualizerRef.current.getOffsetForIndex(index)?.[0] ?? 0,
    [],
  );

  const captureViewportAnchor = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    viewportAnchorRef.current = captureOutlineScrollAnchor(
      rowsRef.current,
      readRowStart,
      element.scrollTop,
    );
  }, [readRowStart, scrollRef]);

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
      const item = outlineItems.find((entry) => entry.listId === listId);
      if (!item) return;
      beginIgnorePin(OUTLINE_SMOOTH_SCROLL_MS);
      lastPinnedListIdRef.current = listId;
      setBrowsePinListId(listId);
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
      outlineItems,
      controllerBasePath,
    ],
  );

  const readPinnedListId = useCallback(() => {
    const scrollTop = scrollRef.current?.scrollTop ?? 0;
    return getPinnedListIdFromRowOffsets(
      rowsRef.current,
      readRowStart,
      scrollTop,
    );
  }, [readRowStart, scrollRef]);

  // Keep a viewport row anchor for geometry rebuilds. Manual scroll also updates
  // prefetch focus, but must not change the selected item/slide.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onScroll = () => {
      captureViewportAnchor();
      if (!didInitialScrollRef.current || ignorePinRef.current) return;
      if (pinRafRef.current != null) return;
      pinRafRef.current = window.requestAnimationFrame(() => {
        pinRafRef.current = null;
        const pinned = readPinnedListId();
        if (!pinned || pinned === browsePinListIdRef.current) return;
        browsePinListIdRef.current = pinned;
        setBrowsePinListId(pinned);
      });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      if (pinRafRef.current != null) {
        window.cancelAnimationFrame(pinRafRef.current);
        pinRafRef.current = null;
      }
    };
  }, [captureViewportAnchor, readPinnedListId, scrollRef]);

  useEffect(() => {
    return () => {
      if (ignorePinTimerRef.current != null) {
        window.clearTimeout(ignorePinTimerRef.current);
      }
      if (initialAnchorTimerRef.current != null) {
        window.clearTimeout(initialAnchorTimerRef.current);
      }
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
        virtualizerRef.current.scrollToIndex(rowIndex, {
          align: "start",
          behavior: "auto",
        });
        if (Math.abs(element.scrollTop - offset) > 1) {
          element.scrollTop = offset;
        }
      } else {
        virtualizerRef.current.scrollToIndex(rowIndex, {
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

  useLayoutEffect(() => {
    if (rows.length === 0) return;
    const listId = selectedItemListIdRef.current;
    if (!listId) return;

    const tryScroll = () => {
      // Parent attaches the scroll element ref; child layout can run first.
      if (!scrollRef.current) return false;
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

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let lastHeight = element.clientHeight;
    const observer = new ResizeObserver(() => {
      const nextHeight = element.clientHeight;
      if (nextHeight <= 0) return;
      const heightChanged = nextHeight !== lastHeight;
      lastHeight = nextHeight;
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
    return () => observer.disconnect();
  }, [applyPinnedScroll, extendInitialAnchoring, scrollRef]);

  // After the initial anchor window, restore the visible row when virtual
  // geometry rebuilds (remote doc updates, prefetch, tile-height sync). Do not
  // pin to selection — the operator may have scrolled elsewhere. Selection
  // keep-in-view still runs afterward when the chosen slide changes.
  useLayoutEffect(() => {
    if (!didInitialScrollRef.current || isInitialAnchoringRef.current) return;

    const restore = () => {
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
  }, [captureViewportAnchor, readRowStart, rows, scrollRef, tileRowHeight]);

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

  // Single scroll authority for selection changes after the initial anchor.
  // Avoid stacking virtualizer smooth + keepElementInView smooth, and wait out
  // any pending cross-item click until the final slide index is applied.
  useEffect(() => {
    if (!didInitialScrollRef.current || isInitialAnchoringRef.current) return;
    if (selectedSlide < 0) return;
    const listId = activeItemListId || selectedItemListIdRef.current;
    if (!listId) return;

    const pending = pendingSelectRef.current;
    if (pending) {
      if (pending.listId !== listId || pending.index !== selectedSlide) {
        return;
      }
    }

    const scrollKey = `${listId}:${selectedSlide}`;
    if (lastSelectionScrollKeyRef.current === scrollKey) return;
    lastSelectionScrollKeyRef.current = scrollKey;

    const parent = scrollRef.current;
    const childId = `item-slide-${listId}-${selectedSlide}`;
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
      return;
    }

    const rowIndex = findOutlineRowIndexForItem(
      rowsRef.current,
      listId,
      selectedSlide,
    );
    if (rowIndex < 0) return;

    virtualizerRef.current.scrollToIndex(rowIndex, {
      align: "center",
      behavior: "auto",
    });

    const runKeepInView = () => {
      const scrollParent = scrollRef.current;
      const child = document.getElementById(childId);
      if (!scrollParent || !child) return;
      keepElementInView({
        child,
        parent: scrollParent,
        shouldScrollToCenter: true,
      });
      captureViewportAnchor();
    };

    const outerRaf = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(runKeepInView);
    });
    const retryTimer = window.setTimeout(runKeepInView, 80);
    return () => {
      window.cancelAnimationFrame(outerRaf);
      window.clearTimeout(retryTimer);
    };
  }, [
    activeItemListId,
    beginIgnorePin,
    captureViewportAnchor,
    scrollRef,
    selectedSlide,
  ]);

  useEffect(() => {
    const pending = pendingSelectRef.current;
    if (!pending) return;
    if (pending.listId !== activeItemListId) return;
    pendingSelectRef.current = null;
    selectSlide(pending.index);
  }, [activeItemListId, activeItemId, selectSlide]);

  const handleTileClick = useCallback(
    (
      event: React.MouseEvent,
      section: OutlineSlideSection,
      index: number,
    ) => {
      if (!section.isActive) {
        pendingSelectRef.current = { listId: section.listId, index };
        // Apply the clicked slide immediately so we never scroll toward the
        // previous item's slide index (or slide 0) before selectSlide runs.
        activateItem(section.listId, { selectedSlide: index });
        return;
      }
      onSlideGridClick(event, index);
    },
    [activateItem, onSlideGridClick],
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
              key={`${row.type}-${row.listId}-${virtualRow.index}`}
              data-index={virtualRow.index}
              ref={(el) => {
                virtualizer.measureElement(el);
                if (
                  el &&
                  row.type === "tiles" &&
                  shouldSyncTileRowHeightRef.current
                ) {
                  const height = el.getBoundingClientRect().height;
                  if (height > 0) {
                    shouldSyncTileRowHeightRef.current = false;
                    if (Math.abs(height - tileRowHeightRef.current) > 1) {
                      setTileRowHeight(height);
                    }
                  }
                }
              }}
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
                  {row.slides.map((slide, offset) => {
                    const index = row.startIndex + offset;
                    const isActive = section.isActive;
                    return (
                      <ItemSlide
                        key={`${section.listId}-${slide.id || index}`}
                        timerInfo={timersByItemId.get(section.itemId)}
                        slide={slide}
                        index={index}
                        selectSlide={selectSlide}
                        isSelected={isActive && index === selectedSlide}
                        isLive={isActive && liveSlideIds.has(slide.id)}
                        size={size}
                        itemType={section.type}
                        isMobile={isMobile}
                        draggedSection={isActive ? draggedSection : null}
                        isStreamFormat={isStreamFormat}
                        getBibleInfo={getBibleInfoGetter(section.slides)}
                        borderWidth={sizeConfig.borderWidth}
                        hSize={sizeConfig.hSize}
                        canEdit={isActive && canEdit}
                        isBackgroundTargetSelected={
                          isActive &&
                          backgroundTargetSlideIds.includes(slide.id)
                        }
                        slideDomId={`item-slide-${section.listId}-${index}`}
                        onSlideGridClick={(event) =>
                          handleTileClick(event, section, index)
                        }
                        onEnterBackgroundTargetSelectMode={
                          isActive && canEdit
                            ? onEnterBackgroundTargetSelectMode
                            : undefined
                        }
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
