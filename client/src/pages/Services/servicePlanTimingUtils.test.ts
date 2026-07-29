import {
  applyDurationChange,
  applyElementDurationChange,
  applyElementDurationSecondsChange,
  applyElementStartTimeChange,
  applyPlanAnchorStartTime,
  applyStartTimeChange,
  recomputeStartTimesFromAnchor,
} from "./servicePlanTimingUtils";
import type { ServicePlanSection } from "../../types/servicePlan";
import { EMPTY_RICH_TEXT } from "../../types/richText";

type Item = { id: string; startTime?: string; durationMinutes?: number };

const items = (rows: Item[]): Item[] => rows;

describe("recomputeStartTimesFromAnchor", () => {
  it("chains each item's start from the previous item's start + duration", () => {
    const result = recomputeStartTimesFromAnchor(
      items([
        { id: "a", durationMinutes: 10 },
        { id: "b", durationMinutes: 30 },
        { id: "c", durationMinutes: 5 },
      ]),
      "09:00",
    );
    expect(result.map((i) => i.startTime)).toEqual(["09:00", "09:10", "09:40"]);
  });

  it("treats a missing duration as zero", () => {
    const result = recomputeStartTimesFromAnchor(
      items([{ id: "a" }, { id: "b", durationMinutes: 15 }]),
      "10:00",
    );
    expect(result.map((i) => i.startTime)).toEqual(["10:00", "10:00"]);
  });

  it("is a no-op when the anchor isn't a valid HH:mm time", () => {
    const original = items([{ id: "a", durationMinutes: 10 }]);
    expect(recomputeStartTimesFromAnchor(original, "not-a-time")).toBe(original);
  });
});

describe("applyDurationChange (duration drives time)", () => {
  it("shifts every later item's start time when an earlier item's duration changes", () => {
    const start = recomputeStartTimesFromAnchor(
      items([
        { id: "a", durationMinutes: 10 },
        { id: "b", durationMinutes: 30 },
        { id: "c", durationMinutes: 5 },
      ]),
      "09:00",
    );
    const result = applyDurationChange(start, 0, 20);
    expect(result.map((i) => ({ id: i.id, startTime: i.startTime, durationMinutes: i.durationMinutes }))).toEqual([
      { id: "a", startTime: "09:00", durationMinutes: 20 },
      { id: "b", startTime: "09:20", durationMinutes: 30 },
      { id: "c", startTime: "09:50", durationMinutes: 5 },
    ]);
  });

  it("leaves earlier items untouched", () => {
    const start = recomputeStartTimesFromAnchor(
      items([
        { id: "a", durationMinutes: 10 },
        { id: "b", durationMinutes: 30 },
      ]),
      "09:00",
    );
    const result = applyDurationChange(start, 1, 5);
    expect(result[0]).toEqual(start[0]);
  });

  it("clamps a negative duration to zero", () => {
    const start = recomputeStartTimesFromAnchor(items([{ id: "a", durationMinutes: 10 }]), "09:00");
    const result = applyDurationChange(start, 0, -5);
    expect(result[0].durationMinutes).toBe(0);
  });
});

