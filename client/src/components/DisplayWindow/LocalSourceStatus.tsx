import { CircleAlert, LoaderCircle } from "lucide-react";

type LocalSourceStatusProps = {
  sourceLabel: string;
  ownerLabel?: string;
  heading?: string;
  detail?: string;
  transparentBackground?: boolean;
  state?: "loading" | "unavailable";
  /** `canvas` compensates for the fixed 1920x1080 surface's parent scale. */
  size?: "compact" | "preview" | "canvas";
  variant?: "overlay" | "indicator";
  indicatorLabel?: string;
  scaleFactor?: number;
  className?: string;
  testId?: string;
};

const BASE_SIZES = {
  compact: { gap: 5, padding: 8, icon: 18, heading: 14, source: 12, detail: 11 },
  preview: { gap: 10, padding: 20, icon: 28, heading: 22, source: 15, detail: 14 },
  canvas: { gap: 12, padding: 28, icon: 40, heading: 30, source: 18, detail: 16 },
} as const;

/** Shared operator status for local media and capture sources that cannot preview here. */
const LocalSourceStatus = ({
  sourceLabel,
  ownerLabel,
  heading,
  detail,
  transparentBackground = false,
  state = "unavailable",
  size = "compact",
  variant = "overlay",
  indicatorLabel = "Unavailable",
  scaleFactor = 1,
  className = "",
  testId,
}: LocalSourceStatusProps) => {
  const sizing = BASE_SIZES[size];
  const scale = size === "canvas" ? Math.max(scaleFactor, 0.02) : 1;
  const StatusIcon = state === "loading" ? LoaderCircle : CircleAlert;
  const sourceParts = sourceLabel.split(" · ");
  const sourceName = sourceParts[sourceParts.length - 1];
  if (/[\\/]/.test(sourceName)) {
    sourceParts[sourceParts.length - 1] =
      sourceName.split(/[\\/]+/).filter(Boolean).pop() || "Local file";
  }
  const safeSourceLabel = sourceParts.join(" · ");
  const resolvedHeading = heading ?? (
    state === "loading" ? "Loading local preview" : "Local source on another device"
  );

  if (variant === "indicator") {
    const label = [resolvedHeading, safeSourceLabel, ownerLabel && `Available on ${ownerLabel}`, detail]
      .filter(Boolean)
      .join(" · ");
    return (
      <div
        className={`pointer-events-none absolute right-1.5 top-1.5 z-30 inline-flex max-w-[calc(100%-0.75rem)] items-center gap-1 rounded bg-black/85 px-1.5 py-1 text-white shadow ${className}`}
        role="status"
        aria-label={label}
        title={label}
        data-local-source-status-size="indicator"
      >
        <StatusIcon
          aria-hidden
          className={`size-3.5 shrink-0 text-neutral-200 ${state === "loading" ? "animate-spin" : ""}`}
        />
        <span className="truncate text-[10px] font-semibold">
          {state === "loading" ? "Loading preview" : indicatorLabel}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center text-center text-white ${transparentBackground ? "bg-transparent" : "bg-black/90"} ${className}`}
      role="status"
      data-local-source-status-size={size}
      data-local-source-status-state={state}
      data-testid={testId}
      style={{ gap: `${sizing.gap / scale}px`, padding: `${sizing.padding / scale}px` }}
    >
      <StatusIcon
        aria-hidden
        className={`shrink-0 text-neutral-300 ${state === "loading" ? "animate-spin" : ""}`}
        style={{ width: `${sizing.icon / scale}px`, height: `${sizing.icon / scale}px` }}
      />
      <p
        className="max-w-full font-semibold leading-tight"
        style={{ fontSize: `${sizing.heading / scale}px` }}
      >
        {resolvedHeading}
      </p>
      <p
        className="max-w-full break-words leading-tight text-neutral-300"
        title={safeSourceLabel}
        style={{ fontSize: `${sizing.source / scale}px` }}
      >
        {safeSourceLabel}
      </p>
      {ownerLabel ? (
        <p
          className="max-w-full break-words leading-tight text-neutral-400"
          style={{ fontSize: `${sizing.detail / scale}px` }}
        >
          Available on {ownerLabel}
        </p>
      ) : null}
      {detail ? (
        <p
          className="max-w-full break-words leading-tight text-neutral-400"
          style={{ fontSize: `${sizing.detail / scale}px` }}
        >
          {detail}
        </p>
      ) : null}
    </div>
  );
};

export default LocalSourceStatus;
