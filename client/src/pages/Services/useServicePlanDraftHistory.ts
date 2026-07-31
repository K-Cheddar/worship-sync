import { useCallback, useRef, useState } from "react";
import type {
  ServicePlanSection,
  ServicePlanSourceImport,
} from "../../types/servicePlan";

/** Everything an undo step has to put back — the editor's whole draft. */
export type ServicePlanDraftSnapshot = {
  sections: ServicePlanSection[];
  planName: string;
  sourceImport?: ServicePlanSourceImport;
};

/** The same shape as it exists live in the editor, where "no plan yet" is a
 * real state that history deliberately does not step back into. */
type ServicePlanDraftState = {
  sections: ServicePlanSection[] | null;
  planName: string;
  sourceImport?: ServicePlanSourceImport;
};

/**
 * Snapshots share structure with the live draft (every draft util returns new
 * arrays over untouched elements), so the cap is about bounding a long service
 * -day session rather than about snapshot size.
 */
const MAX_HISTORY_ENTRIES = 60;

/**
 * Consecutive edits to the same field collapse into one entry while they keep
 * arriving inside this window. Undo then steps back over a typed phrase or a
 * dragged time value instead of a single character.
 */
const COALESCE_WINDOW_MS = 900;

type UseServicePlanDraftHistoryOptions = {
  /** The live draft, read when an edit is recorded or a step is applied. */
  draft: ServicePlanDraftState;
  /** Puts a past/future snapshot back onto the editor's draft state. */
  onRestore: (snapshot: ServicePlanDraftSnapshot) => void;
};

/**
 * Undo/redo for the service plan draft.
 *
 * The stack holds whole-draft snapshots rather than inverse operations: the
 * editor already replaces `sections` wholesale on every edit, and autosave
 * persists complete documents, so a restored snapshot is saved by exactly the
 * same path as any other edit.
 *
 * History is *local drafting* history only. Callers must reset it whenever the
 * draft is replaced from the server (plan switch, remote update adopted, or a
 * conflict reload) — stepping back across one of those would push a snapshot
 * of someone else's plan revision back over their work.
 */
export const useServicePlanDraftHistory = ({
  draft,
  onRestore,
}: UseServicePlanDraftHistoryOptions) => {
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  const pastRef = useRef<ServicePlanDraftSnapshot[]>([]);
  const futureRef = useRef<ServicePlanDraftSnapshot[]>([]);
  const lastRecordRef = useRef<{ key: string; at: number } | null>(null);
  const [depths, setDepths] = useState({ past: 0, future: 0 });

  const syncDepths = useCallback(() => {
    setDepths((current) =>
      current.past === pastRef.current.length
        && current.future === futureRef.current.length
        ? current
        : { past: pastRef.current.length, future: futureRef.current.length },
    );
  }, []);

  /**
   * Call immediately *before* applying an edit: the draft being replaced is
   * what undo returns to. `coalesceKey` identifies the field being edited so a
   * typing burst on one field stays a single step.
   */
  const record = useCallback(
    (coalesceKey?: string) => {
      const current = draftRef.current;
      // Starter actions build the first draft out of "no plan yet". There is no
      // sensible edit to step back to, and reverting to it would strand a plan
      // autosave has already created on the server.
      if (!current.sections) return;

      const now = Date.now();
      const previous = lastRecordRef.current;
      const continuesBurst = Boolean(
        coalesceKey
        && previous
        && previous.key === coalesceKey
        && now - previous.at < COALESCE_WINDOW_MS,
      );
      lastRecordRef.current = coalesceKey ? { key: coalesceKey, at: now } : null;
      futureRef.current = [];

      // The burst's starting snapshot is already the top of the stack.
      if (!continuesBurst) {
        pastRef.current = [
          ...pastRef.current,
          { ...current, sections: current.sections },
        ].slice(-MAX_HISTORY_ENTRIES);
      }
      syncDepths();
    },
    [syncDepths],
  );

  const step = useCallback(
    (from: typeof pastRef, to: typeof futureRef) => {
      const target = from.current[from.current.length - 1];
      const current = draftRef.current;
      if (!target || !current.sections) return;
      from.current = from.current.slice(0, -1);
      to.current = [...to.current, { ...current, sections: current.sections }];
      // The next edit starts a fresh burst rather than merging into the entry
      // we just stepped off of.
      lastRecordRef.current = null;
      onRestoreRef.current(target);
      syncDepths();
    },
    [syncDepths],
  );

  const undo = useCallback(() => step(pastRef, futureRef), [step]);
  const redo = useCallback(() => step(futureRef, pastRef), [step]);

  /** Drops both stacks — for when the draft is replaced from the server. */
  const reset = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    lastRecordRef.current = null;
    syncDepths();
  }, [syncDepths]);

  return {
    canUndo: depths.past > 0,
    canRedo: depths.future > 0,
    record,
    undo,
    redo,
    reset,
  };
};
