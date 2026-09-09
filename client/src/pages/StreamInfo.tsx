import { useMemo } from "react";
import StreamInfoComponent from "../components/StreamInfo/StreamInfo";
import { useSelector } from "../hooks";
import { RootState } from "../store/store";
import useDisplayedUpcomingService from "../hooks/useDisplayedUpcomingService";
import useNextServiceCountdownText from "../hooks/useNextServiceCountdownText";
import { NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS } from "../constants/nextServiceTimer";
import type { ServiceTime } from "../types";

/** Leaf that owns countdown state so the route shell stays quiet between ticks. */
const StreamInfoCountdown = ({
  upcomingService,
  targetIso,
}: {
  upcomingService?: ServiceTime | null;
  targetIso: string | null;
}) => {
  const timeText = useNextServiceCountdownText(targetIso);
  return (
    <StreamInfoComponent
      upcomingService={upcomingService}
      timeText={timeText}
    />
  );
};

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

  return (
    <StreamInfoCountdown
      upcomingService={upcomingService?.service}
      targetIso={targetIso}
    />
  );
};

export default StreamInfo;
