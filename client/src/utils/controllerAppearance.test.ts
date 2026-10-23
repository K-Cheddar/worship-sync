import { getLucideEntityIconCatalog } from "../components/icons/iconRegistry";
import {
  CONTROLLER_RECOMMENDED_ICON_GROUPS,
  getLegacyControllerHomeIcon,
  getRenderableControllerHomeIcon,
} from "./controllerAppearance";

describe("controller icon compatibility", () => {
  it("recommends supported graphics, display, camera, and streaming icons", () => {
    const lucideNames = new Set(getLucideEntityIconCatalog().map((entry) =>
      entry.ref.source === "lucide" ? entry.ref.name : "",
    ));
    const recommendationNames = CONTROLLER_RECOMMENDED_ICON_GROUPS.flatMap((group) =>
      group.icons.map((icon) => "name" in icon ? icon.name : ""),
    );

    expect(CONTROLLER_RECOMMENDED_ICON_GROUPS.map((group) => group.label)).toEqual([
      "Presentation & graphics",
      "Monitors & displays",
      "Cameras & video",
      "Streaming & broadcast",
      "Production & technical",
    ]);
    expect(recommendationNames.every((name) => lucideNames.has(name))).toBe(true);
  });

  it("derives a rich picker value from the existing named icon and color", () => {
    expect(getLegacyControllerHomeIcon("camera", "teal", "aux-presentation", 3)).toEqual({
      source: "lucide",
      name: "Camera",
      color: "#5eead4",
    });
  });

  it("uses only renderable saved icons and leaves unsupported values to legacy fallbacks", () => {
    expect(getRenderableControllerHomeIcon({ source: "lucide", name: "Camera" })).toEqual({
      source: "lucide",
      name: "Camera",
    });
    expect(getRenderableControllerHomeIcon({ source: "custom", id: "old-icon" })).toBeUndefined();
    expect(getRenderableControllerHomeIcon({ source: "worshipsync", name: "not-registered" })).toEqual({
      source: "worshipsync",
      name: "not-registered",
    });
  });
});
