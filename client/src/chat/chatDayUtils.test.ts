import {
  earliestDayKey,
  formatChatDayLabel,
  shiftDayKey,
} from "./chatDayUtils";

describe("chatDayUtils", () => {
  it("shifts day keys across month boundaries", () => {
    expect(shiftDayKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDayKey("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("computes the earliest retained day", () => {
    expect(earliestDayKey("2026-03-11", 10)).toBe("2026-03-01");
  });

  it("labels today and yesterday clearly", () => {
    expect(formatChatDayLabel("2026-03-11", "2026-03-11", "UTC")).toBe("Today");
    expect(formatChatDayLabel("2026-03-10", "2026-03-11", "UTC")).toBe(
      "Yesterday",
    );
    expect(formatChatDayLabel("2026-03-01", "2026-03-11", "UTC")).toMatch(
      /Mar/,
    );
  });
});
