import { useSelector } from "../../../hooks";
import TimerControlsComponent from "../../../components/TimerControls/TimerControls";

const TimerControls = () => {
  const item = useSelector((state) => state.undoable.present.item);
  const { type, _id, timerInfo } = item;

  if (type !== "timer" || !timerInfo) {
    return null;
  }

  return <TimerControlsComponent timerId={_id} status={timerInfo.status} />;
};

export default TimerControls;
