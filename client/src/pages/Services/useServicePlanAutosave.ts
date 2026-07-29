import { useCallback, useEffect, useRef, useState } from "react";
import type { ServicePlan, ServicePlanPayload } from "../../types/servicePlan";

export type ServicePlanAutosaveState =
  | "saved"
  | "dirty"
  | "saving"
  | "retrying"
  | "conflict"
  | "error";

type UseServicePlanAutosaveOptions = {
  enabled: boolean;
  resetKey: string;
  changeVersion: number;
  baseRevision: number;
  buildPayload: () => ServicePlanPayload | null;
  save: (payload: ServicePlanPayload, baseRevision: number) => Promise<ServicePlan>;
  getConflictPlan: (error: unknown) => ServicePlan | null;
  onSaved: (plan: ServicePlan) => void;
  onConflict: (latestPlan: ServicePlan) => void;
};

const AUTOSAVE_DELAY_MS = 1_200;
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

/**
 * Serializes complete-document plan saves. A change made during an in-flight
 * request is saved immediately afterwards, so an older response can never
 * replace the user's newest local snapshot.
 */
export const useServicePlanAutosave = ({
  enabled,
  resetKey,
  changeVersion,
  baseRevision,
  buildPayload,
  save,
  getConflictPlan,
  onSaved,
  onConflict,
}: UseServicePlanAutosaveOptions) => {
  const [state, setState] = useState<ServicePlanAutosaveState>("saved");
  const changeVersionRef = useRef(changeVersion);
  const savedVersionRef = useRef(changeVersion);
  const revisionRef = useRef(baseRevision);
  const enabledRef = useRef(enabled);
  const buildPayloadRef = useRef(buildPayload);
  const saveRef = useRef(save);
  const getConflictPlanRef = useRef(getConflictPlan);
  const onSavedRef = useRef(onSaved);
  const onConflictRef = useRef(onConflict);
  const timerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const retryCountRef = useRef(0);
  const resetKeyRef = useRef(resetKey);

  changeVersionRef.current = changeVersion;
  enabledRef.current = enabled;
  buildPayloadRef.current = buildPayload;
  saveRef.current = save;
  getConflictPlanRef.current = getConflictPlan;
  onSavedRef.current = onSaved;
  onConflictRef.current = onConflict;

  // Stable: only touches refs, so effects can depend on it without re-running.
  const clearTimers = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    timerRef.current = null;
    retryTimerRef.current = null;
  }, []);

  const saveLatest = useCallback(async (): Promise<boolean> => {
    if (!enabledRef.current || changeVersionRef.current <= savedVersionRef.current) {
      return true;
    }
    if (inFlightRef.current) return inFlightRef.current;

    const versionBeingSaved = changeVersionRef.current;
    const payload = buildPayloadRef.current();
    if (!payload) return true;

    setState("saving");
    const request = (async () => {
      try {
        const savedPlan = await saveRef.current(payload, revisionRef.current);
        revisionRef.current = savedPlan.revision ?? revisionRef.current + 1;
        savedVersionRef.current = versionBeingSaved;
        retryCountRef.current = 0;
        onSavedRef.current(savedPlan);
        setState(
          changeVersionRef.current > versionBeingSaved ? "dirty" : "saved",
        );
        return true;
      } catch (error) {
        const latestPlan = getConflictPlanRef.current(error);
        if (latestPlan) {
          setState("conflict");
          onConflictRef.current(latestPlan);
          return false;
        }
        const retryDelay = RETRY_DELAYS_MS[retryCountRef.current];
        retryCountRef.current += 1;
        if (retryDelay !== undefined) {
          setState("retrying");
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            void saveLatest();
          }, retryDelay);
        } else {
          setState("error");
        }
        return false;
      } finally {
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = request;
    return request;
  }, []);

  const flush = useCallback(async () => {
    clearTimers();
    while (changeVersionRef.current > savedVersionRef.current) {
      const saved = await saveLatest();
      if (!saved) return false;
    }
    return true;
  }, [clearTimers, saveLatest]);

  const retry = useCallback(() => {
    retryCountRef.current = 0;
    void flush();
  }, [flush]);

  const acceptRemoteRevision = useCallback((plan: ServicePlan) => {
    revisionRef.current = plan.revision ?? revisionRef.current;
    savedVersionRef.current = changeVersionRef.current;
    retryCountRef.current = 0;
    setState("saved");
  }, []);

  const getRevision = useCallback(() => revisionRef.current, []);

  useEffect(() => {
    if (resetKeyRef.current === resetKey) return;
    resetKeyRef.current = resetKey;
    clearTimers();
    // Editor route changes reset their local draft counter to zero. Do not
    // snapshot the render's value here: an incoming route response must never
    // acknowledge a click that happened while it was settling.
    savedVersionRef.current = 0;
    revisionRef.current = baseRevision;
    retryCountRef.current = 0;
    setState("saved");
    // resetKey intentionally identifies a different plan, not a new save ack.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    if (
      !enabled ||
      changeVersion <= savedVersionRef.current ||
      state === "saving" ||
      state === "retrying" ||
      state === "conflict" ||
      state === "error"
    ) {
      return;
    }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setState("dirty");
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void saveLatest();
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [changeVersion, enabled, saveLatest, state]);

  // Unmount only. Without the empty dependency array this runs after every
  // render, and its cleanup would clear the pending autosave timer each time —
  // the editor re-renders at least once a second, so a save could never fire.
  useEffect(
    () => () => {
      clearTimers();
    },
    [clearTimers],
  );

  return { state, flush, retry, acceptRemoteRevision, getRevision };
};
