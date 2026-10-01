import { createContext, useCallback, useContext, type ReactNode } from "react";
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
  const { remove: removeTemplate, upsert: upsertTemplate } = domainResources.templates;
  const onTemplateEvent = useCallback((
    event: ServicePlanTemplateUpdatedEvent | ServicePlanTemplateRemovedEvent,
  ) => {
    if (event.type === "service-plan-template-updated") {
      upsertTemplate(event.template);
    } else {
      removeTemplate(event.templateId);
    }
  }, [removeTemplate, upsertTemplate]);
  const pageState = useTeamsPageState(onTemplateEvent);
  const value = {
    ...pageState,
    ...domainResources,
  };

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
