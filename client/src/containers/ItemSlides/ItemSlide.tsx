import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";

import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import { ItemSlideType, TimerInfo } from "../../types";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import cn from "classnames";
import ContextMenu from "../../components/ContextMenu/ContextMenu";
import { ImageOff } from "lucide-react";
import { useDispatch } from "../../hooks";
import { updateSlideBackground } from "../../store/itemSlice";
import { memo, useContext } from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useSelector } from "../../hooks";
import { RootState } from "../../store/store";

type ItemSlideProps = {
  slide: ItemSlideType;
  index: number;
  selectSlide: (index: number) => void;
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
}: ItemSlideProps) => {
  const dispatch = useDispatch();
  const { db } = useContext(ControllerInfoContext) || {};
  const isLoading = useSelector(
    (state: RootState) => state.undoable.present.item.isLoading
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

  const contextMenuItems = canEdit
    ? [
      {
        label: "Clear Background",
        onClick: () => {
          if (db) {
            dispatch(
              updateSlideBackground({
                background: "",
              })
            );
          }
        },
        icon: <ImageOff className="w-4 h-4" />,
        disabled: isLoading,
      },
    ]
    : [];

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
        "cursor-pointer w-full rounded-lg transition-[background-color,box-shadow] duration-150 ease-out",
        !isDragging &&
        "hover:bg-white/12 hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)]",
        isSelected && "border-cyan-500",
        !isSelected && "border-transparent",
        isInDraggedSection && "z-10"
      )}
      id={`item-slide-${index}`}
    >
      <ContextMenu
        menuItems={contextMenuItems}
        header={{
          title: slide.name || `Slide ${index + 1}`,
          subtitle: "Item Slide",
        }}
        onOpen={() => {
          if (!isSelected) {
            selectSlide(index);
          }
        }}
      >
        <div className="relative" onClick={() => selectSlide(index)}>
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
      </ContextMenu>
    </li>
  );
};

export default memo(ItemSlide);
