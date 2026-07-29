import type { TeamScheduleOccurrence } from "../api/authTypes";
import { getServicePlanKey } from "./servicePlanKeys";

const occurrence = (
  overrides: Partial<TeamScheduleOccurrence>,
): TeamScheduleOccurrence => ({
  occurrenceId: "service-1@2026-07-26T14:00:00.000Z",
  serviceId: "service-1",
  name: "Sunday Service",
  startsAt: "2026-07-26T14:00:00.000Z",
  ...overrides,
});

describe("getServicePlanKey", () => {
  it("keys an ungrouped occurrence by serviceId@date", () => {
    expect(getServicePlanKey(occurrence({}))).toBe("service-1@2026-07-26");
  });

  it("keys a combined/grouped occurrence by group:groupId@date instead", () => {
    expect(
      getServicePlanKey(
        occurrence({ groupId: "group-1", serviceIds: ["service-1", "service-2"] }),
      ),
    ).toBe("group:group-1@2026-07-26");
  });

  it("is stable across occurrences on the same date and service, regardless of time-of-day", () => {
    const morning = occurrence({ startsAt: "2026-07-26T14:00:00.000Z" });
    const evening = occurrence({ startsAt: "2026-07-26T23:00:00.000Z" });
    expect(getServicePlanKey(morning)).toBe(getServicePlanKey(evening));
  });

  it("differs across dates for the same service", () => {
    const thisWeek = occurrence({ startsAt: "2026-07-26T14:00:00.000Z" });
    const nextWeek = occurrence({ startsAt: "2026-08-02T14:00:00.000Z" });
    expect(getServicePlanKey(thisWeek)).not.toBe(getServicePlanKey(nextWeek));
  });
});
