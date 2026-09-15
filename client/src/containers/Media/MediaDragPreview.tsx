import type { MediaType } from "../../types";
import cn from "classnames";
import MediaLibraryMediaVisual from "./MediaLibraryMediaVisual";

type MediaDragPreviewProps = {
  mediaItems: MediaType[];
  variant: "overlay" | "ghost";
  insertionIndex?: number;
};

const MediaDragPreview = ({
  mediaItems,
  variant,
  insertionIndex,
}: MediaDragPreviewProps) => {
  if (mediaItems.length === 0) return null;

  const primaryMedia = mediaItems[0];
  const isGroup = mediaItems.length > 1;
  const visibleStackCount = Math.min(mediaItems.length - 1, 2);

  return (
    <div
      className={cn(
        "pointer-events-none relative select-none",
        variant === "overlay" ? "w-44 rotate-1" : "w-full",
      )}
      data-testid={`media-drag-${variant}`}
      data-insertion-index={insertionIndex}
    >
      {isGroup
        ? Array.from({ length: visibleStackCount }, (_, index) => (
            <div
              key={index}
              className="absolute inset-0 rounded-lg border border-cyan-300/40 bg-slate-800/90"
              style={{
                transform: `translate(${(index + 1) * 4}px, ${(index + 1) * 4}px)`,
                zIndex: -(index + 1),
              }}
            />
          ))
        : null}
      <div className="relative overflow-hidden rounded-lg border-2 border-dashed border-cyan-300 bg-slate-900/95 shadow-xl">
        <div
          className={cn(
            "relative flex aspect-video items-center justify-center overflow-hidden bg-slate-800",
            variant === "ghost" && "opacity-75",
          )}
        >
          <MediaLibraryMediaVisual
            mediaItem={primaryMedia}
            imageClassName="h-full w-full object-cover"
            imageAlt={primaryMedia.name}
          />
          {isGroup ? (
            <span className="absolute right-1.5 top-1.5 rounded-full bg-cyan-500 px-1.5 py-0.5 text-xs font-bold text-white shadow">
              +{mediaItems.length}
            </span>
          ) : null}
        </div>
        <div className="truncate px-2 py-1 text-center text-xs font-medium text-cyan-100">
          {isGroup ? `${mediaItems.length} media items` : primaryMedia.name}
        </div>
      </div>
    </div>
  );
};

export default MediaDragPreview;
