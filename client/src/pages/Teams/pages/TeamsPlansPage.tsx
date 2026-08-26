import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Users,
} from "lucide-react";
import Button from "../../../components/Button/Button";
import Checkbox from "../../../components/Checkbox/Checkbox";
import Icon from "../../../components/Icon/Icon";
import SegmentedControl from "../../../components/SegmentedControl/SegmentedControl";
import DateRangePicker from "@/components/ui/DateRangePicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { useToast } from "../../../context/toastContext";
import {
  getServicePlanMicrophones,
  listServicePlans,
  updateTeamScheduleAssignmentMicrophones,
} from "../../../api/auth";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import { formatPlainDate } from "../../../utils/plainDate";
import {
  findNextUpcomingOccurrenceId,
  generateScheduleOccurrences,
  getOccurrenceDate,
  getSharedOccurrenceTiming,
  type SharedOccurrenceTiming,
} from "../../../utils/teamScheduleOccurrences";
import { getServicePlanKey } from "../../../utils/servicePlanKeys";
import ServicePlanEditor from "../../Services/ServicePlanEditor";
import { useTeamsPage } from "../TeamsPageContext";
import {
  OCCURRENCE_ORGANIZE_OPTIONS,
  readPlansOrganizeMode,
  writePlansOrganizeMode,
  type OccurrenceOrganizeMode,
} from "../occurrenceOrganizeMode";
import {
  readPlansFilterPreferences,
  writePlansFilterPreferences,
  type PlansRangePreset,
} from "../plansFilterPersistence";
import {
  getOccurrenceAssignmentSummary,
  getScheduledMicrophoneHolders,
  getUnhydratedOccurrenceScheduleIds,
  groupAssignmentSummaryByTeam,
  teamMicrophoneSlotKey,
  type TeamsAssignmentSummaryRow,
} from "./teamsAssignmentsSummary";
import WhosServingPanel from "./WhosServingPanel";
import { useTeamsRestoreOnMount } from "../hooks/useTeamsReturnNavigation";
import {
  buildPlansReturnTo,
  buildPlanToScheduleNavigationState,
  persistTeamsReturnTo,
  TEAMS_SECTION_PATHS,
  type TeamsPlansRestore,
} from "../teamsReturnNavigation";
import { isActive } from "../teamsUtils";
import ScheduleUpNextBadge from "../schedule/ScheduleUpNextBadge";
import { scheduleUpNextBorderClassName } from "../schedule/scheduleUtils";
import { cn } from "@/utils/cnHelper";
import type {
  TeamScheduleOccurrence,
  TeamService,
} from "../../../api/authTypes";
import type { ServicePlanMicrophone } from "../../../types/servicePlan";
import { onlyHydratedSchedules } from "../../../api/authTypes";

type RangePreset = PlansRangePreset;

export const rangeFromPreset = (
  preset: Exclude<RangePreset, "custom">,
  now = new Date(),
) => {
  const year = now.getFullYear();
  const month = now.getMonth();
  const quarterStartMonth = Math.floor(month / 3) * 3;
  let start: Date;
  let end: Date;

  switch (preset) {
    case "thisMonth":
      start = new Date(year, month, 1);
      end = new Date(year, month + 1, 0);
      break;
    case "nextMonth":
      start = new Date(year, month + 1, 1);
      end = new Date(year, month + 2, 0);
      break;
    case "thisQuarter":
      start = new Date(year, quarterStartMonth, 1);
      end = new Date(year, quarterStartMonth + 3, 0);
      break;
    case "nextQuarter":
      start = new Date(year, quarterStartMonth + 3, 1);
      end = new Date(year, quarterStartMonth + 6, 0);
      break;
  }

  return {
    start: formatPlainDate(start),
    end: formatPlainDate(end),
  };
};

const defaultRange = () => rangeFromPreset("thisMonth");

const formatRangeDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/**
 * Plain date `days` away from `date`. Noon keeps the shift clear of DST edges.
 */
const shiftPlainDate = (date: string, days: number) => {
  const shifted = new Date(`${date}T12:00:00`);
  if (Number.isNaN(shifted.getTime())) return date;
  shifted.setDate(shifted.getDate() + days);
  return formatPlainDate(shifted);
};

type ServiceGroup = {
  /** `group:<serviceGroupId>` for a combined service, else its own serviceId. */
  key: string;
  /** Occurrence display name — already joined with " & " for combined groups. */
  name: string;
  /** Representative service (used to open the editor and read recurrence type). */
  service: TeamService;
  /** Every member service id, so the Service filter matches on any of them. */
  serviceIds: string[];
  occurrences: TeamScheduleOccurrence[];
};

type MonthGroup = {
  key: string;
  label: string;
  occurrences: TeamScheduleOccurrence[];
};

type PlansTileParts = {
  weekday: string;
  month: string;
  day: string;
  time: string | null;
  /** Accessible / aria label, e.g. "Sat · Jul 25". */
  label: string;
};

const monthKeyFromStartsAt = (startsAt: string) => {
  const date = new Date(startsAt);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const monthLabelFromStartsAt = (startsAt: string) =>
  new Date(startsAt).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

const groupOccurrencesByMonth = (
  occurrences: TeamScheduleOccurrence[],
): MonthGroup[] => {
  const groups: MonthGroup[] = [];
  for (const occurrence of occurrences) {
    const key = monthKeyFromStartsAt(occurrence.startsAt);
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.occurrences.push(occurrence);
      continue;
    }
    groups.push({
      key,
      label: monthLabelFromStartsAt(occurrence.startsAt),
      occurrences: [occurrence],
    });
  }
  return groups;
};

