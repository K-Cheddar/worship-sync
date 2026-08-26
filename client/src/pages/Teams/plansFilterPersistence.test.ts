import {
  readPlansFilterPreferences,
  writePlansFilterPreferences,
} from "./plansFilterPersistence";

describe("Plans filter persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stores preferences separately for each church", () => {
    writePlansFilterPreferences("church-a", {
      serviceIds: ["service-a"],
      organizeMode: "byService",
      rangePreset: "custom",
      customStartDate: "2026-08-01",
      customEndDate: "2026-08-31",
    });

    expect(readPlansFilterPreferences("church-a")).toEqual({
      serviceIds: ["service-a"],
      organizeMode: "byService",
      rangePreset: "custom",
      customStartDate: "2026-08-01",
      customEndDate: "2026-08-31",
    });
    expect(readPlansFilterPreferences("church-b")).toBeNull();
  });

  it("falls back from an invalid custom range to this month", () => {
    writePlansFilterPreferences("church-a", {
      serviceIds: [],
      organizeMode: "byDate",
      rangePreset: "custom",
      customStartDate: "2026-09-01",
      customEndDate: "2026-08-01",
    });

    expect(readPlansFilterPreferences("church-a")).toEqual({
      serviceIds: [],
      organizeMode: "byDate",
      rangePreset: "thisMonth",
    });
  });

  it("rejects impossible calendar dates", () => {
    window.localStorage.setItem(
      "worshipSync:teamsPlansFilters:church-a",
      JSON.stringify({
        serviceIds: [],
        organizeMode: "byDate",
        rangePreset: "custom",
        customStartDate: "2026-02-29",
        customEndDate: "2026-02-31",
      }),
    );

    expect(readPlansFilterPreferences("church-a")?.rangePreset).toBe("thisMonth");
  });

  it("ignores malformed stored preferences", () => {
    window.localStorage.setItem("worshipSync:teamsPlansFilters:church-a", "not-json");

    expect(readPlansFilterPreferences("church-a")).toBeNull();
  });
});
