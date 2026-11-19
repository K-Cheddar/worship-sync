import { buildLocalAssetCorsHeaders } from "./localAssetCors";

describe("buildLocalAssetCorsHeaders", () => {
  it("allows the development renderer to read local asset frames", () => {
    expect(
      buildLocalAssetCorsHeaders("https://local.worshipsync.net:3000", false),
    ).toMatchObject({
      "Access-Control-Allow-Origin": "https://local.worshipsync.net:3000",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
      "Access-Control-Expose-Headers":
        "Accept-Ranges, Content-Range, Content-Length",
    });
  });

  it("allows the packaged file renderer's opaque origin", () => {
    expect(buildLocalAssetCorsHeaders("null", true)).toMatchObject({
      "Access-Control-Allow-Origin": "null",
    });
  });

  it("does not grant local asset CORS access to unrelated origins", () => {
    expect(
      buildLocalAssetCorsHeaders("https://attacker.example", false),
    ).toEqual({});
    expect(
      buildLocalAssetCorsHeaders("https://local.worshipsync.net:3000", true),
    ).toEqual({});
    expect(buildLocalAssetCorsHeaders(null, false)).toEqual({});
  });
});
