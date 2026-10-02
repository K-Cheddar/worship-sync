import type { ServicePlanTemplate } from "../../types/servicePlan";

/** Reusable template catalog contract for Services components. */
export type ServicePlanTemplateResource = {
  data: ServicePlanTemplate[];
  loaded: boolean;
  loading: boolean;
  error: unknown | null;
  ensureLoaded: () => Promise<void>;
  upsert?: (template: ServicePlanTemplate) => void;
  remove?: (templateId: string) => void;
};
