import cn from "classnames";

const Bar = ({ className }: { className?: string }) => (
  <div
    className={cn("animate-pulse rounded-md bg-white/10", className)}
    aria-hidden
  />
);

/** Matches `LyricSectionTools`: toggle card + primary actions. */
const LyricSectionToolsSkeleton = ({ className }: { className?: string }) => (
  <div className={cn("flex flex-col gap-2", className)}>
    <div className="rounded-lg border border-white/10 bg-gray-950/70 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <Bar className="h-4 w-36" />
        <Bar className="h-6 w-10 shrink-0 rounded-full" />
      </div>
      <div className="mt-2 space-y-1.5">
        <Bar className="h-3 w-full" />
        <Bar className="h-3 w-[90%]" />
      </div>
    </div>
    <div className="flex flex-col gap-2">
      <Bar className="h-8 w-full rounded-md" />
      <Bar className="h-8 w-full rounded-md" />
    </div>
  </div>
);

/** Matches `Arrangement` list item: toolbar row + name row. */
const ArrangementCardSkeleton = ({ isSelected }: { isSelected?: boolean }) => (
  <li
    className={cn(
      "flex flex-col rounded-md border p-1",
      isSelected
        ? "border-cyan-500 bg-cyan-950/25 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.35)]"
        : "border-transparent bg-gray-900",
    )}
  >
    <div className="flex w-full justify-end gap-0.5 rounded-t-sm bg-black px-2 py-0.5">
      <Bar className="h-7 w-7 rounded-md" />
      <Bar className="h-7 w-7 rounded-md" />
      <Bar className="h-7 w-7 rounded-md" />
    </div>
    <Bar className="mt-1 h-9 w-full rounded-b-sm" />
  </li>
);

/**
 * Matches `LyrcisBox`: colored header strip (section picker + delete) + lyrics textarea.
 */
const LyricBoxSkeleton = () => (
  <li className="text-sm rounded-lg border-4 border-transparent">
    <div className="flex rounded-t-md bg-gray-800/90 px-1 py-0.5 font-semibold">
      <div className="min-h-0 min-w-[50%] flex-1">
        <Bar className="h-8 w-full rounded-md border border-white/10 bg-black/30" />
      </div>
      <Bar className="ml-auto h-8 w-8 shrink-0 rounded-md" />
    </div>
    <div className="rounded-b-lg border border-t-0 border-white/10 bg-black/25">
      <Bar className="min-h-[22vh] w-full rounded-b-lg bg-black/20 lg:min-h-[30vh]" />
    </div>
  </li>
);

/** Matches `SongSection` row: accent strip + label + trailing control. */
const SongOrderRowSkeleton = () => (
  <li className="flex items-stretch overflow-hidden rounded-md border border-white/10 bg-gray-900/80">
    <Bar className="w-1.5 shrink-0 rounded-none bg-black/40" />
    <div className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 pl-2">
      <Bar className="h-4 flex-1 rounded-sm" />
      <Bar className="h-7 w-7 shrink-0 rounded-md" />
    </div>
  </li>
);

/** Matches `SectionPreview` header + slide grid (desktop). */
const SectionPreviewSkeleton = () => (
  <div className="hidden min-h-0 min-w-0 shrink-0 flex-col border-t border-gray-600 pt-4 lg:flex">
    <div className="flex shrink-0 items-center justify-between gap-2">
      <Bar className="h-8 w-48 max-w-[70%] rounded-md" />
      <Bar className="h-8 w-8 shrink-0 rounded-md" />
    </div>
    <div className="mt-2 grid min-h-0 grid-cols-5 gap-x-2 gap-y-0.5 overflow-x-hidden">
      {[0, 1, 2, 3, 4].map((key) => (
        <div key={key} className="flex flex-col justify-start">
          <Bar className="aspect-video w-full rounded-sm" />
        </div>
      ))}
    </div>
  </div>
);

/**
 * Mirrors LyricsEditorPanel data surfaces: arrangements, formatted lyric sections (grid),
 * song order, preview, and actions — not generic placeholder blocks.
 */
const LyricsEditorLoadingSkeleton = () => (
  <div
    className="absolute left-0 z-30 flex h-full w-full flex-col gap-2 border-gray-500 bg-homepage-canvas pb-2 max-lg:pb-6 lg:border-r-2"
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <span className="sr-only">Loading lyrics editor</span>

    <div className="flex h-fit shrink-0 items-center gap-2 border-b border-white/20 bg-black/60 px-2 py-2">
      <div className="hidden shrink-0 gap-1 lg:flex">
        <Bar className="h-8 w-8" />
        <Bar className="h-8 w-8" />
      </div>
      <div className="flex min-w-0 flex-1 justify-center">
        <Bar className="h-7 w-48 max-w-[55%]" />
      </div>
      <Bar className="h-8 w-8 shrink-0" />
    </div>

    <div className="mx-4 my-2 flex gap-2 lg:hidden">
      <Bar className="h-9 flex-1 rounded-full" />
      <Bar className="h-9 flex-1 rounded-full" />
    </div>

    <div className="flex min-h-0 flex-1 gap-4">
      <div className="hidden min-h-0 min-w-0 max-w-64 flex-col gap-3 pl-4 pt-4 lg:flex">
        <LyricSectionToolsSkeleton />
        <Bar className="h-5 w-36 shrink-0" />
        <ul className="scrollbar-variable flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <ArrangementCardSkeleton isSelected />
          <ArrangementCardSkeleton />
          <ArrangementCardSkeleton />
        </ul>
      </div>

      <section
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          "px-4 lg:px-0 lg:pr-4",
        )}
      >
        <div className="mb-2 shrink-0 pt-2 lg:hidden">
          <LyricSectionToolsSkeleton />
        </div>
        <Bar className="mx-auto mb-2 h-8 w-56 max-w-[90%] shrink-0" />
        <div className="min-h-0 flex-1 overflow-hidden">
          <ul
            className={cn(
              "scrollbar-variable grid h-full items-start gap-2 overflow-y-auto",
              "grid-cols-1 lg:grid-cols-4",
            )}
          >
            <LyricBoxSkeleton />
            <LyricBoxSkeleton />
            <LyricBoxSkeleton />
            <LyricBoxSkeleton />
          </ul>
        </div>
        <SectionPreviewSkeleton />
      </section>

      <section className="mr-4 hidden h-full min-h-0 max-w-64 shrink-0 flex-col gap-3 pt-4 lg:flex">
        <Bar className="h-5 w-28 shrink-0" />
        <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-white/10 bg-gray-950/50 p-2">
          <ul
            id="song-sections-list-skeleton"
            className="scrollbar-variable flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden"
          >
            <SongOrderRowSkeleton />
            <SongOrderRowSkeleton />
            <SongOrderRowSkeleton />
            <SongOrderRowSkeleton />
          </ul>
        </div>
        <div className="shrink-0">
          <Bar className="h-9 w-full rounded-md" />
        </div>
        <div className="mt-4 flex shrink-0 gap-2 border-t border-gray-600 pt-4">
          <Bar className="h-10 flex-1 rounded-md" />
          <Bar className="h-10 flex-1 rounded-md" />
        </div>
      </section>
    </div>

    <div className="mx-4 my-4 flex gap-4 lg:hidden">
      <Bar className="h-10 flex-1 rounded-md" />
      <Bar className="h-10 flex-1 rounded-md" />
    </div>
  </div>
);

export default LyricsEditorLoadingSkeleton;
