import type { ReactNode } from "react";
import useNextServiceCountdownText from "../../hooks/useNextServiceCountdownText";

type NextServiceCountdownTextProps = {
  targetIso: string | null;
  className?: string;
  /** Shown while the countdown has no target or has not produced a value yet. */
  fallback?: ReactNode;
};

/**
 * Tiny leaf that owns next-service countdown state so parents (outline,
 * workspace, transmit previews) do not re-render every second.
 */
const NextServiceCountdownText = ({
  targetIso,
  className,
  fallback = null,
}: NextServiceCountdownTextProps) => {
  const text = useNextServiceCountdownText(targetIso);
  if (text == null) return <>{fallback}</>;
  return <span className={className}>{text}</span>;
};

export default NextServiceCountdownText;
