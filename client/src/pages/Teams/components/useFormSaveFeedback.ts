import { useCallback, useEffect, useRef, useState } from "react";

export const SAVE_SUCCESS_DISPLAY_MS = 1750;

export type FormSaveMode = "create" | "update";

type SaveFeedbackByKey = Record<string, FormSaveMode>;

/** Keeps short-lived save confirmation local to the entity editor that earned it. */
const useFormSaveFeedback = (editorKey: string, hasPendingChanges: boolean) => {
  const [successByKey, setSuccessByKey] = useState<SaveFeedbackByKey>({});
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearSuccess = useCallback((key: string) => {
    const timer = timersRef.current.get(key);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(key);
    setSuccessByKey((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const recordSuccess = useCallback((key: string, mode: FormSaveMode) => {
    const timer = timersRef.current.get(key);
    if (timer) clearTimeout(timer);
    setSuccessByKey((current) => ({ ...current, [key]: mode }));
    timersRef.current.set(
      key,
      setTimeout(() => {
        timersRef.current.delete(key);
        setSuccessByKey((current) => {
          if (!(key in current)) return current;
          const next = { ...current };
          delete next[key];
          return next;
        });
      }, SAVE_SUCCESS_DISPLAY_MS),
    );
  }, []);

  useEffect(() => {
    if (hasPendingChanges) clearSuccess(editorKey);
  }, [clearSuccess, editorKey, hasPendingChanges]);

  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
    },
    [],
  );

  return {
    recordSuccess,
    clearSuccess,
    successModeFor: (key: string) => successByKey[key] || null,
    successMode:
      hasPendingChanges ? null : successByKey[editorKey] || null,
  };
};

export default useFormSaveFeedback;
