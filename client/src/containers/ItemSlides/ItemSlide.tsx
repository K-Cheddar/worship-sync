import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import { ItemSlideType, TimerInfo } from "../../types";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import cn from "classnames";
import MultiSelectSubsetTick from "../../components/MultiSelectSubsetTick/MultiSelectSubsetTick";
import { memo, useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import type { FormattedSection } from "../../types";
import { getFreeSectionDisplayName, getFreeSectionNumber } from "../../utils/freeSectionNames";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import FloatingWindow from "../../components/FloatingWindow/FloatingWindow";
import LocalVideoInputSlideBadge from "../../components/LocalVideoInputSlideBadge/LocalVideoInputSlideBadge";
import { useSelector } from "../../hooks";
import { RootState } from "../../store/store";
import { useDroppable } from "@dnd-kit/core";
import { type SlideDragData, type SlideInsertData } from "../../utils/presentationDnd";
import StaticSlideThumbnail from "./StaticSlideThumbnail";

/** Stable empty list: a fresh [] re-renders every slide on any action. */
const EMPTY_SLIDE_IDS: string[] = [];

type ItemSlideProps = {
  slide: ItemSlideType;
  index: number;
  selectSlide: (
    index: number,
    options?: { preserveBackgroundTargetRangeAnchor?: boolean },
  ) => void;
  isSelected: boolean;
  size: number;
  itemType: string;
  isMobile: boolean;
  timerInfo?: TimerInfo;
  draggedSection: string | null;
  /** True when this slide matches last-sent presentation for enabled outputs. */
  isLive: boolean;
  isStreamFormat: boolean;
  getBibleInfo: (index: number) => { title: string; text: string };
  borderWidth: string;
  hSize: string;
  canEdit?: boolean;
  isBackgroundTargetSelected?: boolean;
  onSlideGridClick: (e: React.MouseEvent, index: number) => void;
  /** Long-press (touch) or right-click enters background-target selection mode from this slide. */
  onEnterBackgroundTargetSelectMode?: (
    index: number,
    options?: { skipNextClick?: boolean },
  ) => void;
  /** Override the default `item-slide-${index}` DOM id for multi-item rails. */
  slideDomId?: string;
  /** Enables zero-footprint media insertion zones for the auxiliary controller. */
  mediaInsertEnabled?: boolean;
  formattedSections?: FormattedSection[];
  onRenameSection?: (sectionNum: number, name: string) => void;
  isDragOverlay?: boolean;
  thumbnailScaleFactor?: number;
};

const MediaSlideInsertTarget = ({
  index,
  position,
  enabled,
}: {
  index: number;
  position: "top" | "bottom";
  enabled: boolean;
}) => {
  const { setNodeRef } = useDroppable({
    // Top and bottom targets can share an insertion index, but dnd-kit still
    // requires every registered droppable to have its own ID.
    id: `slide-insert-${index}-${position}`,
    data: { kind: "slide-insert", index } satisfies SlideInsertData,
    // Keep targets registered before activation so dnd-kit measures them at
    // drag start. Collision detection filters them out for slide drags.
    disabled: !enabled,
  });
  return (
    <div
      ref={setNodeRef}
      aria-hidden="true"
      data-testid="media-slide-insert-target"
      className={cn(
        "pointer-events-none absolute inset-x-0 z-20 h-1/2",
        position === "top" ? "top-0" : "bottom-0",
      )}
    >
    </div>
  );
};

const ItemSlide = ({
  isLive,
  slide,
  index,
  selectSlide,
  isSelected,
  size,
  itemType,
  isMobile,
  timerInfo,
  draggedSection,
  isStreamFormat,
  getBibleInfo,
  borderWidth,
  hSize,
  canEdit = true,
  isBackgroundTargetSelected = false,
  onSlideGridClick,
  onEnterBackgroundTargetSelectMode,
  slideDomId,
  mediaInsertEnabled = false,
  formattedSections = [],
  onRenameSection,
  isDragOverlay = false,
  thumbnailScaleFactor = 0,
}: ItemSlideProps) => {
  const backgroundTargetSlideIds = useSelector(
    (state: RootState) =>
      state.undoable.present.item.backgroundTargetSlideIds ?? EMPTY_SLIDE_IDS,
  );
  const mobileBackgroundTargetSelectMode = useSelector(
    (state: RootState) =>
      state.undoable.present.item.mobileBackgroundTargetSelectMode ?? false,
  );

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: slide.id || "",
    disabled: isDragOverlay || !canEdit,
    data: {
      kind: "slide",
      slideId: slide.id || "",
    } satisfies SlideDragData,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isFree = itemType === "free";
  const freeSectionNumber = isFree ? getFreeSectionNumber(slide) : null;
  const displayName =
    isFree ? getFreeSectionDisplayName(slide, formattedSections) : slide.name;
  const customSectionName = formattedSections.find(
    (section) => section.sectionNum === freeSectionNumber,
  )?.name;
  const [isEditingName, setIsEditingName] = useState(false);
  const nameHeaderRef = useRef<HTMLHeadingElement>(null);
  const [renamePosition, setRenamePosition] = useState({ x: 0, y: 0 });
  const [nameDraft, setNameDraft] = useState(
    customSectionName?.trim() ||
      (freeSectionNumber == null ? displayName : `Section ${freeSectionNumber}`),
  );

  useEffect(() => {
    if (!isEditingName) {
      setNameDraft(
        customSectionName?.trim() ||
          (freeSectionNumber == null
            ? displayName
            : `Section ${freeSectionNumber}`),
      );
    }
  }, [customSectionName, displayName, freeSectionNumber, isEditingName]);

  const saveSectionName = () => {
    if (freeSectionNumber == null || !onRenameSection) return;
    onRenameSection(freeSectionNumber, nameDraft.trim());
    setIsEditingName(false);
  };

  const cancelSectionName = () => {
    setNameDraft(
      customSectionName?.trim() ||
        (freeSectionNumber == null ? displayName : `Section ${freeSectionNumber}`),
    );
    setIsEditingName(false);
  };

  const openSectionNameEditor = () => {
    const headerRect = nameHeaderRef.current?.getBoundingClientRect();
    if (headerRect) {
      const windowWidth = 320;
      const windowHeight = 220;
      const gap = 4;
      const fitsBelow =
        headerRect.bottom + gap + windowHeight <= window.innerHeight;
      setRenamePosition({
        x: Math.min(
          Math.max(headerRect.left, 0),
          Math.max(window.innerWidth - windowWidth, 0),
        ),
        y: fitsBelow
          ? headerRect.bottom + gap
          : Math.max(headerRect.top - windowHeight - gap, 0),
      });
    }
    setIsEditingName(true);
  };

  const showBackgroundTargetSelectionChrome =
    canEdit &&
    (mobileBackgroundTargetSelectMode || backgroundTargetSlideIds.length > 0);

  // Check if this slide is in the same section as the dragged slide
  const sectionMatch = slide.name?.match(/Section (\d+)/);
  const isInDraggedSection = sectionMatch && sectionMatch[1] === draggedSection;

  // Apply transform to all slides in the same section while preserving the dragged slide's animation
  const sectionStyle =
    isInDraggedSection && !isDragging
      ? {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: 0.5,
      }
      : undefined;

  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_PX = 10;
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => () => clearLongPressTimer(), []);

  const handleSlideContextMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!canEdit) return;
    if (onEnterBackgroundTargetSelectMode) {
      if (!isFree && e.shiftKey) {
        if (!isSelected) {
          selectSlide(index);
        }
        return;
      }
      onEnterBackgroundTargetSelectMode(index);
    }
  };

  return (
    <li
      ref={setNodeRef}
      style={(() => {
        const borderStyle = {
          "--border-width": borderWidth,
          borderWidth: "var(--border-width)",
        } as React.CSSProperties;
        if (!isFree) {
          return borderStyle;
        }
        if (isDragging) {
          return { ...style, ...borderStyle };
        }
        if (isInDraggedSection) {
          return { ...sectionStyle, ...borderStyle };
        }
        return borderStyle;
      })()}
      {...(isFree && canEdit ? attributes : {})}
      {...(isFree && canEdit ? listeners : {})}
      key={slide.id}
      className={cn(
        "relative cursor-pointer select-none w-full rounded-lg transition-[background-color,box-shadow] duration-150 ease-out",
        isDragging && !isDragOverlay && "opacity-30",
        isDragOverlay && "pointer-events-none shadow-2xl scale-[1.02]",
        !isDragging &&
        "hover:bg-white/12 hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)]",
        (isSelected || isBackgroundTargetSelected) && "border-cyan-500",
        !(isSelected || isBackgroundTargetSelected) && "border-transparent",
        isInDraggedSection && "z-10"
      )}
      id={slideDomId ?? `item-slide-${index}`}
    >
      <MediaSlideInsertTarget
        index={index}
        position="top"
        enabled={mediaInsertEnabled}
      />
      <MediaSlideInsertTarget
        index={index + 1}
        position="bottom"
        enabled={mediaInsertEnabled}
      />
      <div
        className="relative"
        onContextMenu={handleSlideContextMenu}
        onClick={(e) => onSlideGridClick(e, index)}
        onPointerDown={(e) => {
          if (
            e.pointerType !== "touch" ||
            !canEdit ||
            !onEnterBackgroundTargetSelectMode
          ) {
            return;
          }
          longPressStartRef.current = { x: e.clientX, y: e.clientY };
          clearLongPressTimer();
          longPressTimerRef.current = window.setTimeout(() => {
            longPressTimerRef.current = null;
            longPressStartRef.current = null;
            onEnterBackgroundTargetSelectMode(index, {
              skipNextClick: true,
            });
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(e) => {
          if (
            e.pointerType !== "touch" ||
            longPressTimerRef.current == null ||
            !longPressStartRef.current
          ) {
            return;
          }
          const { x, y } = longPressStartRef.current;
          if (
            Math.abs(e.clientX - x) > LONG_PRESS_MOVE_PX ||
            Math.abs(e.clientY - y) > LONG_PRESS_MOVE_PX
          ) {
            clearLongPressTimer();
            longPressStartRef.current = null;
          }
        }}
        onPointerUp={(e) => {
          if (e.pointerType !== "touch") return;
          clearLongPressTimer();
          longPressStartRef.current = null;
        }}
        onPointerCancel={(e) => {
          if (e.pointerType !== "touch") return;
          clearLongPressTimer();
          longPressStartRef.current = null;
        }}
      >
        <MultiSelectSubsetTick
          modeActive={showBackgroundTargetSelectionChrome}
          isSelected={isBackgroundTargetSelected}
          frameClassName="absolute left-1 top-1 z-1 flex h-6 w-6 items-center justify-center"
          checkClassName="h-3.5 w-3.5 shrink-0 stroke-[3]"
        />
        {isLive ? (
          <span
            className="pointer-events-none absolute bottom-1 right-1 z-1 rounded bg-green-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow"
            aria-label="Live on output"
          >
            Live
          </span>
        ) : null}
        <h4
          ref={nameHeaderRef}
          className={cn(
            "rounded-t-md px-2 text-center flex w-full items-center gap-1",
            hSize,
            itemSectionBgColorMap.get(slide.type)
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            {displayName?.split(/\u200B(.*?)\u200B/).map((part, index) => {
            // Even indices are regular text, odd indices are special parts
            if (index % 2 === 1) {
              return (
                <span key={index} className="text-gray-400">
                  {part}
                </span>
              );
            }
            if (part.trim()) {
              return (
                <span className="flex-1" key={index}>
                  {part}
                </span>
              );
            }
            return null;
            })}
          </span>
          {isFree && canEdit && onRenameSection ? (
            <button
              type="button"
              aria-label="Rename section"
              title="Rename section"
              className="ml-1 shrink-0 rounded p-0.5 opacity-70 hover:bg-white/15 hover:opacity-100 focus-visible:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                openSectionNameEditor();
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Pencil className="h-3 w-3" aria-hidden />
            </button>
          ) : null}
        </h4>
        <StaticSlideThumbnail
          slide={slide}
          itemType={itemType}
          isStreamFormat={isStreamFormat}
          timerInfo={timerInfo}
          scaleFactor={thumbnailScaleFactor}
          bibleInfo={
            itemType === "bible" ? getBibleInfo(index) : undefined
          }
        />
        {slide.mediaSource?.kind === "local-video-input" ? (
          <LocalVideoInputSlideBadge
            label={slide.mediaSource.label}
            captureKind={slide.mediaSource.captureKind}
          />
        ) : null}
      </div>
      {isFree && isEditingName && onRenameSection ? (
        <div
          data-no-dnd
          data-testid="section-rename-window"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <FloatingWindow
            title="Edit section name"
            onClose={cancelSectionName}
            defaultWidth={320}
            defaultHeight={220}
            defaultPosition={renamePosition}
            autoHeight
          >
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                saveSectionName();
              }}
            >
              <Input
                label="Section name"
                value={nameDraft}
                onChange={(value) => setNameDraft(String(value))}
                placeholder="Name"
                inputTextSize="text-sm"
                inputWidth="w-full"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="tertiary" onClick={cancelSectionName}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="cta"
                  onClick={saveSectionName}
                >
                  Save
                </Button>
              </div>
            </form>
          </FloatingWindow>
        </div>
      ) : null}
    </li>
  );
};

export default memo(ItemSlide);
