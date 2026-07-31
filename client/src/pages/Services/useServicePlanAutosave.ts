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
  /** Bumped whenever we switch plans. A save that resolves after a switch
   * belongs to the previous plan, so its result must not touch this hook's
   * state — otherwise its revision and "saved" ack would be applied to the
   * plan now on screen. */
  const generationRef = useRef(0);
  /** The newest unsaved snapshot, captured with the save function bound to the
   * plan it came from, so a pending edit can still be persisted to the *right*
   * plan after the editor has moved on. */
  const pendingRef = useRef<{
    payload: ServicePlanPayload;
    baseRevision: number;
    save: (payload: ServicePlanPayload, baseRevision: number) => Promise<ServicePlan>;
  } | null>(null);

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
    const generation = generationRef.current;

    setState("saving");
    const request = (async () => {
      try {
        const savedPlan = await saveRef.current(payload, revisionRef.current);
        // Resolved after a plan switch — this result describes the plan we
        // left, so applying any of it here would corrupt the current one.
        if (generation !== generationRef.current) return false;
        revisionRef.current = savedPlan.revision ?? revisionRef.current + 1;
        savedVersionRef.current = versionBeingSaved;
        retryCountRef.current = 0;
        pendingRef.current = null;
        onSavedRef.current(savedPlan);
        setState(
          changeVersionRef.current > versionBeingSaved ? "dirty" : "saved",
        );
        return true;
      } catch (error) {
        if (generation !== generationRef.current) return false;
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

  /**
   * Persist the newest snapshot of the plan we are leaving. `save` is captured
   * with the snapshot because by the time this runs the live `save` is already
   * bound to the *new* plan's key — reusing it would write the old content
   * under the new plan. Fire-and-forget: this hook's state now belongs to a
   * different plan, so the result is deliberately not applied here.
   */
  const flushPendingForPreviousPlan = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    if (changeVersionRef.current <= savedVersionRef.current) return;
    void pending.save(pending.payload, pending.baseRevision).catch(() => {
      // Nothing to surface — the editor has already moved to another plan.
    });
  }, []);

  const flush = useCallback(async () => {
    clearTimers();
    while (changeVersionRef.current > savedVersionRef.current) {
      const targetVersion = changeVersionRef.current;
      const saved = await saveLatest();
      if (!saved) return false;
      // `saveLatest` also resolves true for "nothing I can do": autosave is
      // disabled, or the draft can't build a payload yet. Neither clears by
      // trying again, so re-testing the same condition would spin the loop
      // forever. Report the failure instead of hanging the tab. A version that
      // grew past `targetVersion` mid-save is a real edit — keep going.
      if (savedVersionRef.current < targetVersion) return false;
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

  /**
   * The server broadcasts a successful write before its HTTP response returns.
   * Consumers use this to recognize that one-revision-ahead SSE message as the
   * acknowledgement for their own in-flight save, rather than a second editor.
   */
  const getInFlightExpectedRevision = useCallback(
    () => (inFlightRef.current ? revisionRef.current + 1 : null),
    [],
  );

  const markConflict = useCallback(() => {
    clearTimers();
    setState("conflict");
  }, [clearTimers]);

  useEffect(() => {
    if (resetKeyRef.current === resetKey) return;
    resetKeyRef.current = resetKey;
    clearTimers();
    flushPendingForPreviousPlan();
    // Any in-flight request now belongs to the previous plan.
    generationRef.current += 1;
    inFlightRef.current = null;
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

  // The editor mounts before its plan fetch completes. Once that clean draft
  // receives the fetched plan, adopt its real revision so the first edit is
  // checked against the document the operator is looking at. Never replace a
  // revision after local work has started: that must still use conflict safety.
  useEffect(() => {
    const hasUnsavedWork = changeVersionRef.current > savedVersionRef.current;
    if (
      baseRevision === revisionRef.current
      || hasUnsavedWork
      || inFlightRef.current
      || pendingRef.current
      || state !== "saved"
    ) {
      return;
    }
    revisionRef.current = baseRevision;
  }, [baseRevision, state]);

  /**
   * Mirrors the newest unsaved draft, deliberately separate from scheduling.
   * An editor that has stopped scheduling saves still accumulates edits — the
   * retry budget can be spent, or a conflict can be waiting on the operator —
   * and those edits are exactly the ones the unmount flush has to carry.
   * Snapshotting inside the scheduler left this holding the pre-failure draft,
   * so leaving the page wrote that stale copy over everything typed since.
   *
   * `state` is a dependency because a completed save clears the snapshot: the
   * following "dirty" transition is what re-captures an edit made in flight.
   */
  useEffect(() => {
    if (!enabled || changeVersion <= savedVersionRef.current) return;
    const payload = buildPayloadRef.current();
    if (!payload) return;
    pendingRef.current = {
      payload,
      // Stale during a conflict, and intentionally so: the flush must lose the
      // server's revision check rather than clobber the other editor's work.
      baseRevision: revisionRef.current,
      save: saveRef.current,
    };
  }, [changeVersion, enabled, state]);

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
      generationRef.current += 1;
      inFlightRef.current = null;
      flushPendingForPreviousPlan();
    },
    [clearTimers, flushPendingForPreviousPlan],
  );

  return {
    state,
    flush,
    retry,
    acceptRemoteRevision,
    getRevision,
    getInFlightExpectedRevision,
    markConflict,
  };
};