describe("applyStartTimeChange (time drives duration)", () => {
  it("stretches the previous item's duration so it ends exactly at the new start time", () => {
    const start = recomputeStartTimesFromAnchor(
      items([
        { id: "a", durationMinutes: 10 },
        { id: "b", durationMinutes: 30 },
        { id: "c", durationMinutes: 5 },
      ]),
      "09:00",
    );
    // Push item b's start from 09:10 to 09:15 -> item a's duration grows to 15.
    const result = applyStartTimeChange(start, 1, "09:15");
    expect(result.map((i) => ({ id: i.id, startTime: i.startTime, durationMinutes: i.durationMinutes }))).toEqual([
      { id: "a", startTime: "09:00", durationMinutes: 15 },
      { id: "b", startTime: "09:15", durationMinutes: 30 },
      { id: "c", startTime: "09:45", durationMinutes: 5 },
    ]);
  });

  it("moves the whole plan's anchor when the first item's start time changes, without touching durations", () => {
    const start = recomputeStartTimesFromAnchor(
      items([
        { id: "a", durationMinutes: 10 },
        { id: "b", durationMinutes: 30 },
      ]),
      "09:00",
    );
    const result = applyStartTimeChange(start, 0, "10:00");
    expect(result.map((i) => i.startTime)).toEqual(["10:00", "10:10"]);
    expect(result.map((i) => i.durationMinutes)).toEqual([10, 30]);
  });

  it("clamps to a zero-length previous item rather than going negative", () => {
    const start = recomputeStartTimesFromAnchor(
      items([
        { id: "a", durationMinutes: 10 },
        { id: "b", durationMinutes: 30 },
      ]),
      "09:00",
    );
    // Try to move item b's start earlier than item a even starts.
    const result = applyStartTimeChange(start, 1, "08:00");
    expect(result[0].durationMinutes).toBe(0);
  });
});

describe("section-aware wrappers", () => {
  const section = (id: string, elements: Item[]): ServicePlanSection => ({
    id,
    name: id,
    elements: elements.map((item) => ({
      id: item.id,
      type: "song",
      title: EMPTY_RICH_TEXT,
      startTime: item.startTime,
      durationMinutes: item.durationMinutes,
    })),
  });

  it("chains timing continuously across section boundaries", () => {
    const sections = [
      section("s1", [{ id: "a", durationMinutes: 10 }]),
      section("s2", [{ id: "b", durationMinutes: 20 }]),
    ];
    const withAnchor = applyPlanAnchorStartTime(sections, "09:00");
    expect(withAnchor[0].elements[0].startTime).toBe("09:00");
    expect(withAnchor[1].elements[0].startTime).toBe("09:10");
  });

  it("applyElementDurationChange finds the element across sections and shifts everything after it", () => {
    const sections = applyPlanAnchorStartTime(
      [
        section("s1", [{ id: "a", durationMinutes: 10 }]),
        section("s2", [{ id: "b", durationMinutes: 20 }]),
      ],
      "09:00",
    );
    const result = applyElementDurationChange(sections, "a", 15);
    expect(result[0].elements[0].durationMinutes).toBe(15);
    expect(result[1].elements[0].startTime).toBe("09:15");
  });

  it("keeps a canonical seconds duration while shifting later items", () => {
    const sections = applyPlanAnchorStartTime(
      [
        section("s1", [{ id: "a", durationMinutes: 10 }]),
        section("s2", [{ id: "b", durationMinutes: 20 }]),
      ],
      "09:00",
    );
    const result = applyElementDurationSecondsChange(sections, "a", 90);
    expect(result[0].elements[0]).toMatchObject({ durationSeconds: 90, durationMinutes: 1.5 });
    expect(result[1].elements[0].startTime).toBe("09:01");
  });

  it("applyElementStartTimeChange finds the element across sections and resizes the previous item", () => {
    const sections = applyPlanAnchorStartTime(
      [
        section("s1", [{ id: "a", durationMinutes: 10 }]),
        section("s2", [{ id: "b", durationMinutes: 20 }]),
      ],
      "09:00",
    );
    const result = applyElementStartTimeChange(sections, "b", "09:20");
    expect(result[0].elements[0].durationMinutes).toBe(20);
    expect(result[0].elements[0].durationSeconds).toBe(1200);
    expect(result[1].elements[0].startTime).toBe("09:20");
  });

  it("returns the same sections when the element id can't be found", () => {
    const sections = [section("s1", [{ id: "a", durationMinutes: 10 }])];
    expect(applyElementDurationChange(sections, "missing", 5)).toBe(sections);
    expect(applyElementStartTimeChange(sections, "missing", "09:00")).toBe(sections);
  });
});
