import TeamManager from "../managers/TeamManager";
import { useTeamsPage } from "../TeamsPageContext";

const TeamsGroupsPage = () => {
  const { pageData, upsertData, removeData, refresh, canEditTeams } =
    useTeamsPage();

  return (
    <TeamManager
      teams={pageData.teams}
      positions={pageData.positions}
      members={pageData.members}
      data={pageData}
      canEdit={canEditTeams}
      onSaved={(team, replaceId) =>
        upsertData("teams", "teamId", team, replaceId)
      }
      onArchived={() => void refresh()}
      onRemoved={(teamId) => removeData("teams", "teamId", teamId)}
    />
  );
};

export default TeamsGroupsPage;
