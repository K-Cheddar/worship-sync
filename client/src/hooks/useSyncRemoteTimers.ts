import { useCallback } from "react";
import { useDispatch } from "./reduxHooks";
import { Database } from "firebase/database";
import { reconcileTimersFromRemote } from "../store/timersSlice";
import { TimerInfo } from "../types";
import { getChurchDataPath } from "../utils/firebasePaths";
import { useFirebaseValueWithRetry } from "./useFirebaseValueWithRetry";

/**
 * Hook to sync timers from Firebase into the store.
 *
 * Passes the full Firebase timers array (including this host's own timers) to
 * `reconcileTimersFromRemote`. The reducer resolves conflicts per timer by the
 * `time` stamp (see `hydrateTimer`/`shouldPreserveExistingRuntime`), so a
 * fresher local edit is never clobbered by a stale echo, while a fresher remote
 * copy IS adopted. We must NOT pre-filter our own timers here: after a refresh
 * the controller rebuilds its own timers from the stale PouchDB item docs, and
 * the live runtime state (running endTime, or the latest stopped state) only
 * exists in Firebase. Filtering own timers out left the controller stuck on the
 * stale doc state — showing a running timer as stopped, or dropping a timer the
 * monitor was still displaying.
 *
 * @param firebaseDb - Firebase database instance
 * @param churchId - Current church id
 * @param isGuestMode - Whether the current session is a guest session
 * @param hostId - Current host ID, used by the reducer for conflict resolution
 * @param sharedDataReady - Whether the shared-data auth token is ready. Gating
 *   on this avoids attaching the listener before auth, which Firebase would
 *   cancel with permission_denied and never recover from (the cause of display
 *   windows showing a stopped timer until they are reopened).
 */
export const useSyncRemoteTimers = (
  firebaseDb: Database | null | undefined,
  churchId: string | null | undefined,
  isGuestMode: boolean,
  hostId: string | null | undefined,
  sharedDataReady: boolean
) => {
  const dispatch = useDispatch();

  const handleData = useCallback(
    (data: unknown) => {
      if (!hostId) return;
      const remoteTimers = (data as TimerInfo[] | null) || [];

      dispatch(reconcileTimersFromRemote({ timers: remoteTimers, hostId }));
    },
    [dispatch, hostId]
  );

  useFirebaseValueWithRetry({
    db: firebaseDb,
    path:
      churchId && hostId ? getChurchDataPath(churchId, "timers") : null,
    enabled: !!firebaseDb && !!churchId && !!hostId && !isGuestMode && sharedDataReady,
    onData: handleData,
    label: "remote timers",
  });
};
