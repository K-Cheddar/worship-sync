import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  ExternalLink,
  TriangleAlert,
  X,
} from "lucide-react";
import AppPageShell from "../components/AppPageShell/AppPageShell";
import { PAGE_APPEARANCES } from "./pageAppearances";
import Button from "../components/Button/Button";
import ButtonGroup from "../components/Button/ButtonGroup";
import ButtonGroupItem from "../components/Button/ButtonGroupItem";
import Icon from "../components/Icon/Icon";
import Input from "../components/Input/Input";
import SegmentedControl from "../components/SegmentedControl/SegmentedControl";
import Select from "../components/Select/Select";
import { GlobalInfoContext } from "../context/globalInfo";
import { useToast } from "../context/toastContext";
import { getApiErrorMessage, getApiErrorStatus, showApiErrorToast } from "../utils/apiErrorToast";
import { useSyncOnReconnect } from "../hooks/useSyncOnReconnect";
import {
  acceptPendingMyAssignments,
  getMyTeamAssignments,
  getMyVolunteerAvailability,
  submitMyVolunteerAvailabilityOccurrence,
  updateMyBlockoutDates,
  respondToMyAssignment,
  type MyScheduleOccurrence,
  type MyScheduleServing,
} from "../api/auth";
import type { TeamBlockoutDateRange } from "../api/authTypes";
import {
  buildMyScheduleExportModelForOccurrences,
} from "./buildMyScheduleExportModel";
import MyScheduleBlockouts, { type SavedDatesLoadState } from "./MyScheduleBlockouts";
import type { MyScheduleMember, MyScheduleOperations, PersonalScheduleAccess } from "./myScheduleOperations";
import {
  buildMyScheduleTimeline,
  groupMyScheduleByMonth,
  groupMyScheduleByService,
  myScheduleOccurrenceDate,
  myScheduleServiceGroupKey,
  type MyScheduleTimelineOccurrence,
  type TimelineAvailabilityRequest,
} from "./myScheduleTimeline";
import MyScheduleServicePlanPanel from "./MyScheduleServicePlanPanel";
import {
  findBlockoutRangeForDate,
  formatBlockoutDateRangeLabel,
} from "./Teams/teamsUtils";
import ScheduleExportTable from "./Teams/schedule/ScheduleExportTable";
import ScheduleOccurrenceRibbon from "./Teams/schedule/ScheduleOccurrenceRibbon";
import SchedulePdfExportButton from "./Teams/schedule/SchedulePdfExportButton";
import type { ScheduleExportLayout } from "./Teams/schedule/scheduleExportPdf";
import {
  scheduleTodayBorderClassName,
  scheduleUpNextBorderClassName,
} from "./Teams/schedule/scheduleUtils";
import { cn } from "@/utils/cnHelper";
import { isOccurrenceToday } from "../utils/teamScheduleOccurrences";

/**
 * A volunteer's own services: when they serve, in what capacity, who is on with
 * them, and what is planned.
 *
 * The only Teams surface someone with `teams: "none"` can reach. The endpoint is
 * self-scoped and resolves names, dates, and plan titles server-side, so this
 * page never needs permission to read the roster.
 *
 * Navigation mirrors Plans + the service plan editor: pick a date from a tile
 * list, then move between services with previous/next (and a jump select).
 * Schedule and service plan tabs reuse the public schedule table and public
 * service plan chrome.
 *
 * Volunteers can change their own time off, assignment responses, and requested
 * service availability through self-scoped writes. Emailed assignment response
 * links keep using the same response endpoint.
 */

const ALL_TEAMS = "__all_teams__";
const ALL_SERVICES = "__all_services__";

type DetailTab = "schedule" | "servicePlan";

const plansForOccurrence = (occurrence: MyScheduleOccurrence) =>
  occurrence.plans?.length
    ? occurrence.plans
    : occurrence.plan
      ? [occurrence.plan]
      : [];

const SCHEDULE_LAYOUT_OPTIONS: {
  value: ScheduleExportLayout;
  label: string;
}[] = [
    { value: "byDate", label: "By date" },
    { value: "transpose", label: "By position" },
    { value: "grid", label: "Grid" },
  ];

type OccurrenceTileParts = {
  weekday: string;
  month: string;
  day: string;
  time: string;
  label: string;
};

