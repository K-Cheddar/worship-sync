import cn from "classnames";

export type BoardActivitySourceKind = "discussion" | "restream" | "moderator";

export type BoardActivitySourceBadgeProps = {
  kind: BoardActivitySourceKind;
  /** Extra detail for tooltip / aria (e.g. Restream platform). */
  detail?: string;
  className?: string;
};

const SOURCE_CONFIG: Record<
  BoardActivitySourceKind,
  { letters: string; label: string; className: string }
> = {
  discussion: {
    letters: "DB",
    label: "Discussion board",
    className:
      "bg-violet-950 text-violet-100 ring-1 ring-violet-400/50",
  },
  restream: {
    letters: "RE",
    label: "Restream",
    className: "bg-cyan-950 text-cyan-100 ring-1 ring-cyan-400/50",
  },
  moderator: {
    letters: "MR",
    label: "Moderator reply",
    className: "bg-amber-950 text-amber-100 ring-1 ring-amber-400/50",
  },
};

/** Compact letter badge fully to the left of a live-activity card. */
export const BoardActivitySourceBadge = ({
  kind,
  detail,
  className,
}: BoardActivitySourceBadgeProps) => {
  const config = SOURCE_CONFIG[kind];
  const label = detail ? `${config.label} · ${detail}` : config.label;

  return (
    <span
      className={cn(
        "pointer-events-none absolute top-1/2 left-0 z-10 inline-flex h-6 w-6 -translate-x-[calc(100%+0.35rem)] -translate-y-1/2 items-center justify-center rounded-md text-[9px] font-bold tracking-wide shadow-sm",
        config.className,
        className,
      )}
      title={label}
      aria-label={label}
    >
      {config.letters}
    </span>
  );
};
