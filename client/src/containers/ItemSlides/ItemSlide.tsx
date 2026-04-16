import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";

import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import { ItemSlideType, TimerInfo } from "../../types";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import cn from "classnames";
import MultiSelectSubsetTick from "../../components/MultiSelectSubsetTick/MultiSelectSubsetTick";
import { memo, useEffect, useRef } from "react";
import { useSelector } from "../../hooks";
import { RootState } from "../../store/store";

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
}: ItemSlideProps) => {
  const backgroundTargetSlideIds = useSelector(
    (state: RootState) =>
      state.undoable.present.item.backgroundTargetSlideIds ?? [],
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
    disabled: !canEdit,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isFree = itemType === "free";

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
        "cursor-pointer select-none w-full rounded-lg transition-[background-color,box-shadow] duration-150 ease-out",
        !isDragging &&
        "hover:bg-white/12 hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)]",
        (isSelected || isBackgroundTargetSelected) && "border-cyan-500",
        !(isSelected || isBackgroundTargetSelected) && "border-transparent",
        isInDraggedSection && "z-10"
      )}
      id={`item-slide-${index}`}
    >
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
          frameClassName="absolute left-1 top-1 z-30 flex h-6 w-6 items-center justify-center"
          checkClassName="h-3.5 w-3.5 shrink-0 stroke-[3]"
        />
        {isLive ? (
          <span
            className="pointer-events-none absolute bottom-1 right-1 z-20 rounded bg-green-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow"
            aria-label="Live on output"
          >
            Live
          </span>
        ) : null}
        <h4
          className={cn(
            "rounded-t-md truncate px-2 text-center flex w-full",
            hSize,
            itemSectionBgColorMap.get(slide.type)
          )}
        >
          {slide.name?.split(/\u200B(.*?)\u200B/).map((part, index) => {
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
        </h4>
        <DisplayWindow
          showBorder
          boxes={
            isStreamFormat && (itemType === "free" || itemType === "bible")
              ? []
              : slide.boxes
          }
          displayType={isStreamFormat ? "stream" : "slide"}
          timerInfo={timerInfo}
          bibleDisplayInfo={
            itemType === "bible" ? getBibleInfo(index) : undefined
          }
          formattedTextDisplayInfo={
            itemType === "free"
              ? {
                text: slide.boxes[1]?.words?.trim() || "",
                backgroundColor:
                  slide.formattedTextDisplayInfo?.backgroundColor || "#eb8934",
                textColor:
                  slide.formattedTextDisplayInfo?.textColor || "#ffffff",
                fontSize: slide.formattedTextDisplayInfo?.fontSize || 1.5,
                paddingX: slide.formattedTextDisplayInfo?.paddingX || 2,
                paddingY: slide.formattedTextDisplayInfo?.paddingY || 1,
                isBold: slide.formattedTextDisplayInfo?.isBold || false,
                isItalic: slide.formattedTextDisplayInfo?.isItalic || false,
                align: slide.formattedTextDisplayInfo?.align || "left",
              }
              : undefined
          }
        />
      </div>
    </li>
  );
};

export default memo(ItemSlide);
