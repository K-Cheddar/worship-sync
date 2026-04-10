/**
 * Mirrors SectionTextEditor (bordered left column + header + text area) and
 * ItemSlide-style preview (title strip + DisplayWindow aspect-video + gray border).
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
    <div className="animate-pulse flex min-h-0 w-full flex-col border border-gray-600 rounded-md lg:flex-[0_0_30%]">
      {/* SectionTextEditor section header row */}
      <div className="flex h-9 shrink-0 items-center rounded-t-md bg-white/10 px-2">
        <div className="h-3.5 w-24 rounded bg-white/15" />
      </div>
      {/* TextArea region: rounded-b-md, p-3, bg-gray-800 */}
      <div className="flex min-h-[15vh] flex-1 flex-col rounded-b-md bg-gray-800 p-3 max-lg:min-h-[15vh]">
        <div className="min-h-40 w-full rounded-sm bg-white/5" />
      </div>
    </div>

    <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:max-h-[42vh] max-lg:max-h-[30vh]">
      <div className="animate-pulse overflow-hidden rounded-lg">
        <div className="flex min-h-8 w-full items-center justify-center rounded-t-md bg-white/10 px-2" />
        <div className="aspect-video w-full border border-gray-500 bg-black/50" />
      </div>
    </div>
  </div>
);

export default SlideEditorSkeleton;
