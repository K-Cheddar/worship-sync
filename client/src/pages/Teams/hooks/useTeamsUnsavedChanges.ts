import { useEffect, useId } from "react";
import { useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";

/** Registers an open Teams form as a navigation guard while it has unsaved edits. */
export const useTeamsUnsavedChanges = (hasUnsavedChanges: boolean) => {
  const sourceId = useId();
  const { setDirtySource } = useTeamsNavigationGuard();

  useEffect(() => {
    setDirtySource(sourceId, hasUnsavedChanges);
    return () => setDirtySource(sourceId, false);
  }, [hasUnsavedChanges, setDirtySource, sourceId]);
};
