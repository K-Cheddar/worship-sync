import { useCallback, useEffect, useMemo, useRef } from "react";
import { useStore } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "../../hooks";
import { useToast } from "../../context/toastContext";
import { useServicePlanningImport } from "../../hooks/useServicePlanningImport";
import { getBibleImportDisplayName } from "../../utils/servicePlanningBibleImport";
import { ensureElementInView } from "../../utils/generalUtils";
import {
  advanceServicePlanningSyncStep,
  completeServicePlanningSync,
  failServicePlanningSync,
  finishServicePlanningSyncCancellation,
  recordServicePlanningSyncResult,
  setServicePlanningSyncActiveStep,
  setServicePlanningSyncPhase,
  setServicePlanningSyncPlanInfo,
} from "../../store/servicePlanningImportSlice";
import type {
  RootState,
} from "../../store/store";
import type { ServicePlanningSyncSummary } from "../../store/servicePlanningImportSlice";
import type { ExecutableOverlaySyncPlanItem } from "../../hooks/useServicePlanningImport";
import type { ServicePlanningOutlineSyncStep } from "../../utils/servicePlanningOutlineImport";

const STEP_DELAY_MS = 300;
const OVERLAYS_ROUTE = "/controller/overlays";
// Scroll containers the synced rows live in, so each change can be scrolled
// into view before the runner advances to the next step.
const OUTLINE_LIST_CONTAINER_ID = "service-items-list";
const OVERLAYS_LIST_CONTAINER_ID = "overlays-list";

