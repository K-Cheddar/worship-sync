import type { PresentationControllerMode } from "../../context/presentationControllerMode";

/**
 * Mirrors SlideEditor + SectionTextEditor + DisplayWindow without adding
 * chrome above DisplayWindow (unlike ItemSlide thumbnails).
 */
const SlideEditorSkeleton = ({ mode }: { mode: PresentationControllerMode }) => {
  const isPresentMode = mode === "present";

  return (
  <div
    className="flex w-full flex-col justify-center gap-2 px-2 lg:flex-row"
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label="Loading item editor"
    data-testid="slide-editor-skeleton"
  >
    {!isPresentMode ? (
      <div
        className="animate-pulse flex h-full min-h-0 w-full flex-col rounded-md border border-gray-600 lg:flex-[0_0_30%]"
        data-testid="slide-editor-skeleton-text-column"
      >
        {/* SectionTextEditor section header row (sectionName + sectionColor strip) */}
        <div className="flex h-9 shrink-0 items-center rounded-t-md bg-white/10 px-2">
          <div className="h-3.5 w-24 rounded bg-white/15" />
        </div>
        {/* TextArea wrapper: SectionTextEditor TextArea — flex-1 min-h-0, max-lg:min-h-[15vh] */}
        <div className="flex min-h-0 flex-1 flex-col rounded-b-md bg-gray-800 p-3 max-lg:min-h-[15vh]">
          <div className="min-h-0 w-full flex-1 rounded-sm bg-white/5" />
        </div>
      </div>
    ) : null}

    <div
      className={isPresentMode
        ? "flex min-h-0 min-w-0 w-full flex-col items-center lg:max-h-[36vh] max-lg:max-h-[30vh]"
        : "flex min-h-0 min-w-0 flex-1 flex-col lg:max-h-[42vh] max-lg:max-h-[30vh]"}
      data-testid="slide-editor-skeleton-preview"
    >
      <div
        className={isPresentMode
          ? "relative aspect-video h-full w-full animate-pulse overflow-hidden bg-black/50 lg:max-h-[36vh] max-lg:max-h-[30vh]"
          : "relative aspect-video h-full w-full animate-pulse overflow-hidden bg-black/50 lg:max-h-[42vh] max-lg:max-h-[30vh]"}
        aria-hidden
      />
    </div>
  </div>
  );
};

export default SlideEditorSkeleton;
