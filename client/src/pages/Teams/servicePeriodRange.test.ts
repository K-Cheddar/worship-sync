import type { ServiceTime } from "../../types";
import { getUpcomingServiceRange } from "./servicePeriodRange";
import { filterFormsByDateRange } from "./formsPeriodFilters";
import type { TeamIntakeForm } from "../../api/authTypes";
import { resolveRangePreset } from "./rangeSelection";
import { setServerTimeOffset } from "../../utils/serverTime";

afterEach(() => {
  jest.useRealTimers();
  setServerTimeOffset(0);
});

const service = (dateTimeISO: string): ServiceTime => ({
  id: "december-service",
  name: "December service",
  timerType: "countdown",
  reccurence: "one_time",
  dateTimeISO,
});

describe("getUpcomingServiceRange", () => {
  it("uses the full month containing the next service across a month boundary", () => {
    expect(getUpcomingServiceRange(
      [service("2026-12-05T10:00:00.000Z")],
      new Date("2026-11-29T12:00:00.000Z"),
    )).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });

  it("uses the current month when no future service is configured", () => {
    expect(getUpcomingServiceRange(
      [service("2026-11-28T10:00:00.000Z")],
      new Date("2026-11-29T12:00:00.000Z"),
    )).toEqual({ start: "2026-11-01", end: "2026-11-30" });
  });

  it("aligns Upcoming, Forms, Plans, and This month to the server instant", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 9, 31, 23, 30));
    setServerTimeOffset(2 * 60 * 60 * 1000);
    const range = getUpcomingServiceRange([
      service("2026-11-02T10:00:00.000Z"),
    ]);

    expect(range).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(resolveRangePreset("thisMonth")).toEqual(range);
    expect(filterFormsByDateRange([], {
      startDate: range.start,
      endDate: range.end,
    })).toEqual([]);
  });

  it("lets Forms apply the same December target with inclusive overlap", () => {
    const range = getUpcomingServiceRange(
      [service("2026-12-05T10:00:00.000Z")],
      new Date("2026-11-29T12:00:00.000Z"),
    );
    const form = (formId: string, startDate: string, endDate: string): TeamIntakeForm => ({
      formId,
      churchId: "church-1",
      name: formId,
      startDate,
      endDate,
      availabilityServices: [],
      availabilityOccurrences: [],
      teamIds: [],
      active: true,
    });

    expect(filterFormsByDateRange([
      form("overlapping", "2026-11-28", "2026-12-02"),
      form("december", "2026-12-10", "2026-12-20"),
      form("november-only", "2026-11-01", "2026-11-30"),
      form("january", "2027-01-01", "2027-01-15"),
    ], { startDate: range.start, endDate: range.end }).map(({ formId }) => formId)).toEqual([
      "overlapping",
      "december",
    ]);
  });
});