type PreparedSyncRun = {
  runId: number;
  outlineSteps: ServicePlanningOutlineSyncStep[];
  overlaySteps: ExecutableOverlaySyncPlanItem[];
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

type StepLabel = { label: string; sublabel?: string };

const getOutlineStepLabel = (step: ServicePlanningOutlineSyncStep): StepLabel => {
  if (step.kind === "ensureHeading") return { label: "" };

  const { candidate } = step;
  const headingName =
    step.kind === "insertSongAtEnd" || step.kind === "insertBibleAtEnd"
      ? null
      : step.headingName;

  if (candidate.outlineItemType === "bible" && candidate.parsedRef) {
    const ref = getBibleImportDisplayName(candidate.parsedRef, candidate.parsedRef.version);
    return { label: ref, sublabel: headingName || undefined };
  }

  if (candidate.outlineItemType === "song") {
    const itemTitle =
      candidate.matchedLibraryItem?.name || candidate.cleanedTitle || candidate.title;
    return {
      label: itemTitle || headingName || "",
      sublabel: headingName && itemTitle ? headingName : undefined,
    };
  }

  return { label: candidate.title || candidate.cleanedTitle || headingName || "" };
};

const getOverlayStepLabel = (step: ExecutableOverlaySyncPlanItem): StepLabel => {
  const event = step.patch.event || step.targetOverlayEvent || step.targetOverlayName || step.elementType;
  const name = step.patch.name;
  return name ? { label: name, sublabel: event || undefined } : { label: event || "" };
};

const pluralize = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Human summary of what a sync run changed, for the finish toast. */
const buildSyncSummaryMessage = (sync: ServicePlanningSyncSummary): string => {
  const parts: string[] = [];
  if (sync.outlineInserted > 0) {
    parts.push(`${pluralize(sync.outlineInserted, "outline item")} added`);
  }
  const overlaysCreated = sync.overlaysCreated + sync.overlaysCloned;
  if (overlaysCreated > 0) {
    parts.push(`${pluralize(overlaysCreated, "overlay")} added`);
  }
  if (sync.overlaysUpdated > 0) {
    parts.push(`${pluralize(sync.overlaysUpdated, "overlay")} updated`);
  }
  return parts.length > 0 ? parts.join(", ") : "no changes were needed";
};

export const useServicePlanningSyncRunner = () => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast, removeToast } = useToast();
  const preview = useSelector((s: RootState) => s.servicePlanningImport.preview);
  const sync = useSelector((s: RootState) => s.servicePlanningImport.sync);
  const {
    planOutlineSyncSteps,
    planSyncItemsInOrder,
    planOverlaySyncSteps,
    executeOutlineSyncStep,
    executeOverlaySyncStep,
  } = useServicePlanningImport();

  const preparedRunRef = useRef<PreparedSyncRun | null>(null);
  const isExecutingRef = useRef(false);
  const startedRunIdRef = useRef<number | null>(null);
  const startToastIdRef = useRef<string | null>(null);
  const handledCompletionRunIdRef = useRef<number | null>(null);
  const handledFailureRunIdRef = useRef<number | null>(null);
  const handledCancelRunIdRef = useRef<number | null>(null);
  // Id of the last overlay synced this run; threaded into the next overlay step
  // as its insertion anchor so synced overlays land in plan order.
  const overlayAnchorIdRef = useRef<string | undefined>(undefined);
  // Overlay ids touched/created this run; passed to the executor so an
  // already-existing overlay is reused instead of duplicated.
  const overlayClaimedIdsRef = useRef<Set<string>>(new Set());

  const overlayRouteReady = useMemo(
    () => location.pathname === OVERLAYS_ROUTE,
    [location.pathname],
  );

  useEffect(() => {
    if (sync.status !== "running") return;
    if (!preview) {
      dispatch(
        failServicePlanningSync("Load a Service Planning preview before syncing."),
      );
      return;
    }
    if (preparedRunRef.current?.runId === sync.runId) return;

    const outlineSteps =
      sync.mode === "overlays" ? [] : planOutlineSyncSteps(preview);
    const overlayPlanning =
      sync.mode === "outline"
        ? { steps: [], skippedCount: 0, skipReasons: [] as string[] }
        : planOverlaySyncSteps(preview);

    const followUpItems =
      sync.mode === "overlays"
        ? []
        : preview.outlineCandidates
            .filter(
              (c) =>
                c.outlineItemType === "song" &&
                !c.matchedLibraryItem &&
                Boolean(c.cleanedTitle || c.title),
            )
            .map((c) => ({
              label: c.cleanedTitle || c.title,
              sublabel: c.headingName || undefined,
              reason: "Not in your library yet.",
            }));

    preparedRunRef.current = {
      runId: sync.runId,
      outlineSteps,
      overlaySteps: overlayPlanning.steps,
    };
    overlayAnchorIdRef.current = undefined;
    overlayClaimedIdsRef.current = new Set();

    dispatch(
      setServicePlanningSyncPlanInfo({
        totalSteps: outlineSteps.length + overlayPlanning.steps.length,
        overlaysSkipped: overlayPlanning.skippedCount,
        reasons: overlayPlanning.skipReasons,
        syncItems: planSyncItemsInOrder(preview, sync.mode ?? "both"),
        followUpItems,
      }),
    );
  }, [
    dispatch,
    planOutlineSyncSteps,
    planSyncItemsInOrder,
    planOverlaySyncSteps,
    preview,
    sync.mode,
    sync.runId,
    sync.status,
  ]);

  useEffect(() => {
    if (sync.status !== "running") return;
    if (!preparedRunRef.current) return;
    if (isExecutingRef.current) return;

    const run = preparedRunRef.current;
    const outlineStepCount = run.outlineSteps.length;
    const overlayStepCount = run.overlaySteps.length;

    // Read from the store (not the render closure) so a Stop pressed mid-step
    // is seen before the runner advances to the next step.
    const getActiveRunStatus = () => {
      const current = store.getState().servicePlanningImport.sync;
      return current.runId === run.runId ? current.status : null;
    };
    const isRunActive = () => getActiveRunStatus() === "running";
    const finishCancellationIfRequested = () => {
      if (getActiveRunStatus() !== "cancelling") return false;
      dispatch(finishServicePlanningSyncCancellation());
      return true;
    };

    const executeNextStep = async () => {
      isExecutingRef.current = true;
      try {
        if (!isRunActive()) return;
        if (sync.phase === "outline") {
          if (sync.currentStep >= outlineStepCount) {
            if (sync.mode === "both" && overlayStepCount > 0) {
              dispatch(setServicePlanningSyncPhase("overlays"));
              if (!overlayRouteReady) {
                navigate(OVERLAYS_ROUTE);
              }
            } else {
              dispatch(completeServicePlanningSync());
            }
            return;
          }

          const step = run.outlineSteps[sync.currentStep];
          const outlineLabel = getOutlineStepLabel(step);
          dispatch(
            setServicePlanningSyncActiveStep({
              phase: "outline",
              activeLabel: outlineLabel.label,
              activeSublabel: outlineLabel.sublabel,
            }),
          );
          const result = await executeOutlineSyncStep(step);
          dispatch(recordServicePlanningSyncResult({ outlineInserted: result.inserted }));
          if (result.activeListId) {
            await ensureElementInView(
              `service-item-${result.activeListId}`,
              OUTLINE_LIST_CONTAINER_ID,
            );
          }
          if (getActiveRunStatus() === "cancelling") {
            dispatch(advanceServicePlanningSyncStep({ resolvedStatus: "added" }));
            finishCancellationIfRequested();
            return;
          }
          await delay(STEP_DELAY_MS);
          if (getActiveRunStatus() === "cancelling") {
            dispatch(advanceServicePlanningSyncStep({ resolvedStatus: "added" }));
            finishCancellationIfRequested();
            return;
          }
          if (!isRunActive()) return;
          dispatch(advanceServicePlanningSyncStep({ resolvedStatus: "added" }));
          return;
        }

        if (sync.phase === "overlays") {
          if (!overlayRouteReady) {
            navigate(OVERLAYS_ROUTE);
            return;
          }

          const overlayIndex = sync.currentStep - outlineStepCount;
          if (overlayIndex >= overlayStepCount) {
            dispatch(completeServicePlanningSync());
            return;
          }

          const step = run.overlaySteps[overlayIndex];
          const overlayLabel = getOverlayStepLabel(step);
          dispatch(
            setServicePlanningSyncActiveStep({
              phase: "overlays",
              activeLabel: overlayLabel.label,
              activeSublabel: overlayLabel.sublabel,
            }),
          );
          const result = await executeOverlaySyncStep(step, {
            insertAfterId: overlayAnchorIdRef.current,
            claimedOverlayIds: overlayClaimedIdsRef.current,
          });
          if (result.resultOverlayId) {
            overlayAnchorIdRef.current = result.resultOverlayId;
            overlayClaimedIdsRef.current.add(result.resultOverlayId);
            // Only scroll to it when something actually changed — a no-op step
            // (overlay already present and up to date) shouldn't move the list.
            const overlayChanged =
              result.overlaysUpdated +
                result.overlaysCloned +
                result.overlaysCreated >
              0;
            if (overlayChanged) {
              await ensureElementInView(
                `overlay-${result.resultOverlayId}`,
                OVERLAYS_LIST_CONTAINER_ID,
              );
            }
          }
          dispatch(recordServicePlanningSyncResult(result));
          const overlayResolved =
            result.overlaysCloned > 0 || result.overlaysCreated > 0
              ? "created"
              : result.overlaysUpdated > 0
                ? "updated"
                : "found";
          if (getActiveRunStatus() === "cancelling") {
            dispatch(advanceServicePlanningSyncStep({ resolvedStatus: overlayResolved }));
            finishCancellationIfRequested();
            return;
          }
          await delay(STEP_DELAY_MS);
          if (getActiveRunStatus() === "cancelling") {
            dispatch(advanceServicePlanningSyncStep({ resolvedStatus: overlayResolved }));
            finishCancellationIfRequested();
            return;
          }
          if (!isRunActive()) return;
          dispatch(advanceServicePlanningSyncStep({ resolvedStatus: overlayResolved }));
        }
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : "Sync failed. Try again.";
        dispatch(failServicePlanningSync(message));
      } finally {
        isExecutingRef.current = false;
      }
    };

    void executeNextStep();
  }, [
    dispatch,
    executeOutlineSyncStep,
    executeOverlaySyncStep,
    navigate,
    overlayRouteReady,
    store,
    sync.currentStep,
    sync.mode,
    sync.phase,
    sync.runId,
    sync.status,
  ]);

  useEffect(() => {
    if (sync.status !== "cancelling") return;
    if (isExecutingRef.current) return;
    dispatch(finishServicePlanningSyncCancellation());
  }, [dispatch, sync.runId, sync.status]);

  // Dismiss the lingering "Syncing…" toast once a run reaches a terminal state.
  const dismissStartToast = useCallback(() => {
    if (startToastIdRef.current) {
      removeToast(startToastIdRef.current);
      startToastIdRef.current = null;
    }
  }, [removeToast]);

  // Toast once when a run starts.
  useEffect(() => {
    if (sync.status !== "running") return;
    if (startedRunIdRef.current === sync.runId) return;
    startedRunIdRef.current = sync.runId;
    startToastIdRef.current = showToast("Syncing service plan…", "info");
  }, [showToast, sync.runId, sync.status]);

  useEffect(() => {
    if (sync.status !== "completed") return;
    if (handledCompletionRunIdRef.current === sync.runId) return;
    handledCompletionRunIdRef.current = sync.runId;
    preparedRunRef.current = null;
    dismissStartToast();
    showToast(`Sync complete — ${buildSyncSummaryMessage(sync)}.`, "success");
  }, [dismissStartToast, showToast, sync]);

  useEffect(() => {
    if (sync.status !== "cancelled") return;
    if (handledCancelRunIdRef.current === sync.runId) return;
    handledCancelRunIdRef.current = sync.runId;
    preparedRunRef.current = null;
    dismissStartToast();
    showToast(`Sync stopped — ${buildSyncSummaryMessage(sync)}.`, "info");
  }, [dismissStartToast, showToast, sync]);

  useEffect(() => {
    if (sync.status !== "failed") return;
    if (handledFailureRunIdRef.current === sync.runId) return;
    handledFailureRunIdRef.current = sync.runId;
    preparedRunRef.current = null;
    dismissStartToast();
    showToast(sync.error || "Sync failed. Try again.", "error");
  }, [dismissStartToast, showToast, sync.error, sync.runId, sync.status]);
};
