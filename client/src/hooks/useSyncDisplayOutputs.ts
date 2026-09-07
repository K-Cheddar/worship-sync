import { useCallback, useEffect, useRef, useState } from "react";
import { type Database } from "firebase/database";
import { useDispatch, useSelector } from "./reduxHooks";
import { useFirebaseValueWithRetry } from "./useFirebaseValueWithRetry";
import { setDisplayOutputsFromRemote } from "../store/displayOutputsSlice";
import { getChurchDataPath } from "../utils/firebasePaths";
import type { RootState } from "../store/store";

/**
 * Sync the church's display output registry from Firebase into Redux.
 *
 * Every surface needs this, not just controllers: a paired screen resolves which
 * output it renders from this list, and a controller resolves which previews and
 * transmit toggles to show. The node is absent for churches that predate the
 * registry — `setDisplayOutputsFromRemote` normalizes that to the built-ins, so
 * a missing node degrades to today's behavior rather than an empty controller.
 *
 * Phase 0: registry only. Presentation `syncOutputSlots` lands in Phase 1 once
 * `presentation.outputs` exists.
 */
export const useSyncDisplayOutputs = (
  firebaseDb: Database | null | undefined,
  churchId: string | null | undefined,
  sharedDataReady: boolean,
) => {
  const dispatch = useDispatch();
  const isLoaded = useSelector(
    (state: RootState) => state.displayOutputs?.isLoaded ?? false,
  );
  const [resyncKey, setResyncKey] = useState(0);
  const wasLoadedRef = useRef(false);

  // Controller unmount (including StrictMode's first-load remount) dispatches
  // RESET, which returns this slice to isLoaded: false. DisplayOutputsSync
  // lives at the app root, so its Firebase listener stays attached and never
  // gets another snapshot — without a resync the registry would stay unloaded.
  useEffect(() => {
    if (wasLoadedRef.current && !isLoaded) {
      setResyncKey((key) => key + 1);
    }
    wasLoadedRef.current = isLoaded;
  }, [isLoaded]);

  const handleDisplayOutputs = useCallback(
    (data: unknown) => {
      dispatch(setDisplayOutputsFromRemote(data));
    },
    [dispatch],
  );

  useFirebaseValueWithRetry({
    db: firebaseDb,
    path: churchId ? getChurchDataPath(churchId, "displayOutputs") : null,
    enabled: !!firebaseDb && !!churchId && !!sharedDataReady,
    onData: handleDisplayOutputs,
    label: "display outputs",
    resyncKey,
  });
};
