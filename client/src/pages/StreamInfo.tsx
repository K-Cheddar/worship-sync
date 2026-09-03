import { useMemo } from "react";
import StreamInfoComponent from "../components/StreamInfo/StreamInfo";
import { useSelector } from "../hooks";
import { RootState } from "../store/store";
import useNextServiceCountdownText from "../hooks/useNextServiceCountdownText";
import useDisplayedUpcomingService from "../hooks/useDisplayedUpcomingService";
import { NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS } from "../constants/nextServiceTimer";

const StreamInfo = () => {
  const services = useSelector(
    (state: RootState) => state.undoable.present.serviceTimes.list,
  );

  const upcomingService = useDisplayedUpcomingService(
    services,
    NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS,
    { keepRecentlyElapsedDuringGrace: true },
  );

  const targetIso = useMemo(() => {
    return upcomingService?.nextAt.toISOString() ?? null;
  }, [upcomingService]);
  const timeText = useNextServiceCountdownText(targetIso);

  return (
    <StreamInfoComponent
      upcomingService={upcomingService?.service}
      timeText={timeText}
    />
  );
};

export default StreamInfo;
