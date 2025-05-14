import { useDispatch, useSelector } from "../../hooks";
import { TimerStatus, TimerInfo } from "../../types";
import { syncTimers, updateTimer } from "../../store/timersSlice";
import { updateTimerInfo } from "../../store/itemSlice";
import Button from "../Button/Button";
import { ReactComponent as PlaySVG } from "../../assets/icons/play.svg";
import { ReactComponent as PauseSVG } from "../../assets/icons/pause.svg";
import { ReactComponent as StopSVG } from "../../assets/icons/stop.svg";
import "./TimerControls.scss";
import { RootState } from "../../store/store";
import RadioButton from "../RadioButton/RadioButton";
import Input from "../Input/Input";
import { useState, useEffect } from "react";

const TimerControls = () => {
  const dispatch = useDispatch();
  const item = useSelector((state: RootState) => state.undoable.present.item);
  const timers = useSelector((state: RootState) => state.timers.timers);
  const { _id } = item;

  const timer = timers.find((timer) => timer.id === _id);
  const timerInfo = timer?.timerInfo;

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
      dispatch(updateTimer({ id: _id, status: "stopped" }));
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
    }
  };

  const handlePlay = () => {
    updateItemTimerInfo("running");
    dispatch(updateTimer({ id: _id, status: "running" }));
  };

  const handlePause = () => {
    updateItemTimerInfo("paused");
    dispatch(updateTimer({ id: _id, status: "paused" }));
  };

  const handleStop = () => {
    updateItemTimerInfo("stopped");
    dispatch(updateTimer({ id: _id, status: "stopped" }));
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
      dispatch(updateTimer({ id: _id, status: "stopped" }));
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
      dispatch(updateTimer({ id: _id, status: "stopped" }));
      dispatch(syncTimers([{ ...item, timerInfo: updatedTimerInfo }]));
    }
  };

  return (
    <div className="timer-controls flex gap-2">
      <div className="flex gap-4 items-center lg:border-r-2 lg:pr-2 max-lg:border-b-2 max-lg:pb-4">
        <RadioButton
          label="Timer"
          value={timerType === "timer"}
          onChange={() => handleTypeChange("timer")}
        />
        <RadioButton
          label="Countdown"
          value={timerType === "countdown"}
          onChange={() => handleTypeChange("countdown")}
        />
      </div>

      {timerType === "countdown" && (
        <div className="flex gap-2">
          <Input
            type="time"
            label="Countdown To"
            className="flex gap-1 items-center w-72"
            labelClassName="w-44"
            value={countdownTime}
            onChange={(val) => handleCountdownTimeChange(val as string)}
          />
        </div>
      )}

      {timerType === "timer" && (
        <div className="flex gap-2">
          <Input
            label="Hours"
            type="number"
            hideSpinButtons
            min={0}
            value={Math.floor(duration / 3600)}
            onChange={(val) => {
              const newDuration =
                Number(val) * 3600 +
                Math.floor((duration % 3600) / 60) * 60 +
                (duration % 60);
              handleDurationChange(newDuration);
            }}
          />
          <Input
            label="Minutes"
            type="number"
            min={0}
            max={59}
            hideSpinButtons
            value={Math.floor((duration % 3600) / 60)}
            onChange={(val) => {
              const newDuration =
                Math.floor(duration / 3600) * 3600 +
                Number(val) * 60 +
                (duration % 60);
              handleDurationChange(newDuration);
            }}
          />
          <Input
            label="Seconds"
            type="number"
            min={0}
            max={59}
            hideSpinButtons
            value={duration % 60}
            onChange={(val) => {
              const newDuration =
                Math.floor(duration / 3600) * 3600 +
                Math.floor((duration % 3600) / 60) * 60 +
                Number(val);
              handleDurationChange(newDuration);
            }}
          />
        </div>
      )}

      <div className="flex gap-2 items-center px-2">
        <Button
          variant="tertiary"
          svg={PlaySVG}
          onClick={handlePlay}
          disabled={timerInfo?.status === "running"}
          title="Play"
          color="#48bb78"
          className="timer-control-btn play"
        />
        <Button
          variant="tertiary"
          svg={PauseSVG}
          onClick={handlePause}
          disabled={timerInfo?.status !== "running"}
          title="Pause"
          color="#ecc94b"
          className="timer-control-btn pause"
        />
        <Button
          variant="tertiary"
          svg={StopSVG}
          onClick={handleStop}
          disabled={timerInfo?.status === "stopped"}
          title="Stop"
          color="#f56565"
          className="timer-control-btn stop"
        />
      </div>
    </div>
  );
};

export default TimerControls;
