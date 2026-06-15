import {
  buildDateFromParts,
  daysInMonth,
  formatSegmentedDateDisplay,
  getDateSegmentFromPos,
} from "./segmentedDateInput";

describe("segmentedDateInput", () => {
  describe("getDateSegmentFromPos", () => {
    it("maps caret positions to month, day, and year segments", () => {
      expect(getDateSegmentFromPos(0)).toBe("month");
      expect(getDateSegmentFromPos(1)).toBe("month");
      expect(getDateSegmentFromPos(3)).toBe("day");
      expect(getDateSegmentFromPos(6)).toBe("year");
      expect(getDateSegmentFromPos(9)).toBe("year");
    });
  });

  describe("formatSegmentedDateDisplay", () => {
    it("renders placeholders for empty parts", () => {
      expect(formatSegmentedDateDisplay({ month: "", day: "", year: "" })).toBe(
        "mm/dd/yyyy",
      );
    });

    it("renders padded values and in-progress year entry", () => {
      expect(
        formatSegmentedDateDisplay({ month: "6", day: "14", year: "2026" }),
      ).toBe("06/14/2026");
      expect(
        formatSegmentedDateDisplay({
          month: "6",
          day: "14",
          year: "",
          yearEntry: "20",
        }),
      ).toBe("06/14/20yy");
    });
  });

  describe("buildDateFromParts", () => {
    it("returns a valid local date for complete segments", () => {
      const date = buildDateFromParts("06", "14", "2026");
      expect(date?.getFullYear()).toBe(2026);
      expect(date?.getMonth()).toBe(5);
      expect(date?.getDate()).toBe(14);
    });

    it("rejects invalid calendar dates", () => {
      expect(buildDateFromParts("02", "30", "2026")).toBeUndefined();
      expect(buildDateFromParts("06", "14", "20")).toBeUndefined();
    });
  });

  describe("daysInMonth", () => {
    it("returns the correct length for February in a leap year", () => {
      expect(daysInMonth(2, 2024)).toBe(29);
      expect(daysInMonth(2, 2025)).toBe(28);
    });
  });
});
