import { isElectron, isMacBrowser, isWindowsBrowser } from "./environment";
import {
  getAppOs,
  getAppSurface,
  isAndroidBrowser,
  isIosBrowser,
  isMobileBrowser,
  isStandaloneDisplayMode,
} from "./platform";

// The global `utils/environment` mapper only matches `.../utils/environment`
// imports; `platform.ts` imports its sibling as `./environment`, so mock it
// here. `jest.mock` is hoisted above the imports above.
jest.mock("./environment", () => ({
  isElectron: jest.fn(() => false),
  isWindowsBrowser: jest.fn(() => false),
  isMacBrowser: jest.fn(() => false),
  isLinuxBrowser: jest.fn(() => false),
}));

const mockIsElectron = jest.mocked(isElectron);
const mockIsWindowsBrowser = jest.mocked(isWindowsBrowser);
const mockIsMacBrowser = jest.mocked(isMacBrowser);

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const IPAD_OS_15_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/15.0 Safari/605.1.15";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile";

const setUserAgent = (ua: string, maxTouchPoints = 0) => {
  Object.defineProperty(window.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    value: maxTouchPoints,
    configurable: true,
  });
};

/** jsdom has no matchMedia; `displayMode` null means "browser tab". */
const setDisplayMode = (displayMode: string | null) => {
  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => ({
      matches: displayMode !== null && query.includes(displayMode),
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }),
    configurable: true,
  });
};

describe("platform", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsElectron.mockReturnValue(false);
    mockIsWindowsBrowser.mockReturnValue(false);
    mockIsMacBrowser.mockReturnValue(false);
    setUserAgent(MAC_UA);
    setDisplayMode(null);
    Object.defineProperty(window.navigator, "standalone", {
      value: undefined,
      configurable: true,
    });
    delete (window as { Capacitor?: unknown }).Capacitor;
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  describe("os detection", () => {
    it("identifies an iPhone", () => {
      setUserAgent(IPHONE_UA);
      expect(isIosBrowser()).toBe(true);
      expect(getAppOs()).toBe("ios");
    });

    it("identifies iPadOS 13+ despite its desktop Macintosh user agent", () => {
      setUserAgent(IPAD_OS_15_UA, 5);
      mockIsMacBrowser.mockReturnValue(true);

      expect(isIosBrowser()).toBe(true);
      // Must win over `mac`, or iPad users are shown desktop installer copy.
      expect(getAppOs()).toBe("ios");
    });

    it("does not mistake a real Mac for an iPad", () => {
      setUserAgent(MAC_UA, 0);
      mockIsMacBrowser.mockReturnValue(true);

      expect(isIosBrowser()).toBe(false);
      expect(getAppOs()).toBe("mac");
    });

    it("identifies Android", () => {
      setUserAgent(ANDROID_UA);
      expect(isAndroidBrowser()).toBe(true);
      expect(getAppOs()).toBe("android");
    });

    it("falls back to the desktop OS predicates", () => {
      mockIsWindowsBrowser.mockReturnValue(true);
      expect(getAppOs()).toBe("windows");
    });
  });

  describe("isMobileBrowser", () => {
    it("is true for phones and tablets", () => {
      setUserAgent(IPHONE_UA);
      expect(isMobileBrowser()).toBe(true);

      setUserAgent(ANDROID_UA);
      expect(isMobileBrowser()).toBe(true);

      setUserAgent(IPAD_OS_15_UA, 5);
      expect(isMobileBrowser()).toBe(true);
    });

    it("is false on desktop", () => {
      setUserAgent(MAC_UA, 0);
      expect(isMobileBrowser()).toBe(false);
    });
  });


  describe("getAppSurface", () => {
    it("reports electron first", () => {
      mockIsElectron.mockReturnValue(true);
      setDisplayMode("standalone");
      expect(getAppSurface()).toBe("electron");
    });

    it("reports capacitor when a native shell is present", () => {
      (window as { Capacitor?: unknown }).Capacitor = {
        isNativePlatform: () => true,
      };
      expect(getAppSurface()).toBe("capacitor");
    });

    it("reports pwa when launched from an installed icon", () => {
      setDisplayMode("standalone");
      expect(isStandaloneDisplayMode()).toBe(true);
      expect(getAppSurface()).toBe("pwa");
    });

    it("reports pwa for iOS Safari's navigator.standalone", () => {
      setUserAgent(IPHONE_UA);
      Object.defineProperty(window.navigator, "standalone", {
        value: true,
        configurable: true,
      });
      expect(getAppSurface()).toBe("pwa");
    });

    it("reports browser for a plain tab", () => {
      expect(getAppSurface()).toBe("browser");
    });
  });

});