const formatWhen = (startsAt: string, timeZone: string): string => {
  if (!startsAt) return "Date not set";
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) return "Date not set";
  return parsed.toLocaleString(undefined, {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
};

/**
 * My Schedule only lists services with a real start time. Older assignment rows
 * can arrive with an empty `startsAt`; without a datetime they cannot be placed
 * in past vs upcoming and would otherwise show as "?" in the upcoming list.
 */
const hasDatedStartsAt = (occurrence: MyScheduleOccurrence): boolean =>
  Number.isFinite(Date.parse(occurrence.startsAt));

const getOccurrenceTileParts = (
  occurrence: Pick<MyScheduleOccurrence, "date" | "startsAt"> & {
    availabilityRequests?: TimelineAvailabilityRequest[];
  },
  timeZone: string,
): OccurrenceTileParts => {
  const calendarDate = myScheduleOccurrenceDate(occurrence, timeZone);
  const savedDate = /^\d{4}-\d{2}-\d{2}$/.test(calendarDate)
    ? new Date(`${calendarDate}T12:00:00.000Z`)
    : null;
  const date = savedDate || new Date(occurrence.startsAt);
  if (Number.isNaN(date.getTime())) {
    return {
      weekday: "—",
      month: "",
      day: "?",
      time: "",
      label: "Date not set",
    };
  }
  const calendarTimeZone = savedDate ? "UTC" : timeZone;
  const weekday = date.toLocaleString(undefined, { timeZone: calendarTimeZone, weekday: "short" });
  const month = date.toLocaleString(undefined, { timeZone: calendarTimeZone, month: "short" });
  const day = date.toLocaleString(undefined, { timeZone: calendarTimeZone, day: "numeric" });
  const time = date.toLocaleString(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  return {
    weekday,
    month,
    day,
    time,
    label: `${weekday} · ${month} ${day} · ${time}`,
  };
};

const occurrenceServiceLabel = (occurrence: MyScheduleOccurrence): string => {
  const name = String(occurrence.name || "").trim();
  if (name) return name;
  return "Service";
};

const myRoleLabel = (occurrence: MyScheduleOccurrence): string => {
  const myRoles = occurrence.serving.filter((person) => person.isMe);
  if (myRoles.length === 0) return "";
  return myRoles
    .map((role) =>
      [role.positionName, role.teamName].filter(Boolean).join(" · "),
    )
    .join("  |  ");
};

type AssignmentResponse = "pending" | "accepted" | "declined";

const RESPONSE_CHIP: Record<
  Exclude<AssignmentResponse, "pending">,
  { label: string; className: string; icon: typeof Check }
> = {
  accepted: {
    label: "Accepted",
    className: "bg-emerald-500/10 text-emerald-200",
    icon: Check,
  },
  declined: {
    label: "Declined",
    className: "bg-red-500/10 text-red-200",
    icon: X,
  },
};

/**
 * Accept / decline for one slot this person holds.
 *
 * Two states, because the emphasis differs. Unanswered, the job is to answer:
 * both choices sit in front of the reader. Once answered, the job is done and
 * the row states plainly what they said — changing it is still possible, but
 * leaving two equal buttons there reads as though nothing was recorded.
 *
 * Changing an answer stays one click away rather than being hidden: the
 * alternative is emailing the worship leader, which is the back-and-forth this
 * whole thing replaces.
 */
const AssignmentResponseRow = ({
  slot,
  disabled,
  isPast = false,
  isSaving = false,
  onRespond,
}: {
  slot: MyScheduleServing;
  disabled: boolean;
  isPast?: boolean;
  isSaving?: boolean;
  onRespond: (
    slot: MyScheduleServing,
    response: "accepted" | "declined",
  ) => void;
}) => {
  const response: AssignmentResponse = slot.response || "pending";
  const answered = response !== "pending";
  const chip = answered ? RESPONSE_CHIP[response] : null;
  const role = [slot.positionName, slot.teamName].filter(Boolean).join(" · ");
  const [changing, setChanging] = useState(false);
  const showChoices = (!answered && !isPast) || changing;

  const choose = (next: "accepted" | "declined") => {
    setChanging(false);
    onRespond(slot, next);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-gray-950/45 px-2.5 py-2">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm font-semibold text-orange-200" title={role}>
          {role || "Your assignment"}
        </span>
        {chip ? (
          <span className={cn("inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", chip.className)}>
            <Icon svg={chip.icon} size="xs" />
            {chip.label}
          </span>
        ) : (
          <span className="text-xs text-gray-400">
            {isPast ? "No response recorded" : "Needs your response"}
          </span>
        )}
      </div>
      {isSaving ? (
        <span role="status" className="text-xs text-gray-300">Saving response…</span>
      ) : showChoices ? (
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            type="button"
            variant="none"
            svg={Check}
            iconSize="sm"
            className="min-h-10 flex-1 justify-center rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-600 sm:flex-none"
            disabled={disabled}
            aria-label={`Accept ${role || "this assignment"}`}
            onClick={() => choose("accepted")}
          >
            Accept
          </Button>
          <Button
            type="button"
            variant="none"
            svg={X}
            iconSize="sm"
            className="min-h-10 flex-1 justify-center rounded-md bg-red-800 px-3 text-sm font-semibold text-white hover:bg-red-700 sm:flex-none"
            disabled={disabled}
            aria-label={`Decline ${role || "this assignment"}`}
            onClick={() => choose("declined")}
          >
            Decline
          </Button>
        </div>
      ) : answered && !isPast ? (
        <Button
          type="button"
          variant="textLink"
          className="shrink-0 text-xs text-gray-300 underline underline-offset-2 hover:text-white"
          disabled={disabled}
          aria-label={`Change your response for ${role || "this assignment"}`}
          onClick={() => setChanging(true)}
        >
          Change response
        </Button>
      ) : null}
    </div>
  );
};

const AvailabilityResponseRow = ({
  request,
  occurrenceId,
  disabled,
  isSaving,
  onRespond,
}: {
  request: TimelineAvailabilityRequest;
  occurrenceId: string;
  disabled: boolean;
  isSaving: boolean;
  onRespond: (request: TimelineAvailabilityRequest, response: "available" | "unavailable") => void;
}) => {
  const [changing, setChanging] = useState(false);
  const answered = Boolean(request.response);
  const showChoices = !answered || changing;
  const choose = (response: "available" | "unavailable") => {
    setChanging(false);
    onRespond(request, response);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-gray-950/45 px-2.5 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Availability requested</span>
        <span className="truncate text-xs text-gray-300" title={request.availabilityMessage || request.name}>
          {request.name}
        </span>
        {request.availabilityMessage ? (
          <span className="line-clamp-2 text-xs text-gray-400">{request.availabilityMessage}</span>
        ) : null}
        {request.response ? (
          <span className={cn(
            "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
            request.response === "available" ? "bg-emerald-500/10 text-emerald-200" : "bg-red-500/10 text-red-200",
          )}>
            <Icon svg={request.response === "available" ? Check : X} size="xs" />
            {request.response === "available" ? "Available" : "Unavailable"}
          </span>
        ) : null}
      </div>
      {isSaving ? (
        <span role="status" className="text-xs text-gray-300">Saving availability…</span>
      ) : showChoices ? (
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            type="button"
            variant="none"
            svg={Check}
            iconSize="sm"
            className="min-h-10 flex-1 justify-center rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-600 sm:flex-none"
            disabled={disabled}
            aria-label={`Mark availability as available for ${request.occurrence.name}`}
            onClick={() => choose("available")}
          >
            Available
          </Button>
          <Button
            type="button"
            variant="none"
            svg={X}
            iconSize="sm"
            className="min-h-10 flex-1 justify-center rounded-md bg-red-800 px-3 text-sm font-semibold text-white hover:bg-red-700 sm:flex-none"
            disabled={disabled}
            aria-label={`Mark availability as unavailable for ${request.occurrence.name}`}
            onClick={() => choose("unavailable")}
          >
            Unavailable
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="textLink"
          className="shrink-0 text-xs text-gray-300 underline underline-offset-2 hover:text-white"
          disabled={disabled}
          aria-label={`Change availability for ${request.name}`}
          onClick={() => setChanging(true)}
        >
          Change
        </Button>
      )}
      <span className="sr-only">Request for occurrence {occurrenceId}</span>
    </div>
  );
};

const ShareViewActions = ({
  label,
  url,
  onCopy,
  onView,
}: {
  label: string;
  url: string;
  onCopy: (url: string, label: string) => void;
  onView: (url: string) => void;
}) => (
  <div className="space-y-1.5">
    <p className="text-xs font-medium text-gray-300">{label}</p>
    <ButtonGroup className="w-full border-gray-500" display="flex">
      <ButtonGroupItem
        type="button"
        variant="primary"
        iconSize="sm"
        svg={Copy}
        color="#22d3ee"
        className="max-md:min-h-0"
        aria-label={`Copy ${label.toLowerCase()} link`}
        onClick={() => onCopy(url, label)}
      >
        Copy
      </ButtonGroupItem>
      <ButtonGroupItem
        type="button"
        variant="primary"
        iconSize="sm"
        svg={ExternalLink}
        color="#22d3ee"
        className="max-md:min-h-0"
        aria-label={`View ${label.toLowerCase()}`}
        onClick={() => onView(url)}
      >
        View
      </ButtonGroupItem>
    </ButtonGroup>
  </div>
);

type OccurrenceTileProps = {
  occurrence: MyScheduleTimelineOccurrence;
  timeZone: string;
  isNextUpcoming: boolean;
  isPast: boolean;
  /** True when this date falls inside one of the member's own blockouts. */
  isBlockedOut: boolean;
  onOpen: () => void;
  respondingKeys: Set<string>;
  acceptingPending: boolean;
  availabilityRespondingKeys: Set<string>;
  onRespond: (occurrenceId: string, slot: MyScheduleServing, response: "accepted" | "declined") => void;
  onAvailabilityRespond: (request: TimelineAvailabilityRequest, response: "available" | "unavailable") => void;
};

const OccurrenceTile = ({
  occurrence,
  timeZone,
  isNextUpcoming,
  isPast,
  isBlockedOut,
  onOpen,
  respondingKeys,
  acceptingPending,
  availabilityRespondingKeys,
  onRespond,
  onAvailabilityRespond,
}: OccurrenceTileProps) => {
  const tile = getOccurrenceTileParts(occurrence, timeZone);
  const serviceName = occurrenceServiceLabel(occurrence);
  const role = myRoleLabel(occurrence);
  const primaryAssignments = occurrence.serving.filter((person) => person.isMe && person.isPrimary);
  const hasPlan = plansForOccurrence(occurrence).length > 0;
  const openLabel = `Open ${serviceName} on ${tile.label}`;
  const isToday = !isNextUpcoming && isOccurrenceToday(occurrence, timeZone);
  const teams = [...new Set([
    ...occurrence.serving.filter((person) => person.isMe).map((person) => person.teamName),
    ...occurrence.availabilityRequests.flatMap((request) => request.teamNames),
  ].filter(Boolean))];

  let markerAriaSuffix = "";
  if (isNextUpcoming) {
    markerAriaSuffix = ", up next";
  } else if (isToday) {
    markerAriaSuffix = ", today";
  }

  let markerBorderClassName: string | false = false;
  if (isNextUpcoming) {
    markerBorderClassName = scheduleUpNextBorderClassName;
  } else if (isToday) {
    markerBorderClassName = scheduleTodayBorderClassName;
  }

  return (
    <li className="relative">
      <article className={cn(
        "relative overflow-hidden rounded-lg border bg-gray-800/75",
        hasPlan
          ? "border-emerald-500/30"
          : "border-gray-600/70",
        markerBorderClassName,
        isPast && "opacity-55",
      )}>
        <ScheduleOccurrenceRibbon
          isNextUpcoming={isNextUpcoming}
          isToday={isToday}
        />
        <Button
          type="button"
          variant="none"
          aria-label={cn(
            openLabel,
            markerAriaSuffix,
            isBlockedOut && ", blocked out",
          )}
          className="grid min-h-[104px] w-full grid-cols-[3.75rem_minmax(0,1fr)] items-start gap-3 rounded-none px-3 pb-3 pt-4 text-left hover:bg-white/[0.03] focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-orange-400"
          onClick={onOpen}
        >
          <time className="flex min-h-[76px] flex-col items-center justify-center rounded-md bg-gray-950/55 px-1.5 py-1 text-center">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{tile.weekday}</span>
            <span className="text-3xl font-bold leading-none text-gray-50">{tile.day}</span>
            <span className="text-[11px] text-gray-400">{tile.month}</span>
          </time>
          <span className="flex min-w-0 flex-col gap-1 pt-1">
            <span className="flex min-w-0 items-center gap-1.5">
              {hasPlan ? (
                <Icon svg={Check} size="xs" className="shrink-0 text-emerald-300" />
              ) : (
                <span className="size-1.5 shrink-0 rounded-full bg-orange-400/55" />
              )}
              <span className="truncate text-sm font-semibold text-gray-50" title={serviceName}>{serviceName}</span>
            </span>
            <span className="text-xs text-gray-400">
              {tile.time || "Time not set"}
            </span>
            {teams.length ? (
              <span className="truncate text-xs text-gray-300" title={teams.join(", ")}>
                {teams.join(", ")}
              </span>
            ) : null}
            {role && primaryAssignments.length === 0 ? (
              <span className="truncate text-sm font-semibold text-orange-200" title={role}>{role}</span>
            ) : null}
            {isBlockedOut ? (
              <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-300">
                <Icon svg={TriangleAlert} size="xs" className="shrink-0" />
                <span>Blocked out</span>
              </span>
            ) : null}
          </span>
        </Button>
        {primaryAssignments.length > 0 || occurrence.availabilityRequests.length > 0 ? (
          <div className="space-y-2 border-t border-gray-700/80 px-2.5 py-2.5">
            {primaryAssignments.length > 0 ? (
              <div className="space-y-1.5">
                {primaryAssignments.map((slot) => {
                  const key = `${slot.scheduleId}\u0000${occurrence.occurrenceId}\u0000${slot.columnKey}`;
                  return (
                    <AssignmentResponseRow
                      key={key}
                      slot={slot}
                      disabled={acceptingPending || respondingKeys.has(key)}
                      isPast={isPast}
                      isSaving={respondingKeys.has(key)}
                      onRespond={(selectedSlot, response) => onRespond(occurrence.occurrenceId, selectedSlot, response)}
                    />
                  );
                })}
              </div>
            ) : null}
            {occurrence.availabilityRequests.length > 0 ? (
              <div className="space-y-1.5">
                {occurrence.availabilityRequests.map((request) => {
                  const key = `${request.recipientId}\u0000${occurrence.occurrenceId}`;
                  return (
                    <AvailabilityResponseRow
                      key={`${request.formId}:${request.recipientId}`}
                      request={request}
                      occurrenceId={occurrence.occurrenceId}
                      disabled={availabilityRespondingKeys.has(key)}
                      isSaving={availabilityRespondingKeys.has(key)}
                      onRespond={onAvailabilityRespond}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </article>
    </li>
  );
};

type OccurrenceDetailProps = {
  occurrence: MyScheduleOccurrence;
  timeZone: string;
  scheduleOccurrences: MyScheduleOccurrence[];
  jumpOptions: { value: string; label: string }[];
  onJump: (occurrenceId: string) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onBack: () => void;
  onCopyLink: (url: string, label: string) => void;
  onViewLink: (url: string) => void;
  churchName?: string;
  /** Label of the member's own blockout covering this date, when there is one. */
  blockoutLabel?: string;
  /** Omitted for past services — there is nothing left to answer. */
  onRespond?: (
    slot: MyScheduleServing,
    response: "accepted" | "declined",
  ) => void;
  respondingKeys?: Set<string>;
  acceptingPending?: boolean;
};

const OccurrenceDetail = ({
  occurrence,
  timeZone,
  scheduleOccurrences,
  jumpOptions,
  onJump,
  onPrevious,
  onNext,
  onBack,
  onCopyLink,
  onViewLink,
  churchName = "",
  blockoutLabel = "",
  onRespond,
  respondingKeys = new Set<string>(),
  acceptingPending = false,
}: OccurrenceDetailProps) => {
  const [tab, setTab] = useState<DetailTab>("schedule");
  const [scheduleLayout, setScheduleLayout] =
    useState<ScheduleExportLayout>("byDate");
  const [planSelection, setPlanSelection] = useState<{
    occurrenceId: string;
    planId: string;
  } | null>(null);
  const serviceName = occurrenceServiceLabel(occurrence);
  const role = myRoleLabel(occurrence);
  const plans = plansForOccurrence(occurrence);
  const selectedPlanId = planSelection?.occurrenceId === occurrence.occurrenceId
    ? planSelection.planId
    : "";
  const plan = plans.find((candidate) => candidate.planId === selectedPlanId) || plans[0] || null;
  const teamUrl = plan?.publicUrls?.team;
  const generalUrl = plan?.publicUrls?.general || teamUrl;
  const canShare = Boolean(plan?.published && teamUrl);
  const scheduleModel = useMemo(
    () => buildMyScheduleExportModelForOccurrences(scheduleOccurrences, timeZone),
    [scheduleOccurrences, timeZone],
  );
  const planNameCounts = new Map<string, number>();
  plans.forEach((candidate) => {
    const name = candidate.name.trim() || "Service plan";
    planNameCounts.set(name, (planNameCounts.get(name) || 0) + 1);
  });
  const planOptions = plans.map((candidate, index) => {
    const name = candidate.name.trim() || `Service plan ${index + 1}`;
    return {
      value: candidate.planId,
      label: (planNameCounts.get(name) || 0) > 1 ? `${name} (${index + 1})` : name,
    };
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <nav
        className="shrink-0 rounded-xl border border-gray-700 bg-gray-950/70 p-3 lg:w-44 lg:p-4"
        aria-label="My schedule service view"
      >
        <div className="flex gap-1 lg:flex-col lg:gap-2" role="tablist">
          <Button
            type="button"
            variant="none"
            svg={CalendarDays}
            iconSize="sm"
            role="tab"
            aria-selected={tab === "schedule"}
            className={cn(
              "min-h-0 flex-1 justify-start rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition-colors lg:flex-none",
              tab === "schedule"
                ? "border-cyan-400/40 bg-cyan-500/15 text-white"
                : "border-transparent text-gray-200 hover:bg-gray-800 hover:text-white",
            )}
            onClick={() => setTab("schedule")}
          >
            Schedule
          </Button>
          <Button
            type="button"
            variant="none"
            svg={ClipboardList}
            iconSize="sm"
            role="tab"
            aria-selected={tab === "servicePlan"}
            className={cn(
              "min-h-0 flex-1 justify-start rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition-colors lg:flex-none",
              tab === "servicePlan"
                ? "border-cyan-400/40 bg-cyan-500/15 text-white"
                : "border-transparent text-gray-200 hover:bg-gray-800 hover:text-white",
            )}
            onClick={() => setTab("servicePlan")}
          >
            Service plan
          </Button>
        </div>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700/80 bg-gray-950/70">
        <header className="shrink-0 space-y-2 border-b border-gray-800 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="tertiary"
              svg={ArrowLeft}
              iconSize="sm"
              className="max-md:min-h-0"
              onClick={onBack}
            >
              Back
            </Button>
            <div
              className="flex shrink-0 items-center gap-1"
              role="group"
              aria-label="Service navigation"
            >
              <Button
                type="button"
                variant="secondary"
                svg={ChevronLeft}
                iconSize="sm"
                className="max-md:min-h-0"
                aria-label="Previous service"
                disabled={!onPrevious}
                onClick={onPrevious}
              />
              <Button
                type="button"
                variant="secondary"
                svg={ChevronRight}
                iconSize="sm"
                className="max-md:min-h-0"
                aria-label="Next service"
                disabled={!onNext}
                onClick={onNext}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold text-gray-50 sm:text-lg">
                {serviceName}
              </h2>
              <p className="mt-0.5 text-xs text-gray-400">
                {formatWhen(occurrence.startsAt, timeZone)}
              </p>
              {/* The role line is redundant once each slot renders its own row
                with the same label plus its answer. */}
              {role && !onRespond ? (
                <p className="mt-1 text-sm text-orange-300">{role}</p>
              ) : null}
              {/* Opening a tile must not drop the warning the tile carried. */}
              {blockoutLabel ? (
                <p className="mt-1 flex items-start gap-1.5 text-sm text-amber-300">
                  <Icon svg={TriangleAlert} size="sm" className="mt-0.5 shrink-0" />
                  <span>
                    You are scheduled here but marked yourself away{" "}
                    {blockoutLabel}. Your team lead sees this on the schedule.
                  </span>
                </p>
              ) : null}
            </div>
            {jumpOptions.length > 1 ? (
              <Select
                label="Jump to"
                className="w-full sm:w-56"
                value={occurrence.occurrenceId}
                options={jumpOptions}
                onChange={(value) => onJump(String(value))}
              />
            ) : null}
          </div>
          {onRespond ? (
            <div className="space-y-2">
              {occurrence.serving
                .filter((person) => person.isMe && person.isPrimary)
                .map((slot) => {
                  const key = `${slot.scheduleId}\u0000${occurrence.occurrenceId}\u0000${slot.columnKey}`;
                  return (
                    <AssignmentResponseRow
                      key={key}
                      slot={slot}
                      disabled={acceptingPending || respondingKeys.has(key)}
                      isSaving={respondingKeys.has(key)}
                      onRespond={onRespond}
                    />
                  );
                })}
            </div>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 sm:p-4">
          {tab === "schedule" ? (
            <>
              <div className="flex w-full flex-wrap items-end justify-end gap-2">
                <SchedulePdfExportButton
                  model={scheduleModel}
                  layout={scheduleLayout}
                />
              </div>
              <SegmentedControl
                ariaLabel="Schedule layout"
                variant="admin"
                value={scheduleLayout}
                onChange={setScheduleLayout}
                options={SCHEDULE_LAYOUT_OPTIONS}
                fullWidth
              />
              <ScheduleExportTable
                model={scheduleModel}
                theme="board-attendee"
                layout={scheduleLayout}
              />
            </>
          ) : (
            <>
              {plans.length > 1 ? (
                <Select
                  label="Service plan"
                  className="w-full sm:max-w-sm"
                  value={plan?.planId || ""}
                  options={planOptions}
                  onChange={(value) => setPlanSelection({
                    occurrenceId: occurrence.occurrenceId,
                    planId: value,
                  })}
                />
              ) : null}
              {canShare && teamUrl ? (
                <section className="rounded-lg border border-gray-700/80 bg-gray-900/50 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Public service plan
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <ShareViewActions
                        label="Detailed view"
                        url={teamUrl}
                        onCopy={onCopyLink}
                        onView={onViewLink}
                      />
                    </div>
                    {generalUrl ? (
                      <div className="min-w-0 flex-1">
                        <ShareViewActions
                          label="Simple view"
                          url={generalUrl}
                          onCopy={onCopyLink}
                          onView={onViewLink}
                        />
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}
              <MyScheduleServicePlanPanel
                occurrence={occurrence}
                plan={plan}
                churchName={churchName}
                timeZone={timeZone}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const MyScheduleView = ({ access }: { access?: PersonalScheduleAccess }) => {
  const context = useContext(GlobalInfoContext);
  const { showToast } = useToast();
  const churchId = access?.churchId || context?.churchId || "";
  const operations = useMemo<MyScheduleOperations>(() => access?.operations || ({
    load: () => getMyTeamAssignments(churchId),
    respond: (body) => respondToMyAssignment(churchId, body),
    saveBlockouts: (ranges, stamp) => updateMyBlockoutDates(churchId, ranges, stamp),
    acceptUnanswered: (cursor) => acceptPendingMyAssignments(churchId, cursor),
    availability: () => getMyVolunteerAvailability(churchId),
    submitAvailability: (recipientId, formId, occurrenceId, value) =>
      submitMyVolunteerAvailabilityOccurrence(churchId, recipientId, formId, occurrenceId, value),
  }), [access, churchId]);
  /** Changes the unlinked message: an admin can fix this themselves. */
  const isChurchAdmin = !access && context?.role === "admin";
  const [personalChurchName, setPersonalChurchName] = useState("");
  const churchName = access?.churchName || personalChurchName || context?.churchName || "";
  const [occurrences, setOccurrences] = useState<MyScheduleOccurrence[]>([]);
  const [availabilityRequests, setAvailabilityRequests] = useState<Awaited<ReturnType<MyScheduleOperations["availability"]>>["requests"]>([]);
  const [availabilityError, setAvailabilityError] = useState("");
  const [availabilityStatus, setAvailabilityStatus] = useState<"loading" | "ready" | "error">("loading");
  const [serviceTimeZone, setServiceTimeZone] = useState("UTC");
  const [hasMemberRecord, setHasMemberRecord] = useState(true);
  const [blockoutDates, setBlockoutDates] = useState<TeamBlockoutDateRange[]>(
    [],
  );
  /** Precondition for the blockout write; see `updateMyBlockoutDates`. */
  const [memberUpdatedAt, setMemberUpdatedAt] = useState("");
  const [savedDatesLoad, setSavedDatesLoad] = useState<SavedDatesLoadState>({ status: "pending" });
  const [showPast, setShowPast] = useState(false);
  const [organizeMode, setOrganizeMode] = useState<"byMonth" | "byService">("byMonth");
  const [query, setQuery] = useState("");
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const [serviceFilter, setServiceFilter] = useState(ALL_SERVICES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  const [scheduleError, setScheduleError] = useState("");

  const mountedRef = useRef(true);
  /** Drops a response that a newer request has already superseded. */
  const requestRef = useRef(0);
  /** A later targeted availability refresh must beat an earlier page load. */
  const availabilityRequestRef = useRef(0);
  /** Scope async UI work to the church active when it started. */
  const churchIdRef = useRef(churchId);
  churchIdRef.current = churchId;
  /** Bulk acceptance outlives ordinary assignment refreshes. */
  const acceptPendingOperationRef = useRef<{ churchId: string } | null>(null);
  /** Set by the Time off editor; a refresh must never discard an open edit. */
  const timeOffDirtyRef = useRef(false);
  const assignmentResponsesInFlightRef = useRef(new Set<string>());
  const availabilityResponsesInFlightRef = useRef(new Set<string>());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      acceptPendingOperationRef.current = null;
    };
  }, []);

  const load = useCallback(
    ({
      showLoading,
    }: {
      showLoading: boolean;
    }): Promise<MyScheduleMember | null> => {
      if (!churchId) return Promise.resolve(null);
      const request = ++requestRef.current;
      const availabilityRequest = ++availabilityRequestRef.current;
      setSavedDatesLoad({ status: "pending" });
      if (showLoading) setStatus("loading");
      return Promise.allSettled([operations.load(), operations.availability()])
        .then(([scheduleResult, availabilityResult]) => {
          if (!mountedRef.current || churchIdRef.current !== churchId || request !== requestRef.current) return null;

          let member: MyScheduleMember | null = null;
          let scheduleFailure: unknown = null;
          if (scheduleResult.status === "fulfilled" && scheduleResult.value.success && (showLoading || scheduleResult.value.member)) {
            const result = scheduleResult.value;
            member = result.member;
            setSavedDatesLoad({ status: "ready" });
            setScheduleError("");
            if (access) setPersonalChurchName(result.churchName || "");
            setOccurrences(result.occurrences || []);
            setServiceTimeZone(result.serviceTimeZone || "UTC");
            setHasMemberRecord(Boolean(result.member));
            // The editor retains its own draft/baseline. New saved props expose
            // conflicts without lending their revision to unsaved edits.
            setBlockoutDates(result.member?.blockoutDates || []);
            setMemberUpdatedAt(result.member?.updatedAt || "");
            setStatus("ready");
          } else {
            scheduleFailure = scheduleResult.status === "rejected"
              ? scheduleResult.reason
              : new Error("Could not refresh saved dates. Your draft is kept. Try again.");
            const failureStatus = getApiErrorStatus(scheduleFailure);
            const accessMessage = failureStatus === 401 || failureStatus === 403
              ? getApiErrorMessage(scheduleFailure, "Your access is no longer available. Ask an admin for help.")
              : undefined;
            const personalAccessMessage = access && accessMessage
              ? "Could not confirm personal access. Open your personal link again, or ask your church administrator for help."
              : accessMessage;
            setSavedDatesLoad({ status: "failed", accessMessage });
            setScheduleError(personalAccessMessage || (showLoading
              ? "Could not load your schedule. Try again."
              : "Could not refresh your schedule. Try again."));
            if (showLoading) setStatus("error");
          }

          if (availabilityRequest === availabilityRequestRef.current) {
            if (availabilityResult.status === "fulfilled" && availabilityResult.value.success) {
              setAvailabilityRequests(availabilityResult.value.requests || []);
              setAvailabilityStatus("ready");
              setAvailabilityError("");
            } else {
              setAvailabilityStatus("error");
              setAvailabilityError("Could not load your availability requests.");
            }
          }
          return member;
        });
    },
    [access, churchId, operations],
  );

  const refreshAvailability = useCallback(async () => {
    if (!churchId) return false;
    const request = ++availabilityRequestRef.current;
    const startedForChurch = churchId;
    try {
      const result = await operations.availability();
      if (!mountedRef.current || churchIdRef.current !== startedForChurch || request !== availabilityRequestRef.current) return false;
      if (!result.success) throw new Error("Availability was unavailable.");
      setAvailabilityRequests(result.requests || []);
      setAvailabilityStatus("ready");
      setAvailabilityError("");
      return true;
    } catch {
      if (mountedRef.current && churchIdRef.current === startedForChurch && request === availabilityRequestRef.current) {
        setAvailabilityStatus("error");
        setAvailabilityError("Could not refresh availability requests. Try again.");
      }
      return false;
    }
  }, [churchId, operations]);

  useEffect(() => {
    load({ showLoading: true });
  }, [load]);

  /**
   * Catch up on return rather than staying live. Nobody watches this page for
   * changes — they open it, read it, and leave — so the staleness that actually
   * bites is a PWA resumed days later, which this covers for the cost of one
   * request. Being told about a change is Phase 1/2 dispatch, not reactivity.
   */
  const refreshOnReturn = useCallback(() => {
    if (timeOffDirtyRef.current) return;
    load({ showLoading: false });
  }, [load]);

  useSyncOnReconnect(refreshOnReturn);

  const handleTimeOffDirtyChange = useCallback((dirty: boolean) => {
    timeOffDirtyRef.current = dirty;
  }, []);

  const handleBlockoutsSaved = useCallback((member: MyScheduleMember) => {
    if (churchIdRef.current !== churchId) return;
    // A load started before this commit may still contain the old dates/stamp.
    ++requestRef.current;
    setSavedDatesLoad({ status: "ready" });
    setBlockoutDates(member?.blockoutDates || []);
    setMemberUpdatedAt(member?.updatedAt || "");
  }, [churchId]);

  /**
   * The save was rejected because the record moved. Pull the current state in
   * so the reader compares against what is stored — the editor keeps their
   * draft and its original precondition until they explicitly resolve it.
   */
  const refreshAfterConflict = useCallback(() => {
    return load({ showLoading: false }).then(Boolean);
  }, [load]);

  const [respondingKeys, setRespondingKeys] = useState<Set<string>>(new Set());
  const [availabilityRespondingKeys, setAvailabilityRespondingKeys] = useState<Set<string>>(new Set());
  const [acceptingPending, setAcceptingPending] = useState(false);
  const [acceptPendingFeedback, setAcceptPendingFeedback] = useState("");

  useEffect(() => {
    const operation = acceptPendingOperationRef.current;
    if (operation && operation.churchId !== churchId) {
      acceptPendingOperationRef.current = null;
      setAcceptingPending(false);
      setAcceptPendingFeedback("");
    }
  }, [churchId]);

  const pendingAssignmentCount = useMemo(() => {
    const now = Date.now();
    const seen = new Set<string>();
    return occurrences.reduce((count, occurrence) => {
      const startsAt = Date.parse(occurrence.startsAt);
      if (!Number.isFinite(startsAt) || startsAt < now) return count;
      return count + occurrence.serving.reduce((pending, person) => {
        if (!person.isMe || !person.isPrimary ||
            (person.response && person.response !== "pending")) return pending;
        const key = `${person.scheduleId}\u0000${occurrence.occurrenceId}\u0000${person.columnKey}`;
        if (seen.has(key)) return pending;
        seen.add(key);
        return pending + 1;
      }, 0);
    }, 0);
  }, [occurrences]);

  const acceptAllPending = useCallback(async () => {
    if (
      !churchId ||
      acceptPendingOperationRef.current?.churchId === churchId
    ) return;
    const operation = { churchId };
    acceptPendingOperationRef.current = operation;
    setAcceptingPending(true);
    setAcceptPendingFeedback("");

    const isCurrentOperation = () =>
      mountedRef.current &&
      churchIdRef.current === operation.churchId &&
      acceptPendingOperationRef.current === operation;
    const totals = {
      newlyAccepted: 0,
      alreadyAccepted: 0,
      alreadyDeclined: 0,
      skipped: 0,
      failedScheduleCount: 0,
    };
    let cursor: string | undefined;
    let authorizationChanged = false;
    let requestFailed = false;
    const visitedCursors = new Set<string>();

    try {
      while (isCurrentOperation()) {
        const page = await operations.acceptUnanswered(cursor);
        if (!isCurrentOperation()) return;
        totals.newlyAccepted += page.newlyAccepted;
        totals.alreadyAccepted += page.alreadyAccepted;
        totals.alreadyDeclined += page.alreadyDeclined;
        totals.skipped += page.skipped;
        totals.failedScheduleCount += page.failedScheduleCount;
        authorizationChanged ||= page.authorizationChanged;
        if (!page.hasMore || !page.nextCursor || page.authorizationChanged) break;
        if (visitedCursors.has(page.nextCursor)) {
          requestFailed = true;
          break;
        }
        visitedCursors.add(page.nextCursor);
        cursor = page.nextCursor;
      }
    } catch {
      requestFailed = true;
    }

    if (!isCurrentOperation()) return;

    const changedCount = totals.newlyAccepted;
    const countLabel = `${changedCount} ${changedCount === 1 ? "assignment" : "assignments"}`;
    const hasPartialResults = authorizationChanged || requestFailed ||
      totals.skipped > 0 || totals.failedScheduleCount > 0;
    const unchangedParts = [
      totals.alreadyAccepted > 0
        ? `${totals.alreadyAccepted} already accepted`
        : "",
      totals.alreadyDeclined > 0
        ? `${totals.alreadyDeclined} declined and left unchanged`
        : "",
    ].filter(Boolean);
    const unchangedSummary = unchangedParts.length
      ? ` ${unchangedParts.join("; ")}.`
      : "";

    let feedback = "";
    if (requestFailed) {
      feedback = changedCount > 0
        ? `Accepted ${countLabel}.${unchangedSummary} Could not confirm the remaining assignments. Refresh and try again.`
        : `Could not confirm your responses.${unchangedSummary} Refresh and try again.`;
    } else if (authorizationChanged) {
      const accessChanged = access ? "Your personal access changed." : "Your account access changed.";
      feedback = changedCount > 0
        ? `Accepted ${countLabel}.${unchangedSummary} ${accessChanged} Reload My Schedule before retrying.`
        : `${accessChanged}${unchangedSummary} Reload My Schedule before retrying.`;
    } else if (hasPartialResults) {
      const skippedLabel = totals.skipped > 0
        ? ` ${totals.skipped} assignment${totals.skipped === 1 ? " was" : "s were"} no longer eligible.`
        : "";
      const acceptedSummary = changedCount > 0 ? `Accepted ${countLabel}.` : "";
      feedback = `${acceptedSummary}${skippedLabel}${unchangedSummary} Some assignments couldn't be processed. Retry to finish the rest.`.trim();
    } else if (changedCount === 0 && unchangedParts.length === 0) {
      feedback = "No unanswered assignments remained. Existing responses were unchanged.";
    } else {
      const accepted = changedCount > 0 ? `Accepted ${countLabel}.` : "No unanswered assignments remained.";
      feedback = [accepted, unchangedParts.length ? `${unchangedParts.join("; ")}.` : ""].filter(Boolean).join(" ");
    }
    setAcceptPendingFeedback(feedback);
    await load({
      showLoading: false,
    });
    if (isCurrentOperation()) {
      acceptPendingOperationRef.current = null;
      setAcceptingPending(false);
    }
  }, [access, churchId, load, operations]);

  /**
   * Answer one assignment, applied optimistically so the tap feels immediate.
   *
   * A successful response echoes the value committed by the server. On failure
   * the page refetches instead of reverting locally because a 409 often means
   * the slot moved and the previous value is no longer authoritative.
   */
  const respondToAssignment = useCallback(
    async (occurrenceId: string, slot: MyScheduleServing, response: "accepted" | "declined") => {
      const key = `${slot.scheduleId}\u0000${occurrenceId}\u0000${slot.columnKey}`;
      if (assignmentResponsesInFlightRef.current.has(key)) return;
      assignmentResponsesInFlightRef.current.add(key);
      setRespondingKeys((current) => new Set(current).add(key));
      const apply = (value: MyScheduleServing["response"]) =>
        setOccurrences((current) =>
          current.map((occurrence) =>
            occurrence.occurrenceId === occurrenceId
              ? {
                ...occurrence,
                serving: occurrence.serving.map((person) =>
                  person.isMe && person.isPrimary && person.scheduleId === slot.scheduleId && person.columnKey === slot.columnKey
                    ? { ...person, response: value }
                    : person,
                ),
              }
              : occurrence,
          ),
        );
      apply(response);
      try {
        const saved = await operations.respond({
          scheduleId: slot.scheduleId,
          occurrenceId,
          cellKey: slot.columnKey,
          response,
        });
        if (saved?.response === "accepted" || saved?.response === "declined") apply(saved.response);
      } catch (error) {
        if (!mountedRef.current) return;
        showApiErrorToast(showToast, error, "Could not save your response.");
        load({ showLoading: false });
      } finally {
        assignmentResponsesInFlightRef.current.delete(key);
        if (mountedRef.current) setRespondingKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [load, operations, showToast],
  );

  const respondToAvailability = useCallback(async (
    request: TimelineAvailabilityRequest,
    response: "available" | "unavailable",
  ) => {
    const occurrenceId = request.occurrence.occurrenceId;
    const key = `${request.recipientId}\u0000${occurrenceId}`;
    if (availabilityResponsesInFlightRef.current.has(key)) return;
    availabilityResponsesInFlightRef.current.add(key);
    setAvailabilityRespondingKeys((current) => new Set(current).add(key));
    try {
      await operations.submitAvailability(request.recipientId, request.formId, occurrenceId, response);
      if (mountedRef.current && churchIdRef.current === churchId) {
        showToast("Availability saved.", "success");
      }
    } catch (error) {
      if (mountedRef.current) showApiErrorToast(showToast, error, "Could not save your availability.");
    } finally {
      if (mountedRef.current) {
        // Keep the row busy until the follow-up read resolves. This also
        // restores the stored answer after an uncertain write without showing
        // an optimistic value that the server may not have committed.
        await refreshAvailability();
      }
      availabilityResponsesInFlightRef.current.delete(key);
      if (mountedRef.current) {
        setAvailabilityRespondingKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    }
  }, [churchId, operations, refreshAvailability, showToast]);

  const timelineOccurrences = useMemo(
    () => buildMyScheduleTimeline(occurrences, availabilityRequests, serviceTimeZone),
    [availabilityRequests, occurrences, serviceTimeZone],
  );
  const datedOccurrences = useMemo(
    () => timelineOccurrences.filter(hasDatedStartsAt),
    [timelineOccurrences],
  );

  /**
   * Services this person is on that fall inside one of their own blockouts,
   * keyed by occurrence so the tiles and the detail view read from one lookup.
   *
   * Without this the page contradicts itself: the schedule shows you serving,
   * Time off says you are away, and nothing connects the two unless the reader
   * expands a collapsed section. The label matches the owner's schedule grid so
   * both sides describe the clash the same way.
   */
  const blockoutLabelByOccurrence = useMemo(() => {
    const labels = new Map<string, string>();
    if (blockoutDates.length === 0) return labels;
    timelineOccurrences.forEach((occurrence) => {
      const date = myScheduleOccurrenceDate(occurrence, serviceTimeZone);
      const range = findBlockoutRangeForDate(blockoutDates, date);
      if (range) {
        labels.set(occurrence.occurrenceId, formatBlockoutDateRangeLabel(range));
      }
    });
    return labels;
  }, [blockoutDates, serviceTimeZone, timelineOccurrences]);

  /** Team choices cover both assigned services and availability requests. */
  const teamOptions = useMemo(() => {
    const names = new Map<string, string>();
    datedOccurrences.forEach((occurrence) =>
      occurrence.serving
        .filter((person) => person.isMe && person.teamId)
        .forEach((person) => names.set(person.teamId, person.teamName)),
    );
    datedOccurrences.forEach((occurrence) => occurrence.availabilityRequests.forEach((request) => {
      request.teamIds.forEach((teamId, index) => names.set(teamId, request.teamNames[index] || "Team"));
    }));
    return [
      { value: ALL_TEAMS, label: "All teams" },
      ...[...names.entries()].map(([value, label]) => ({
        value,
        label: label || "Team",
      })),
    ];
  }, [datedOccurrences]);

  /** Service options follow each occurrence's saved service identities. */
  const serviceOptions = useMemo(() => {
    const names = new Map<string, string>();
    datedOccurrences.forEach((occurrence) => {
      const label = occurrenceServiceLabel(occurrence);
      const key = myScheduleServiceGroupKey(occurrence);
      if (!names.has(key)) names.set(key, label);
    });
    return [
      { value: ALL_SERVICES, label: "All services" },
      ...[...names.entries()].map(([value, label]) => ({ value, label })),
    ];
  }, [datedOccurrences]);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return datedOccurrences.filter((occurrence) => {
      if (
        teamFilter !== ALL_TEAMS &&
        !occurrence.serving.some((person) => person.isMe && person.teamId === teamFilter) &&
        !occurrence.availabilityRequests.some((request) => request.teamIds.includes(teamFilter))
      ) {
        return false;
      }
      if (serviceFilter !== ALL_SERVICES) {
        const key = myScheduleServiceGroupKey(occurrence);
        if (key !== serviceFilter) return false;
      }
      if (!trimmed) return true;
      // Searches everything on the card — a name, a position, a song title, or
      // the date as shown — because any of those is how someone would look for
      // a service they half-remember.
      const haystack = [
        formatWhen(occurrence.startsAt, serviceTimeZone),
        occurrenceServiceLabel(occurrence),
        ...occurrence.serving.flatMap((person) => [
          person.name,
          person.positionName,
          person.teamName,
        ]),
        ...occurrence.availabilityRequests.flatMap((request) => [
          request.name,
          request.availabilityMessage,
          ...request.teamNames,
        ]),
        ...plansForOccurrence(occurrence).flatMap((plan) => [
          plan.name,
          ...(plan.sections || []).flatMap((section) =>
            section.elements.map((element) => element.title),
          ),
        ]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [datedOccurrences, query, serviceFilter, serviceTimeZone, teamFilter]);

  /**
   * Past services are kept but pushed behind a toggle. A schedule that opens on
   * something months gone buries the next commitment, which is what most people
   * came to see.
   */
  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const isPast = (occurrence: MyScheduleTimelineOccurrence) =>
      Date.parse(occurrence.startsAt) < now;
    return {
      upcoming: filtered.filter((item) => !isPast(item)),
      past: filtered.filter(isPast).reverse(),
    };
  }, [filtered]);

  const upcomingMonthGroups = useMemo(
    () => groupMyScheduleByMonth(upcoming, serviceTimeZone),
    [serviceTimeZone, upcoming],
  );
  const pastMonthGroups = useMemo(
    () => groupMyScheduleByMonth(past, serviceTimeZone),
    [past, serviceTimeZone],
  );
  const upcomingServiceGroups = useMemo(() => groupMyScheduleByService(upcoming), [upcoming]);
  const pastServiceGroups = useMemo(() => groupMyScheduleByService(past), [past]);

  const navigable = useMemo(
    () => [...upcoming, ...(showPast ? past : [])],
    [upcoming, past, showPast],
  );

  const selected = useMemo(
    () =>
      selectedId
        ? datedOccurrences.find((item) => item.occurrenceId === selectedId) ||
        null
        : null,
    [datedOccurrences, selectedId],
  );

  const selectedNavIndex = useMemo(() => {
    if (!selected) return -1;
    return navigable.findIndex(
      (item) => item.occurrenceId === selected.occurrenceId,
    );
  }, [navigable, selected]);

  const jumpOptions = useMemo(
    () =>
      navigable.map((occurrence) => ({
        value: occurrence.occurrenceId,
        label: `${occurrenceServiceLabel(occurrence)} · ${formatWhen(occurrence.startsAt, serviceTimeZone)}`,
      })),
    [navigable, serviceTimeZone],
  );

  const nextUpcomingId = upcoming[0]?.occurrenceId ?? null;
  const hasFilters =
    query.trim().length > 0 ||
    teamFilter !== ALL_TEAMS ||
    serviceFilter !== ALL_SERVICES;

  const unlinkedMessage = access
    ? "Your volunteer record is no longer available. Open your personal link again, or contact your church administrator."
    : "Your account is not linked to anyone on a team yet. Ask an admin to link you.";

  const copyLink = async (url: string, label: string) => {
    try {
      await navigator.clipboard?.writeText(url);
      showToast(`${label} link copied.`, "success");
    } catch {
      showToast(`${label} link is ready. Copy it again if needed.`, "success");
    }
  };

  const viewLink = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const canShowTimeline = (status === "ready" && hasMemberRecord) || availabilityRequests.length > 0;
  const canShowSelfService = status === "ready" && hasMemberRecord;
  const renderTiles = (items: MyScheduleTimelineOccurrence[], isPast: boolean) => (
    <ul
      className="grid gap-2.5"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 22rem), min(100%, 23.75rem)))" }}
    >
      {items.map((occurrence) => (
        <OccurrenceTile
          key={occurrence.occurrenceId}
          occurrence={occurrence}
          timeZone={serviceTimeZone}
          isNextUpcoming={!isPast && occurrence.occurrenceId === nextUpcomingId}
          isPast={isPast}
          isBlockedOut={blockoutLabelByOccurrence.has(occurrence.occurrenceId)}
          respondingKeys={respondingKeys}
          acceptingPending={acceptingPending}
          availabilityRespondingKeys={availabilityRespondingKeys}
          onRespond={respondToAssignment}
          onAvailabilityRespond={respondToAvailability}
          onOpen={() => setSelectedId(occurrence.occurrenceId)}
        />
      ))}
    </ul>
  );

  return (
    <AppPageShell
      title="My schedule"
      {...PAGE_APPEARANCES.mySchedule}
      showAccountNavigation={!access}
    >
      <div className="flex w-full flex-col gap-4">
        {status === "loading" ? (
          <p className="text-sm text-gray-300">Loading your schedule…</p>
        ) : null}

        {scheduleError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-400">
            <p>{scheduleError}</p>
            <Button variant="secondary" disabled={savedDatesLoad.status === "pending"}
              isLoading={savedDatesLoad.status === "pending"}
              onClick={() => void load({ showLoading: status === "error" })}>Retry My Schedule</Button>
          </div>
        ) : null}

        {status === "ready" && !hasMemberRecord ? (
          // Normal for anyone not on a team. The next step differs by who is
          // reading: "ask an admin" is useless advice when you are the admin,
          // and linking is something they can do themselves.
          <p className="text-sm text-gray-300">
            {isChurchAdmin
              ? "You are not on any team's roster yet. Link your account to a member in Teams → Members."
              : unlinkedMessage}
          </p>
        ) : null}

        {canShowTimeline && selected ? (
          <OccurrenceDetail
            occurrence={selected}
            timeZone={serviceTimeZone}
            scheduleOccurrences={navigable}
            jumpOptions={jumpOptions}
            onJump={setSelectedId}
            onPrevious={
              selectedNavIndex > 0
                ? () => setSelectedId(navigable[selectedNavIndex - 1].occurrenceId)
                : undefined
            }
            onNext={
              selectedNavIndex >= 0 && selectedNavIndex < navigable.length - 1
                ? () => setSelectedId(navigable[selectedNavIndex + 1].occurrenceId)
                : undefined
            }
            onBack={() => setSelectedId(null)}
            onCopyLink={copyLink}
            onViewLink={viewLink}
            churchName={churchName}
            blockoutLabel={
              blockoutLabelByOccurrence.get(selected.occurrenceId) || ""
            }
            // Past services have nothing left to answer, and offering the
            // buttons there would invite pointless writes.
            onRespond={past.some((item) => item.occurrenceId === selected.occurrenceId)
              ? undefined
              : (slot, response) => respondToAssignment(selected.occurrenceId, slot, response)}
            respondingKeys={respondingKeys}
            acceptingPending={acceptingPending}
          />
        ) : null}

        {canShowTimeline && !selected ? (
          <>
            {canShowSelfService ? (
              <>
                {access ? <a className="text-sm text-orange-300 underline" href={`/sms-opt-in/${encodeURIComponent(churchId)}`}>SMS preferences</a> : null}
                <MyScheduleBlockouts
                  key={churchId}
                  churchId={churchId}
                  serviceTimeZone={serviceTimeZone}
                  blockoutDates={blockoutDates}
                  expectedUpdatedAt={memberUpdatedAt}
                  occurrences={occurrences}
                  onSaved={handleBlockoutsSaved}
                  saveBlockouts={operations.saveBlockouts}
                  onDirtyChange={handleTimeOffDirtyChange}
                  onStale={refreshAfterConflict}
                  savedDatesLoad={savedDatesLoad}
                />
              </>
            ) : null}

            {datedOccurrences.length > 0 ? (
              <div className="grid items-end gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_repeat(3,minmax(9rem,13rem))]">
                <Input
                  label="Search"
                  className="min-w-0"
                  value={query}
                  placeholder="Song, position, person, or date"
                  onChange={(value) => setQuery(String(value))}
                />
                <Select
                  label="Organize"
                  value={organizeMode}
                  options={[{ value: "byMonth", label: "By month" }, { value: "byService", label: "By service" }]}
                  onChange={(value) => setOrganizeMode(value === "byService" ? "byService" : "byMonth")}
                />
                {serviceOptions.length > 2 ? (
                  <Select
                    label="Service"
                    value={serviceFilter}
                    options={serviceOptions}
                    onChange={(value) => setServiceFilter(String(value))}
                  />
                ) : null}
                {teamOptions.length > 2 ? (
                  <Select
                    label="Team"
                    value={teamFilter}
                    options={teamOptions}
                    onChange={(value) => setTeamFilter(String(value))}
                  />
                ) : null}
              </div>
            ) : null}

            {canShowSelfService && pendingAssignmentCount > 0 ? (
              <section className="flex flex-col gap-2 rounded-md border border-gray-700 bg-gray-900/45 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">
                    You have {pendingAssignmentCount} {pendingAssignmentCount === 1 ? "assignment" : "assignments"} waiting for a response.
                  </h2>
                  <p className="text-xs text-gray-300">
                    Accepts only assignments you haven&apos;t answered yet. You can change individual responses later.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="none"
                  className="w-full shrink-0 justify-center rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-600 sm:w-auto"
                  disabled={acceptingPending}
                  isLoading={acceptingPending}
                  aria-busy={acceptingPending}
                  onClick={() => void acceptAllPending()}
                >
                  {acceptingPending ? "Accepting…" : "Accept remaining assignments"}
                </Button>
              </section>
            ) : null}
            {acceptingPending ? (
              <span className="sr-only" role="status" aria-live="polite">Accepting your pending assignments…</span>
            ) : null}
            {acceptPendingFeedback ? (
              <p className="text-sm text-gray-300" role="status" aria-live="polite">{acceptPendingFeedback}</p>
            ) : null}
            {availabilityError ? (
              <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-300">
                <p>{availabilityError}</p>
                <Button variant="secondary" disabled={availabilityStatus === "loading"}
                  isLoading={availabilityStatus === "loading"} onClick={() => void refreshAvailability()}>
                  Retry availability
                </Button>
              </div>
            ) : null}

            {upcoming.length === 0 && past.length === 0 ? (
              <p className="text-sm text-gray-300">
                {availabilityError
                  ? "Your availability requests could not be confirmed. Retry availability to check again."
                  : hasFilters
                  ? "Nothing matches that search."
                  : "You are not scheduled for anything coming up."}
              </p>
            ) : null}

            {upcoming.length === 0 && past.length > 0 ? (
              <p className="text-sm text-gray-300">
                {hasFilters
                  ? "Nothing upcoming matches that search."
                  : "You are not scheduled for anything coming up."}
              </p>
            ) : null}

            {upcoming.length > 0 ? (
              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Upcoming
                </h2>
                {organizeMode === "byMonth" ? upcomingMonthGroups.map((month) => (
                  <section key={month.key} className="mb-4 space-y-2">
                    <h3 className="text-sm font-semibold text-gray-200">{month.label}</h3>
                    {renderTiles(month.occurrences, false)}
                  </section>
                )) : upcomingServiceGroups.map((group) => (
                  <section key={group.key} className="mb-4 space-y-2">
                    <h3 className="text-sm font-semibold text-gray-200">{group.name}</h3>
                    {renderTiles(group.occurrences, false)}
                  </section>
                ))}
              </section>
            ) : null}

            {past.length > 0 ? (
              <div>
                <Button
                  type="button"
                  variant="tertiary"
                  className="h-auto min-h-0 px-0 py-0 text-sm text-gray-400 underline underline-offset-2 hover:text-gray-200"
                  onClick={() => setShowPast((current) => !current)}
                >
                  {showPast
                    ? "Hide past services"
                    : `Show ${past.length} past ${past.length === 1 ? "service" : "services"}`}
                </Button>
                {showPast ? (
                  <div className="mt-3 space-y-4">
                    {organizeMode === "byMonth" ? pastMonthGroups.map((month) => (
                      <section key={month.key} className="space-y-2">
                        <h3 className="text-sm font-semibold text-gray-300">{month.label}</h3>
                        {renderTiles(month.occurrences, true)}
                      </section>
                    )) : pastServiceGroups.map((group) => (
                      <section key={group.key} className="space-y-2">
                        <h3 className="text-sm font-semibold text-gray-300">{group.name}</h3>
                        {renderTiles(group.occurrences, true)}
                      </section>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </AppPageShell>
  );
};

const MySchedule = ({ access }: { access?: PersonalScheduleAccess }) => {
  const context = useContext(GlobalInfoContext);
  const identity = access ? `personal:${access.churchId}:${access.memberId}` : `human:${context?.churchId || ""}:${context?.userId || ""}`;
  return <MyScheduleView key={identity} access={access} />;
};

export default MySchedule;
