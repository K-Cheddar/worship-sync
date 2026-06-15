import { formatDateTimeDisplay } from "./dateTimeValue";

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
});
