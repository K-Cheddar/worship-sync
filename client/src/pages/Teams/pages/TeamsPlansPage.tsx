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
import Icon from "../../../components/Icon/Icon";
import Select from "../../../components/Select/Select";
import DatePicker from "@/components/ui/DatePicker";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { GlobalInfoContext } from "../../../context/globalInfo";
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

type RangePreset = "4w" | "8w" | "custom";

const ALL_SERVICES = "all";

const rangeFromPreset = (preset: "4w" | "8w") => {
  const start = new Date();
  start.setDate(start.getDate() - 7);
  const end = new Date();
  end.setDate(end.getDate() + (preset === "4w" ? 28 : 56));
  return {
    start: formatPlainDate(start),
    end: formatPlainDate(end),
  };
};

const defaultRange = () => rangeFromPreset("4w");

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
  const [rangePreset, setRangePreset] = useState<RangePreset>("4w");
  const [serviceFilter, setServiceFilter] = useState(ALL_SERVICES);
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
  // Mobile: Who's serving opens in a sheet so the plan keeps the full viewport.
  // Desktop keeps the side panel. Opening from the list leaves the sheet closed;
  // returning from a schedule deep-link reopens it.
  const [servingSheetOpen, setServingSheetOpen] = useState(false);
  const [servingPanelOpen, setServingPanelOpen] = useState(true);

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
    setSelection({ service, occurrence: match });
    setServingSheetOpen(true);
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
      serviceFilter === ALL_SERVICES
        ? groups
        : groups.filter((group) => group.serviceIds.includes(serviceFilter)),
    [groups, serviceFilter],
  );

  const nextUpcomingOccurrenceId = useMemo(
    () =>
      findNextUpcomingOccurrenceId(
        visibleGroups.flatMap((group) => group.occurrences),
      ),
    [visibleGroups],
  );

  const serviceFilterOptions = useMemo(
    () => [
      { label: "All services", value: ALL_SERVICES },
      ...activeServices.map((service) => ({
        label: service.name,
        value: service.serviceId,
      })),
    ],
    [activeServices],
  );

  const applyPreset = (preset: "4w" | "8w") => {
    const next = rangeFromPreset(preset);
    setWindowStart(next.start);
    setWindowEnd(next.end);
    setRangePreset(preset);
  };

  const setCustomStart = (value: string) => {
    setWindowStart(value);
    setRangePreset("custom");
  };

  const setCustomEnd = (value: string) => {
    setWindowEnd(value);
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
      navigate(TEAMS_SECTION_PATHS.schedules, {
        state: buildPlanToScheduleNavigationState({
          returnTo: buildPlansReturnTo({
            serviceId: selection.service.serviceId,
            occurrenceId: selection.occurrence.occurrenceId,
            date: getOccurrenceDate(selection.occurrence),
          }),
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
   * Previous/next within the same service group and current date window —
   * the same chronological sequence the Plans tiles show for that service.
   */
  const planNavigation = useMemo(() => {
    if (!selection) return undefined;
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
  }, [selection, visibleGroups]);

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
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 sm:p-3 lg:gap-3">
        <div className="flex w-full min-h-0 min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-stretch">
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
                setServingSheetOpen(false);
                setSelection(null);
              }}
              planNavigation={planNavigation}
              headerActions={
                <Button
                  type="button"
                  variant="secondary"
                  svg={Users}
                  iconSize="sm"
                  className="max-md:min-h-0 lg:hidden"
                  aria-label="Who's serving"
                  aria-haspopup="dialog"
                  onClick={() => setServingSheetOpen(true)}
                />
              }
            />
          </div>
          <aside
            className={cn(
              "relative hidden min-h-0 shrink-0 flex-col self-stretch rounded-xl border border-gray-700/80 bg-gray-950/70 transition-[width] duration-300 ease-in-out lg:flex",
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
        </div>

        <Sheet open={servingSheetOpen} onOpenChange={setServingSheetOpen}>
          <SheetContent
            side="right"
            className="flex w-full max-w-sm flex-col border-gray-700 bg-gray-950/95 p-0"
            aria-describedby={undefined}
          >
            <SheetHeader className="border-b border-gray-800">
              <SheetTitle>Who&apos;s serving</SheetTitle>
            </SheetHeader>
            <div className="scrollbar-variable flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
              <WhosServingPanel
                assignmentTeams={assignmentTeams}
                onOpenSchedule={openSchedule}
                microphones={microphones}
                assignmentsStatus={assignmentsStatus}
                showHeading={false}
              />
            </div>
          </SheetContent>
        </Sheet>
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

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            {activeServices.length > 1 ? (
              <Select
                label="Service"
                className="w-full sm:w-56"
                value={serviceFilter}
                onChange={setServiceFilter}
                options={serviceFilterOptions}
              />
            ) : null}

            <div className="flex flex-col gap-1.5">
              <span className="px-1 text-sm font-semibold">Range</span>
              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-label="Date range presets"
              >
                <Button
                  type="button"
                  variant="tertiary"
                  isSelected={rangePreset === "4w"}
                  className={cn(
                    "text-xs",
                    rangePreset === "4w" &&
                    "border border-cyan-500/50 bg-cyan-950/40 text-cyan-100",
                  )}
                  onClick={() => applyPreset("4w")}
                >
                  Next 4 weeks
                </Button>
                <Button
                  type="button"
                  variant="tertiary"
                  isSelected={rangePreset === "8w"}
                  className={cn(
                    "text-xs",
                    rangePreset === "8w" &&
                    "border border-cyan-500/50 bg-cyan-950/40 text-cyan-100",
                  )}
                  onClick={() => applyPreset("8w")}
                >
                  Next 8 weeks
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
            </div>
          </div>

          {rangePreset === "custom" ? (
            <div className="grid max-w-xl gap-3 sm:grid-cols-2">
              <DatePicker
                label="From"
                value={windowStart}
                onChange={setCustomStart}
              />
              <DatePicker label="To" value={windowEnd} onChange={setCustomEnd} />
            </div>
          ) : null}
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
                          const isNextUpcoming =
                            occurrence.occurrenceId === nextUpcomingOccurrenceId;
                          const tile = getPlansTileParts(occurrence, shared);
                          let planActionLabel = `Add plan for ${tile.label}`;
                          if (planStatusLoading) {
                            planActionLabel = `Plan for ${tile.label}`;
                          } else if (hasPlan) {
                            planActionLabel = `Open plan for ${tile.label}`;
                          }
                          return (
                            <li
                              key={occurrence.occurrenceId}
                              className="relative"
                            >
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
                                onClick={() => {
                                  setServingSheetOpen(false);
                                  setSelection({ service, occurrence });
                                }}
                              >
                                <span className="flex w-full items-center justify-between gap-1">
                                  <span
                                    className={cn(
                                      "text-[11px] font-semibold uppercase tracking-wide",
                                      hasPlan
                                        ? "text-emerald-300/70"
                                        : "text-gray-400",
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
                              </Button>
                            </li>
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
