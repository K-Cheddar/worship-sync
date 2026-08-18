import { useCallback, useEffect, useRef, useState } from "react";
import { type Database } from "firebase/database";
import { useDispatch, useSelector } from "./reduxHooks";
import { useFirebaseValueWithRetry } from "./useFirebaseValueWithRetry";
import { setControllerProfilesFromRemote } from "../store/controllerProfilesSlice";
import { getChurchDataPath } from "../utils/firebasePaths";
import type { RootState } from "../store/store";

/**
 * Sync the church's controller profile registry from Firebase into Redux.
 *
 * Needed on every surface, not just controllers: send targeting resolves
 * against a profile, and a quick link fired from the home page has to resolve
 * the same way the controller that created it would. The node is absent for
 * churches that predate the registry — `setControllerProfilesFromRemote`
 * normalizes that to the unscoped built-ins, so a missing node degrades to
 * pre-registry behavior rather than a controller that can reach nothing.
 */
export const useSyncControllerProfiles = (
  firebaseDb: Database | null | undefined,
  churchId: string | null | undefined,
  sharedDataReady: boolean,
) => {
  const dispatch = useDispatch();
  const isLoaded = useSelector(
    (state: RootState) => state.controllerProfiles?.isLoaded ?? false,
  );
  const [resyncKey, setResyncKey] = useState(0);
  const wasLoadedRef = useRef(false);

  // Controller unmount (including StrictMode's first-load remount) dispatches
  // RESET, which returns this slice to isLoaded: false. This hook is mounted at
  // the app root, so its Firebase listener stays attached and never gets another
  // snapshot — the Controllers panel would stay disabled forever. Same fix as
  // useSyncDisplayOutputs.
  useEffect(() => {
    if (wasLoadedRef.current && !isLoaded) {
      setResyncKey((key) => key + 1);
    }
    wasLoadedRef.current = isLoaded;
  }, [isLoaded]);

  const handleProfiles = useCallback(
    (data: unknown) => {
      dispatch(setControllerProfilesFromRemote(data));
    },
    [dispatch],
  );

  useFirebaseValueWithRetry({
    db: firebaseDb,
    path: churchId ? getChurchDataPath(churchId, "controllerProfiles") : null,
    enabled: !!firebaseDb && !!churchId && !!sharedDataReady,
    onData: handleProfiles,
    label: "controller profiles",
    resyncKey,
  });
};
