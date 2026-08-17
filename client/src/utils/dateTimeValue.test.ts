import {
  formatDateTimeDisplay,
  formatDateTimeLocal,
  parseDateTimeLocal,
} from "./dateTimeValue";

describe("dateTimeValue", () => {
  describe("parseDateTimeLocal / formatDateTimeLocal", () => {
    it("parses and formats datetime-local values", () => {
      const parts = parseDateTimeLocal("2026-08-12T14:30");
      expect(parts).toEqual(
        expect.objectContaining({
          hour: "2",
          minute: "30",
          meridiem: "PM",
        }),
      );
      expect(
        formatDateTimeLocal(
          parts!.date,
          parts!.hour,
          parts!.minute,
          parts!.meridiem,
        ),
      ).toBe("2026-08-12T14:30");
    });

    it("rejects empty or incomplete values", () => {
      expect(parseDateTimeLocal("")).toBeNull();
      expect(parseDateTimeLocal("2026-08-12")).toBeNull();
      expect(parseDateTimeLocal("T14:30")).toBeNull();
      expect(formatDateTimeLocal(new Date(2026, 0, 1), "", "00", "AM")).toBe(
        "",
      );
    });
  });

  describe("formatDateTimeDisplay", () => {
    it("keeps a fixed-width year segment while typing", () => {
      expect(
        formatDateTimeDisplay({
          month: "06",
          day: "05",
          year: "2026",
          hour: "10",
          minute: "00",
          meridiem: "AM",
          yearEntry: "2",
        }),
      ).toBe("06/05/2yyy 10:00 AM");
    });

    it("shows committed parts from state", () => {
      expect(
        formatDateTimeDisplay({
          month: "06",
          day: "05",
          year: "2027",
          hour: "10",
          minute: "00",
          meridiem: "AM",
        }),
      ).toBe("06/05/2027 10:00 AM");
    });

    it("uses placeholders for empty segments and incomplete years", () => {
      expect(
        formatDateTimeDisplay({
          month: "",
          day: "",
          year: "20",
          hour: "",
          minute: "",
          meridiem: "" as never,
        }),
      ).toBe("mm/dd/yyyy hh:mm aa");
    });
  });
});
