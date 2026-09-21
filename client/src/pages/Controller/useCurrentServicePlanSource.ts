/**
 * Keeps the Controller connected to saved Service Plans while leaving every
 * live outline mutation behind the operator's explicit Sync action.
 *
 * Selection order is deliberate: the current scheduled occurrence when it has
 * a saved plan, then a clearly unassigned empty state. A nearest saved plan is
 * used only when no scheduled occurrence can be resolved. A manual pick
 * remains pinned for this Controller session.
 */
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useDispatch, useSelector } from "../../hooks";
import {
  getServicePlan,
  getServicePlanAssignments,
  listServicePlans,
} from "../../api/auth";
import {
  clearServicePlanningPlanOutline,
  clearServicePlanningPreview,
  setServicePlanningOutlinePlanBinding,
  setServicePlanningPlanOutline,
} from "../../store/servicePlanningImportSlice";
import { persistItemListServicePlanBinding } from "../../utils/itemListImports";
import { useServicePlanningImport } from "../../hooks/useServicePlanningImport";
import { useSyncOnReconnect } from "../../hooks/useSyncOnReconnect";
import {
  isServicePlanUpdatedEvent,
  useTeamsLiveSync,
  type TeamsStreamEvent,
} from "../Teams/hooks/useTeamsLiveSync";
import { getServicePlanKey } from "../../utils/servicePlanKeys";
import { toTeamService } from "../Teams/teamsUtils";
import { useCurrentServiceOccurrence } from "./useCurrentServiceOccurrence";
import type { ServicePlan, ServicePlanSummary } from "../../types/servicePlan";
import type { ServicePlanningTeamAssignment } from "../../types/servicePlanningImport";
import {
  chooseControllerServicePlanKey,
  servicePlanToSummary,
  sortControllerServicePlans,
} from "./controllerServicePlanSelection";
import { useActiveControllerId } from "../../context/activeController";

