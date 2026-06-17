import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { TEAMS_TEAM_SEARCH_PARAM } from "../teamsReturnNavigation";

/** Applies `?teamId=` from the URL once, then strips it. */
export const useTeamsTeamSearchParam = (
  activeTeamIds: string[],
  onTeamId: (teamId: string) => void,
) => {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const teamIdParam = searchParams.get(TEAMS_TEAM_SEARCH_PARAM)?.trim();
    if (!teamIdParam) return;
    if (!activeTeamIds.includes(teamIdParam)) return;
    onTeamId(teamIdParam);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete(TEAMS_TEAM_SEARCH_PARAM);
    setSearchParams(nextParams, { replace: true });
  }, [activeTeamIds, onTeamId, searchParams, setSearchParams]);
};
