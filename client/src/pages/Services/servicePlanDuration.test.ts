import {
  formatServicePlanDuration,
  getServicePlanDurationSeconds,
  parseServicePlanDuration,
} from "./servicePlanDuration";

describe("service-plan durations", () => {
  it("accepts familiar minute and second formats without losing precision", () => {
    expect(parseServicePlanDuration("1:30")).toBe(90);
    expect(parseServicePlanDuration("90s")).toBe(90);
    expect(parseServicePlanDuration("1m 30s")).toBe(90);
    expect(parseServicePlanDuration("2 min")).toBe(120);
    expect(parseServicePlanDuration("5")).toBe(300);
  });

  it("prefers canonical seconds and formats a compact editor value", () => {
    expect(getServicePlanDurationSeconds({ durationSeconds: 90, durationMinutes: 5 })).toBe(90);
    expect(getServicePlanDurationSeconds({ durationMinutes: 1.5 })).toBe(90);
    expect(formatServicePlanDuration({ durationSeconds: 90 })).toBe("1:30");
    expect(formatServicePlanDuration({ durationSeconds: 300 })).toBe("5 min");
  });
});
