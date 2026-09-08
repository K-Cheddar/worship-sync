import { useEffect, useMemo, useRef } from "react";
import { useSelector } from "../../hooks";
import { selectOutputSlots } from "../../store/presentationSlice";
import { getOrCreateDeviceId } from "../../utils/authStorage";
import {
  acquireWarmLocalVideoCapture,
  LocalVideoCaptureOwnedError,
  releaseWarmLocalVideoCapture,
} from "../../utils/localVideoCapturePool";
import {
  getLocalVideoSourceErrorMessage,
  isDesktopCaptureKind,
  resolveLocalVideoInputBinding,
} from "../../utils/localVideoInput";
import { reportLocalVideoIssue } from "../../utils/localVideoIssues";

const RECOVERY_INTERVAL_MS = 3_000;
const ISSUE_REPEAT_INTERVAL_MS = 30_000;
const CAPTURE_RELEASE_GRACE_MS = 5_000;
const CAPTURE_MANAGER_CONSUMER_ID = "active-output-manager";

const LocalVideoCaptureManager = () => {
  const outputSlots = useSelector(selectOutputSlots);
  const deviceId = getOrCreateDeviceId();
  const lastIssueAtRef = useRef(new Map<string, number>());
  const managedSourceIdsRef = useRef(new Set<string>());
  const pendingReleaseTimersRef = useRef(new Map<string, number>());
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeInputs = useMemo(() => {
    const inputs = Object.values(outputSlots).flatMap((slot) => {
      const input = slot.info.localVideoInput;
      return input?.ownerDeviceId === deviceId ? [input] : [];
    });
    return [
      ...new Map(inputs.map((input) => [input.sourceId, input])).values(),
    ];
  }, [deviceId, outputSlots]);
  const activeInputKey = activeInputs
    .map((input) => `${input.sourceId}:${input.deviceLabel}`)
    .sort()
    .join("|");

  useEffect(() => {
    let active = true;
    let recoveryRunning = false;
    let reconcileQueued = false;
    const nextSourceIds = new Set(activeInputs.map((input) => input.sourceId));
    const removedSourceIds = [...managedSourceIdsRef.current].filter(
      (sourceId) => !nextSourceIds.has(sourceId),
    );
    managedSourceIdsRef.current = nextSourceIds;
    nextSourceIds.forEach((sourceId) => {
      const timer = pendingReleaseTimersRef.current.get(sourceId);
      if (timer !== undefined) window.clearTimeout(timer);
      pendingReleaseTimersRef.current.delete(sourceId);
    });
    removedSourceIds.forEach((sourceId) => {
      if (pendingReleaseTimersRef.current.has(sourceId)) return;
      const timer = window.setTimeout(() => {
        pendingReleaseTimersRef.current.delete(sourceId);
        if (managedSourceIdsRef.current.has(sourceId)) return;
        operationQueueRef.current = operationQueueRef.current
          .catch(() => undefined)
          .then(() =>
            releaseWarmLocalVideoCapture(sourceId, CAPTURE_MANAGER_CONSUMER_ID),
          );
      }, CAPTURE_RELEASE_GRACE_MS);
      pendingReleaseTimersRef.current.set(sourceId, timer);
    });

    const reportIssue = (sourceId: string, detail: string) => {
      const issueKey = `${sourceId}:${detail}`;
      const now = Date.now();
      if (
        now - (lastIssueAtRef.current.get(issueKey) ?? 0) <
        ISSUE_REPEAT_INTERVAL_MS
      ) {
        return;
      }
      lastIssueAtRef.current.set(issueKey, now);
      reportLocalVideoIssue(sourceId, detail);
    };

    const reconcileActiveCaptures = async () => {
      if (!active || recoveryRunning) return;
      recoveryRunning = true;
      try {
        if (!active) return;
        await Promise.all(
          activeInputs.map(async (input) => {
            const binding = resolveLocalVideoInputBinding(input.sourceId);
            if (!binding) {
              reportIssue(
                input.sourceId,
                isDesktopCaptureKind(input.captureKind)
                  ? `Share ${input.deviceLabel} again on this computer, then try again.`
                  : `Relink ${input.deviceLabel} on this computer, then try again.`,
              );
              return;
            }
            try {
              await acquireWarmLocalVideoCapture(
                input.sourceId,
                binding,
                true,
                CAPTURE_MANAGER_CONSUMER_ID,
              );
            } catch (error) {
              await releaseWarmLocalVideoCapture(
                input.sourceId,
                CAPTURE_MANAGER_CONSUMER_ID,
              );
              if (error instanceof LocalVideoCaptureOwnedError) return;
              reportIssue(
                input.sourceId,
                getLocalVideoSourceErrorMessage(error, input.captureKind),
              );
            }
          }),
        );
      } finally {
        recoveryRunning = false;
      }
    };

    const queueReconcile = () => {
      if (!active || recoveryRunning || reconcileQueued) return;
      reconcileQueued = true;
      operationQueueRef.current = operationQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          reconcileQueued = false;
          await reconcileActiveCaptures();
        });
    };

    queueReconcile();
    const recoveryTimer = window.setInterval(
      queueReconcile,
      RECOVERY_INTERVAL_MS,
    );
    return () => {
      active = false;
      window.clearInterval(recoveryTimer);
    };
  }, [activeInputKey, activeInputs]);

  useEffect(
    () => () => {
      const sourceIds = [
        ...new Set([
          ...managedSourceIdsRef.current,
          ...pendingReleaseTimersRef.current.keys(),
        ]),
      ];
      managedSourceIdsRef.current.clear();
      pendingReleaseTimersRef.current.forEach((timer) =>
        window.clearTimeout(timer),
      );
      pendingReleaseTimersRef.current.clear();
      operationQueueRef.current = operationQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          await Promise.all(
            sourceIds.map((sourceId) =>
              releaseWarmLocalVideoCapture(
                sourceId,
                CAPTURE_MANAGER_CONSUMER_ID,
              ),
            ),
          );
        });
    },
    [],
  );

  return null;
};

export default LocalVideoCaptureManager;
