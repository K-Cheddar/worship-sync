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

  it("falls back from an invalid custom range to Upcoming", () => {
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
      rangePreset: "upcoming",
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

    expect(readPlansFilterPreferences("church-a")?.rangePreset).toBe("upcoming");
  });

  it("ignores malformed stored preferences", () => {
    window.localStorage.setItem("worshipSync:teamsPlansFilters:church-a", "not-json");

    expect(readPlansFilterPreferences("church-a")).toBeNull();
  });

  it("migrates the old persisted default without clearing other filters", () => {
    window.localStorage.setItem(
      "worshipSync:teamsPlansFilters:church-a",
      JSON.stringify({
        serviceIds: ["service-a"],
        organizeMode: "byService",
        rangePreset: "thisMonth",
      }),
    );

    expect(readPlansFilterPreferences("church-a")).toEqual({
      serviceIds: ["service-a"],
      organizeMode: "byService",
      rangePreset: "upcoming",
    });
  });

  it("persists an explicit This month choice in the current version", () => {
    writePlansFilterPreferences("church-a", {
      serviceIds: ["service-a"],
      organizeMode: "byDate",
      rangePreset: "thisMonth",
    });

    expect(readPlansFilterPreferences("church-a")?.rangePreset).toBe("thisMonth");
    expect(JSON.parse(window.localStorage.getItem("worshipSync:teamsPlansFilters:church-a") || "{}").version).toBe(1);
  });
});
