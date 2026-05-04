import type { ServicePlanningPreview } from "./servicePlanningImport";

export type ItemListImportSource = "servicePlanning";

export type ServiceOutline = {
  source: ItemListImportSource;
  loadedAt: string;
  sourceUrl: string;
  planLabel: string;
  preview: ServicePlanningPreview;
};
