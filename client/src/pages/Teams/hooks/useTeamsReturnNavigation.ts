import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  buildTeamsRestoreNavigationState,
  clearPersistedTeamsReturnTo,
  clearTeamsRestoreFromState,
  persistTeamsReturnTo,
  readPersistedTeamsReturnTo,
  readTeamsRestore,
  readTeamsReturnTo,
  type TeamsGroupsRestore,
  type TeamsRestoreState,
  type TeamsReturnTo,
  type TeamsScheduleRestore,
  type TeamsTeamScopedRestore,
} from "../teamsReturnNavigation";

export const useTeamsReturnNavigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = useMemo(
    () =>
      readTeamsReturnTo(location.state) ??
      readPersistedTeamsReturnTo(location.pathname),
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
  onTeamScopedRestore?: (restore: TeamsTeamScopedRestore) => void;
};

export const useTeamsRestoreOnMount = ({
  onScheduleRestore,
  onGroupsRestore,
  onTeamScopedRestore,
}: TeamsRestoreHandlers) => {
  const location = useLocation();
  const navigate = useNavigate();
  const handlersRef = useRef({
    onScheduleRestore,
    onGroupsRestore,
    onTeamScopedRestore,
  });
  handlersRef.current = {
    onScheduleRestore,
    onGroupsRestore,
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
