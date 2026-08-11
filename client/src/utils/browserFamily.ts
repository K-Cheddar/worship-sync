/**
 * Browser family from the user agent. Order matters: Chromium forks and
 * iOS browsers embed "Safari/" / "Chrome/" tokens that would otherwise
 * mislabel CriOS, FxiOS, EdgiOS, and Samsung Internet.
 */

export type BrowserFamily =
  | "chrome"
  | "safari"
  | "firefox"
  | "edge"
  | "samsung"
  | "opera"
  | "other";

const BROWSER_DISPLAY_LABEL: Record<BrowserFamily, string> = {
  chrome: "Chrome",
  safari: "Safari",
  firefox: "Firefox",
  edge: "Edge",
  samsung: "Samsung Internet",
  opera: "Opera",
  other: "",
};

export const getBrowserFamily = (userAgent?: string): BrowserFamily => {
  const ua =
    userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");

  if (/edg(?:e|a|ios)?\//i.test(ua)) return "edge";
  if (/opr\//i.test(ua) || /opera/i.test(ua)) return "opera";
  if (/fxios\//i.test(ua) || /firefox\//i.test(ua)) return "firefox";
  if (/samsungbrowser\//i.test(ua)) return "samsung";
  if (/crios\//i.test(ua) || /chrome\//i.test(ua)) return "chrome";
  if (/safari\//i.test(ua)) return "safari";
  return "other";
};

/** Human label for trusted-device strings; empty when the family is unknown. */
export const getBrowserDisplayLabel = (
  family: BrowserFamily = getBrowserFamily(),
): string => BROWSER_DISPLAY_LABEL[family];
