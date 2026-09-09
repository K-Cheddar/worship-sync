import { MonitorUp, Video } from "lucide-react";
import cn from "classnames";
import type { LocalVideoCaptureKind } from "../../types";
import {
  getLocalVideoInputKindLabel,
  isDesktopCaptureKind,
} from "../../utils/localVideoInput";

type LocalVideoInputSlideBadgeProps = {
  label: string;
  captureKind?: LocalVideoCaptureKind;
  /**
   * `overlay` fills the stage (thumbnails). `banner` sits at the bottom so the
   * editor stays readable while still naming the input.
   */
  variant?: "overlay" | "banner";
  /**
   * Thumbnail grids leave the slide title bar uncovered.
   * Only applies to `overlay`.
   */
  coverTitleBar?: boolean;
  className?: string;
  /** Larger icon/copy for the editor stage; compact for thumbnails. */
  size?: "sm" | "md";
};

/**
 * Static placeholder for slides that use a live video input or screen share.
 * Previews do not play the capture; this badge is how operators recognize the
 * slide.
 */
const LocalVideoInputSlideBadge = ({
  label,
  captureKind,
  variant = "overlay",
  coverTitleBar = false,
  className,
  size = "sm",
}: LocalVideoInputSlideBadgeProps) => {
  const kindLabel = getLocalVideoInputKindLabel(captureKind);
  const trimmedLabel = label.trim() || kindLabel;
  const isMd = size === "md";
  const ariaLabel = `${kindLabel}: ${trimmedLabel}`;
  const Icon = isDesktopCaptureKind(captureKind) ? MonitorUp : Video;

  if (variant === "banner") {
    return (
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-2 border-t border-white/20 bg-black/75 px-3 py-2 text-white",
          className,
        )}
        data-testid="local-video-input-slide-badge"
        aria-label={ariaLabel}
      >
        <Icon
          className={cn("shrink-0", isMd ? "size-5" : "size-4")}
          aria-hidden
        />
        <span
          className={cn(
            "truncate font-medium",
            isMd ? "text-sm" : "text-xs",
          )}
          title={trimmedLabel}
        >
          <span className="font-semibold text-white/80">{kindLabel}:</span>{" "}
          {trimmedLabel}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-white",
        coverTitleBar ? "top-0" : "top-6",
        className,
      )}
      data-testid="local-video-input-slide-badge"
      aria-label={ariaLabel}
    >
      <Icon
        className={cn("shrink-0", isMd ? "size-10" : "size-6")}
        aria-hidden
      />
      <span
        className={cn(
          "font-semibold uppercase tracking-wide text-white/80",
          isMd ? "text-xs" : "text-[9px]",
        )}
      >
        {kindLabel}
      </span>
      <span
        className={cn(
          "max-w-[90%] truncate font-medium",
          isMd ? "text-sm" : "text-[10px]",
        )}
        title={trimmedLabel}
      >
        {trimmedLabel}
      </span>
    </div>
  );
};

export default LocalVideoInputSlideBadge;
