import { getBrowserDisplayLabel, getBrowserFamily } from "./browserFamily";
import { getPwaInstallGuidance } from "./pwaInstallGuidance";

const IPHONE_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1";
const IPHONE_FIREFOX_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/123.0 Mobile/15E148 Safari/605.1.15";
const IPHONE_EDGE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/123.0.2420.65 Mobile/15E148 Safari/604.1";
const IPAD_OS_SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const ANDROID_CHROME_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36";
const ANDROID_FIREFOX_UA =
  "Mozilla/5.0 (Android 14; Mobile; rv:123.0) Gecko/123.0 Firefox/123.0";
const ANDROID_SAMSUNG_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/192.168.0.4 Mobile Safari/537.36";
const ANDROID_EDGE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36 EdgA/123.0.2420.65";

const guidanceText = (
  guidance: ReturnType<typeof getPwaInstallGuidance>,
): string => guidance.segments.map((segment) => segment.value).join("");

describe("getBrowserFamily", () => {
  it("detects Safari, including iPadOS desktop-style Safari UAs", () => {
    expect(getBrowserFamily(IPHONE_SAFARI_UA)).toBe("safari");
    expect(getBrowserFamily(IPAD_OS_SAFARI_UA)).toBe("safari");
  });

  it("detects iOS Chrome/Firefox/Edge via CriOS/FxiOS/EdgiOS", () => {
    expect(getBrowserFamily(IPHONE_CHROME_UA)).toBe("chrome");
    expect(getBrowserFamily(IPHONE_FIREFOX_UA)).toBe("firefox");
    expect(getBrowserFamily(IPHONE_EDGE_UA)).toBe("edge");
  });

  it("detects Android Chrome, Firefox, Samsung Internet, and Edge", () => {
    expect(getBrowserFamily(ANDROID_CHROME_UA)).toBe("chrome");
    expect(getBrowserFamily(ANDROID_FIREFOX_UA)).toBe("firefox");
    expect(getBrowserFamily(ANDROID_SAMSUNG_UA)).toBe("samsung");
    expect(getBrowserFamily(ANDROID_EDGE_UA)).toBe("edge");
  });

  it("maps families to display labels for trusted-device strings", () => {
    expect(getBrowserDisplayLabel("chrome")).toBe("Chrome");
    expect(getBrowserDisplayLabel("samsung")).toBe("Samsung Internet");
    expect(getBrowserDisplayLabel("other")).toBe("");
  });
});

describe("getPwaInstallGuidance", () => {
  it("gives Safari share steps on iOS Safari", () => {
    const text = guidanceText(
      getPwaInstallGuidance({ os: "ios", browser: "safari" }),
    );
    expect(text).toMatch(/Safari's Share menu/i);
    expect(text).toMatch(/Add to Home Screen/i);
    expect(text).not.toMatch(/only works in Safari/i);
  });

  it("sends iOS Chrome users to Safari for Add to Home Screen", () => {
    const text = guidanceText(
      getPwaInstallGuidance({ os: "ios", browser: "chrome" }),
    );
    expect(text).toMatch(/only works in Safari/i);
    expect(text).toMatch(/Open this site in Safari/i);
    expect(text).toMatch(/Add to Home Screen/i);
  });

  it("uses Chromium menu wording on Android Chrome", () => {
    const text = guidanceText(
      getPwaInstallGuidance({ os: "android", browser: "chrome" }),
    );
    expect(text).toMatch(/Install app/i);
    expect(text).toMatch(/Add to Home screen/i);
  });

  it("uses Install for Android Firefox", () => {
    const text = guidanceText(
      getPwaInstallGuidance({ os: "android", browser: "firefox" }),
    );
    expect(text).toMatch(/choose Install/i);
  });

  it("uses Add page to → Home screen for Samsung Internet", () => {
    const text = guidanceText(
      getPwaInstallGuidance({ os: "android", browser: "samsung" }),
    );
    expect(text).toMatch(/Add page to/i);
    expect(text).toMatch(/Home screen/i);
  });

  it("falls back for unknown combinations", () => {
    const text = guidanceText(
      getPwaInstallGuidance({ os: "unknown", browser: "other" }),
    );
    expect(text).toMatch(/Install app/i);
    expect(text).toMatch(/Add to Home screen/i);
  });
});
