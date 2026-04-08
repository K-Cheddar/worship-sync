import { useEffect } from "react";
import { useDispatch } from "./reduxHooks";
import { ref, onValue, Unsubscribe } from "firebase/database";
import { Database } from "firebase/database";
import { reconcileTimersFromRemote } from "../store/timersSlice";
import { TimerInfo } from "../types";
import { getChurchDataPath } from "../utils/firebasePaths";

/**
 * Hook to sync remote timers from Firebase
 * Listens to Firebase for timers from other hosts and syncs them to the store
 *
 * @param firebaseDb - Firebase database instance
 * @param churchId - Current church id
 * @param user - Current user name
 * @param hostId - Current host ID to filter out own timers
 */
export const useSyncRemoteTimers = (
  firebaseDb: Database | null | undefined,
  churchId: string | null | undefined,
  isGuestMode: boolean,
  hostId: string | null | undefined
) => {
  const dispatch = useDispatch();

  useEffect(() => {
    if (!firebaseDb || !churchId || !hostId || isGuestMode) return;

    const getTimersRef = ref(firebaseDb, getChurchDataPath(churchId, "timers"));
    const unsubscribe: Unsubscribe = onValue(getTimersRef, (snapshot) => {
      const data = snapshot.val();
      const remoteTimers = (data || []).filter(
        (timer: TimerInfo) => timer?.hostId !== hostId
      );

      dispatch(reconcileTimersFromRemote({ timers: remoteTimers, hostId }));
    });

    return () => {
      unsubscribe();
    };
  }, [churchId, firebaseDb, isGuestMode, dispatch, hostId]);
};
