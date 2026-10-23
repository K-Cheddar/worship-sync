import MemberManager from "../managers/MemberManager";
import { useTeamsPage } from "../TeamsPageContext";

const TeamsMembersPage = () => {
  const {
    pageData,
    upsertData,
    removeData,
    refresh,
    reconcileTeamsProjection,
    invalidateMemberEditability,
    teamProfileReadyMemberIds,
    invalidateTeamProfileReadiness,
    refreshMemberSmsEligibility,
    loading,
    canEditTeams,
    canEditTeam,
  } =
    useTeamsPage();
  const editableTeamIds = new Set(
    pageData.teams
      .filter((team) => !team.archivedAt && canEditTeam(team.teamId))
      .map((team) => team.teamId),
  );
  const managedMemberIds = new Set(
    pageData.teams
      .filter((team) => editableTeamIds.has(team.teamId))
      .flatMap((team) => team.memberIds || []),
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
      isLoading={loading}
      positions={canEditScopedMembers ? managerData.positions : pageData.positions}
      data={canEditScopedMembers ? managerData : pageData}
      canEdit={canEditScopedMembers}
      canEditAllTeams={canEditTeams}
      teamProfileReadyMemberIds={teamProfileReadyMemberIds}
      canManageMemberLifecycle={canEditTeams}
      canEditMember={(member) =>
        canEditTeams || (!member.archivedAt && managedMemberIds.has(member.memberId))
      }
      onScopedProfileSaved={(memberId) => {
        invalidateMemberEditability(memberId);
        invalidateTeamProfileReadiness(memberId);
        return reconcileTeamsProjection();
      }}
      onSaved={(member, replaceId) =>
        upsertData("members", "memberId", member, replaceId)
      }
      onIdentityChanged={() => void reconcileTeamsProjection()}
      onSmsEligibilityRefresh={refreshMemberSmsEligibility}
      onTeamSaved={(team) => upsertData("teams", "teamId", team)}
      onArchived={() => void refresh()}
      onImported={() => refresh()}
      onRemoved={(memberId) => removeData("members", "memberId", memberId)}
      onSmsConsentRecorded={() => refresh()}
    />
  );
};

export default TeamsMembersPage;
