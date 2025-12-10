import { useState } from "react";
import { useDispatch, useSelector } from "../../hooks";
import { RootState } from "../../store/store";
import { updateService } from "../../store/serviceTimesSlice";
import { getEffectiveTargetTime } from "../../utils/serviceTimes";
import { ReactComponent as TimerSVG } from "../../assets/icons/timer.svg";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";

type Props = {
  serviceId: string;
};

const TimeAdjuster = ({ serviceId }: Props) => {
  const dispatch = useDispatch();
  const services = useSelector(
    (s: RootState) => s.undoable.present.serviceTimes.list
  );
  const service = services.find((s) => s.id === serviceId);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(0);

  const adjustTime = (seconds: number) => {
    if (!service) return;

    // Get the effective target time (considers override if set)
    const currentNext = getEffectiveTargetTime(service);
    if (!currentNext) return;

    // Calculate the new override time
    const newOverrideTime = new Date(
      currentNext.getTime() + seconds * 1000
    ).toISOString();

    // Update the service with the new overrideDateTimeISO
    dispatch(
      updateService({
        id: serviceId,
        changes: { overrideDateTimeISO: newOverrideTime },
      })
    );
  };

  const clampValue = (value: number, min: number, max: number): number => {
    return Math.max(min, Math.min(max, value));
  };

  const handleMinutesBlur = () => {
    setMinutes(clampValue(minutes, 0, 59));
  };

  const handleSecondsBlur = () => {
    setSeconds(clampValue(seconds, 0, 59));
  };

  const setExactTime = () => {
    if (!service) return;

    // Calculate the total seconds from minutes and seconds
    const totalSeconds = minutes * 60 + seconds;
    if (totalSeconds <= 0) return;

    // Set the service time to be X minutes and Y seconds from now
    const now = new Date();
    const newTime = new Date(now.getTime() + totalSeconds * 1000);

    // Update the service with the new overrideDateTimeISO
    dispatch(
      updateService({
        id: serviceId,
        changes: { overrideDateTimeISO: newTime.toISOString() },
      })
    );
  };

  return (
    <div className="flex max-md:flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-300">Adjust time:</span>
        <div className="flex gap-1">
          <Button variant="tertiary" onClick={() => adjustTime(-300)}>
            -5m
          </Button>
          <Button variant="tertiary" onClick={() => adjustTime(-60)}>
            -1m
          </Button>
          <Button variant="tertiary" onClick={() => adjustTime(60)}>
            +1m
          </Button>
          <Button variant="tertiary" onClick={() => adjustTime(300)}>
            +5m
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2 md:border-l-2 md:border-gray-400 md:pl-4">
        <Input
          type="number"
          min={0}
          max={59}
          placeholder="mm"
          value={minutes}
          onChange={(val) => setMinutes(Number(val))}
          onBlur={handleMinutesBlur}
          inputWidth="w-12"
          className="m-0"
          label="Minutes"
        />
        <Input
          type="number"
          min={0}
          max={59}
          placeholder="ss"
          value={seconds}
          onChange={(val) => setSeconds(Number(val))}
          onBlur={handleSecondsBlur}
          label="Seconds"
          inputWidth="w-12"
          className="m-0"
        />
        <Button
          onClick={setExactTime}
          variant="tertiary"
          disabled={minutes === 0 && seconds === 0}
          svg={TimerSVG}
          color="#22d3ee"
        >
          Set remaining time
        </Button>
      </div>
    </div>
  );
};

export default TimeAdjuster;
