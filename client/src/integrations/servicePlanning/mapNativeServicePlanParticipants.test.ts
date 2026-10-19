import type { OverlayInfo } from "../../types";
import type {
  ServicePlan,
  ServicePlanElement,
  ServicePlanParticipantOverlayProjection,
} from "../../types/servicePlan";
import { plainTextToRichText } from "../../types/richText";
import { buildServicePlanningPreview } from "./buildServicePlanningPreview";
import { mapNativeServicePlanParticipants } from "./mapNativeServicePlanParticipants";
import { servicePlanToImportData } from "./servicePlanToImportData";

const element = (
  id: string,
  title: string,
  participantOverlay: ServicePlanElement["participantOverlay"],
): ServicePlanElement => ({
  id,
  type: "free",
  title: plainTextToRichText(title),
  assignees: [{ id: `${id}-assignee`, memberId: "member-1", name: "Stale Name" }],
  participantOverlay,
});

const plan = (
  elements: ServicePlanElement[],
  planKey = "service@2026-10-18",
): Pick<ServicePlan, "name" | "sections" | "planKey"> => ({
  name: "Sunday Service",
  planKey,
  sections: [{ id: "section-1", name: "Worship", elements }],
});

const readyProjection = (
  elements: ServicePlanParticipantOverlayProjection["elements"],
): ServicePlanParticipantOverlayProjection => ({ status: "ready", elements });

const buildNativePreview = (
  sourcePlan: ReturnType<typeof plan>,
  projection: ServicePlanParticipantOverlayProjection,
  overlays: OverlayInfo[] = [],
) => {
  const importData = servicePlanToImportData(sourcePlan);
  const mapping = mapNativeServicePlanParticipants({
    sections: sourcePlan.sections,
    importData,
    participantOverlay: projection,
  });

  return buildServicePlanningPreview({
    importData,
    servicePlanning: {
      enabled: false,
      people: [],
      sectionRules: [],
      elementRules: [],
    },
    overlays,
    songLibrary: [],
    activeOutlineList: [],
    nativeOverlayCandidates: mapping.overlayCandidates,
    nativeOverlaySummary: mapping.summary,
  });
};

describe("mapNativeServicePlanParticipants", () => {
  it("uses only opted-in items and projects current names and TeamRole titles in assignment order", () => {
    const servicePlan = plan([
      element("item-1", "Sermon", { enabled: true, eventLabel: "  Teaching  " }),
      element("item-2", "Announcements", { enabled: false }),
    ]);
    const projection = readyProjection([
      {
        elementId: "item-1",
        assignees: [
          {
            name: "Dr. Avery Stone",
            memberStatus: "resolved",
            roleStatus: "resolved",
            roleTitle: "Lead Pastor",
          },
          {
            name: "Jordan Guest",
            memberStatus: "guest",
            roleStatus: "not-applicable",
          },
        ],
      },
    ]);

    const mapping = mapNativeServicePlanParticipants({
      sections: servicePlan.sections,
      importData: servicePlanToImportData(servicePlan),
      participantOverlay: projection,
    });

    expect(mapping.summary).toEqual({
      status: "ready",
      selectedItemCount: 1,
      assignedParticipantCount: 2,
    });
    expect(mapping.overlayCandidates).toHaveLength(1);
    expect(mapping.overlayCandidates[0].candidates.map((candidate) => candidate.patch)).toEqual([
      { name: "Dr. Avery Stone", title: "Lead Pastor", event: "Teaching" },
      { name: "Jordan Guest", title: "", event: "Teaching" },
    ]);
    expect(mapping.overlayCandidates[0].candidates[0].patch.name).not.toBe("Stale Name");
  });

  it("defaults the event label to the item title and skips ambiguous duplicate item labels", () => {
    const servicePlan = plan([
      element("item-1", "Sermon", { enabled: true }),
      element("item-2", "Sermon", { enabled: true }),
    ]);
    const projection = readyProjection([
      { elementId: "item-1", assignees: [{ name: "Avery Stone", memberStatus: "resolved", roleStatus: "missing" }] },
      { elementId: "item-2", assignees: [{ name: "Morgan Lee", memberStatus: "resolved", roleStatus: "missing" }] },
    ]);

    const preview = buildNativePreview(servicePlan, projection);

    expect(preview.overlayPlan).toHaveLength(2);
    expect(preview.overlayPlan.every((item) => item.action === "skip")).toBe(true);
    expect(preview.overlayPlan.map((item) => item.patch.event)).toEqual(["Sermon", "Sermon"]);
    expect(preview.overlayPlan[0].reason).toMatch(/unique event label/i);
  });

  it("treats duplicate exact native targets as ambiguous while keeping the URL matcher unchanged", () => {
    const servicePlan = plan([element("item-1", "Sermon", { enabled: true })]);
    const projection = readyProjection([
      { elementId: "item-1", assignees: [{ name: "Avery Stone", memberStatus: "resolved", roleStatus: "missing" }] },
    ]);
    const duplicateOverlays: OverlayInfo[] = [
      { id: "overlay-1", type: "participant", event: "Sermon" },
      { id: "overlay-2", type: "participant", event: "Sermon" },
    ];

    const nativePreview = buildNativePreview(servicePlan, projection, duplicateOverlays);
    const legacyPreview = buildServicePlanningPreview({
      importData: {
        planLabel: "Imported service",
        sections: [{ sectionName: "Worship", rows: [{ elementType: "Sermon", title: "Sermon", ledBy: "Avery Stone" }] }],
        teamAssignments: [],
      },
      servicePlanning: {
        enabled: true,
        people: [{ id: "avery", names: ["Avery Stone"], displayName: "Avery Stone" }],
        sectionRules: [],
        elementRules: [{
          id: "sermon-rule",
          matchElementType: "Sermon",
          matchMode: "exact",
          displayName: "Sermon",
          nameSources: ["ledBy"],
          multiOverlay: { mode: "single" },
        }],
      },
      overlays: duplicateOverlays,
      songLibrary: [],
      activeOutlineList: [],
    });

    expect(nativePreview.overlayPlan[0]).toMatchObject({
      action: "skip",
      duplicateExactMatchesAreAmbiguous: true,
    });
    expect(legacyPreview.overlayPlan[0]).toMatchObject({
      action: "update",
      targetOverlayId: "overlay-1",
    });
  });

  it("keeps unavailable roster projection visible and non-syncable", () => {
    const servicePlan = plan([element("item-1", "Sermon", { enabled: true })]);
    const projection: ServicePlanParticipantOverlayProjection = {
      status: "failed",
      elements: [],
    };

    const preview = buildNativePreview(servicePlan, projection);

    expect(preview.nativeOverlaySummary).toEqual({
      status: "failed",
      selectedItemCount: 1,
      assignedParticipantCount: null,
    });
    expect(preview.overlayPlan[0]).toMatchObject({
      action: "skip",
      reason: expect.stringMatching(/could not be loaded/i),
    });
  });
});
