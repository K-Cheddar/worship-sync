import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import {
  formatResolvedDateRange,
  rangeSelectionStorageKey,
  readRangeSelectionPreference,
  resolveRangePreset,
  resolveRangeSelection,
  shiftRange,
  type RangePreset,
  writeRangeSelectionPreference,
  useRangeSelection,
} from "./rangeSelection";

describe("resolveRangePreset", () => {
  const lateSeptember = new Date(2026, 8, 29, 12);

  it.each([
    ["upcoming", { start: "2026-09-29", end: "2026-10-31" }],
    ["thisMonth", { start: "2026-09-01", end: "2026-09-30" }],
    ["nextMonth", { start: "2026-10-01", end: "2026-10-31" }],
    ["thisQuarter", { start: "2026-07-01", end: "2026-09-30" }],
    ["nextQuarter", { start: "2026-10-01", end: "2026-12-31" }],
  ] as const)("resolves %s", (preset, expected) => {
    expect(resolveRangePreset(preset, lateSeptember)).toEqual(expected);
  });

  it("handles the December and quarter-year boundaries", () => {
    expect(resolveRangePreset("upcoming", new Date(2026, 11, 31, 12))).toEqual({
      start: "2026-12-31",
      end: "2027-01-31",
    });
    expect(resolveRangePreset("nextQuarter", new Date(2026, 10, 8, 12))).toEqual({
      start: "2027-01-01",
      end: "2027-03-31",
    });
  });
});

describe("shared range display helpers", () => {
  it("formats the resolved range for supporting text", () => {
    expect(formatResolvedDateRange({ start: "2026-10-01", end: "2026-10-31" })).toBe(
      "Oct 1, 2026 – Oct 31, 2026",
    );
  });

  it("shifts custom and fixed ranges without changing their semantic length", () => {
    expect(shiftRange("custom", { start: "2026-09-29", end: "2026-10-03" }, 1)).toEqual({
      start: "2026-10-04",
      end: "2026-10-08",
    });
    expect(shiftRange("thisMonth", { start: "2026-12-01", end: "2026-12-31" }, 1)).toEqual({
      start: "2027-01-01",
      end: "2027-01-31",
    });
  });
});

describe("shared range persistence", () => {
  beforeEach(() => localStorage.clear());

  it("keeps saved ranges page-specific", () => {
    const servicesKey = rangeSelectionStorageKey("services", "church-a");
    const schedulesKey = rangeSelectionStorageKey("schedules", "church-a");

    writeRangeSelectionPreference(servicesKey, { preset: "thisQuarter" });
    writeRangeSelectionPreference(schedulesKey, { preset: "upcoming" });

    expect(readRangeSelectionPreference(servicesKey)?.preset).toBe("thisQuarter");
    expect(readRangeSelectionPreference(schedulesKey)?.preset).toBe("upcoming");
  });

  it("resolves query state before saved state and defaults to Upcoming", () => {
    const defaultRange = { start: "2026-09-29", end: "2026-10-31" };
    const resolver = (preset: Exclude<RangePreset, "custom">) =>
      preset === "thisMonth"
        ? { start: "2026-09-01", end: "2026-09-30" }
        : defaultRange;

    expect(resolveRangeSelection({
      savedSelection: { preset: "thisQuarter" },
      defaultRange,
      resolvePresetRange: resolver,
    })).toMatchObject({ preset: "thisQuarter", source: "saved" });
    expect(resolveRangeSelection({
      querySelection: { preset: "thisMonth" },
      savedSelection: { preset: "thisQuarter" },
      defaultRange,
      resolvePresetRange: resolver,
    })).toEqual({
      preset: "thisMonth",
      range: { start: "2026-09-01", end: "2026-09-30" },
      source: "query",
    });
    expect(resolveRangeSelection({ defaultRange, resolvePresetRange: resolver })).toEqual({
      preset: "upcoming",
      range: defaultRange,
      source: "default",
    });
  });

  it("reads the existing Services filter record as a migration fallback", () => {
    const legacyKey = "worshipSync:teamsPlansFilters:church-a";
    localStorage.setItem(legacyKey, JSON.stringify({
      version: 1,
      rangePreset: "custom",
      customStartDate: "2026-08-01",
      customEndDate: "2026-08-31",
    }));

    expect(readRangeSelectionPreference(legacyKey)).toEqual({
      preset: "custom",
      range: { start: "2026-08-01", end: "2026-08-31" },
    });
  });

  it("restores an intentional selection without sharing it across page keys", async () => {
    const user = userEvent.setup();
    const Harness = ({ page }: { page: string }) => {
      const selection = useRangeSelection({
        persistence: { key: rangeSelectionStorageKey(page, "church-a") },
      });
      return createElement(
        "div",
        null,
        createElement("output", null, selection.preset),
        createElement(
          "button",
          { type: "button", onClick: () => selection.selectPreset("thisQuarter") },
          "This quarter",
        ),
      );
    };

    const view = render(createElement(Harness, { page: "schedules" }));
    expect(screen.getByText("upcoming")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "This quarter" }));
    expect(screen.getByText("thisQuarter")).toBeInTheDocument();
    view.unmount();

    render(createElement(Harness, { page: "schedules" }));
    expect(screen.getByText("thisQuarter")).toBeInTheDocument();
    cleanup();

    render(createElement(Harness, { page: "forms" }));
    expect(screen.getByText("upcoming")).toBeInTheDocument();
  });
});
