import {
  readPlansFilterPreferences,
  writePlansFilterPreferences,
} from "./plansFilterPersistence";

describe("Plans filter persistence", () => {
  beforeEach(() => window.localStorage.clear());

  it("stores service filters and organize mode separately for each church", () => {
    writePlansFilterPreferences("church-a", {
      serviceIds: ["service-a"],
      organizeMode: "byService",
    });

    expect(readPlansFilterPreferences("church-a")).toEqual({
      serviceIds: ["service-a"],
      organizeMode: "byService",
    });
    expect(readPlansFilterPreferences("church-b")).toBeNull();
  });

  it("ignores legacy range fields while retaining unrelated preferences", () => {
    window.localStorage.setItem(
      "worshipSync:teamsPlansFilters:church-a",
      JSON.stringify({
        serviceIds: ["service-a"],
        organizeMode: "byService",
        rangePreset: "custom",
        customStartDate: "2026-08-01",
        customEndDate: "2026-08-31",
      }),
    );

    expect(readPlansFilterPreferences("church-a")).toEqual({
      serviceIds: ["service-a"],
      organizeMode: "byService",
    });
  });

  it("ignores malformed stored preferences", () => {
    window.localStorage.setItem("worshipSync:teamsPlansFilters:church-a", "not-json");
    expect(readPlansFilterPreferences("church-a")).toBeNull();
  });
});
