import {
  chooseControllerServicePlanKey,
  limitControllerServicePlans,
  sortControllerServicePlans,
} from "./controllerServicePlanSelection";
import type { ServicePlanSummary } from "../../types/servicePlan";

const plan = (
  planKey: string,
  startsAt: string,
): ServicePlanSummary => ({
  planKey,
  serviceId: planKey.split("@")[0],
  date: startsAt.slice(0, 10),
  startsAt,
  name: planKey,
});

describe("chooseControllerServicePlanKey", () => {
  const plans = [
    plan("past@2026-08-01", "2026-08-01T10:00:00.000Z"),
    plan("current@2026-08-09", "2026-08-09T10:00:00.000Z"),
    plan("next@2026-08-16", "2026-08-16T10:00:00.000Z"),
  ];

  it("prefers the plan linked to the selected outline", () => {
    expect(
      chooseControllerServicePlanKey({
        plans,
        boundPlanKey: "next@2026-08-16",
        currentOccurrencePlanKey: "current@2026-08-09",
        nowMs: Date.parse("2026-08-08T12:00:00.000Z"),
      }),
    ).toBe("next@2026-08-16");
  });

  it("uses the current occurrence when the outline has no valid binding", () => {
    expect(
      chooseControllerServicePlanKey({
        plans,
        boundPlanKey: "deleted@2026-07-01",
        currentOccurrencePlanKey: "current@2026-08-09",
      }),
    ).toBe("current@2026-08-09");
  });

  it("falls back to the nearest upcoming saved plan", () => {
    expect(
      chooseControllerServicePlanKey({
        plans,
        nowMs: Date.parse("2026-08-08T12:00:00.000Z"),
      }),
    ).toBe("current@2026-08-09");
  });
});

describe("sortControllerServicePlans", () => {
  it("shows upcoming plans first and keeps recent plans newest first", () => {
    const plans = [
      plan("old@2026-07-01", "2026-07-01T10:00:00.000Z"),
      plan("later@2026-08-16", "2026-08-16T10:00:00.000Z"),
      plan("recent@2026-08-01", "2026-08-01T10:00:00.000Z"),
      plan("next@2026-08-09", "2026-08-09T10:00:00.000Z"),
    ];

    expect(
      sortControllerServicePlans(
        plans,
        Date.parse("2026-08-08T12:00:00.000Z"),
      ).map(({ planKey }) => planKey),
    ).toEqual([
      "next@2026-08-09",
      "later@2026-08-16",
      "recent@2026-08-01",
      "old@2026-07-01",
    ]);
  });
});

describe("limitControllerServicePlans", () => {
  const nowMs = Date.parse("2026-08-08T12:00:00.000Z");
  const dayMs = 24 * 60 * 60 * 1000;
  const upcoming = Array.from({ length: 12 }, (_, index) =>
    plan(
      `upcoming-${index + 1}`,
      new Date(nowMs + (index + 1) * dayMs).toISOString(),
    ),
  );
  const recent = Array.from({ length: 12 }, (_, index) =>
    plan(
      `recent-${index + 1}`,
      new Date(nowMs - (index + 1) * dayMs).toISOString(),
    ),
  );

  it("shows at most ten upcoming and ten recent plans by default", () => {
    const visibleKeys = limitControllerServicePlans({
      plans: [...recent, ...upcoming],
      nowMs,
    }).map(({ planKey }) => planKey);

    expect(visibleKeys).toHaveLength(20);
    expect(visibleKeys).toEqual([
      ...upcoming.slice(0, 10).map(({ planKey }) => planKey),
      ...recent.slice(0, 10).map(({ planKey }) => planKey),
    ]);
  });

  it("retains selected and linked plans outside the normal limits", () => {
    const visibleKeys = limitControllerServicePlans({
      plans: [...recent, ...upcoming],
      selectedPlanKey: "upcoming-12",
      boundPlanKey: "recent-12",
      nowMs,
    }).map(({ planKey }) => planKey);

    expect(visibleKeys).toHaveLength(22);
    expect(visibleKeys).toContain("upcoming-12");
    expect(visibleKeys).toContain("recent-12");
  });
});
