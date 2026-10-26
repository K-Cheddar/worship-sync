import type { OverlayInfo } from "../../types";
import type { OverlaySyncPlanItem } from "../../types/servicePlanningImport";
import { findOverlayForServicePlanningCandidate, planNativeOverlaySync } from "./findBestOverlayMatch";

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


describe("planNativeOverlaySync", () => {
  const candidate = (patch: OverlaySyncPlanItem["patch"], isSong = false): OverlaySyncPlanItem => ({
    sourceKind: "native", isSong, action: "create", sectionName: "Service", sourceRowIndex: 0,
    elementType: patch.event || "", title: "", ledBy: "", personIndex: 0, rawNameToken: patch.name || "", patch,
  });

  it("reserves exact library and current songs before any same-event fallback, preferring current exact copies", () => {
    const plan = [candidate({ name: "Praise Team", title: "New Song", event: "Song of Praise" }, true),
      candidate({ name: "Praise Team", title: "God Is", event: "Song of Praise" }, true),
      candidate({ name: "Praise Team", title: "Just Want to Praise You", event: "Song of Praise" }, true)];
    const current = [
      { ...participant("god-is", "Song of Praise"), name: "Praise Team", title: "God Is" },
      { ...participant("spare", "Song of Praise"), name: "Previous", title: "Previous Song" },
    ];
    const library = [
      { ...participant("saved-god-is", "Song of Praise"), name: "Praise Team", title: "God Is" },
      { ...participant("saved-just", "Song of Praise"), name: "Praise Team", title: "Just Want to Praise You" },
    ];
    const result = planNativeOverlaySync(plan, current, library);
    expect(result.map((item) => item.targetOverlayId)).toEqual(["spare", "god-is", "saved-just"]);
    expect(result.map((item) => item.action)).toEqual(["update", "update", "clone"]);
    expect(result[2].targetOverlaySource).toBe("library");
  });

  it("preserves the participant identity before event fallback even when their role title changes", () => {
    const plan = [candidate({ name: "New Speaker", title: "", event: "Sermon" }), candidate({ name: "Samuel Muir", title: "Pastor", event: "Sermon" })];
    const current = [
      { ...participant("samuel", "Sermon"), name: "Samuel Muir", title: "Old role" },
      { ...participant("ryann", "Sermon"), name: "Ryann" },
    ];
    const library = [{ ...participant("saved-samuel", "Sermon"), name: "Samuel Muir", title: "Pastor" }];
    expect(planNativeOverlaySync(plan, current, library).map((item) => item.targetOverlayId)).toEqual(["ryann", "samuel"]);
  });

  it("does not match similar event text or a different overlay type", () => {
    const result = planNativeOverlaySync([candidate({ name: "Guest", title: "", event: "Sermon" })], [
      participant("similar-event", "Sermon Response"),
      { id: "image", type: "image", event: "Sermon" },
    ]);
    expect(result[0]).toMatchObject({ action: "create", targetOverlayId: undefined });
  });

  it("uses stable distinct slots for repeated identical songs with normalized event identities", () => {
    const plan = [0, 1, 2].map(() => candidate({ name: "Praise Team", title: "God Is", event: "Song of Praise" }, true));
    const current = [0, 1, 2].map((index) => ({ ...participant(`song-${index}`, "  SONG of   praise "), name: "praise team", title: "god is" }));
    expect(planNativeOverlaySync(plan, current).map((item) => item.targetOverlayId)).toEqual(["song-0", "song-1", "song-2"]);
  });
});
