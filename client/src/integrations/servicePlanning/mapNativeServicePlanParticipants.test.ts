import type { OverlayInfo } from "../../types";
import type { ServicePlanningConfig, ServicePlanningElementRule } from "../../types/integrations";
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
  participantOverlay?: ServicePlanElement["participantOverlay"],
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
  servicePlanning: ServicePlanningConfig = {
    enabled: false,
    people: [],
    sectionRules: [],
    elementRules: [],
  },
) => {
  const importData = servicePlanToImportData(sourcePlan);
  const mapping = mapNativeServicePlanParticipants({
    sections: sourcePlan.sections,
    importData,
    participantOverlay: projection,
    servicePlanning,
  });

  return buildServicePlanningPreview({
    importData,
    servicePlanning,
    overlays,
    songLibrary: [],
    activeOutlineList: [],
    nativeOverlayCandidates: mapping.overlayCandidates,
    nativeOverlaySummary: mapping.summary,
  });
};

describe("mapNativeServicePlanParticipants", () => {
  const lessonRule: ServicePlanningElementRule = {
    id: "lesson",
    matchElementType: "Sabbath School Lesson Study",
    matchMode: "contains",
    displayName: "Sabbath School",
    nameSources: ["title", "ledBy"],
    multiOverlay: { mode: "split", eventSuffixByPersonIndex: [" Panelist "] },
  };
  const lessonProjection = readyProjection([{
    elementId: "lesson",
    assignees: [
      { name: "Dr. Avery Stone", memberStatus: "resolved", roleStatus: "resolved", roleTitle: "Lead Pastor" },
      { name: "Morgan Lee", memberStatus: "resolved", roleStatus: "ambiguous" },
      { name: "Jordan Guest", memberStatus: "guest", roleStatus: "not-applicable" },
    ],
  }]);
  const lessonConfig = (rule = lessonRule): ServicePlanningConfig => ({
    enabled: false,
    people: [{ id: "legacy", names: ["Dr. Avery Stone"], displayName: "Legacy Name", title: "Legacy Title" }],
    sectionRules: [],
    elementRules: [rule],
  });

  it.each([undefined, false, true])("uses native rule events and respects repeatLastEventSuffix=%s", (repeatLastEventSuffix) => {
    const preview = buildNativePreview(
      plan([element("lesson", "Sabbath School Lesson Study")]),
      lessonProjection,
      [{ id: "panelist", type: "participant", event: "Sabbath School Panelist", name: "Previous" }],
      lessonConfig({ ...lessonRule, multiOverlay: { ...lessonRule.multiOverlay, repeatLastEventSuffix } }),
    );

    expect(preview.overlayPlan.map((item) => item.patch)).toEqual([
      { name: "Dr. Avery Stone", title: "Lead Pastor", event: "Sabbath School Panelist" },
      { name: "Morgan Lee", title: "", event: repeatLastEventSuffix ? "Sabbath School Panelist" : "Sabbath School" },
      { name: "Jordan Guest", title: "", event: repeatLastEventSuffix ? "Sabbath School Panelist" : "Sabbath School" },
    ]);
    expect(preview.overlayPlan.map((item) => item.action)).toEqual(
      repeatLastEventSuffix
        ? ["update", "clone", "clone"]
        : ["update", "create", "create"],
    );
    expect(preview.overlayPlan[1].resolutionNotice).toMatch(/multiple team roles/i);
  });

  it.each([undefined, "  Teaching  "])("matches the original element type and prioritizes item override %s", (eventLabel) => {
    const preview = buildNativePreview(
      plan([{ ...element("lesson", "A different title", { eventLabel }), sourceElementTypeRaw: "Sabbath School Lesson Study - Discussion" }]),
      lessonProjection,
      [],
      lessonConfig(),
    );

    expect(preview.overlayPlan.map((item) => item.patch.event)).toEqual(
      eventLabel ? ["Teaching", "Teaching", "Teaching"] : ["Sabbath School Panelist", "Sabbath School", "Sabbath School"],
    );
  });

  it("uses the effective rule label without split suffixes in single mode", () => {
    const preview = buildNativePreview(
      plan([element("lesson", "Sabbath School Lesson Study")]),
      lessonProjection,
      [],
      lessonConfig({ ...lessonRule, displayName: "  ", multiOverlay: { ...lessonRule.multiOverlay, mode: "single" } }),
    );

    expect(preview.overlayPlan.map((item) => item.patch.event)).toEqual(Array(3).fill("Sabbath School Lesson Study"));
  });

  it("supports a configured suffix shared with another item label", () => {
    const preview = buildNativePreview(
      plan([element("lesson", "Sabbath School Lesson Study"), element("other", "Sabbath School Panelist")]),
      readyProjection([...lessonProjection.elements, {
        elementId: "other",
        assignees: [{ name: "Guest", memberStatus: "guest", roleStatus: "not-applicable" }],
      }]),
      [],
      lessonConfig(),
    );

    expect(preview.overlayPlan.map((item) => item.action)).toEqual(["create", "create", "create", "create"]);
  });

  it("honors disabled matching rules while leaving unmatched items automatically eligible", () => {
    const preview = buildNativePreview(
      plan([element("lesson", "Sabbath School Lesson Study", { eventLabel: "Override" }), element("prayer", "Prayer")]),
      readyProjection([...lessonProjection.elements, {
        elementId: "prayer",
        assignees: [{ name: "Guest", memberStatus: "guest", roleStatus: "not-applicable" }],
      }]),
      [],
      lessonConfig({ ...lessonRule, overlaySyncEnabled: false }),
    );

    expect(preview.overlayPlan).toHaveLength(1);
    expect(preview.overlayPlan[0]).toMatchObject({ action: "create", patch: { name: "Guest", title: "", event: "Prayer" } });
  });

  it("includes assigned participants without settings and projects current names and TeamRole titles in assignment order", () => {
    const servicePlan = plan([
      element("item-1", "Sermon"),
      { ...element("item-2", "Sermon"), assignees: [] },
    ]);
    servicePlan.sections[0].elements[0].assignees!.push({ id: "guest", name: "Jordan Guest" });
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
      { name: "Dr. Avery Stone", title: "Lead Pastor", event: "Sermon" },
      { name: "Jordan Guest", title: "", event: "Sermon" },
    ]);
    expect(mapping.overlayCandidates[0].candidates[0].patch.name).not.toBe("Stale Name");

    const preview = buildNativePreview(servicePlan, projection, [{
      id: "reusable-sermon",
      type: "participant",
      event: "Sermon",
      name: "Previous participant",
    }]);
    expect(preview.overlayPlan.map((item) => item.action)).toEqual(["update", "clone"]);
  });

  it("keeps the member name and leaves the title blank when team-role context is ambiguous", () => {
    const servicePlan = plan([
      element("item-1", "Sermon"),
    ]);
    const projection = readyProjection([
      {
        elementId: "item-1",
        assignees: [{
          name: "Dr. Avery Stone",
          memberStatus: "resolved",
          roleStatus: "ambiguous",
        }],
      },
    ]);

    const preview = buildNativePreview(servicePlan, projection);

    expect(preview.overlayPlan[0]).toMatchObject({
      action: "create",
      patch: { name: "Dr. Avery Stone", title: "", event: "Sermon" },
      resolutionNotice: expect.stringMatching(/multiple team roles/i),
    });
  });

  it("defaults the event label to the item title and keeps repeated item occurrences", () => {
    const servicePlan = plan([
      element("item-1", "Sermon"),
      element("item-2", "Sermon"),
    ]);
    const projection = readyProjection([
      { elementId: "item-1", assignees: [{ name: "Avery Stone", memberStatus: "resolved", roleStatus: "missing" }] },
      { elementId: "item-2", assignees: [{ name: "Morgan Lee", memberStatus: "resolved", roleStatus: "missing" }] },
    ]);

    const preview = buildNativePreview(servicePlan, projection);

    expect(preview.overlayPlan).toHaveLength(2);
    expect(preview.overlayPlan.map((item) => item.action)).toEqual(["create", "create"]);
    expect(preview.overlayPlan.map((item) => item.patch.event)).toEqual(["Sermon", "Sermon"]);
  });

  it("uses duplicate native event slots while keeping the URL matcher unchanged", () => {
    const servicePlan = plan([element("item-1", "Sermon")]);
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
      action: "update",
      targetOverlayId: "overlay-1",
      sourceKind: "native",
    });
    expect(legacyPreview.overlayPlan[0]).toMatchObject({
      action: "update",
      targetOverlayId: "overlay-1",
    });
  });

  it.each(["failed", "restricted"] as const)("keeps %s roster projection visible and non-syncable", (status) => {
    const servicePlan = plan([element("item-1", "Sermon")]);
    const projection: ServicePlanParticipantOverlayProjection = {
      status,
      elements: [],
    };

    const preview = buildNativePreview(servicePlan, projection);

    expect(preview.nativeOverlaySummary).toEqual({
      status,
      selectedItemCount: 1,
      assignedParticipantCount: null,
    });
    expect(preview.overlayPlan[0]).toMatchObject({
      action: "skip",
      reason: expect.stringMatching(/could not be loaded|not available/i),
    });
  });

  it.each([true, false])("ignores a saved enabled=%s flag and preserves the optional label override", (enabled) => {
    const legacySettings = { enabled, eventLabel: "  Teaching  " };
    const servicePlan = plan([element("item-1", "Sermon", legacySettings)]);
    const preview = buildNativePreview(servicePlan, readyProjection([{
      elementId: "item-1",
      assignees: [{ name: "Guest", memberStatus: "guest", roleStatus: "not-applicable" }],
    }]));

    expect(preview.overlayPlan[0]).toMatchObject({
      action: "create",
      patch: { name: "Guest", title: "", event: "Teaching" },
    });
  });

  it("excludes empty and microphone-only assignments even when settings or projections exist", () => {
    const servicePlan = plan([
      { ...element("empty", "Sermon", { eventLabel: "Teaching" }), assignees: [] },
      { ...element("mic", "Sermon"), assignees: [{ id: "mic-slot", microphoneIds: ["mic-1"] }] },
      { ...element("blank", "Sermon"), assignees: [{ id: "blank", name: "  " }] },
    ]);
    const preview = buildNativePreview(servicePlan, readyProjection([{
      elementId: "empty",
      assignees: [{ name: "Stale Guest", memberStatus: "guest", roleStatus: "not-applicable" }],
    }]));

    expect(preview.overlayCandidates).toEqual([]);
    expect(preview.overlayPlan).toEqual([]);
    expect(preview.nativeOverlaySummary).toMatchObject({ selectedItemCount: 0, assignedParticipantCount: 0 });
  });

  it("supports legacy single assignees without settings or resaving", () => {
    const servicePlan = plan([{
      ...element("item-1", "Sermon"),
      assignees: undefined,
      assignedName: "Guest",
    }]);
    const preview = buildNativePreview(servicePlan, readyProjection([{
      elementId: "item-1",
      assignees: [{ name: "Guest", memberStatus: "guest", roleStatus: "not-applicable" }],
    }]));

    expect(preview.overlayPlan[0]).toMatchObject({ action: "create", patch: { name: "Guest", event: "Sermon" } });
  });

  it("skips missing members and missing or duplicated item projections", () => {
    const servicePlan = plan([element("missing-member", "Prayer"), element("missing-projection", "Welcome"), element("duplicate-projection", "Sermon")]);
    const preview = buildNativePreview(servicePlan, readyProjection([
      { elementId: "missing-member", assignees: [{ name: "Saved name", memberStatus: "missing", roleStatus: "unavailable" }] },
      { elementId: "duplicate-projection", assignees: [] },
      { elementId: "duplicate-projection", assignees: [] },
    ]));

    expect(preview.overlayPlan).toHaveLength(3);
    expect(preview.overlayPlan.every((item) => item.action === "skip")).toBe(true);
  });

  it("does not substitute a generic song heading or Teams role for a missing song title", () => {
    const preview = buildNativePreview(plan([{ ...element("song", "Song of Praise"), type: "song" }]), readyProjection([{
      elementId: "song", assignees: [{ name: "Praise Team", memberStatus: "resolved", roleStatus: "resolved", roleTitle: "Music Leader" }],
    }]));
    expect(preview.overlayPlan[0]).toMatchObject({ action: "skip", patch: { name: "Praise Team", title: "", event: "Song of Praise" }, reason: expect.stringMatching(/song title/i) });
  });

  it("uses a linked song title instead of the generic heading and omits irrelevant blank-role notices", () => {
    const preview = buildNativePreview(plan([{
      ...element("song", "Song of Praise"),
      songRef: { kind: "library", songId: "god-is", songName: "God Is" },
    }]), readyProjection([{
      elementId: "song", assignees: [{ name: "Praise Team", memberStatus: "guest", roleStatus: "missing" }],
    }]));
    expect(preview.overlayPlan[0]).toMatchObject({ action: "create", patch: { name: "Praise Team", title: "God Is", event: "Song of Praise" } });
    expect(preview.overlayPlan[0].resolutionNotice).toBeUndefined();
  });

});
