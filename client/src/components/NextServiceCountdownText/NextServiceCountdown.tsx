import type { ReactNode } from "react";
import useNextServiceCountdownText from "../../hooks/useNextServiceCountdownText";

type NextServiceCountdownProps = {
  targetIso: string | null;
  children: (timeText: string) => ReactNode;
  /** When the hook has no value yet, render nothing (default) or a fallback tree. */
  fallback?: ReactNode;
};

/**
 * Leaf owner for countdown state when the parent needs the formatted string
 * (aria-labels, “is live” branching, countdown face animations).
 */
const NextServiceCountdown = ({
  targetIso,
  children,
  fallback = null,
}: NextServiceCountdownProps) => {
  const timeText = useNextServiceCountdownText(targetIso);
  if (timeText == null) return <>{fallback}</>;
  return <>{children(timeText)}</>;
};

export default NextServiceCountdown;
