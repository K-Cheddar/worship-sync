import type { TeamScheduleOccurrence, TeamService } from "../api/authTypes";
import {
  formatOccurrenceRowLabel,
  formatOccurrenceTiming,
  filterServicesWithOccurrencesInRange,
  generateScheduleOccurrences,
  getOccurrenceDate,
  getSharedOccurrenceTiming,
} from "./teamScheduleOccurrences";

const service = (overrides: Partial<TeamService>): TeamService => ({
  id: overrides.serviceId || "service",
  serviceId: overrides.serviceId || "service",
  churchId: "church-1",
  name: "Service",
  timerType: "countdown",
  reccurence: "weekly",
  dayOfWeek: 0,
  time: "10:00",
  ...overrides,
});

describe("generateScheduleOccurrences", () => {
  it("expands weekly services inside the schedule range", () => {
    const occurrences = generateScheduleOccurrences({
      services: [
        service({ serviceId: "sunday", name: "Sunday", dayOfWeek: 0 }),
      ],
      serviceIds: ["sunday"],
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });

    expect(occurrences.map(getOccurrenceDate)).toEqual([
      "2026-07-05",
      "2026-07-12",
      "2026-07-19",
      "2026-07-26",
    ]);
  });

  it("honors multi-weekly service end dates", () => {
    const occurrences = generateScheduleOccurrences({
      services: [
        service({
          serviceId: "midweek",
          name: "Midweek",
          reccurence: "multi_weekly",
          daysOfWeek: [
            { day: 2, time: "18:30" },
            { day: 4, time: "18:30" },
          ],
          endDateISO: "2026-07-09",
        }),
      ],
      serviceIds: ["midweek"],
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });

    expect(occurrences.map(getOccurrenceDate)).toEqual([
      "2026-07-02",
      "2026-07-07",
      "2026-07-09",
    ]);
  });

  it("expands monthly last weekday services", () => {
    const occurrences = generateScheduleOccurrences({
      services: [
        service({
          serviceId: "prayer",
          name: "Prayer",
          reccurence: "monthly",
          ordinal: 5,
          weekday: 3,
          time: "19:00",
        }),
      ],
      serviceIds: ["prayer"],
      startDate: "2026-07-01",
      endDate: "2026-09-30",
    });

    expect(occurrences.map(getOccurrenceDate)).toEqual([
      "2026-07-29",
      "2026-08-26",
      "2026-09-30",
    ]);
  });

  it("filters one-time services outside the schedule range", () => {
    const occurrences = generateScheduleOccurrences({
      services: [
        service({
          serviceId: "retreat",
          name: "Retreat",
          reccurence: "one_time",
          dateTimeISO: "2026-08-01T10:00:00.000Z",
        }),
      ],
      serviceIds: ["retreat"],
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });

    expect(occurrences).toEqual([]);
  });
});

describe("filterServicesWithOccurrencesInRange", () => {
  const sunday = service({ serviceId: "sunday", name: "Sunday", dayOfWeek: 0 });
  const pastRetreat = service({
    serviceId: "retreat",
    name: "Retreat",
    reccurence: "one_time",
    dateTimeISO: "2026-06-01T10:00:00.000Z",
  });
  const futureRetreat = service({
    serviceId: "future-retreat",
    name: "Future retreat",
    reccurence: "one_time",
    dateTimeISO: "2026-08-01T10:00:00.000Z",
  });

  it("returns services with occurrences in the range", () => {
    const filtered = filterServicesWithOccurrencesInRange({
      services: [sunday, pastRetreat, futureRetreat],
      startDate: "2026-07-01",
      endDate: "2026-08-31",
    });

    expect(filtered.map((item) => item.serviceId)).toEqual([
      "sunday",
      "future-retreat",
    ]);
  });

  it("returns an empty list when the range is missing", () => {
    expect(
      filterServicesWithOccurrencesInRange({
        services: [sunday],
        startDate: "",
        endDate: "2026-08-31",
      }),
    ).toEqual([]);
  });
});

