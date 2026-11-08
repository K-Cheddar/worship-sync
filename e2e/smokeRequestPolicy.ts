import { allowedE2EAuthOrigins } from "./authOrigins";

export function isAllowedSmokeChurchRead(
  method: string,
  rawUrl: string,
  baseURL: string,
  churchId: string,
): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!allowedE2EAuthOrigins(baseURL).has(url.origin)) return false;
  const match = url.pathname.match(/\/api\/churches\/([^/]+)(?:\/|$)/);
  if (!match) return false;
  try {
    if (decodeURIComponent(match[1]) !== churchId) return false;
  } catch {
    return false;
  }
  return ["GET", "HEAD", "OPTIONS"].includes(method);
}
