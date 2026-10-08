import MemberManager from "../managers/MemberManager";
import { useTeamsPage } from "../TeamsPageContext";

const TeamsMembersPage = () => {
  const {
    pageData,
    upsertData,
    removeData,
    refresh,
    canEditTeams,
    canEditTeam,
  } =
    useTeamsPage();
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
      members: pageData.members,
    };

  return (
    <MemberManager
      members={pageData.members}
      positions={canEditScopedMembers ? managerData.positions : pageData.positions}
      data={canEditScopedMembers ? managerData : pageData}
      canEdit={canEditScopedMembers}
      canEditAllTeams={canEditTeams}
      canManageMemberLifecycle={canEditTeams}
      canEditMember={() => canEditTeams}
      onSaved={(member, replaceId) =>
        upsertData("members", "memberId", member, replaceId)
      }
      onTeamSaved={(team) => upsertData("teams", "teamId", team)}
      onArchived={() => void refresh()}
      onImported={() => void refresh()}
      onRemoved={(memberId) => removeData("members", "memberId", memberId)}
    />
  );
};

export default TeamsMembersPage;
