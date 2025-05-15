import { useDispatch, useSelector } from "../../hooks";
import { TimerStatus, TimerInfo } from "../../types";
import { updateTimer } from "../../store/timersSlice";
import { updateTimerInfo } from "../../store/itemSlice";
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

  const handleTypeChange = (type: "timer" | "countdown") => {
    setTimerType(type);
    if (timer) {
      const updatedTimerInfo: TimerInfo = {
        ...timer,
        timerType: type,
        duration: type === "timer" ? duration : undefined,
        countdownTime: type === "countdown" ? countdownTime : undefined,
        status: "stopped",
      };
      dispatch(updateTimerInfo({ timerInfo: updatedTimerInfo }));
      dispatch(updateTimer({ id: _id, timerInfo: updatedTimerInfo }));
    }
  };

  const updateItemTimerInfo = (newStatus: TimerStatus) => {
    if (timer) {
      const updatedTimerInfo: TimerInfo = {
        ...timer,
        status: newStatus,
        timerType,
        duration: timerType === "timer" ? duration : undefined,
        countdownTime: timerType === "countdown" ? countdownTime : undefined,
      };
      dispatch(updateTimerInfo({ timerInfo: updatedTimerInfo }));
      dispatch(updateTimer({ id: _id, timerInfo: updatedTimerInfo }));
    }
  };

  const handlePlay = () => {
    updateItemTimerInfo("running");
  };

  const handlePause = () => {
    updateItemTimerInfo("paused");
  };

  const handleStop = () => {
    updateItemTimerInfo("stopped");
  };

  const handleDurationChange = (newDuration: number) => {
    setDuration(newDuration);
    if (timer) {
      const updatedTimerInfo: TimerInfo = {
        ...timer,
        duration: newDuration,
        status: "stopped",
      };
      dispatch(updateTimerInfo({ timerInfo: updatedTimerInfo }));
      dispatch(updateTimer({ id: _id, timerInfo: updatedTimerInfo }));
    }
  };

  const handleCountdownTimeChange = (newTime: string) => {
    setCountdownTime(newTime);
    if (timer) {
      const updatedTimerInfo: TimerInfo = {
        ...timer,
        countdownTime: newTime,
        status: "stopped",
      };
      dispatch(updateTimerInfo({ timerInfo: updatedTimerInfo }));
      dispatch(updateTimer({ id: _id, timerInfo: updatedTimerInfo }));
    }
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
