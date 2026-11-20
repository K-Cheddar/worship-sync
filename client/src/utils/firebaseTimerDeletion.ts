import { ref, runTransaction } from "firebase/database";
import type { Database } from "firebase/database";
import { getChurchDataPath } from "./firebasePaths";

type RemoveFirebaseTimerOptions = {
  db: Database;
  churchId: string;
  timerId: string;
  isAuthorized: () => boolean;
};

/** Remove one timer without replacing concurrent edits to the shared timer array. */
export const removeFirebaseTimerWithTransaction = async ({
  db,
  churchId,
  timerId,
  isAuthorized,
}: RemoveFirebaseTimerOptions) => {
  let authorizationLost = false;
  let invalidData = false;
  const timersRef = ref(db, getChurchDataPath(churchId, "timers"));
  const result = await runTransaction(timersRef, (current: unknown) => {
    if (!isAuthorized()) {
      authorizationLost = true;
      return undefined;
    }
    if (current != null && !Array.isArray(current)) {
      invalidData = true;
      return undefined;
    }
    const timers = (current ?? []) as unknown[];
    return timers.filter((timer) =>
      typeof timer !== "object" || timer === null || !("id" in timer) || timer.id !== timerId,
    );
  }, { applyLocally: false });

  if (invalidData) throw new Error("Shared timer data is invalid.");
  if (authorizationLost || !isAuthorized()) {
    throw new Error("Your session or permission changed before shared timer cleanup finished.");
  }
  if (!result.committed) throw new Error("Shared timer cleanup could not be committed. Try again.");
};
