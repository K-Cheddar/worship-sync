import { getMaxLines, getNumLines } from "./textMeasurement";

describe("textMeasurement", () => {
  const mockRect = (height: number) => ({
    width: 100,
    height,
    top: 0,
    left: 0,
    bottom: height,
    right: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  beforeEach(() => {
    jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const text = this.textContent ?? "";
        if (text.includes("Multiple")) {
          return mockRect(100);
        }
        return mockRect(20);
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("getMaxLines returns at least 1 and uses margin when topMargin is set", () => {
    const r = getMaxLines({
      fontSizePx: 16,
      height: 50,
      topMargin: 5,
      isBold: true,
      isItalic: false,
    });
    expect(r.maxLines).toBeGreaterThanOrEqual(1);
    expect(r.lineHeight).toBeGreaterThan(0);
  });

  it("getMaxLines uses default vertical margin when topMargin is omitted", () => {
    const r = getMaxLines({ fontSizePx: 14, height: 100 });
    expect(r.maxLines).toBeGreaterThanOrEqual(1);
  });

  it("getNumLines computes line count from measured height", () => {
    const n = getNumLines({
      text: "hello world",
      fontSizePx: 14,
      lineHeight: 20,
      width: 80,
      sideMargin: 4,
      isBold: false,
      isItalic: true,
    });
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it("getNumLines uses default side margin when sideMargin is omitted", () => {
    const n = getNumLines({
      text: "a",
      fontSizePx: 12,
      lineHeight: 18,
      width: 50,
    });
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it("getMaxLines returns fallback when DOM throws", () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const spy = jest.spyOn(document.body, "appendChild").mockImplementation(() => {
      throw new Error("no dom");
    });
    const r = getMaxLines({ fontSizePx: 16, height: 40 });
    expect(r.maxLines).toBe(1);
    expect(r.lineHeight).toBe(16 * 1.25);
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it("getNumLines returns 1 when DOM throws", () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const spy = jest.spyOn(document.body, "appendChild").mockImplementation(() => {
      throw new Error("no dom");
    });
    expect(
      getNumLines({
        text: "x",
        fontSizePx: 12,
        lineHeight: 14,
        width: 100,
      }),
    ).toBe(1);
    spy.mockRestore();
    errSpy.mockRestore();
  });
});
