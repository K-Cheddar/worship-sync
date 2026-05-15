import {
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import StreamInfoComponent from "../components/StreamInfo/StreamInfo";
import { GlobalInfoContext } from "../context/globalInfo";
import { ServiceTime } from "../types";
import { onValue, ref } from "firebase/database";
import { useDispatch } from "../hooks";
import useNextServiceCountdownText from "../hooks/useNextServiceCountdownText";
import useDisplayedUpcomingService from "../hooks/useDisplayedUpcomingService";
import { updateService } from "../store/serviceTimesSlice";
import { getChurchDataPath } from "../utils/firebasePaths";
import { NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS } from "../constants/nextServiceTimer";

const StreamInfo = () => {
  const { churchId, firebaseDb, loginState } =
    useContext(GlobalInfoContext) || {};
  const dispatch = useDispatch();
  const [services, setServices] = useState<ServiceTime[]>([]);

  useEffect(() => {
    if (!firebaseDb || loginState === "guest" || !churchId) return;

    const getServicesRef = ref(firebaseDb, getChurchDataPath(churchId, "services"));
    onValue(getServicesRef, (snapshot) => {
      const data = snapshot.val() as ServiceTime[] | null;
      setServices(data ?? []);
    });
  }, [churchId, firebaseDb, loginState]);

  const upcomingService = useDisplayedUpcomingService(
    services,
    NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS,
  );

  const targetIso = useMemo(() => {
    return upcomingService?.nextAt.toISOString() ?? null;
  }, [upcomingService]);
  const timeText = useNextServiceCountdownText(targetIso);

  // Clear overrideDateTimeISO when the time passes
  useEffect(() => {
    const checkAndClearOverrides = () => {
      const now = new Date();
      services.forEach((service) => {
        if (service.overrideDateTimeISO) {
          const overrideTime = new Date(service.overrideDateTimeISO);
          if (overrideTime <= now) {
            // Time has passed, clear the override
            // Update Redux which will sync to Firebase, updating local state
            dispatch(
              updateService({
                id: service.id,
                changes: { overrideDateTimeISO: undefined },
              })
            );
          }
        }
      });
    };

    // Check immediately
    checkAndClearOverrides();

    // Check every minute to catch any expired overrides
    const interval = setInterval(checkAndClearOverrides, 60000);

    return () => clearInterval(interval);
  }, [dispatch, services]);

  return (
    <StreamInfoComponent
      upcomingService={upcomingService?.service}
      timeText={timeText}
    />
  );
};

export default StreamInfo;
