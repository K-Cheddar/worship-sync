import {
  formatMultiWeekly,
  parseDateOnlyAsLocalDate,
} from "./utils";

describe("ServiceTimes utils", () => {
  describe("parseDateOnlyAsLocalDate", () => {
    it("parses YYYY-MM-DD values as local calendar dates", () => {
      const parsed = parseDateOnlyAsLocalDate("2026-05-30");

      expect(parsed).not.toBeNull();
      expect(parsed?.getFullYear()).toBe(2026);
      expect(parsed?.getMonth()).toBe(4);
      expect(parsed?.getDate()).toBe(30);
      expect(parsed?.getHours()).toBe(0);
      expect(parsed?.getMinutes()).toBe(0);
    });

    it("returns null for invalid date-only strings", () => {
      expect(parseDateOnlyAsLocalDate("bad-date")).toBeNull();
      expect(parseDateOnlyAsLocalDate(undefined)).toBeNull();
    });
  });

  describe("formatMultiWeekly", () => {
    it("formats grouped weekly days and preserves the end date label", () => {
      const expectedEndDate = parseDateOnlyAsLocalDate(
        "2026-05-30",
      )?.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      expect(
        formatMultiWeekly(
          [
            { day: 1, time: "09:00" },
            { day: 3, time: "09:00" },
            { day: 5, time: "10:30" },
          ],
          "2026-05-30",
        ),
      ).toBe(`Mon, Wed @ 9:00 AM, Fri @ 10:30 AM until ${expectedEndDate}`);
    });
  });
});
