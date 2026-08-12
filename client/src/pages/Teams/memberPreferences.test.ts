import {
  isMinorOnDate,
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
});
