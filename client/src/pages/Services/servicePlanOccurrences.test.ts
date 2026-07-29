import type { TeamService } from "../../api/authTypes";
import { getOneTimeServiceOccurrence, getServiceOccurrencesInRange } from "./servicePlanOccurrences";

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

describe("getServiceOccurrencesInRange", () => {
  it("lists every occurrence of a weekly service within the range", () => {
    const sabbath = service({
      serviceId: "sabbath",
      name: "Sabbath Service",
      dayOfWeek: 6,
      time: "10:00",
    });
    const occurrences = getServiceOccurrencesInRange({
      services: [sabbath],
      serviceId: "sabbath",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });
    // July 2026 Saturdays: 4, 11, 18, 25.
    expect(occurrences.map((o) => o.startsAt.slice(0, 10))).toEqual([
      "2026-07-04",
      "2026-07-11",
      "2026-07-18",
      "2026-07-25",
    ]);
  });

  it("includes a service that's merged into a combined/grouped occurrence", () => {
    const first = service({
      serviceId: "svc-a",
      name: "9am",
      serviceGroupId: "group-1",
      dayOfWeek: 0,
      time: "09:00",
    });
    const second = service({
      serviceId: "svc-b",
      name: "11am",
      serviceGroupId: "group-1",
      dayOfWeek: 0,
      time: "11:00",
    });
    const occurrences = getServiceOccurrencesInRange({
      services: [first, second],
      serviceId: "svc-a",
      startDate: "2026-07-05",
      endDate: "2026-07-05",
    });
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].groupId).toBe("group-1");
    expect(occurrences[0].serviceIds).toEqual(
      expect.arrayContaining(["svc-a", "svc-b"]),
    );
  });

  it("returns nothing outside the service's recurrence bounds", () => {
    const occurrences = getServiceOccurrencesInRange({
      services: [service({ serviceId: "svc", dayOfWeek: 6 })],
      serviceId: "svc",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
    });
    expect(occurrences).toEqual([]);
  });
});

describe("getOneTimeServiceOccurrence", () => {
  it("resolves the single occurrence for a one-time service", () => {
    const oneTime = service({
      serviceId: "easter",
      name: "Easter",
      reccurence: "one_time",
      dayOfWeek: undefined,
      dateTimeISO: "2026-07-26T14:00:00.000Z",
    });
    const occurrence = getOneTimeServiceOccurrence([oneTime], oneTime);
    expect(occurrence?.startsAt).toBe("2026-07-26T14:00:00.000Z");
  });

  it("returns null when the service has no date set", () => {
    const oneTime = service({
      serviceId: "tbd",
      reccurence: "one_time",
      dayOfWeek: undefined,
    });
    expect(getOneTimeServiceOccurrence([oneTime], oneTime)).toBeNull();
  });
});
