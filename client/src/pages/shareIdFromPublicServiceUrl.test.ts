import { shareIdFromPublicServiceUrl } from "./shareIdFromPublicServiceUrl";

describe("shareIdFromPublicServiceUrl", () => {
  it("reads the token from a hash route URL", () => {
    expect(
      shareIdFromPublicServiceUrl(
        "https://www.worshipsync.net/#/services/team-token",
      ),
    ).toBe("team-token");
  });

  it("returns empty for unrelated URLs", () => {
    expect(shareIdFromPublicServiceUrl("https://example.test/other")).toBe("");
    expect(shareIdFromPublicServiceUrl("")).toBe("");
  });
});
