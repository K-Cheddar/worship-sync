import { useEffect } from "react";
import { useDispatch } from "./reduxHooks";
import { ref, onValue, Unsubscribe } from "firebase/database";
import { Database } from "firebase/database";
import { syncTimersFromRemote } from "../store/timersSlice";
import { TimerInfo } from "../types";

/**
 * Hook to sync remote timers from Firebase
 * Listens to Firebase for timers from other hosts and syncs them to the store
 *
 * @param firebaseDb - Firebase database instance
 * @param user - Current user ID
 * @param hostId - Current host ID to filter out own timers
 */
export const useSyncRemoteTimers = (
  firebaseDb: Database | null | undefined,
  user: string | null | undefined,
  hostId: string | null | undefined
) => {
  const dispatch = useDispatch();

  useEffect(() => {
    if (!firebaseDb || user === "Demo" || !hostId) return;

    const getTimersRef = ref(firebaseDb, "users/" + user + "/v2/timers");
    const unsubscribe: Unsubscribe = onValue(getTimersRef, (snapshot) => {
      const data = snapshot.val();
      const remoteTimers = data?.filter(
        (timer: TimerInfo) => timer?.hostId !== hostId
      );

      if (remoteTimers?.length > 0) {
        dispatch(syncTimersFromRemote(remoteTimers));
      }
    });

    return () => {
      unsubscribe();
    };
  }, [firebaseDb, user, dispatch, hostId]);
};
