import { resolveCountdownPartial } from "./utils";

describe("resolveCountdownPartial", () => {
  it("returns null when no hour is set", () => {
    expect(resolveCountdownPartial("", "", "")).toBeNull();
    expect(resolveCountdownPartial("", "30", "")).toBeNull();
  });

  it("returns null when hour, minute, and meridiem are already set", () => {
    expect(resolveCountdownPartial("9", "30", "PM")).toBeNull();
  });

  it("defaults missing minute and meridiem when hour is set", () => {
    expect(resolveCountdownPartial("9", "", "")).toEqual({
      hour: "9",
      minute: "00",
      meridiem: "AM",
    });
  });

  it("defaults missing meridiem when hour and minute are set", () => {
    expect(resolveCountdownPartial("9", "30", "")).toEqual({
      hour: "9",
      minute: "30",
      meridiem: "AM",
    });
  });

  it("defaults missing minute when hour and meridiem are set", () => {
    expect(resolveCountdownPartial("9", "", "PM")).toEqual({
      hour: "9",
      minute: "00",
      meridiem: "PM",
    });
  });
});
