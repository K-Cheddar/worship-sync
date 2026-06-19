import { canServicesShareDay } from "./teamsUtils";

describe("canServicesShareDay", () => {
  it("matches weekly services on the same weekday", () => {
    expect(
      canServicesShareDay(
        { reccurence: "weekly", dayOfWeek: 0 },
        { reccurence: "weekly", dayOfWeek: 0 },
      ),
    ).toBe(true);
  });

  it("rejects weekly services on different weekdays", () => {
    expect(
      canServicesShareDay(
        { reccurence: "weekly", dayOfWeek: 0 },
        { reccurence: "weekly", dayOfWeek: 3 },
      ),
    ).toBe(false);
  });

  it("matches a weekly Sunday with a monthly Sunday service", () => {
    expect(
      canServicesShareDay(
        { reccurence: "weekly", dayOfWeek: 0 },
        { reccurence: "monthly", weekday: 0 },
      ),
    ).toBe(true);
  });

  it("matches when a multi-weekly day overlaps", () => {
    expect(
      canServicesShareDay(
        { reccurence: "weekly", dayOfWeek: 4 },
        {
          reccurence: "multi_weekly",
          daysOfWeek: [
            { day: 2, time: "18:30" },
            { day: 4, time: "18:30" },
          ],
        },
      ),
    ).toBe(true);
  });

  it("requires the exact date for two one-time services", () => {
    expect(
      canServicesShareDay(
        { reccurence: "one_time", dateTimeISO: "2026-07-05T09:00:00.000Z" },
        { reccurence: "one_time", dateTimeISO: "2026-07-05T11:00:00.000Z" },
      ),
    ).toBe(true);
    expect(
      canServicesShareDay(
        { reccurence: "one_time", dateTimeISO: "2026-07-05T09:00:00.000Z" },
        { reccurence: "one_time", dateTimeISO: "2026-07-12T09:00:00.000Z" },
      ),
    ).toBe(false);
  });

  it("returns false when a recurrence has no resolvable day yet", () => {
    expect(
      canServicesShareDay(
        { reccurence: "multi_weekly", daysOfWeek: [] },
        { reccurence: "weekly", dayOfWeek: 0 },
      ),
    ).toBe(false);
  });
});
