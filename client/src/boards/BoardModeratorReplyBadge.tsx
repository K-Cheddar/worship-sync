import cn from "classnames";

export type BoardModeratorReplyBadgeProps = {
  className?: string;
};

/** Same label and styling as Restream moderator rows in the board controller. */
export const BoardModeratorReplyBadge = ({
  className,
}: BoardModeratorReplyBadgeProps) => (
  <span
    className={cn(
      "rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-amber-50",
      className,
    )}
  >
    Moderator reply
  </span>
);
