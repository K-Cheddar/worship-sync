import TeamManager from "../managers/TeamManager";
import { useTeamsPage } from "../TeamsPageContext";

const TeamsGroupsPage = () => {
  const { pageData, upsertData, removeData, refresh, canEditTeams, canEditTeam } =
    useTeamsPage();

  return (
    <TeamManager
      teams={pageData.teams}
      positions={pageData.positions}
      roles={pageData.teamRoles}
      qualificationAreas={pageData.qualificationAreas}
      members={pageData.members}
      data={pageData}
      canEditTeams={canEditTeams}
      canEditTeam={canEditTeam}
      onSaved={(team, replaceId) =>
        upsertData("teams", "teamId", team, replaceId)
      }
      onArchived={() => void refresh()}
      onImported={() => void refresh()}
      onRemoved={(teamId) => removeData("teams", "teamId", teamId)}
      onTeamRosterSaved={(team) => upsertData("teams", "teamId", team)}
      onRosterMemberSaved={(member) => upsertData("members", "memberId", member)}
    />
  );
};

export default TeamsGroupsPage;
