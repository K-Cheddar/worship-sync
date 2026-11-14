import type {
  TeamScheduleOccurrence,
  TeamScheduleSummary,
  TeamService,
} from "../../../api/authTypes";
import {
  getServiceAvailabilityMonthRange,
  getServiceAvailabilityValue,
  getUpcomingServiceAvailabilityOccurrences,
} from "./serviceAvailabilityEditorModel";

const service = (overrides: Partial<TeamService> = {}): TeamService => ({
  id: "sunday",
  serviceId: "sunday",
  churchId: "church-1",
  name: "Sunday service",
  timerType: "countdown",
  reccurence: "weekly",
  dayOfWeek: 0,
  time: "10:00",
  ...overrides,
});

describe("service availability editor model", () => {
  it("starts at the current church-local month and shows two months", () => {
    const range = getServiceAvailabilityMonthRange(
      new Date("2026-11-01T02:00:00.000Z"),
      "America/New_York",
    );
    expect(range).toEqual({ startDate: "2026-10-01", endDate: "2026-11-30" });
    expect(getServiceAvailabilityMonthRange(
      new Date("2026-11-01T02:00:00.000Z"),
      "America/New_York",
      2,
    )).toEqual({ startDate: "2026-12-01", endDate: "2027-01-31" });
  });

  it("generates virtual one-time and combined occurrences without a saved schedule", () => {
    const range = { startDate: "2099-11-01", endDate: "2099-11-30" };
    const occurrences = getUpcomingServiceAvailabilityOccurrences({
      services: [
        service({ serviceId: "first", id: "first", serviceGroupId: "combined", reccurence: "one_time", dateTimeISO: "2099-11-08T10:00:00.000Z" }),
        service({ serviceId: "second", id: "second", name: "Family service", serviceGroupId: "combined", reccurence: "one_time", dateTimeISO: "2099-11-08T10:00:00.000Z" }),
        service({ serviceId: "special", id: "special", name: "Special service", reccurence: "one_time", dateTimeISO: "2099-11-15T16:00:00.000Z" }),
      ],
      schedules: [],
      range,
      timeZone: "UTC",
      now: new Date("2099-11-01T17:00:00.000Z"),
    });

    expect(occurrences).toHaveLength(2);
    expect(occurrences[0]).toMatchObject({
      occurrenceId: "group:combined@2099-11-08",
      serviceIds: ["first", "second"],
      name: "Sunday service & Family service",
    });
    expect(occurrences[1]).toMatchObject({
      occurrenceId: "special@2099-11-15",
      name: "Special service",
    });
  });

  it("keeps a unique legacy schedule key after the configured service time changes", () => {
    const priorOccurrence: TeamScheduleOccurrence = {
      occurrenceId: "sunday@2099-11-08T15:00:00.000Z",
      serviceId: "sunday",
      name: "Sunday service",
      startsAt: "2099-11-08T15:00:00.000Z",
    };
    const schedule = {
      scheduleId: "legacy-schedule",
      churchId: "church-1",
      teamId: "team-1",
      name: "November",
      startDate: "2099-11-01",
      endDate: "2099-11-30",
      serviceIds: ["sunday"],
      occurrences: [priorOccurrence],
    } as TeamScheduleSummary;
    const [current] = getUpcomingServiceAvailabilityOccurrences({
      services: [service({ time: "16:00" })],
      schedules: [schedule],
      range: { startDate: "2099-11-01", endDate: "2099-11-30" },
      timeZone: "UTC",
      now: new Date("2099-11-01T17:00:00.000Z"),
    });

    expect(current).toMatchObject({
      occurrenceId: priorOccurrence.occurrenceId,
      logicalOccurrenceId: "sunday@2099-11-08",
      startsAt: "2099-11-08T16:00:00.000Z",
    });
    expect(getServiceAvailabilityValue(
      current,
      { [priorOccurrence.occurrenceId]: "unavailable", elsewhere: "available" },
      "UTC",
    )).toEqual({
      status: "unavailable",
      occurrenceIds: [priorOccurrence.occurrenceId],
      hasConflictingValues: false,
    });
  });

  it("loads availability responses stored under the earlier timestamp key", () => {
    const [occurrence] = getUpcomingServiceAvailabilityOccurrences({
      services: [service()],
      schedules: [],
      range: { startDate: "2026-11-01", endDate: "2026-12-31" },
      timeZone: "UTC",
      now: new Date("2026-11-01T11:00:00.000Z"),
    });
    const timestampKey = "sunday@2026-11-08T10:00:00.000Z";

    expect(getServiceAvailabilityValue(
      occurrence,
      { [timestampKey]: "available" },
      "UTC",
    )).toEqual({
      status: "available",
      occurrenceIds: [timestampKey],
      hasConflictingValues: false,
    });
  });
});
