import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  clearPersistedTeamsReturnTo,
  readTeamsRestore,
  readTeamsReturnTo,
} from "../teamsReturnNavigation";

const isDocumentReload = () => {
  if (typeof performance === "undefined") return false;
  const getEntriesByType = performance.getEntriesByType;
  if (typeof getEntriesByType !== "function") return false;
  const entry = getEntriesByType.call(performance, "navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  return entry?.type === "reload";
};

/**
 * Clears abandoned cross-section return state when the operator navigates via
 * the sidebar (or any route change without return/restore router state).
 * Skips the first run after a full page reload so refresh can still recover
 * scoped sessionStorage.
 */
export const useTeamsAbandonedReturnCleanup = () => {
  const location = useLocation();
  const skipCleanupOnceRef = useRef(isDocumentReload());

  useEffect(() => {
    if (readTeamsReturnTo(location.state) || readTeamsRestore(location.state)) {
      return;
    }

    if (skipCleanupOnceRef.current) {
      skipCleanupOnceRef.current = false;
      return;
    }

    clearPersistedTeamsReturnTo();
  }, [location.key, location.state]);
};
