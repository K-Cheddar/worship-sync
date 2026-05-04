import type {
  OutlineItemCandidate,
  OverlaySyncPlanItem,
  ServicePlanningLineItem,
} from "../types/servicePlanningImport";

const normalizePart = (value?: string | null) =>
  (value || "").trim().toLowerCase().replace(/\s+/g, " ");

export const getServicePlanningLineItemKey = ({
  sectionName,
  sourceRowIndex,
  elementType,
  title,
}: Pick<
  ServicePlanningLineItem,
  "sectionName" | "sourceRowIndex" | "elementType" | "title"
>) =>
  [
    normalizePart(sectionName),
    String(sourceRowIndex),
    normalizePart(elementType),
    normalizePart(title),
  ].join("::");

export const getOutlineCandidateLineItemKey = (
  candidate: OutlineItemCandidate,
) =>
  getServicePlanningLineItemKey({
    sectionName: candidate.sectionName,
    sourceRowIndex: candidate.sourceRowIndex,
    elementType: candidate.elementType,
    title: candidate.title,
  });

export const getOverlayPlanLineItemKey = (item: OverlaySyncPlanItem) =>
  getServicePlanningLineItemKey({
    sectionName: item.sectionName,
    sourceRowIndex: item.sourceRowIndex,
    elementType: item.elementType,
    title: item.title,
  });
