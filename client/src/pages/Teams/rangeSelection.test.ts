import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import {
  calendarMonthRange,
  formatResolvedDateRange,
  resolveRangeSelection,
  resolveRangePreset,
  shiftRange,
  useRangeSelection,
} from "./rangeSelection";
import { serverDate, setServerTimeOffset } from "../../utils/serverTime";
import { formatPlainDate } from "../../utils/plainDate";

afterEach(() => {
  jest.useRealTimers();
  setServerTimeOffset(0);
});

describe("calendar range helpers", () => {
  const lateSeptember = new Date(2026, 8, 29, 12);

  it.each([
    ["thisMonth", { start: "2026-09-01", end: "2026-09-30" }],
    ["nextMonth", { start: "2026-10-01", end: "2026-10-31" }],
    ["thisQuarter", { start: "2026-07-01", end: "2026-09-30" }],
    ["nextQuarter", { start: "2026-10-01", end: "2026-12-31" }],
  ] as const)("resolves %s", (preset, expected) => {
    expect(resolveRangePreset(preset, lateSeptember)).toEqual(expected);
  });

  it("returns the calendar month containing an arbitrary target date", () => {
    expect(calendarMonthRange(new Date(2026, 10, 29, 12))).toEqual({
      start: "2026-11-01",
      end: "2026-11-30",
    });
  });

  it("uses the server-aligned instant across a local midnight and year boundary", () => {
    const deviceTime = new Date(2026, 11, 31, 23, 30);
    jest.useFakeTimers().setSystemTime(deviceTime);
    setServerTimeOffset(2 * 60 * 60 * 1000);

    expect(formatPlainDate(new Date())).toBe("2026-12-31");
    expect(resolveRangePreset("thisMonth")).toEqual({
      start: "2027-01-01",
      end: "2027-01-31",
    });
    expect(resolveRangePreset("thisQuarter")).toEqual({
      start: "2027-01-01",
      end: "2027-03-31",
    });
    expect(resolveRangeSelection({}).range).toEqual({
      start: "2027-01-01",
      end: "2027-01-31",
    });
    expect(calendarMonthRange(serverDate())).toEqual({
      start: "2027-01-01",
      end: "2027-01-31",
    });
  });

  it("formats and shifts complete calendar periods", () => {
    expect(formatResolvedDateRange({ start: "2026-10-01", end: "2026-10-31" })).toBe(
      "Oct 1, 2026 – Oct 31, 2026",
    );
    expect(shiftRange("upcoming", { start: "2026-12-01", end: "2026-12-31" }, 1)).toEqual({
      start: "2027-01-01",
      end: "2027-01-31",
    });
    expect(shiftRange("custom", { start: "2026-09-29", end: "2026-10-03" }, -1)).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
    });
    expect(shiftRange("custom", { start: "2026-07-01", end: "2026-09-30" }, 1)).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
    });
  });
});

describe("transient range selection", () => {
  beforeEach(() => localStorage.clear());

  it("ignores old stored values and returns to Upcoming after unmount/remount", async () => {
    const user = userEvent.setup();
    const legacyKey = "worshipSync:teamsRange:services:church-a";
    localStorage.setItem(legacyKey, JSON.stringify({ preset: "thisQuarter" }));
    const upcomingRange = { start: "2026-12-01", end: "2026-12-31" };
    const Harness = () => {
      const selection = useRangeSelection({ resolveUpcomingRange: () => upcomingRange });
      return createElement(
        "div",
        null,
        createElement("output", null, `${selection.preset}:${selection.range.start}`),
        createElement("button", {
          type: "button",
          onClick: () => selection.selectPreset("thisQuarter"),
        }, "This quarter"),
      );
    };

    const view = render(createElement(Harness));
    expect(screen.getByText("upcoming:2026-12-01")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "This quarter" }));
    expect(screen.getByText(/thisQuarter:/)).toBeInTheDocument();
    view.unmount();

    render(createElement(Harness));
    expect(screen.getByText("upcoming:2026-12-01")).toBeInTheDocument();
    expect(localStorage.getItem(legacyKey)).toContain("thisQuarter");
    cleanup();
  });

  it("recalculates Upcoming and marks an arrow-shifted range as Custom", async () => {
    const user = userEvent.setup();
    const Harness = () => {
      const selection = useRangeSelection({
        resolveUpcomingRange: () => ({ start: "2026-12-01", end: "2026-12-31" }),
      });
      return createElement(
        "div",
        null,
        createElement("output", null, `${selection.preset}:${selection.range.start}`),
        createElement("button", {
          type: "button",
          onClick: () => selection.setSelection("custom", shiftRange(
            selection.preset,
            selection.range,
            -1,
          )),
        }, "Previous"),
        createElement("button", {
          type: "button",
          onClick: () => selection.selectPreset("upcoming"),
        }, "Upcoming"),
      );
    };

    render(createElement(Harness));
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("custom:2026-11-01")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Upcoming" }));
    expect(screen.getByText("upcoming:2026-12-01")).toBeInTheDocument();
  });
});
