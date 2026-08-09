import { useContext, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
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
import {
  getMyTeamAssignments,
  type MyScheduleOccurrence,
} from "../api/auth";
import { buildMyScheduleExportModel } from "./buildMyScheduleExportModel";
import MyScheduleServicePlanPanel from "./MyScheduleServicePlanPanel";
import ScheduleExportTable from "./Teams/schedule/ScheduleExportTable";
import ScheduleUpNextBadge from "./Teams/schedule/ScheduleUpNextBadge";
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
 * Read-only by design: accept and decline arrive with the notification work.
 */

const ALL_TEAMS = "__all_teams__";
const ALL_SERVICES = "__all_services__";

type DetailTab = "schedule" | "servicePlan";

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
  onOpen: () => void;
};

const OccurrenceTile = ({
  occurrence,
  isNextUpcoming,
  isPast,
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
        aria-label={`${openLabel}${isNextUpcoming ? ", up next" : ""}`}
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
      </Button>
    </li>
  );
};

type OccurrenceDetailProps = {
  occurrence: MyScheduleOccurrence;
  jumpOptions: { value: string; label: string }[];
  onJump: (occurrenceId: string) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onBack: () => void;
  onCopyLink: (url: string, label: string) => void;
  onViewLink: (url: string) => void;
  churchName?: string;
};

const OccurrenceDetail = ({
  occurrence,
  jumpOptions,
  onJump,
  onPrevious,
  onNext,
  onBack,
  onCopyLink,
  onViewLink,
  churchName = "",
}: OccurrenceDetailProps) => {
  const [tab, setTab] = useState<DetailTab>("schedule");
  const serviceName = occurrenceServiceLabel(occurrence);
  const role = myRoleLabel(occurrence);
  const plan = occurrence.plan;
  const teamUrl = plan?.publicUrls?.team;
  const generalUrl = plan?.publicUrls?.general || teamUrl;
  const canShare = Boolean(plan?.published && teamUrl);
  const scheduleModel = useMemo(
    () => buildMyScheduleExportModel(occurrence),
    [occurrence],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700/80 bg-gray-950/70">
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
            {role ? (
              <p className="mt-1 text-sm text-orange-300">{role}</p>
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
        <SegmentedControl
          ariaLabel="Schedule or service plan"
          variant="admin"
          fullWidth
          value={tab}
          onChange={setTab}
          options={[
            { value: "schedule", label: "Schedule" },
            { value: "servicePlan", label: "Service plan" },
          ]}
        />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 sm:p-4">
        {tab === "schedule" ? (
          <ScheduleExportTable
            model={scheduleModel}
            theme="board-attendee"
            layout="byDate"
          />
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
  const [showPast, setShowPast] = useState(false);
  const [query, setQuery] = useState("");
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const [serviceFilter, setServiceFilter] = useState(ALL_SERVICES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    if (!churchId) return;
    let cancelled = false;
    setStatus("loading");
    void getMyTeamAssignments(churchId)
      .then((result) => {
        if (cancelled) return;
        setOccurrences(result.occurrences || []);
        setHasMemberRecord(Boolean(result.member));
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [churchId]);

  /** Only the teams this person actually serves on are worth offering. */
  const teamOptions = useMemo(() => {
    const names = new Map<string, string>();
    occurrences.forEach((occurrence) =>
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
  }, [occurrences]);

  /** Service names from the schedule — same vocabulary as Plans / Schedule. */
  const serviceOptions = useMemo(() => {
    const names = new Map<string, string>();
    occurrences.forEach((occurrence) => {
      const label = occurrenceServiceLabel(occurrence);
      const key = occurrence.serviceIds.slice().sort().join("|") || label;
      if (!names.has(key)) names.set(key, label);
    });
    return [
      { value: ALL_SERVICES, label: "All services" },
      ...[...names.entries()].map(([value, label]) => ({ value, label })),
    ];
  }, [occurrences]);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return occurrences.filter((occurrence) => {
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
  }, [occurrences, query, serviceFilter, teamFilter]);

  /**
   * Past services are kept but pushed behind a toggle. A schedule that opens on
   * something months gone buries the next commitment, which is what most people
   * came to see.
   */
  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const isPast = (occurrence: MyScheduleOccurrence) => {
      const time = Date.parse(occurrence.startsAt);
      return Number.isFinite(time) && time < now;
    };
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
        ? occurrences.find((item) => item.occurrenceId === selectedId) || null
        : null,
    [occurrences, selectedId],
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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
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
          />
        ) : null}

        {status === "ready" && hasMemberRecord && !selected ? (
          <>
            {occurrences.length > 0 ? (
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
