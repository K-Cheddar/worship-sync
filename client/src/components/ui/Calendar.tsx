"use client";

import * as React from "react";
import { DayPicker } from "react-day-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/utils/cnHelper";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

const currentYear = new Date().getFullYear();

/**
 * Dark/cyan themed calendar built on react-day-picker v9. Defaults to month +
 * year dropdowns for quick navigation; the prev/next arrows also work. Used by
 * `DatePicker`, but can be reused directly for inline calendars.
 */
const Calendar = ({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "dropdown",
  startMonth = new Date(1920, 0),
  endMonth = new Date(currentYear + 10, 11),
  ...props
}: CalendarProps) => {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      startMonth={startMonth}
      endMonth={endMonth}
      className={cn("p-3 text-sm text-gray-100", className)}
      classNames={{
        months: "flex flex-col gap-4",
        month: "relative flex flex-col gap-4",
        month_caption: "flex h-9 items-center justify-center px-9",
        caption_label: "text-sm font-semibold text-white",
        dropdowns: "flex items-center justify-center gap-2",
        dropdown_root: "relative",
        dropdown:
          "cursor-pointer rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm font-medium text-gray-100 outline-none hover:border-gray-600 focus-visible:ring-2 focus-visible:ring-cyan-500/40",
        nav: "absolute inset-x-0 top-0 z-10 flex items-center justify-between",
        button_previous: cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-700",
          "text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-40",
        ),
        button_next: cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-700",
          "text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-40",
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 text-xs font-medium text-gray-400",
        week: "flex w-full mt-1",
        day: "h-9 w-9 p-0 text-center",
        day_button: cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-md font-normal",
          "text-gray-100 hover:bg-gray-800 aria-selected:opacity-100",
        ),
        selected: cn(
          "[&>button]:bg-cyan-500 [&>button]:text-white [&>button]:hover:bg-cyan-400",
        ),
        today: "[&>button]:border [&>button]:border-cyan-400/60",
        outside: "[&>button]:text-gray-600",
        disabled: "[&>button]:text-gray-700 [&>button]:opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          const Comp = orientation === "left" ? ChevronLeft : ChevronRight;
          return <Comp className="h-4 w-4" />;
        },
        Dropdown: ({ options, value, onChange, "aria-label": ariaLabel }) => (
          <select
            aria-label={ariaLabel}
            value={value}
            onChange={onChange}
            className="cursor-pointer rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm font-medium text-gray-100 outline-none hover:border-gray-600 focus-visible:ring-2 focus-visible:ring-cyan-500/40"
          >
            {options?.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>
        ),
      }}
      {...props}
    />
  );
};

export default Calendar;
