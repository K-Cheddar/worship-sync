import { useContext, useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { useSelector } from "../hooks";
import { ControllerInfoContext } from "../context/controllerInfo";
import { GlobalInfoContext } from "../context/globalInfo";
import { getChurchDataPath } from "../utils/firebasePaths";
import type { RootState } from "../store/store";
import type { DBServices, ServiceTime } from "../types";

/**
 * Returns service times from Redux when controller lifecycle has initialized them.
 * Otherwise falls back to a direct Firebase/local DB read for display-style surfaces.
 */
export const useAvailableServiceTimes = () => {
  const reduxServices = useSelector(
    (
      state:
        | RootState
        | {
            undoable?: {
              present?: {
                serviceTimes?: {
                  list?: ServiceTime[];
                  isInitialized?: boolean;
                };
              };
            };
          },
    ) => state.undoable?.present?.serviceTimes?.list ?? [],
  );
  const isReduxInitialized = useSelector(
    (
      state:
        | RootState
        | {
            undoable?: {
              present?: {
                serviceTimes?: {
                  list?: ServiceTime[];
                  isInitialized?: boolean;
                };
              };
            };
          },
    ) => state.undoable?.present?.serviceTimes?.isInitialized ?? false,
  );
  const { firebaseDb, churchId, loginState } =
    useContext(GlobalInfoContext) || {};
  const { db } = useContext(ControllerInfoContext) || {};
  const [fallbackServices, setFallbackServices] = useState<
    ServiceTime[] | null
  >(null);
  const shouldUseReduxServices = isReduxInitialized || reduxServices.length > 0;

  useEffect(() => {
    if (shouldUseReduxServices) {
      setFallbackServices(null);
      return;
    }

    let cancelled = false;

    if (firebaseDb && loginState !== "guest" && churchId) {
      const servicesRef = ref(
        firebaseDb,
        getChurchDataPath(churchId, "services"),
      );
      const unsubscribe = onValue(servicesRef, (snapshot) => {
        if (cancelled) return;
        const data = snapshot.val() as ServiceTime[] | null;
        setFallbackServices(data ?? []);
      });
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }

    if (!db) {
      setFallbackServices([]);
      return;
    }

    const load = async () => {
      try {
        const doc: DBServices | undefined = await db.get("services");
        if (cancelled) return;
        setFallbackServices(doc?.list ?? []);
      } catch {
        if (cancelled) return;
        setFallbackServices([]);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [churchId, db, firebaseDb, loginState, shouldUseReduxServices]);

  return {
    services: shouldUseReduxServices ? reduxServices : (fallbackServices ?? []),
    isReady: shouldUseReduxServices || fallbackServices !== null,
  };
};

export default useAvailableServiceTimes;
