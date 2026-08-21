import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  buildTeamsRestoreNavigationState,
  clearPersistedTeamsReturnTo,
  clearTeamsRestoreFromState,
  isTeamsNavigationReload,
  persistTeamsReturnTo,
  readPersistedTeamsReturnTo,
  readTeamsRestore,
  readTeamsReturnTo,
  type TeamsGroupsRestore,
  type TeamsPlansRestore,
  type TeamsRestoreState,
  type TeamsReturnTo,
  type TeamsScheduleRestore,
  type TeamsTeamScopedRestore,
} from "../teamsReturnNavigation";

export const useTeamsReturnNavigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const canRestorePersistedReturnToRef = useRef(isTeamsNavigationReload());
  const returnTo = useMemo(
    () => {
      const returnToFromState = readTeamsReturnTo(location.state);
      if (returnToFromState) return returnToFromState;
      return canRestorePersistedReturnToRef.current
        ? readPersistedTeamsReturnTo(location.pathname)
        : null;
    },
    [location.pathname, location.state],
  );

  useEffect(() => {
    const returnToFromState = readTeamsReturnTo(location.state);
    if (returnToFromState) {
      persistTeamsReturnTo(returnToFromState, location.pathname);
    }
  }, [location.pathname, location.state]);

  const finishEditing = useCallback(
    (onReset?: () => void) => {
      onReset?.();
      if (!returnTo) return;
      clearPersistedTeamsReturnTo();
      navigate(returnTo.pathname, {
        state: returnTo.restore
          ? buildTeamsRestoreNavigationState(returnTo.restore)
          : undefined,
      });
    },
    [navigate, returnTo],
  );

  return { returnTo, finishEditing };
};

type TeamsRestoreHandlers = {
  onScheduleRestore?: (restore: TeamsScheduleRestore) => void;
  onGroupsRestore?: (restore: TeamsGroupsRestore) => void;
  onPlansRestore?: (restore: TeamsPlansRestore) => void;
  onTeamScopedRestore?: (restore: TeamsTeamScopedRestore) => void;
};

export const useTeamsRestoreOnMount = ({
  onScheduleRestore,
  onGroupsRestore,
  onPlansRestore,
  onTeamScopedRestore,
}: TeamsRestoreHandlers) => {
  const location = useLocation();
  const navigate = useNavigate();
  const handlersRef = useRef({
    onScheduleRestore,
    onGroupsRestore,
    onPlansRestore,
    onTeamScopedRestore,
  });
  handlersRef.current = {
    onScheduleRestore,
    onGroupsRestore,
    onPlansRestore,
    onTeamScopedRestore,
  };

  useEffect(() => {
    const restore = readTeamsRestore(location.state);
    if (!restore) return;

    if (restore.kind === "schedule") {
      handlersRef.current.onScheduleRestore?.(restore);
    }
    if (restore.kind === "groups") {
      handlersRef.current.onGroupsRestore?.(restore);
    }
    if (restore.kind === "plans") {
      handlersRef.current.onPlansRestore?.(restore);
    }
    if (restore.kind === "teamScoped") {
      handlersRef.current.onTeamScopedRestore?.(restore);
    }

    navigate(location.pathname, {
      replace: true,
      state: clearTeamsRestoreFromState(location.state),
    });
  }, [location.pathname, location.state, navigate]);
};

export type { TeamsReturnTo, TeamsRestoreState };
