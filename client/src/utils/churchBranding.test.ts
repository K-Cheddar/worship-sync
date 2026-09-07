import type { ChurchBranding } from "../api/authTypes";
import {
  resolveChurchToolbarLogoUrl,
  resolveChurchToolbarLogoUrls,
} from "./churchBranding";

const brandingWith = (logos: ChurchBranding["logos"]): ChurchBranding => ({
  mission: "",
  vision: "",
  logos,
  colors: [],
});

describe("resolveChurchToolbarLogoUrls", () => {
  it("returns null when no logos are set", () => {
    expect(resolveChurchToolbarLogoUrls(null)).toBeNull();
    expect(
      resolveChurchToolbarLogoUrls(brandingWith({ square: null, wide: null })),
    ).toBeNull();
  });

  it("prefers square for compact and wide for expanded when both exist", () => {
    expect(
      resolveChurchToolbarLogoUrls(
        brandingWith({
          square: { url: "https://cdn.example/square.png", publicId: "square" },
          wide: { url: "https://cdn.example/wide.png", publicId: "wide" },
        }),
      ),
    ).toEqual({
      compact: "https://cdn.example/square.png",
      expanded: "https://cdn.example/wide.png",
    });
  });

  it("falls back to the available logo for both slots", () => {
    expect(
      resolveChurchToolbarLogoUrls(
        brandingWith({
          square: { url: "https://cdn.example/square.png", publicId: "square" },
          wide: null,
        }),
      ),
    ).toEqual({
      compact: "https://cdn.example/square.png",
      expanded: "https://cdn.example/square.png",
    });

    expect(
      resolveChurchToolbarLogoUrls(
        brandingWith({
          square: null,
          wide: { url: "https://cdn.example/wide.png", publicId: "wide" },
        }),
      ),
    ).toEqual({
      compact: "https://cdn.example/wide.png",
      expanded: "https://cdn.example/wide.png",
    });
  });
});

describe("resolveChurchToolbarLogoUrl", () => {
  it("returns the compact (square-preferring) url", () => {
    expect(
      resolveChurchToolbarLogoUrl(
        brandingWith({
          square: { url: "https://cdn.example/square.png", publicId: "square" },
          wide: { url: "https://cdn.example/wide.png", publicId: "wide" },
        }),
      ),
    ).toBe("https://cdn.example/square.png");
  });
});
