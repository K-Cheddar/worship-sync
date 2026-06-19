import type { TeamScheduleOccurrence, TeamService } from "../api/authTypes";
import {
  formatOccurrenceRowLabel,
  formatOccurrenceTiming,
  filterServicesWithOccurrencesInRange,
  generateScheduleOccurrences,
  getOccurrenceDate,
  getSharedOccurrenceTiming,
  occurrenceIdsMatch,
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

  it("merges combined same-day services into one occurrence", () => {
    const occurrences = generateScheduleOccurrences({
      services: [
        service({
          serviceId: "first",
          name: "First Service",
          dayOfWeek: 0,
          time: "09:00",
          serviceGroupId: "sunday-am",
          positionRequirements: [{ positionId: "vocals", count: 2 }],
        }),
        service({
          serviceId: "second",
          name: "Second Service",
          dayOfWeek: 0,
          time: "11:00",
          serviceGroupId: "sunday-am",
          positionRequirements: [
            { positionId: "vocals", count: 3 },
            { positionId: "drums", count: 1 },
          ],
        }),
      ],
      serviceIds: ["first", "second"],
      startDate: "2026-07-05",
      endDate: "2026-07-05",
    });

    expect(occurrences).toHaveLength(1);
    const [combined] = occurrences;
    // Stable group-based id, earliest start, joined names, both services covered.
    expect(combined.occurrenceId).toBe("group:sunday-am@2026-07-05");
    expect(combined.groupId).toBe("sunday-am");
    expect(combined.serviceIds).toEqual(["first", "second"]);
    expect(combined.name).toBe("First Service & Second Service");
    expect(combined.startsAt).toBe(occurrences[0].startsAt);
    expect(new Date(combined.startsAt).getHours()).toBe(9);
    // Requirements are the union, keeping the larger count per position.
    expect(combined.positionRequirements).toEqual(
      expect.arrayContaining([
        { positionId: "vocals", count: 3 },
        { positionId: "drums", count: 1 },
      ]),
    );
  });

  it("does not mint a group id when only one combined service is present", () => {
    const occurrences = generateScheduleOccurrences({
      services: [
        service({
          serviceId: "first",
          name: "First Service",
          dayOfWeek: 0,
          time: "09:00",
          serviceGroupId: "sunday-am",
        }),
        service({
          serviceId: "second",
          name: "Second Service",
          dayOfWeek: 0,
          time: "11:00",
          serviceGroupId: "sunday-am",
        }),
      ],
      // Only one of the combined pair is on this schedule — nothing to merge.
      serviceIds: ["first"],
      startDate: "2026-07-05",
      endDate: "2026-07-05",
    });

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].occurrenceId).not.toContain("group:");
    expect(occurrences[0].groupId).toBeUndefined();
  });

  it("keeps ungrouped same-day services as separate occurrences", () => {
    const occurrences = generateScheduleOccurrences({
      services: [
        service({
          serviceId: "morning",
          name: "Morning",
          dayOfWeek: 0,
          time: "09:00",
          serviceGroupId: "sunday-am",
        }),
        service({
          serviceId: "evening",
          name: "Evening",
          dayOfWeek: 0,
          time: "18:00",
        }),
      ],
      serviceIds: ["morning", "evening"],
      startDate: "2026-07-05",
      endDate: "2026-07-05",
    });

    expect(occurrences.map((occurrence) => occurrence.name)).toEqual([
      "Morning",
      "Evening",
    ]);
    expect(occurrences[1].groupId).toBeUndefined();
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

describe("occurrenceIdsMatch", () => {
  const occ = (occurrenceId: string): TeamScheduleOccurrence => ({
    occurrenceId,
    serviceId: occurrenceId,
    name: occurrenceId,
    startsAt: "2026-07-05T10:00:00.000Z",
  });

  it("matches the same ids regardless of order", () => {
    expect(
      occurrenceIdsMatch(
        [occ("first@2026-07-05"), occ("second@2026-07-05")],
        [occ("second@2026-07-05"), occ("first@2026-07-05")],
      ),
    ).toBe(true);
  });

  it("flags drift when grouping changes the id shape", () => {
    expect(
      occurrenceIdsMatch(
        [occ("first@2026-07-05"), occ("second@2026-07-05")],
        [occ("group:sunday-am@2026-07-05")],
      ),
    ).toBe(false);
  });

  it("flags a differing count", () => {
    expect(
      occurrenceIdsMatch([occ("first@2026-07-05")], []),
    ).toBe(false);
  });
});
