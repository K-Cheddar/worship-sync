import {
  getPlanningCenterServiceTimesForDate,
  isValidPlanningCenterId,
  planningCenterPlanCandidateKey,
  resolvePlanningCenterPlanCandidates,
} from "./planningCenterDiscovery";
import type { PlanningCenterPlanSummary } from "../../api/planningCenter";

const plan = (
  id: string,
  serviceTimes: NonNullable<PlanningCenterPlanSummary["serviceTimes"]>,
): PlanningCenterPlanSummary => ({
  id,
  serviceTypeId: "type-1",
  dates: "display label is deliberately ignored",
  title: "Sunday",
  label: "Sunday",
  itemsCount: 1,
  sortDate: "not used for matching",
  serviceTimes,
  sourceUrl: "",
});

describe("Planning Center plan discovery", () => {
  it("uses actual service times in the church timezone and ignores other time types", () => {
    const candidate = plan("plan-1", [
      { startsAt: "2026-11-01T13:00:00Z", timeType: "rehearsal" },
      { startsAt: "2026-11-01T14:00:00Z", timeType: "service" },
    ]);

    expect(
      resolvePlanningCenterPlanCandidates(
        [candidate],
        { serviceDate: "2026-11-01", startsAt: "2026-11-01T10:00:00-04:00" },
        "America/New_York",
      ),
    ).toEqual({ candidates: [candidate], uniqueCandidate: candidate });
    expect(
      getPlanningCenterServiceTimesForDate(
        candidate,
        "2026-11-01",
        "America/New_York",
      ),
    ).toEqual(["09:00"]);
  });

  it("prefers one exact service-time match over other plans on the same date", () => {
    const morning = plan("morning", [
      { startsAt: "2026-11-08T14:00:00Z", timeType: "service" },
    ]);
    const evening = plan("evening", [
      { startsAt: "2026-11-08T23:00:00Z", timeType: "service" },
    ]);

    expect(
      resolvePlanningCenterPlanCandidates(
        [morning, evening],
        { serviceDate: "2026-11-08", startsAt: "2026-11-08T14:00:00Z" },
        "America/New_York",
      ),
    ).toEqual({ candidates: [morning], uniqueCandidate: morning });
  });

  it("keeps multiple plans as explicit choices when date evidence is ambiguous", () => {
    const first = plan("plan-1", [
      { startsAt: "2026-11-08T14:00:00Z", timeType: "service" },
    ]);
    const second = plan("plan-2", [
      { startsAt: "2026-11-08T16:00:00Z", timeType: "service" },
    ]);

    expect(
      resolvePlanningCenterPlanCandidates(
        [first, second],
        { serviceDate: "2026-11-08", startsAt: "2026-11-08T19:00:00Z" },
        "America/New_York",
      ),
    ).toEqual({ candidates: [first, second], uniqueCandidate: null });
  });

  it("matches any service time in a plan and supports dates in the past or future", () => {
    const planWithTwoServices = plan("multi-service", [
      { startsAt: "2024-02-11T14:00:00Z", timeType: "service" },
      { startsAt: "2024-02-11T16:00:00Z", timeType: "service" },
    ]);
    const future = plan("future", [
      { startsAt: "2032-02-29T15:00:00Z", timeType: "service" },
    ]);

    expect(
      resolvePlanningCenterPlanCandidates(
        [planWithTwoServices],
        { serviceDate: "2024-02-11", startsAt: "2024-02-11T16:00:00Z" },
        "America/New_York",
      ).uniqueCandidate,
    ).toBe(planWithTwoServices);
    expect(
      resolvePlanningCenterPlanCandidates(
        [future],
        { serviceDate: "2032-02-29", startsAt: "2032-02-29T10:00:00-05:00" },
        "America/New_York",
      ).uniqueCandidate,
    ).toBe(future);
  });

  it("deduplicates duplicate service-type/plan results and validates exact identifiers", () => {
    const candidate = plan("plan_1", [
      { startsAt: "2026-07-26T14:00:00Z", timeType: "service" },
    ]);

    expect(
      resolvePlanningCenterPlanCandidates(
        [candidate, { ...candidate }],
        { serviceDate: "2026-07-26", startsAt: "2026-07-26T10:00:00-04:00" },
        "America/New_York",
      ).candidates,
    ).toEqual([candidate]);
    expect(planningCenterPlanCandidateKey(candidate)).toBe("type-1:plan_1");
    expect(isValidPlanningCenterId("service-type-1")).toBe(true);
    expect(isValidPlanningCenterId("bad/id")).toBe(false);
    expect(isValidPlanningCenterId("  plan-1  ")).toBe(false);
  });
});
