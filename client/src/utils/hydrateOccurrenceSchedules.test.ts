import { hydrateOccurrenceSchedules } from "./hydrateOccurrenceSchedules";
import { getTeamScheduleDetail } from "../api/auth";
import type {
  TeamSchedule,
  TeamScheduleOccurrence,
  TeamScheduleSummary,
} from "../api/authTypes";

jest.mock("../api/auth", () => ({
  getTeamScheduleDetail: jest.fn(),
}));

const mockGetTeamScheduleDetail = jest.mocked(getTeamScheduleDetail);

const occurrence: TeamScheduleOccurrence = {
  occurrenceId: "occ-1",
  serviceId: "service-1",
  name: "Sabbath Service",
  startsAt: "2026-11-07T15:00:00.000Z",
};

/** What the bootstrap sends for a date outside its hydration window. */
const summary: TeamScheduleSummary = {
  scheduleId: "schedule-1",
  churchId: "church-1",
  name: "November",
  teamId: "team-1",
  serviceIds: ["service-1"],
  occurrences: [occurrence],
  assignmentsOmitted: true,
};

const hydrated: TeamSchedule = {
  ...summary,
  assignmentsOmitted: undefined,
  assignments: {
    "occ-1": { "position-1::0": { primaryMemberId: "member-1" } },
  },
} as unknown as TeamSchedule;

/** A schedule for another date, left summarized on purpose. */
const otherDateSummary: TeamScheduleSummary = {
  ...summary,
  scheduleId: "schedule-2",
  occurrences: [
    {
      occurrenceId: "occ-later",
      serviceId: "service-1",
      name: "Sabbath Service",
      startsAt: "2027-02-06T15:00:00.000Z",
    },
  ],
};

describe("hydrateOccurrenceSchedules", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fetches the cells for schedules covering this date", async () => {
    mockGetTeamScheduleDetail.mockResolvedValue({
      success: true,
      schedule: hydrated,
      relatedSchedules: [],
    });

    const result = await hydrateOccurrenceSchedules({
      churchId: "church-1",
      occurrence,
      schedules: [summary, otherDateSummary],
    });

    expect(mockGetTeamScheduleDetail).toHaveBeenCalledWith(
      "church-1",
      "schedule-1",
    );
    expect(result.incomplete).toBe(false);
    expect(result.schedules[0]).toBe(hydrated);
    // The other date stays a summary, so switching to it can still tell that
    // its own cells are missing rather than render an empty roster.
    expect(result.schedules[1]).toBe(otherDateSummary);
  });

  it("asks for nothing when this date is already hydrated", async () => {
    const result = await hydrateOccurrenceSchedules({
      churchId: "church-1",
      occurrence,
      schedules: [hydrated, otherDateSummary],
    });

    expect(mockGetTeamScheduleDetail).not.toHaveBeenCalled();
    expect(result).toEqual({
      schedules: [hydrated, otherDateSummary],
      incomplete: false,
    });
  });

  // Reporting an empty roster after a failed fetch is the whole bug: it reads
  // as "nobody is scheduled" on a live surface.
  it("reports the roster as incomplete when the fetch fails", async () => {
    mockGetTeamScheduleDetail.mockRejectedValue(new Error("offline"));
    const schedules = [summary];

    const result = await hydrateOccurrenceSchedules({
      churchId: "church-1",
      occurrence,
      schedules,
    });

    expect(result.incomplete).toBe(true);
    // The same array, not an equal copy: callers hold this in state and re-run
    // on its identity, so a fresh array here would refetch forever.
    expect(result.schedules).toBe(schedules);
  });

  it("keeps the schedules that did arrive when only one fetch fails", async () => {
    const secondCovering: TeamScheduleSummary = {
      ...summary,
      scheduleId: "schedule-3",
      teamId: "team-2",
    };
    mockGetTeamScheduleDetail.mockImplementation(async (_churchId, scheduleId) =>
      scheduleId === "schedule-1"
        ? { success: true, schedule: hydrated, relatedSchedules: [] }
        : Promise.reject(new Error("offline")));

    const result = await hydrateOccurrenceSchedules({
      churchId: "church-1",
      occurrence,
      schedules: [summary, secondCovering],
    });

    expect(result.schedules[0]).toBe(hydrated);
    expect(result.schedules[1]).toBe(secondCovering);
    expect(result.incomplete).toBe(true);
  });
});
