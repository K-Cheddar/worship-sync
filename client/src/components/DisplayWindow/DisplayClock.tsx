import { useEffect, useState } from "react";
import { serverDate, subscribeServerTimeOffset } from "../../utils/serverTime";

type DisplayClockProps = {
  fontSize: number;
};

const DisplayClock = ({
  fontSize,
}: DisplayClockProps) => {
  const [currentTime, setCurrentTime] = useState(() => serverDate());

  useEffect(() => {
    const updateTime = () => setCurrentTime(serverDate());
    const unsubscribe = subscribeServerTimeOffset(updateTime);
    const interval = setInterval(updateTime, 1000);
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  const timeString = currentTime.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <span
      className="text-white whitespace-nowrap"
      style={{ fontSize: `${fontSize}px` }}
    >
      {timeString}
    </span>
  );
};

export default DisplayClock;
