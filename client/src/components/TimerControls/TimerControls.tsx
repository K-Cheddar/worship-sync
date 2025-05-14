import { useDispatch, useSelector } from "../../hooks";
import { TimerStatus, TimerInfo } from "../../types";
import { syncTimers } from "../../store/timersSlice";
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
  const timerInfo = timer;

  const [duration, setDuration] = useState<number>(timerInfo?.duration || 60);
  const [countdownTime, setCountdownTime] = useState<string>(
    timerInfo?.countdownTime || "00:00"
  );
  const [timerType, setTimerType] = useState<"timer" | "countdown">(
    timerInfo?.timerType || "timer"
  );

  useEffect(() => {
    if (timerInfo) {
      setTimerType(timerInfo.timerType);
      setDuration(timerInfo.duration || 60);
      setCountdownTime(timerInfo.countdownTime || "00:00");
    }
  }, [timerInfo]);

  const handleTypeChange = (type: "timer" | "countdown") => {
    setTimerType(type);
    if (item.timerInfo) {
      const updatedTimerInfo: TimerInfo = {
        ...item.timerInfo,
        timerType: type,
        duration: type === "timer" ? duration : undefined,
        countdownTime: type === "countdown" ? countdownTime : undefined,
        status: "stopped",
      };
      dispatch(updateTimerInfo({ timerInfo: updatedTimerInfo }));
      dispatch(syncTimers([{ ...item, timerInfo: updatedTimerInfo }]));
    }
  };

  const updateItemTimerInfo = (newStatus: TimerStatus) => {
    if (item.timerInfo) {
      const updatedTimerInfo: TimerInfo = {
        ...item.timerInfo,
        status: newStatus,
        timerType,
        duration: timerType === "timer" ? duration : undefined,
        countdownTime: timerType === "countdown" ? countdownTime : undefined,
      };
      dispatch(updateTimerInfo({ timerInfo: updatedTimerInfo }));
      dispatch(syncTimers([{ ...item, timerInfo: updatedTimerInfo }]));
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
    if (item.timerInfo) {
      const updatedTimerInfo: TimerInfo = {
        ...item.timerInfo,
        duration: newDuration,
        status: "stopped",
      };
      dispatch(updateTimerInfo({ timerInfo: updatedTimerInfo }));
      dispatch(syncTimers([{ ...item, timerInfo: updatedTimerInfo }]));
    }
  };

  const handleCountdownTimeChange = (newTime: string) => {
    setCountdownTime(newTime);
    if (item.timerInfo) {
      const updatedTimerInfo: TimerInfo = {
        ...item.timerInfo,
        countdownTime: newTime,
        status: "stopped",
      };
      dispatch(updateTimerInfo({ timerInfo: updatedTimerInfo }));
      dispatch(syncTimers([{ ...item, timerInfo: updatedTimerInfo }]));
    }
  };

  return (
    <div className="timer-controls flex gap-2">
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
        status={timerInfo?.status || "stopped"}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
      />
    </div>
  );
};

export default TimerControls;
