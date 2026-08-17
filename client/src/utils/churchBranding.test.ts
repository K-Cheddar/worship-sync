import {
  compactBrandColorSlots,
  emptyChurchBranding,
  getChurchBrandColorLabel,
  normalizeChurchBranding,
  padBrandColorsToSlots,
  resolveChurchToolbarLogoUrl,
  serializeChurchBranding,
  BRANDING_MAX_COLORS,
} from "./churchBranding";

describe("churchBranding", () => {
  it("pads and compacts brand color slots", () => {
    const padded = padBrandColorsToSlots([
      { value: "#112233" },
      { label: "Accent", value: "#aabbcc" },
    ]);
    expect(padded).toHaveLength(BRANDING_MAX_COLORS);
    expect(padded[0]).toEqual({ value: "#112233" });
    expect(padded[2]).toBeNull();
    expect(compactBrandColorSlots(padded)).toEqual([
      { value: "#112233" },
      { label: "Accent", value: "#aabbcc" },
    ]);
  });

  it("normalizes nested branding payloads and valid Cloudinary logos", () => {
    const branding = normalizeChurchBranding({
      branding: {
        mission: "  Serve  ",
        vision: "  Grow  ",
        logos: {
          square: {
            url: "https://res.cloudinary.com/demo/image/upload/v123/folder/logo.png",
            width: 64,
            height: 64,
            format: "PNG",
          },
          wide: {
            url: "https://res.cloudinary.com/demo/image/upload/folder/wide.jpg",
          },
        },
        colors: [
          { value: "#112233" },
          { label: "Primary", value: "#445566" },
          { label: "primary", value: "#778899" },
          { label: "x".repeat(50), value: "#abcdef" },
          { value: "not-a-color" },
          null,
        ],
      },
    });

    expect(branding.mission).toBe("Serve");
    expect(branding.vision).toBe("Grow");
    expect(branding.logos.square).toEqual(
      expect.objectContaining({
        publicId: "folder/logo",
        width: 64,
        height: 64,
        format: "png",
      }),
    );
    expect(branding.logos.wide?.publicId).toBe("folder/wide");
    expect(branding.colors).toEqual([
      { value: "#112233" },
      { label: "Primary", value: "#445566" },
    ]);
  });

  it("rejects invalid logo hosts, protocols, and malformed URLs", () => {
    const branding = normalizeChurchBranding({
      logos: {
        square: { url: "https://evil.example/upload/v1/x.png" },
        wide: { url: "ftp://res.cloudinary.com/demo/image/upload/v1/x.png" },
      },
      colors: [{ label: "Ok", value: "#112233ff" }],
    });
    expect(branding.logos.square).toBeNull();
    expect(branding.logos.wide).toBeNull();
    expect(branding.colors).toEqual([{ label: "Ok", value: "#112233ff" }]);

    expect(
      normalizeChurchBranding({
        logos: { square: { url: "not a url" } },
      }).logos.square,
    ).toBeNull();

    expect(
      normalizeChurchBranding({
        logos: {
          square: {
            url: "https://res.cloudinary.com/demo/image/fetch/remote.png",
          },
        },
      }).logos.square,
    ).toBeNull();

    expect(
      normalizeChurchBranding({
        logos: {
          square: {
            url: "https://cloudinary.com/image/upload/v12/.png",
          },
        },
      }).logos.square,
    ).toBeNull();

    expect(
      normalizeChurchBranding({
        logos: {
          wide: {
            url: "https://cloudinary.com/image/upload/",
            width: 0,
            height: -1,
            format: " ",
          },
        },
      }).logos.wide,
    ).toBeNull();
  });

  it("returns empty branding helpers and toolbar logo preference", () => {
    expect(emptyChurchBranding()).toEqual({
      mission: "",
      vision: "",
      logos: { square: null, wide: null },
      colors: [],
    });
    expect(getChurchBrandColorLabel({ value: "#111111" }, 2)).toBe("Color 3");
    expect(
      getChurchBrandColorLabel({ label: " Accent ", value: "#111111" }, 0),
    ).toBe("Accent");

    expect(resolveChurchToolbarLogoUrl(null)).toBe("");
    expect(
      resolveChurchToolbarLogoUrl({
        ...emptyChurchBranding(),
        logos: {
          square: null,
          wide: {
            url: " https://res.cloudinary.com/demo/image/upload/v1/wide.png ",
            publicId: "wide",
          },
        },
      }),
    ).toBe("https://res.cloudinary.com/demo/image/upload/v1/wide.png");
    expect(
      resolveChurchToolbarLogoUrl({
        ...emptyChurchBranding(),
        logos: {
          square: {
            url: "https://res.cloudinary.com/demo/image/upload/v1/sq.png",
            publicId: "sq",
          },
          wide: {
            url: "https://res.cloudinary.com/demo/image/upload/v1/wide.png",
            publicId: "wide",
          },
        },
      }),
    ).toBe("https://res.cloudinary.com/demo/image/upload/v1/sq.png");

    const payload = emptyChurchBranding();
    expect(serializeChurchBranding(payload)).toBe(JSON.stringify(payload));
  });
});
