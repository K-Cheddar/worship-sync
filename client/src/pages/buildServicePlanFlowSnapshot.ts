import type { PublicServiceFlowSnapshot } from "../services/serviceFlowTypes";
import {
  getServicePlanElementContentResources,
  type ServicePlan,
} from "../types/servicePlan";
import {
  normalizeRichTextDocument,
  isRichTextEmpty,
  multilineTextToRichText,
  richTextToFormattedPlainText,
  richTextToPlainText,
} from "../types/richText";
import { getServicePlanDurationSeconds } from "./Services/servicePlanDuration";
import { resolvePlanTimelineStartMs } from "./Services/servicePlanTimingUtils";
import {
  getPublicServicePlanResourceTitle,
  getSafePublicServicePlanResourceUrl,
  getServicePlanResourceNotes,
  getServicePlanResourceRichNotes,
  getServicePlanResourceText,
} from "./Services/servicePlanResources";

export type ServicePlanFlowSnapshotOptions = {
  plan: ServicePlan;
  startsAt: string;
  churchName?: string;
  serverNowMs?: number;
};

const getPublicResourceDetail = (
  resource: ReturnType<typeof getServicePlanElementContentResources>[number],
) => {
  const detail =
    resource.type === "text"
      ? richTextToFormattedPlainText(getServicePlanResourceText(resource))
      : resource.type === "generic"
        ? getServicePlanResourceNotes(resource)
        : "";
  return detail.trim() || undefined;
};

const getPublicResourceRichText = (
  resource: ReturnType<typeof getServicePlanElementContentResources>[number],
) => resource.type === "text"
  ? getServicePlanResourceText(resource)
  : resource.type === "generic"
    ? getServicePlanResourceRichNotes(resource)
    : multilineTextToRichText("");

const getPublicResources = (
  element: Parameters<typeof getServicePlanElementContentResources>[0],
) =>
  getServicePlanElementContentResources(element).map((resource) => {
    const detail = getPublicResourceDetail(resource);
    const richTextContent = getPublicResourceRichText(resource);
    const url = getSafePublicServicePlanResourceUrl(resource);
    return {
      type: resource.type,
      title: getPublicServicePlanResourceTitle(resource),
      ...(url ? { url } : {}),
      ...(detail ? { detail } : {}),
      ...(!isRichTextEmpty(richTextContent) ? { richTextContent } : {}),
    };
  });

/**
 * Adapts an authenticated, already-sanitized ServicePlan to the shared public
 * order-of-service renderer. No roster, team-note, microphone, or assignee
 * fields are copied into the public snapshot.
 */
export const buildServicePlanFlowSnapshot = ({
  plan,
  startsAt,
  churchName = "",
  serverNowMs = Date.now(),
}: ServicePlanFlowSnapshotOptions): PublicServiceFlowSnapshot => {
  const timezone = plan.timezone || "UTC";
  const timelineStartMs = resolvePlanTimelineStartMs(
    Date.parse(startsAt),
    timezone,
    plan.sections,
  );
  const itemIds = new Set(
    plan.sections.flatMap((section) =>
      section.elements.map((element) => element.id),
    ),
  );
  const live =
    plan.publicLive?.mode === "manual" &&
    itemIds.has(plan.publicLive.currentElementId)
      ? {
          mode: "manual" as const,
          currentItemId: plan.publicLive.currentElementId,
        }
      : plan.publicLive?.mode === "anchored" &&
          itemIds.has(plan.publicLive.currentElementId) &&
          Number.isFinite(Date.parse(plan.publicLive.startedAt))
        ? {
            mode: "anchored" as const,
            currentItemId: plan.publicLive.currentElementId,
            startedAt: plan.publicLive.startedAt,
          }
        : { mode: "schedule" as const };

  return {
    success: true,
    churchName,
    serverNowMs,
    service: {
      shareId: `current-service-viewer:${plan.planKey}`,
      viewMode: "team",
      title: plan.name || "Service",
      startsAt,
      ...(timelineStartMs !== Date.parse(startsAt)
        ? { timelineStartsAt: new Date(timelineStartMs).toISOString() }
        : {}),
      timezone,
      revision: plan.revision || Date.parse(plan.updatedAt || "") || 0,
      sections: plan.sections.map((section, sectionIndex) => ({
        id: section.id || `section-${sectionIndex + 1}`,
        title: section.name || "",
        items: section.elements.map((element, elementIndex) => {
          const resources = getPublicResources(element);
          return {
            id: element.id || `item-${sectionIndex + 1}-${elementIndex + 1}`,
            title: richTextToPlainText(element.title).trim() || "Untitled item",
            durationSeconds: getServicePlanDurationSeconds(element),
            notes: normalizeRichTextDocument(element.notes),
            ...(element.teamNotes?.length
              ? {
                  teamNotes: element.teamNotes.map((teamNote) => ({
                    label: teamNote.label,
                    notes: normalizeRichTextDocument(teamNote.note),
                    ...(teamNote.scope === "role"
                      ? { scope: "role" as const }
                      : {}),
                    ...(teamNote.positionId
                      ? { positionId: teamNote.positionId }
                      : {}),
                    ...(teamNote.positionIds?.length
                      ? { positionIds: teamNote.positionIds }
                      : {}),
                    ...(teamNote.teamId ? { teamId: teamNote.teamId } : {}),
                    ...(teamNote.teamName
                      ? { teamName: teamNote.teamName }
                      : {}),
                    ...(teamNote.teamIds?.length
                      ? { teamIds: teamNote.teamIds }
                      : {}),
                    ...(teamNote.teamNames?.length
                      ? { teamNames: teamNote.teamNames }
                      : {}),
                  })),
                }
              : {}),
            ...(resources.length ? { resources } : {}),
          };
        }),
      })),
      live,
    },
  };
};
