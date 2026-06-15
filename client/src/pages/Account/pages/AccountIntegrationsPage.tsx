import { createDefaultChurchIntegrations } from "../../../types/integrations";
import { IntegrationsSettingsPanel } from "../../Controller/IntegrationsSettingsPanel";
import { useAccountPage } from "../AccountPageContext";
import { AccountIntegrationsPageSkeleton } from "../accountPageSkeletons";

const AccountIntegrationsPage = () => {
  const { churchId, context } = useAccountPage();

  if (context?.churchIntegrationsStatus === "loading") {
    return <AccountIntegrationsPageSkeleton />;
  }

  return (
    <IntegrationsSettingsPanel
      churchId={churchId}
      integrations={
        context?.churchIntegrations ?? createDefaultChurchIntegrations()
      }
      integrationsStatus={context?.churchIntegrationsStatus ?? "loading"}
    />
  );
};

export default AccountIntegrationsPage;
