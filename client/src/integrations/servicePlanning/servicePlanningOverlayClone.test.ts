import type { OverlayInfo } from "../../types";
import {
  DEFAULT_SERVICE_PLANNING_OVERLAY_DURATION,
  buildClonedParticipantOverlay,
  buildNewParticipantOverlay,
  findParticipantTemplateForSync,
  mergeServicePlanOverlayFields,
  trackServicePlanOverlayEdit,
} from "./servicePlanningOverlayClone";

const p = (id: string, event: string, name?: string): OverlayInfo => ({
  id,
  type: "participant",
  event,
  name,
});

describe("findParticipantTemplateForSync", () => {
  it("prefers participant with exact event match", () => {
    const list: OverlayInfo[] = [
      p("a", "Sabbath School Host"),
      p("b", "Sabbath School Co-Host"),
      p("c", "Welcome"),
    ];
    expect(
      findParticipantTemplateForSync(list, "Sabbath School Co-Host")?.id,
    ).toBe("b");
  });

  it("returns null when there is no exact participant event template", () => {
    const list: OverlayInfo[] = [p("z", "Other")];
    expect(findParticipantTemplateForSync(list, "Unknown Event")).toBeNull();
  });
});

describe("buildClonedParticipantOverlay", () => {
  it("copies formatting and applies patch", () => {
    const template = p("t", "Sabbath School Co-Host", "Old");
    template.formatting = { participantOverlayPosition: "left" };
    const built = buildClonedParticipantOverlay(
      template,
      { name: "New Name", event: "Sabbath School Co-Host", title: "Teacher" },
      "new-id",
    );
    expect(built.id).toBe("new-id");
    expect(built.name).toBe("New Name");
    expect(built.title).toBe("Teacher");
    expect(built.event).toBe("Sabbath School Co-Host");
    expect(built.formatting?.participantOverlayPosition).toBe("left");
  });

  it("uses the configured default formatting when supplied", () => {
    const built = buildClonedParticipantOverlay(
      {
        ...p("t", "Sabbath School"),
        formatting: { participantOverlayPosition: "left" },
      },
      { name: "New Name", event: "Sabbath School" },
      "new-id",
      { participantOverlayPosition: "right" },
    );

    expect(built.formatting?.participantOverlayPosition).toBe("right");
  });

  it("clears stale template titles when the service plan has no matching title", () => {
    const template = p("t", "Sabbath School", "Old");
    template.title = "Stale Title";

    const built = buildClonedParticipantOverlay(
      template,
      { name: "New Name", event: "Sabbath School", title: undefined },
      "new-id",
    );

    expect(built.title).toBe("");
  });

  it("keeps the template duration and falls back to the Service Planning default", () => {
    expect(
      buildClonedParticipantOverlay(
        { ...p("t", "Sabbath School"), duration: 12 },
        { name: "New Name", event: "Sabbath School" },
        "new-id",
      ).duration,
    ).toBe(12);

    expect(
      buildClonedParticipantOverlay(
        p("t", "Sabbath School"),
        { name: "New Name", event: "Sabbath School" },
        "new-id",
      ).duration,
    ).toBe(DEFAULT_SERVICE_PLANNING_OVERLAY_DURATION);
  });
});

describe("buildNewParticipantOverlay", () => {
  it("creates a participant overlay with cleared non-participant fields", () => {
    const built = buildNewParticipantOverlay(
      { name: "Jane Doe", title: "Speaker", event: "Sermon" },
      "new-id",
    );

    expect(built).toEqual(
      expect.objectContaining({
        id: "new-id",
        type: "participant",
        name: "Jane Doe",
        title: "Speaker",
        event: "Sermon",
        duration: DEFAULT_SERVICE_PLANNING_OVERLAY_DURATION,
        heading: "",
        subHeading: "",
        url: "",
        description: "",
        imageUrl: "",
      }),
    );
    expect(built.formatting).toBeTruthy();
  });
});

describe("plan generated overlay field ownership", () => {
  const source = { planKey: "service@2026-09-25", elementId: "element-1", candidateId: "element-1:0" };

  it("preserves an edited name while updating untouched title and event fields", () => {
    const generated = buildNewParticipantOverlay(
      { name: "Plan Name", title: "Reader", event: "Reading" },
      "overlay-1",
      undefined,
      source,
    );
    const edited = trackServicePlanOverlayEdit(generated, { name: "Corrected Name" });
    const refreshed = mergeServicePlanOverlayFields(edited, {
      name: "Changed Plan Name",
      title: "Scripture Reader",
      event: "Reading of the Word",
    }, source);

    expect(refreshed.name).toBe("Corrected Name");
    expect(refreshed.title).toBe("Scripture Reader");
    expect(refreshed.event).toBe("Reading of the Word");
    expect(refreshed.servicePlanOverrides).toEqual({ name: true });
  });

  it("lets an operator reset one field to the current plan value", () => {
    const generated = buildNewParticipantOverlay(
      { name: "Plan Name", title: "Reader", event: "Reading" },
      "overlay-1",
      undefined,
      source,
    );
    const edited = trackServicePlanOverlayEdit(generated, { name: "Corrected Name" });
    const reset = trackServicePlanOverlayEdit(edited, { name: "Plan Name" });
    const refreshed = mergeServicePlanOverlayFields(reset, {
      name: "Updated Plan Name",
      title: "Updated Reader",
      event: "Updated Reading",
    }, source);

    expect(refreshed.name).toBe("Updated Plan Name");
    expect(refreshed.servicePlanOverrides?.name).toBeUndefined();
  });

  it("keeps legacy overlay values and flags the new source association for review", () => {
    const legacy = p("legacy", "Reading", "Operator Name");
    legacy.title = "Operator Title";
    const associated = mergeServicePlanOverlayFields(legacy, {
      name: "Plan Name",
      title: "Plan Title",
      event: "Reading",
    }, source);

    expect(associated.name).toBe("Operator Name");
    expect(associated.title).toBe("Operator Title");
    expect(associated.servicePlanReviewRequired).toBe(true);
    expect(associated.servicePlanOverrides).toEqual({ name: true, title: true, event: true });
  });
});
