import { getVerses } from "./getVerses";

describe("getVerses", () => {
  // `getVerses` uses querySelector("div .passage-text") — a .passage-text nested inside a div.
  // addVerse splits on U+00A0 (NBSP); use HTML entity so jsdom preserves it in innerText.
  const passageHtml = `
    <html><body>
      <div>
        <div class="passage-text">
          <span class="text Gen-1-1">1&#160;In the beginning</span>
          <span class="text Gen-1-2">2&#160;Second verse here</span>
        </div>
      </div>
    </body></html>
  `;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("fetches and parses verse HTML", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      text: async () => passageHtml,
    });

    const result = await getVerses({
      book: "Genesis",
      chapter: 0,
      version: "ESV",
    });

    expect(global.fetch).toHaveBeenCalled();
    expect(result?.verses?.length).toBeGreaterThan(0);
    expect(result?.verses?.[0]?.text).toBeDefined();
  });

  it("returns empty verses when passage has no matching spans", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      text: async () =>
        "<html><body><div><div class='passage-text'><p>no spans</p></div></div></body></html>",
    });

    const result = await getVerses({
      book: "Genesis",
      chapter: 0,
      version: "ESV",
    });

    expect(result?.verses).toEqual([]);
  });

  it("returns null when fetch throws", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    (global.fetch as jest.Mock).mockRejectedValue(new Error("network"));

    const result = await getVerses({
      book: "Genesis",
      chapter: 0,
      version: "ESV",
    });

    expect(result).toBeNull();
    errSpy.mockRestore();
  });
});
