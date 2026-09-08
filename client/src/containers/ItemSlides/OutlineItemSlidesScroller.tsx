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
import { File } from "lucide-react";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useDispatch, useSelector } from "../../hooks";
import { setActiveItem } from "../../store/itemSlice";
import { setActiveItemInList } from "../../store/itemListSlice";
import { useOutlineItemDocs } from "../../hooks/useOutlineItemDocs";
import { useControllerBasePath } from "../../context/activeController";
import type { ItemSlideType, TimerInfo } from "../../types";
import { svgMap, getItemTypeLabel } from "../../utils/itemTypeMaps";
import { cn } from "../../utils/cnHelper";
import {
  OUTLINE_SCROLL_SETTLE_MS,
  buildOutlineSlideSections,
  buildOutlineVirtualRows,
  getControllerItemPath,
  getNonHeadingOutlineItems,
  getPinnedListIdFromRowOffsets,
  getPrefetchItemIds,
  prepareItemForEditor,
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
  const activeItem = useSelector((state) => state.undoable.present.item);

  const outlineItems = useMemo(
    () => getNonHeadingOutlineItems(outlineList),
    [outlineList],
  );
  const prefetchIds = useMemo(
    () => getPrefetchItemIds(outlineItems, selectedItemListId),
    [outlineItems, selectedItemListId],
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
    overscan: 3,
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

  const selectionSourceRef = useRef<"scroll" | "external">("external");
  const lastPinnedListIdRef = useRef(selectedItemListId);
  const settleTimerRef = useRef<number | null>(null);
  const pendingSelectRef = useRef<{ listId: string; index: number } | null>(
    null,
  );
  const didInitialScrollRef = useRef(false);
  const ignorePinRef = useRef(true);
  const pinRafRef = useRef<number | null>(null);

  const activateItem = useCallback(
    (listId: string, mode: "immediate" | "settled") => {
      const item = outlineItems.find((entry) => entry.listId === listId);
      if (!item) return;
      lastPinnedListIdRef.current = listId;
      dispatch(setActiveItemInList(listId));
      const finish = () => {
        const doc = docsById.get(item._id);
        if (doc) {
          dispatch(setActiveItem(prepareItemForEditor(doc, listId)));
        }
        navigate(getControllerItemPath(item, controllerBasePath), { replace: true });
      };
      if (mode === "immediate") {
        if (settleTimerRef.current != null) {
          window.clearTimeout(settleTimerRef.current);
          settleTimerRef.current = null;
        }
        finish();
        return;
      }
      if (settleTimerRef.current != null) {
        window.clearTimeout(settleTimerRef.current);
      }
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        if (lastPinnedListIdRef.current !== listId) return;
        finish();
      }, OUTLINE_SCROLL_SETTLE_MS);
    },
    [dispatch, docsById, navigate, outlineItems, controllerBasePath],
  );

  const pinFromScroll = useCallback(
    (listId: string) => {
      if (!listId || listId === lastPinnedListIdRef.current) return;
      selectionSourceRef.current = "scroll";
      activateItem(listId, "settled");
    },
    [activateItem],
  );

  const readPinnedListId = useCallback(() => {
    const scrollTop = scrollRef.current?.scrollTop ?? 0;
    return getPinnedListIdFromRowOffsets(
      rowsRef.current,
      (index) => virtualizerRef.current.getOffsetForIndex(index)?.[0] ?? 0,
      scrollTop,
    );
  }, [scrollRef]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onScroll = () => {
      if (!didInitialScrollRef.current || ignorePinRef.current) return;
      if (pinRafRef.current != null) return;
      pinRafRef.current = window.requestAnimationFrame(() => {
        pinRafRef.current = null;
        const pinned = readPinnedListId();
        if (pinned) pinFromScroll(pinned);
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
  }, [pinFromScroll, readPinnedListId, scrollRef]);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current != null) {
        window.clearTimeout(settleTimerRef.current);
      }
    };
  }, []);

  const scrollToListId = useCallback((listId: string | undefined) => {
    if (!listId) return;
    const rowIndex = rowsRef.current.findIndex(
      (row) => row.type === "sectionLabel" && row.listId === listId,
    );
    if (rowIndex < 0) return;
    ignorePinRef.current = true;
    virtualizerRef.current.scrollToIndex(rowIndex, { align: "start" });
    window.requestAnimationFrame(() => {
      ignorePinRef.current = false;
    });
  }, []);

  useLayoutEffect(() => {
    if (didInitialScrollRef.current || rows.length === 0) return;
    didInitialScrollRef.current = true;
    lastPinnedListIdRef.current = selectedItemListId;
    scrollToListId(selectedItemListId);
  }, [rows.length, scrollToListId, selectedItemListId]);

  useEffect(() => {
    if (selectionSourceRef.current === "scroll") {
      selectionSourceRef.current = "external";
      lastPinnedListIdRef.current = selectedItemListId;
      return;
    }
    lastPinnedListIdRef.current = selectedItemListId;
    scrollToListId(selectedItemListId);
  }, [scrollToListId, selectedItemListId]);

  useEffect(() => {
    const pending = pendingSelectRef.current;
    if (!pending) return;
    if (pending.listId !== activeItem.listId) return;
    pendingSelectRef.current = null;
    selectSlide(pending.index);
  }, [activeItem.listId, activeItem._id, selectSlide]);

  const handleTileClick = useCallback(
    (
      event: React.MouseEvent,
      section: OutlineSlideSection,
      index: number,
    ) => {
      if (!section.isActive) {
        pendingSelectRef.current = { listId: section.listId, index };
        selectionSourceRef.current = "external";
        activateItem(section.listId, "immediate");
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
                  <span className="shrink-0 text-xs font-normal text-gray-400">
                    {getItemTypeLabel(row.itemType)}
                  </span>
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
                        timerInfo={
                          timers.find((timer) => timer.id === section.itemId) ??
                          undefined
                        }
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
                        getBibleInfo={(slideIndex) =>
                          getBibleInfoFromSlides(section.slides, slideIndex)
                        }
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
  return <Icon className="h-4 w-4 shrink-0 text-gray-300" aria-hidden />;
}

export default OutlineItemSlidesScroller;
