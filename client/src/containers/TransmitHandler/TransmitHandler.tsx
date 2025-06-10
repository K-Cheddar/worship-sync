import {
  CSSProperties,
  useCallback,
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
import "./TransmitHandler.scss";
import { ControllerInfoContext } from "../../context/controllerInfo";

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

  const [handlerHeight, setHandlerHeight] = useState(0);

  const transmitHandlerRef = useCallback((node: HTMLElement) => {
    if (node) {
      const resizeObserver = new ResizeObserver((entries) => {
        setHandlerHeight(entries[0].borderBoxSize[0].blockSize);
      });

      resizeObserver.observe(node);
    }
  }, []);

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
    <div
      className="transmit-handler-container"
      data-is-media-expanded={isMediaExpanded}
      style={
        {
          "--transmit-handler-height": `${handlerHeight}px`,
        } as CSSProperties
      }
    >
      <section className="transmit-handler" ref={transmitHandlerRef}>
        <div className="w-full flex justify-center items-center gap-4">
          <Button
            onClick={() => dispatch(clearAll())}
            className="text-sm"
            padding="py-1 px-2"
          >
            Clear All
          </Button>
          <hr className="border-r border-gray-400 h-full" />
          <Toggle
            label="Sending to all"
            value={isTransmitting}
            onChange={handleSetTransmitting}
          />
        </div>
        <Presentation
          timers={timers}
          name="Projector"
          prevInfo={prevProjectorInfo}
          timerInfo={projectorTimer}
          prevTimerInfo={prevProjectorTimer}
          info={projectorInfo}
          isTransmitting={isProjectorTransmitting}
          toggleIsTransmitting={() => dispatch(toggleProjectorTransmitting())}
          quickLinks={allQuickLinks.filter(
            (link) => link.displayType === "projector"
          )}
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
          quickLinks={allQuickLinks.filter(
            (link) => link.displayType === "monitor"
          )}
          isMobile={isMobile}
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
          quickLinks={allQuickLinks.filter(
            (link) => link.displayType === "stream"
          )}
          isMobile={isMobile}
        />
      </section>
    </div>
  );
};

export default TransmitHandler;
