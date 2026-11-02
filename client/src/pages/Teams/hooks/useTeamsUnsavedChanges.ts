import { useEffect, useId } from "react";
import { useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";

/** Registers an open Teams form as a navigation guard while it has unsaved edits. */
export const useTeamsUnsavedChanges = (
  hasUnsavedChanges: boolean,
  isSaving = false,
) => {
  const sourceId = useId();
  const { setDirtySource, setSavingSource } = useTeamsNavigationGuard();

  useEffect(() => {
    setDirtySource(sourceId, hasUnsavedChanges);
    setSavingSource(sourceId, isSaving);
    return () => {
      setDirtySource(sourceId, false);
      setSavingSource(sourceId, false);
    };
  }, [hasUnsavedChanges, isSaving, setDirtySource, setSavingSource, sourceId]);
};
