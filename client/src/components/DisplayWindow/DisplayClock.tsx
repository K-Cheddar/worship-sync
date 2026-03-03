import { useEffect, useState } from "react";

type DisplayClockProps = {
  fontSize: number;
};

const DisplayClock = ({
  fontSize,
}: DisplayClockProps) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
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
