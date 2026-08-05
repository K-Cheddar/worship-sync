import { clampPlainDateToMin, formatDateInputValue } from "./plainDate";

describe("clampPlainDateToMin", () => {
  it("bumps a date earlier than min up to min", () => {
    expect(clampPlainDateToMin("2026-07-31", "2026-08-01")).toBe("2026-08-01");
  });

  it("leaves dates on or after min unchanged", () => {
    expect(clampPlainDateToMin("2026-08-01", "2026-08-01")).toBe("2026-08-01");
    expect(clampPlainDateToMin("2026-08-15", "2026-08-01")).toBe("2026-08-15");
  });

  it("returns the original value when either side is blank", () => {
    expect(clampPlainDateToMin("", "2026-08-01")).toBe("");
    expect(clampPlainDateToMin("2026-07-31", "")).toBe("2026-07-31");
  });
});

describe("formatDateInputValue", () => {
  it("adds slashes after month and day segments", () => {
    expect(formatDateInputValue("1")).toBe("1");
    expect(formatDateInputValue("12")).toBe("12/");
    expect(formatDateInputValue("123")).toBe("12/3");
    expect(formatDateInputValue("1225")).toBe("12/25/");
    expect(formatDateInputValue("12252026")).toBe("12/25/2026");
  });

  it("normalizes digits that already include slashes", () => {
    expect(formatDateInputValue("12/25/2026")).toBe("12/25/2026");
  });

  it("caps input at eight digits", () => {
    expect(formatDateInputValue("122520261999")).toBe("12/25/2026");
  });

  it("leaves ISO and month-name formats untouched", () => {
    expect(formatDateInputValue("2026-06-14")).toBe("2026-06-14");
    expect(formatDateInputValue("Jun 14, 2026")).toBe("Jun 14, 2026");
  });
});
