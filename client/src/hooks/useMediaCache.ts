import { useCallback } from "react";
import { useContext } from "react";
import {
  extractAllMediaUrlsFromOutlines,
  extractMediaUrlsFromItem,
  getExistingItemsForServiceItems,
} from "../utils/mediaCacheUtils";
import { ControllerInfoContext } from "../context/controllerInfo";
import type { DBItemListDetails } from "../types";

/**
 * Hook to sync media cache with videos and images used in outlines.
 * Call this when outlines change or on app startup.
 */
export const useMediaCache = () => {
  const { db } = useContext(ControllerInfoContext) || {};

  const syncMediaCache = useCallback(async () => {
    if (!db || !window.electronAPI) {
      return;
    }

    try {
      const mediaUrls = await extractAllMediaUrlsFromOutlines(db);
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
   * Preload media from a specific outline.
   * Used for proactive preloading of active outline.
   */
  const preloadOutlineMedia = useCallback(async (outlineId: string) => {
    if (!db || !window.electronAPI) {
      return;
    }

    try {
      const outlineDetails = await db.get(outlineId) as DBItemListDetails;
      const itemDocs = await getExistingItemsForServiceItems(
        db,
        outlineDetails?.items || []
      );

      const mediaUrls = new Set<string>();
      for (const item of itemDocs) {
        const urls = extractMediaUrlsFromItem(item);
        urls.forEach((url) => mediaUrls.add(url));
      }

      const urlArray = Array.from(mediaUrls);
      if (urlArray.length === 0) {
        return;
      }

      await (window.electronAPI as unknown as { syncMediaCache: (urls: string[]) => Promise<{ downloaded: number; cleaned: number }> }).syncMediaCache(urlArray);

    } catch (error) {
      console.error("Error preloading outline media:", error);
    }
  }, [db]);

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
