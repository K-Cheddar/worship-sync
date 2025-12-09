import { useEffect, useMemo, useState } from "react";
import { Box } from "../../types";
import { useSelector } from "../../hooks";
import DisplayBox from "./DisplayBox";
import { createMonitorDisplayBox } from "./utils";

type DisplayClockProps = {
  width: number;
  fontAdjustment: number;
  time?: number;
};

const DisplayClock = ({ width, fontAdjustment, time }: DisplayClockProps) => {
  const {
    monitorSettings: { clockFontSize: fontSize },
  } = useSelector((state) => state.undoable.present.preferences);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Create clock box for monitor display
  const clockBox: Box | undefined = useMemo(() => {
    const timeString = currentTime.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    return createMonitorDisplayBox({
      id: "monitor-clock-box",
      words: timeString,
      x: 2,
      fontSize,
      fontColor: "#ffffff",
      align: "left",
    });
  }, [currentTime, fontSize]);

  if (!clockBox) return null;

  return (
    <DisplayBox
      box={clockBox}
      width={width}
      showBackground={false}
      fontAdjustment={fontAdjustment}
      index={0}
      shouldAnimate={false}
      time={time}
    />
  );
};

export default DisplayClock;
