import { useEffect, useRef } from "react";
import { type Database, type DataSnapshot } from "firebase/database";
import { subscribeWithPermissionRetry } from "../utils/firebaseListeners";

type UseFirebaseValueWithRetryParams = {
  db: Database | null | undefined;
  /** Full RTDB path to subscribe to. Listener is skipped while null/empty. */
  path: string | null | undefined;
  /**
   * Gate the subscription on auth/scope readiness. Keeping this `false` until
   * the shared-data token is minted avoids the startup race where a listener
   * attaches before auth and gets cancelled with permission_denied.
   */
  enabled: boolean;
  /** Called with `snapshot.val()` on every value event. */
  onData: (value: unknown, snapshot: DataSnapshot) => void;
  /** Human-readable label used in error logs. */
  label?: string;
};

/**
 * Subscribe to a Firebase RTDB path with built-in recovery from
 * permission_denied cancellations (see `subscribeWithPermissionRetry`).
 *
 * Without this, a listener that attaches before the renderer has finished
 * authenticating (common for display windows that auto-open at startup) is
 * cancelled by Firebase and never re-fires, leaving the window showing stale
 * data until it is closed and reopened.
 */
export const useFirebaseValueWithRetry = ({
  db,
  path,
  enabled,
  onData,
  label,
}: UseFirebaseValueWithRetryParams) => {
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  useEffect(() => {
    if (!db || !path || !enabled) return;

    return subscribeWithPermissionRetry(
      db,
      path,
      (snapshot) => onDataRef.current(snapshot.val(), snapshot),
      { label }
    );
  }, [db, path, enabled, label]);
};
