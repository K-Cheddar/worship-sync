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
import { monitorLinks, projectorLinks, streamLinks } from "./dummyLinks";
import Button from "../../components/Button/Button";
import "./TransmitHandler.scss";
import { ControllerInfoContext } from "../../context/controllerInfo";

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
  const dispatch = useDispatch();

  const { isMediaExpanded } = useSelector((state) => state.preferences);

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
          name="Projector"
          prevInfo={prevProjectorInfo}
          info={projectorInfo}
          isTransmitting={isProjectorTransmitting}
          toggleIsTransmitting={() => dispatch(toggleProjectorTransmitting())}
          quickLinks={projectorLinks}
          isMobile={isMobile}
        />
        <Presentation
          name="Monitor"
          prevInfo={prevMonitorInfo}
          info={monitorInfo}
          isTransmitting={isMonitorTransmitting}
          toggleIsTransmitting={() => dispatch(toggleMonitorTransmitting())}
          quickLinks={monitorLinks}
          isMobile={isMobile}
        />
        <Presentation
          name="Stream"
          prevInfo={prevStreamInfo}
          info={streamInfo}
          isTransmitting={isStreamTransmitting}
          toggleIsTransmitting={() => dispatch(toggleStreamTransmitting())}
          quickLinks={streamLinks}
          isMobile={isMobile}
        />
      </section>
    </div>
  );
};

export default TransmitHandler;
