import type { ParsedBibleRef } from "../integrations/servicePlanning/parseBibleReference";
import type { ServicePlanningMappedRow } from "../integrations/servicePlanning/mapServicePlanningToOverlays";
import type { ServiceItem } from "../types";

export type OutlineItemCandidate = {
  sectionName: string;
  headingName: string | null;
  elementType: string;
  title: string;
  outlineItemType: "song" | "bible" | "none";
  cleanedTitle: string;
  matchedLibraryItem: ServiceItem | null;
  parsedRef: ParsedBibleRef | null;
  overlayReady: boolean;
  outlineAlreadyPresent: boolean;
};

export type OverlaySyncPlanItem = {
  sectionName: string;
  elementType: string;
  title: string;
  ledBy: string;
  personIndex: number;
  rawNameToken: string;
  action: "update" | "clone" | "create" | "skip";
  targetOverlayId?: string;
  targetOverlayName?: string;
  targetOverlayEvent?: string;
  patch: {
    name?: string;
    title?: string;
    event?: string;
  };
  reason?: string;
};

export type ServicePlanningPreview = {
  overlayCandidates: ServicePlanningMappedRow[];
  overlayPlan: OverlaySyncPlanItem[];
  outlineCandidates: OutlineItemCandidate[];
};
