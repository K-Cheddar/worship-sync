"use client";

import React from "react";
import { TimePickerTimer } from "./TimePickerTimer";
import { TimePickerCountdown } from "./TimePickerCountdown";
import type { TimePickerProps } from "./types";

export const TimePicker: React.FC<TimePickerProps> = ({
  variant = "countdown",
  ...props
}) => {
  if (variant === "timer") {
    return <TimePickerTimer {...props} />;
  }
  return <TimePickerCountdown {...props} />;
};

export default TimePicker;
