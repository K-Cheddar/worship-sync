import { isElectron } from "./environment";
import { getSafeHttpUrl } from "../components/ContentPreview/contentPreview";

type OpenExternalUrlOptions = {
  /** Preview links are user-provided HTTPS targets; OAuth remains allowlisted. */
  allowArbitraryHttps?: boolean;
};

/** Open only validated http(s) URLs without ever replacing the app location. */
export const openExternalUrl = async (
  rawUrl: string,
  options: OpenExternalUrlOptions = {},
): Promise<boolean> => {
  const url = getSafeHttpUrl(rawUrl);
  if (!url) return false;

  if (isElectron() && window.electronAPI?.openExternalUrl) {
    const openElectronUrl = window.electronAPI.openExternalUrl as (
      targetUrl: string,
      targetOptions?: OpenExternalUrlOptions,
    ) => Promise<boolean>;
    return openElectronUrl(url, options);
  }

  return Boolean(window.open(url, "_blank", "noopener,noreferrer"));
};
