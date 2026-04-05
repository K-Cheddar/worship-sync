import {
  getOverlayIdFromPresentation,
  mergeStoredPresentationWithLiveOverlay,
  presentationFromOverlayInfo,
} from "./quickLinkOverlayPresentation";
import type { OverlayInfo, Presentation } from "../types";

describe("quickLinkOverlayPresentation", () => {
  it("getOverlayIdFromPresentation reads id from overlay presentation fields", () => {
    const p: Presentation = {
      type: "overlay",
      name: "x",
      slide: null,
      qrCodeOverlayInfo: { id: "q1", type: "qr-code" },
    };
    expect(getOverlayIdFromPresentation(p)).toBe("q1");
    expect(getOverlayIdFromPresentation(undefined)).toBeNull();
  });

  it("presentationFromOverlayInfo matches participant overlay shape", () => {
    const o: OverlayInfo = {
      id: "p1",
      type: "participant",
      name: "N",
      title: "T",
      event: "E",
      formatting: { backgroundColor: "#abc" },
    };
    const p = presentationFromOverlayInfo(o);
    expect(p.type).toBe("overlay");
    expect(p.participantOverlayInfo?.id).toBe("p1");
    expect(p.participantOverlayInfo?.name).toBe("N");
    expect(p.participantOverlayInfo?.formatting?.backgroundColor).toBe("#abc");
  });

  it("mergeStoredPresentationWithLiveOverlay replaces snapshot when id matches list", () => {
    const stored: Presentation = {
      type: "overlay",
      name: "Stale",
      slide: null,
      participantOverlayInfo: {
        id: "o1",
        type: "participant",
        name: "Stale",
        formatting: {},
      },
    };
    const list: OverlayInfo[] = [
      {
        id: "o1",
        type: "participant",
        name: "Fresh",
        title: "T2",
        formatting: { backgroundColor: "#fff" },
      },
    ];
    const merged = mergeStoredPresentationWithLiveOverlay(stored, list);
    expect(merged?.name).toBe("Fresh");
    expect(merged?.participantOverlayInfo?.name).toBe("Fresh");
    expect(merged?.participantOverlayInfo?.title).toBe("T2");
  });

  it("mergeStoredPresentationWithLiveOverlay keeps stored data when overlay id not in list", () => {
    const stored: Presentation = {
      type: "overlay",
      name: "Only",
      slide: null,
      participantOverlayInfo: {
        id: "missing",
        type: "participant",
        name: "Only",
      },
    };
    const merged = mergeStoredPresentationWithLiveOverlay(stored, []);
    expect(merged?.participantOverlayInfo?.name).toBe("Only");
  });

  it("mergeStoredPresentationWithLiveOverlay passes through non-overlay presentations", () => {
    const stored: Presentation = {
      type: "slide",
      name: "S",
      slide: null,
    };
    expect(mergeStoredPresentationWithLiveOverlay(stored, [])).toBe(stored);
  });
});
