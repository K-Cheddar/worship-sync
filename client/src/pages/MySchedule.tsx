import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
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
import ServiceOccurrenceCard, {
  getServiceOccurrenceCardDateParts,
  SERVICE_OCCURRENCE_GRID_CLASS_NAME,
} from "../components/ServiceOccurrenceCard/ServiceOccurrenceCard";
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
  groupMyScheduleByMonth,
  groupMyScheduleByService,
  myScheduleOccurrenceDate,
  myScheduleServiceGroupKey,
} from "./myScheduleTimeline";
import MyScheduleServicePlanPanel from "./MyScheduleServicePlanPanel";
import {
  findBlockoutRangeForDate,
  formatBlockoutDateRangeLabel,
} from "./Teams/teamsUtils";
import ScheduleExportTable from "./Teams/schedule/ScheduleExportTable";
import SchedulePdfExportButton from "./Teams/schedule/SchedulePdfExportButton";
import type { ScheduleExportLayout } from "./Teams/schedule/scheduleExportPdf";
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
 * Volunteers can change their own time off and assignment responses through
 * self-scoped writes. Emailed assignment response links use the same endpoint.
 */

const ALL_TEAMS = "__all_teams__";
const ALL_SERVICES = "__all_services__";
const MY_SCHEDULE_ORGANIZE_OPTIONS = [
  { value: "byMonth" as const, label: "By month" },
  { value: "byService" as const, label: "By service" },
];

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

const occurrenceServiceLabel = (occurrence: MyScheduleOccurrence): string => {
  const name = String(occurrence.name || "").trim();
  if (name) return name;
  return "Service";
};

const LoadingPlaceholder = ({ className }: { className: string }) => (
  <span
    aria-hidden="true"
    className={cn("block animate-pulse rounded bg-gray-700/70", className)}
  />
);

const MyScheduleLoadingSkeleton = ({ showSmsPreferences }: { showSmsPreferences: boolean }) => (
  <div
    role="status"
    aria-label="Loading your schedule"
    aria-busy="true"
    className="flex w-full flex-col gap-4"
  >
    {showSmsPreferences ? (
      <div aria-hidden="true" className="h-5">
        <LoadingPlaceholder className="h-4 w-28 rounded-sm" />
      </div>
    ) : null}

    <section aria-hidden="true" className="rounded-xl border border-gray-700/80 bg-gray-900/40">
      <div className="flex min-h-10 items-center justify-between gap-3 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <LoadingPlaceholder className="size-4 shrink-0" />
          <LoadingPlaceholder className="h-4 w-16" />
          <LoadingPlaceholder className="h-3 w-20" />
        </div>
        <LoadingPlaceholder className="size-4 shrink-0" />
      </div>
    </section>

    <div
      aria-hidden="true"
      className="grid items-end gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_repeat(3,minmax(9rem,13rem))]"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex min-w-0 flex-col gap-1.5">
          <LoadingPlaceholder className="h-3 w-14" />
          <LoadingPlaceholder className="h-10 w-full rounded-md border border-gray-700 bg-gray-900/60" />
        </div>
      ))}
    </div>

    <section
      aria-hidden="true"
      className="flex flex-col gap-2 rounded-md border border-gray-700 bg-gray-900/45 p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <LoadingPlaceholder className="h-4 w-56 max-w-full" />
        <LoadingPlaceholder className="h-3 w-72 max-w-full" />
      </div>
      <LoadingPlaceholder className="h-9 w-full rounded-md sm:w-52" />
    </section>

    <section aria-hidden="true">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Upcoming</h2>
      <section className="mb-4 space-y-2">
        <LoadingPlaceholder className="h-4 w-24" />
        <ul className={cn(SERVICE_OCCURRENCE_GRID_CLASS_NAME, "pt-3")}>
          {Array.from({ length: 3 }, (_, index) => (
            <li key={index} className="relative min-w-0">
              <article data-testid="my-schedule-loading-card" className="overflow-hidden rounded-lg border border-gray-600/70 bg-gray-800/70">
                <div className="flex min-h-[56px] items-center gap-2 px-2.5 py-2">
                  <div className="relative flex w-[44px] shrink-0 flex-col items-center justify-center gap-px">
                    <LoadingPlaceholder className="h-2.5 w-6" />
                    <LoadingPlaceholder className="h-5 w-5" />
                    <LoadingPlaceholder className="h-2.5 w-8" />
                    <span aria-hidden="true" className="absolute inset-y-0 right-0 w-px bg-gray-700/80" />
                  </div>
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <LoadingPlaceholder className="h-3.5 w-2/3 max-w-48" />
                      <LoadingPlaceholder className="h-3 w-12" />
                    </div>
                    <LoadingPlaceholder className="size-2 shrink-0 rounded-full" />
                  </div>
                </div>
                <div className="border-t border-gray-700/80 px-2.5 py-2 sm:px-3">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <div className="flex min-w-0 flex-col">
                      <LoadingPlaceholder className="h-2.5 w-12" />
                      <div className="flex min-w-0 items-center gap-1.5">
                        <LoadingPlaceholder className="h-3.5 w-24" />
                        <LoadingPlaceholder className="h-3 w-14 shrink-0 rounded-full" />
                      </div>
                    </div>
                    <div className="ml-auto flex shrink-0 gap-1.5">
                      <LoadingPlaceholder className="h-9 w-16 rounded-md" />
                      <LoadingPlaceholder className="h-9 w-16 rounded-md" />
                    </div>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ul>
      </section>
    </section>
  </div>
);

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
    className: "bg-red-700 text-white",
    icon: X,
  },
};

