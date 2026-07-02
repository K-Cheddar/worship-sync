import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { TeamRosterMember } from "../../../api/authTypes";
import ScheduleTab from "../schedule/ScheduleTab";
import { useTeamsPage } from "../TeamsPageContext";
import { buildTeamsMemberEditPath, canEditRosterMember } from "../teamsUtils";
import {
  buildTeamsReturnNavigationState,
  TEAMS_SECTION_PATHS,
  type TeamsReturnTo,
} from "../teamsReturnNavigation";

const TeamsSchedulesPage = () => {
  const navigate = useNavigate();
  const {
    pageData,
    selectedScheduleId,
    scheduleDrafts,
    upsertData,
    removeData,
    trackTeamsSave,
    updateSelectedScheduleId,
    updateScheduleDraft,
    flushScheduleDraft,
    canEditTeams,
    canEditAnyTeam,
    canEditTeam,
  } = useTeamsPage();
  const selectedSchedule = pageData.schedules.find(
    (schedule) => schedule.scheduleId === selectedScheduleId,
  );
  const canEditSelectedSchedule = selectedSchedule
    ? canEditTeam(selectedSchedule.teamId)
    : canEditAnyTeam;
  const positionTeamById = useMemo(
    () =>
      new Map(
        pageData.positions.map((position) => [position.positionId, position.teamId]),
      ),
    [pageData.positions],
  );
  const editableTeamIds = useMemo(
    () =>
      new Set(
        pageData.teams
          .filter((team) => canEditTeam(team.teamId))
          .map((team) => team.teamId),
      ),
    [pageData.teams, canEditTeam],
  );
  const canEditMember = useCallback(
    (member: TeamRosterMember) =>
      canEditRosterMember({
        member,
        positionTeamById,
        canEditTeams,
        editableTeamIds,
      }),
    [canEditTeams, editableTeamIds, positionTeamById],
  );
  const handleEditMember = useCallback(
    (memberId: string, returnTo: TeamsReturnTo) => {
      navigate(buildTeamsMemberEditPath(memberId), {
        state: buildTeamsReturnNavigationState(returnTo, TEAMS_SECTION_PATHS.members),
      });
    },
    [navigate],
  );

  return (
    <ScheduleTab
      data={pageData}
      canEdit={canEditTeams || canEditSelectedSchedule}
      canEditMember={canEditMember}
      onEditMember={handleEditMember}
      selectedScheduleId={selectedScheduleId}
      setSelectedScheduleId={updateSelectedScheduleId}
      scheduleDrafts={scheduleDrafts}
      onScheduleSaved={(schedule, replaceId) =>
        upsertData("schedules", "scheduleId", schedule, replaceId)
      }
      onScheduleRemoved={(scheduleId) =>
        removeData("schedules", "scheduleId", scheduleId)
      }
      onMemberSaved={(member, replaceId) =>
        upsertData("members", "memberId", member, replaceId)
      }
      onTeamSaved={(team, replaceId) =>
        upsertData("teams", "teamId", team, replaceId)
      }
      onScheduleDraftChanged={updateScheduleDraft}
      onScheduleDraftFlush={flushScheduleDraft}
      trackTeamsSave={trackTeamsSave}
    />
  );
};

export default TeamsSchedulesPage;
