import type { TeamBlockoutDateRange, TeamService } from "../../api/authTypes";
import {
  buildIntakeAvailabilityServiceOptions,
  filterBlockoutDatesForScheduleRange,
  findBlockoutRangeForDate,
  formatShortOccurrenceDate,
  isServiceActive,
  isServicePastEnd,
  serviceDateBlockedOut,
} from "./teamsUtils";

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
describe("formatShortOccurrenceDate", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("formats a short date and time separated by @", () => {
    jest
      .spyOn(Date.prototype, "toLocaleDateString")
      .mockReturnValue("Wed, Jul 1, 2026");
    jest.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("7:00 PM");

    expect(formatShortOccurrenceDate("2026-07-01T19:00:00")).toBe(
      "Wed, Jul 1, 2026 @ 7:00 PM",
    );
  });
});
describe("filterBlockoutDatesForScheduleRange", () => {
  const range = (
    startDate: string,
    endDate = startDate,
    notes?: string,
  ): TeamBlockoutDateRange => ({ startDate, endDate, notes });

  it("returns all blockouts when the schedule has no date bounds", () => {
    const blockouts = [range("2026-01-01", "2026-01-31")];
    expect(filterBlockoutDatesForScheduleRange(blockouts, "", "")).toEqual(
      blockouts,
    );
  });

  it("drops blockouts that fall entirely outside the schedule", () => {
    expect(
      filterBlockoutDatesForScheduleRange(
        [range("2025-12-01", "2025-12-31"), range("2026-08-01", "2026-08-31")],
        "2026-07-01",
        "2026-07-31",
      ),
    ).toEqual([]);
  });

  it("keeps blockouts that fall entirely inside the schedule", () => {
    const blockouts = [range("2026-07-10", "2026-07-12", "Vacation")];
    expect(
      filterBlockoutDatesForScheduleRange(
        blockouts,
        "2026-07-01",
        "2026-07-31",
      ),
    ).toEqual(blockouts);
  });

  it("clips blockouts that overlap the schedule on one side", () => {
    expect(
      filterBlockoutDatesForScheduleRange(
        [range("2026-06-15", "2026-07-10", "Away")],
        "2026-07-01",
        "2026-07-31",
      ),
    ).toEqual([range("2026-07-01", "2026-07-10", "Away")]);
  });
});

describe("isServicePastEnd / isServiceActive", () => {
  it("treats a service as past end after its inclusive end date", () => {
    const ended = service({ endDateISO: "2026-07-01" });
    expect(isServicePastEnd(ended, new Date(2026, 6, 1, 23, 59, 59))).toBe(
      false,
    );
    expect(isServicePastEnd(ended, new Date(2026, 6, 2, 0, 0, 0))).toBe(true);
  });

  it("marks ended services inactive while keeping unbounded services active", () => {
    expect(
      isServiceActive(
        service({ endDateISO: "2026-06-01" }),
        new Date(2026, 6, 1),
      ),
    ).toBe(false);
    expect(isServiceActive(service({}), new Date(2026, 6, 1))).toBe(true);
  });

  it("treats archived services as inactive even without an end date", () => {
    expect(
      isServiceActive(
        service({ archivedAt: "2026-01-01T00:00:00.000Z" }),
        new Date(2026, 6, 1),
      ),
    ).toBe(false);
  });

  it("stays safe when used directly with Array.filter (index as 2nd arg)", () => {
    const services = [
      service({ serviceId: "open", endDateISO: undefined }),
      service({ serviceId: "ended", endDateISO: "2020-01-01" }),
    ];
    expect(
      services.filter(isServiceActive).map((item) => item.serviceId),
    ).toEqual(["open"]);
  });
});
describe("buildIntakeAvailabilityServiceOptions", () => {
  it("groups linked services into one availability option with all service ids", () => {
    const options = buildIntakeAvailabilityServiceOptions([
      service({
        serviceId: "first",
        name: "First Service",
        time: "09:00",
        serviceGroupId: "sunday-am",
      }),
      service({
        serviceId: "second",
        name: "Second Service",
        time: "11:00",
        serviceGroupId: "sunday-am",
      }),
      service({
        serviceId: "evening",
        name: "Evening Service",
        time: "18:00",
      }),
    ]);

    expect(options).toHaveLength(2);
    expect(options[0]).toEqual(
      expect.objectContaining({
        id: "group:sunday-am",
        label: "First Service & Second Service",
        serviceIds: ["first", "second"],
      }),
    );
    expect(options[1]).toEqual(
      expect.objectContaining({
        id: "evening",
        label: "Evening Service",
        serviceIds: ["evening"],
      }),
    );
  });

  it("keeps a service with an orphaned group id as its own option", () => {
    const options = buildIntakeAvailabilityServiceOptions([
      service({
        serviceId: "first",
        name: "First Service",
        serviceGroupId: "sunday-am",
      }),
    ]);

    expect(options).toEqual([
      expect.objectContaining({
        id: "first",
        label: "First Service",
        serviceIds: ["first"],
      }),
    ]);
  });
});

// Shared by the assignment picker, the grid's stale-assignment flag, and the
// volunteer's own schedule page. If these three ever disagree on what "blocked
// out" means, an owner and a volunteer see different truths about one date.
describe("findBlockoutRangeForDate", () => {
  const away: TeamBlockoutDateRange = {
    startDate: "2026-09-06",
    endDate: "2026-09-13",
    notes: "Away",
  };

  it("matches the range's first and last day inclusively", () => {
    expect(findBlockoutRangeForDate([away], "2026-09-06")).toEqual(away);
    expect(findBlockoutRangeForDate([away], "2026-09-13")).toEqual(away);
    expect(findBlockoutRangeForDate([away], "2026-09-10")).toEqual(away);
  });

  it("returns null just outside the range", () => {
    expect(findBlockoutRangeForDate([away], "2026-09-05")).toBeNull();
    expect(findBlockoutRangeForDate([away], "2026-09-14")).toBeNull();
  });

  it("reads an entry with no end date as a single day", () => {
    const single = { startDate: "2026-09-06", endDate: "" };
    expect(findBlockoutRangeForDate([single], "2026-09-06")).toEqual(single);
    expect(findBlockoutRangeForDate([single], "2026-09-07")).toBeNull();
  });

  it("is null for missing input rather than throwing", () => {
    expect(findBlockoutRangeForDate(undefined, "2026-09-06")).toBeNull();
    expect(findBlockoutRangeForDate([away], "")).toBeNull();
    expect(
      findBlockoutRangeForDate([{ startDate: "", endDate: "" }], "2026-09-06"),
    ).toBeNull();
  });

  it("reports blockout state for a member", () => {
    expect(serviceDateBlockedOut({ blockoutDates: [away] }, "2026-09-06")).toBe(
      true,
    );
    expect(serviceDateBlockedOut({ blockoutDates: [away] }, "2026-09-20")).toBe(
      false,
    );
    expect(serviceDateBlockedOut({ blockoutDates: [] }, "2026-09-06")).toBe(
      false,
    );
  });
});
