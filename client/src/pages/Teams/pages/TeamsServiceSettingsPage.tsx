import ServiceManager from "../managers/ServiceManager";
import { useTeamsPage } from "../TeamsPageContext";

const TeamsServiceSettingsPage = () => {
  const { pageData, canEditTeams } = useTeamsPage();

  return (
    <ServiceManager
      services={pageData.services}
      positions={pageData.positions}
      teams={pageData.teams}
      canEdit={canEditTeams}
    />
  );
};

export default TeamsServiceSettingsPage;
