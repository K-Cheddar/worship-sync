import type { MyScheduleOccurrence } from "../api/auth";
import {
  groupMyScheduleByMonth,
  groupMyScheduleByService,
  myScheduleOccurrenceDate,
} from "./myScheduleTimeline";

const assigned = (overrides: Partial<MyScheduleOccurrence> = {}): MyScheduleOccurrence => ({
  occurrenceId: "group:combined@2026-10-31",
  name: "Sunday & Evening",
  serviceIds: ["evening", "sunday"],
  date: "2026-10-31",
  startsAt: "2026-11-01T02:00:00.000Z",
  serving: [],
  plan: null,
  ...overrides,
});

describe("My Schedule grouping", () => {
  it("uses the saved church date instead of the UTC start date", () => {
    const occurrence = assigned();

    expect(myScheduleOccurrenceDate(occurrence, "America/New_York")).toBe("2026-10-31");
    expect(groupMyScheduleByMonth([occurrence], "America/New_York").map((month) => month.label)).toEqual([
      "October 2026",
    ]);
  });

  it("falls back to the church timezone for legacy occurrences without a saved date", () => {
    const occurrence = assigned({ date: "", occurrenceId: "legacy" });

    expect(myScheduleOccurrenceDate(occurrence, "America/New_York")).toBe("2026-10-31");
  });

  it.each([
    ["2026-03-09T03:30:00.000Z", "2026-03-08"],
    ["2026-11-01T03:30:00.000Z", "2026-10-31"],
  ])("resolves a legacy occurrence on the church calendar across DST (%s)", (startsAt, expectedDate) => {
    const occurrence = assigned({ date: "", startsAt, occurrenceId: "legacy-without-date" });

    expect(myScheduleOccurrenceDate(occurrence, "America/New_York")).toBe(expectedDate);
  });

  it("sorts month groups by occurrence date", () => {
    const lateOctober = assigned({ occurrenceId: "october-31", date: "2026-10-31" });
    const november = assigned({ occurrenceId: "november-1", date: "2026-11-01", startsAt: "2026-11-01T04:00:00.000Z" });

    expect(groupMyScheduleByMonth([november, lateOctober], "America/New_York").map((month) => month.label)).toEqual([
      "October 2026",
      "November 2026",
    ]);
  });

  it("keeps combined services in one group and groups legacy occurrences without IDs by name", () => {
    const combined = assigned();
    const legacyFirst = assigned({ occurrenceId: "legacy-first", serviceIds: [], name: "Legacy Gathering" });
    const legacySecond = assigned({ occurrenceId: "legacy-second", serviceIds: [], name: "Legacy Gathering" });
    const groups = groupMyScheduleByService([combined, legacyFirst, legacySecond]);

    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.serviceIds.length > 0)?.serviceIds).toEqual(["evening", "sunday"]);
    expect(groups.find((group) => group.name === "Legacy Gathering")?.occurrences).toHaveLength(2);
  });
});
