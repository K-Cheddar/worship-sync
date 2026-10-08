import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useTeamsPageState } from "./hooks/useTeamsPageState";
import { useTeamsDomainResources } from "./hooks/useTeamsDomainResources";
import type {
  ServicePlanTemplateRemovedEvent,
  ServicePlanTemplateUpdatedEvent,
} from "./hooks/useTeamsLiveSync";

export type TeamsPageState = ReturnType<typeof useTeamsPageState> & ReturnType<typeof useTeamsDomainResources>;

const TeamsPageContext = createContext<TeamsPageState | null>(null);

export const TeamsPageProvider = ({ children }: { children: ReactNode }) => {
  const domainResources = useTeamsDomainResources();
  const templatesLoaded = domainResources.templates.loaded;
  const refreshTemplates = domainResources.templates.refresh;
  const { remove: removeTemplate } = domainResources.templates;
  const onTemplateEvent = useCallback((
    event: ServicePlanTemplateUpdatedEvent | ServicePlanTemplateRemovedEvent,
  ) => {
    if (event.type === "service-plan-template-updated") {
      if (templatesLoaded || domainResources.templates.loading) {
        void refreshTemplates().catch((error: unknown) => {
          console.error("Could not refresh service plan templates.", error);
        });
      }
    } else {
      removeTemplate(event.templateId);
    }
  }, [domainResources.templates.loading, refreshTemplates, removeTemplate, templatesLoaded]);
  const onTemplateRecovery = useCallback(() => {
    if (!templatesLoaded) return;
    void refreshTemplates().catch((error: unknown) => {
      // Reconnect recovery stays silent; the resource keeps its last good data
      // visible and a later reconnect/focus recovery can retry.
      console.error("Could not reconcile service plan templates.", error);
    });
  }, [refreshTemplates, templatesLoaded]);
  const pageState = useTeamsPageState(onTemplateEvent, onTemplateRecovery);
  const value = useMemo(() => ({
    ...pageState,
    ...domainResources,
  }), [pageState, domainResources]);

  return (
    <TeamsPageContext.Provider value={value}>
      {children}
    </TeamsPageContext.Provider>
  );
};

export const useTeamsPage = () => {
  const context = useContext(TeamsPageContext);
  if (!context) {
    throw new Error("useTeamsPage must be used within TeamsPageProvider.");
  }
  return context;
};