describe("getSharedOccurrenceTiming", () => {
  const sundayOccurrences: TeamScheduleOccurrence[] = [
    {
      occurrenceId: "sunday@1",
      serviceId: "sunday",
      name: "Sunday",
      startsAt: "2026-07-05T10:00:00.000Z",
    },
    {
      occurrenceId: "sunday@2",
      serviceId: "sunday",
      name: "Sunday",
      startsAt: "2026-07-12T10:00:00.000Z",
    },
  ];

  it("hoists matching weekday and time when a service has multiple occurrences", () => {
    const shared = getSharedOccurrenceTiming(sundayOccurrences);

    expect(shared.sharedWeekday).toBe(
      new Date(sundayOccurrences[0].startsAt).toLocaleString(undefined, {
        weekday: "short",
      }),
    );
    expect(shared.sharedTime).toBe(
      new Date(sundayOccurrences[0].startsAt).toLocaleString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }),
    );
  });

  it("hoists timing for a single occurrence", () => {
    expect(getSharedOccurrenceTiming([sundayOccurrences[0]])).toEqual({
      sharedWeekday: new Date(sundayOccurrences[0].startsAt).toLocaleString(
        undefined,
        { weekday: "short" },
      ),
      sharedTime: new Date(sundayOccurrences[0].startsAt).toLocaleString(
        undefined,
        { hour: "numeric", minute: "2-digit" },
      ),
    });
  });

  it("hoists timing for a monthly service with one occurrence in range", () => {
    const powerUpOccurrence: TeamScheduleOccurrence = {
      occurrenceId: "power-up@1",
      serviceId: "power-up",
      name: "Power Up",
      startsAt: "2026-06-03T19:00:00.000Z",
    };
    const shared = getSharedOccurrenceTiming([powerUpOccurrence]);

    expect(shared.sharedWeekday).toBe(
      new Date(powerUpOccurrence.startsAt).toLocaleString(undefined, {
        weekday: "short",
      }),
    );
    expect(shared.sharedTime).toBe(
      new Date(powerUpOccurrence.startsAt).toLocaleString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }),
    );
    expect(formatOccurrenceRowLabel(powerUpOccurrence, shared)).not.toContain(
      shared.sharedWeekday as string,
    );
  });

  it("keeps varying weekdays in the row labels", () => {
    const shared = getSharedOccurrenceTiming([
      {
        occurrenceId: "midweek@1",
        serviceId: "midweek",
        name: "Midweek",
        startsAt: "2026-07-07T18:30:00.000Z",
      },
      {
        occurrenceId: "midweek@2",
        serviceId: "midweek",
        name: "Midweek",
        startsAt: "2026-07-09T18:30:00.000Z",
      },
    ]);

    expect(shared.sharedWeekday).toBeNull();
    expect(shared.sharedTime).not.toBeNull();
  });
});

describe("formatOccurrenceRowLabel", () => {
  it("omits shared weekday and time from repeated service rows", () => {
    const occurrences: TeamScheduleOccurrence[] = [
      {
        occurrenceId: "sunday@1",
        serviceId: "sunday",
        name: "Sunday",
        startsAt: "2026-07-05T10:00:00.000Z",
      },
      {
        occurrenceId: "sunday@2",
        serviceId: "sunday",
        name: "Sunday",
        startsAt: "2026-07-12T10:00:00.000Z",
      },
    ];
    const shared = getSharedOccurrenceTiming(occurrences);

    expect(formatOccurrenceRowLabel(occurrences[0], shared)).not.toContain(
      new Date(occurrences[0].startsAt).toLocaleString(undefined, {
        weekday: "short",
      }),
    );
    expect(formatOccurrenceRowLabel(occurrences[0], shared)).not.toContain(
      new Date(occurrences[0].startsAt).toLocaleString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }),
    );
  });

  it("falls back to the full timing label when nothing is shared", () => {
    const occurrence: TeamScheduleOccurrence = {
      occurrenceId: "sunday@1",
      serviceId: "sunday",
      name: "Sunday",
      startsAt: "2026-07-05T10:00:00.000Z",
    };

    expect(
      formatOccurrenceRowLabel(occurrence, {
        sharedWeekday: null,
        sharedTime: null,
      }),
    ).toBe(formatOccurrenceTiming(occurrence));
  });
});
