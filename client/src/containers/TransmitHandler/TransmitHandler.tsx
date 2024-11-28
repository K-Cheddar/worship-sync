import { useEffect, useState } from "react";
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

const TransmitHandler = ({ className }: { className: string }) => {
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
    <section className={className}>
      <div className="w-full flex justify-center items-center gap-4">
        <Button
          onClick={() => dispatch(clearAll())}
          className="text-sm"
          padding="py-1 px-2"
        >
          Clear All
        </Button>
        <hr className="border-r border-slate-400 h-full" />
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
      />
      <Presentation
        name="Monitor"
        prevInfo={prevMonitorInfo}
        info={monitorInfo}
        isTransmitting={isMonitorTransmitting}
        toggleIsTransmitting={() => dispatch(toggleMonitorTransmitting())}
        quickLinks={monitorLinks}
      />
      <Presentation
        name="Stream"
        prevInfo={prevStreamInfo}
        info={streamInfo}
        isTransmitting={isStreamTransmitting}
        toggleIsTransmitting={() => dispatch(toggleStreamTransmitting())}
        quickLinks={streamLinks}
      />
    </section>
  );
};

export default TransmitHandler;
