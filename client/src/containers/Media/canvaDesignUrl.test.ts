import { parseCanvaDesignId } from "./canvaDesignUrl";

describe("parseCanvaDesignId", () => {
  it("accepts a raw design id", () => {
    expect(parseCanvaDesignId("DAFZr1z5464")).toBe("DAFZr1z5464");
  });

  it("parses www.canva.com design links", () => {
    expect(
      parseCanvaDesignId(
        "https://www.canva.com/design/DAFZr1z5464/view?utm_content=DAFZr1z5464",
      ),
    ).toBe("DAFZr1z5464");
    expect(
      parseCanvaDesignId("https://www.canva.com/design/DAF_abc-123/edit"),
    ).toBe("DAF_abc-123");
  });

  it("rejects non-Canva hosts and empty input", () => {
    expect(parseCanvaDesignId("")).toBeNull();
    expect(
      parseCanvaDesignId("https://example.com/design/DAFZr1z5464/view"),
    ).toBeNull();
    expect(parseCanvaDesignId("not a link")).toBeNull();
  });
});
