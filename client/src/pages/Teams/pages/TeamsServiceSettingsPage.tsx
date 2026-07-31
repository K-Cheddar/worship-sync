import ServiceManager from "../managers/ServiceManager";
import { useContext } from "react";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useTeamsPage } from "../TeamsPageContext";

const TeamsServiceSettingsPage = () => {
  const { pageData, canEditTeams } = useTeamsPage();
  const { canEditServices } = useContext(GlobalInfoContext) || {};

  return (
    <ServiceManager
      services={pageData.services}
      positions={pageData.positions}
      teams={pageData.teams}
      canEdit={Boolean(canEditServices ?? canEditTeams)}
    />
  );
};

export default TeamsServiceSettingsPage;