export const useCurrentServicePlanSource = () => {
  const dispatch = useDispatch();
  const activeControllerId = useActiveControllerId();
  const { canViewServices, canViewTeams, churchId, loginState } =
    useContext(GlobalInfoContext) || {};
  const { db } = useContext(ControllerInfoContext) || {};
  const { loadPlanPreview, isServicePlanningEnabled } =
    useServicePlanningImport();
  const serviceTimes = useSelector(
    (state) => state.undoable.present.serviceTimes.list,
  );
  const selectedOutlineId = useSelector(
    (state) => state.undoable.present.itemLists.selectedList?._id,
  );
  const itemListLoading = useSelector(
    (state) => state.undoable.present.itemList.isLoading,
  );
  const outlinePlanBinding = useSelector(
    (state) => state.servicePlanningImport.outlinePlanBinding,
  );
  const servicePlanKey = useSelector(
    (state) => state.servicePlanningImport.servicePlanKey,
  );
  const hasUrlSourcedPreview = useSelector(
    (state) =>
      Boolean(
        state.servicePlanningImport.preview &&
          !state.servicePlanningImport.servicePlanKey,
      ),
  );
  const urlSelectionRevision = useSelector(
    (state) => state.servicePlanningImport.urlSelectionRevision,
  );

  const [savedPlans, setSavedPlans] = useState<ServicePlanSummary[]>([]);
  const [selectedPlanKey, setSelectedPlanKey] = useState<string | null>(null);
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [plansLoaded, setPlansLoaded] = useState(false);

  const planRef = useRef<ServicePlan | null>(null);
  const selectedPlanKeyRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const reconciliationInFlightRef = useRef<{
    controllerId: string;
    churchId: string;
    selectedOutlineId: string | undefined;
    planKey: string | null;
    generation: number;
    refreshPlanList: boolean;
    preserveOnFailure: boolean;
    promise: Promise<void>;
  } | null>(null);
  const planListRequestIdRef = useRef(0);
  const planListActiveRequestIdRef = useRef<number | null>(null);
  const churchIdRef = useRef<string | null>(churchId ?? null);
  const isEnabledRef = useRef(false);
  const isMountedRef = useRef(false);
  const hasReceivedLiveConnectionRef = useRef(false);
  const manualSelectionRef = useRef(false);
  // A URL preview already present when this hook mounts belongs to an earlier
  // Controller visit and must not suppress the linked/current saved plan. The
  // revision changes only when the operator imports a URL in this visit.
  const previousUrlSelectionRevisionRef = useRef(urlSelectionRevision);
  const currentVisitUrlSelectionRef = useRef(false);
  const selectedOutlineIdRef = useRef<string | undefined>(selectedOutlineId);
  const activeControllerIdRef = useRef(activeControllerId);
  const previousOutlineContextRef = useRef({
    controllerId: activeControllerId,
    outlineId: selectedOutlineId,
  });
  const automaticSelectionContextRef = useRef<string | undefined>(undefined);
  selectedOutlineIdRef.current = selectedOutlineId;
  activeControllerIdRef.current = activeControllerId;
  const loadPlanPreviewRef = useRef(loadPlanPreview);
  useEffect(() => {
    loadPlanPreviewRef.current = loadPlanPreview;
  }, [loadPlanPreview]);

  const services = useMemo(
    () => serviceTimes.map(toTeamService),
    [serviceTimes],
  );
  const {
    occurrences,
    occurrence: currentOccurrence,
    selectedOccurrenceId,
    selectOccurrence: selectOccurrenceFromSchedule,
    returnToCurrent: returnOccurrenceToCurrent,
  } = useCurrentServiceOccurrence(services);
  const currentOccurrencePlanKey = currentOccurrence
    ? getServicePlanKey(currentOccurrence)
    : null;

  const isEnabled = Boolean(
    churchId &&
      canViewServices &&
      loginState !== "guest" &&
      isServicePlanningEnabled,
  );
  churchIdRef.current = churchId ?? null;
  isEnabledRef.current = isEnabled;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      generationRef.current += 1;
      reconciliationInFlightRef.current = null;
    };
  }, []);

  useEffect(() => {
    const previous = previousOutlineContextRef.current;
    if (
      previous.controllerId === activeControllerId &&
      previous.outlineId === selectedOutlineId
    ) {
      return;
    }
    previousOutlineContextRef.current = {
      controllerId: activeControllerId,
      outlineId: selectedOutlineId,
    };
    generationRef.current += 1;
    reconciliationInFlightRef.current = null;
    manualSelectionRef.current = false;
    returnOccurrenceToCurrent();
    automaticSelectionContextRef.current = undefined;
    planRef.current = null;
    selectedPlanKeyRef.current = null;
    setSelectedPlanKey(null);
    dispatch(clearServicePlanningPreview());
  }, [
    activeControllerId,
    dispatch,
    returnOccurrenceToCurrent,
    selectedOutlineId,
  ]);

  const clearUnavailablePlan = useCallback(
    (planKey: string) => {
      if (selectedPlanKeyRef.current !== planKey) return;
      generationRef.current += 1;
      // Missing detail/refresh results should leave an explicit empty choice;
      // silently choosing another service's plan is unsafe. Preserve whether
      // the operator was already in a manual override so a deleted automatic
      // plan does not masquerade as a manual choice.
      planRef.current = null;
      selectedPlanKeyRef.current = null;
      setSelectedPlanKey(null);
      setSavedPlans((current) =>
        current.filter((candidate) => candidate.planKey !== planKey),
      );
      setIsLoading(false);
      dispatch(clearServicePlanningPlanOutline());
    },
    [dispatch],
  );

  const refreshPlans = useCallback(async () => {
    if (!isEnabled || !churchId) return;
    const requestId = ++planListRequestIdRef.current;
    planListActiveRequestIdRef.current = requestId;
    const churchIdAtStart = churchId;
    const isCurrentListRequest = () =>
      requestId === planListRequestIdRef.current &&
      churchIdRef.current === churchIdAtStart &&
      isEnabledRef.current &&
      isMountedRef.current;
    setIsLoadingPlans(true);
    setPlansError(null);
    try {
      const result = await listServicePlans(churchIdAtStart);
      if (!isCurrentListRequest()) return;
      setSavedPlans(sortControllerServicePlans(result.servicePlans));
      setPlansLoaded(true);
    } catch {
      if (!isCurrentListRequest()) return;
      setPlansError("Could not load saved plans. Try again.");
      setPlansLoaded(true);
    } finally {
      if (planListActiveRequestIdRef.current === requestId) {
        planListActiveRequestIdRef.current = null;
        if (isCurrentListRequest()) setIsLoadingPlans(false);
      }
    }
  }, [churchId, isEnabled]);

  useEffect(() => {
    if (!isEnabled) {
      generationRef.current += 1;
      planListRequestIdRef.current += 1;
      planListActiveRequestIdRef.current = null;
      manualSelectionRef.current = false;
      planRef.current = null;
      selectedPlanKeyRef.current = null;
      setSavedPlans([]);
      setPlansLoaded(false);
      setSelectedPlanKey(null);
      setIsLoading(false);
      dispatch(clearServicePlanningPlanOutline());
      returnOccurrenceToCurrent();
      automaticSelectionContextRef.current = undefined;
      return;
    }
    void refreshPlans();
  }, [dispatch, isEnabled, refreshPlans, returnOccurrenceToCurrent]);

  // A URL pasted during this Controller visit is an explicit source choice.
  // A URL preview carried in from an earlier visit intentionally does not take
  // ownership here, allowing the linked/current saved plan to load instead.
  useEffect(() => {
    if (urlSelectionRevision === previousUrlSelectionRevisionRef.current) {
      return;
    }
    previousUrlSelectionRevisionRef.current = urlSelectionRevision;
    if (!hasUrlSourcedPreview) return;
    currentVisitUrlSelectionRef.current = true;
    generationRef.current += 1;
    manualSelectionRef.current = false;
    planRef.current = null;
    selectedPlanKeyRef.current = null;
    setSelectedPlanKey(null);
    setIsLoading(false);
  }, [hasUrlSourcedPreview, urlSelectionRevision]);

  // A refresh can remove a plan without an SSE removal event (for example,
  // after reconnecting or resuming a sleeping device). Reconcile a pinned key
  // before automatic selection runs so the old preview cannot remain visible
  // while a different service is chosen.
  useEffect(() => {
    if (
      !plansLoaded ||
      isLoadingPlans ||
      !selectedPlanKey ||
      savedPlans.some((plan) => plan.planKey === selectedPlanKey)
    ) {
      return;
    }
    clearUnavailablePlan(selectedPlanKey);
  }, [
    clearUnavailablePlan,
    isLoadingPlans,
    plansLoaded,
    savedPlans,
    selectedPlanKey,
  ]);

  /** Resolve the initial plan only after the saved-plan list and current
   * occurrence context are ready. */
  useEffect(() => {
    if (
      !plansLoaded ||
      itemListLoading ||
      (hasUrlSourcedPreview && currentVisitUrlSelectionRef.current) ||
      manualSelectionRef.current
    ) {
      return;
    }
    const automaticContextKey = currentOccurrence?.occurrenceId ?? "none";
    const contextChanged =
      automaticSelectionContextRef.current !== automaticContextKey;
    if (!contextChanged && selectedPlanKeyRef.current !== null) return;
    if (!contextChanged && !currentOccurrence) return;

    const nextKey = chooseControllerServicePlanKey({
      plans: savedPlans,
      currentOccurrencePlanKey,
      hasCurrentOccurrence: Boolean(currentOccurrence),
    });
    automaticSelectionContextRef.current = automaticContextKey;
    if (selectedPlanKeyRef.current === nextKey) return;
    if (nextKey) {
      currentVisitUrlSelectionRef.current = false;
      dispatch(clearServicePlanningPreview());
    }
    selectedPlanKeyRef.current = nextKey;
    setSelectedPlanKey(nextKey);
  }, [
    currentOccurrencePlanKey,
    currentOccurrence,
    dispatch,
    hasUrlSourcedPreview,
    itemListLoading,
    plansLoaded,
    savedPlans,
    selectedOutlineId,
  ]);

  const selectedPlan = useMemo(
    () => savedPlans.find((plan) => plan.planKey === selectedPlanKey) ?? null,
    [savedPlans, selectedPlanKey],
  );
  const applyPlan = useCallback(
    async (
      plan: ServicePlan,
      assignments: ServicePlanningTeamAssignment[],
      shouldApply: () => boolean = () => true,
    ) => {
      const outline = await loadPlanPreviewRef.current(plan, assignments);
      if (!shouldApply()) return;
      dispatch(
        setServicePlanningPlanOutline({ outline, planKey: plan.planKey }),
      );
    },
    [dispatch],
  );

  type ReconciliationOptions = {
    refreshPlanList?: boolean;
    preserveOnFailure?: boolean;
  };

  /**
   * Reconciles one selected plan from authoritative REST data. The request is
   * keyed by church, plan, and failure policy so resume/reconnect signals for
   * the same state share one request while an explicit plan switch can start
   * its own request and invalidate the older result through generationRef.
   */
  const reconcileSelectedPlan = useCallback(
    async ({
      refreshPlanList = false,
      preserveOnFailure = false,
    }: ReconciliationOptions = {}) => {
      const churchIdAtStart = churchId;
      const controllerIdAtStart = activeControllerId;
      const selectedOutlineIdAtStart = selectedOutlineId;
      if (!isEnabled || !churchIdAtStart) return;
      const planKeyAtStart = selectedPlanKeyRef.current;
      const existing = reconciliationInFlightRef.current;
      if (
        existing &&
        existing.churchId === churchIdAtStart &&
        existing.controllerId === controllerIdAtStart &&
        existing.selectedOutlineId === selectedOutlineIdAtStart &&
        existing.planKey === planKeyAtStart &&
        existing.generation === generationRef.current &&
        (existing.refreshPlanList || !refreshPlanList) &&
        existing.preserveOnFailure === preserveOnFailure
      ) {
        return existing.promise;
      }

      const generation = ++generationRef.current;
      if (planKeyAtStart) setIsLoading(true);
      const planListRequestId = refreshPlanList
        ? ++planListRequestIdRef.current
        : null;
      if (planListRequestId !== null) {
        planListActiveRequestIdRef.current = planListRequestId;
        setIsLoadingPlans(true);
      }

      const isCurrentRequest = () =>
        generation === generationRef.current &&
        activeControllerIdRef.current === controllerIdAtStart &&
        selectedOutlineIdRef.current === selectedOutlineIdAtStart &&
        selectedPlanKeyRef.current === planKeyAtStart &&
        churchIdRef.current === churchIdAtStart &&
        isEnabledRef.current &&
        isMountedRef.current;

      const planListPromise = refreshPlanList
        ? listServicePlans(churchIdAtStart)
        : Promise.resolve(null);
      const planPromise = planKeyAtStart
        ? getServicePlan(churchIdAtStart, planKeyAtStart)
        : Promise.resolve(null);
      const assignmentsPromise = planKeyAtStart
        ? getServicePlanAssignments(churchIdAtStart, planKeyAtStart)
            .then((result) => ({ ok: true as const, result }))
            .catch((error: unknown) => ({ ok: false as const, error }))
        : Promise.resolve(null);

      let request!: Promise<void>;
      request = (async () => {
        try {
          const [planListResult, planResult, assignmentsResult] =
            await Promise.all([
              planListPromise,
              planPromise,
              assignmentsPromise,
            ]);
          if (!isCurrentRequest()) return;

          const hasCurrentPlanList =
            planListResult !== null &&
            planListRequestId === planListRequestIdRef.current;
          if (!planKeyAtStart || !planResult) {
            if (hasCurrentPlanList) {
              setSavedPlans(sortControllerServicePlans(planListResult.servicePlans));
              setPlansLoaded(true);
              setPlansError(null);
            }
            return;
          }
          if (!assignmentsResult?.ok && preserveOnFailure) {
            console.error(
              "Could not reconcile the selected service plan assignments:",
              assignmentsResult?.error,
            );
            return;
          }

          if (hasCurrentPlanList) {
            setSavedPlans(sortControllerServicePlans(planListResult.servicePlans));
            setPlansLoaded(true);
            setPlansError(null);
          }

          const plan = planResult.servicePlan;
          if (
            hasCurrentPlanList &&
            !planListResult.servicePlans.some(
              (candidate) => candidate.planKey === planKeyAtStart,
            )
          ) {
            clearUnavailablePlan(planKeyAtStart);
            return;
          }
          if (!plan) {
            clearUnavailablePlan(planKeyAtStart);
            return;
          }

          planRef.current = plan;
          void persistManualPlanBindingRef.current(plan);
          await applyPlan(
            plan,
            assignmentsResult?.ok ? assignmentsResult.result.assignments : [],
            isCurrentRequest,
          );
        } catch (error) {
          // Background recovery must not replace a usable preview with an
          // empty state. The next reconnect or explicit refresh can retry.
          console.error("Could not reconcile the selected service plan:", error);
        } finally {
          if (
            planKeyAtStart &&
            generation === generationRef.current &&
            selectedPlanKeyRef.current === planKeyAtStart &&
            isMountedRef.current
          ) {
            setIsLoading(false);
          }
        }
      })().finally(() => {
        if (reconciliationInFlightRef.current?.promise === request) {
          reconciliationInFlightRef.current = null;
        }
        if (
          planListRequestId !== null &&
          planListActiveRequestIdRef.current === planListRequestId
        ) {
          planListActiveRequestIdRef.current = null;
          if (isMountedRef.current) setIsLoadingPlans(false);
        }
      });

      reconciliationInFlightRef.current = {
        controllerId: controllerIdAtStart,
        churchId: churchIdAtStart,
        selectedOutlineId: selectedOutlineIdAtStart,
        planKey: planKeyAtStart,
        generation,
        refreshPlanList,
        preserveOnFailure,
        promise: request,
      };
      return request;
    },
    [activeControllerId, applyPlan, churchId, clearUnavailablePlan, isEnabled, selectedOutlineId],
  );

  /**
   * Remembers a deliberate operator pick (dropdown selection or
   * `pinSelectedPlan`) against this outline immediately, rather than only
   * once the operator syncs — so reopening the outline restores the same
   * plan without re-prompting even if it was never synced. An automatic
   * fallback selection (see the effect below) never sets
   * `manualSelectionRef`, so it never overwrites an existing binding.
   */
  const persistManualPlanBinding = useCallback(
    async (plan: Pick<ServicePlan, "planKey" | "name">) => {
      if (
        !manualSelectionRef.current ||
        !db ||
        !selectedOutlineId ||
        outlinePlanBinding?.planKey === plan.planKey
      ) {
        return;
      }
      const binding = {
        planKey: plan.planKey,
        planName: plan.name?.trim() || "Service plan",
        linkedAt: new Date().toISOString(),
      };
      const controllerIdAtStart = activeControllerId;
      const selectedOutlineIdAtStart = selectedOutlineId;
      try {
        await persistItemListServicePlanBinding(db, selectedOutlineIdAtStart, binding);
        if (
          activeControllerIdRef.current !== controllerIdAtStart ||
          selectedOutlineIdRef.current !== selectedOutlineIdAtStart
        ) {
          return;
        }
        dispatch(setServicePlanningOutlinePlanBinding(binding));
      } catch (error) {
        console.error("Could not link this outline to its service plan:", error);
      }
    },
    [
      activeControllerId,
      db,
      dispatch,
      outlinePlanBinding?.planKey,
      selectedOutlineId,
    ],
  );
  // Read via ref (not a "load" effect dependency): persisting a binding
  // dispatches a Redux update that changes this callback's identity on every
  // call, which would otherwise re-trigger — and needlessly refetch — the
  // "load" effect below.
  const persistManualPlanBindingRef = useRef(persistManualPlanBinding);
  useEffect(() => {
    persistManualPlanBindingRef.current = persistManualPlanBinding;
  }, [persistManualPlanBinding]);

  useEffect(() => {
    if (
      !isEnabled ||
      !selectedPlanKey ||
      !churchId ||
      itemListLoading ||
      (hasUrlSourcedPreview &&
        currentVisitUrlSelectionRef.current &&
        !manualSelectionRef.current)
    ) {
      if (plansLoaded && !selectedPlanKey) {
        planRef.current = null;
        dispatch(clearServicePlanningPlanOutline());
      }
      return;
    }
    void reconcileSelectedPlan({
      // The summary list was just loaded by refreshPlans. Reconnect paths use
      // true so the selected key is checked against a fresh authoritative list.
      refreshPlanList: false,
      preserveOnFailure: false,
    });
  }, [
    churchId,
    activeControllerId,
    clearUnavailablePlan,
    dispatch,
    hasUrlSourcedPreview,
    isEnabled,
    itemListLoading,
    plansLoaded,
    selectedOutlineId,
    selectedPlanKey,
    reconcileSelectedPlan,
  ]);

  const selectPlan = useCallback(
    (planKey: string) => {
      manualSelectionRef.current = true;
      currentVisitUrlSelectionRef.current = false;
      // Persist the operator's choice before waiting for plan details. The
      // picker is local component state, so delaying this until the detail
      // request settles can lose the chosen plan when the Controller unmounts.
      const selectedPlanSummary = savedPlans.find(
        (plan) => plan.planKey === planKey,
      );
      if (selectedPlanSummary) {
        void persistManualPlanBinding(selectedPlanSummary);
      }
      generationRef.current += 1;
      planRef.current = null;
      selectedPlanKeyRef.current = planKey || null;
      setIsLoading(Boolean(planKey));
      dispatch(clearServicePlanningPreview());
      setSelectedPlanKey(planKey || null);
    },
    [dispatch, persistManualPlanBinding, savedPlans],
  );

  const selectOccurrence = useCallback(
    (occurrenceId: string) => {
      const nextOccurrence = occurrences.find(
        (candidate) => candidate.occurrenceId === occurrenceId,
      );
      if (!nextOccurrence) return;

      manualSelectionRef.current = true;
      currentVisitUrlSelectionRef.current = false;
      generationRef.current += 1;
      planRef.current = null;
      selectOccurrenceFromSchedule(occurrenceId);
      const nextPlanKey = getServicePlanKey(nextOccurrence);
      const hasSavedPlan = savedPlans.some(
        (plan) => plan.planKey === nextPlanKey,
      );
      selectedPlanKeyRef.current = hasSavedPlan ? nextPlanKey : null;
      setIsLoading(hasSavedPlan);
      setSelectedPlanKey(hasSavedPlan ? nextPlanKey : null);
      dispatch(clearServicePlanningPreview());
    },
    [dispatch, occurrences, savedPlans, selectOccurrenceFromSchedule],
  );

  const returnToCurrentService = useCallback(() => {
    manualSelectionRef.current = false;
    currentVisitUrlSelectionRef.current = false;
    generationRef.current += 1;
    planRef.current = null;
    automaticSelectionContextRef.current = undefined;
    selectedPlanKeyRef.current = null;
    setSelectedPlanKey(null);
    setIsLoading(false);
    dispatch(clearServicePlanningPreview());
    returnOccurrenceToCurrent();
  }, [dispatch, returnOccurrenceToCurrent]);

  const pinSelectedPlan = useCallback(() => {
    if (selectedPlanKey) {
      manualSelectionRef.current = true;
    }
  }, [selectedPlanKey]);

  const handleLiveEvent = useCallback(
    (event: TeamsStreamEvent) => {
      if (!isEnabled) return;
      if (event.type === "connected") {
        if (hasReceivedLiveConnectionRef.current) {
          void reconcileSelectedPlan({
            refreshPlanList: true,
            preserveOnFailure: true,
          });
        } else {
          hasReceivedLiveConnectionRef.current = true;
        }
        return;
      }
      if (event.type === "service-plan-removed") {
        const removedKey = (event as { planKey?: unknown }).planKey;
        if (typeof removedKey !== "string") return;
        // A plan-list response that started before this SSE event must not
        // restore the removed plan when it completes, but an unrelated plan
        // event must not discard the selected plan's in-flight reconciliation.
        planListRequestIdRef.current += 1;
        planListActiveRequestIdRef.current = null;
        setIsLoadingPlans(false);
        if (removedKey === selectedPlanKeyRef.current) {
          clearUnavailablePlan(removedKey);
        } else {
          setSavedPlans((current) =>
            current.filter((plan) => plan.planKey !== removedKey),
          );
        }
        return;
      }

      if (event.type === "schedule-updated" || event.type === "schedule-removed") {
        if (!churchId || !planRef.current) return;
        const plan = planRef.current;
        const generation = ++generationRef.current;
        void getServicePlanAssignments(churchId, plan.planKey)
          .then((result) => {
            return applyPlan(
              plan,
              result.assignments,
              () =>
                generation === generationRef.current &&
                planRef.current === plan &&
                selectedPlanKeyRef.current === plan.planKey,
            );
          })
          .catch(() => undefined);
        return;
      }

      if (!isServicePlanUpdatedEvent(event)) return;
      const isSelectedPlan =
        event.servicePlan.planKey === selectedPlanKeyRef.current;
      // Keep a stale plan-list response from undoing this direct SSE update.
      planListRequestIdRef.current += 1;
      planListActiveRequestIdRef.current = null;
      setIsLoadingPlans(false);
      // Only a selected-plan event supersedes the selected plan's detail and
      // assignment request. Unrelated plan events update the summary list
      // without stranding the selected preview in a loading state.
      const generation = isSelectedPlan
        ? ++generationRef.current
        : generationRef.current;
      setSavedPlans((current) => {
        const summary = servicePlanToSummary(event.servicePlan);
        const withoutUpdated = current.filter(
          (plan) => plan.planKey !== summary.planKey,
        );
        return sortControllerServicePlans([...withoutUpdated, summary]);
      });
      if (!isSelectedPlan) return;
      if (!churchId) return;
      planRef.current = event.servicePlan;
      void getServicePlanAssignments(churchId, event.servicePlan.planKey)
        .then((result) =>
          applyPlan(
            event.servicePlan,
            result.assignments,
            () =>
              generation === generationRef.current &&
              selectedPlanKeyRef.current === event.servicePlan.planKey,
          ),
        )
        .catch(() =>
          applyPlan(
            event.servicePlan,
            [],
            () =>
              generation === generationRef.current &&
              selectedPlanKeyRef.current === event.servicePlan.planKey,
          ),
        )
        .finally(() => {
          if (
            generation === generationRef.current &&
            selectedPlanKeyRef.current === event.servicePlan.planKey
          ) {
            setIsLoading(false);
          }
        });
    },
    [
      applyPlan,
      churchId,
      clearUnavailablePlan,
      isEnabled,
      reconcileSelectedPlan,
    ],
  );

  useEffect(() => {
    hasReceivedLiveConnectionRef.current = false;
  }, [isEnabled, canViewTeams, churchId]);

  const liveChurchId = isEnabled && canViewTeams ? churchId : null;
  useTeamsLiveSync(
    liveChurchId,
    handleLiveEvent,
  );

  const refresh = useCallback(
    () =>
      reconcileSelectedPlan({
        refreshPlanList: true,
        preserveOnFailure: true,
      }),
    [reconcileSelectedPlan],
  );

  useSyncOnReconnect(refresh);

  return {
    savedPlans,
    selectedPlan,
    selectedPlanKey,
    selectPlan,
    occurrences,
    selectOccurrence,
    selectedOccurrenceId,
    returnToCurrentService,
    isManualSelection: manualSelectionRef.current,
    pinSelectedPlan,
    occurrence: currentOccurrence,
    isEnabled,
    isLoading,
    isLoadingPlans,
    plansError,
    isPlanSourced: Boolean(servicePlanKey),
    refresh,
    refreshPlans,
  };
};
