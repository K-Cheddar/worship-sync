import {
  earliestDayKey,
  formatChatDayLabel,
  shiftDayKey,
  shiftWeekKey,
  weekStartKey,
} from "./chatDayUtils";

describe("chatDayUtils", () => {
  it("shifts day keys across month boundaries", () => {
    expect(shiftDayKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDayKey("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("shifts week keys by whole weeks", () => {
    expect(shiftWeekKey("2026-03-08", -1)).toBe("2026-03-01");
    expect(shiftWeekKey("2026-03-08", 1)).toBe("2026-03-15");
  });

  it("snaps any date to the Sunday starting its week", () => {
    expect(weekStartKey("2026-03-11")).toBe("2026-03-08");
    expect(weekStartKey("2026-03-08")).toBe("2026-03-08");
  });

  it("computes the earliest retained day", () => {
    expect(earliestDayKey("2026-03-11", 10)).toBe("2026-03-01");
  });

  it("labels this week and last week clearly", () => {
    expect(formatChatDayLabel("2026-03-08", "2026-03-08", "UTC")).toBe(
      "This week",
    );
    expect(formatChatDayLabel("2026-03-01", "2026-03-08", "UTC")).toBe(
      "Last week",
    );
    expect(formatChatDayLabel("2026-02-15", "2026-03-08", "UTC")).toBe(
      "Feb 15–21",
    );
  });
});
