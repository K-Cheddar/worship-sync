import TeamRoleManager from "../managers/TeamRoleManager";
import { useTeamsPage } from "../TeamsPageContext";

const TeamsRolesPage = () => {
  const { pageData, upsertData, removeData, refresh, canEditTeams } = useTeamsPage();

  return (
    <TeamRoleManager
      roles={pageData.teamRoles}
      teams={pageData.teams}
      canEdit={canEditTeams}
      onSaved={(role, replaceId) =>
        upsertData("teamRoles", "roleId", role, replaceId)
      }
      onArchived={() => void refresh()}
      onRemoved={(roleId) => removeData("teamRoles", "roleId", roleId)}
    />
  );
};

export default TeamsRolesPage;
