export const WORSHIPSYNC_PROTOCOL_SCHEME = "worshipsync";
export const DESKTOP_AUTH_CALLBACK_CHANNEL = "desktop-auth-callback";
export const DESKTOP_AUTH_CALLBACK_PATH = "/auth/callback";

export type DesktopAuthCallbackPayload = {
  desktopAuthId: string;
};

const isDesktopAuthCallbackPathname = (target: URL): boolean => {
  if (target.pathname === DESKTOP_AUTH_CALLBACK_PATH) {
    return true;
  }
  // Non-special schemes: `worshipsync://auth/callback` parses as host "auth", pathname "/callback".
  return target.hostname === "auth" && target.pathname === "/callback";
};

export const parseDesktopAuthCallbackUrl = (
  value: string,
): DesktopAuthCallbackPayload | null => {
  try {
    const target = new URL(value);
    if (`${target.protocol}//` !== `${WORSHIPSYNC_PROTOCOL_SCHEME}://`) {
      return null;
    }
    if (!isDesktopAuthCallbackPathname(target)) {
      return null;
    }
    const desktopAuthId = String(
      target.searchParams.get("desktopAuthId") || "",
    ).trim();
    if (!desktopAuthId) {
      return null;
    }
    return { desktopAuthId };
  } catch {
    return null;
  }
};

export const findDesktopAuthProtocolArg = (
  argv: readonly string[],
): string | null =>
  argv.find((entry) =>
    entry.startsWith(`${WORSHIPSYNC_PROTOCOL_SCHEME}://`),
  ) || null;
