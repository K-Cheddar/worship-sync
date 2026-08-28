import ServiceManager from "../managers/ServiceManager";
import { useContext, useEffect, useState } from "react";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useTeamsPage } from "../TeamsPageContext";
import { listServicePlanTemplates } from "../../../api/auth";
import { useToast } from "../../../context/toastContext";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import type { ServicePlanTemplate } from "../../../types/servicePlan";

const TeamsServiceSettingsPage = () => {
  const { pageData, canEditTeams } = useTeamsPage();
  const { churchId, canEditServices } = useContext(GlobalInfoContext) || {};
  const { showToast } = useToast();
  const [planTemplates, setPlanTemplates] = useState<ServicePlanTemplate[]>([]);

  useEffect(() => {
    if (!churchId) {
      setPlanTemplates([]);
      return undefined;
    }
    let cancelled = false;
    listServicePlanTemplates(churchId)
      .then((response) => {
        if (!cancelled) setPlanTemplates(response.templates);
      })
      .catch((error) => {
        if (!cancelled) {
          showApiErrorToast(
            showToast,
            error,
            "Could not load plan templates. Try again.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [churchId, showToast]);

  return (
    <ServiceManager
      services={pageData.services}
      positions={pageData.positions}
      teams={pageData.teams}
      planTemplates={planTemplates}
      canEdit={Boolean(canEditServices ?? canEditTeams)}
    />
  );
};

export default TeamsServiceSettingsPage;
