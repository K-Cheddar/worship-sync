import { useContext } from "react";

import { GlobalInfoContext } from "../../context/globalInfo";
import { cn } from "../../utils/cnHelper";

const sectionTitleBarClass =
  "mx-auto mb-4 h-7 w-56 max-w-[90%] animate-pulse rounded bg-white/10";

const gridRowClass = "grid grid-cols-2 gap-2 items-center p-2";

/** Loading placeholder for the Preferences form (defaults, per-row, visibility, scrollbar). */
export const PreferencesPageSkeleton = () => {
  const { access } = useContext(GlobalInfoContext) || {};
  const showFullChrome = access === "full";

  return (
    <div
      className="flex w-full max-w-4xl flex-col gap-2"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading preferences"
    >
      {showFullChrome && (
        <ul className="flex flex-wrap justify-center gap-6">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex w-fit flex-col gap-2 p-2">
              <div className="mx-auto h-6 w-40 animate-pulse rounded bg-white/10" />
              <div className="border-b-2 border-gray-400/30 pb-2" />
              <section className="flex flex-wrap items-center gap-2">
                <div className="aspect-video w-[min(35vw,14rem)] min-w-40 animate-pulse rounded border-4 border-gray-500/40 bg-white/5" />
                <div className="size-9 shrink-0 animate-pulse rounded bg-white/10" />
              </section>
              <section className="flex flex-wrap items-center gap-2">
                <div className="h-4 w-36 animate-pulse rounded bg-white/10" />
                <div className="size-8 animate-pulse rounded bg-white/10" />
                <div className="h-8 w-14 animate-pulse rounded bg-white/10" />
                <div className="size-8 animate-pulse rounded bg-white/10" />
              </section>
            </li>
          ))}
        </ul>
      )}

      <div className={sectionTitleBarClass} />
      <ul className="flex flex-col items-center gap-6">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className={gridRowClass}>
            <div className="h-4 w-40 justify-self-end animate-pulse rounded bg-white/10" />
            <section className="flex items-center gap-2">
              <div className="size-8 animate-pulse rounded bg-white/10" />
              <div className="h-8 w-12 animate-pulse rounded bg-white/10" />
              <div className="size-8 animate-pulse rounded bg-white/10" />
            </section>
          </li>
        ))}
      </ul>

      {showFullChrome && (
        <>
          <div className={cn(sectionTitleBarClass, "mt-8")} />
          <ul className="flex flex-col items-center gap-6">
            {Array.from({ length: 2 }, (_, i) => (
              <li key={i} className={gridRowClass}>
                <div className="h-4 w-36 justify-self-end animate-pulse rounded bg-white/10" />
                <section className="flex gap-2 px-2">
                  <div className="h-8 w-16 animate-pulse rounded bg-white/10" />
                  <div className="h-8 w-16 animate-pulse rounded bg-white/10" />
                </section>
              </li>
            ))}
          </ul>
          <div className={cn(sectionTitleBarClass, "mt-8")} />
          <ul className="flex flex-col items-center gap-6">
            {Array.from({ length: 2 }, (_, i) => (
              <li key={i} className={cn(gridRowClass, "justify-center")}>
                <div className="h-4 w-44 justify-self-end animate-pulse rounded bg-white/10" />
                <section className="flex flex-wrap gap-2 px-2">
                  <div className="h-8 w-14 animate-pulse rounded bg-white/10" />
                  <div className="h-8 w-20 animate-pulse rounded bg-white/10" />
                  <div className="h-8 w-16 animate-pulse rounded bg-white/10" />
                </section>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className={cn(sectionTitleBarClass, "mt-8")} />
      <div className="flex flex-wrap items-center justify-center gap-6">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="h-8 w-14 animate-pulse rounded bg-white/10"
          />
        ))}
      </div>
    </div>
  );
};

/**
 * Loading placeholder for quick link rows (drag handle, fields, preview) and add row.
 */
