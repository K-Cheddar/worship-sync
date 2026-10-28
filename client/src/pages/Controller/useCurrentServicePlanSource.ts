/**
 * Keeps the Controller connected to saved Service Plans while leaving every
 * live outline mutation behind the operator's explicit Sync action.
 *
 * Automatic selection starts with the current scheduled occurrence. An old
 * outline binding never overrides that current context; if the current
 * occurrence has no saved plan, the selection stays explicitly unassigned
 * unless no scheduled occurrence can be resolved. Bindings remain useful for
 * outline association/history and explicit manual selection. A manual pick
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
import _ from "lodash";
import { useStore } from "react-redux";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useDispatch, useSelector } from "../../hooks";
import {
  getServicePlan,
  getServicePlanAssignments,
  getServicePlanViewer,
  listServicePlans,
} from "../../api/auth";
import {
  beginServicePlanningPlanSelection,
  clearServicePlanningPlanOutline,
  clearServicePlanningPreview,
  markServicePlanningPlanPreviewFresh,
  markServicePlanningPlanPreviewStale,
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
import type {
  ServicePlan,
  ServicePlanParticipantOverlayProjection,
  ServicePlanSummary,
} from "../../types/servicePlan";
import type {
  ServicePlanningPreview,
  ServicePlanningTeamAssignment,
} from "../../types/servicePlanningImport";
import type { PublicServiceFlowSnapshot } from "../../services/serviceFlowTypes";
import {
  chooseControllerServicePlanKey,
  sortControllerServicePlans,
} from "./controllerServicePlanSelection";
import { useActiveControllerId } from "../../context/activeController";
import type { RootState } from "../../store/store";

const failedParticipantOverlayProjection =
  (): ServicePlanParticipantOverlayProjection => ({
    status: "failed",
    elements: [],
  });

const participantOverlayProjectionMatchesPlan = (
  plan: ServicePlan,
  projection: ServicePlanParticipantOverlayProjection,
): boolean =>
  projection.status !== "ready" ||
  projection.planRevision === undefined ||
  projection.planRevision === (plan.revision ?? 0);

const participantOverlayProjectionForPlan = (
  plan: ServicePlan,
  projection: ServicePlanParticipantOverlayProjection | undefined,
): ServicePlanParticipantOverlayProjection => {
  const resolvedProjection = projection ?? failedParticipantOverlayProjection();
  if (!participantOverlayProjectionMatchesPlan(plan, resolvedProjection)) {
    return failedParticipantOverlayProjection();
  }
  return resolvedProjection;
};

type ReconciliationResult = "updated" | "unchanged" | "failed" | "superseded";

export const useCurrentServicePlanSource = () => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const activeControllerId = useActiveControllerId();
  const { canViewServices, canViewTeams, canUseTeamsLiveSync, churchId, loginState } =
    useContext(GlobalInfoContext) || {};
  const { db } = useContext(ControllerInfoContext) || {};
  const {
    loadPlanPreview,
    isNativeOverlayMappingReady,
    nativeOverlayMappingKey,
    isNativeOverlayPreviewFresh,
  } = useServicePlanningImport();
  const serviceTimes = useSelector(
    (state) => state.undoable.present.serviceTimes.list,
  );
  const selectedOutlineId = useSelector(
    (state) => state.undoable.present.itemLists.selectedList?._id,
  );
  const itemListLoading = useSelector(
    (state) => state.undoable.present.itemList.isLoading,
  );
  const servicePlanKey = useSelector(
    (state) => state.servicePlanningImport.servicePlanKey,
  );
  const currentPreview = useSelector(
    (state) => state.servicePlanningImport.preview,
  );
  const isPlanPreviewStale = useSelector(
    (state) => state.servicePlanningImport.isPlanPreviewStale,
  );
  const [savedPlans, setSavedPlans] = useState<ServicePlanSummary[]>([]);
  const [selectedPlanKey, setSelectedPlanKey] = useState<string | null>(null);
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRefreshingParticipants, setIsRefreshingParticipants] = useState(false);
  const [isParticipantOverlayUnsafe, setIsParticipantOverlayUnsafe] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [selectedPlanSnapshot, setSelectedPlanSnapshot] =
    useState<PublicServiceFlowSnapshot | null>(null);

  const planRef = useRef<ServicePlan | null>(null);
  const currentPreviewRef = useRef(currentPreview);
  currentPreviewRef.current = currentPreview;
  const selectedPlanKeyRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const participantRequestIdRef = useRef(0);
  const participantRefreshRef = useRef<{
    churchId: string;
    controllerId: string;
    outlineId: string | undefined;
    planKey: string;
    generation: number;
    refreshAgain: boolean;
    promise: Promise<void>;
  } | null>(null);
  const reconciliationInFlightRef = useRef<{
    controllerId: string;
    churchId: string;
    selectedOutlineId: string | undefined;
    planKey: string | null;
    generation: number;
    overlayMappingKey: string;
    refreshPlanList: boolean;
    promise: Promise<ReconciliationResult>;
  } | null>(null);
  const planListRequestIdRef = useRef(0);
  const planListActiveRequestIdRef = useRef<number | null>(null);
  const churchIdRef = useRef<string | null>(churchId ?? null);
  const isEnabledRef = useRef(false);
  const isMountedRef = useRef(false);
  const hasReceivedLiveConnectionRef = useRef(false);
  const manualSelectionRef = useRef(false);
  const selectedOutlineIdRef = useRef<string | undefined>(selectedOutlineId);
  const overlayMappingKeyRef = useRef(nativeOverlayMappingKey);
  const previousOverlayMappingKeyRef = useRef(nativeOverlayMappingKey);
  const planAssignmentsRef = useRef<ServicePlanningTeamAssignment[]>([]);
  const participantOverlayProjectionRef = useRef<ServicePlanParticipantOverlayProjection>(
    failedParticipantOverlayProjection(),
  );
  const activeControllerIdRef = useRef(activeControllerId);
  const manualBindingSequenceRef = useRef(0);
  const previousControllerIdRef = useRef(activeControllerId);
  const previousOutlineIdRef = useRef<string | undefined>(selectedOutlineId);
  const automaticSelectionContextRef = useRef<string | undefined>(undefined);
  selectedOutlineIdRef.current = selectedOutlineId;
  overlayMappingKeyRef.current = nativeOverlayMappingKey;
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
      loginState !== "guest",
  );
  churchIdRef.current = churchId ?? null;
  isEnabledRef.current = isEnabled;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      generationRef.current += 1;
      participantRequestIdRef.current += 1;
      reconciliationInFlightRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (previousControllerIdRef.current === activeControllerId) return;
    previousControllerIdRef.current = activeControllerId;
    generationRef.current += 1;
    participantRequestIdRef.current += 1;
    reconciliationInFlightRef.current = null;
    manualSelectionRef.current = false;
    returnOccurrenceToCurrent();
    automaticSelectionContextRef.current = undefined;
    planRef.current = null;
    setSelectedPlanSnapshot(null);
    selectedPlanKeyRef.current = null;
    setSelectedPlanKey(null);
    setIsLoading(false);
    setIsRefreshing(false);
    setIsRefreshingParticipants(false);
    setIsParticipantOverlayUnsafe(false);
    dispatch(clearServicePlanningPreview());
  }, [activeControllerId, dispatch, returnOccurrenceToCurrent]);

  useEffect(() => {
    if (previousOutlineIdRef.current === selectedOutlineId) return;
    previousOutlineIdRef.current = selectedOutlineId;
    generationRef.current += 1;
    participantRequestIdRef.current += 1;
    reconciliationInFlightRef.current = null;
    // Keep the selected occurrence, plan, and manual-session state. The
    // selected plan reconciliation below will rebuild the preview for the new
    // outline and its identity checks prevent old-outline writes.
    planRef.current = null;
    setSelectedPlanSnapshot(null);
    setIsRefreshing(false);
    setIsRefreshingParticipants(false);
    setIsParticipantOverlayUnsafe(false);
    const pendingPlanKey = selectedPlanKeyRef.current;
    if (pendingPlanKey) {
      dispatch(
        beginServicePlanningPlanSelection({
          planKey: pendingPlanKey,
          preservePreview: false,
        }),
      );
    } else {
      dispatch(clearServicePlanningPreview());
    }
  }, [dispatch, selectedOutlineId]);

  const clearUnavailablePlan = useCallback(
    (planKey: string) => {
      if (selectedPlanKeyRef.current !== planKey) return;
      generationRef.current += 1;
      participantRequestIdRef.current += 1;
      // Missing detail/refresh results should leave an explicit empty choice;
      // silently choosing another service's plan is unsafe. Preserve whether
      // the operator was already in a manual override so a deleted automatic
      // plan does not masquerade as a manual choice.
      planRef.current = null;
      setSelectedPlanSnapshot(null);
      selectedPlanKeyRef.current = null;
      setSelectedPlanKey(null);
      setSavedPlans((current) =>
        current.filter((candidate) => candidate.planKey !== planKey),
      );
      setIsLoading(false);
      setIsRefreshing(false);
      setIsRefreshingParticipants(false);
      setIsParticipantOverlayUnsafe(false);
      dispatch(clearServicePlanningPlanOutline());
    },
    [dispatch],
  );

  /*
   * The automatic occurrence remains the hook's source of truth until a
   * manual plan is selected. If that plan is not represented by an available
   * occurrence, hide the automatic occurrence rather than pairing two
   * unrelated contexts in the controls.
   */
  const hasManualPlanOutsideOccurrenceWindow =
    manualSelectionRef.current &&
    Boolean(selectedPlanKey) &&
    !occurrences.some(
      (candidate) => getServicePlanKey(candidate) === selectedPlanKey,
    );

  const refreshPlans = useCallback(async (preserveSelectedPlan = false) => {
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
      setSavedPlans((current) => {
        const refreshed = result.servicePlans;
        const selectedSummary = current.find(
          (plan) => plan.planKey === selectedPlanKeyRef.current,
        );
        const includesSelected = refreshed.some(
          (plan) => plan.planKey === selectedPlanKeyRef.current,
        );
        return sortControllerServicePlans(
          preserveSelectedPlan && selectedSummary && !includesSelected
            ? [...refreshed, selectedSummary]
            : refreshed,
        );
      });
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
      participantRequestIdRef.current += 1;
      planListRequestIdRef.current += 1;
      planListActiveRequestIdRef.current = null;
      manualSelectionRef.current = false;
      planRef.current = null;
      setSelectedPlanSnapshot(null);
      selectedPlanKeyRef.current = null;
      setSavedPlans([]);
      setPlansLoaded(false);
      setSelectedPlanKey(null);
      setIsLoading(false);
      setIsRefreshing(false);
      setIsRefreshingParticipants(false);
      setIsParticipantOverlayUnsafe(false);
      dispatch(clearServicePlanningPlanOutline());
      returnOccurrenceToCurrent();
      automaticSelectionContextRef.current = undefined;
      return;
    }
    void refreshPlans();
  }, [dispatch, isEnabled, refreshPlans, returnOccurrenceToCurrent]);

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

  /** Resolve automatic selection after saved plans and the current occurrence
   * context are ready; do not persist this derived choice as a binding. */
  useEffect(() => {
    if (
      !plansLoaded ||
      itemListLoading ||
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
      // A saved-plan preview already associated with this plan is still
      // useful while a remounted Controller revalidates its authoritative
      // data. A different plan or URL preview must be cleared on selection.
      dispatch(
        beginServicePlanningPlanSelection({
          planKey: nextKey,
          preservePreview: servicePlanKey === nextKey,
        }),
      );
    }
    selectedPlanKeyRef.current = nextKey;
    setIsLoading(Boolean(nextKey));
    setIsRefreshing(false);
    setSelectedPlanKey(nextKey);
  }, [
    activeControllerId,
    currentOccurrencePlanKey,
    currentOccurrence,
    dispatch,
    itemListLoading,
    plansLoaded,
    savedPlans,
    servicePlanKey,
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
      participantOverlay: ServicePlanParticipantOverlayProjection,
      shouldApply: () => boolean = () => true,
    ) => {
      const outline = await loadPlanPreviewRef.current(
        plan,
        assignments,
        participantOverlay,
      );
      if (!shouldApply()) return null;
      dispatch(
        setServicePlanningPlanOutline({ outline, planKey: plan.planKey }),
      );
      return outline;
    },
    [dispatch],
  );
  const invalidateNativeParticipantPreview = useCallback(
    (planKey: string) => {
      const current = store.getState().servicePlanningImport;
      const outline = current.serviceOutline;
      const nativeSummary = outline?.preview.nativeOverlaySummary;
      if (
        current.servicePlanKey !== planKey ||
        !outline ||
        !nativeSummary
      ) {
        return;
      }

      const reason =
        "Plan participants changed. Refresh the plan before syncing.";
      const preview: ServicePlanningPreview = {
        ...outline.preview,
        nativeOverlaySummary: {
          ...nativeSummary,
          status: "failed",
          assignedParticipantCount: null,
        },
        overlayPlan: outline.preview.overlayPlan.map((item) => ({
          ...item,
          action: "skip" as const,
          placementOnly: undefined,
          patch: { ...item.patch, name: "", title: "" },
          reason,
        })),
      };
      dispatch(
        setServicePlanningPlanOutline({
          outline: { ...outline, preview },
          planKey,
        }),
      );
    },
    [dispatch, store],
  );

  type ReconciliationOptions = {
    refreshPlanList?: boolean;
  };

  /**
   * Reconciles one selected plan from authoritative REST data. Resume/reconnect
   * signals for the same scope share one request while an explicit plan switch
   * starts its own request and invalidates the older result through generationRef.
   */
  const reconcileSelectedPlan = useCallback(
    async ({
      refreshPlanList = false,
    }: ReconciliationOptions = {}) => {
      const churchIdAtStart = churchId;
      const controllerIdAtStart = activeControllerId;
      const selectedOutlineIdAtStart = selectedOutlineId;
      const overlayMappingKeyAtStart = nativeOverlayMappingKey;
      if (!isEnabled || !churchIdAtStart) return "failed";
      const planKeyAtStart = selectedPlanKeyRef.current;
      const existing = reconciliationInFlightRef.current;
      if (
        existing &&
        existing.churchId === churchIdAtStart &&
        existing.controllerId === controllerIdAtStart &&
        existing.selectedOutlineId === selectedOutlineIdAtStart &&
        existing.planKey === planKeyAtStart &&
        existing.overlayMappingKey === overlayMappingKeyAtStart &&
        existing.generation === generationRef.current &&
        (existing.refreshPlanList || !refreshPlanList)
      ) {
        return existing.promise;
      }

      const generation = ++generationRef.current;
      const participantRequestId = ++participantRequestIdRef.current;
      setIsRefreshingParticipants(false);
      if (planKeyAtStart) {
        setIsRefreshing(planRef.current?.planKey === planKeyAtStart);
        setIsLoading(planRef.current?.planKey !== planKeyAtStart);
        // Treat the cached preview as untrusted until every required read and
        // the preview rebuild complete. All sync entry points use this shared
        // Redux gate, including routes without this hook's local loading state.
        dispatch(markServicePlanningPlanPreviewStale(planKeyAtStart));
      }
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
        overlayMappingKeyRef.current === overlayMappingKeyAtStart &&
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
      const viewerSnapshotPromise = planKeyAtStart
        ? getServicePlanViewer(churchIdAtStart, planKeyAtStart)
            .then((result) => ({
              ok: true as const,
              snapshot: result.snapshot,
            }))
            .catch((error: unknown) => ({ ok: false as const, error }))
        : Promise.resolve(null);

      let request!: Promise<ReconciliationResult>;
      request = (async () => {
        try {
          const [
            planListResult,
            planResult,
            assignmentsResult,
            snapshotResult,
          ] =
            await Promise.all([
              planListPromise,
              planPromise,
              assignmentsPromise,
              viewerSnapshotPromise,
            ]);
          if (!isCurrentRequest()) return "superseded";

          const hasCurrentPlanList =
            planListResult !== null &&
            planListRequestId === planListRequestIdRef.current &&
            planListResult.success === true &&
            Array.isArray(planListResult.servicePlans);
          if (!planKeyAtStart || !planResult) {
            if (hasCurrentPlanList) {
              setSavedPlans(sortControllerServicePlans(planListResult.servicePlans));
              setPlansLoaded(true);
              setPlansError(null);
            }
            if (planKeyAtStart) {
              dispatch(markServicePlanningPlanPreviewStale(planKeyAtStart));
            }
            return planKeyAtStart ? "failed" : "unchanged";
          }

          if (planResult.success !== true) {
            dispatch(markServicePlanningPlanPreviewStale(planKeyAtStart));
            console.error("Could not reconcile the selected service plan: the plan response was unsuccessful.");
            return "failed";
          }

          const plan = planResult.servicePlan;
          if (plan === null) {
            // The plan detail read is authoritative for this key. A deleted
            // plan needs no assignment read to confirm removal; keep a valid
            // refreshed summary list before clearing the selected preview.
            if (hasCurrentPlanList) {
              setSavedPlans(sortControllerServicePlans(planListResult.servicePlans));
              setPlansLoaded(true);
              setPlansError(null);
            }
            clearUnavailablePlan(planKeyAtStart);
            return "failed";
          }
          if (!plan) {
            dispatch(markServicePlanningPlanPreviewStale(planKeyAtStart));
            console.error("Could not reconcile the selected service plan: the plan response was incomplete.");
            return "failed";
          }

          if (
            !assignmentsResult?.ok ||
            assignmentsResult.result.success !== true ||
            !Array.isArray(assignmentsResult.result.assignments)
          ) {
            console.error(
              "Could not reconcile the selected service plan assignments:",
              assignmentsResult?.ok
                ? "The assignment response was unsuccessful or incomplete."
                : assignmentsResult?.error,
            );
            setIsParticipantOverlayUnsafe(true);
            dispatch(markServicePlanningPlanPreviewStale(planKeyAtStart));
            return "failed";
          }

          if (
            refreshPlanList &&
            planListRequestId === planListRequestIdRef.current &&
            !hasCurrentPlanList
          ) {
            dispatch(markServicePlanningPlanPreviewStale(planKeyAtStart));
            console.error("Could not reconcile the selected service plan: the saved plan list was unsuccessful or incomplete.");
            return "failed";
          }
          if (
            hasCurrentPlanList &&
            !planListResult.servicePlans.some(
              (candidate) => candidate.planKey === planKeyAtStart,
            )
          ) {
            clearUnavailablePlan(planKeyAtStart);
            return "failed";
          }

          if (hasCurrentPlanList) {
            setSavedPlans(sortControllerServicePlans(planListResult.servicePlans));
            setPlansLoaded(true);
            setPlansError(null);
          }

          const previousPlan = planRef.current;
          const previousPreview = currentPreviewRef.current;
          planRef.current = plan;
          if (
            snapshotResult?.ok &&
            participantRequestId === participantRequestIdRef.current
          ) {
            setSelectedPlanSnapshot(snapshotResult.snapshot);
          }
          if (participantRequestId !== participantRequestIdRef.current) return "superseded";
          const participantOverlay = participantOverlayProjectionForPlan(
            plan,
            assignmentsResult?.ok
              ? assignmentsResult.result.participantOverlay
              : undefined,
          );
          planAssignmentsRef.current = assignmentsResult.result.assignments;
          participantOverlayProjectionRef.current = participantOverlay;
          setIsParticipantOverlayUnsafe(participantOverlay.status === "failed");
          const appliedOutline = await applyPlan(
            plan,
            assignmentsResult?.ok ? assignmentsResult.result.assignments : [],
            participantOverlay,
            () =>
              isCurrentRequest() &&
              participantRequestId === participantRequestIdRef.current,
          );
          if (!appliedOutline || !isCurrentRequest()) return "superseded";
          dispatch(markServicePlanningPlanPreviewFresh(planKeyAtStart));
          return _.isEqual(previousPlan, plan) &&
            _.isEqual(previousPreview, appliedOutline.preview)
            ? "unchanged"
            : "updated";
        } catch (error) {
          if (!isCurrentRequest()) return "superseded";
          if (planKeyAtStart) {
            dispatch(markServicePlanningPlanPreviewStale(planKeyAtStart));
          }
          // A failed required read must not replace a usable preview with
          // incomplete plan data. The next reconnect or explicit refresh retries.
          console.error("Could not reconcile the selected service plan:", error);
          return "failed";
        } finally {
          if (
            planKeyAtStart &&
            generation === generationRef.current &&
            selectedPlanKeyRef.current === planKeyAtStart &&
            isMountedRef.current
          ) {
            setIsLoading(false);
            setIsRefreshing(false);
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
        overlayMappingKey: overlayMappingKeyAtStart,
        refreshPlanList,
        promise: request,
      };
      return request;
    },
    [activeControllerId, applyPlan, churchId, clearUnavailablePlan, dispatch, isEnabled, nativeOverlayMappingKey, selectedOutlineId],
  );

  const rebuildSelectedPlanPreviewForMapping = useCallback(async () => {
    const planKey = selectedPlanKeyRef.current;
    if (!planKey || !isEnabled || !churchId) return;
    const plan = planRef.current;
    if (plan?.planKey !== planKey || reconciliationInFlightRef.current) {
      await reconcileSelectedPlan();
      return;
    }

    const churchIdAtStart = churchId;
    const controllerIdAtStart = activeControllerId;
    const outlineIdAtStart = selectedOutlineId;
    const mappingKeyAtStart = nativeOverlayMappingKey;
    const generation = ++generationRef.current;
    participantRequestIdRef.current += 1;
    reconciliationInFlightRef.current = null;
    const isCurrentRequest = () =>
      generation === generationRef.current &&
      activeControllerIdRef.current === controllerIdAtStart &&
      selectedOutlineIdRef.current === outlineIdAtStart &&
      selectedPlanKeyRef.current === planKey &&
      churchIdRef.current === churchIdAtStart &&
      overlayMappingKeyRef.current === mappingKeyAtStart &&
      planRef.current === plan &&
      isEnabledRef.current &&
      isMountedRef.current;

    try {
      const outline = await loadPlanPreviewRef.current(
        plan,
        planAssignmentsRef.current,
        participantOverlayProjectionRef.current,
      );
      if (!isCurrentRequest()) return;
      dispatch(setServicePlanningPlanOutline({ outline, planKey }));
    } catch (error) {
      if (!isCurrentRequest()) return;
      console.error("Could not rebuild the saved-plan overlay preview:", error);
    }
  }, [
    activeControllerId,
    churchId,
    dispatch,
    isEnabled,
    nativeOverlayMappingKey,
    reconcileSelectedPlan,
    selectedOutlineId,
  ]);

  useEffect(() => {
    if (previousOverlayMappingKeyRef.current === nativeOverlayMappingKey) return;
    previousOverlayMappingKeyRef.current = nativeOverlayMappingKey;
    if (!selectedPlanKeyRef.current) return;
    void rebuildSelectedPlanPreviewForMapping();
  }, [nativeOverlayMappingKey, rebuildSelectedPlanPreviewForMapping]);

  const refreshScheduleParticipants = useCallback(
    async (planKey: string, waitForPlanRead?: Promise<unknown>) => {
      const churchIdAtStart = churchId;
      const controllerIdAtStart = activeControllerId;
      const outlineIdAtStart = selectedOutlineId;
      const generationAtStart = generationRef.current;
      if (!isEnabled || !churchIdAtStart || !planKey) return;

      const existing = participantRefreshRef.current;
      if (
        existing &&
        existing.churchId === churchIdAtStart &&
        existing.controllerId === controllerIdAtStart &&
        existing.outlineId === outlineIdAtStart &&
        existing.planKey === planKey &&
        existing.generation === generationAtStart
      ) {
        // Keep one read active for a burst of schedule events, then take one
        // follow-up snapshot if another event arrives while it is in flight.
        existing.refreshAgain = true;
        return existing.promise;
      }

      const participantRequestId = ++participantRequestIdRef.current;
      const isCurrentRequest = () =>
        participantRequestId === participantRequestIdRef.current &&
        generationAtStart === generationRef.current &&
        activeControllerIdRef.current === controllerIdAtStart &&
        selectedOutlineIdRef.current === outlineIdAtStart &&
        selectedPlanKeyRef.current === planKey &&
        churchIdRef.current === churchIdAtStart &&
        isEnabledRef.current &&
        isMountedRef.current;

      setIsRefreshingParticipants(true);
      setIsParticipantOverlayUnsafe(true);
      const flight = {
        churchId: churchIdAtStart,
        controllerId: controllerIdAtStart,
        outlineId: outlineIdAtStart,
        planKey,
        generation: generationAtStart,
        refreshAgain: false,
        promise: Promise.resolve(),
      };
      participantRefreshRef.current = flight;
      const request = (async () => {
        let planRead = waitForPlanRead;
        let refreshAgain = false;
        do {
          refreshAgain = false;
          if (planRead) await planRead;
          planRead = undefined;
          if (!isCurrentRequest()) return;
          // Events received while a plan-detail request was settling are all
          // covered by the participant read that starts next.
          flight.refreshAgain = false;

          const assignmentsPromise = getServicePlanAssignments(churchIdAtStart, planKey)
            .then((result) => ({ ok: true as const, result }))
            .catch((error: unknown) => ({ ok: false as const, error }));
          const viewerSnapshotPromise = getServicePlanViewer(churchIdAtStart, planKey)
            .then((result) => ({ ok: true as const, snapshot: result.snapshot }))
            .catch((error: unknown) => ({ ok: false as const, error }));
          const [assignmentsResult, snapshotResult] = await Promise.all([
            assignmentsPromise,
            viewerSnapshotPromise,
          ]);
          if (!isCurrentRequest()) return;
          if (flight.refreshAgain) {
            flight.refreshAgain = false;
            refreshAgain = true;
            continue;
          }

          const plan = planRef.current;
          if (!plan || plan.planKey !== planKey) return;
          if (!assignmentsResult.ok) {
            setIsParticipantOverlayUnsafe(true);
            invalidateNativeParticipantPreview(planKey);
            return;
          }
          if (
            assignmentsResult.result.participantOverlay &&
            !participantOverlayProjectionMatchesPlan(
              plan,
              assignmentsResult.result.participantOverlay,
            )
          ) {
            // Assignment projection belongs to a newer saved-plan revision.
            // Re-read plan details and participants together before applying it.
            setIsParticipantOverlayUnsafe(true);
            invalidateNativeParticipantPreview(planKey);
            void reconcileSelectedPlan({});
            return;
          }

          const participantOverlay = participantOverlayProjectionForPlan(
            plan,
            assignmentsResult.result.participantOverlay,
          );
          const overlayUnsafe = participantOverlay.status === "failed";
          setIsParticipantOverlayUnsafe(overlayUnsafe);
          if (overlayUnsafe) invalidateNativeParticipantPreview(planKey);
          if (snapshotResult.ok) setSelectedPlanSnapshot(snapshotResult.snapshot);

          await applyPlan(
            plan,
            assignmentsResult.result.assignments,
            participantOverlay,
            () => isCurrentRequest() && planRef.current === plan,
          );
          if (flight.refreshAgain) {
            flight.refreshAgain = false;
            refreshAgain = true;
          }
        } while (refreshAgain && isCurrentRequest());
      })().catch(() => {
        if (isCurrentRequest()) {
          setIsParticipantOverlayUnsafe(true);
          invalidateNativeParticipantPreview(planKey);
        }
      }).finally(() => {
        if (participantRefreshRef.current === flight) {
          participantRefreshRef.current = null;
        }
        if (
          participantRequestId === participantRequestIdRef.current &&
          isMountedRef.current
        ) {
          setIsRefreshingParticipants(false);
        }
      });
      flight.promise = request;
      await request;
    },
    [
      activeControllerId,
      applyPlan,
      churchId,
      invalidateNativeParticipantPreview,
      isEnabled,
      reconcileSelectedPlan,
      selectedOutlineId,
    ],
  );

  /**
   * Remembers a deliberate operator pick (dropdown selection or
   * `pinSelectedPlan`) against this outline immediately, rather than only
   * once the operator syncs. The binding records outline association/history
   * and supports explicit manual selection; reopening an outline does not
   * force it ahead of the current scheduled occurrence. An automatic
   * selection (see the effect below) never sets `manualSelectionRef`, so it
   * never writes a new binding merely because the occurrence changed.
   */
  const persistManualPlanBinding = useCallback(
    async (plan: Pick<ServicePlan, "planKey" | "name">, sequence: number) => {
      if (
        !manualSelectionRef.current ||
        !db ||
        !selectedOutlineId
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
          selectedOutlineIdRef.current !== selectedOutlineIdAtStart ||
          manualBindingSequenceRef.current !== sequence
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
      selectedOutlineId,
    ],
  );
  // Read via ref (not a "load" effect dependency): persisting a binding
  // dispatches a Redux update that changes this callback's identity on every
  // call, which would otherwise re-trigger — and needlessly refetch — the
  // "load" effect below.
  useEffect(() => {
    if (
      !isEnabled ||
      !selectedPlanKey ||
      !churchId ||
      itemListLoading
    ) {
      if (plansLoaded && !selectedPlanKeyRef.current) {
        planRef.current = null;
        dispatch(clearServicePlanningPlanOutline());
      }
      return;
    }
    void reconcileSelectedPlan({
      // The summary list was just loaded by refreshPlans. Reconnect paths use
      // true so the selected key is checked against a fresh authoritative list.
      refreshPlanList: false,
    });
  }, [
    churchId,
    activeControllerId,
    clearUnavailablePlan,
    dispatch,
    isEnabled,
    itemListLoading,
    plansLoaded,
    selectedOutlineId,
    selectedPlanKey,
    servicePlanKey,
    reconcileSelectedPlan,
  ]);

  const selectPlan = useCallback(
    (planKey: string) => {
      manualSelectionRef.current = true;
      const matchingOccurrence = occurrences.find(
        (candidate) => getServicePlanKey(candidate) === planKey,
      );
      if (matchingOccurrence) {
        selectOccurrenceFromSchedule(matchingOccurrence.occurrenceId);
      } else {
        // A saved plan may be outside the currently available occurrence
        // window. Keep the manual plan, but do not leave the automatic
        // occurrence beside it as if it owned that plan.
        returnOccurrenceToCurrent();
      }
      // Persist the operator's choice before waiting for plan details. The
      // picker is local component state, so delaying this until the detail
      // request settles can lose the chosen plan when the Controller unmounts.
      const selectedPlanSummary = savedPlans.find(
        (plan) => plan.planKey === planKey,
      );
      const bindingSequence = ++manualBindingSequenceRef.current;
      if (selectedPlanSummary) {
        void persistManualPlanBinding(selectedPlanSummary, bindingSequence);
      }
      generationRef.current += 1;
      participantRequestIdRef.current += 1;
      planRef.current = null;
      setSelectedPlanSnapshot(null);
      selectedPlanKeyRef.current = planKey || null;
      setIsLoading(Boolean(planKey));
      setIsRefreshing(false);
      setIsRefreshingParticipants(false);
      setIsParticipantOverlayUnsafe(false);
      if (planKey) {
        dispatch(
          beginServicePlanningPlanSelection({
            planKey,
            preservePreview: false,
          }),
        );
      } else {
        dispatch(clearServicePlanningPreview());
      }
      setSelectedPlanKey(planKey || null);
    },
    [
      dispatch,
      occurrences,
      persistManualPlanBinding,
      returnOccurrenceToCurrent,
      savedPlans,
      selectOccurrenceFromSchedule,
    ],
  );

  const selectOccurrence = useCallback(
    (occurrenceId: string) => {
      const nextOccurrence = occurrences.find(
        (candidate) => candidate.occurrenceId === occurrenceId,
      );
      if (!nextOccurrence) return;

      manualSelectionRef.current = true;
      // Selecting an occurrence always restores occurrence/plan alignment;
      // the plan may still be explicitly empty when no saved plan exists.
      generationRef.current += 1;
      participantRequestIdRef.current += 1;
      planRef.current = null;
      setSelectedPlanSnapshot(null);
      selectOccurrenceFromSchedule(occurrenceId);
      const nextPlanKey = getServicePlanKey(nextOccurrence);
      const hasSavedPlan = savedPlans.some(
        (plan) => plan.planKey === nextPlanKey,
      );
      selectedPlanKeyRef.current = hasSavedPlan ? nextPlanKey : null;
      setIsLoading(hasSavedPlan);
      setIsRefreshing(false);
      setIsRefreshingParticipants(false);
      setIsParticipantOverlayUnsafe(false);
      setSelectedPlanKey(hasSavedPlan ? nextPlanKey : null);
      if (hasSavedPlan && nextPlanKey) {
        dispatch(
          beginServicePlanningPlanSelection({
            planKey: nextPlanKey,
            preservePreview: false,
          }),
        );
      } else {
        dispatch(clearServicePlanningPreview());
      }
    },
    [dispatch, occurrences, savedPlans, selectOccurrenceFromSchedule],
  );

  const returnToCurrentService = useCallback(() => {
    manualSelectionRef.current = false;
    generationRef.current += 1;
    participantRequestIdRef.current += 1;
    planRef.current = null;
    setSelectedPlanSnapshot(null);
    automaticSelectionContextRef.current = undefined;
    selectedPlanKeyRef.current = null;
    setSelectedPlanKey(null);
    setIsLoading(false);
    setIsRefreshing(false);
    setIsRefreshingParticipants(false);
    setIsParticipantOverlayUnsafe(false);
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
        const planKeyAtStart = selectedPlanKeyRef.current;
        if (!churchId || !planKeyAtStart) return;
        const existing = reconciliationInFlightRef.current;
        const selectedPlanReadInFlight = Boolean(
          existing &&
            existing.controllerId === activeControllerId &&
            existing.churchId === churchId &&
            existing.selectedOutlineId === selectedOutlineId &&
            existing.planKey === planKeyAtStart &&
            existing.generation === generationRef.current,
        );
        const plan = planRef.current;
        if (plan?.planKey !== planKeyAtStart && !selectedPlanReadInFlight) {
          // The plan has not loaded for this selection yet. Its initial detail
          // read also loads assignments, and starts after this event.
          void reconcileSelectedPlan({});
          return;
        }
        invalidateNativeParticipantPreview(planKeyAtStart);
        void refreshScheduleParticipants(
          planKeyAtStart,
          selectedPlanReadInFlight ? existing?.promise : undefined,
        );
        return;
      }

      if (!isServicePlanUpdatedEvent(event)) return;
      if (event.planKey !== selectedPlanKeyRef.current) {
        // Unselected changes only affect the summary list. Refresh it without
        // advancing the selected-plan generation or touching its preview.
        void refreshPlans(true);
        return;
      }
      void reconcileSelectedPlan({
        refreshPlanList: true,
      });
    },
    [
      activeControllerId,
      churchId,
      clearUnavailablePlan,
      isEnabled,
      invalidateNativeParticipantPreview,
      refreshScheduleParticipants,
      refreshPlans,
      reconcileSelectedPlan,
      selectedOutlineId,
    ],
  );

  useEffect(() => {
    hasReceivedLiveConnectionRef.current = false;
  }, [isEnabled, canViewTeams, churchId]);

  const liveChurchId = isEnabled && canViewTeams ? churchId : null;
  useTeamsLiveSync(
    liveChurchId,
    handleLiveEvent,
    Boolean(canUseTeamsLiveSync),
  );

  const refresh = useCallback(
    () =>
      reconcileSelectedPlan({
        refreshPlanList: true,
      }),
    [reconcileSelectedPlan],
  );

  useSyncOnReconnect(refresh);

  return {
    savedPlans,
    selectedPlan,
    selectedPlanDetails:
      planRef.current?.planKey === selectedPlanKey ? planRef.current : null,
    selectedPlanSnapshot:
      planRef.current?.planKey === selectedPlanKey ? selectedPlanSnapshot : null,
    selectedPlanKey,
    selectPlan,
    occurrences,
    selectOccurrence,
    selectedOccurrenceId,
    returnToCurrentService,
    isManualSelection: manualSelectionRef.current,
    pinSelectedPlan,
    occurrence: hasManualPlanOutsideOccurrenceWindow
      ? null
      : currentOccurrence,
    isEnabled,
    isLoading,
    isPlanPreviewStale,
    isNativeOverlayMappingReady,
    nativeOverlayMappingKey,
    isNativeOverlayPreviewFresh,
    isRefreshing,
    isRefreshingParticipants,
    isParticipantOverlayUnsafe,
    isLoadingPlans,
    plansError,
    isPlanSourced: Boolean(servicePlanKey),
    refresh,
    refreshPlans,
  };
};
