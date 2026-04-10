type ItemSlidesSkeletonProps = {
  className: string;
  /** Number of placeholder tiles (e.g. two rows at current column count). */
  placeholderCount: number;
};

/**
 * Mirrors ItemSlide: rounded-lg card, title strip (h4), DisplayWindow (aspect-video + border-gray-500).
 */
const ItemSlidesSkeleton = ({
  className,
  placeholderCount,
}: ItemSlidesSkeletonProps) => (
  <ul
    id="item-slides-container"
    className={className}
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label="Loading slides"
  >
    {Array.from({ length: placeholderCount }, (_, i) => (
      <li
        key={i}
        className="w-full cursor-default overflow-hidden rounded-lg"
      >
        <div className="animate-pulse">
          {/* ItemSlide h4: rounded-t-md, px-2, centered title */}
          <div className="flex min-h-8 w-full items-center justify-center rounded-t-md bg-white/10 px-2" />
          {/* DisplayWindow: aspect-video, border-gray-500, dark stage */}
          <div className="aspect-video w-full border border-gray-500 bg-black/50" />
        </div>
      </li>
    ))}
  </ul>
);

export default ItemSlidesSkeleton;
