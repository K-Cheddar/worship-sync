const shareablePrefixFromHttpApiBase = (apiBase: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(apiBase);
  } catch {
    parsed = new URL(apiBase, "https://worshipsync.invalid/");
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  const normalizedPath = path === "" || path === "/" ? "" : path;
  return `${parsed.origin}${normalizedPath}${parsed.search}`;
};

export const isElectron = jest.fn(() => false);
export const isPackagedElectronRenderer = jest.fn(() => false);
export const reloadElectronDisplayWindows = jest.fn();
export const getApiBasePath = jest.fn(() => "/");
export const getIsDev = jest.fn(() => Promise.resolve(false));
export const getPlatform = jest.fn(() => Promise.resolve(null));
export const getAppVersion = jest.fn(() => Promise.resolve(null));

/**
 * Mirrors `src/utils/environment.ts` so copy/share URLs work under Jest
 * (`moduleNameMapper` forces this mock for all `environment` imports).
 */
export const getShareableHashRouterUrlPrefix = (): string => {
  if (typeof window === "undefined") {
    return "";
  }
  if (isPackagedElectronRenderer()) {
    try {
      return shareablePrefixFromHttpApiBase(getApiBasePath());
    } catch {
      return "https://www.worshipsync.net";
    }
  }
  return `${window.location.origin}${window.location.pathname}${window.location.search}`;
};

export const buildShareableHashRouterUrl = (hashRoute: string): string => {
  const prefix = getShareableHashRouterUrlPrefix();
  const trimmed = hashRoute.replace(/^#/, "");
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${prefix}#${path}`;
};
