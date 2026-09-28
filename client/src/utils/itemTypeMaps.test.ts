import {
  getItemTypeLabel,
  borderColorMap,
  iconColorMap,
  svgMap,
  overlayBorderColorMap,
  overlayTextColorMap,
  overlayTypeLabelMap,
} from "./itemTypeMaps";
import { CalendarClock, File, Music, Timer } from "lucide-react";

describe("getItemTypeLabel", () => {
  it("returns 'item' for undefined", () => {
    expect(getItemTypeLabel(undefined)).toBe("item");
  });

  it("returns 'item' for empty string", () => {
    expect(getItemTypeLabel("")).toBe("item");
  });

  it("returns mapped label for known types", () => {
    expect(getItemTypeLabel("song")).toBe("song");
    expect(getItemTypeLabel("video")).toBe("video");
    expect(getItemTypeLabel("bible")).toBe("Bible item");
    expect(getItemTypeLabel("timer")).toBe("timer");
    expect(getItemTypeLabel("free")).toBe("custom item");
    expect(getItemTypeLabel("announcement")).toBe("announcement");
    expect(getItemTypeLabel("overlays")).toBe("overlay");
  });

  it("returns the raw type string for unknown types", () => {
    expect(getItemTypeLabel("custom-unknown")).toBe("custom-unknown");
  });
});

describe("borderColorMap", () => {
  it("contains border class entries for core item types", () => {
    const types = ["song", "video", "image", "bible", "timer", "free", "overlays"];
    types.forEach((type) => {
      expect(borderColorMap.has(type)).toBe(true);
      expect(borderColorMap.get(type)).toMatch(/^border-/);
    });
  });
});

describe("iconColorMap", () => {
  it("contains hex color strings for core item types", () => {
    const types = ["song", "video", "image", "bible", "timer", "free"];
    types.forEach((type) => {
      expect(iconColorMap.has(type)).toBe(true);
      expect(iconColorMap.get(type)).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  it("uses the established icons and colors for the library table types", () => {
    expect(svgMap.get("song")).toBe(Music);
    expect(iconColorMap.get("song")).toBe("#3b82f6");
    expect(svgMap.get("free")).toBe(File);
    expect(iconColorMap.get("free")).toBe("#f97316");
    expect(svgMap.get("timer")).toBe(Timer);
    expect(iconColorMap.get("timer")).toBe("#ec4899");
    expect(svgMap.get("service-time")).toBe(CalendarClock);
    expect(iconColorMap.get("service-time")).toBe("#8b5cf6");
  });
});

describe("overlayBorderColorMap", () => {
  it("has border-l entries for all four overlay types", () => {
    const types = ["participant", "stick-to-bottom", "qr-code", "image"];
    types.forEach((type) => {
      expect(overlayBorderColorMap.has(type)).toBe(true);
      expect(overlayBorderColorMap.get(type)).toMatch(/^border-l-/);
    });
  });
});

describe("overlayTextColorMap", () => {
  it("has text-color entries for all four overlay types", () => {
    const types = ["participant", "stick-to-bottom", "qr-code", "image"];
    types.forEach((type) => {
      expect(overlayTextColorMap.has(type)).toBe(true);
      expect(overlayTextColorMap.get(type)).toMatch(/^text-/);
    });
  });
});

describe("overlayTypeLabelMap", () => {
  it("returns display labels for all overlay types", () => {
    expect(overlayTypeLabelMap.get("participant")).toBe("Participant");
    expect(overlayTypeLabelMap.get("stick-to-bottom")).toBe("Stick to bottom");
    expect(overlayTypeLabelMap.get("qr-code")).toBe("QR code");
    expect(overlayTypeLabelMap.get("image")).toBe("Image");
  });
});