/**
 * Compact calendar-style parts for month-grouped tiles. Year lives in the month
 * header; shared service time lives in the service header chips.
 */
const getPlansTileParts = (
  occurrence: TeamScheduleOccurrence,
  shared: SharedOccurrenceTiming,
): PlansTileParts => {
  const date = new Date(occurrence.startsAt);
  const weekday = date.toLocaleString(undefined, { weekday: "short" });
  const month = date.toLocaleString(undefined, { month: "short" });
  const day = date.toLocaleString(undefined, { day: "numeric" });
  const time = shared.sharedTime
    ? null
    : date.toLocaleString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  const label = time ? `${weekday} · ${month} ${day} · ${time}` : `${weekday} · ${month} ${day}`;
  return { weekday, month, day, time, label };
};

const serviceTimingLabel = (shared: SharedOccurrenceTiming) => {
  if (shared.sharedWeekday && shared.sharedTime) {
    return `${shared.sharedWeekday} at ${shared.sharedTime}`;
  }
  return shared.sharedWeekday || shared.sharedTime || null;
};

/** Always show time on by-date tiles — service headers are not there to carry it. */
const BY_DATE_TILE_SHARED: SharedOccurrenceTiming = {
  sharedWeekday: null,
  sharedTime: null,
};

type PlansOccurrenceTileProps = {
  occurrence: TeamScheduleOccurrence;
  shared: SharedOccurrenceTiming;
  serviceName?: string;
  hasPlan: boolean;
  isPast: boolean;
  isNextUpcoming: boolean;
  planStatusLoading: boolean;
  onOpen: () => void;
};

