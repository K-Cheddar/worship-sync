"use client";

import React, { useMemo, useRef, useState, useEffect, useId } from "react";
import Input from "@/components/ui/Input";
import Label from "@/components/ui/Label";
import { cn } from "@/utils/cnHelper";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { Listbox } from "./ListBox";
import { HOURS_24, MINUTES, SECONDS, pad2 } from "../../constants";
import {
  parseTimeTimer,
  snapToNearest,
  durationToTime,
  timeToDuration,
} from "./utils";
import type { BaseTimePickerProps, Segment } from "./types";

export const TimePickerTimer: React.FC<BaseTimePickerProps> = ({
  label,
  value,
  onChange,
  id,
  className,
  inputClassName,
  dataTestInputId,
  portal = true,
  message,
  messageType = "info",
  snapMinutes = false,
}) => {
  const [open, setOpen] = useState(false);

  // Parse value - can be number (duration in seconds) or string (time format)
  const initial = useMemo(() => {
    if (typeof value === "number") {
      return durationToTime(value);
    }
    if (typeof value === "string") {
      return parseTimeTimer(value);
    }
    return null;
  }, [value]);

  const [hour, setHour] = useState<string>(initial?.hour || "");
  const [minute, setMinute] = useState<string>(initial?.minute || "");
  const [second, setSecond] = useState<string>(initial?.second || "");

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [hourEntry, setHourEntry] = useState<string | null>(null);
  const [minuteEntry, setMinuteEntry] = useState<string | null>(null);
  const [secondEntry, setSecondEntry] = useState<string | null>(null);
  const pendingSegmentRef = useRef<Segment | null>(null);
  const activeSegmentRef = useRef<Segment | null>(null);

  const getSegmentFromPos = (pos: number): Segment => {
    if (pos <= 1) return "hour";
    if (pos >= 3 && pos <= 4) return "minute";
    if (pos >= 6 && pos <= 7) return "second";
    return "hour";
  };

  const getCurrentSegment = (): Segment | null => {
    const node = inputRef.current;
    if (!node) return null;
    const caret = node.selectionStart ?? 0;
    return getSegmentFromPos(caret);
  };

  const selectSegment = (segment: Segment) => {
    const node = inputRef.current;
    if (!node) return;
    const before = getCurrentSegment();
    if (!before || before !== segment) {
      setHourEntry(null);
      setMinuteEntry(null);
      setSecondEntry(null);
    }
    pendingSegmentRef.current = segment;
    activeSegmentRef.current = segment;
    const range =
      segment === "hour" ? [0, 2] : segment === "minute" ? [3, 5] : [6, 8];
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(range[0], range[1]);
    });
  };

  const moveToNextSegment = (segment: Segment) => {
    if (segment === "hour") selectSegment("minute");
    else if (segment === "minute") selectSegment("second");
    else if (segment === "second") selectSegment("second");
  };

  useEffect(() => {
    if (value === undefined || value === null || value === "") {
      setHour("");
      setMinute("");
      setSecond("");
      return;
    }

    if (typeof value === "number") {
      const parsed = durationToTime(value);
      if (parsed) {
        setHour(parsed.hour);
        setMinute(parsed.minute);
        setSecond(parsed.second || "00");
      }
    } else if (typeof value === "string") {
      const parsed = parseTimeTimer(value);
      if (parsed) {
        setHour(parsed.hour);
        setMinute(parsed.minute);
        setSecond(parsed.second || "00");
      }
    }
  }, [value]);

  const handleCommit = (
    nextHour: string,
    nextMinute: string,
    nextSecond: string
  ) => {
    if (!nextHour || !nextMinute || !nextSecond) return;
    // Convert to duration (seconds) for timer variant
    const duration = timeToDuration(nextHour, nextMinute, nextSecond);
    onChange?.(duration);
  };

  const commitAndFormat = (
    nextHour: string,
    nextMinute: string,
    nextSecond: string
  ) => {
    let h = Math.max(0, Number(nextHour) || 0);
    let m = nextMinute;
    let s = nextSecond || "00";

    // Handle seconds overflow first (seconds >= 60)
    let secondNum = Number(s) || 0;
    if (secondNum >= 60) {
      const extraMinutes = Math.floor(secondNum / 60);
      secondNum = secondNum % 60;
      const currentMinutes = Number(m) || 0;
      m = String(currentMinutes + extraMinutes);
    }

    // Handle minutes overflow (minutes >= 60)
    let minuteNum = Number(m) || 0;
    if (minuteNum >= 60) {
      const extraHours = Math.floor(minuteNum / 60);
      minuteNum = minuteNum % 60;
      h = h + extraHours;
    }

    // Apply snapping or clamping
    const minuteStr = pad2(minuteNum);
    if (snapMinutes && !MINUTES.includes(minuteStr)) {
      m = snapToNearest(minuteStr, MINUTES);
    } else if (!snapMinutes) {
      m = pad2(Math.max(0, Math.min(59, minuteNum)));
    } else {
      m = minuteStr;
    }

    const secondStr = pad2(secondNum);
    if (snapMinutes && !SECONDS.includes(secondStr)) {
      s = snapToNearest(secondStr, SECONDS);
    } else if (!snapMinutes) {
      s = pad2(Math.max(0, Math.min(59, secondNum)));
    } else {
      s = secondStr;
    }

    // Convert to duration (seconds) for timer variant
    const duration = timeToDuration(String(h).padStart(2, "0"), m, s);
    setHour(String(h).padStart(2, "0"));
    setMinute(m);
    setSecond(s);
    onChange?.(duration);
  };

  const handleMaskedTyping = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const key = e.key;
    if (key === "Tab") return;
    const node = e.currentTarget;
    const caret = node.selectionStart ?? 0;
    const segment = getSegmentFromPos(caret);

    if (key === "ArrowLeft") {
      e.preventDefault();
      if (segment === "minute") selectSegment("hour");
      else if (segment === "second") selectSegment("minute");
      else if (segment === "hour") selectSegment("hour");
      return;
    }
    if (key === "ArrowRight") {
      e.preventDefault();
      if (segment === "hour") selectSegment("minute");
      else if (segment === "minute") selectSegment("second");
      else if (segment === "second") selectSegment("second");
      return;
    }

    if (segment === "hour") {
      if (/^\d$/.test(key)) {
        e.preventDefault();
        const d = Number(key);
        if (hourEntry === null) {
          if (d >= 0 && d <= 2) {
            setHourEntry(String(d));
            setHour(pad2(d));
            selectSegment("hour");
            return;
          }
          commitAndFormat(pad2(d), minute || "00", second || "00");
          setHourEntry(null);
          moveToNextSegment("hour");
          return;
        }
        const first = Number(hourEntry);
        const finalHour = first * 10 + d;
        if (finalHour >= 0 && finalHour <= 23) {
          commitAndFormat(pad2(finalHour), minute || "00", second || "00");
          setHourEntry(null);
          moveToNextSegment("hour");
          return;
        }
        commitAndFormat(pad2(d), minute || "00", second || "00");
        setHourEntry(null);
        moveToNextSegment("hour");
        return;
      }
      return;
    }

    if (segment === "minute") {
      if (/^\d$/.test(key)) {
        e.preventDefault();
        const d = Number(key);
        if (minuteEntry === null) {
          // Always wait for second digit to allow values like 60-99
          setMinuteEntry(String(d));
          setMinute(pad2(d));
          selectSegment("minute");
          return;
        }
        const first = Number(minuteEntry);
        const final = first * 10 + d;
        commitAndFormat(hour || "00", pad2(final), second || "00");
        setMinuteEntry(null);
        moveToNextSegment("minute");
        return;
      }
      return;
    }

    if (segment === "second") {
      if (/^\d$/.test(key)) {
        e.preventDefault();
        const d = Number(key);
        if (secondEntry === null) {
          // Always wait for second digit to allow values like 60-99
          setSecondEntry(String(d));
          setSecond(pad2(d));
          selectSegment("second");
          return;
        }
        const first = Number(secondEntry);
        const final = first * 10 + d;
        commitAndFormat(hour || "00", minute || "00", pad2(final));
        setSecondEntry(null);
        selectSegment("second");
        return;
      }
      return;
    }
  };

  const incrementSegment = (segment: Segment, delta: number) => {
    // Reset entry states when using arrows
    setHourEntry(null);
    setMinuteEntry(null);
    setSecondEntry(null);

    // Use the active segment ref to maintain selection during rapid clicks
    const activeSegment = activeSegmentRef.current || segment;
    activeSegmentRef.current = activeSegment;

    if (activeSegment === "hour") {
      const current = Number(hour) || 0;
      const newHour = Math.max(0, current + delta);
      commitAndFormat(pad2(newHour), minute || "00", second || "00");
      // Maintain selection synchronously
      const range = [0, 2];
      const el = inputRef.current;
      if (el) {
        el.setSelectionRange(range[0], range[1]);
      }
    } else if (activeSegment === "minute") {
      const current = Number(minute) || 0;
      let newMinute = current + delta;
      // Allow overflow - commitAndFormat will handle it
      commitAndFormat(hour || "00", pad2(newMinute), second || "00");
      // Maintain selection synchronously
      const range = [3, 5];
      const el = inputRef.current;
      if (el) {
        el.setSelectionRange(range[0], range[1]);
      }
    } else if (activeSegment === "second") {
      const current = Number(second) || 0;
      let newSecond = current + delta;
      // Allow overflow - commitAndFormat will handle it
      commitAndFormat(hour || "00", minute || "00", pad2(newSecond));
      // Maintain selection synchronously
      const range = [6, 8];
      const el = inputRef.current;
      if (el) {
        el.setSelectionRange(range[0], range[1]);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      // Get current segment or use active segment ref
      const segment = getCurrentSegment() || activeSegmentRef.current;
      if (segment) {
        // Ensure active segment is set
        if (!activeSegmentRef.current) {
          activeSegmentRef.current = segment;
        }
        incrementSegment(segment, -1);
      } else {
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      // Get current segment or use active segment ref
      const segment = getCurrentSegment() || activeSegmentRef.current;
      if (segment) {
        // Ensure active segment is set
        if (!activeSegmentRef.current) {
          activeSegmentRef.current = segment;
        }
        incrementSegment(segment, 1);
      }
      return;
    }
    handleMaskedTyping(e);
  };

  const handleFocus = () => {
    const requested = pendingSegmentRef.current;
    if (requested) {
      const range =
        requested === "hour"
          ? [0, 2]
          : requested === "minute"
            ? [3, 5]
            : [6, 8];
      pendingSegmentRef.current = null;
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.setSelectionRange(range[0], range[1]);
      });
      return;
    }
    requestAnimationFrame(() => selectSegment("hour"));
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLInputElement>) => {
    const node = e.currentTarget;
    const caret = node.selectionStart ?? 0;
    selectSegment(getSegmentFromPos(caret));
  };

  const generatedId = useId();
  const dropdownId = id ?? generatedId;

  const inputValue =
    (hour ? pad2(hour) : "hh") +
    ":" +
    (minute ? pad2(minute) : "mm") +
    ":" +
    (second ? pad2(second) : "ss");

  return (
    <div className={cn("flex gap-2", className)}>
      {label && (
        <Label htmlFor={dropdownId} className="pl-1">
          {label}:
        </Label>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="relative">
            <Input
              data-testid={dataTestInputId}
              id={dropdownId}
              value={inputValue}
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              onMouseUp={handleMouseUp}
              aria-label={label || "Time"}
              role="combobox"
              aria-expanded={open}
              className={inputClassName}
              ref={inputRef}
              readOnly
            />
          </div>
        </PopoverTrigger>
        <PopoverContent
          className="z-110 w-auto p-3 bg-card"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
          portal={portal}
        >
          <div
            className="flex gap-1"
            role="group"
            aria-label="Time selection lists"
          >
            <Listbox
              label="Hour"
              aria-label="Select hour"
              items={HOURS_24 as readonly string[]}
              value={hour}
              onChange={(h) => {
                setHour(h);
                handleCommit(h, minute || "00", second || "00");
                selectSegment("hour");
              }}
            />
            <Listbox
              label="Minute"
              aria-label="Select minutes"
              items={MINUTES as readonly string[]}
              value={minute}
              onChange={(m) => {
                setMinute(m);
                handleCommit(hour || "00", m, second || "00");
                selectSegment("minute");
              }}
            />
            <Listbox
              label="Second"
              aria-label="Select seconds"
              items={SECONDS as readonly string[]}
              value={second}
              onChange={(s) => {
                setSecond(s);
                handleCommit(hour || "00", minute || "00", s);
                selectSegment("second");
              }}
            />
          </div>
        </PopoverContent>
      </Popover>
      {message && (
        <div className="flex gap-1">
          <p
            className={cn(
              "text-sm text-right",
              messageType === "error" && "text-red-700",
              messageType === "warning" && "text-yellow-700",
              messageType === "success" && "text-green-700",
              messageType === "info" && "text-gray-700"
            )}
          >
            {message}
          </p>
        </div>
      )}
    </div>
  );
};
