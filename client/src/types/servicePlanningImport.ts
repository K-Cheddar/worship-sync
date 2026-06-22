import type { ParsedBibleRef } from "../integrations/servicePlanning/parseBibleReference";
import type { ServicePlanningMappedRow } from "../integrations/servicePlanning/mapServicePlanningToOverlays";
import type { ServiceItem } from "../types";

export type OutlineItemCandidate = {
  sectionName: string;
  headingName: string | null;
  sourceRowIndex: number;
  elementType: string;
  title: string;
  outlineItemType: "song" | "bible" | "none";
  cleanedTitle: string;
  matchedLibraryItem: ServiceItem | null;
  parsedRef: ParsedBibleRef | null;
  overlayReady: boolean;
  outlineAlreadyPresent: boolean;
};

export type ServicePlanningLineItem = {
  sectionName: string;
  headingName: string | null;
  sourceRowIndex: number;
  elementType: string;
  title: string;
  cleanedTitle: string;
  ledBy: string;
  selectedForOutline: boolean;
  outlineItemType: "song" | "bible" | "none";
  overlayReady: boolean;
  outlineAlreadyPresent: boolean;
  matchedLibraryItem: ServiceItem | null;
  parsedRef: ParsedBibleRef | null;
};

export type OverlaySyncPlanItem = {
  sectionName: string;
  sourceRowIndex: number;
  elementType: string;
  title: string;
  ledBy: string;
  personIndex: number;
  rawNameToken: string;
  action: "update" | "clone" | "create" | "skip";
  placementOnly?: boolean;
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

export type ServicePlanningTeamAssignment = {
  teamName: string;
  role: string;
  name: string;
};

export type ServicePlanningPreview = {
  overlayCandidates: ServicePlanningMappedRow[];
  overlayPlan: OverlaySyncPlanItem[];
  outlineCandidates: OutlineItemCandidate[];
  lineItems: ServicePlanningLineItem[];
  teamAssignments: ServicePlanningTeamAssignment[];
};
