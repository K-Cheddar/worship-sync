import {
  matchesServicePlanningSectionName,
  normalizeServicePlanningHeadingName,
} from "./servicePlanningSectionResolution";

describe("Service Planning section name matching", () => {
  it("keeps exact, contains, and normalize section-rule semantics shared", () => {
    expect(matchesServicePlanningSectionName("Opening Worship", {
      matchSectionName: "Opening Worship",
      matchMode: "exact",
    })).toBe(true);
    expect(matchesServicePlanningSectionName("Worship", {
      matchSectionName: "Pre-Service Worship Set",
      matchMode: "contains",
    })).toBe(true);
    expect(matchesServicePlanningSectionName("Praise & Worship", {
      matchSectionName: "praise & worship",
      matchMode: "normalize",
    })).toBe(true);
    expect(matchesServicePlanningSectionName("Worship Team", {
      matchSectionName: "Worship",
      matchMode: "exact",
    })).toBe(false);
  });

  it("normalizes heading identity without using substring matching", () => {
    expect(normalizeServicePlanningHeadingName("  Praise &   Worship  "))
      .toBe(normalizeServicePlanningHeadingName("praise worship"));
    expect(normalizeServicePlanningHeadingName("Worship"))
      .not.toBe(normalizeServicePlanningHeadingName("Worship Team"));
  });
});
