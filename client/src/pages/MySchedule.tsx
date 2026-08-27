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
import Button from "../components/Button/Button";
import ButtonGroup from "../components/Button/ButtonGroup";
import ButtonGroupItem from "../components/Button/ButtonGroupItem";
import Icon from "../components/Icon/Icon";
import Input from "../components/Input/Input";
import SegmentedControl from "../components/SegmentedControl/SegmentedControl";
import Select from "../components/Select/Select";
import { GlobalInfoContext } from "../context/globalInfo";
import { useToast } from "../context/toastContext";
import { showApiErrorToast } from "../utils/apiErrorToast";
import { useSyncOnReconnect } from "../hooks/useSyncOnReconnect";
import {
  getMyTeamAssignments,
  respondToMyAssignment,
  type MyScheduleOccurrence,
  type MyScheduleServing,
} from "../api/auth";
import type { TeamBlockoutDateRange, TeamRosterMember } from "../api/authTypes";
import {
  buildMyScheduleExportModelForOccurrences,
} from "./buildMyScheduleExportModel";
import MyScheduleBlockouts from "./MyScheduleBlockouts";
import MyScheduleServicePlanPanel from "./MyScheduleServicePlanPanel";
import {
  findBlockoutRangeForDate,
  formatBlockoutDateRangeLabel,
} from "./Teams/teamsUtils";
import ScheduleExportTable from "./Teams/schedule/ScheduleExportTable";
import SchedulePdfExportButton from "./Teams/schedule/SchedulePdfExportButton";
import ScheduleUpNextBadge from "./Teams/schedule/ScheduleUpNextBadge";
import type { ScheduleExportLayout } from "./Teams/schedule/scheduleExportPdf";
import { scheduleUpNextBorderClassName } from "./Teams/schedule/scheduleUtils";
import { cn } from "@/utils/cnHelper";

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
 * Members can change two things here, both via self-scoped writes: their own
 * time off, and accepting or declining an assignment. Emailed response links
 * arrive with the dispatch work and write through the same endpoint.
 */

const ALL_TEAMS = "__all_teams__";
const ALL_SERVICES = "__all_services__";

type DetailTab = "schedule" | "servicePlan";

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

