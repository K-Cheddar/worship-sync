import type { OverlayInfo } from "../../types";
import {
  buildClonedParticipantOverlay,
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

  it("falls back to first participant when event not found", () => {
    const list: OverlayInfo[] = [p("z", "Other")];
    expect(findParticipantTemplateForSync(list, "Unknown Event")?.id).toBe("z");
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
});
