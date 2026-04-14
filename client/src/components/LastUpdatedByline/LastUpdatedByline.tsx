import { cn } from "@/utils/cnHelper";

export type LastUpdatedBylineProps = {
  updatedBy?: string;
  updatedAt?: string;
  className?: string;
};

const LAST_UPDATED_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const LAST_UPDATED_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const datePart = LAST_UPDATED_DATE_FORMATTER.format(d);
  const timePart = LAST_UPDATED_TIME_FORMATTER.format(d);
  return `${datePart} at ${timePart}`;
}

/**
 * Muted one-line summary for when a Pouch-backed doc was last saved.
 */
export function LastUpdatedByline({
  updatedBy,
  updatedAt,
  className,
}: LastUpdatedBylineProps) {
  const by = updatedBy?.trim();
  const at = updatedAt?.trim();
  if (by && at) {
    return (
      <p
        className={cn(
          "text-left text-xs text-gray-400 tabular-nums",
          className,
        )}
      >
        Last updated by {by} on {formatUpdatedAt(at)}
      </p>
    );
  }
  if (at) {
    return (
      <p
        className={cn(
          "text-left text-xs text-gray-400 tabular-nums",
          className,
        )}
      >
        Last updated on {formatUpdatedAt(at)}
      </p>
    );
  }
  return null;
}
