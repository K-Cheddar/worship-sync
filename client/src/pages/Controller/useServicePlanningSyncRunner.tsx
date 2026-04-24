import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "../../hooks";
import { useToast } from "../../context/toastContext";
import { useServicePlanningImport } from "../../hooks/useServicePlanningImport";
import {
  advanceServicePlanningSyncStep,
  clearServicePlanningSyncState,
  completeServicePlanningSync,
  failServicePlanningSync,
  recordServicePlanningSyncResult,
  resetServicePlanningImportPreview,
  setServicePlanningSyncActiveStep,
  setServicePlanningSyncPhase,
  setServicePlanningSyncPlanInfo,
} from "../../store/servicePlanningImportSlice";
import type { RootState } from "../../store/store";
import type { ExecutableOverlaySyncPlanItem } from "../../hooks/useServicePlanningImport";
import type { ServicePlanningOutlineSyncStep } from "../../utils/servicePlanningOutlineImport";

const STEP_DELAY_MS = 300;
const OVERLAYS_ROUTE = "/controller/overlays";
const FINAL_TOAST_DISMISS_MS = 10000;

type PreparedSyncRun = {
  runId: number;
  outlineSteps: ServicePlanningOutlineSyncStep[];
  overlaySteps: ExecutableOverlaySyncPlanItem[];
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const getOutlineStepLabel = (step: ServicePlanningOutlineSyncStep) => {
  if (step.kind === "ensureHeading") return step.headingName;
  return step.candidate.title || step.candidate.cleanedTitle || step.headingName;
};

const getOverlayStepLabel = (step: ExecutableOverlaySyncPlanItem) =>
  step.patch.event ||
  step.patch.name ||
  step.targetOverlayName ||
  step.elementType;

const ServicePlanningSyncToastContent = ({ toastId }: { toastId: string }) => {
  const dispatch = useDispatch();
  const { removeToast } = useToast();
  const sync = useSelector((s: RootState) => s.servicePlanningImport.sync);

  useEffect(() => {
    if (sync.status !== "completed" && sync.status !== "failed") return undefined;

    const timeout = window.setTimeout(() => {
      removeToast(toastId);
      dispatch(clearServicePlanningSyncState());
    }, FINAL_TOAST_DISMISS_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [dispatch, removeToast, sync.status, toastId]);

  if (sync.status === "running") {
    return (
      <div className="text-left">
        <p className="text-sm font-semibold">
          Syncing {sync.phase === "overlays" ? "overlays" : "outline"}
        </p>
        <p className="mt-1 text-sm">
          Step {Math.min(sync.currentStep + 1, Math.max(sync.totalSteps, 1))} of{" "}
          {Math.max(sync.totalSteps, 1)}
        </p>
        {sync.activeLabel ? (
          <p className="mt-1 text-xs text-zinc-300">{sync.activeLabel}</p>
        ) : null}
      </div>
    );
  }

  if (sync.status === "failed") {
    return (
      <div className="text-left">
        <p className="text-sm font-semibold">Sync failed</p>
        <p className="mt-1 text-sm">{sync.error || "Try again."}</p>
      </div>
    );
  }

  const lines: string[] = [];
  if (sync.overlaysUpdated > 0) {
    lines.push(
      `${sync.overlaysUpdated} overlay${sync.overlaysUpdated === 1 ? "" : "s"} updated`,
    );
  }
  if (sync.overlaysCreated > 0) {
    lines.push(
      `${sync.overlaysCreated} overlay${sync.overlaysCreated === 1 ? "" : "s"} created`,
    );
  }
  if (sync.overlaysCloned > 0) {
    lines.push(
      `${sync.overlaysCloned} overlay${sync.overlaysCloned === 1 ? "" : "s"} copied`,
    );
  }
  if (sync.outlineInserted > 0) {
    lines.push(
      `${sync.outlineInserted} outline item${sync.outlineInserted === 1 ? "" : "s"} inserted`,
    );
  }
  if (sync.overlaysSkipped > 0) {
    lines.push(
      `${sync.overlaysSkipped} overlay step${sync.overlaysSkipped === 1 ? "" : "s"} skipped`,
    );
  }

  return (
    <div className="text-left">
      <p className="text-sm font-semibold">
        {lines.length > 0 ? "Sync complete" : "Nothing to sync"}
      </p>
      {lines.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-sm">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {sync.reasons.length > 0 ? (
        <p className="mt-2 text-xs text-zinc-300">
          {sync.reasons.slice(0, 3).join(" ")}
        </p>
      ) : null}
    </div>
  );
};

export const useServicePlanningSyncRunner = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast, removeToast } = useToast();
  const preview = useSelector((s: RootState) => s.servicePlanningImport.preview);
  const sync = useSelector((s: RootState) => s.servicePlanningImport.sync);
  const {
    planOutlineSyncSteps,
    planOverlaySyncSteps,
    executeOutlineSyncStep,
    executeOverlaySyncStep,
  } = useServicePlanningImport();

  const preparedRunRef = useRef<PreparedSyncRun | null>(null);
  const isExecutingRef = useRef(false);
  const handledCompletionRunIdRef = useRef<number | null>(null);
  const handledFailureRunIdRef = useRef<number | null>(null);
  const shownToastRunIdRef = useRef<number | null>(null);
  const syncToastIdRef = useRef<string | null>(null);

  const overlayRouteReady = useMemo(
    () => location.pathname === OVERLAYS_ROUTE,
    [location.pathname],
  );

  useEffect(() => {
    if (sync.status !== "running") return;
    if (shownToastRunIdRef.current === sync.runId) return;

    if (syncToastIdRef.current) {
      removeToast(syncToastIdRef.current);
    }
    syncToastIdRef.current = showToast({
      variant: "info",
      position: "top-center",
      persist: true,
      showCloseButton: false,
      children: (toastId: string) => (
        <ServicePlanningSyncToastContent toastId={toastId} />
      ),
    });
    shownToastRunIdRef.current = sync.runId;
  }, [removeToast, showToast, sync.runId, sync.status]);

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

    preparedRunRef.current = {
      runId: sync.runId,
      outlineSteps,
      overlaySteps: overlayPlanning.steps,
    };

    dispatch(
      setServicePlanningSyncPlanInfo({
        totalSteps: outlineSteps.length + overlayPlanning.steps.length,
        overlaysSkipped: overlayPlanning.skippedCount,
        reasons: overlayPlanning.skipReasons,
      }),
    );
  }, [
    dispatch,
    planOutlineSyncSteps,
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

    const executeNextStep = async () => {
      isExecutingRef.current = true;
      try {
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
          dispatch(
            setServicePlanningSyncActiveStep({
              phase: "outline",
              activeLabel: getOutlineStepLabel(step),
            }),
          );
          const result = await executeOutlineSyncStep(step);
          dispatch(
            recordServicePlanningSyncResult({
              outlineInserted: result.inserted,
            }),
          );
          await delay(STEP_DELAY_MS);
          dispatch(advanceServicePlanningSyncStep());
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
          dispatch(
            setServicePlanningSyncActiveStep({
              phase: "overlays",
              activeLabel: getOverlayStepLabel(step),
            }),
          );
          const result = await executeOverlaySyncStep(step);
          dispatch(recordServicePlanningSyncResult(result));
          await delay(STEP_DELAY_MS);
          dispatch(advanceServicePlanningSyncStep());
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
    sync.currentStep,
    sync.mode,
    sync.phase,
    sync.runId,
    sync.status,
  ]);

  useEffect(() => {
    if (sync.status !== "completed") return;
    if (handledCompletionRunIdRef.current === sync.runId) return;
    handledCompletionRunIdRef.current = sync.runId;
    preparedRunRef.current = null;

    dispatch(resetServicePlanningImportPreview());
  }, [dispatch, sync.runId, sync.status]);

  useEffect(() => {
    if (sync.status !== "failed") return;
    if (handledFailureRunIdRef.current === sync.runId) return;
    handledFailureRunIdRef.current = sync.runId;
    preparedRunRef.current = null;
  }, [sync.runId, sync.status]);
};
