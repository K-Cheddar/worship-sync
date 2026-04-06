import { applyQuickLinkReorder } from "./quickLinksReorder";
import type { QuickLinkType } from "../types";

const mk = (
  id: string,
  displayType: QuickLinkType["displayType"]
): QuickLinkType => ({
  id,
  label: id,
  canDelete: true,
  displayType,
  linkType: "media",
});

describe("applyQuickLinkReorder", () => {
  it("reorders within projector group only", () => {
    const quickLinks: QuickLinkType[] = [
      mk("p1", "projector"),
      mk("p2", "projector"),
      mk("m1", "monitor"),
    ];
    const result = applyQuickLinkReorder(quickLinks, false, "p2", "p1");
    expect(result?.map((q) => q.id)).toEqual(["p2", "p1", "m1"]);
  });

  it("returns null when dragging across display types", () => {
    const quickLinks: QuickLinkType[] = [
      mk("p1", "projector"),
      mk("m1", "monitor"),
    ];
    expect(applyQuickLinkReorder(quickLinks, false, "p1", "m1")).toBeNull();
  });

  it("reorders stream-only list against full state", () => {
    const quickLinks: QuickLinkType[] = [
      mk("p1", "projector"),
      mk("s1", "stream"),
      mk("s2", "stream"),
    ];
    const result = applyQuickLinkReorder(quickLinks, true, "s2", "s1");
    expect(result?.map((q) => q.id)).toEqual(["p1", "s2", "s1"]);
  });
});
