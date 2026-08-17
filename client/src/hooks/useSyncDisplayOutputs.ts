import { useCallback, useEffect, useRef, useState } from "react";
import { type Database } from "firebase/database";
import { useDispatch, useSelector } from "./reduxHooks";
import { useFirebaseValueWithRetry } from "./useFirebaseValueWithRetry";
import { setDisplayOutputsFromRemote } from "../store/displayOutputsSlice";
import { syncOutputSlots } from "../store/presentationSlice";
import {
  PushOutputType,
  isPushOutputType,
  normalizeDisplayOutputs,
} from "../utils/displayOutputs";
import { getChurchDataPath } from "../utils/firebasePaths";
import type { RootState } from "../store/store";

/**
 * Sync the church's display output registry from Firebase into Redux.
 *
 * Every surface needs this, not just controllers: a paired screen resolves which
 * output it renders from this list, and a controller resolves which previews and
 * transmit toggles to show. The node is absent for churches that predate the
 * registry — `setDisplayOutputsFromRemote` normalizes that to the three
 * built-ins, so a missing node degrades to today's behavior rather than an
 * empty controller.
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
  // gets another snapshot — the Displays panel would stay disabled forever.
  useEffect(() => {
    if (wasLoadedRef.current && !isLoaded) {
      setResyncKey((key) => key + 1);
    }
    wasLoadedRef.current = isLoaded;
  }, [isLoaded]);

  const handleDisplayOutputs = useCallback(
    (data: unknown) => {
      dispatch(setDisplayOutputsFromRemote(data));
      // Presentation state is keyed by output id, so every push output needs a
      // slot before content can be sent to it. Reconciling here (rather than
      // lazily on first send) means a newly created output is addressable
      // immediately, and a deleted one stops holding stale live content.
      const pushOutputs = normalizeDisplayOutputs(data)
        .filter((output) => isPushOutputType(output.type))
        .map((output) => ({
          id: output.id,
          type: output.type as PushOutputType,
        }));
      dispatch(syncOutputSlots(pushOutputs));
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
