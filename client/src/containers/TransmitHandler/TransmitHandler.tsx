import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import Toggle from "../../components/Toggle/Toggle";
import { useDispatch, useSelector } from "../../hooks";
import {
  setTransmitToAll,
  toggleMonitorTransmitting,
  toggleStreamTransmitting,
  toggleProjectorTransmitting,
  clearAll,
} from "../../store/presentationSlice";
import Presentation from "../../components/Presentation/Presentation";
import Button from "../../components/Button/Button";
import { ControllerInfoContext } from "../../context/controllerInfo";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import cn from "classnames";
import { MonitorUp, MonitorX } from "lucide-react";

const TransmitHandler = () => {
  const {
    isMonitorTransmitting,
    isProjectorTransmitting,
    isStreamTransmitting,
    prevProjectorInfo,
    prevMonitorInfo,
    prevStreamInfo,
    projectorInfo,
    monitorInfo,
    streamInfo,
  } = useSelector((state) => state.presentation);
  const [isTransmitting, setIsTransmitting] = useState(false);

  const timers = useSelector((state) => state.timers.timers);
  const projectorTimer = timers.find(
    (timer) => timer.id === projectorInfo.timerId
  );
  const monitorTimer = timers.find((timer) => timer.id === monitorInfo.timerId);
  const streamTimer = timers.find((timer) => timer.id === streamInfo.timerId);

  const prevProjectorTimer = timers.find(
    (timer) => timer.id === prevProjectorInfo.timerId
  );
  const prevMonitorTimer = timers.find(
    (timer) => timer.id === prevMonitorInfo.timerId
  );
  const prevStreamTimer = timers.find(
    (timer) => timer.id === prevStreamInfo.timerId
  );

  const dispatch = useDispatch();

  const { isMediaExpanded, quickLinks, defaultQuickLinks } = useSelector(
    (state) => state.undoable.present.preferences
  );

  const { isMobile } = useContext(ControllerInfoContext) || {};

  useEffect(() => {
    setIsTransmitting(
      isMonitorTransmitting && isProjectorTransmitting && isStreamTransmitting
    );
  }, [isMonitorTransmitting, isProjectorTransmitting, isStreamTransmitting]);

  const handleSetTransmitting = useCallback(() => {
    setIsTransmitting((prev) => {
      const next = !prev;
      queueMicrotask(() => dispatch(setTransmitToAll(next)));
      return next;
    });
  }, [dispatch]);

  const handleClearAll = useCallback(() => {
    dispatch(clearAll());
  }, [dispatch]);

  const toggleProjector = useCallback(() => {
    dispatch(toggleProjectorTransmitting());
  }, [dispatch]);

  const toggleMonitor = useCallback(() => {
    dispatch(toggleMonitorTransmitting());
  }, [dispatch]);

  const toggleStream = useCallback(() => {
    dispatch(toggleStreamTransmitting());
  }, [dispatch]);

  const allQuickLinks = useMemo(
    () => [...defaultQuickLinks, ...quickLinks],
    [defaultQuickLinks, quickLinks]
  );

  const projectorQuickLinks = useMemo(
    () => allQuickLinks.filter((link) => link.displayType === "projector"),
    [allQuickLinks]
  );

  const monitorQuickLinks = useMemo(
    () => allQuickLinks.filter((link) => link.displayType === "monitor"),
    [allQuickLinks]
  );

  const streamQuickLinks = useMemo(
    () => allQuickLinks.filter((link) => link.displayType === "stream"),
    [allQuickLinks]
  );

  return (
    <ErrorBoundary>
      <div
        className={cn(
          "transition-all relative flex flex-col min-h-0",
          isMediaExpanded ? "h-0 z-0 opacity-0 flex-none" : "flex-1 opacity-100"
        )}
        data-is-media-expanded={isMediaExpanded}
      >
        <section
          className="flex flex-col gap-2 w-full mx-auto h-full p-2"
        >
          <div className="w-full flex justify-center items-center gap-4">
            <Button
              onClick={handleClearAll}
              className="text-sm"
              padding="py-1 px-2"
              svg={MonitorX}
            >
              Clear All
            </Button>
            <hr className="border-r border-gray-400 max-md:h-12 h-6" />
            <Toggle
              label="Send to all"
              icon={MonitorUp}
              value={isTransmitting}
              onChange={handleSetTransmitting}
              color="#22c55e"
            />
          </div>
          <div className="scrollbar-variable overflow-y-auto flex-1 min-h-0 flex flex-col gap-2">
            <Presentation
              timers={timers}
              name="Projector"
              prevInfo={prevProjectorInfo}
              timerInfo={projectorTimer}
              prevTimerInfo={prevProjectorTimer}
              info={projectorInfo}
              isTransmitting={isProjectorTransmitting}
              toggleIsTransmitting={toggleProjector}
              quickLinks={projectorQuickLinks}
              isMobile={isMobile}
            />
            <Presentation
              timers={timers}
              name="Monitor"
              prevInfo={prevMonitorInfo}
              timerInfo={monitorTimer}
              prevTimerInfo={prevMonitorTimer}
              info={monitorInfo}
              isTransmitting={isMonitorTransmitting}
              toggleIsTransmitting={toggleMonitor}
              quickLinks={monitorQuickLinks}
              isMobile={isMobile}
              showMonitorClockTimer
            />
            <Presentation
              timers={timers}
              name="Stream"
              prevInfo={prevStreamInfo}
              timerInfo={streamTimer}
              prevTimerInfo={prevStreamTimer}
              info={streamInfo}
              isTransmitting={isStreamTransmitting}
              toggleIsTransmitting={toggleStream}
              quickLinks={streamQuickLinks}
              isMobile={isMobile}
            />
          </div>
        </section>
      </div>
    </ErrorBoundary>
  );
};

export default TransmitHandler;
