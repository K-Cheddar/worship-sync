import { useEffect, useRef, type MouseEvent } from "react";
import Button from "../../components/Button/Button";
import MultiSelectSubsetTick from "../../components/MultiSelectSubsetTick/MultiSelectSubsetTick";
import MediaTypeBadge from "./MediaTypeBadge";
import cn from "classnames";
import type { MediaType } from "../../types";
import { getMediaLibraryOriginBadgeLabel } from "./mediaLibraryOrigin";
import { useDraggable } from "@dnd-kit/core";
import type { MediaDragData } from "../../utils/presentationDnd";
import MediaLibraryMediaVisual from "./MediaLibraryMediaVisual";

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_PX = 10;

export type MediaLibraryGridMediaTileProps = {
  mediaItem: MediaType;
  index: number;
  isSelected: boolean;
  isMultiSelected: boolean;
  /** When true, show a top-left selection ring / cyan check on the thumbnail. */
  mediaMultiSelectMode: boolean;
  onMediaTileClick: (
    e: MouseEvent,
    mediaItem: MediaType,
    index: number,
  ) => void;
  onEnterMediaMultiSelectMode: (
    mediaItem: MediaType,
    index: number,
    options?: { skipNextClick?: boolean },
  ) => void;
  /** Optional label row under the thumbnail */
  showBottomName?: boolean;
  bottomNameClassName?: string;
  imageContainerClassName?: string;
  mediaDragEnabled?: boolean;
  orderedSelectedMediaIds?: string[];
};

export default function MediaLibraryGridMediaTile({
  mediaItem,
  index,
  isSelected,
  isMultiSelected,
  mediaMultiSelectMode,
  onMediaTileClick,
  onEnterMediaMultiSelectMode,
  showBottomName = false,
  bottomNameClassName = "text-sm text-gray-300",
  imageContainerClassName,
  mediaDragEnabled = false,
  orderedSelectedMediaIds = [],
}: MediaLibraryGridMediaTileProps) {
  const { id, name, type } = mediaItem;
  const shownName = name.includes("/")
    ? name.split("/").slice(1).join("/")
    : name;
  const originBadgeLabel = getMediaLibraryOriginBadgeLabel(mediaItem);

  const dragMediaIds =
    isMultiSelected && orderedSelectedMediaIds.length > 0
      ? orderedSelectedMediaIds
      : [id];
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `media-${id}`,
      disabled: !mediaDragEnabled,
      data: {
        kind: "media",
        mediaIds: dragMediaIds,
      } satisfies MediaDragData,
    });

  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => () => clearLongPressTimer(), []);

  const defaultImageWrap =
    "relative flex aspect-video w-full items-center justify-center overflow-hidden border-b border-gray-500";

  return (
    <div
      ref={setNodeRef}
      {...(mediaDragEnabled ? attributes : {})}
      {...(mediaDragEnabled ? listeners : {})}
      style={
        transform
          ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
          : undefined
      }
      className={cn(
        "flex h-auto w-full flex-col items-center justify-center overflow-hidden rounded-md border-2",
        isMultiSelected
          ? "border-cyan-400 bg-cyan-400/10"
          : isSelected
            ? "border-cyan-400"
          : "border-gray-500 hover:border-gray-300",
        isDragging && "opacity-50",
      )}
      onContextMenuCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onEnterMediaMultiSelectMode(mediaItem, index);
      }}
    >
      <Button
        variant="none"
        padding="p-0"
        className="flex h-auto w-full min-h-0 flex-col border-0 bg-transparent p-0 shadow-none ring-0 focus-visible:ring-0"
        onClick={(e) => {
          onMediaTileClick(e, mediaItem, index);
        }}
        onPointerDown={(e) => {
          if (e.pointerType !== "touch") return;
          longPressStartRef.current = { x: e.clientX, y: e.clientY };
          clearLongPressTimer();
          longPressTimerRef.current = window.setTimeout(() => {
            longPressTimerRef.current = null;
            longPressStartRef.current = null;
            onEnterMediaMultiSelectMode(mediaItem, index, {
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
        <div className={cn(defaultImageWrap, imageContainerClassName)}>
          <MultiSelectSubsetTick
            modeActive={mediaMultiSelectMode}
            isSelected={isMultiSelected}
            frameClassName="absolute left-1.5 top-1.5 z-10 size-5"
          />
          <MediaLibraryMediaVisual
            mediaItem={mediaItem}
            imageClassName="max-w-full max-h-full"
            imageAlt={id}
            imageLoading="lazy"
          />
          <MediaTypeBadge type={type} />
          {originBadgeLabel ? (
            <span className="absolute right-1.5 top-1.5 rounded bg-cyan-950/90 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-100 ring-1 ring-cyan-500/60">
              {originBadgeLabel}
            </span>
          ) : null}
        </div>

        {showBottomName && name ? (
          <div className="w-full px-1 py-1 text-center">
            <p className={cn("truncate", bottomNameClassName)} title={name}>
              {shownName}
            </p>
          </div>
        ) : null}
      </Button>
    </div>
  );
}
