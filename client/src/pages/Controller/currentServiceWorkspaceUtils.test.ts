import type { TeamService } from "../../api/authTypes";
import type { ServiceTime } from "../../types";
import {
  findCurrentServiceOccurrence,
  formatLiveSlideProgress,
  getOccurrenceServices,
  resolveLiveSlideProgress,
} from "./currentServiceWorkspaceUtils";

const service = (serviceId: string, dateTimeISO: string): TeamService => ({
  id: serviceId,
  serviceId,
  churchId: "church-1",
  name: serviceId,
  timerType: "countdown",
  reccurence: "one_time",
  dateTimeISO,
});

describe("findCurrentServiceOccurrence", () => {
  it("keeps an in-progress service selected before moving to a later one", () => {
    const occurrence = findCurrentServiceOccurrence(
      [
        service("morning", "2026-07-26T09:00:00.000Z"),
        service("evening", "2026-07-26T18:00:00.000Z"),
      ],
      Date.parse("2026-07-26T10:30:00.000Z"),
    );

    expect(occurrence?.serviceId).toBe("morning");
  });

  // The reported bug: a service that ran past its scheduled finish flipped the
  // Controller onto the next service in the calendar — days away — the moment
  // its window elapsed.
  it("keeps a service that ran long rather than jumping to a distant one", () => {
    const occurrence = findCurrentServiceOccurrence(
      [
        service("sabbath", "2026-07-25T10:00:00.000Z"),
        service("midweek", "2026-07-29T19:00:00.000Z"),
      ],
      Date.parse("2026-07-25T13:30:00.000Z"),
    );

    expect(occurrence?.serviceId).toBe("sabbath");
  });

  it("hands over halfway between a finished service and the next one", () => {
    const services = [
      service("morning", "2026-07-26T10:00:00.000Z"),
      service("afternoon", "2026-07-26T14:00:00.000Z"),
    ];

    // Morning is presumed to run until 13:00, so the handover lands at 13:30.
    expect(
      findCurrentServiceOccurrence(
        services,
        Date.parse("2026-07-26T13:29:00.000Z"),
      )?.serviceId,
    ).toBe("morning");
    expect(
      findCurrentServiceOccurrence(
        services,
        Date.parse("2026-07-26T13:30:00.000Z"),
      )?.serviceId,
    ).toBe("afternoon");
  });

  it("never holds a service past the start of the next one", () => {
    const occurrence = findCurrentServiceOccurrence(
      [
        service("first", "2026-07-26T09:00:00.000Z"),
        service("second", "2026-07-26T10:30:00.000Z"),
      ],
      Date.parse("2026-07-26T10:31:00.000Z"),
    );

    expect(occurrence?.serviceId).toBe("second");
  });

  it("selects the only upcoming service when nothing has run yet", () => {
    const occurrence = findCurrentServiceOccurrence(
      [service("evening", "2026-07-26T18:00:00.000Z")],
      Date.parse("2026-07-26T08:00:00.000Z"),
    );

    expect(occurrence?.serviceId).toBe("evening");
  });

  it("returns null when no service falls in the window", () => {
    expect(
      findCurrentServiceOccurrence([], Date.parse("2026-07-26T08:00:00.000Z")),
    ).toBeNull();
  });
});

describe("getOccurrenceServices", () => {
  const serviceTimes: ServiceTime[] = [
    service("morning", "2026-07-26T09:00:00.000Z"),
    service("evening", "2026-07-26T18:00:00.000Z"),
    service("midweek", "2026-07-29T19:00:00.000Z"),
  ];

  it("keeps only the selected occurrence's service timer", () => {
    expect(
      getOccurrenceServices(serviceTimes, {
        occurrenceId: "morning-2026-07-26",
        serviceId: "morning",
        name: "Morning",
        startsAt: "2026-07-26T09:00:00.000Z",
      }),
    ).toEqual([serviceTimes[0]]);
  });

  it("includes every service in a combined occurrence", () => {
    const timers = getOccurrenceServices(serviceTimes, {
      occurrenceId: "sunday-2026-07-26",
      serviceId: "morning",
      serviceIds: ["morning", "evening"],
      name: "Sunday services",
      startsAt: "2026-07-26T09:00:00.000Z",
    });

    expect(timers.map((serviceTime) => serviceTime.id)).toEqual([
      "morning",
      "evening",
    ]);
  });

  it("returns no timers until an occurrence is selected", () => {
    expect(getOccurrenceServices(serviceTimes, null)).toEqual([]);
  });
});

describe("formatLiveSlideProgress", () => {
  it("formats name with 1-based slide position", () => {
    expect(
      formatLiveSlideProgress({
        name: "Amazing Grace",
        slide: null,
        slideIndex: 2,
        slideCount: 12,
      }),
    ).toEqual({
      name: "Amazing Grace",
      slideLabel: "3 of 12",
    });
  });

  it("returns null when name or progress fields are missing or invalid", () => {
    expect(formatLiveSlideProgress(null)).toBeNull();
    expect(
      formatLiveSlideProgress({
        name: "   ",
        slide: null,
        slideIndex: 0,
        slideCount: 1,
      }),
    ).toBeNull();
    expect(
      formatLiveSlideProgress({
        name: "Song",
        slide: null,
        slideIndex: 0,
      }),
    ).toBeNull();
    expect(
      formatLiveSlideProgress({
        name: "Song",
        slide: null,
        slideIndex: 5,
        slideCount: 3,
      }),
    ).toBeNull();
  });
});

describe("resolveLiveSlideProgress", () => {
  it("prefers projector over monitor", () => {
    expect(
      resolveLiveSlideProgress(
        {
          name: "Projector Song",
          slide: null,
          slideIndex: 0,
          slideCount: 2,
        },
        {
          name: "Monitor Song",
          slide: null,
          slideIndex: 1,
          slideCount: 4,
        },
      ),
    ).toEqual({
      name: "Projector Song",
      slideLabel: "1 of 2",
    });
  });

  it("falls back to monitor when projector has no progress", () => {
    expect(
      resolveLiveSlideProgress(
        { name: "", slide: null },
        {
          name: "Monitor Song",
          slide: null,
          slideIndex: 1,
          slideCount: 4,
        },
      ),
    ).toEqual({
      name: "Monitor Song",
      slideLabel: "2 of 4",
    });
  });
});
