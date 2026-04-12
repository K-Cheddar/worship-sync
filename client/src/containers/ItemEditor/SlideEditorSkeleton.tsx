/**
 * Mirrors SlideEditor + SectionTextEditor + DisplayWindow: bordered left column
 * (header + TextArea) and a single aspect-video preview with border — no extra
 * chrome above DisplayWindow (unlike ItemSlide thumbnails).
 */
const SlideEditorSkeleton = () => (
  <div
    className="flex w-full flex-col gap-2 px-2 lg:flex-row"
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label="Loading item editor"
    data-testid="slide-editor-skeleton"
  >
    <div className="animate-pulse flex h-full min-h-0 w-full flex-col border border-gray-600 rounded-md lg:flex-[0_0_30%]">
      {/* SectionTextEditor section header row (sectionName + sectionColor strip) */}
      <div className="flex h-9 shrink-0 items-center rounded-t-md bg-white/10 px-2">
        <div className="h-3.5 w-24 rounded bg-white/15" />
      </div>
      {/* TextArea wrapper: SectionTextEditor TextArea — flex-1 min-h-0, max-lg:min-h-[15vh] */}
      <div className="flex flex-1 min-h-0 flex-col rounded-b-md bg-gray-800 p-3 max-lg:min-h-[15vh]">
        <div className="min-h-0 flex-1 w-full rounded-sm bg-white/5" />
      </div>
    </div>

    <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:max-h-[42vh] max-lg:max-h-[30vh]">
      <div
        className="relative aspect-video h-full w-full animate-pulse overflow-hidden border border-gray-500 bg-black/50 lg:max-h-[42vh] max-lg:max-h-[30vh]"
        aria-hidden
      />
    </div>
  </div>
);

export default SlideEditorSkeleton;