export const QuickLinksPageSkeleton = ({
  streamOnly = false,
}: {
  streamOnly?: boolean;
}) => (
  <div
    className="flex w-full flex-col gap-6"
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label="Loading quick links"
  >
    <ul className="flex flex-col items-center gap-6 max-lg:gap-12">
      {Array.from({ length: 3 }, (_, i) => (
        <li
          key={i}
          className={cn(
            "flex w-full max-w-5xl flex-wrap items-center justify-around gap-4 rounded-md border-b-2 border-gray-400/50 p-2 max-lg:pb-6",
            i % 2 === 0 && "bg-gray-600/40",
          )}
        >
          <div className="size-9 shrink-0 animate-pulse rounded bg-white/10" />
          {!streamOnly && (
            <div className="flex flex-col gap-2">
              <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
              <div className="h-9 w-36 animate-pulse rounded bg-white/10" />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <div className="h-3 w-10 animate-pulse rounded bg-white/10" />
            <div className="h-9 w-32 animate-pulse rounded bg-white/10" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-3 w-8 animate-pulse rounded bg-white/10" />
            <div className="h-9 w-28 animate-pulse rounded bg-white/10" />
          </div>
          <div className="h-10 w-24 animate-pulse rounded bg-white/10" />
          <div className="flex flex-col items-center gap-2">
            <div className="h-4 w-28 animate-pulse rounded bg-white/10" />
            <div className="aspect-video w-[min(24vw,12rem)] min-w-32 animate-pulse rounded border border-gray-500/50 bg-white/5" />
          </div>
          <div className="size-10 shrink-0 animate-pulse rounded bg-white/10" />
        </li>
      ))}
    </ul>
    <section className="my-8 flex flex-wrap items-center justify-center gap-4">
      {!streamOnly && (
        <div className="flex flex-col gap-2">
          <div className="h-3 w-44 animate-pulse rounded bg-white/10" />
          <div className="h-9 w-40 animate-pulse rounded bg-white/10" />
        </div>
      )}
      <div className="h-9 w-36 animate-pulse rounded bg-white/10" />
    </section>
  </div>
);

/**
 * Loading placeholder for monitor toggles and font size steppers.
 */
export const MonitorSettingsPageSkeleton = () => {
  const { access } = useContext(GlobalInfoContext) || {};
  const showFullChrome = access === "full";

  if (!showFullChrome) {
    return (
      <div
        className="h-24 w-full animate-pulse rounded bg-white/5"
        role="status"
        aria-busy="true"
        aria-label="Loading monitor settings"
      />
    );
  }

  return (
    <div
      className="flex w-full max-w-xl flex-col items-center gap-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading monitor settings"
    >
      <div className="mb-4 h-7 w-64 max-w-[90%] animate-pulse rounded bg-white/10" />
      <ul className="flex w-full flex-col items-center gap-6">
        {Array.from({ length: 3 }, (_, i) => (
          <li key={i} className={gridRowClass}>
            <div className="h-4 w-36 text-center animate-pulse rounded bg-white/10" />
            <section className="flex gap-2 px-2">
              <div className="h-8 w-16 animate-pulse rounded bg-white/10" />
              <div className="h-8 w-16 animate-pulse rounded bg-white/10" />
            </section>
          </li>
        ))}
      </ul>
      <div className="mb-4 mt-8 h-7 w-40 max-w-[90%] animate-pulse rounded bg-white/10" />
      <ul className="flex w-full flex-col items-center gap-6">
        {Array.from({ length: 2 }, (_, i) => (
          <li key={i} className={gridRowClass}>
            <div className="h-4 w-36 animate-pulse rounded bg-white/10" />
            <section className="flex items-center gap-2">
              <div className="size-8 animate-pulse rounded bg-white/10" />
              <div className="h-8 w-14 animate-pulse rounded bg-white/10" />
              <div className="size-8 animate-pulse rounded bg-white/10" />
            </section>
          </li>
        ))}
      </ul>
    </div>
  );
};
