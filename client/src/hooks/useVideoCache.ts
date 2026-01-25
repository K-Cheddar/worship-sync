import { useCallback } from "react";
import { useContext } from "react";
import { extractAllVideoUrlsFromOutlines, extractVideoUrlsFromItem } from "../utils/videoCacheUtils";
import { ControllerInfoContext } from "../context/controllerInfo";
import type { DBItemListDetails, DBItem } from "../types";

/**
 * Hook to sync video cache with videos used in outlines
 * Call this when outlines change or on app startup
 */
export const useVideoCache = () => {
  const { db } = useContext(ControllerInfoContext) || {};

  const syncVideoCache = useCallback(async () => {
    if (!db || !window.electronAPI) {
      return;
    }

    try {
      // Extract all video URLs from outlines
      const videoUrls = await extractAllVideoUrlsFromOutlines(db);
      const urlArray = Array.from(videoUrls);

      if (urlArray.length === 0) {
        // No videos, just cleanup
        await (window.electronAPI as unknown as { syncVideoCache: (urls: string[]) => Promise<{ downloaded: number; cleaned: number }> }).syncVideoCache([]);
        return;
      }

      // Sync the cache (download new videos and remove unused ones)
      await (window.electronAPI as unknown as { syncVideoCache: (urls: string[]) => Promise<{ downloaded: number; cleaned: number }> }).syncVideoCache(urlArray);

    } catch (error) {
      console.error("Error syncing video cache:", error);
    }
  }, [db]);

  /**
   * Preload videos from a specific outline
   * Used for proactive preloading of active outline
   */
  const preloadOutlineVideos = useCallback(async (outlineId: string) => {
    if (!db || !window.electronAPI) {
      return;
    }

    try {
      // Get the outline details
      const outlineDetails = await db.get(outlineId) as DBItemListDetails;
      const items = outlineDetails?.items || [];

      // Extract video URLs from all items in the outline
      const videoUrls = new Set<string>();
      for (const serviceItem of items) {
        try {
          const item = await db.get(serviceItem._id) as DBItem;
          const urls = extractVideoUrlsFromItem(item);
          urls.forEach((url) => videoUrls.add(url));
        } catch (error) {
          // Item might not exist, skip it
          console.warn(`Item ${serviceItem._id} not found for preload:`, error);
        }
      }

      const urlArray = Array.from(videoUrls);
      if (urlArray.length === 0) {
        return;
      }

      // Sync the cache (download videos in background)
      await (window.electronAPI as unknown as { syncVideoCache: (urls: string[]) => Promise<{ downloaded: number; cleaned: number }> }).syncVideoCache(urlArray);

    } catch (error) {
      console.error("Error preloading outline videos:", error);
    }
  }, [db]);

  /**
   * Get the local path for a video URL if it's cached
   */
  const getLocalVideoPath = useCallback(
    async (url: string): Promise<string | null> => {
      if (!window.electronAPI) {
        return null;
      }

      try {
        return await (window.electronAPI as unknown as { getLocalVideoPath: (url: string) => Promise<string | null> }).getLocalVideoPath(url);
      } catch (error) {
        console.error("Error getting local video path:", error);
        return null;
      }
    },
    []
  );

  return {
    syncVideoCache,
    getLocalVideoPath,
    preloadOutlineVideos,
  };
};
