import { isElectron } from "./environment";

const normalizePlatform = (platform: string, userAgent: string) => {
  if (/android/i.test(userAgent)) return "Android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "iPhone";
  if (/mac/i.test(platform) || /mac os/i.test(userAgent)) return "macOS";
  if (/win/i.test(platform) || /windows/i.test(userAgent)) return "Windows";
  if (/linux/i.test(platform) || /linux/i.test(userAgent)) return "Linux";
  return "This device";
};

const detectBrowser = (userAgent: string) => {
  if (/edg\//i.test(userAgent)) return "Edge";
  if (/opr\//i.test(userAgent) || /opera/i.test(userAgent)) return "Opera";
  if (/firefox\//i.test(userAgent)) return "Firefox";
  if (/chrome\//i.test(userAgent)) return "Chrome";
  if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)) {
    return "Safari";
  }
  return "";
};

export const getTrustedDeviceLabel = () => {
  if (typeof navigator === "undefined") {
    return "Trusted device";
  }
  const platform = normalizePlatform(navigator.platform, navigator.userAgent);
  if (isElectron()) {
    return `Electron on ${platform}`;
  }
  const browser = detectBrowser(navigator.userAgent);
  return browser ? `${browser} on ${platform}` : `${platform} device`;
};

export const getPlatformDisplayLabel = (platformType?: string | null) => {
  const value = String(platformType || "").trim();
  if (!value) return "Unknown platform";
  if (/^win/i.test(value)) return "Windows";
  if (/^mac/i.test(value)) return "macOS";
  if (/linux/i.test(value)) return "Linux";
  if (/iphone|ipad|ipod/i.test(value)) return "iPhone";
  if (/android/i.test(value)) return "Android";
  return value;
};
