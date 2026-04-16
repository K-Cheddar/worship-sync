import type { DesktopAuthProvider } from "../api/authTypes";

export type DesktopSsoCompleteFlashPayload = {
  provider: DesktopAuthProvider;
  v: 1;
};

export const DESKTOP_SSO_COMPLETE_FLASH_KEY = "ws-desktop-sso-complete-flash";

const DESKTOP_BROKER_COMPLETED_IDS_KEY = "ws-desktop-broker-completed-ids";
const DESKTOP_BROKER_COMPLETED_IDS_MAX = 40;

export function markDesktopBrokerAuthCompleted(desktopAuthId: string): void {
  const trimmed = desktopAuthId.trim();
  if (!trimmed) return;
  try {
    const raw = sessionStorage.getItem(DESKTOP_BROKER_COMPLETED_IDS_KEY);
    let list: string[] = [];
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        list = parsed.filter((id): id is string => typeof id === "string");
      }
    }
    if (!list.includes(trimmed)) {
      list.push(trimmed);
    }
    while (list.length > DESKTOP_BROKER_COMPLETED_IDS_MAX) {
      list.shift();
    }
    sessionStorage.setItem(
      DESKTOP_BROKER_COMPLETED_IDS_KEY,
      JSON.stringify(list),
    );
  } catch {
    // ignore
  }
}

export function isDesktopBrokerAuthCompleted(desktopAuthId: string): boolean {
  const trimmed = desktopAuthId.trim();
  if (!trimmed) return false;
  try {
    const raw = sessionStorage.getItem(DESKTOP_BROKER_COMPLETED_IDS_KEY);
    if (!raw) return false;
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) && list.includes(trimmed);
  } catch {
    return false;
  }
}

/** Survives React Strict Mode double mount on the completion route. */
let desktopSsoFlashReadCache: DesktopSsoCompleteFlashPayload | null | undefined;

export function setDesktopSsoCompleteFlash(
  provider: DesktopAuthProvider,
): void {
  const payload: DesktopSsoCompleteFlashPayload = { provider, v: 1 };
  // Refresh cache so repeated desktop handoffs in the same tab return latest provider.
  desktopSsoFlashReadCache = payload;
  sessionStorage.setItem(
    DESKTOP_SSO_COMPLETE_FLASH_KEY,
    JSON.stringify(payload),
  );
}

export function readDesktopSsoCompleteFlashOnce(): DesktopSsoCompleteFlashPayload | null {
  if (desktopSsoFlashReadCache !== undefined) {
    return desktopSsoFlashReadCache;
  }
  try {
    const raw = sessionStorage.getItem(DESKTOP_SSO_COMPLETE_FLASH_KEY);
    if (raw) {
      sessionStorage.removeItem(DESKTOP_SSO_COMPLETE_FLASH_KEY);
      const parsed = JSON.parse(raw) as Partial<DesktopSsoCompleteFlashPayload>;
      if (parsed.provider === "google" || parsed.provider === "microsoft") {
        desktopSsoFlashReadCache = {
          provider: parsed.provider,
          v: 1,
        };
        return desktopSsoFlashReadCache;
      }
    }
  } catch {
    try {
      sessionStorage.removeItem(DESKTOP_SSO_COMPLETE_FLASH_KEY);
    } catch {
      // ignore
    }
  }
  desktopSsoFlashReadCache = null;
  return null;
}

export function getDesktopSsoCompleteReplaceHref(): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#/login/desktop-sso-complete`;
}
