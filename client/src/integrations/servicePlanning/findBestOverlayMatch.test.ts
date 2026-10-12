import type { OverlayInfo } from "../../types";
import { findOverlayForServicePlanningCandidate } from "./findBestOverlayMatch";

const participant = (
  id: string,
  event: string,
  metadata?: OverlayInfo["servicePlanSource"],
): OverlayInfo => ({
  id,
  type: "participant",
  event,
  ...(metadata ? { servicePlanSource: metadata } : {}),
});

describe("findOverlayForServicePlanningCandidate", () => {
  it("matches a previous week's overlay even when its source plan differs", () => {
    const previousWeek = participant("weekly-host", "Sabbath School Host", {
      planKey: "service@2026-09-25",
      elementId: "element-previous",
      candidateId: "element-previous:0",
    });

    expect(
      findOverlayForServicePlanningCandidate(
        "Sabbath School",
        "Sabbath School Host",
        [previousWeek],
      ),
    ).toEqual({ kind: "match", overlay: previousWeek, score: 100 });
  });

  it("normalizes case and whitespace, then prefers the exact configured event", () => {
    const exact = participant("exact", "  sabbath   school HOST ");
    const broader = participant("broader", "Sabbath School");

    const result = findOverlayForServicePlanningCandidate(
      "Sabbath School",
      "Sabbath School Host",
      [broader, exact],
    );

    expect(result).toEqual({ kind: "match", overlay: exact, score: 100 });
  });

  it("maps repeated participants with one event label to distinct ordered overlays", () => {
    const list = [
      participant("cohost-a", "Sabbath School Co-Host"),
      participant("cohost-b", "Sabbath School Co-Host"),
    ];
    const claimed = new Set<string>();

    const first = findOverlayForServicePlanningCandidate(
      "Sabbath School",
      "Sabbath School Co-Host",
      list,
      claimed,
    );
    expect(first.kind).toBe("match");
    if (first.kind !== "match") throw new Error("Expected first overlay match");
    claimed.add(first.overlay.id);

    const second = findOverlayForServicePlanningCandidate(
      "Sabbath School",
      "Sabbath School Co-Host",
      list,
      claimed,
    );
    expect(second.kind).toBe("match");
    if (second.kind !== "match") throw new Error("Expected second overlay match");
    expect([first.overlay.id, second.overlay.id]).toEqual(["cohost-a", "cohost-b"]);
  });

  it("treats legacy overlays without source metadata as reusable", () => {
    const legacy = participant("legacy", "Scripture Reading");
    const result = findOverlayForServicePlanningCandidate(
      "Reading the Word",
      " scripture   reading ",
      [legacy],
    );

    expect(result).toEqual({ kind: "match", overlay: legacy, score: 100 });
  });

  it("does not choose an arbitrary overlay when fuzzy matches tie", () => {
    const result = findOverlayForServicePlanningCandidate(
      "Sermon",
      undefined,
      [participant("first", "Sermon"), participant("second", "Sermon")],
    );

    expect(result).toEqual({ kind: "ambiguous", score: 100 });
  });
});
