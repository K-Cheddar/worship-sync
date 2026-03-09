import {
  getClosestUpcomingService,
  getEffectiveTargetTime,
  getNextOccurrenceForService,
} from "./serviceTimes";
import type { ServiceTime } from "../types";

const createService = (overrides: Partial<ServiceTime>): ServiceTime => ({
  id: "svc-1",
  name: "Sunday Service",
  timerType: "countdown",
  reccurence: "one_time",
  ...overrides,
});

describe("serviceTimes", () => {
  describe("getNextOccurrenceForService", () => {
    it("returns future one-time service date and null for past", () => {
      const now = new Date(2026, 0, 10, 9, 0, 0);
      const future = createService({
        reccurence: "one_time",
        dateTimeISO: new Date(2026, 0, 10, 10, 0, 0).toISOString(),
      });
      const past = createService({
        reccurence: "one_time",
        dateTimeISO: new Date(2026, 0, 10, 8, 0, 0).toISOString(),
      });

      expect(getNextOccurrenceForService(future, now)?.toISOString()).toBe(
        future.dateTimeISO,
      );
      expect(getNextOccurrenceForService(past, now)).toBeNull();
    });

    it("calculates weekly services including rollover to next week", () => {
      const now = new Date(2026, 0, 4, 10, 0, 0); // Sunday
      const sameDayLater = createService({
        reccurence: "weekly",
        dayOfWeek: 0,
        time: "11:30",
      });
      const sameDayPassed = createService({
        reccurence: "weekly",
        dayOfWeek: 0,
        time: "09:00",
      });

      const laterResult = getNextOccurrenceForService(sameDayLater, now);
      const rolledResult = getNextOccurrenceForService(sameDayPassed, now);

      expect(laterResult?.getDay()).toBe(0);
      expect(laterResult?.getDate()).toBe(4);
      expect(laterResult?.getHours()).toBe(11);
      expect(laterResult?.getMinutes()).toBe(30);

      expect(rolledResult?.getDay()).toBe(0);
      expect(rolledResult?.getDate()).toBe(11);
      expect(rolledResult?.getHours()).toBe(9);
      expect(rolledResult?.getMinutes()).toBe(0);
    });

    it("calculates monthly occurrence and handles missing fields", () => {
      const now = new Date(2026, 0, 1, 8, 0, 0);
      const thirdMonday = createService({
        reccurence: "monthly",
        ordinal: 3,
        weekday: 1,
        time: "09:15",
      });
      const missingMonthlyData = createService({
        reccurence: "monthly",
        ordinal: 3,
      });

      const result = getNextOccurrenceForService(thirdMonday, now);

      expect(result?.getFullYear()).toBe(2026);
      expect(result?.getMonth()).toBe(0);
      expect(result?.getDate()).toBe(19);
      expect(result?.getDay()).toBe(1);
      expect(result?.getHours()).toBe(9);
      expect(result?.getMinutes()).toBe(15);
      expect(getNextOccurrenceForService(missingMonthlyData, now)).toBeNull();
    });
  });

  it("returns closest upcoming service among multiple recurrences", () => {
    const now = new Date(2026, 0, 10, 12, 0, 0); // Saturday
    const services: ServiceTime[] = [
      createService({
        id: "monthly",
        reccurence: "monthly",
        ordinal: 2,
        weekday: 0,
        time: "11:00",
      }),
      createService({
        id: "weekly",
        reccurence: "weekly",
        dayOfWeek: 0,
        time: "09:00",
      }),
      createService({
        id: "one-time",
        reccurence: "one_time",
        dateTimeISO: new Date(2026, 0, 10, 14, 0, 0).toISOString(),
      }),
    ];

    const result = getClosestUpcomingService(services, now);

    expect(result?.service.id).toBe("one-time");
    expect(result?.nextAt.toISOString()).toBe(services[2].dateTimeISO);
  });

  describe("getEffectiveTargetTime", () => {
    it("prefers future override time over calculated recurrence", () => {
      const now = new Date(2026, 0, 10, 8, 0, 0);
      const service = createService({
        reccurence: "weekly",
        dayOfWeek: 0,
        time: "09:00",
        overrideDateTimeISO: new Date(2026, 0, 10, 8, 30, 0).toISOString(),
      });

      const result = getEffectiveTargetTime(service, now);

      expect(result?.toISOString()).toBe(service.overrideDateTimeISO);
    });

    it("falls back to recurrence when override is in the past", () => {
      const now = new Date(2026, 0, 10, 8, 0, 0);
      const service = createService({
        reccurence: "weekly",
        dayOfWeek: 0,
        time: "09:00",
        overrideDateTimeISO: new Date(2026, 0, 10, 7, 0, 0).toISOString(),
      });

      const result = getEffectiveTargetTime(service, now);

      expect(result?.getHours()).toBe(9);
      expect(result?.getMinutes()).toBe(0);
    });
  });
});
