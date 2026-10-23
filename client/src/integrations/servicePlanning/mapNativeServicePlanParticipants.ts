import type { ServicePlanningImportData } from "../../containers/Overlays/eventParser";
import { richTextToPlainText } from "../../types/richText";
import { getServicePlanElementAssignees } from "../../types/servicePlan";
import type {
  ServicePlanParticipantOverlayProjection,
  ServicePlanSection,
} from "../../types/servicePlan";
import { normalizeOverlayEvent } from "./findBestOverlayMatch";
import type {
  ServicePlanningCandidate,
  ServicePlanningFieldPatch,
  ServicePlanningMappedRow,
} from "./mapServicePlanningToOverlays";
import type { NativeServicePlanOverlaySummary } from "../../types/servicePlanningImport";

export type NativeServicePlanOverlayMapping = {
  overlayCandidates: ServicePlanningMappedRow[];
  summary: NativeServicePlanOverlaySummary;
};

const getRoleNotice = (
  status: ServicePlanParticipantOverlayProjection["elements"][number]["assignees"][number]["roleStatus"],
): string | undefined => {
  if (status === "ambiguous") {
    return "The member has multiple team roles and this item does not identify one team. The title will be blank.";
  }
  if (status === "archived") {
    return "The member's Team role is archived. The title will be blank.";
  }
  if (status === "missing") {
    return "No configured Team role is available for this member. The title will be blank.";
  }
  if (status === "unavailable") {
    return "The Team role could not be resolved. The title will be blank.";
  }
  return undefined;
};

const getUnavailableProjectionReason = (
  status: ServicePlanParticipantOverlayProjection["status"],
): string =>
  status === "restricted"
    ? "Assigned participant details are not available in this Controller session."
    : "Assigned participant details could not be loaded. Refresh the plan before syncing.";

/** Build native overlay candidates directly from plan items with assigned people. */
export const mapNativeServicePlanParticipants = ({
  sections,
  importData,
  participantOverlay,
}: {
  sections: ServicePlanSection[];
  importData: ServicePlanningImportData;
  participantOverlay: ServicePlanParticipantOverlayProjection;
}): NativeServicePlanOverlayMapping => {
  const projectionsByElementId = new Map<string, number>();
  participantOverlay.elements.forEach(({ elementId }) => {
    projectionsByElementId.set(
      elementId,
      (projectionsByElementId.get(elementId) ?? 0) + 1,
    );
  });
  const overlayCandidates: ServicePlanningMappedRow[] = [];
  const eventGroups = new Map<string, ServicePlanningMappedRow[]>();
  let selectedItemCount = 0;
  let assignedParticipantCount = 0;

  sections.forEach((section, sectionIndex) => {
    section.elements.forEach((element, sourceRowIndex) => {
      if (!getServicePlanElementAssignees(element).some(
        (assignee) => assignee.memberId?.trim() || assignee.name?.trim(),
      )) return;
      selectedItemCount += 1;

      const source = importData.sections[sectionIndex]?.rows[sourceRowIndex];
      if (!source) return;
      const itemTitle = richTextToPlainText(element.title).trim();
      const eventLabel =
        element.participantOverlay?.eventLabel?.trim() || itemTitle;
      const defaultSkipReason = !eventLabel
        ? "Add an item title or event label before syncing this participant."
        : undefined;
      const planElementKey = `${sectionIndex}:${element.id}:${sourceRowIndex}`;
      const row: ServicePlanningMappedRow = {
        source,
        sourceKind: "native",
        matchKey: planElementKey,
        candidates: [],
      };

      if (participantOverlay.status !== "ready") {
        row.candidates.push({
          personIndex: 0,
          rawNameToken: "",
          patch: { name: "", title: "", event: eventLabel },
          skipReason: getUnavailableProjectionReason(participantOverlay.status),
        });
        overlayCandidates.push(row);
        const normalizedLabel = normalizeOverlayEvent(eventLabel);
        if (normalizedLabel) {
          const group = eventGroups.get(normalizedLabel) ?? [];
          group.push(row);
          eventGroups.set(normalizedLabel, group);
        }
        return;
      }

      const matchingProjectionCount =
        projectionsByElementId.get(element.id) ?? 0;
      const projection = participantOverlay.elements.find(
        (candidate) => candidate.elementId === element.id,
      );
      if (matchingProjectionCount !== 1 || !projection) {
        row.candidates.push({
          personIndex: 0,
          rawNameToken: "",
          patch: { name: "", title: "", event: eventLabel },
          skipReason:
            "Participant details for this item are unavailable. Refresh the plan before syncing.",
        });
        overlayCandidates.push(row);
        const normalizedLabel = normalizeOverlayEvent(eventLabel);
        if (normalizedLabel) {
          const group = eventGroups.get(normalizedLabel) ?? [];
          group.push(row);
          eventGroups.set(normalizedLabel, group);
        }
        return;
      }

      assignedParticipantCount += projection.assignees.length;
      const candidates: ServicePlanningCandidate[] = projection.assignees.map(
        (assignee, personIndex) => {
          const patch: ServicePlanningFieldPatch = {
            name: assignee.name.trim(),
            title:
              assignee.roleStatus === "resolved"
                ? assignee.roleTitle?.trim() ?? ""
                : "",
            event: eventLabel,
          };
          const skipReason =
            defaultSkipReason ||
            (assignee.memberStatus === "missing"
              ? "The assigned Teams member could not be resolved. This overlay will be skipped."
              : !patch.name
                ? "The assigned participant has no name. This overlay will be skipped."
                : undefined);
          return {
            personIndex,
            rawNameToken: assignee.name,
            patch,
            ...(skipReason ? { skipReason } : {}),
            ...(getRoleNotice(assignee.roleStatus)
              ? { resolutionNotice: getRoleNotice(assignee.roleStatus) }
              : {}),
          };
        },
      );
      row.candidates = candidates;
      overlayCandidates.push(row);

      const normalizedLabel = normalizeOverlayEvent(eventLabel);
      if (normalizedLabel) {
        const group = eventGroups.get(normalizedLabel) ?? [];
        group.push(row);
        eventGroups.set(normalizedLabel, group);
      }
    });
  });

  for (const [eventLabel, rows] of eventGroups) {
    const distinctItems = new Set(rows.map((row) => row.matchKey));
    if (distinctItems.size < 2) continue;
    for (const row of rows) {
      row.candidates = row.candidates.map((candidate) => ({
        ...candidate,
        skipReason: `More than one plan item with assigned participants uses the event label "${eventLabel}". Give each item a unique event label before syncing.`,
      }));
    }
  }

  return {
    overlayCandidates,
    summary: {
      status: participantOverlay.status,
      selectedItemCount,
      assignedParticipantCount:
        participantOverlay.status === "ready"
          ? assignedParticipantCount
          : null,
    },
  };
};
