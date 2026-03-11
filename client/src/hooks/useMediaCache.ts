import { useCallback } from "react";
import { useContext } from "react";
import { getMediaUrlsFromMediaDoc } from "../utils/mediaCacheUtils";
import { ControllerInfoContext } from "../context/controllerInfo";

/**
 * Hook to sync media cache with the media list (media doc).
 * Call when the media list changes or on app startup.
 */
export const useMediaCache = () => {
  const { db } = useContext(ControllerInfoContext) || {};

  const syncMediaCache = useCallback(async () => {
    if (!db || !window.electronAPI) {
      return;
    }

    try {
      const mediaUrls = await getMediaUrlsFromMediaDoc(db);
      const urlArray = Array.from(mediaUrls);

      if (urlArray.length === 0) {
        await (window.electronAPI as unknown as { syncMediaCache: (urls: string[]) => Promise<{ downloaded: number; cleaned: number }> }).syncMediaCache([]);
        return;
      }

      await (window.electronAPI as unknown as { syncMediaCache: (urls: string[]) => Promise<{ downloaded: number; cleaned: number }> }).syncMediaCache(urlArray);

    } catch (error) {
      console.error("Error syncing media cache:", error);
    }
  }, [db]);

  /**
   * Ensure media cache is in sync with the media list (e.g. when switching outline).
   */
  const preloadOutlineMedia = useCallback(async (_outlineId: string) => {
    await syncMediaCache();
  }, [syncMediaCache]);

  /**
   * Get the local path for a media URL if it's cached
   */
  const getLocalMediaPath = useCallback(
    async (url: string): Promise<string | null> => {
      if (!window.electronAPI) {
        return null;
      }

      try {
        return await (window.electronAPI as unknown as { getLocalMediaPath: (url: string) => Promise<string | null> }).getLocalMediaPath(url);
      } catch (error) {
        console.error("Error getting local media path:", error);
        return null;
      }
    },
    []
  );

  return {
    syncMediaCache,
    getLocalMediaPath,
    preloadOutlineMedia,
  };
};
