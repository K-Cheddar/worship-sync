/**
 * Platform surface + OS detection.
 *
 * `environment.ts` answers "which OS/browser is this, and where is the API?".
 * This module adds the mobile axis it lacks (iOS/Android, installed vs tab) and
 * names the shell hosting the renderer.
 *
 * Adding a native mobile shell (Capacitor) later means {@link getAppSurface}
 * starts reporting `"capacitor"`; {@link isCapacitorNative} is the single seam
 * that has to light up.
 */

import {
  isElectron,
  isLinuxBrowser,
  isMacBrowser,
  isWindowsBrowser,
} from "./environment";

/** The shell hosting the renderer. `pwa` is the web app installed to a home screen / dock. */
export type AppSurface = "electron" | "capacitor" | "pwa" | "browser";

export type AppOs = "windows" | "mac" | "linux" | "ios" | "android" | "unknown";

const hasWindow = (): boolean => typeof window !== "undefined";

const userAgent = (): string =>
  typeof navigator === "undefined" ? "" : navigator.userAgent;

/**
 * iPadOS 13+ reports a desktop "Macintosh" user agent, so the UA test alone
 * misidentifies iPads as Macs. Touch points disambiguate: no Mac reports more
 * than one.
 */
export const isIosBrowser = (): boolean => {
  if (!hasWindow() || typeof navigator === "undefined") return false;
  const ua = userAgent();
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
};

export const isAndroidBrowser = (): boolean => /android/i.test(userAgent());

export const isMobileBrowser = (): boolean => {
  if (typeof navigator === "undefined") return false;
  return (
    isIosBrowser() ||
    isAndroidBrowser() ||
    /iphone|ipad|ipod|mobile/i.test(userAgent())
  );
};

/**
 * True when the page is running from an installed app icon rather than a
 * browser tab. `navigator.standalone` is the iOS Safari equivalent of the
 * `display-mode: standalone` media query.
 */
export const isStandaloneDisplayMode = (): boolean => {
  if (!hasWindow()) return false;
  if (
    typeof window.matchMedia === "function" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches)
  ) {
    return true;
  }
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
};

/**
 * True when a Capacitor native shell is hosting the renderer. Always false
 * today; this is the single seam a native mobile build needs to light up.
 */
export const isCapacitorNative = (): boolean => {
  if (!hasWindow()) return false;
  const capacitor = (
    window as Window & {
      Capacitor?: { isNativePlatform?: () => boolean };
    }
  ).Capacitor;
  return capacitor?.isNativePlatform?.() === true;
};

export const getAppSurface = (): AppSurface => {
  if (isElectron()) return "electron";
  if (isCapacitorNative()) return "capacitor";
  if (isStandaloneDisplayMode()) return "pwa";
  return "browser";
};

/** Checked before `mac` so iPadOS's "Macintosh" user agent resolves to `ios`. */
export const getAppOs = (): AppOs => {
  if (isIosBrowser()) return "ios";
  if (isAndroidBrowser()) return "android";
  if (isWindowsBrowser()) return "windows";
  if (isMacBrowser()) return "mac";
  if (isLinuxBrowser()) return "linux";
  return "unknown";
};
