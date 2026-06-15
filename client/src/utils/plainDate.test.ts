import { formatDateInputValue } from "./plainDate";

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
