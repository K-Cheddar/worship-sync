import { useDispatch, useSelector } from "../../hooks";
import { TimerInfo } from "../../types";
import { updateTimer } from "../../store/timersSlice";
import { RootState } from "../../store/store";
import { useState, useEffect, useContext } from "react";
import TimerTypeSelector from "./TimerTypeSelector";
import CountdownTimeInput from "./CountdownTimeInput";
import DurationInputs from "./DurationInputs";
import TimerControlButtons from "./TimerControlButtons";
import RadioButton, { RadioGroup } from "../RadioButton/RadioButton";
import { GlobalInfoContext } from "../../context/globalInfo";
import cn from "classnames";

type TimerControlsProps = {
  className?: string;
  /** When collapsed in the item editor, show only play/pause/stop/reset. */
  variant?: "full" | "controlsOnly";
};

const TimerControls = ({ className, variant = "full" }: TimerControlsProps) => {
  const dispatch = useDispatch();
  const { hostId, access } = useContext(GlobalInfoContext) || {};
  const item = useSelector((state: RootState) => state.undoable.present.item);
  const timers = useSelector((state: RootState) => state.timers.timers);
  const { _id } = item;
  const timer = timers.find((timer) => timer.id === _id);
  const canControlTimer = access === "full";

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
    if (!timer || !canControlTimer) return;

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
      showMinutesOnly: updates.showMinutesOnly ?? showMinutesOnly,
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

  const controlButtons = (
    <TimerControlButtons
      status={timer?.status || "stopped"}
      onPlay={handlePlay}
      onPause={handlePause}
      onStop={handleStop}
      disabled={!canControlTimer}
    />
  );

  if (variant === "controlsOnly") {
    return (
      <div
        className={cn(
          "flex items-center justify-center border border-gray-600 rounded-md w-full p-2",
          className
        )}
        data-variant="controlsOnly"
      >
        {controlButtons}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col border border-gray-600 rounded-md w-full h-full max-h-full overflow-y-auto p-2",
        className
      )}
    >
      <div className="timer-controls flex flex-col gap-4">
        <TimerTypeSelector
          timerType={timerType}
          onTypeChange={handleTypeChange}
          disabled={!canControlTimer}
        />

        {timerType === "countdown" && (
          <CountdownTimeInput
            countdownTime={countdownTime}
            onTimeChange={handleCountdownTimeChange}
            disabled={!canControlTimer}
          />
        )}

        {timerType === "timer" && (
          <DurationInputs
            duration={duration}
            onDurationChange={handleDurationChange}
            disabled={!canControlTimer}
          />
        )}

        <RadioGroup
          value={showMinutesOnly ? "minutes" : "full"}
          onValueChange={(v) =>
            handleShowMinutesOnlyChange(v === "minutes")
          }
          className="flex gap-4 items-center justify-center"
        >
          <RadioButton
            optionValue="full"
            label="Full timer"
            disabled={!canControlTimer}
          />
          <RadioButton
            optionValue="minutes"
            label="Minutes only"
            disabled={!canControlTimer}
          />
        </RadioGroup>

        {controlButtons}
      </div>
    </div>
  );
};

export default TimerControls;
