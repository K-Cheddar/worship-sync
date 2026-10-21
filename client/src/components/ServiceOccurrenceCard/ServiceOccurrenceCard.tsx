import type { ReactNode } from "react";
import Button from "../Button/Button";
import ScheduleOccurrenceRibbon from "./ScheduleOccurrenceRibbon";
import {
  scheduleTodayBorderClassName,
  scheduleUpNextBorderClassName,
} from "./priorityStyles";
import { cn } from "@/utils/cnHelper";

export const SERVICE_OCCURRENCE_GRID_CLASS_NAME =
  "grid w-full max-w-[90rem] grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-2";

export type ServiceOccurrenceCardDateParts = {
  weekday: string;
  month: string;
  day: string;
  time: string | null;
  label: string;
};

export const getServiceOccurrenceCardDateParts = ({
  calendarDate,
  startsAt,
  timeZone,
  showTime = true,
}: {
  calendarDate: string;
  startsAt: string;
  timeZone: string;
  showTime?: boolean;
}): ServiceOccurrenceCardDateParts => {
  const isPlainDate = /^\d{4}-\d{2}-\d{2}$/.test(calendarDate);
  const date = isPlainDate
    ? new Date(calendarDate + "T12:00:00.000Z")
    : new Date(startsAt);
  const scheduledStart = new Date(startsAt);
  if (Number.isNaN(date.getTime())) {
    return {
      weekday: "—",
      month: "",
      day: "?",
      time: null,
      label: "Date not set",
    };
  }

  const calendarTimeZone = isPlainDate ? "UTC" : timeZone;
  const weekday = date.toLocaleString(undefined, {
    timeZone: calendarTimeZone,
    weekday: "short",
  });
  const month = date.toLocaleString(undefined, {
    timeZone: calendarTimeZone,
    month: "short",
  });
  const day = date.toLocaleString(undefined, {
    timeZone: calendarTimeZone,
    day: "numeric",
  });
  const time = showTime && !Number.isNaN(scheduledStart.getTime())
    ? scheduledStart.toLocaleString(undefined, {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    })
    : null;

  return {
    weekday,
    month,
    day,
    time,
    label: [weekday, `${month} ${day}`, time].filter(Boolean).join(" · "),
  };
};

export type ServiceOccurrenceCardStatusTone = "success" | "neutral";

type ServiceOccurrenceCardProps = {
  calendarDate: string;
  startsAt: string;
  timeZone: string;
  serviceName?: string;
  showTime?: boolean;
  ariaLabel: string;
  ariaBusy?: boolean;
  isNextUpcoming: boolean;
  isToday: boolean;
  isPast?: boolean;
  statusTone?: ServiceOccurrenceCardStatusTone;
  statusMarker?: ReactNode;
  onOpen: () => void;
  children?: ReactNode;
};

/**
 * Shared date/service presentation for Plans and My Schedule. The open action
 * is a dedicated button; page-specific controls render in the sibling footer.
 */
const ServiceOccurrenceCard = ({
  calendarDate,
  startsAt,
  timeZone,
  serviceName,
  showTime = true,
  ariaLabel,
  ariaBusy,
  isNextUpcoming,
  isToday,
  isPast = false,
  statusTone = "neutral",
  statusMarker,
  onOpen,
  children,
}: ServiceOccurrenceCardProps) => {
  const dateParts = getServiceOccurrenceCardDateParts({
    calendarDate,
    startsAt,
    timeZone,
    showTime,
  });
  const isSuccess = statusTone === "success";
  const markerBorderClassName = isNextUpcoming
    ? scheduleUpNextBorderClassName
    : isToday
      ? scheduleTodayBorderClassName
      : undefined;

  return (
    <li className="relative min-w-0">
      <ScheduleOccurrenceRibbon
        isNextUpcoming={isNextUpcoming}
        isToday={isToday}
      />
      <article
        className={cn(
          "relative overflow-hidden rounded-lg border",
          isSuccess
            ? "border-emerald-500/30 bg-gray-800/80"
            : "border-gray-600/70 bg-gray-800/70",
          !isNextUpcoming && !isToday && (isSuccess
            ? "has-[>button:hover]:border-emerald-400/45 has-[>button:focus-visible]:border-emerald-400/45"
            : "has-[>button:hover]:border-orange-400/35 has-[>button:focus-visible]:border-orange-400/35"),
          markerBorderClassName,
          isPast && "opacity-55",
        )}
      >
        <Button
          type="button"
          variant="none"
          aria-label={ariaLabel}
          aria-busy={ariaBusy || undefined}
          className={cn(
            "flex min-h-[56px] w-full min-w-0 items-center gap-2 rounded-none px-2.5 py-2 text-left transition-colors hover:bg-white/[0.03] focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-400",
            (isNextUpcoming || isToday) && "pt-3",
          )}
          onClick={onOpen}
        >
          <time
            dateTime={calendarDate || undefined}
            className="relative flex w-[44px] shrink-0 flex-col items-center justify-center gap-px text-center leading-none"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              {dateParts.weekday}
            </span>
            <span className="text-[21px] font-semibold leading-none text-gray-100">
              {dateParts.day}
            </span>
            <span className="text-[10px] text-gray-400">
              {dateParts.month}
            </span>
            <span aria-hidden="true" className="absolute inset-y-0 right-0 w-px bg-gray-700/80" />
          </time>
          <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
              {serviceName ? (
                <span
                  className="min-w-0 whitespace-normal break-words text-[13px] font-medium leading-snug text-gray-300 line-clamp-2"
                  title={serviceName}
                >
                  {serviceName}
                </span>
              ) : null}
              {dateParts.time ? (
                <time dateTime={startsAt} className="text-[11px] leading-tight text-gray-400">
                  {dateParts.time}
                </time>
              ) : null}
            </span>
            {statusMarker ? (
              <span className="inline-flex shrink-0 items-center" aria-hidden="true">
                {statusMarker}
              </span>
            ) : null}
          </span>
        </Button>
        {children ? (
          <div className="border-t border-gray-700/80 px-2.5 py-2 sm:px-3">
            {children}
          </div>
        ) : null}
      </article>
    </li>
  );
};

export default ServiceOccurrenceCard;
