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
      "rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-50",
      className,
    )}
  >
    Moderator reply
  </span>
);
