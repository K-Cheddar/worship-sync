import { type BrowserFamily, getBrowserFamily } from "./browserFamily";
import { type AppOs, getAppOs } from "./platform";

export type PwaInstallGuidanceSegment =
  | { type: "text"; value: string }
  | { type: "emphasis"; value: string };

export type PwaInstallGuidance = {
  title: string;
  segments: PwaInstallGuidanceSegment[];
};

type GuidanceInput = {
  os?: AppOs;
  browser?: BrowserFamily;
};

const seg = (
  type: PwaInstallGuidanceSegment["type"],
  value: string,
): PwaInstallGuidanceSegment => ({ type, value });

const guidance = (
  segments: PwaInstallGuidanceSegment[],
): PwaInstallGuidance => ({
  title: "Install WorshipSync",
  segments,
});

const iosSafariGuidance = (): PwaInstallGuidance =>
  guidance([
    seg("text", "On iPhone and iPad, open Safari's Share menu, then choose "),
    seg("emphasis", "Add to Home Screen"),
    seg("text", "."),
  ]);

const iosOtherBrowserGuidance = (): PwaInstallGuidance =>
  guidance([
    seg(
      "text",
      "Add to Home Screen only works in Safari. Open this site in Safari, tap Share, then choose ",
    ),
    seg("emphasis", "Add to Home Screen"),
    seg("text", "."),
  ]);

const androidChromeFamilyGuidance = (): PwaInstallGuidance =>
  guidance([
    seg("text", "Open your browser menu ("),
    seg("emphasis", "⋮"),
    seg("text", "), then choose "),
    seg("emphasis", "Install app"),
    seg("text", " or "),
    seg("emphasis", "Add to Home screen"),
    seg("text", "."),
  ]);

const androidFirefoxGuidance = (): PwaInstallGuidance =>
  guidance([
    seg("text", "Open the browser menu, then choose "),
    seg("emphasis", "Install"),
    seg("text", "."),
  ]);

const androidSamsungGuidance = (): PwaInstallGuidance =>
  guidance([
    seg("text", "Open the browser menu, choose "),
    seg("emphasis", "Add page to"),
    seg("text", ", then "),
    seg("emphasis", "Home screen"),
    seg("text", "."),
  ]);

const fallbackGuidance = (): PwaInstallGuidance =>
  guidance([
    seg("text", "Open your browser menu and choose "),
    seg("emphasis", "Install app"),
    seg("text", " or "),
    seg("emphasis", "Add to Home screen"),
    seg("text", "."),
  ]);

/**
 * Manual install steps when `beforeinstallprompt` is unavailable.
 * Prefer OS + browser-specific wording over a generic fallback.
 */
export const getPwaInstallGuidance = (
  input: GuidanceInput = {},
): PwaInstallGuidance => {
  const os = input.os ?? getAppOs();
  const browser = input.browser ?? getBrowserFamily();

  if (os === "ios") {
    return browser === "safari"
      ? iosSafariGuidance()
      : iosOtherBrowserGuidance();
  }

  if (os === "android") {
    if (browser === "firefox") return androidFirefoxGuidance();
    if (browser === "samsung") return androidSamsungGuidance();
    if (browser === "chrome" || browser === "edge" || browser === "opera") {
      return androidChromeFamilyGuidance();
    }
  }

  return fallbackGuidance();
};