const PlansOccurrenceTile = ({
  occurrence,
  shared,
  serviceName,
  hasPlan,
  isPast,
  isNextUpcoming,
  planStatusLoading,
  onOpen,
}: PlansOccurrenceTileProps) => {
  const tile = getPlansTileParts(occurrence, shared);
  let planActionLabel = `Add plan for ${tile.label}`;
  if (planStatusLoading) {
    planActionLabel = `Plan for ${tile.label}`;
  } else if (hasPlan) {
    planActionLabel = `Open plan for ${tile.label}`;
  }
  if (serviceName) {
    planActionLabel = `${planActionLabel} (${serviceName})`;
  }

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
        aria-label={`${planActionLabel}${isNextUpcoming ? ", up next" : ""}`}
        aria-busy={planStatusLoading || undefined}
        className={cn(
          "h-auto w-full flex-col items-stretch gap-0 rounded-lg border px-2.5 py-2 font-normal",
          planStatusLoading
            ? "border-gray-600/70 bg-gray-800/70 hover:border-gray-500/50 hover:bg-gray-800"
            : hasPlan
              ? "border-emerald-500/30 bg-gray-800/80 hover:border-emerald-400/45 hover:bg-gray-800"
              : "border-gray-600/70 bg-gray-800/70 hover:border-orange-400/35 hover:bg-gray-800",
          isNextUpcoming && scheduleUpNextBorderClassName,
          isPast && !hasPlan && !planStatusLoading && "opacity-55",
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
          {planStatusLoading ? (
            <span
              className="size-3 shrink-0 animate-pulse rounded-sm bg-white/10"
              aria-hidden
            />
          ) : hasPlan ? (
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
        {serviceName ? (
          <span
            className="mt-1 truncate text-left text-[11px] font-medium text-gray-300"
            title={serviceName}
          >
            {serviceName}
          </span>
        ) : null}
      </Button>
    </li>
  );
};

/**
 * Plans list: pick a date for a service and jump straight into building or
 * editing its order-of-service — no service/date-range/occurrence dropdown
 * gauntlet first. Matches the "list of plans, click one" simplicity of
 * Planning Center's Plans tab, which many users will already know.
 */
const TeamsPlansPage = () => {
  const { churchId, canEditServices, canEditTeams: canEditTeamsFromContext } =
    useContext(GlobalInfoContext) || {};
  const {
    pageData,
    canEditTeams,
    servicePlansRevision,
    upsertData,
    hydrateSchedules,
    hydratingScheduleIds,
    trackTeamsSave,
  } = useTeamsPage();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const initialRange = useMemo(() => defaultRange(), []);
  const [windowStart, setWindowStart] = useState(initialRange.start);
  const [windowEnd, setWindowEnd] = useState(initialRange.end);
  const [rangePreset, setRangePreset] = useState<RangePreset>("thisMonth");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [organizeMode, setOrganizeMode] = useState<OccurrenceOrganizeMode>(
    readPlansOrganizeMode,
  );
  const [filtersHydratedForChurchId, setFiltersHydratedForChurchId] = useState<string | null>(null);
  const [planKeysWithPlans, setPlanKeysWithPlans] = useState<Set<string>>(new Set());
  // Mild placeholders for planned chips / progress / checks until listServicePlans
  // resolves. Stays false on revision refreshes so badges do not flash.
  const [planStatusLoading, setPlanStatusLoading] = useState(Boolean(churchId));
  const [microphones, setMicrophones] = useState<ServicePlanMicrophone[]>([]);
  const [savingMicrophoneSlot, setSavingMicrophoneSlot] = useState<string | null>(null);
  const planStatusChurchIdRef = useRef<string | null>(null);
  const [selection, setSelection] = useState<{
    service: TeamService;
    occurrence: TeamScheduleOccurrence;
  } | null>(null);
  const [pendingPlanRestore, setPendingPlanRestore] =
    useState<TeamsPlansRestore | null>(null);
  const [openServingTabOnSelection, setOpenServingTabOnSelection] = useState(false);
  const [servingPanelOpen, setServingPanelOpen] = useState(true);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  useEffect(() => {
    if (!churchId || filtersHydratedForChurchId === churchId) return;
    const preferences = readPlansFilterPreferences(churchId);
    if (preferences) {
      setSelectedServiceIds(preferences.serviceIds);
      setOrganizeMode(preferences.organizeMode);
      setRangePreset(preferences.rangePreset);
      if (preferences.rangePreset === "custom") {
        setWindowStart(preferences.customStartDate || initialRange.start);
        setWindowEnd(preferences.customEndDate || initialRange.end);
      } else {
        const restoredRange = rangeFromPreset(preferences.rangePreset);
        setWindowStart(restoredRange.start);
        setWindowEnd(restoredRange.end);
      }
    } else {
      setSelectedServiceIds([]);
      setOrganizeMode(readPlansOrganizeMode());
      setRangePreset("thisMonth");
      setWindowStart(initialRange.start);
      setWindowEnd(initialRange.end);
    }
    setFiltersHydratedForChurchId(churchId);
  }, [churchId, filtersHydratedForChurchId, initialRange.end, initialRange.start]);

  // Coming back from a schedule the user opened out of "Who's serving".
  useTeamsRestoreOnMount({ onPlansRestore: setPendingPlanRestore });

  useEffect(() => {
    if (!churchId) {
      setMicrophones([]);
      return;
    }
    let cancelled = false;
    getServicePlanMicrophones(churchId)
      .then((result) => {
        if (!cancelled) setMicrophones(result.microphones);
      })
      .catch(() => {
        // Mic allocation remains optional; plans still work without the catalog.
      });
    return () => {
      cancelled = true;
    };
  }, [churchId]);

  const saveScheduledMicrophones = async (
    row: TeamsAssignmentSummaryRow,
    microphoneIds: string[],
  ) => {
    if (!churchId || !row.scheduleId) return;
    setSavingMicrophoneSlot(teamMicrophoneSlotKey(row));
    try {
      // Success feedback is the toolbar Syncing → Synced chip via trackTeamsSave.
      const result = await trackTeamsSave(
        updateTeamScheduleAssignmentMicrophones(
          churchId,
          row.scheduleId,
          {
            serviceId: row.occurrenceId,
            positionSlotKey: row.columnKey,
            microphoneIds,
          },
        ),
      );
      upsertData("schedules", "scheduleId", result.schedule);
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not update team microphones.");
    } finally {
      setSavingMicrophoneSlot(null);
    }
  };

  useEffect(() => {
    if (!pendingPlanRestore || !pageData.services.length) return;
    const { occurrenceId, date } = pendingPlanRestore;
    setPendingPlanRestore(null);
    // Regenerate around the plan's own date rather than the current range, so
    // the plan reopens even if the user had a narrower window selected. The
    // ±1 day margin covers occurrences whose UTC date differs from their local
    // one; the occurrence id match keeps the extra days harmless.
    const match = generateScheduleOccurrences({
      services: pageData.services,
      serviceIds: pageData.services.map((service) => service.serviceId),
      startDate: shiftPlainDate(date, -1),
      endDate: shiftPlainDate(date, 1),
    }).find((occurrence) => occurrence.occurrenceId === occurrenceId);
    if (!match) return;
    const service = pageData.services.find(
      (item) => item.serviceId === match.serviceId,
    );
    if (!service) return;
    setOpenServingTabOnSelection(true);
    setSelection({ service, occurrence: match });
    // Keep the list behind the editor showing this plan once the user backs out.
    if (date < windowStart) {
      setWindowStart(date);
      setRangePreset("custom");
    }
    if (date > windowEnd) {
      setWindowEnd(date);
      setRangePreset("custom");
    }
  }, [pendingPlanRestore, pageData.services, windowStart, windowEnd]);

  useEffect(() => {
    if (!churchId) {
      planStatusChurchIdRef.current = null;
      setPlanKeysWithPlans(new Set());
      setPlanStatusLoading(false);
      return;
    }
    let cancelled = false;
    const isNewChurch = planStatusChurchIdRef.current !== churchId;
    if (isNewChurch) {
      setPlanStatusLoading(true);
      // Drop the previous church's badges; skip the empty initial mount set.
      if (planStatusChurchIdRef.current !== null) {
        setPlanKeysWithPlans(new Set());
      }
    }
    listServicePlans(churchId)
      .then((res) => {
        if (cancelled) return;
        setPlanKeysWithPlans(
          new Set(res.servicePlans.map((plan) => plan.planKey)),
        );
        planStatusChurchIdRef.current = churchId;
      })
      .catch(() => {
        if (cancelled) return;
        // Settle without badges rather than spinning forever.
        planStatusChurchIdRef.current = churchId;
      })
      .finally(() => {
        if (!cancelled) setPlanStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // servicePlansRevision changes when another admin saves/deletes a plan, so
    // the "Add plan"/"Open plan" badges refresh instead of going stale.
  }, [churchId, servicePlansRevision]);

  const activeServices = useMemo(
    () => pageData.services.filter(isActive),
    [pageData.services],
  );

  useEffect(() => {
    if (!churchId || filtersHydratedForChurchId !== churchId) return;
    const activeServiceIds = new Set(activeServices.map((service) => service.serviceId));
    const validServiceIds = selectedServiceIds.filter((id) => activeServiceIds.has(id));
    if (validServiceIds.length !== selectedServiceIds.length) {
      setSelectedServiceIds(validServiceIds);
      return;
    }
    writePlansFilterPreferences(churchId, {
      serviceIds: selectedServiceIds,
      organizeMode,
      rangePreset,
      ...(rangePreset === "custom"
        ? { customStartDate: windowStart, customEndDate: windowEnd }
        : {}),
    });
  }, [
    activeServices,
    churchId,
    filtersHydratedForChurchId,
    organizeMode,
    rangePreset,
    selectedServiceIds,
    windowEnd,
    windowStart,
  ]);

  const groups: ServiceGroup[] = useMemo(() => {
    const activeServiceIds = new Set(
      activeServices.map((service) => service.serviceId),
    );
    // Generate against every service (not just active ones) so a combined
    // group still merges correctly even if one member happens to be inactive
    // — matches generateScheduleOccurrences' own grouping requirements.
    const occurrences = generateScheduleOccurrences({
      services: pageData.services,
      serviceIds: pageData.services.map((service) => service.serviceId),
      startDate: windowStart,
      endDate: windowEnd,
    });

    const order: string[] = [];
    const byKey = new Map<string, ServiceGroup>();
    for (const occurrence of occurrences) {
      const memberServiceIds = occurrence.serviceIds || [occurrence.serviceId];
      // Only surface a section if at least one member service is active.
      if (!memberServiceIds.some((id) => activeServiceIds.has(id))) continue;
      const representative = pageData.services.find(
        (service) => service.serviceId === occurrence.serviceId,
      );
      if (!representative) continue;

      // A combined occurrence's serviceIds includes every member service, so
      // keying by the shared group (rather than by each member individually)
      // is what keeps it from rendering once per member service below.
      const key = occurrence.groupId
        ? `group:${occurrence.groupId}`
        : occurrence.serviceId;
      const existing = byKey.get(key);
      if (existing) {
        existing.occurrences.push(occurrence);
        continue;
      }
      order.push(key);
      byKey.set(key, {
        key,
        name: occurrence.name,
        service: representative,
        serviceIds: memberServiceIds,
        occurrences: [occurrence],
      });
    }
    return order.map((key) => byKey.get(key) as ServiceGroup);
  }, [activeServices, pageData.services, windowStart, windowEnd]);

  const visibleGroups = useMemo(
    () =>
      selectedServiceIds.length === 0
        ? groups
        : groups.filter((group) =>
          group.serviceIds.some((serviceId) => selectedServiceIds.includes(serviceId)),
        ),
    [groups, selectedServiceIds],
  );

  const showOrganizeToggle = activeServices.length > 1;

  /** Effective organize mode — single-service lists are identical either way. */
  const effectiveOrganizeMode: OccurrenceOrganizeMode =
    showOrganizeToggle ? organizeMode : "byService";

  const changeOrganizeMode = (mode: OccurrenceOrganizeMode) => {
    setOrganizeMode(mode);
    writePlansOrganizeMode(mode);
  };

  /**
   * Chronological sequence across visible services — used for by-date tiles and
   * for prev/next when browsing in date order.
   */
  const chronologicalEntries = useMemo(() => {
    const entries = visibleGroups.flatMap((group) =>
      group.occurrences.map((occurrence) => ({
        service: group.service,
        serviceName: group.name,
        occurrence,
      })),
    );
    return entries.sort(
      (a, b) =>
        new Date(a.occurrence.startsAt).getTime() -
        new Date(b.occurrence.startsAt).getTime() ||
        a.serviceName.localeCompare(b.serviceName),
    );
  }, [visibleGroups]);

  const chronologicalMonths = useMemo(
    () =>
      groupOccurrencesByMonth(
        chronologicalEntries.map((entry) => entry.occurrence),
      ),
    [chronologicalEntries],
  );

  const chronologicalPlannedCount = useMemo(
    () =>
      chronologicalEntries.filter((entry) =>
        planKeysWithPlans.has(getServicePlanKey(entry.occurrence)),
      ).length,
    [chronologicalEntries, planKeysWithPlans],
  );

  const entryByOccurrenceId = useMemo(() => {
    const map = new Map<
      string,
      { service: TeamService; serviceName: string; occurrence: TeamScheduleOccurrence }
    >();
    for (const entry of chronologicalEntries) {
      map.set(entry.occurrence.occurrenceId, entry);
    }
    return map;
  }, [chronologicalEntries]);

  const nextUpcomingOccurrenceId = useMemo(
    () =>
      findNextUpcomingOccurrenceId(
        chronologicalEntries.map((entry) => entry.occurrence),
      ),
    [chronologicalEntries],
  );

  const serviceFilterOptions = useMemo(
    () => activeServices.map((service) => ({
      label: service.name,
      value: service.serviceId,
    })),
    [activeServices],
  );

  const serviceFilterLabel = useMemo(() => {
    if (selectedServiceIds.length === 0) return "All services";
    if (selectedServiceIds.length === 1) {
      return serviceFilterOptions.find(
        (option) => option.value === selectedServiceIds[0],
      )?.label ?? "1 service";
    }
    return `${selectedServiceIds.length} services selected`;
  }, [selectedServiceIds, serviceFilterOptions]);

  const applyPreset = (preset: Exclude<RangePreset, "custom">) => {
    const next = rangeFromPreset(preset);
    setWindowStart(next.start);
    setWindowEnd(next.end);
    setRangePreset(preset);
  };

  const setCustomRange = ({
    startDate,
    endDate,
  }: {
    startDate: string;
    endDate: string;
  }) => {
    setWindowStart(startDate);
    setWindowEnd(endDate);
    setRangePreset("custom");
  };

  /**
   * Open the schedule behind this plan, focused on one slot when given. The
   * returnTo lands the user back on this same plan when they're done.
   */
  const openSchedule = useCallback(
    ({
      scheduleId,
      slot,
    }: {
      scheduleId: string;
      slot?: { occurrenceId: string; columnKey: string };
    }) => {
      if (!selection) return;
      const returnTo = buildPlansReturnTo({
        serviceId: selection.service.serviceId,
        occurrenceId: selection.occurrence.occurrenceId,
        date: getOccurrenceDate(selection.occurrence),
      });
      persistTeamsReturnTo(returnTo, TEAMS_SECTION_PATHS.schedules);
      navigate(TEAMS_SECTION_PATHS.schedules, {
        state: buildPlanToScheduleNavigationState({
          returnTo,
          restore: {
            kind: "schedule",
            scheduleId,
            ...(slot ? { activeSlot: slot, slotPickerMode: "assign" as const } : {}),
          },
        }),
      });
    },
    [navigate, selection],
  );

  /**
   * Previous/next within the current date window. By service stays on that
   * series; by date walks the mixed chronological sequence.
   */
  const planNavigation = useMemo(() => {
    if (!selection) return undefined;

    if (effectiveOrganizeMode === "byDate") {
      const index = chronologicalEntries.findIndex(
        (entry) =>
          entry.occurrence.occurrenceId === selection.occurrence.occurrenceId,
      );
      if (index < 0) return undefined;
      const previous = chronologicalEntries[index - 1];
      const next = chronologicalEntries[index + 1];
      return {
        onPrevious: previous
          ? () =>
            setSelection({
              service: previous.service,
              occurrence: previous.occurrence,
            })
          : undefined,
        onNext: next
          ? () =>
            setSelection({
              service: next.service,
              occurrence: next.occurrence,
            })
          : undefined,
      };
    }

    const group = visibleGroups.find((entry) =>
      entry.occurrences.some(
        (occurrence) =>
          occurrence.occurrenceId === selection.occurrence.occurrenceId,
      ),
    );
    if (!group) return undefined;
    const index = group.occurrences.findIndex(
      (occurrence) =>
        occurrence.occurrenceId === selection.occurrence.occurrenceId,
    );
    if (index < 0) return undefined;
    const previous = group.occurrences[index - 1];
    const next = group.occurrences[index + 1];
    return {
      onPrevious: previous
        ? () => setSelection({ service: group.service, occurrence: previous })
        : undefined,
      onNext: next
        ? () => setSelection({ service: group.service, occurrence: next })
        : undefined,
    };
  }, [chronologicalEntries, effectiveOrganizeMode, selection, visibleGroups]);

  /**
   * Schedules covering the open plan's date whose assignments the bootstrap
   * left out. The plan can sit outside the bootstrap's hydration window, and
   * every "who's serving" read here filters summaries away — which renders as
   * an empty roster, indistinguishable from nobody being scheduled.
   */
  const unloadedScheduleIds = useMemo(
    () =>
      selection
        ? getUnhydratedOccurrenceScheduleIds(
          selection.occurrence,
          pageData.schedules,
        )
        : [],
    [pageData.schedules, selection],
  );

  useEffect(() => {
    if (!unloadedScheduleIds.length) return;
    void hydrateSchedules(unloadedScheduleIds);
  }, [hydrateSchedules, unloadedScheduleIds]);

  if (selection) {
    const assignments = getOccurrenceAssignmentSummary({
      occurrence: selection.occurrence,
      schedules: onlyHydratedSchedules(pageData.schedules),
      positions: pageData.positions,
      members: pageData.members,
      teams: pageData.teams,
      services: pageData.services,
    });
    const assignmentTeams = groupAssignmentSummaryByTeam(
      assignments,
      onlyHydratedSchedules(pageData.schedules),
    );
    // Schedules covering this date that the bootstrap only summarized are being
    // fetched (see the effect above). Until they land, the panel must say so
    // rather than show a roster that reads as "nobody is scheduled".
    const assignmentsStatus = unloadedScheduleIds.length === 0
      ? "ready"
      : unloadedScheduleIds.some((scheduleId) =>
        hydratingScheduleIds.includes(scheduleId))
        ? "loading"
        : "unavailable";
    const scheduledMicrophoneHolders = getScheduledMicrophoneHolders(
      assignments,
      pageData.teams,
    );
    const canEditPlan = Boolean(
      canEditServices ?? canEditTeamsFromContext ?? canEditTeams,
    );

    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:gap-3">
        <div className="flex w-full min-h-0 min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-4">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ServicePlanEditor
              service={selection.service}
              occurrence={selection.occurrence}
              members={pageData.members}
              positions={pageData.positions}
              teams={pageData.teams}
              scheduledMicrophoneHolders={scheduledMicrophoneHolders}
              teamMicrophones={{
                rows: assignments,
                assignmentsStatus,
                savingSlot: savingMicrophoneSlot,
                onChange: (row, microphoneIds) => {
                  void saveScheduledMicrophones(row, microphoneIds);
                },
              }}
              canEdit={canEditPlan}
              onBack={() => {
                setOpenServingTabOnSelection(false);
                setSelection(null);
              }}
              planNavigation={planNavigation}
              initialTab={openServingTabOnSelection ? "serving" : "plan"}
              mobileServingContent={
                !isDesktop ? (
                  <WhosServingPanel
                    assignmentTeams={assignmentTeams}
                    onOpenSchedule={openSchedule}
                    microphones={microphones}
                    assignmentsStatus={assignmentsStatus}
                    showHeading={false}
                  />
                ) : undefined
              }
            />
          </div>
          {isDesktop ? (
            <aside
              className={cn(
                "relative min-h-0 shrink-0 flex-col self-stretch rounded-xl border border-gray-700/80 bg-gray-950/70 transition-[width] duration-300 ease-in-out lg:flex",
                servingPanelOpen ? "w-64" : "w-10",
              )}
              aria-label="Who's serving"
            >
              <Button
                type="button"
                variant="tertiary"
                padding="p-0"
                className="absolute left-0 top-1/2 z-20 flex size-8 min-h-0 max-md:min-h-0 shrink-0 items-center justify-center -translate-x-1/2 -translate-y-1/2 rounded-full border border-gray-700 bg-gray-950 shadow-sm"
                aria-expanded={servingPanelOpen}
                aria-label={
                  servingPanelOpen ? "Hide serving panel" : "Show serving panel"
                }
                onClick={() => setServingPanelOpen((open) => !open)}
              >
                {servingPanelOpen ? (
                  <ChevronRight className="size-4 shrink-0" aria-hidden />
                ) : (
                  <ChevronLeft className="size-4 shrink-0" aria-hidden />
                )}
              </Button>
              {servingPanelOpen ? (
                <div className="scrollbar-variable flex min-h-0 w-full flex-1 flex-col gap-2 overflow-y-auto p-3">
                  <WhosServingPanel
                    assignmentTeams={assignmentTeams}
                    onOpenSchedule={openSchedule}
                    microphones={microphones}
                    assignmentsStatus={assignmentsStatus}
                  />
                </div>
              ) : (
                <div className="flex h-full w-10 flex-col items-center py-3">
                  <Icon
                    svg={Users}
                    size="sm"
                    className="text-orange-300"
                    alt="Who's serving"
                  />
                </div>
              )}
            </aside>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="scrollbar-variable flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="shrink-0 space-y-4">
        <div className="flex items-center gap-2">
          <Icon svg={CalendarRange} size="md" className="text-orange-300" />
          <h2 className="text-lg font-semibold">Plans</h2>
        </div>
        <p className="text-sm text-gray-400">
          Pick a date to build or edit that service&apos;s order of service.
        </p>

        <div className="rounded-lg border border-gray-700/80 bg-gray-900/35 p-3">
          <div className="grid items-end gap-3 md:grid-cols-[minmax(12rem,14rem)_auto_minmax(0,1fr)]">
            {activeServices.length > 1 ? (
              <div className="min-w-0">
                <span className="block p-1 text-sm font-semibold">Service:</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="tertiary"
                      aria-label="Service filter"
                      aria-haspopup="dialog"
                      className="w-full justify-between bg-neutral-900 text-left text-sm text-neutral-100"
                    >
                      <span className="truncate">{serviceFilterLabel}</span>
                      <span aria-hidden className="ml-2 text-gray-400">▾</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[min(20rem,calc(100vw-2rem))] border-gray-700 bg-gray-900 p-2 text-gray-100"
                  >
                    <fieldset aria-label="Services" className="space-y-1">
                      <Checkbox
                        label="All services"
                        checked={selectedServiceIds.length === 0}
                        onCheckedChange={() => setSelectedServiceIds([])}
                        className="rounded px-2 py-1.5"
                      />
                      {serviceFilterOptions.map((option) => (
                        <Checkbox
                          key={option.value}
                          label={option.label}
                          checked={selectedServiceIds.includes(option.value)}
                          onCheckedChange={() => {
                            setSelectedServiceIds((current) =>
                              current.includes(option.value)
                                ? current.filter((id) => id !== option.value)
                                : [...current, option.value],
                            );
                          }}
                          className="rounded px-2 py-1.5"
                        />
                      ))}
                    </fieldset>
                  </PopoverContent>
                </Popover>
              </div>
            ) : null}

            {showOrganizeToggle ? (
              <div className="flex flex-col gap-1.5 rounded-md border border-gray-700/80 bg-gray-900/70 px-2.5 py-2">
                <span className="px-0.5 text-sm font-semibold">Organize</span>
                <SegmentedControl
                  ariaLabel="Organize plans"
                  variant="compact"
                  value={organizeMode}
                  onChange={changeOrganizeMode}
                  options={OCCURRENCE_ORGANIZE_OPTIONS}
                />
              </div>
            ) : null}

            <div className="min-w-0 rounded-md border border-gray-700/80 bg-gray-900/70 px-2.5 py-2">
              <div className="flex flex-col gap-1.5">
                <span className="px-0.5 text-sm font-semibold">Range</span>
                <div
                  className="flex flex-wrap gap-1.5"
                  role="group"
                  aria-label="Date range presets"
                >
                  <Button
                    type="button"
                    variant="tertiary"
                    isSelected={rangePreset === "thisMonth"}
                    className={cn(
                      "text-xs",
                      rangePreset === "thisMonth" &&
                      "border border-cyan-500/50 bg-cyan-950/40 text-cyan-100",
                    )}
                    onClick={() => applyPreset("thisMonth")}
                  >
                    This month
                  </Button>
                  <Button
                    type="button"
                    variant="tertiary"
                    isSelected={rangePreset === "nextMonth"}
                    className={cn(
                      "text-xs",
                      rangePreset === "nextMonth" &&
                      "border border-cyan-500/50 bg-cyan-950/40 text-cyan-100",
                    )}
                    onClick={() => applyPreset("nextMonth")}
                  >
                    Next month
                  </Button>
                  <Button
                    type="button"
                    variant="tertiary"
                    isSelected={rangePreset === "thisQuarter"}
                    className={cn(
                      "text-xs",
                      rangePreset === "thisQuarter" &&
                      "border border-cyan-500/50 bg-cyan-950/40 text-cyan-100",
                    )}
                    onClick={() => applyPreset("thisQuarter")}
                  >
                    This quarter
                  </Button>
                  <Button
                    type="button"
                    variant="tertiary"
                    isSelected={rangePreset === "nextQuarter"}
                    className={cn(
                      "text-xs",
                      rangePreset === "nextQuarter" &&
                      "border border-cyan-500/50 bg-cyan-950/40 text-cyan-100",
                    )}
                    onClick={() => applyPreset("nextQuarter")}
                  >
                    Next quarter
                  </Button>
                  <Button
                    type="button"
                    variant="tertiary"
                    isSelected={rangePreset === "custom"}
                    className={cn(
                      "text-xs",
                      rangePreset === "custom" &&
                      "border border-cyan-500/50 bg-cyan-950/40 text-cyan-100",
                    )}
                    onClick={() => setRangePreset("custom")}
                  >
                    Custom
                  </Button>
                </div>
                <p className="px-0.5 text-xs text-gray-400">
                  {formatRangeDate(windowStart)} – {formatRangeDate(windowEnd)}
                </p>
                {rangePreset === "custom" ? (
                  <DateRangePicker
                    label="Date range"
                    hideLabel
                    value={{ startDate: windowStart, endDate: windowEnd }}
                    onChange={setCustomRange}
                    className="w-full max-w-xs"
                    inputClassName="py-1 text-xs"
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-gray-400">
          No services occur in this date range. Add a service or widen the range
          above.
        </p>
      ) : visibleGroups.length === 0 ? (
        <p className="text-sm text-gray-400">
          No dates for this service in the selected range. Choose another
          service or widen the range.
        </p>
      ) : effectiveOrganizeMode === "byDate" ? (
        <div
          className="space-y-4 rounded-xl border border-gray-700/80 bg-gray-950/80 pt-3 shadow-sm shadow-black/20"
          {...(planStatusLoading
            ? {
              role: "status" as const,
              "aria-busy": true,
              "aria-label": "Loading plan status",
            }
            : {})}
        >
          <header className="space-y-3 border-b border-gray-800 px-3.5 pb-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-orange-400/25 bg-orange-400/10">
                <Icon
                  svg={CalendarDays}
                  size="sm"
                  className="text-orange-300"
                />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-semibold text-gray-50">
                  {serviceFilterLabel}
                </h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-md border border-gray-700 bg-gray-900/70 px-1.5 py-0.5 text-[11px] font-medium text-gray-300">
                    {chronologicalEntries.length === 1
                      ? "1 date"
                      : `${chronologicalEntries.length} dates`}
                  </span>
                  {planStatusLoading ? (
                    <span
                      className="inline-block h-[22px] w-[5.5rem] animate-pulse rounded-md bg-white/10"
                      aria-hidden
                    />
                  ) : (
                    <span
                      className={cn(
                        "rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                        chronologicalPlannedCount > 0
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                          : "border-gray-700 bg-gray-900/70 text-gray-400",
                      )}
                    >
                      {chronologicalPlannedCount === 0
                        ? "None planned"
                        : `${chronologicalPlannedCount} planned`}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </header>

          <div className="space-y-4 bg-black/20 p-3">
            {chronologicalMonths.map((month) => (
              <div key={month.key} className="space-y-2">
                <div className="flex items-center gap-2 px-0.5">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                    {month.label}
                  </h4>
                  <div className="h-px flex-1 bg-gray-800" aria-hidden />
                  <span className="text-[11px] text-gray-500">
                    {month.occurrences.length}
                  </span>
                </div>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {month.occurrences.map((occurrence) => {
                    const entry = entryByOccurrenceId.get(
                      occurrence.occurrenceId,
                    );
                    if (!entry) return null;
                    const hasPlan =
                      !planStatusLoading &&
                      planKeysWithPlans.has(getServicePlanKey(occurrence));
                    const isPast =
                      getOccurrenceDate(occurrence) <
                      formatPlainDate(new Date());
                    return (
                      <PlansOccurrenceTile
                        key={occurrence.occurrenceId}
                        occurrence={occurrence}
                        shared={BY_DATE_TILE_SHARED}
                        serviceName={
                          selectedServiceIds.length !== 1
                            ? entry.serviceName
                            : undefined
                        }
                        hasPlan={hasPlan}
                        isPast={isPast}
                        isNextUpcoming={
                          occurrence.occurrenceId === nextUpcomingOccurrenceId
                        }
                        planStatusLoading={planStatusLoading}
                        onOpen={() => {
                          setOpenServingTabOnSelection(false);
                          setSelection({
                            service: entry.service,
                            occurrence,
                          });
                        }}
                      />
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          className={cn(
            // Top padding leaves room for the absolute "Up next" badge so the
            // Plans scrollport does not clip it (same pattern as schedule board).
            "grid grid-cols-1 items-start gap-4 pt-3",
            visibleGroups.length > 1 && "xl:grid-cols-2 2xl:grid-cols-3",
          )}
          {...(planStatusLoading
            ? {
              role: "status" as const,
              "aria-busy": true,
              "aria-label": "Loading plan status",
            }
            : {})}
        >
          {visibleGroups.map(({ key, name, service, occurrences }) => {
            const shared = getSharedOccurrenceTiming(occurrences);
            const plannedCount = occurrences.filter((occurrence) =>
              planKeysWithPlans.has(getServicePlanKey(occurrence)),
            ).length;
            const months = groupOccurrencesByMonth(occurrences);
            const timingLabel = serviceTimingLabel(shared);
            const plannedRatio =
              occurrences.length === 0 ? 0 : plannedCount / occurrences.length;

            return (
              <section
                key={key}
                className="min-h-min rounded-xl border border-gray-700/80 bg-gray-950/80 shadow-sm shadow-black/20"
              >
                <header className="space-y-3 border-b border-gray-800 px-3.5 py-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-orange-400/25 bg-orange-400/10">
                      <Icon
                        svg={CalendarDays}
                        size="sm"
                        className="text-orange-300"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-base font-semibold text-gray-50">
                        {name}
                      </h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-md border border-gray-700 bg-gray-900/70 px-1.5 py-0.5 text-[11px] font-medium text-gray-300">
                          {occurrences.length === 1
                            ? "1 date"
                            : `${occurrences.length} dates`}
                        </span>
                        {planStatusLoading ? (
                          <span
                            className="inline-block h-[22px] w-[5.5rem] animate-pulse rounded-md bg-white/10"
                            aria-hidden
                          />
                        ) : (
                          <span
                            className={cn(
                              "rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                              plannedCount > 0
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                : "border-gray-700 bg-gray-900/70 text-gray-400",
                            )}
                          >
                            {plannedCount === 0
                              ? "None planned"
                              : `${plannedCount} planned`}
                          </span>
                        )}
                        {timingLabel ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-100/90">
                            <Icon
                              svg={Clock}
                              size="xs"
                              className="text-amber-300"
                            />
                            {timingLabel}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "h-1 overflow-hidden rounded-full bg-gray-800",
                      planStatusLoading && "animate-pulse",
                    )}
                    aria-hidden
                  >
                    {planStatusLoading ? (
                      <div className="h-full w-2/5 rounded-full bg-white/10" />
                    ) : (
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width]",
                          plannedCount > 0
                            ? "bg-emerald-400/80"
                            : "bg-transparent",
                        )}
                        style={{
                          width: `${Math.round(plannedRatio * 100)}%`,
                        }}
                      />
                    )}
                  </div>
                </header>

                <div className="space-y-4 bg-black/20 p-3">
                  {months.map((month) => (
                    <div key={month.key} className="space-y-2">
                      <div className="flex items-center gap-2 px-0.5">
                        <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                          {month.label}
                        </h4>
                        <div className="h-px flex-1 bg-gray-800" aria-hidden />
                        <span className="text-[11px] text-gray-500">
                          {month.occurrences.length}
                        </span>
                      </div>
                      <ul
                        className={cn(
                          "grid grid-cols-2 gap-2 sm:grid-cols-3",
                          visibleGroups.length > 1
                            ? "xl:grid-cols-2 2xl:grid-cols-3"
                            : "lg:grid-cols-4 xl:grid-cols-5",
                        )}
                      >
                        {month.occurrences.map((occurrence) => {
                          const hasPlan =
                            !planStatusLoading &&
                            planKeysWithPlans.has(
                              getServicePlanKey(occurrence),
                            );
                          const isPast =
                            getOccurrenceDate(occurrence) <
                            formatPlainDate(new Date());
                          return (
                            <PlansOccurrenceTile
                              key={occurrence.occurrenceId}
                              occurrence={occurrence}
                              shared={shared}
                              hasPlan={hasPlan}
                              isPast={isPast}
                              isNextUpcoming={
                                occurrence.occurrenceId ===
                                nextUpcomingOccurrenceId
                              }
                              planStatusLoading={planStatusLoading}
                              onOpen={() => {
                                setOpenServingTabOnSelection(false);
                                setSelection({ service, occurrence });
                              }}
                            />
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TeamsPlansPage;
