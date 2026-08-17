import { getPlatformDisplayLabel, getTrustedDeviceLabel } from "./deviceInfo";
import { isElectron } from "./environment";
import { getBrowserDisplayLabel } from "./browserFamily";

jest.mock("./environment", () => ({
  isElectron: jest.fn(() => false),
}));

jest.mock("./browserFamily", () => ({
  getBrowserFamily: jest.fn(() => "chrome"),
  getBrowserDisplayLabel: jest.fn((family: string) =>
    family === "chrome" ? "Chrome" : "",
  ),
}));

const mockIsElectron = jest.mocked(isElectron);
const mockGetBrowserDisplayLabel = jest.mocked(getBrowserDisplayLabel);

describe("deviceInfo", () => {
  const originalNavigator = global.navigator;

  afterEach(() => {
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
    mockIsElectron.mockReturnValue(false);
    jest.clearAllMocks();
  });

  const setNavigator = (platform: string, userAgent: string) => {
    Object.defineProperty(global, "navigator", {
      value: { platform, userAgent },
      configurable: true,
    });
  };

  describe("getTrustedDeviceLabel", () => {
    it("returns Electron label when running in Electron", () => {
      mockIsElectron.mockReturnValue(true);
      setNavigator("Win32", "Mozilla/5.0 (Windows NT 10.0)");
      expect(getTrustedDeviceLabel()).toBe("Electron on Windows");
    });

    it("returns browser + platform for Chrome on macOS", () => {
      setNavigator("MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X)");
      expect(getTrustedDeviceLabel()).toBe("Chrome on macOS");
    });

    it("detects Android, iPhone, and Linux from the user agent", () => {
      setNavigator("", "Mozilla/5.0 (Linux; Android 14)");
      expect(getTrustedDeviceLabel()).toBe("Chrome on Android");

      setNavigator(
        "",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      );
      expect(getTrustedDeviceLabel()).toBe("Chrome on iPhone");

      setNavigator("Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)");
      expect(getTrustedDeviceLabel()).toBe("Chrome on Linux");
    });

    it("falls back when platform and browser are unknown", () => {
      mockGetBrowserDisplayLabel.mockReturnValueOnce("");
      setNavigator("FreeBSD", "CustomAgent/1.0");
      expect(getTrustedDeviceLabel()).toBe("This device device");
    });
  });

  describe("getPlatformDisplayLabel", () => {
    it("maps known platform tokens and unknown values", () => {
      expect(getPlatformDisplayLabel(null)).toBe("Unknown platform");
      expect(getPlatformDisplayLabel("")).toBe("Unknown platform");
      expect(getPlatformDisplayLabel("win32")).toBe("Windows");
      expect(getPlatformDisplayLabel("macOS")).toBe("macOS");
      expect(getPlatformDisplayLabel("linux")).toBe("Linux");
      expect(getPlatformDisplayLabel("iPhone")).toBe("iPhone");
      expect(getPlatformDisplayLabel("android")).toBe("Android");
      expect(getPlatformDisplayLabel("FreeBSD")).toBe("FreeBSD");
    });
  });
});
