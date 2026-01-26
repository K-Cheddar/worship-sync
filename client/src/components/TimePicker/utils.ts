import { pad2 } from "../../constants";
import type { Meridiem } from "./types";

export const formatTimeTo24Hour = (time: string | undefined) => {
  if (!time) return "";
  try {
    const trimmed = time.trim();

    // 12-hour format with optional space before AM/PM (e.g., "6:30 PM" or "06:30PM")
    const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match) {
      let hour = parseInt(match[1], 10);
      const minute = parseInt(match[2], 10);
      const meridiem = match[3];
      if (isNaN(hour) || hour < 1 || hour > 12) return "";
      if (isNaN(minute) || minute < 0 || minute > 59) return "";
      if (meridiem === "AM") {
        hour = hour % 12; // 12 AM -> 0
      } else {
        hour = (hour % 12) + 12; // 12 PM -> 12
      }
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(
        2,
        "0"
      )}`;
    }

    return "";
  } catch (error) {
    console.error("Error formatting time to 24-hour:", error);
    return "";
  }
};

// Parsing functions
export const parseTimeCountdown = (
  input: string | undefined
): {
  hour: string;
  minute: string;
  meridiem: Meridiem;
} | null => {
  if (!input) return null;
  const trimmed = input.trim();

  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    const rawHour = Number(match12[1]);
    const minute = match12[2];
    const meridiem = match12[3].toUpperCase() as Meridiem;
    if (rawHour < 1 || rawHour > 12) return null;
    const minuteNum = Number(minute);
    if (isNaN(minuteNum) || minuteNum < 0 || minuteNum > 59) return null;
    return { hour: String(rawHour), minute, meridiem };
  }

  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hour24 = Number(match24[1]);
    const minute = match24[2];
    if (isNaN(hour24) || hour24 < 0 || hour24 > 23) return null;
    const minuteNum = Number(minute);
    if (isNaN(minuteNum) || minuteNum < 0 || minuteNum > 59) return null;
    const meridiem: Meridiem = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return { hour: String(hour12), minute, meridiem };
  }

  return null;
};

export const parseTimeTimer = (
  input: string | undefined
): {
  hour: string;
  minute: string;
  second: string;
} | null => {
  if (!input) return null;
  const trimmed = input.trim();

  const match24s = trimmed.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (match24s) {
    const hour24 = Number(match24s[1]);
    const minute = match24s[2];
    const second = match24s[3];
    if (isNaN(hour24) || hour24 < 0 || hour24 > 23) return null;
    const minuteNum = Number(minute);
    if (isNaN(minuteNum) || minuteNum < 0 || minuteNum > 59) return null;
    const secondNum = Number(second);
    if (isNaN(secondNum) || secondNum < 0 || secondNum > 59) return null;
    return {
      hour: String(hour24).padStart(2, "0"),
      minute,
      second,
    };
  }
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hour24 = Number(match24[1]);
    const minute = match24[2];
    if (isNaN(hour24) || hour24 < 0 || hour24 > 23) return null;
    const minuteNum = Number(minute);
    if (isNaN(minuteNum) || minuteNum < 0 || minuteNum > 59) return null;
    return {
      hour: String(hour24).padStart(2, "0"),
      minute,
      second: "00",
    };
  }
  return null;
};

// Formatting functions
export const formatTimeCountdown = (
  hour: string,
  minute: string,
  meridiem: Meridiem
) => {
  const hh = pad2(hour);
  const mm = pad2(minute);
  const aa = meridiem;
  return formatTimeTo24Hour(`${hh}:${mm} ${aa}`);
};

export const formatTimeTimer = (
  hour: string,
  minute: string,
  second: string
) => {
  const hh = pad2(hour);
  const mm = pad2(minute);
  const ss = pad2(second);
  return `${hh}:${mm}:${ss}`;
};

// Shared snap logic
export const snapToNearest = (
  value: string,
  options: readonly string[]
): string => {
  const num = Number(value) || 0;
  const optionNums = options.map((x) => Number(x));
  let best = optionNums[0];
  let bestDiff = Math.abs(num - best);
  for (const opt of optionNums) {
    const diff = Math.abs(num - opt);
    if (diff < bestDiff) {
      best = opt;
      bestDiff = diff;
    }
  }
  return pad2(best);
};

// Duration conversion utilities (for timer variant)
export const durationToTime = (
  durationSeconds: number | undefined
): {
  hour: string;
  minute: string;
  second: string;
} | null => {
  if (durationSeconds === undefined || durationSeconds === null) return null;
  const totalSeconds = Math.floor(Math.abs(durationSeconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return {
    hour: String(hours).padStart(2, "0"),
    minute: String(minutes).padStart(2, "0"),
    second: String(seconds).padStart(2, "0"),
  };
};

export const timeToDuration = (
  hour: string,
  minute: string,
  second: string
): number => {
  const h = Number(hour) || 0;
  const m = Number(minute) || 0;
  const s = Number(second) || 0;
  return h * 3600 + m * 60 + s;
};
