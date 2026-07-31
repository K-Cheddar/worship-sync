/**
 * Keeps the Controller's service plan in step with the plan the Services page
 * owns, so importing or editing there shows up here without anyone re-pasting a
 * planning URL.
 *
 * Read-only by design. The plan panel refreshes itself, but nothing is written
 * into the live item list or overlays — those stay behind the operator's
 * explicit Sync press, because the outline bridge is insert-only and silently
 * mutating the live list mid-service is exactly the surprise this app can't
 * afford.
 *
 * Degrades to the pasted-URL flow whenever a plan isn't available: guest mode,
 * churches without Teams access, or an occurrence with no plan saved yet. In
 * those cases an existing URL-sourced preview is left untouched.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useDispatch, useSelector } from "../../hooks";
import { getServicePlan, getTeamsBootstrap } from "../../api/auth";
import {
  clearServicePlanningPlanOutline,
  setServicePlanningPlanOutline,
} from "../../store/servicePlanningImportSlice";
import { useServicePlanningImport } from "../../hooks/useServicePlanningImport";
import {
  isServicePlanUpdatedEvent,
  useTeamsLiveSync,
  type TeamsStreamEvent,
} from "../Teams/hooks/useTeamsLiveSync";
import { getOccurrenceAssignmentSummary } from "../Teams/pages/teamsAssignmentsSummary";
import { toServicePlanningTeamAssignments } from "../../integrations/servicePlanning/servicePlanTeamAssignments";
import { getServicePlanKey } from "../../utils/servicePlanKeys";
import { toTeamService } from "../Teams/teamsUtils";
import {
  findCurrentServiceOccurrence,
  listCurrentServiceOccurrences,
} from "./currentServiceWorkspaceUtils";
import type { TeamScheduleOccurrence, TeamsBootstrap } from "../../api/authTypes";
import type { ServicePlan } from "../../types/servicePlan";

/** Re-pick the current service on this cadence; services move in minutes, not
 * seconds, and this ticks on a live surface. */
const OCCURRENCE_REFRESH_MS = 60_000;

