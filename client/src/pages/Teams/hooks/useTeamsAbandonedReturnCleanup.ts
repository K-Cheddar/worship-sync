import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  clearPersistedTeamsReturnTo,
  isTeamsNavigationReload,
  readTeamsRestore,
  readTeamsReturnTo,
} from "../teamsReturnNavigation";

/**
 * Clears abandoned cross-section return state when the operator navigates via
 * the sidebar (or any route change without return/restore router state).
 * Skips the first run after a full page reload so refresh can still recover
 * scoped sessionStorage.
 */
export const useTeamsAbandonedReturnCleanup = () => {
  const location = useLocation();
  const skipCleanupOnceRef = useRef(isTeamsNavigationReload());

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
