import { useDispatch, useSelector } from "react-redux";
import { TimerStatus, TimerInfo } from "../../types";
import { setTimerActive, updateTimerStatus } from "../../store/timersSlice";
import { updateTimerInfo } from "../../store/itemSlice";
import Button from "../Button/Button";
import { ReactComponent as PlaySVG } from "../../assets/icons/play.svg";
import { ReactComponent as PauseSVG } from "../../assets/icons/pause.svg";
import { ReactComponent as StopSVG } from "../../assets/icons/stop.svg";
import "./TimerControls.scss";
import { RootState } from "../../store/store";

interface TimerControlsProps {
  timerId: string;
  status: TimerStatus | undefined;
}

const TimerControls = ({ timerId, status }: TimerControlsProps) => {
  const dispatch = useDispatch();
  const item = useSelector((state: RootState) => state.undoable.present.item);

  const updateItemTimerInfo = (newStatus: TimerStatus) => {
    if (item.timerInfo) {
      const updatedTimerInfo: TimerInfo = {
        ...item.timerInfo,
        status: newStatus,
      };
      dispatch(updateTimerInfo(updatedTimerInfo));
    }
  };

  const handlePlay = () => {
    dispatch(setTimerActive({ id: timerId, isActive: true }));
    dispatch(updateTimerStatus({ id: timerId, status: "running" }));
    updateItemTimerInfo("running");
  };

  const handlePause = () => {
    dispatch(updateTimerStatus({ id: timerId, status: "paused" }));
    updateItemTimerInfo("paused");
  };

  const handleStop = () => {
    dispatch(setTimerActive({ id: timerId, isActive: false }));
    dispatch(updateTimerStatus({ id: timerId, status: "stopped" }));
    updateItemTimerInfo("stopped");
  };

  return (
    <div className="timer-controls flex gap-2 items-center px-2">
      <Button
        variant="tertiary"
        svg={PlaySVG}
        onClick={handlePlay}
        disabled={status === "running"}
        title="Play"
        color="#48bb78"
        className="timer-control-btn play"
      />
      <Button
        variant="tertiary"
        svg={PauseSVG}
        onClick={handlePause}
        disabled={status !== "running"}
        title="Pause"
        color="#ecc94b"
        className="timer-control-btn pause"
      />
      <Button
        variant="tertiary"
        svg={StopSVG}
        onClick={handleStop}
        disabled={status === "stopped"}
        title="Stop"
        color="#f56565"
        className="timer-control-btn stop"
      />
    </div>
  );
};

export default TimerControls;
