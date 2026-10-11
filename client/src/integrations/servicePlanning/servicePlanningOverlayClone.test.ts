import type { OverlayInfo } from "../../types";
import {
  DEFAULT_SERVICE_PLANNING_OVERLAY_DURATION,
  buildClonedParticipantOverlay,
  buildNewParticipantOverlay,
  findParticipantTemplateForSync,
  applyServicePlanningOverlayPatch,
  persistNewParticipantOverlay,
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

describe("persist finalized participant overlays", () => {
  it("persists the finalized clone fields with new Pouch identity and audit metadata", async () => {
    const template: OverlayInfo = {
      ...p("template", "Sabbath School", "Template Name"),
      title: "Template Title",
      formatting: { participantOverlayPosition: "left" },
      description: "Template description",
      heading: "Template heading",
      subHeading: "Template subheading",
      url: "https://example.com/template",
      imageUrl: "template-image.png",
    };
    const finalized = buildClonedParticipantOverlay(
      template,
      {
        name: "Michael",
        title: "Elder",
        event: "Sabbath School Host",
      },
      "new-host",
      { participantOverlayPosition: "right" },
    );
    const put = jest.fn(async (_doc: unknown) => ({ ok: true, rev: "1-new" }));

    await persistNewParticipantOverlay({ put }, finalized);

    expect(put).toHaveBeenCalledTimes(1);
    const persisted = put.mock.calls[0][0] as Record<string, unknown>;
    expect(persisted).toMatchObject({
      ...finalized,
      _id: "overlay-new-host",
      id: "new-host",
      docType: "overlay",
      type: "participant",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(persisted).toMatchObject({
      formatting: { participantOverlayPosition: "right" },
      description: "",
      heading: "",
      subHeading: "",
      url: "",
      imageUrl: "",
    });
    expect(persisted).not.toHaveProperty("_rev");
  });
});

describe("explicit service-plan overlay updates", () => {
  it("replaces edited mapped values and preserves formatting and unrelated fields", () => {
    const overlay: OverlayInfo = {
      ...p("legacy", "Sabbath School Host", "Manual Name"),
      title: "Manual Title",
      url: "https://example.com/keep",
      formatting: { participantOverlayPosition: "right" },
      servicePlanSource: {
        planKey: "previous-service",
        elementId: "previous-element",
        candidateId: "previous-candidate",
      },
      servicePlanBaseline: { name: "Old Plan Name" },
      servicePlanOverrides: { name: true },
    };

    const updated = applyServicePlanningOverlayPatch(overlay, {
      name: "Current Plan Name",
      title: "Current Title",
      event: "Sabbath School Host",
    });

    expect(updated).toEqual({
      ...overlay,
      name: "Current Plan Name",
      title: "Current Title",
      event: "Sabbath School Host",
    });
  });

  it("clears a mapped title when the current plan has no title", () => {
    const overlay = { ...p("legacy", "Reading", "Manual Name"), title: "Old Title" };

    expect(
      applyServicePlanningOverlayPatch(overlay, {
        name: "Current Name",
        title: undefined,
        event: "Reading",
      }).title,
    ).toBeUndefined();
  });

  it("does not copy old source or override metadata into a new overlay", () => {
    const template: OverlayInfo = {
      ...p("template", "Sabbath School", "Old Name"),
      servicePlanSource: {
        planKey: "previous-service",
        elementId: "previous-element",
        candidateId: "previous-candidate",
      },
      servicePlanBaseline: { name: "Old Name" },
      servicePlanOverrides: { name: true },
    };

    const cloned = buildClonedParticipantOverlay(
      template,
      { name: "New Name", event: "Sabbath School" },
      "new-id",
    );
    const created = buildNewParticipantOverlay(
      { name: "New Name", event: "New Event" },
      "created-id",
    );

    expect(cloned).not.toHaveProperty("servicePlanSource");
    expect(cloned).not.toHaveProperty("servicePlanBaseline");
    expect(cloned).not.toHaveProperty("servicePlanOverrides");
    expect(created).not.toHaveProperty("servicePlanSource");
    expect(created).not.toHaveProperty("servicePlanBaseline");
    expect(created).not.toHaveProperty("servicePlanOverrides");
  });
});
