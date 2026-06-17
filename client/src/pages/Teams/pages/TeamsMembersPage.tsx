import MemberManager from "../managers/MemberManager";
import { useTeamsPage } from "../TeamsPageContext";
import { canEditRosterMember } from "../teamsUtils";

const TeamsMembersPage = () => {
  const { pageData, upsertData, removeData, refresh, canEditTeams, canEditTeam } =
    useTeamsPage();
  const positionTeamById = new Map(
    pageData.positions.map((position) => [position.positionId, position.teamId]),
  );
  const editableTeamIds = new Set(
    pageData.teams
      .filter((team) => canEditTeam(team.teamId))
      .map((team) => team.teamId),
  );
  const canEditScopedMembers = canEditTeams || editableTeamIds.size > 0;
  const managerData = canEditTeams
    ? pageData
    : {
      ...pageData,
      teams: pageData.teams.filter((team) => editableTeamIds.has(team.teamId)),
      positions: pageData.positions.filter((position) =>
        editableTeamIds.has(position.teamId),
      ),
      teamRoles: pageData.teamRoles.filter((role) =>
        editableTeamIds.has(role.teamId),
      ),
      qualificationAreas: pageData.qualificationAreas.filter((area) =>
        editableTeamIds.has(area.teamId),
      ),
      qualificationLevels: pageData.qualificationLevels.filter((level) => {
        const area = pageData.qualificationAreas.find(
          (item) => item.areaId === level.areaId,
        );
        return area ? editableTeamIds.has(area.teamId) : false;
      }),
      members: pageData.members.filter((member) =>
        canEditRosterMember({
          member,
          positionTeamById,
          canEditTeams,
          editableTeamIds,
        }),
      ),
    };

  return (
    <MemberManager
      members={managerData.members}
      positions={managerData.positions}
      data={managerData}
      canEdit={canEditScopedMembers}
      onSaved={(member, replaceId) =>
        upsertData("members", "memberId", member, replaceId)
      }
      onArchived={() => void refresh()}
      onRemoved={(memberId) => removeData("members", "memberId", memberId)}
    />
  );
};

export default TeamsMembersPage;
