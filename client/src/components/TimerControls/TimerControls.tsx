import { useDispatch, useSelector } from "../../hooks";
import { TimerInfo } from "../../types";
import { updateTimer } from "../../store/timersSlice";
import { RootState } from "../../store/store";
import { useState, useEffect } from "react";
import TimerTypeSelector from "./TimerTypeSelector";
import CountdownTimeInput from "./CountdownTimeInput";
import DurationInputs from "./DurationInputs";
import TimerControlButtons from "./TimerControlButtons";
import "./TimerControls.scss";

const TimerControls = () => {
  const dispatch = useDispatch();
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

  useEffect(() => {
    if (timer) {
      setTimerType(timer.timerType);
      setDuration(timer.duration || 60);
      setCountdownTime(timer.countdownTime || "00:00");
    }
  }, [timer]);

  const updateTimerState = (updates: Partial<TimerInfo>) => {
    if (!timer) return;

    const updatedTimerInfo: TimerInfo = {
      ...timer,
      ...updates,
      timerType,
      duration: timerType === "timer" ? duration : undefined,
      countdownTime: timerType === "countdown" ? countdownTime : undefined,
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

  return (
    <div className="timer-controls flex gap-2 items-center max-lg:flex-col max-lg:gap-4">
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

      <TimerControlButtons
        status={timer?.status || "stopped"}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
      />
    </div>
  );
};

export default TimerControls;
