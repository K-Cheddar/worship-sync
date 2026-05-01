import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "../../hooks";
import { useServicePlanningImport } from "../../hooks/useServicePlanningImport";
import { getBibleImportDisplayName } from "../../utils/servicePlanningBibleImport";
import {
  advanceServicePlanningSyncStep,
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

  if (candidate.outlineItemType === "bible" && candidate.parsedRef) {
    const ref = getBibleImportDisplayName(candidate.parsedRef, candidate.parsedRef.version);
    return { label: ref, sublabel: step.headingName || undefined };
  }

  if (candidate.outlineItemType === "song") {
    const itemTitle =
      candidate.matchedLibraryItem?.name || candidate.cleanedTitle || candidate.title;
    return { label: itemTitle || step.headingName || "", sublabel: step.headingName && itemTitle ? step.headingName : undefined };
  }

  return { label: candidate.title || candidate.cleanedTitle || step.headingName || "" };
};

const getOverlayStepLabel = (step: ExecutableOverlaySyncPlanItem): StepLabel => {
  const event = step.patch.event || step.targetOverlayEvent || step.targetOverlayName || step.elementType;
  const name = step.patch.name;
  return name ? { label: name, sublabel: event || undefined } : { label: event || "" };
};

export const useServicePlanningSyncRunner = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
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
  const handledCompletionRunIdRef = useRef<number | null>(null);
  const handledFailureRunIdRef = useRef<number | null>(null);

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
          await delay(STEP_DELAY_MS);
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
          const result = await executeOverlaySyncStep(step);
          dispatch(recordServicePlanningSyncResult(result));
          await delay(STEP_DELAY_MS);
          const overlayResolved =
            result.overlaysCloned > 0 || result.overlaysCreated > 0 ? "created" : "updated";
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