type AssignmentResponseAttempt = {
  response: "accepted" | "declined";
  status: "saving" | "checking" | "unverified";
};

type MyScheduleLoadResult =
  | { status: "applied"; member: MyScheduleMember | null; occurrences: MyScheduleOccurrence[] }
  | { status: "failed" | "stale" };

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
  responseAttempt,
  onRespond,
  onRetryResponse,
}: {
  slot: MyScheduleServing;
  disabled: boolean;
  isPast?: boolean;
  responseAttempt?: AssignmentResponseAttempt;
  onRespond?: (
    slot: MyScheduleServing,
    response: "accepted" | "declined",
  ) => Promise<boolean>;
  onRetryResponse?: () => Promise<boolean>;
}) => {
  const response: AssignmentResponse = slot.response || "pending";
  const answered = response !== "pending";
  const chip = answered ? RESPONSE_CHIP[response] : null;
  const role = [slot.positionName, slot.teamName].filter(Boolean).join(" · ");
  const [changing, setChanging] = useState(false);
  const showChoices = Boolean(onRespond) && slot.isPrimary && ((!answered && !isPast) || changing);
  const attemptedVerb = responseAttempt?.response === "accepted" ? "accept" : "decline";

  let answerStatus: ReactNode = null;
  if (slot.isPrimary && chip) {
    answerStatus = (
      <span className={cn("inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", chip.className)}>
        <Icon svg={chip.icon} size="xs" />
        {chip.label}
      </span>
    );
  } else if (slot.isPrimary && isPast) {
    answerStatus = <span className="shrink-0 text-[11px] text-gray-400">No response recorded</span>;
  } else if (!slot.isPrimary) {
    answerStatus = <span className="shrink-0 text-[11px] text-gray-400">Shadow assignment</span>;
  }

  const choose = async (next: "accepted" | "declined") => {
    if (!onRespond) return;
    setChanging(true);
    if (await onRespond(slot, next)) setChanging(false);
  };

  return (
    <div className="min-w-0">
      {slot.teamName ? (
        <span
          className="block truncate text-[10px] font-medium leading-tight text-gray-400"
          title={slot.teamName}
        >
          {slot.teamName}
        </span>
      ) : null}
      <span
        className="block min-w-0 whitespace-normal break-words text-[13px] font-medium leading-snug text-gray-100 sm:text-sm"
        title={slot.positionName || role}
      >
        {slot.positionName || "Your assignment"}
      </span>

      <div className="mt-0.5 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
        {answerStatus}
        {responseAttempt?.status === "saving" ? (
          <span role="status" className="ml-auto shrink-0 text-xs text-gray-300">Saving…</span>
        ) : responseAttempt?.status === "checking" ? (
          <span role="status" className="ml-auto shrink-0 text-xs text-gray-300">Checking saved response…</span>
        ) : showChoices ? (
          <div className="ml-auto flex shrink-0 gap-1.5">
            <Button
              type="button"
              variant="none"
              svg={Check}
              iconSize="sm"
              className="min-h-[44px] max-md:min-h-[44px] justify-center rounded-md bg-emerald-700 px-2.5 text-xs font-semibold text-white hover:bg-emerald-600 sm:min-h-[36px]"
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
              className="min-h-[44px] max-md:min-h-[44px] justify-center rounded-md bg-red-700 px-2.5 text-xs font-semibold text-white hover:bg-red-600 sm:min-h-[36px]"
              disabled={disabled}
              aria-label={`Decline ${role || "this assignment"}`}
              onClick={() => choose("declined")}
            >
              Decline
            </Button>
          </div>
        ) : responseAttempt?.status !== "unverified" && answered && !isPast && onRespond ? (
          <Button
            type="button"
            variant="textLink"
            className="ml-auto inline-flex min-h-[44px] max-md:min-h-[44px] shrink-0 items-center px-1 py-1 text-xs text-gray-300 underline underline-offset-2 hover:text-white sm:min-h-[36px] sm:px-0 sm:py-0"
            disabled={disabled}
            aria-label={`Change your response for ${role || "this assignment"}`}
            onClick={() => setChanging(true)}
          >
            Change response
          </Button>
        ) : null}
      </div>

      {responseAttempt?.status === "unverified" ? (
        <div className="mt-1 flex w-full flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-gray-700/70 pt-1.5">
          <p className="min-w-0 flex-1 text-xs text-amber-200" role="status" aria-live="polite">
            Couldn&apos;t confirm your response. You tried to {attemptedVerb} this assignment.
          </p>
          <Button
            type="button"
            variant="textLink"
            className="ml-auto inline-flex min-h-[44px] max-md:min-h-[44px] shrink-0 items-center px-1 py-1 text-xs text-amber-200 underline underline-offset-2 hover:text-white sm:min-h-[36px] sm:py-0"
            disabled={disabled}
            aria-label={`Retry refresh for your response to ${role || "this assignment"}`}
            onClick={async () => {
              const confirmed = await onRetryResponse?.();
              if (confirmed) setChanging(false);
            }}
          >
            Retry refresh
          </Button>
        </div>
      ) : null}
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
  occurrence: MyScheduleOccurrence;
  timeZone: string;
  isNextUpcoming: boolean;
  isPast: boolean;
  /** True when this date falls inside one of the member's own blockouts. */
  isBlockedOut: boolean;
  onOpen: () => void;
  responseAttempts: Map<string, AssignmentResponseAttempt>;
  acceptingPending: boolean;
  onRespond: (occurrenceId: string, slot: MyScheduleServing, response: "accepted" | "declined") => Promise<boolean>;
  onRetryResponse: (occurrenceId: string, slot: MyScheduleServing) => Promise<boolean>;
};

const OccurrenceTile = ({
  occurrence,
  timeZone,
  isNextUpcoming,
  isPast,
  isBlockedOut,
  onOpen,
  responseAttempts,
  acceptingPending,
  onRespond,
  onRetryResponse,
}: OccurrenceTileProps) => {
  const serviceName = occurrenceServiceLabel(occurrence);
  const myAssignments = occurrence.serving.filter((person) => person.isMe);
  const hasPlan = plansForOccurrence(occurrence).length > 0;
  const calendarDate = myScheduleOccurrenceDate(occurrence, timeZone);
  const tile = getServiceOccurrenceCardDateParts({
    calendarDate,
    startsAt: occurrence.startsAt,
    timeZone,
  });
  const openLabel = `Open ${serviceName} on ${tile.label}`;
  const isToday = !isNextUpcoming && isOccurrenceToday(occurrence, timeZone);
  let markerAriaSuffix = "";
  if (isNextUpcoming) markerAriaSuffix = ", up next";
  else if (isToday) markerAriaSuffix = ", today";
  if (hasPlan) markerAriaSuffix = `${markerAriaSuffix}, service plan available`;
  const ariaLabel = `${openLabel}${markerAriaSuffix}${isBlockedOut ? ", blocked out" : ""}`;
  const statusMarker = hasPlan
    ? <Icon svg={ClipboardList} size="xs" className="text-gray-400" />
    : null;

  return (
    <ServiceOccurrenceCard
      calendarDate={calendarDate}
      startsAt={occurrence.startsAt}
      timeZone={timeZone}
      serviceName={serviceName}
      ariaLabel={ariaLabel}
      isNextUpcoming={isNextUpcoming}
      isToday={isToday}
      isPast={isPast}
      statusMarker={statusMarker}
      onOpen={onOpen}
    >
      {myAssignments.length > 0 || isBlockedOut ? (
        <div className="space-y-2">
          {myAssignments.map((slot) => {
            const key = `${slot.scheduleId}\u0000${occurrence.occurrenceId}\u0000${slot.columnKey}`;
            const responseAttempt = responseAttempts.get(key);
            return (
              <AssignmentResponseRow
                key={key}
                slot={slot}
                disabled={acceptingPending || responseAttempt?.status === "saving" || responseAttempt?.status === "checking"}
                isPast={isPast}
                responseAttempt={responseAttempt}
                onRespond={(selectedSlot, response) => onRespond(occurrence.occurrenceId, selectedSlot, response)}
                onRetryResponse={() => onRetryResponse(occurrence.occurrenceId, slot)}
              />
            );
          })}
          {isBlockedOut ? (
            <div className="flex items-center gap-1 text-[11px] font-medium text-amber-300">
              <Icon svg={TriangleAlert} size="xs" className="shrink-0" />
              <span>Blocked out</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </ServiceOccurrenceCard>
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
  ) => Promise<boolean>;
  onRetryResponse?: (slot: MyScheduleServing) => Promise<boolean>;
  responseAttempts?: Map<string, AssignmentResponseAttempt>;
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
  onRetryResponse,
  responseAttempts = new Map<string, AssignmentResponseAttempt>(),
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
  const myPrimaryAssignments = occurrence.serving.filter((person) => person.isMe && person.isPrimary);
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
              {role && myPrimaryAssignments.length === 0 ? (
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
          {myPrimaryAssignments.length > 0 ? (
            <div className="space-y-2">
              {myPrimaryAssignments.map((slot) => {
                  const key = `${slot.scheduleId}\u0000${occurrence.occurrenceId}\u0000${slot.columnKey}`;
                  const responseAttempt = responseAttempts.get(key);
                  return (
                    <AssignmentResponseRow
                      key={key}
                      slot={slot}
                      disabled={acceptingPending || responseAttempt?.status === "saving" || responseAttempt?.status === "checking"}
                      isPast={!onRespond}
                      responseAttempt={responseAttempt}
                      onRespond={onRespond}
                      onRetryResponse={onRetryResponse ? () => onRetryResponse(slot) : undefined}
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
  }), [access, churchId]);
  /** Changes the unlinked message: an admin can fix this themselves. */
  const isChurchAdmin = !access && context?.role === "admin";
  const [personalChurchName, setPersonalChurchName] = useState("");
  const churchName = access?.churchName || personalChurchName || context?.churchName || "";
  const [occurrences, setOccurrences] = useState<MyScheduleOccurrence[]>([]);
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
  /** Scope async UI work to the church active when it started. */
  const churchIdRef = useRef(churchId);
  churchIdRef.current = churchId;
  /** Bulk acceptance outlives ordinary assignment refreshes. */
  const acceptPendingOperationRef = useRef<{ churchId: string } | null>(null);
  /** Set by the Time off editor; a refresh must never discard an open edit. */
  const timeOffDirtyRef = useRef(false);
  const assignmentResponsesInFlightRef = useRef(new Set<string>());

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
      reportFailure = true,
    }: {
      showLoading: boolean;
      reportFailure?: boolean;
    }): Promise<MyScheduleLoadResult> => {
      if (!churchId) return Promise.resolve({ status: "failed" });
      const request = ++requestRef.current;
      setSavedDatesLoad({ status: "pending" });
      if (showLoading) setStatus("loading");
      const applyFailure = (scheduleFailure: unknown) => {
        const failureStatus = getApiErrorStatus(scheduleFailure);
        const accessMessage = failureStatus === 401 || failureStatus === 403
          ? getApiErrorMessage(scheduleFailure, "Your access is no longer available. Ask an admin for help.")
          : undefined;
        const personalAccessMessage = access && accessMessage
          ? "Could not confirm personal access. Open your personal link again, or ask your church administrator for help."
          : accessMessage;
        setSavedDatesLoad({ status: "failed", accessMessage });
        if (reportFailure) {
          setScheduleError(personalAccessMessage || (showLoading
            ? "Could not load your schedule. Try again."
            : "Could not refresh your schedule. Try again."));
        }
        if (showLoading) setStatus("error");
      };

      return operations.load().then<MyScheduleLoadResult>((result) => {
        if (!mountedRef.current || churchIdRef.current !== churchId || request !== requestRef.current) return { status: "stale" };
        if (!result.success || (!showLoading && !result.member)) {
          applyFailure(new Error("Could not refresh saved dates. Your draft is kept. Try again."));
          return { status: "failed" };
        }

        const member = result.member;
        setSavedDatesLoad({ status: "ready" });
        setScheduleError("");
        if (access) setPersonalChurchName(result.churchName || "");
        const loadedOccurrences = result.occurrences || [];
        setOccurrences(loadedOccurrences);
        setServiceTimeZone(result.serviceTimeZone || "UTC");
        setHasMemberRecord(Boolean(member));
        // The editor retains its own draft/baseline. New saved props expose
        // conflicts without lending their revision to unsaved edits.
        setBlockoutDates(member?.blockoutDates || []);
        setMemberUpdatedAt(member?.updatedAt || "");
        setStatus("ready");
        return { status: "applied", member, occurrences: loadedOccurrences };
      }).catch<MyScheduleLoadResult>((error: unknown) => {
        if (!mountedRef.current || churchIdRef.current !== churchId || request !== requestRef.current) return { status: "stale" };
        applyFailure(error);
        return { status: "failed" };
      });
    },
    [access, churchId, operations],
  );

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
    return load({ showLoading: false }).then((result) =>
      result.status === "applied" && Boolean(result.member),
    );
  }, [load]);

  const [responseAttempts, setResponseAttempts] = useState<Map<string, AssignmentResponseAttempt>>(new Map());
  const setResponseAttempt = useCallback((key: string, attempt?: AssignmentResponseAttempt) => {
    setResponseAttempts((current) => {
      const next = new Map(current);
      if (attempt) next.set(key, attempt);
      else next.delete(key);
      return next;
    });
  }, []);
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
  const hasUnverifiedResponse = [...responseAttempts.values()].some((attempt) => attempt.status === "unverified");

  const acceptAllPending = useCallback(async () => {
    if (
      !churchId ||
      acceptPendingOperationRef.current?.churchId === churchId ||
      responseAttempts.size > 0
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
  }, [access, churchId, load, operations, responseAttempts.size]);

  /** Answer one assignment, treating a response as confirmed only after readback or an exact success echo. */
  const respondToAssignment = useCallback(
    async (occurrenceId: string, slot: MyScheduleServing, response: "accepted" | "declined"): Promise<boolean> => {
      const key = `${slot.scheduleId}\u0000${occurrenceId}\u0000${slot.columnKey}`;
      if (assignmentResponsesInFlightRef.current.has(key)) return false;
      assignmentResponsesInFlightRef.current.add(key);
      setResponseAttempt(key, { response, status: "saving" });
      try {
        let operationError: unknown;
        try {
          const saved = await operations.respond({
            scheduleId: slot.scheduleId,
            occurrenceId,
            cellKey: slot.columnKey,
            response,
          });
          if (!mountedRef.current || churchIdRef.current !== churchId) return false;
          if (saved?.success === true && saved.response === response) {
            // A load started before the write must not overwrite its confirmed result.
            ++requestRef.current;
            setSavedDatesLoad((current) => current.status === "pending"
              ? { status: "ready" }
              : current);
            setOccurrences((current) => current.map((occurrence) =>
              occurrence.occurrenceId === occurrenceId
                ? {
                  ...occurrence,
                  serving: occurrence.serving.map((person) =>
                    person.isMe && person.isPrimary && person.scheduleId === slot.scheduleId && person.columnKey === slot.columnKey
                      ? { ...person, response }
                      : person,
                  ),
                }
                : occurrence,
            ));
            setResponseAttempt(key);
            return true;
          }
          operationError = new Error("The saved response could not be confirmed.");
        } catch (error) {
          operationError = error;
        }

        if (!mountedRef.current || churchIdRef.current !== churchId) return false;
        setResponseAttempt(key, { response, status: "checking" });
        let reconciliation: MyScheduleLoadResult;
        try {
          reconciliation = await load({ showLoading: false, reportFailure: false });
        } catch {
          reconciliation = { status: "failed" };
        }
        if (!mountedRef.current || churchIdRef.current !== churchId) return false;
        if (reconciliation.status === "applied") {
          const currentOccurrence = reconciliation.occurrences.find((item) => item.occurrenceId === occurrenceId);
          const currentAssignment = currentOccurrence?.serving.find((person) =>
            person.isMe && person.isPrimary && person.scheduleId === slot.scheduleId && person.columnKey === slot.columnKey,
          );
          setResponseAttempt(key);
          if (!currentAssignment || currentAssignment.response === response) return true;
          showApiErrorToast(showToast, operationError, "Could not save your response. Your schedule was refreshed.");
          return false;
        }
        setResponseAttempt(key, { response, status: "unverified" });
        return false;
      } finally {
        assignmentResponsesInFlightRef.current.delete(key);
      }
    },
    [churchId, load, operations, setResponseAttempt, showToast],
  );

  /** Retry only the read that checks a saved response; this never submits it again. */
  const retryResponseRefresh = useCallback(
    async (occurrenceId: string, slot: MyScheduleServing): Promise<boolean> => {
      const key = `${slot.scheduleId}\u0000${occurrenceId}\u0000${slot.columnKey}`;
      const attempt = responseAttempts.get(key);
      if (!attempt || attempt.status !== "unverified" || assignmentResponsesInFlightRef.current.has(key)) return false;
      assignmentResponsesInFlightRef.current.add(key);
      setResponseAttempt(key, { ...attempt, status: "checking" });
      try {
        let reconciliation: MyScheduleLoadResult;
        try {
          reconciliation = await load({ showLoading: false, reportFailure: false });
        } catch {
          reconciliation = { status: "failed" };
        }
        if (!mountedRef.current || churchIdRef.current !== churchId) return false;
        if (reconciliation.status !== "applied") {
          setResponseAttempt(key, { ...attempt, status: "unverified" });
          return false;
        }
        const currentOccurrence = reconciliation.occurrences.find((item) => item.occurrenceId === occurrenceId);
        const currentAssignment = currentOccurrence?.serving.find((person) =>
          person.isMe && person.isPrimary && person.scheduleId === slot.scheduleId && person.columnKey === slot.columnKey,
        );
        setResponseAttempt(key);
        return !currentAssignment || currentAssignment.response === attempt.response;
      } finally {
        assignmentResponsesInFlightRef.current.delete(key);
      }
    },
    [churchId, load, responseAttempts, setResponseAttempt],
  );

  const datedOccurrences = useMemo(
    () => occurrences.filter(hasDatedStartsAt),
    [occurrences],
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
    occurrences.forEach((occurrence) => {
      const date = myScheduleOccurrenceDate(occurrence, serviceTimeZone);
      const range = findBlockoutRangeForDate(blockoutDates, date);
      if (range) {
        labels.set(occurrence.occurrenceId, formatBlockoutDateRangeLabel(range));
      }
    });
    return labels;
  }, [blockoutDates, occurrences, serviceTimeZone]);

  /** Team choices come only from this volunteer's own assignments. */
  const teamOptions = useMemo(() => {
    const names = new Map<string, string>();
    datedOccurrences.forEach((occurrence) =>
      occurrence.serving
        .filter((person) => person.isMe && person.teamId)
        .forEach((person) => names.set(person.teamId, person.teamName)),
    );
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
        !occurrence.serving.some((person) => person.isMe && person.teamId === teamFilter)
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
    const isPast = (occurrence: MyScheduleOccurrence) =>
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

  const canShowTimeline = status === "ready" && hasMemberRecord;
  const canShowSelfService = status === "ready" && hasMemberRecord;
  const renderTiles = (items: MyScheduleOccurrence[], isPast: boolean) => (
    <ul
      aria-label="My scheduled services"
      className={cn(SERVICE_OCCURRENCE_GRID_CLASS_NAME, "pt-3")}
    >
      {items.map((occurrence) => (
        <OccurrenceTile
          key={occurrence.occurrenceId}
          occurrence={occurrence}
          timeZone={serviceTimeZone}
          isNextUpcoming={!isPast && occurrence.occurrenceId === nextUpcomingId}
          isPast={isPast}
          isBlockedOut={blockoutLabelByOccurrence.has(occurrence.occurrenceId)}
          responseAttempts={responseAttempts}
          acceptingPending={acceptingPending}
          onRespond={respondToAssignment}
          onRetryResponse={retryResponseRefresh}
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
      contentClassName="max-w-[90rem]"
    >
      <div className="flex w-full flex-col gap-4">
        {status === "loading" ? (
          <MyScheduleLoadingSkeleton showSmsPreferences={Boolean(access)} />
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
            onRetryResponse={(slot) => retryResponseRefresh(selected.occurrenceId, slot)}
            responseAttempts={responseAttempts}
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
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  label="Search"
                  className="w-full min-w-0 sm:w-auto sm:min-w-[16rem] sm:flex-1"
                  value={query}
                  placeholder="Song, position, person, or date"
                  onChange={(value) => setQuery(String(value))}
                />
                <div className="flex w-fit flex-col gap-1 rounded-md border border-gray-700/80 bg-gray-900/70 px-2.5 py-1.5">
                  <span className="px-0.5 text-xs font-semibold text-gray-200">Organize</span>
                  <SegmentedControl
                    ariaLabel="Organize services"
                    variant="compact"
                    value={organizeMode}
                    onChange={setOrganizeMode}
                    options={MY_SCHEDULE_ORGANIZE_OPTIONS}
                  />
                </div>
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
                    {responseAttempts.size > 0
                      ? hasUnverifiedResponse
                        ? "Refresh the individual response before accepting the remaining assignments."
                        : "Wait for the individual response to finish before accepting the remaining assignments."
                      : "Accepts only assignments you haven't answered yet. You can change individual responses later."}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="none"
                  svg={Check}
                  iconSize="sm"
                  className="w-full shrink-0 justify-center rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-600 sm:w-auto"
                  disabled={acceptingPending || responseAttempts.size > 0}
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
            {upcoming.length === 0 && past.length === 0 ? (
              <p className="text-sm text-gray-300">
                {hasFilters
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
