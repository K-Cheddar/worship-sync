import {
  getClosestUpcomingService,
  getDisplayedUpcomingService,
  getEffectiveTargetTime,
  getMostRecentTargetTime,
  getNextOccurrenceForService,
  getUpcomingServiceRefreshDelay,
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

    describe("multi_weekly", () => {
      it("returns the soonest upcoming day among the selected days", () => {
        // Wednesday 2026-01-07 at 09:00
        const now = new Date(2026, 0, 7, 9, 0, 0);
        const service = createService({
          reccurence: "multi_weekly",
          // Mon @ 08:00, Wed @ 10:00, Fri @ 09:00
          daysOfWeek: [
            { day: 1, time: "08:00" },
            { day: 3, time: "10:00" },
            { day: 5, time: "09:00" },
          ],
        });

        const result = getNextOccurrenceForService(service, now);

        // Same day (Wednesday) at 10:00 is still ahead; Monday 08:00 already passed this week
        expect(result?.getDay()).toBe(3);
        expect(result?.getHours()).toBe(10);
        expect(result?.getMinutes()).toBe(0);
      });

      it("uses the per-day time when picking the earliest upcoming occurrence", () => {
        // Wednesday 2026-01-07 at 10:30 — Wednesday's 10:00 slot just passed
        const now = new Date(2026, 0, 7, 10, 30, 0);
        const service = createService({
          reccurence: "multi_weekly",
          daysOfWeek: [
            { day: 3, time: "10:00" }, // Wed — already passed
            { day: 5, time: "09:00" }, // Fri
          ],
        });

        const result = getNextOccurrenceForService(service, now);

        expect(result?.getDay()).toBe(5);
        expect(result?.getHours()).toBe(9);
      });

      it("skips to the next week when all days for this week have passed", () => {
        // Friday 2026-01-09 at 11:00 — Friday's 09:00 slot already passed
        const now = new Date(2026, 0, 9, 11, 0, 0);
        const service = createService({
          reccurence: "multi_weekly",
          daysOfWeek: [
            { day: 1, time: "09:00" }, // Mon
            { day: 5, time: "09:00" }, // Fri
          ],
        });

        const result = getNextOccurrenceForService(service, now);

        // Next occurrence is Monday 2026-01-12
        expect(result?.getDay()).toBe(1);
        expect(result?.getDate()).toBe(12);
      });

      it("returns null when the next occurrence falls after endDateISO", () => {
        // Thursday 2026-01-08
        const now = new Date(2026, 0, 8, 9, 0, 0);
        const service = createService({
          reccurence: "multi_weekly",
          daysOfWeek: [{ day: 5, time: "10:00" }], // Friday only
          endDateISO: "2026-01-08", // end date is before the next Friday
        });

        expect(getNextOccurrenceForService(service, now)).toBeNull();
      });

      it("includes an occurrence on the end date itself", () => {
        // Thursday 2026-01-08
        const now = new Date(2026, 0, 8, 9, 0, 0);
        const service = createService({
          reccurence: "multi_weekly",
          daysOfWeek: [{ day: 5, time: "10:00" }], // Friday
          endDateISO: "2026-01-09",
        });

        const result = getNextOccurrenceForService(service, now);

        expect(result?.getDay()).toBe(5);
        expect(result?.getDate()).toBe(9);
      });

      it("returns null when daysOfWeek is empty", () => {
        const now = new Date(2026, 0, 7, 9, 0, 0);
        const service = createService({
          reccurence: "multi_weekly",
          daysOfWeek: [],
        });

        expect(getNextOccurrenceForService(service, now)).toBeNull();
      });
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

  it("uses override target times when choosing the closest upcoming service", () => {
    const now = new Date("2026-01-10T08:45:00.000Z");
    const services: ServiceTime[] = [
      createService({
        id: "delayed-weekly",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "09:00",
        overrideDateTimeISO: new Date("2026-01-10T10:00:00.000Z").toISOString(),
      }),
      createService({
        id: "one-time-earlier",
        reccurence: "one_time",
        dateTimeISO: new Date("2026-01-10T09:30:00.000Z").toISOString(),
      }),
    ];

    const result = getClosestUpcomingService(services, now);

    expect(result?.service.id).toBe("one-time-earlier");
    expect(result?.nextAt.toISOString()).toBe(
      "2026-01-10T09:30:00.000Z",
    );
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

  describe("displayed upcoming service", () => {
    it("switches to the next future service as soon as the current one starts", () => {
      const now = new Date("2026-01-10T09:00:01.000Z");
      const services: ServiceTime[] = [
        createService({
          id: "current",
          reccurence: "one_time",
          dateTimeISO: new Date("2026-01-10T09:00:00.000Z").toISOString(),
        }),
        createService({
          id: "next",
          reccurence: "one_time",
          dateTimeISO: new Date("2026-01-10T10:00:00.000Z").toISOString(),
        }),
      ];

      const result = getDisplayedUpcomingService(services, now, 15 * 60 * 1000);

      expect(result?.service.id).toBe("next");
      expect(result?.nextAt.toISOString()).toBe(
        "2026-01-10T10:00:00.000Z",
      );
    });

    it("keeps a just-started service during the grace window when there is no future service", () => {
      const now = new Date("2026-01-10T09:05:00.000Z");
      const service = createService({
        id: "current",
        reccurence: "one_time",
        dateTimeISO: new Date("2026-01-10T09:00:00.000Z").toISOString(),
      });

      const result = getDisplayedUpcomingService([service], now, 15 * 60 * 1000);

      expect(result?.service.id).toBe("current");
      expect(result?.nextAt.toISOString()).toBe(
        "2026-01-10T09:00:00.000Z",
      );
    });

    it("returns the most recent expired override during the grace window", () => {
      const now = new Date("2026-01-10T09:05:00.000Z");
      const service = createService({
        id: "override",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "10:00",
        overrideDateTimeISO: new Date("2026-01-10T09:00:00.000Z").toISOString(),
      });

      const result = getMostRecentTargetTime(service, now);

      expect(result?.toISOString()).toBe("2026-01-10T09:00:00.000Z");
    });

    it("schedules the next refresh at the current service start time when a later service exists", () => {
      const now = new Date("2026-01-10T08:30:00.000Z");
      const services: ServiceTime[] = [
        createService({
          id: "current",
          reccurence: "one_time",
          dateTimeISO: new Date("2026-01-10T09:00:00.000Z").toISOString(),
        }),
        createService({
          id: "next",
          reccurence: "one_time",
          dateTimeISO: new Date("2026-01-10T10:00:00.000Z").toISOString(),
        }),
      ];

      const delayMs = getUpcomingServiceRefreshDelay(
        services,
        now,
        15 * 60 * 1000,
      );

      expect(delayMs).toBe(30 * 60 * 1000 + 1);
    });
  });
});
