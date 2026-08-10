import { useCallback, useEffect, useRef, useState } from "react";

export const DEBOUNCED_STRING_COMMIT_MS = 300;

/**
 * Keeps a text control responsive locally while coalescing updates to its
 * owner. Pending text is flushed when the field blurs or unmounts so leaving
 * an editor does not discard the last part of a typing burst.
 */
const useDebouncedStringCommit = (
  value: string,
  onCommit: (value: string) => void,
  delayMs = DEBOUNCED_STRING_COMMIT_MS,
) => {
  const [draftValue, setDraftValueState] = useState(value);
  const draftValueRef = useRef(value);
  const sourceValueRef = useRef(value);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const flush = useCallback(() => {
    clearTimer();
    const next = draftValueRef.current;
    if (!dirtyRef.current || next === sourceValueRef.current) {
      dirtyRef.current = false;
      return;
    }
    dirtyRef.current = false;
    // Treat the commit as the expected source value immediately. A parent echo
    // can then arrive without replacing a newer local character typed first.
    sourceValueRef.current = next;
    onCommitRef.current(next);
  }, [clearTimer]);

  const setDraftValue = useCallback(
    (next: string) => {
      draftValueRef.current = next;
      setDraftValueState(next);
      dirtyRef.current = next !== sourceValueRef.current;
      clearTimer();
      if (!dirtyRef.current) return;
      timerRef.current = setTimeout(flush, delayMs);
    },
    [clearTimer, delayMs, flush],
  );

  useEffect(() => {
    if (value === sourceValueRef.current) return;
    sourceValueRef.current = value;
    // Do not let an autosave echo or unrelated parent render clobber text that
    // is still inside this field's debounce window.
    if (dirtyRef.current) return;
    draftValueRef.current = value;
    setDraftValueState(value);
  }, [value]);

  useEffect(
    () => () => {
      flush();
    },
    [flush],
  );

  return { draftValue, setDraftValue, flush };
};

export default useDebouncedStringCommit;