const formatWhen = (startsAt: string): string => {
  if (!startsAt) return "Date not set";
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) return "Date not set";
  return parsed.toLocaleString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
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
  occurrence: MyScheduleOccurrence,
): OccurrenceTileParts => {
  const date = new Date(occurrence.startsAt);
  if (Number.isNaN(date.getTime())) {
    return {
      weekday: "—",
      month: "",
      day: "?",
      time: "",
      label: "Date not set",
    };
  }
  const weekday = date.toLocaleString(undefined, { weekday: "short" });
  const month = date.toLocaleString(undefined, { month: "short" });
  const day = date.toLocaleString(undefined, { day: "numeric" });
  const time = date.toLocaleString(undefined, {
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
  { label: string; className: string }
> = {
  accepted: {
    label: "You accepted",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  },
  declined: {
    // Red, matching the grid's decline marker. Amber is taken here: it already
    // means "blocked out" both on this page and on the owner's cells, and the
    // same colour for two different facts is worse than a strong one.
    label: "You declined",
    className: "border-red-500/40 bg-red-500/10 text-red-200",
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
  onRespond,
}: {
  slot: MyScheduleServing;
  disabled: boolean;
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
  // A fresh answer collapses the row back to its confirmed state rather than
  // leaving the picker open over a decision already made.
  const showChoices = !answered || changing;

  const choose = (next: "accepted" | "declined") => {
    setChanging(false);
    onRespond(slot, next);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-700/80 bg-gray-900/50 px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="truncate text-sm font-medium text-orange-300">
          {role || "Your slot"}
        </span>
        {chip ? (
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              chip.className,
            )}
          >
            {chip.label}
          </span>
        ) : (
          <span className="shrink-0 text-xs text-gray-400">
            Needs your response
          </span>
        )}
      </div>
      {showChoices ? (
        <ButtonGroup className="shrink-0 border-gray-500" display="flex">
          <ButtonGroupItem
            type="button"
            variant="primary"
            iconSize="sm"
            svg={Check}
            color="#6ee7b7"
            className="max-md:min-h-0"
            disabled={disabled}
            isSelected={response === "accepted"}
            aria-label={`Accept ${role || "this assignment"}`}
            onClick={() => choose("accepted")}
          >
            Accept
          </ButtonGroupItem>
          <ButtonGroupItem
            type="button"
            variant="primary"
            iconSize="sm"
            svg={X}
            color="#fca5a5"
            className="max-md:min-h-0"
            disabled={disabled}
            isSelected={response === "declined"}
            aria-label={`Decline ${role || "this assignment"}`}
            onClick={() => choose("declined")}
          >
            Decline
          </ButtonGroupItem>
        </ButtonGroup>
      ) : (
        <Button
          type="button"
          variant="tertiary"
          className="shrink-0 text-xs text-gray-300 underline underline-offset-2 hover:text-white max-md:min-h-0"
          disabled={disabled}
          aria-label={`Change your response for ${role || "this assignment"}`}
          onClick={() => setChanging(true)}
        >
          Change response
        </Button>
      )}
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
  isNextUpcoming: boolean;
  isPast: boolean;
  /** True when this date falls inside one of the member's own blockouts. */
  isBlockedOut: boolean;
  onOpen: () => void;
};

const OccurrenceTile = ({
  occurrence,
  isNextUpcoming,
  isPast,
  isBlockedOut,
  onOpen,
}: OccurrenceTileProps) => {
  const tile = getOccurrenceTileParts(occurrence);
  const serviceName = occurrenceServiceLabel(occurrence);
  const role = myRoleLabel(occurrence);
  const hasPlan = Boolean(occurrence.plan);
  const openLabel = `Open ${serviceName} on ${tile.label}`;

  return (
    <li className="relative">
      {isNextUpcoming ? (
        <div className="pointer-events-none absolute -top-2.5 left-1/2 z-20 -translate-x-1/2">
          <ScheduleUpNextBadge />
        </div>
      ) : null}
      <Button
        type="button"
        variant="tertiary"
        aria-label={cn(
          openLabel,
          isNextUpcoming && ", up next",
          isBlockedOut && ", blocked out",
        )}
        className={cn(
          "h-auto w-full flex-col items-stretch gap-0 rounded-lg border px-2.5 py-2 font-normal",
          hasPlan
            ? "border-emerald-500/30 bg-gray-800/80 hover:border-emerald-400/45 hover:bg-gray-800"
            : "border-gray-600/70 bg-gray-800/70 hover:border-orange-400/35 hover:bg-gray-800",
          isNextUpcoming && scheduleUpNextBorderClassName,
          isPast && "opacity-55",
        )}
        onClick={onOpen}
      >
        <span className="flex w-full items-center justify-between gap-1">
          <span
            className={cn(
              "text-[11px] font-semibold uppercase tracking-wide",
              hasPlan ? "text-emerald-300/70" : "text-gray-400",
            )}
          >
            {tile.weekday}
          </span>
          {hasPlan ? (
            <Icon
              svg={Check}
              size="xs"
              className="shrink-0 text-emerald-300"
            />
          ) : (
            <span className="size-1.5 shrink-0 rounded-full bg-orange-400/45" />
          )}
        </span>
        <span className="mt-0.5 text-left text-lg font-semibold leading-none text-gray-100">
          {tile.day}
        </span>
        <span className="mt-1 flex w-full items-center justify-between gap-1 text-left text-[11px] text-gray-400">
          <span>{tile.month}</span>
          {tile.time ? <span>{tile.time}</span> : null}
        </span>
        <span
          className="mt-1 truncate text-left text-[11px] font-medium text-gray-300"
          title={serviceName}
        >
          {serviceName}
        </span>
        {role ? (
          <span
            className="mt-0.5 truncate text-left text-[11px] text-orange-300/90"
            title={role}
          >
            {role}
          </span>
        ) : null}
        {/* Same wording the owner sees on the schedule grid, so the two
            surfaces describe one fact the same way. Kept off the border, which
            already carries plan and up-next meaning. */}
        {isBlockedOut ? (
          <span className="mt-1 flex items-center gap-1 text-left text-[11px] font-medium text-amber-300">
            <Icon svg={TriangleAlert} size="xs" className="shrink-0" />
            <span className="truncate">Blocked out</span>
          </span>
        ) : null}
      </Button>
    </li>
  );
};

type OccurrenceDetailProps = {
  occurrence: MyScheduleOccurrence;
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
  respondingKey?: string;
};

const OccurrenceDetail = ({
  occurrence,
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
  respondingKey = "",
}: OccurrenceDetailProps) => {
  const [tab, setTab] = useState<DetailTab>("schedule");
  const [scheduleLayout, setScheduleLayout] =
    useState<ScheduleExportLayout>("byDate");
  const serviceName = occurrenceServiceLabel(occurrence);
  const role = myRoleLabel(occurrence);
  const plan = occurrence.plan;
  const teamUrl = plan?.publicUrls?.team;
  const generalUrl = plan?.publicUrls?.general || teamUrl;
  const canShare = Boolean(plan?.published && teamUrl);
  const scheduleModel = useMemo(
    () => buildMyScheduleExportModelForOccurrences(scheduleOccurrences),
    [scheduleOccurrences],
  );

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
              {formatWhen(occurrence.startsAt)}
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
              .map((slot) => (
                <AssignmentResponseRow
                  key={slot.columnKey}
                  slot={slot}
                  disabled={respondingKey === slot.columnKey}
                  onRespond={onRespond}
                />
              ))}
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
                churchName={churchName}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const MySchedule = () => {
  const context = useContext(GlobalInfoContext);
  const { showToast } = useToast();
  const churchId = context?.churchId || "";
  /** Changes the unlinked message: an admin can fix this themselves. */
  const isChurchAdmin = context?.role === "admin";
  const churchName = context?.churchName || "";
  const [occurrences, setOccurrences] = useState<MyScheduleOccurrence[]>([]);
  const [hasMemberRecord, setHasMemberRecord] = useState(true);
  const [blockoutDates, setBlockoutDates] = useState<TeamBlockoutDateRange[]>(
    [],
  );
  /** Precondition for the blockout write; see `updateMyBlockoutDates`. */
  const [memberUpdatedAt, setMemberUpdatedAt] = useState("");
  const [showPast, setShowPast] = useState(false);
  const [query, setQuery] = useState("");
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const [serviceFilter, setServiceFilter] = useState(ALL_SERVICES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  const mountedRef = useRef(true);
  /** Drops a response that a newer request has already superseded. */
  const requestRef = useRef(0);
  /** Set by the Time off editor; a refresh must never discard an open edit. */
  const timeOffDirtyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    ({ showLoading }: { showLoading: boolean }) => {
      if (!churchId) return;
      const request = ++requestRef.current;
      if (showLoading) setStatus("loading");
      void getMyTeamAssignments(churchId)
        .then((result) => {
          if (!mountedRef.current || request !== requestRef.current) return;
          setOccurrences(result.occurrences || []);
          setHasMemberRecord(Boolean(result.member));
          setBlockoutDates(result.member?.blockoutDates || []);
          setMemberUpdatedAt(result.member?.updatedAt || "");
          setStatus("ready");
        })
        .catch(() => {
          if (!mountedRef.current || request !== requestRef.current) return;
          // A background refresh that fails leaves the page as it is. Replacing
          // a working schedule with an error because a resume failed is worse
          // than showing data that is a few minutes old.
          if (showLoading) setStatus("error");
        });
    },
    [churchId],
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

  const handleBlockoutsSaved = useCallback((member: TeamRosterMember) => {
    setBlockoutDates(member?.blockoutDates || []);
    setMemberUpdatedAt(member?.updatedAt || "");
  }, []);

  /**
   * The save was rejected because the record moved. Pull the current state in
   * so the reader compares against what is stored — the editor keeps their
   * draft, so nothing they typed is lost, and saving again now carries a write
   * stamp the server will accept.
   */
  const refreshAfterConflict = useCallback(() => {
    load({ showLoading: false });
  }, [load]);

  const [respondingKey, setRespondingKey] = useState("");

  /**
   * Answer one assignment, applied optimistically so the tap feels immediate.
   *
   * On any failure the page refetches rather than reverting locally: the common
   * failure is a 409 because the slot moved to someone else, and in that case
   * the old value is not the truth to go back to. The server message says what
   * happened; the refetch makes the screen agree with it.
   */
  const respondToAssignment = useCallback(
    async (slot: MyScheduleServing, response: "accepted" | "declined") => {
      if (!selectedId) return;
      setRespondingKey(slot.columnKey);
      const apply = (value: MyScheduleServing["response"]) =>
        setOccurrences((current) =>
          current.map((occurrence) =>
            occurrence.occurrenceId === selectedId
              ? {
                  ...occurrence,
                  serving: occurrence.serving.map((person) =>
                    person.isMe && person.columnKey === slot.columnKey
                      ? { ...person, response: value }
                      : person,
                  ),
                }
              : occurrence,
          ),
        );
      apply(response);
      try {
        await respondToMyAssignment(churchId, {
          scheduleId: slot.scheduleId,
          occurrenceId: selectedId,
          cellKey: slot.columnKey,
          response,
        });
      } catch (error) {
        showApiErrorToast(showToast, error, "Could not save your response.");
        load({ showLoading: false });
      } finally {
        setRespondingKey("");
      }
    },
    [churchId, load, selectedId, showToast],
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
      const range = findBlockoutRangeForDate(blockoutDates, occurrence.date);
      if (range) {
        labels.set(occurrence.occurrenceId, formatBlockoutDateRangeLabel(range));
      }
    });
    return labels;
  }, [blockoutDates, occurrences]);

  /** Only the teams this person actually serves on are worth offering. */
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

  /** Service names from the schedule — same vocabulary as Plans / Schedule. */
  const serviceOptions = useMemo(() => {
    const names = new Map<string, string>();
    datedOccurrences.forEach((occurrence) => {
      const label = occurrenceServiceLabel(occurrence);
      const key = occurrence.serviceIds.slice().sort().join("|") || label;
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
        !occurrence.serving.some(
          (person) => person.isMe && person.teamId === teamFilter,
        )
      ) {
        return false;
      }
      if (serviceFilter !== ALL_SERVICES) {
        const key =
          occurrence.serviceIds.slice().sort().join("|") ||
          occurrenceServiceLabel(occurrence);
        if (key !== serviceFilter) return false;
      }
      if (!trimmed) return true;
      // Searches everything on the card — a name, a position, a song title, or
      // the date as shown — because any of those is how someone would look for
      // a service they half-remember.
      const haystack = [
        formatWhen(occurrence.startsAt),
        occurrenceServiceLabel(occurrence),
        ...occurrence.serving.flatMap((person) => [
          person.name,
          person.positionName,
          person.teamName,
        ]),
        occurrence.plan?.name || "",
        ...(occurrence.plan?.sections || []).flatMap((section) =>
          section.elements.map((element) => element.title),
        ),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [datedOccurrences, query, serviceFilter, teamFilter]);

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
        label: `${occurrenceServiceLabel(occurrence)} · ${formatWhen(occurrence.startsAt)}`,
      })),
    [navigable],
  );

  const nextUpcomingId = upcoming[0]?.occurrenceId ?? null;
  const hasFilters =
    query.trim().length > 0 ||
    teamFilter !== ALL_TEAMS ||
    serviceFilter !== ALL_SERVICES;

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

  return (
    <AppPageShell
      title="My schedule"
      icon={CalendarDays}
    >
      <div className="flex w-full flex-col gap-4">
        {status === "loading" ? (
          <p className="text-sm text-gray-300">Loading your schedule…</p>
        ) : null}

        {status === "error" ? (
          <p className="text-sm text-red-400">
            Could not load your schedule. Refresh to try again.
          </p>
        ) : null}

        {status === "ready" && !hasMemberRecord ? (
          // Normal for anyone not on a team. The next step differs by who is
          // reading: "ask an admin" is useless advice when you are the admin,
          // and linking is something they can do themselves.
          <p className="text-sm text-gray-300">
            {isChurchAdmin
              ? "You are not on any team's roster yet. Link your account to a member in Teams → Members."
              : "Your account is not linked to anyone on a team yet. Ask an admin to link you."}
          </p>
        ) : null}

        {status === "ready" && hasMemberRecord && selected ? (
          <OccurrenceDetail
            occurrence={selected}
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
            onRespond={
              past.some(
                (item) => item.occurrenceId === selected.occurrenceId,
              )
                ? undefined
                : respondToAssignment
            }
            respondingKey={respondingKey}
          />
        ) : null}

        {status === "ready" && hasMemberRecord && !selected ? (
          <>
            <MyScheduleBlockouts
              churchId={churchId}
              blockoutDates={blockoutDates}
              expectedUpdatedAt={memberUpdatedAt}
              occurrences={occurrences}
              onSaved={handleBlockoutsSaved}
              onDirtyChange={handleTimeOffDirtyChange}
              onStale={refreshAfterConflict}
            />

            {datedOccurrences.length > 0 ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <Input
                  label="Search"
                  className="flex-1"
                  value={query}
                  placeholder="Song, position, person, or date"
                  onChange={(value) => setQuery(String(value))}
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
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {upcoming.map((occurrence) => (
                    <OccurrenceTile
                      key={occurrence.occurrenceId}
                      occurrence={occurrence}
                      isNextUpcoming={occurrence.occurrenceId === nextUpcomingId}
                      isPast={false}
                      isBlockedOut={blockoutLabelByOccurrence.has(
                        occurrence.occurrenceId,
                      )}
                      onOpen={() => setSelectedId(occurrence.occurrenceId)}
                    />
                  ))}
                </ul>
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
                  <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    {past.map((occurrence) => (
                      <OccurrenceTile
                        key={occurrence.occurrenceId}
                        occurrence={occurrence}
                        isNextUpcoming={false}
                        isPast
                        isBlockedOut={blockoutLabelByOccurrence.has(
                          occurrence.occurrenceId,
                        )}
                        onOpen={() => setSelectedId(occurrence.occurrenceId)}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </AppPageShell>
  );
};

export default MySchedule;
