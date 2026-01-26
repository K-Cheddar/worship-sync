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
import { HOURS, MINUTES, pad2 } from "../../constants";
import {
  parseTimeCountdown,
  formatTimeCountdown,
  snapToNearest,
} from "./utils";
import type { BaseTimePickerProps, Segment, Meridiem } from "./types";

const MERIDIEMS: Meridiem[] = ["AM", "PM"];

export const TimePickerCountdown: React.FC<BaseTimePickerProps> = ({
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
  const initial = useMemo(
    () => parseTimeCountdown(typeof value === "string" ? value : ""),
    [value]
  );
  const [hour, setHour] = useState<string>(initial?.hour || "");
  const [minute, setMinute] = useState<string>(initial?.minute || "");
  const [meridiem, setMeridiem] = useState<Meridiem>(initial?.meridiem || "");

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [hourEntry, setHourEntry] = useState<string | null>(null);
  const [minuteEntry, setMinuteEntry] = useState<string | null>(null);
  const pendingSegmentRef = useRef<Segment | null>(null);
  const activeSegmentRef = useRef<Segment | null>(null);

  const getSegmentFromPos = (pos: number): Segment => {
    if (pos <= 1) return "hour";
    if (pos >= 3 && pos <= 4) return "minute";
    if (pos >= 6 && pos <= 7) return "meridiem";
    return "meridiem";
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
    else if (segment === "minute") selectSegment("meridiem");
  };

  useEffect(() => {
    if (typeof value === "number") return; // Timer variant uses numbers
    if (typeof value === "string") {
      if (!value) {
        setHour("");
        setMinute("");
        setMeridiem("");
        return;
      }
      const parsed = parseTimeCountdown(value);
      if (parsed) {
        setHour(parsed.hour);
        setMinute(parsed.minute);
        setMeridiem(parsed.meridiem);
      }
    }
  }, [value]);

  const handleCommit = (
    nextHour: string,
    nextMinute: string,
    nextMeridiem: Meridiem
  ) => {
    if (!nextHour || !nextMinute || !nextMeridiem) return;
    const time = formatTimeCountdown(nextHour, nextMinute, nextMeridiem);
    onChange?.(time);
  };

  const commitAndFormat = (
    nextHour: string,
    nextMinute: string,
    nextMeridiem: Meridiem
  ) => {
    const h = Math.max(1, Math.min(12, Number(nextHour) || 12));
    let m = nextMinute;

    if (snapMinutes && !MINUTES.includes(m)) {
      m = snapToNearest(m, MINUTES);
    } else if (!snapMinutes) {
      const minuteNum = Number(m) || 0;
      m = pad2(Math.max(0, Math.min(59, minuteNum)));
    }

    const time = formatTimeCountdown(String(h), m, nextMeridiem);
    setHour(String(h));
    setMinute(m);
    setMeridiem(nextMeridiem);
    onChange?.(time);
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
      else if (segment === "meridiem") selectSegment("minute");
      return;
    }
    if (key === "ArrowRight") {
      e.preventDefault();
      if (segment === "hour") selectSegment("minute");
      else if (segment === "minute") selectSegment("meridiem");
      else if (segment === "meridiem") selectSegment("meridiem");
      return;
    }

    if (segment === "hour") {
      if (/^\d$/.test(key)) {
        e.preventDefault();
        const d = Number(key);
        if (hourEntry === null) {
          if (d === 0) {
            setHourEntry("0");
            setHour("0");
            selectSegment("hour");
            return;
          }
          if (d === 1) {
            setHourEntry("1");
            setHour("1");
            selectSegment("hour");
            return;
          }
          commitAndFormat(String(d), minute || "00", meridiem);
          setHourEntry(null);
          moveToNextSegment("hour");
          return;
        }
        if (hourEntry === "0") {
          if (d >= 1 && d <= 9) {
            const finalHour = Number(`${hourEntry}${d}`);
            commitAndFormat(String(finalHour), minute || "00", meridiem);
            setHourEntry(null);
            moveToNextSegment("hour");
            return;
          }
          setHourEntry(d === 1 ? "1" : d === 0 ? "0" : null);
          if (d === 1) setHour("1");
          else if (d === 0) setHour("0");
          else {
            commitAndFormat(String(d), minute || "00", meridiem);
            setHourEntry(null);
            moveToNextSegment("hour");
          }
          return;
        }
        if (hourEntry === "1") {
          if (d >= 0 && d <= 2) {
            const finalHour = Number(`${hourEntry}${d}`);
            commitAndFormat(String(finalHour), minute || "00", meridiem);
            setHourEntry(null);
            moveToNextSegment("hour");
            return;
          }
          commitAndFormat(String(d), minute || "00", meridiem);
          setHourEntry(null);
          moveToNextSegment("hour");
          return;
        }
        return;
      }
      return;
    }

    if (segment === "minute") {
      if (/^\d$/.test(key)) {
        e.preventDefault();
        const d = Number(key);
        if (minuteEntry === null) {
          if (d >= 0 && d <= 5) {
            setMinuteEntry(String(d));
            setMinute(pad2(d));
            selectSegment("minute");
            return;
          }
          commitAndFormat(hour || "12", pad2(d), meridiem);
          setMinuteEntry(null);
          moveToNextSegment("minute");
          return;
        }
        const first = Number(minuteEntry);
        const final = first * 10 + d;
        commitAndFormat(hour || "12", pad2(final), meridiem);
        setMinuteEntry(null);
        moveToNextSegment("minute");
        return;
      }
      return;
    }

    if (segment === "meridiem") {
      e.preventDefault();
      if (key.toLowerCase() === "a") {
        commitAndFormat(hour || "12", minute || "00", "AM");
        selectSegment("meridiem");
        return;
      }
      if (key.toLowerCase() === "p") {
        commitAndFormat(hour || "12", minute || "00", "PM");
        selectSegment("meridiem");
        return;
      }
      return;
    }
  };

  const incrementSegment = (segment: Segment, delta: number) => {
    // Reset entry states when using arrows
    setHourEntry(null);
    setMinuteEntry(null);

    // Use the active segment ref to maintain selection during rapid clicks
    const activeSegment = activeSegmentRef.current || segment;
    activeSegmentRef.current = activeSegment;

    if (activeSegment === "hour") {
      const current = Number(hour) || 12;
      let newHour = current + delta;
      // Wrap around 12-hour format: 1-12
      if (newHour < 1) newHour = 12;
      else if (newHour > 12) newHour = 1;
      commitAndFormat(String(newHour), minute || "00", meridiem);
      // Maintain selection synchronously
      const range = [0, 2];
      const el = inputRef.current;
      if (el) {
        el.setSelectionRange(range[0], range[1]);
      }
    } else if (activeSegment === "minute") {
      const current = Number(minute) || 0;
      let newMinute = current + delta;
      // Clamp to 0-59 (no overflow for countdown minutes)
      newMinute = Math.max(0, Math.min(59, newMinute));
      commitAndFormat(hour || "12", pad2(newMinute), meridiem);
      // Maintain selection synchronously
      const range = [3, 5];
      const el = inputRef.current;
      if (el) {
        el.setSelectionRange(range[0], range[1]);
      }
    } else if (activeSegment === "meridiem") {
      const newMeridiem: Meridiem =
        delta > 0
          ? meridiem === "AM"
            ? "PM"
            : "AM"
          : meridiem === "PM"
            ? "AM"
            : "PM";
      commitAndFormat(hour || "12", minute || "00", newMeridiem);
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
    " " +
    (meridiem ? meridiem : "aa");

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
              items={HOURS as readonly string[]}
              value={hour}
              onChange={(h) => {
                setHour(h);
                handleCommit(h, minute || "00", meridiem);
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
                handleCommit(hour || "12", m, meridiem);
                selectSegment("minute");
              }}
            />
            <Listbox
              label="AM/PM"
              aria-label="Select AM or PM"
              items={MERIDIEMS as readonly string[]}
              value={meridiem}
              onChange={(ap) => {
                setMeridiem(ap as Meridiem);
                handleCommit(hour || "12", minute || "00", ap as Meridiem);
                selectSegment("meridiem");
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
