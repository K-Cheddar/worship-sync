import type { OverlayInfo } from "../../types";
import {
  DEFAULT_SERVICE_PLANNING_OVERLAY_DURATION,
  buildClonedParticipantOverlay,
  buildNewParticipantOverlay,
  findParticipantTemplateForSync,
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
