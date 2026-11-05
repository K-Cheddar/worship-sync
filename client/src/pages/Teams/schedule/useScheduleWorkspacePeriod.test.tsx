import { act, renderHook } from "@testing-library/react";
import type { TeamPosition, TeamScheduleSummary, TeamService } from "../../../api/authTypes";
import { shiftRange } from "../rangeSelection";
import { useScheduleWorkspacePeriod } from "./useScheduleWorkspacePeriod";

let mockServerNow = "2026-10-01T12:00:00Z";
jest.mock("@/utils/serverTime", () => ({ serverDate: () => new Date(mockServerNow) }));
beforeEach(() => { mockServerNow = "2026-10-01T12:00:00Z"; });
const positions: TeamPosition[] = [
  { positionId: "camera", churchId: "church", teamId: "media", name: "Camera" },
  { positionId: "vocal", churchId: "church", teamId: "music", name: "Vocal" },
];
const services: TeamService[] = [
  { id: "a", serviceId: "a", churchId: "church", name: "October", timerType: "countdown", reccurence: "one_time", dateTimeISO: "2026-10-03T14:00:00Z", positionRequirements: [{ positionId: "camera", count: 1 }] },
  { id: "b", serviceId: "b", churchId: "church", name: "December", timerType: "countdown", reccurence: "one_time", dateTimeISO: "2026-12-03T14:00:00Z", positionRequirements: [{ positionId: "vocal", count: 1 }] },
];
const props = { services, positions, schedules: [] as TeamScheduleSummary[], teamId: "media", timeZone: "America/New_York" };

test("selects Upcoming and applies explicit next/custom navigation immediately", () => {
  const { result } = renderHook(() => useScheduleWorkspacePeriod(props));
  expect(result.current.periodRange).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  expect(result.current.generatedPeriodOccurrences.map((row) => row.serviceId)).toEqual(["a"]);
  act(() => {
    result.current.markExplicitPeriodSelection();
    result.current.setPeriodSelection("custom", shiftRange(result.current.periodPreset, result.current.periodRange, 1));
  });
  expect(result.current.periodRange).toEqual({ start: "2026-11-01", end: "2026-11-30" });
  expect(result.current.generatedPeriodOccurrences).toEqual([]);
  act(() => {
    result.current.markExplicitPeriodSelection();
    result.current.selectCustomRange({ startDate: "2026-10-03", endDate: "2026-10-03" });
  });
  expect(result.current.generatedPeriodOccurrences).toHaveLength(1);
  act(() => result.current.selectRangePreset("upcoming"));
  expect(result.current.periodRange).toEqual({ start: "2026-10-01", end: "2026-10-31" });
});

test("preserves explicit range on a data refresh and resets Upcoming on a Team change", () => {
  const { result, rerender } = renderHook(useScheduleWorkspacePeriod, { initialProps: props });
  act(() => {
    result.current.markExplicitPeriodSelection();
    result.current.selectRangePreset("nextQuarter");
  });
  const explicitRange = result.current.periodRange;
  rerender({ ...props, services: [...services] });
  expect(result.current.periodRange).toEqual(explicitRange);
  rerender({ ...props, teamId: "music" });
  expect(result.current.periodPreset).toBe("upcoming");
  expect(result.current.periodRange).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  expect(result.current.generatedPeriodOccurrences.map((row) => row.serviceId)).toEqual(["b"]);
});

test("keeps the current Upcoming target responsive to loaded service data", () => {
  const { result, rerender } = renderHook(useScheduleWorkspacePeriod, { initialProps: { ...props, services: [] as TeamService[] } });
  rerender({ ...props, services: [services[1]], teamId: "music" });
  expect(result.current.periodRange.start).toBe("2026-12-01");
});

test.each([
  { instant: "2026-11-01T01:30:00Z", month: { start: "2026-10-01", end: "2026-10-31" }, next: { start: "2026-11-01", end: "2026-11-30" } },
  { instant: "2026-11-01T06:30:00Z", month: { start: "2026-11-01", end: "2026-11-30" }, next: { start: "2026-12-01", end: "2026-12-31" } },
])("resolves calendar presets from the church date near DST: $instant", ({ instant, month, next }) => {
  mockServerNow = instant;
  const { result } = renderHook(() => useScheduleWorkspacePeriod({ ...props, services: [] }));
  act(() => {
    result.current.markExplicitPeriodSelection();
    result.current.selectRangePreset("thisMonth");
  });
  expect(result.current.periodRange).toEqual(month);
  act(() => result.current.selectRangePreset("nextMonth"));
  expect(result.current.periodRange).toEqual(next);
});

test("recalculates explicit calendar presets after a timezone change but preserves custom ranges", () => {
  mockServerNow = "2026-11-01T01:30:00Z";
  const { result, rerender } = renderHook(
    ({ timeZone }: { timeZone: string }) => useScheduleWorkspacePeriod({ ...props, timeZone, services: [] }),
    { initialProps: { timeZone: "America/New_York" } },
  );
  act(() => {
    result.current.markExplicitPeriodSelection();
    result.current.selectRangePreset("thisMonth");
  });
  expect(result.current.periodRange).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  rerender({ timeZone: "UTC" });
  expect(result.current.periodRange).toEqual({ start: "2026-11-01", end: "2026-11-30" });

  act(() => result.current.selectCustomRange({ startDate: "2027-02-03", endDate: "2027-02-07" }));
  rerender({ timeZone: "America/Los_Angeles" });
  expect(result.current.periodRange).toEqual({ start: "2027-02-03", end: "2027-02-07" });
});
