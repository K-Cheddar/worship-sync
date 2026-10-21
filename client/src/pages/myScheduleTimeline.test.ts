import type { MyScheduleOccurrence } from "../api/auth";
import type { VolunteerAvailabilityRequest } from "./myScheduleOperations";
import {
  buildMyScheduleTimeline,
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

const request = (
  recipientId: string,
  occurrenceId = "group:combined@2026-10-31",
  overrides: Partial<VolunteerAvailabilityRequest> = {},
): VolunteerAvailabilityRequest => ({
  recipientId,
  formId: `form-${recipientId}`,
  name: `Availability ${recipientId}`,
  responseDeadline: "2026-11-10",
  availabilityMessage: "",
  respondedAt: "",
  teamIds: ["media"],
  teamNames: ["Media"],
  occurrences: [{
    occurrenceId,
    serviceId: "sunday",
    name: "Sunday service",
    startsAt: "2026-11-01T02:00:00.000Z",
    serviceDate: "2026-10-31",
  }],
  availability: {},
  ...overrides,
});

describe("My Schedule timeline model", () => {
  it("joins availability by exact authoritative occurrence identity and preserves overlapping requests", () => {
    const timeline = buildMyScheduleTimeline(
      [assigned()],
      [request("request-a"), request("request-b")],
      "America/New_York",
    );

    expect(timeline).toHaveLength(1);
    expect(timeline[0].name).toBe("Sunday & Evening");
    expect(timeline[0].serviceIds).toEqual(["evening", "sunday"]);
    expect(timeline[0].availabilityRequests.map((item) => item.recipientId)).toEqual([
      "request-a",
      "request-b",
    ]);
  });

  it("does not join unrelated services that happen on the same date", () => {
    const timeline = buildMyScheduleTimeline(
      [assigned()],
      [request("request-a", "sunday@2026-10-31")],
      "America/New_York",
    );

    expect(timeline).toHaveLength(2);
    expect(timeline.filter((item) => item.availabilityRequests.length)).toHaveLength(1);
  });

  it("uses saved church dates and sorts month groups by occurrence date", () => {
    const lateOctober = assigned({ occurrenceId: "october-31", date: "2026-10-31" });
    const november = assigned({ occurrenceId: "november-1", date: "2026-11-01", startsAt: "2026-11-01T04:00:00.000Z" });
    const timeline = buildMyScheduleTimeline([november, lateOctober], [], "America/New_York");

    expect(myScheduleOccurrenceDate(lateOctober, "America/New_York")).toBe("2026-10-31");
    expect(groupMyScheduleByMonth(timeline, "America/New_York").map((month) => month.label)).toEqual([
      "October 2026",
      "November 2026",
    ]);
  });

  it("uses the church timezone for availability-only dates and keeps a combined occurrence in one service group", () => {
    const timeline = buildMyScheduleTimeline(
      [assigned()],
      [request("request-a")],
      "America/New_York",
    );
    const groups = groupMyScheduleByService(timeline);

    expect(myScheduleOccurrenceDate(timeline[0], "America/New_York")).toBe("2026-10-31");
    expect(groups).toHaveLength(1);
    expect(groups[0].serviceIds).toEqual(["evening", "sunday"]);
    expect(groups[0].occurrences).toHaveLength(1);
  });

  it("groups legacy occurrences without service IDs by their service name", () => {
    const first = assigned({ occurrenceId: "legacy-first", serviceIds: [], name: "Legacy Gathering" });
    const second = assigned({ occurrenceId: "legacy-second", serviceIds: [], name: "Legacy Gathering" });
    const groups = groupMyScheduleByService(buildMyScheduleTimeline([first, second], [], "UTC"));

    expect(groups).toHaveLength(1);
    expect(groups[0].occurrences.map((item) => item.occurrenceId)).toEqual([
      "legacy-first",
      "legacy-second",
    ]);
  });
});
