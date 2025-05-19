import { useDispatch, useSelector } from "../../hooks";
import { ReactComponent as ExpandSVG } from "../../assets/icons/expand.svg";
import { TimerInfo } from "../../types";
import { updateTimer } from "../../store/timersSlice";
import { RootState } from "../../store/store";
import { useState, useEffect, useContext } from "react";
import TimerTypeSelector from "./TimerTypeSelector";
import CountdownTimeInput from "./CountdownTimeInput";
import DurationInputs from "./DurationInputs";
import TimerControlButtons from "./TimerControlButtons";
import RadioButton from "../RadioButton/RadioButton";
import "./TimerControls.scss";
import { GlobalInfoContext } from "../../context/globalInfo";
import cn from "classnames";
import PopOver from "../PopOver/PopOver";
import Button from "../Button/Button";

const TimerControls = ({ className }: { className?: string }) => {
  const dispatch = useDispatch();
  const { hostId } = useContext(GlobalInfoContext) || {};
  const item = useSelector((state: RootState) => state.undoable.present.item);
  const timers = useSelector((state: RootState) => state.timers.timers);
  const { _id } = item;
  const timer = timers.find((timer) => timer.id === _id);

  const [duration, setDuration] = useState<number>(timer?.duration || 60);
  const [countdownTime, setCountdownTime] = useState<string>(
    timer?.countdownTime || "00:00"
  );
  const [timerType, setTimerType] = useState<"timer" | "countdown">(
    timer?.timerType || "timer"
  );
  const [showMinutesOnly, setShowMinutesOnly] = useState<boolean>(
    timer?.showMinutesOnly || false
  );

  useEffect(() => {
    if (timer) {
      setTimerType(timer.timerType);
      setDuration(timer.duration || 60);
      setCountdownTime(timer.countdownTime || "00:00");
      setShowMinutesOnly(timer.showMinutesOnly || false);
    }
  }, [timer]);

  const updateTimerState = (updates: Partial<TimerInfo>) => {
    if (!timer) return;

    const updatedTimerInfo: TimerInfo = {
      ...timer,
      ...updates,
      hostId: hostId || "",
      timerType: updates.timerType || timerType,
      duration:
        (updates.timerType || timer?.timerType) === "timer"
          ? updates.duration || duration
          : undefined,
      countdownTime:
        (updates.timerType || timer?.timerType) === "countdown"
          ? updates.countdownTime || timer?.countdownTime
          : undefined,
      showMinutesOnly: updates.showMinutesOnly || false,
    };

    dispatch(updateTimer({ id: _id, timerInfo: updatedTimerInfo }));
  };

  const handleTypeChange = (type: "timer" | "countdown") => {
    setTimerType(type);
    updateTimerState({ timerType: type, status: "stopped" });
  };

  const handlePlay = () =>
    updateTimerState({
      status: "running",
      startedAt: new Date().toISOString(),
    });
  const handlePause = () => updateTimerState({ status: "paused" });
  const handleStop = () => updateTimerState({ status: "stopped" });

  const handleDurationChange = (newDuration: number) => {
    setDuration(newDuration);
    updateTimerState({ duration: newDuration, status: "stopped" });
  };

  const handleCountdownTimeChange = (newTime: string) => {
    setCountdownTime(newTime);
    updateTimerState({ countdownTime: newTime, status: "stopped" });
  };

  const handleShowMinutesOnlyChange = (checked: boolean) => {
    setShowMinutesOnly(checked);
    updateTimerState({ showMinutesOnly: checked });
  };

  const controls = (
    <div
      className={cn(
        "timer-controls flex gap-2 items-center max-lg:flex-col max-lg:gap-4",
        className
      )}
    >
      <TimerTypeSelector
        timerType={timerType}
        onTypeChange={handleTypeChange}
        className="lg:border-r-2 lg:pr-2 max-lg:border-b-2 max-lg:pb-4"
      />

      {timerType === "countdown" && (
        <CountdownTimeInput
          countdownTime={countdownTime}
          onTimeChange={handleCountdownTimeChange}
        />
      )}

      {timerType === "timer" && (
        <DurationInputs
          duration={duration}
          onDurationChange={handleDurationChange}
        />
      )}

      <div className="flex gap-4 items-center">
        <RadioButton
          label="Full timer"
          value={!showMinutesOnly}
          onChange={() => handleShowMinutesOnlyChange(false)}
        />
        <RadioButton
          label="Minutes only"
          value={showMinutesOnly}
          onChange={() => handleShowMinutesOnlyChange(true)}
        />
      </div>

      <TimerControlButtons
        status={timer?.status || "stopped"}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
      />
    </div>
  );

  return (
    <div className={`flex gap-2 items-center ${className || ""}`}>
      {/* leaving this outer div in case more tools are added */}

      <div className="max-lg:hidden flex gap-2 items-center">{controls}</div>
      <PopOver
        TriggeringButton={
          <Button className="lg:hidden" variant="tertiary" svg={ExpandSVG}>
            Timer Controls
          </Button>
        }
      >
        <div className="flex flex-col gap-4 items-center p-4">{controls}</div>
      </PopOver>
    </div>
  );
};

export default TimerControls;
