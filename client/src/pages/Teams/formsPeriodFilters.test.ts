import type { TeamIntakeForm } from "../../api/authTypes";
import { filterFormsByDateRange } from "./formsPeriodFilters";

const form = (changes: Partial<TeamIntakeForm> = {}) => ({
  formId: "form-1",
  churchId: "church-1",
  name: "Availability",
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  availabilityServices: [],
  availabilityOccurrences: [],
  teamIds: [],
  active: true,
  ...changes,
}) as TeamIntakeForm;

describe("filterFormsByDateRange", () => {
  it("includes forms that overlap either edge of the selected period inclusively", () => {
    const endingAtStart = form({ formId: "start", endDate: "2026-09-29" });
    const startingAtEnd = form({ formId: "end", startDate: "2026-10-31", endDate: "2026-11-10" });

    expect(filterFormsByDateRange([endingAtStart, startingAtEnd], {
      startDate: "2026-09-29",
      endDate: "2026-10-31",
    })).toEqual([endingAtStart, startingAtEnd]);
  });

  it("excludes forms outside the range while retaining matching closed and archived forms", () => {
    const closed = form({ formId: "closed", active: false, archivedAt: "2026-09-10" });
    const later = form({ formId: "later", startDate: "2026-11-01", endDate: "2026-11-30" });

    expect(filterFormsByDateRange([closed, later], {
      startDate: "2026-09-29",
      endDate: "2026-10-31",
    })).toEqual([closed]);
  });

  it("supports a custom period with the same inclusive overlap rule", () => {
    const formStartingOnRangeEnd = form({ startDate: "2026-08-31", endDate: "2026-09-01" });
    expect(filterFormsByDateRange([formStartingOnRangeEnd], {
      startDate: "2026-09-01",
      endDate: "2026-09-01",
    })).toEqual([formStartingOnRangeEnd]);
  });
});
