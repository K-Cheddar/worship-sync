import {
  useContext,
  useEffect,
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

// Keeping this as previous urls
// https://res.cloudinary.com/portable-media/image/upload/v1729199662/eliathah/Welcome_To_Eliathah.jpg
// https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/psalm-145-5-1292446461_j02gov

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

  const handleSetTransmitting = () => {
    setIsTransmitting(!isTransmitting);
    dispatch(setTransmitToAll(!isTransmitting));
  };

  const allQuickLinks = [...defaultQuickLinks, ...quickLinks];

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
          className="flex flex-col gap-2 w-full  rounded-lg mx-auto h-full p-2"
        >
          <div className="w-full flex justify-center items-center gap-4">
            <Button
              onClick={() => dispatch(clearAll())}
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
              toggleIsTransmitting={() =>
                dispatch(toggleProjectorTransmitting())
              }
              quickLinks={allQuickLinks
                .filter((link) => link.displayType === "projector")
                }
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
              toggleIsTransmitting={() => dispatch(toggleMonitorTransmitting())}
              quickLinks={allQuickLinks
                .filter((link) => link.displayType === "monitor")
                }
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
              toggleIsTransmitting={() => dispatch(toggleStreamTransmitting())}
              quickLinks={allQuickLinks
                .filter((link) => link.displayType === "stream")
                }
              isMobile={isMobile}
            />
          </div>
        </section>
      </div>
    </ErrorBoundary>
  );
};

export default TransmitHandler;
