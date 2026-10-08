import ServiceManager from "../managers/ServiceManager";
import { useContext, useEffect } from "react";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useTeamsPage } from "../TeamsPageContext";
import { useToast } from "../../../context/toastContext";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import ChurchServiceTimeZoneSettings from "../ChurchServiceTimeZoneSettings";

const TeamsServiceSettingsPage = () => {
  const { pageData, canEditTeams, refresh, templates } = useTeamsPage();
  const { data: planTemplates, ensureLoaded } = templates;
  const { canEditServices, churchId } = useContext(GlobalInfoContext) || {};
  const { showToast } = useToast();

  useEffect(() => {
    void ensureLoaded().catch((error: unknown) => {
      showApiErrorToast(
        showToast,
        error,
        "Could not load plan templates. Try again.",
      );
    });
  }, [ensureLoaded, showToast]);

  const canEdit = Boolean(canEditServices ?? canEditTeams);

  return (
    <>
      {churchId && (
        <ChurchServiceTimeZoneSettings
          churchId={churchId}
          canEdit={canEdit}
        />
      )}
      <ServiceManager
        services={pageData.services}
        positions={pageData.positions}
        teams={pageData.teams}
        planTemplates={planTemplates}
        canEdit={canEdit}
        onImported={() => void refresh()}
      />
    </>
  );
};

export default TeamsServiceSettingsPage;
