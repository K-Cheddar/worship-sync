import { createDefaultCurrentServiceWorkspace } from "../../../utils/currentServiceWorkspace";
import { CurrentServiceWorkspaceSettingsPanel } from "../../Controller/CurrentServiceWorkspaceSettingsPanel";
import { useAccountPage } from "../AccountPageContext";
import { AccountWorkspacePageSkeleton } from "../accountPageSkeletons";

const AccountWorkspacePage = () => {
  const { churchId, context } = useAccountPage();

  if (context?.currentServiceWorkspaceStatus === "loading") {
    return <AccountWorkspacePageSkeleton />;
  }

  return (
    <CurrentServiceWorkspaceSettingsPanel
      churchId={churchId}
      configuration={
        context?.currentServiceWorkspace ??
        createDefaultCurrentServiceWorkspace()
      }
      configurationStatus={context?.currentServiceWorkspaceStatus ?? "loading"}
    />
  );
};

export default AccountWorkspacePage;
