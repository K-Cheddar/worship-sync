import _ from "lodash";
import { useCallback, useEffect, useRef, useState } from "react";
import { OverlayInfo } from "../types";
import { normalizeOverlayForSync } from "../utils/overlayUtils";

export const OVERLAY_DRAFT_DEBOUNCE_MS = 300;

/** Merge draft over latest Redux overlay so commits never drop fields (fixes stream / quick-link gaps). */
function buildCommitPayload(
  fromRedux: OverlayInfo,
  draft: OverlayInfo,
): OverlayInfo {
  const merged: OverlayInfo = {
    ...fromRedux,
    ...draft,
    id: draft.id || fromRedux.id,
  };
  const d = Number(merged.duration);
  if (merged.duration != null && !Number.isFinite(d)) {
    merged.duration = fromRedux.duration;
  }
  return normalizeOverlayForSync(merged);
}

/**
 * Local overlay draft + debounced commit to Redux so typing does not dispatch on every keystroke.
 * Mirrors QuickLink label pattern (merge formatting from Redux while text is dirty).
 */
export function useOverlayDraft(
  selectedOverlay: OverlayInfo,
  onCommit: (overlay: OverlayInfo) => void,
) {
  const [draft, setDraft] = useState<OverlayInfo>(selectedOverlay);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const isDirtyRef = useRef(false);
  const lastCommittedRef = useRef<OverlayInfo>(selectedOverlay);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSerializedRef = useRef("");
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const selectedOverlayRef = useRef(selectedOverlay);
  selectedOverlayRef.current = selectedOverlay;

  const replaceDraft = useCallback((nextOverlay: OverlayInfo) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const normalized = normalizeOverlayForSync(nextOverlay);
    setDraft(normalized);
    draftRef.current = normalized;
    lastCommittedRef.current = normalized;
    isDirtyRef.current = false;
    prevSerializedRef.current = JSON.stringify(normalized);
  }, []);

  const scheduleCommit = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      const fromRedux = selectedOverlayRef.current;
      const draft = draftRef.current;
      if (!draft.id || draft.id !== fromRedux.id) return;
      const next = buildCommitPayload(fromRedux, draft);
      draftRef.current = next;
      setDraft(next);
      lastCommittedRef.current = next;
      isDirtyRef.current = false;
      onCommitRef.current(next);
    }, OVERLAY_DRAFT_DEBOUNCE_MS);
  }, []);

  const patchDraft = useCallback(
    (partial: Partial<OverlayInfo>) => {
      setDraft((prev) => {
        const next = { ...prev, ...partial };
        draftRef.current = next;
        isDirtyRef.current = true;
        scheduleCommit();
        return next;
      });
    },
    [scheduleCommit],
  );

  const flushDraft = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const fromRedux = selectedOverlayRef.current;
    const draft = draftRef.current;
    if (!isDirtyRef.current || draft.id !== fromRedux.id) return;
    const next = buildCommitPayload(fromRedux, draft);
    if (_.isEqual(next, lastCommittedRef.current)) {
      isDirtyRef.current = false;
      return;
    }
    draftRef.current = next;
    setDraft(next);
    lastCommittedRef.current = next;
    isDirtyRef.current = false;
    onCommitRef.current(next);
  }, []);

  /** Merge into draft without scheduling Redux (parent already committed, e.g. style editor). */
  const mergeDraftLocal = useCallback((partial: Partial<OverlayInfo>) => {
    setDraft((prev) => {
      const next = { ...prev, ...partial };
      draftRef.current = next;
      return next;
    });
  }, []);

  // Flush pending edits for the previous overlay, then load the newly selected one.
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const incoming = selectedOverlayRef.current;
    const current = draftRef.current;
    if (current.id && incoming.id && current.id !== incoming.id) {
      if (isDirtyRef.current && !_.isEqual(current, lastCommittedRef.current)) {
        // Redux already points at the next overlay; commit the previous overlay as-is (normalized).
        onCommitRef.current(normalizeOverlayForSync(current));
      }
    }
    replaceDraft(incoming);
  }, [replaceDraft, selectedOverlay.id]);

  // Sync draft from Redux when props change (formatting-only merge while text is dirty).
  useEffect(() => {
    const ser = JSON.stringify(selectedOverlay);
    if (ser === prevSerializedRef.current) return;

    if (!selectedOverlay.id) {
      prevSerializedRef.current = ser;
      return;
    }

    if (isDirtyRef.current) {
      if (!_.isEqual(selectedOverlay.formatting, draftRef.current.formatting)) {
        setDraft((d) => {
          const next = {
            ...selectedOverlay,
            ...d,
            formatting: selectedOverlay.formatting ?? d.formatting,
          };
          draftRef.current = next;
          return next;
        });
      }
      prevSerializedRef.current = ser;
      return;
    }

    replaceDraft(selectedOverlay);
  }, [replaceDraft, selectedOverlay]);

  useEffect(
    () => () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      const fromRedux = selectedOverlayRef.current;
      const draft = draftRef.current;
      if (
        isDirtyRef.current &&
        draft.id &&
        draft.id === fromRedux.id &&
        !_.isEqual(
          buildCommitPayload(fromRedux, draft),
          lastCommittedRef.current,
        )
      ) {
        onCommitRef.current(buildCommitPayload(fromRedux, draft));
      }
    },
    [],
  );

  return { draft, patchDraft, flushDraft, mergeDraftLocal, replaceDraft };
}
