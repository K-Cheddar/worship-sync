import {
  isMemberAvailableOnDate,
  isMinorOnDate,
  recurringAvailabilityLabel,
  resolveMemberMinorStatus,
  servingFrequencyTargetReached,
} from "./memberPreferences";

describe("member preferences", () => {
  const referenceDate = new Date(2026, 7, 11);

  it("derives minor status through the eighteenth birthday", () => {
    expect(isMinorOnDate("2008-08-12", referenceDate)).toBe(true);
    expect(isMinorOnDate("2008-08-11", referenceDate)).toBe(false);
    expect(isMinorOnDate("2000-01-01", referenceDate)).toBe(false);
  });

  it("uses the manual flag only when no valid date of birth is present", () => {
    expect(resolveMemberMinorStatus({ dateOfBirth: "", isMinor: true })).toBe(
      true,
    );
    expect(
      resolveMemberMinorStatus(
        { dateOfBirth: "2000-01-01", isMinor: true },
        referenceDate,
      ),
    ).toBe(false);
  });

  it("recognizes weekly and monthly preference targets", () => {
    const occurrenceDate = new Date(2026, 7, 11);
    expect(
      servingFrequencyTargetReached({
        servingFrequency: "weekly",
        occurrenceDate,
        assignedDates: [new Date(2026, 7, 9)],
      }),
    ).toBe(true);
    expect(
      servingFrequencyTargetReached({
        servingFrequency: "monthly",
        occurrenceDate,
        assignedDates: [new Date(2026, 7, 2)],
      }),
    ).toBe(true);
    expect(
      servingFrequencyTargetReached({
        servingFrequency: "twice_monthly",
        occurrenceDate,
        assignedDates: [new Date(2026, 7, 2)],
      }),
    ).toBe(false);
    expect(
      servingFrequencyTargetReached({
        servingFrequency: "as_needed",
        occurrenceDate,
        assignedDates: [new Date(2026, 7, 2)],
      }),
    ).toBe(false);
  });

  it("limits scheduling to selected and last weeks of the month", () => {
    const fourthWeekOnly = {
      recurringAvailability: {
        weeksOfMonth: [4] as const,
        includeLastWeekOfMonth: false,
      },
    };
    expect(isMemberAvailableOnDate(fourthWeekOnly, "2026-08-22")).toBe(true);
    expect(isMemberAvailableOnDate(fourthWeekOnly, "2026-08-29")).toBe(false);
    expect(isMemberAvailableOnDate(fourthWeekOnly, "2026-08-15")).toBe(false);

    const lastWeekOnly = {
      recurringAvailability: {
        weeksOfMonth: [],
        includeLastWeekOfMonth: true,
      },
    };
    expect(isMemberAvailableOnDate(lastWeekOnly, "2026-04-25")).toBe(true);
    expect(isMemberAvailableOnDate(lastWeekOnly, "2026-04-18")).toBe(false);
    expect(recurringAvailabilityLabel(lastWeekOnly.recurringAvailability)).toBe(
      "last week",
    );
  });

  it("leaves members without recurring availability unrestricted", () => {
    expect(isMemberAvailableOnDate({}, "2026-08-15")).toBe(true);
    expect(isMemberAvailableOnDate({}, "2026-08-29")).toBe(true);
  });
});