export const useCurrentServicePlanSource = () => {
  const dispatch = useDispatch();
  const { canViewTeams, churchId, loginState } =
    useContext(GlobalInfoContext) || {};
  const { loadPlanPreview, isServicePlanningEnabled } =
    useServicePlanningImport();
  const serviceTimes = useSelector(
    (state) => state.undoable.present.serviceTimes.list,
  );
  const servicePlanKey = useSelector(
    (state) => state.servicePlanningImport.servicePlanKey,
  );

  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string | null>(
    null,
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isLoading, setIsLoading] = useState(false);

  const bootstrapRef = useRef<TeamsBootstrap | null>(null);
  const planRef = useRef<ServicePlan | null>(null);
  /** Bumped on every (re)load so a slow response can't overwrite a newer one. */
  const generationRef = useRef(0);
  const loadPlanPreviewRef = useRef(loadPlanPreview);
  useEffect(() => {
    loadPlanPreviewRef.current = loadPlanPreview;
  }, [loadPlanPreview]);

  useEffect(() => {
    const interval = window.setInterval(
      () => setNowMs(Date.now()),
      OCCURRENCE_REFRESH_MS,
    );
    return () => window.clearInterval(interval);
  }, []);

  const services = useMemo(
    () => serviceTimes.map(toTeamService),
    [serviceTimes],
  );
  const occurrences = useMemo(
    () => listCurrentServiceOccurrences(services, nowMs),
    [services, nowMs],
  );
  const currentOccurrence = useMemo(
    () => findCurrentServiceOccurrence(services, nowMs),
    [services, nowMs],
  );
  const occurrence = useMemo(
    () =>
      occurrences.find(
        (candidate) => candidate.occurrenceId === selectedOccurrenceId,
      ) || currentOccurrence,
    [currentOccurrence, occurrences, selectedOccurrenceId],
  );

  const planKey = occurrence ? getServicePlanKey(occurrence) : null;
  const isEnabled = Boolean(
    churchId && canViewTeams && loginState !== "guest" && isServicePlanningEnabled,
  );

  /**
   * Everything below keys off `planKey` — a string — rather than the occurrence
   * or services objects. Those are derived arrays whose identity changes on
   * unrelated store updates, and keying effects on them re-fetched the plan on
   * every such update: needless server load on a live surface. The current
   * values are read through refs instead.
   */
  const occurrenceRef = useRef<TeamScheduleOccurrence | null>(occurrence);
  const servicesRef = useRef(services);
  useEffect(() => {
    occurrenceRef.current = occurrence;
    servicesRef.current = services;
  }, [occurrence, services]);

  /** Rebuilds the preview from an already-fetched plan. Assignments come from
   * the Teams schedule, so they reflect the roster now rather than whatever the
   * planning printout said when the plan was first imported. */
  const applyPlan = useCallback(
    async (plan: ServicePlan) => {
      const bootstrap = bootstrapRef.current;
      const targetOccurrence = occurrenceRef.current;
      const assignments =
        bootstrap && targetOccurrence
          ? toServicePlanningTeamAssignments(
              getOccurrenceAssignmentSummary({
                occurrence: targetOccurrence,
                schedules: bootstrap.schedules || [],
                positions: bootstrap.positions || [],
                members: bootstrap.members || [],
                teams: bootstrap.teams || [],
                services: servicesRef.current,
              }),
            )
          : [];

      const outline = await loadPlanPreviewRef.current(plan, assignments);
      dispatch(
        setServicePlanningPlanOutline({ outline, planKey: plan.planKey }),
      );
    },
    [dispatch],
  );

  useEffect(() => {
    if (!isEnabled || !planKey || !churchId) return;
    generationRef.current += 1;
    const generation = generationRef.current;
    let cancelled = false;
    setIsLoading(true);

    const load = async () => {
      try {
        const [planResult, bootstrap] = await Promise.all([
          getServicePlan(churchId, planKey),
          // Assignments are a nice-to-have; a failed bootstrap must not stop
          // the plan itself from reaching the Controller.
          getTeamsBootstrap(churchId).catch(() => null),
        ]);
        if (cancelled || generation !== generationRef.current) return;
        if (bootstrap) bootstrapRef.current = bootstrap;

        const plan = planResult.servicePlan;
        planRef.current = plan;
        if (!plan) {
          // No plan saved for this service. Drop a stale plan-sourced preview
          // so the previous service's plan can't sit under this service's name
          // — a URL-sourced preview is left alone, since the operator owns it.
          dispatch(clearServicePlanningPlanOutline());
          return;
        }
        await applyPlan(plan);
      } catch (error) {
        // The Controller must stay usable without Teams; the pasted-URL flow is
        // still there, so this is logged rather than surfaced as an error toast.
        console.error("Could not load the current service plan:", error);
      } finally {
        if (!cancelled && generation === generationRef.current) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [applyPlan, churchId, dispatch, isEnabled, planKey]);

  const handleLiveEvent = useCallback(
    (event: TeamsStreamEvent) => {
      if (!isEnabled || !planKey) return;
      // The schedule drives the assignments tab, so a roster change should
      // refresh it too. The plan itself is unchanged; rebuild from what we have.
      if (event.type === "schedule-updated" || event.type === "schedule-removed") {
        if (!churchId || !planRef.current) return;
        void getTeamsBootstrap(churchId)
          .then((bootstrap) => {
            bootstrapRef.current = bootstrap;
            const plan = planRef.current;
            if (plan) return applyPlan(plan);
          })
          .catch(() => {
            // Keep showing the assignments we already have.
          });
        return;
      }

      if (!isServicePlanUpdatedEvent(event)) return;
      if (event.servicePlan.planKey !== planKey) return;
      planRef.current = event.servicePlan;
      // The event carries the whole plan, so this needs no refetch.
      void applyPlan(event.servicePlan);
    },
    [applyPlan, churchId, isEnabled, planKey],
  );

  useTeamsLiveSync(isEnabled ? churchId : null, handleLiveEvent);

  const refresh = useCallback(async () => {
    if (!isEnabled || !planKey || !churchId) return;
    const result = await getServicePlan(churchId, planKey);
    const plan = result.servicePlan;
    if (!plan) return;
    planRef.current = plan;
    await applyPlan(plan);
  }, [applyPlan, churchId, isEnabled, planKey]);

  /**
   * SSE is single-instance and absent in some runtimes, so a missed event would
   * otherwise leave a stale plan on screen until reload. Re-reading on focus is
   * the cheap self-heal: an operator returning to the window gets the truth.
   */
  useEffect(() => {
    if (!isEnabled || !planKey) return;
    const refetch = () => {
      void refresh().catch(() => {
        // Focus is a best-effort refresh; the live channel is the main path.
      });
    };
    window.addEventListener("focus", refetch);
    return () => window.removeEventListener("focus", refetch);
  }, [isEnabled, planKey, refresh]);

  return {
    /** Occurrences the operator can switch between, earliest first. */
    occurrences,
    /** The occurrence currently driving the plan, auto-selected or overridden. */
    occurrence,
    /** True while the plan (not the preview) is being fetched. */
    isLoading,
    /** Whether the on-screen preview came from the plan rather than a URL. */
    isPlanSourced: Boolean(servicePlanKey),
    selectedOccurrenceId,
    selectOccurrence: setSelectedOccurrenceId,
    /** Re-reads the plan from the server. Rejects so callers can toast. */
    refresh,
  };
};
