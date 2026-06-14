"use client";

import type { ReactNode } from "react";
import Label from "@/components/ui/Label";
import { cn } from "@/utils/cnHelper";
import type { TimePickerLabelLayout } from "./types";

type TimePickerFieldLayoutProps = {
  label?: string;
  labelLayout?: TimePickerLabelLayout;
  hideLabel?: boolean;
  labelClassName?: string;
  fieldId: string;
  className?: string;
  children: ReactNode;
  message?: string;
  messageType?: "error" | "warning" | "success" | "info";
};

const TimePickerFieldLayout = ({
  label,
  labelLayout = "inline",
  hideLabel = false,
  labelClassName,
  fieldId,
  className,
  children,
  message,
  messageType = "info",
}: TimePickerFieldLayoutProps) => {
  const showLabel = label != null;
  const isInlineLabel = labelLayout === "inline" && showLabel;

  const labelEl = showLabel ? (
    <Label
      htmlFor={fieldId}
      className={cn(
        "p-1 text-sm font-semibold leading-none",
        !isInlineLabel && "block",
        hideLabel && "sr-only",
        labelClassName,
      )}
    >
      {label}:
    </Label>
  ) : null;

  const messageEl = message ? (
    <p
      className={cn(
        "text-sm",
        isInlineLabel ? "text-right" : "mt-1",
        messageType === "error" && "text-red-700",
        messageType === "warning" && "text-yellow-700",
        messageType === "success" && "text-green-700",
        messageType === "info" && "text-gray-700",
      )}
    >
      {message}
    </p>
  ) : null;

  const fieldWrap = (
    <div className={cn("relative min-w-0", isInlineLabel ? "flex-1" : "w-full")}>
      {children}
    </div>
  );

  if (isInlineLabel) {
    return (
      <div className={cn("group relative h-fit", className)}>
        <div className="flex w-full min-w-0 flex-row flex-wrap items-center gap-x-2 gap-y-1">
          {labelEl}
          {fieldWrap}
          {messageEl}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("group relative h-fit", className)}>
      {labelEl}
      {fieldWrap}
      {messageEl}
    </div>
  );
};

export default TimePickerFieldLayout;
