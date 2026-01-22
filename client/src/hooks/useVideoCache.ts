import { useCallback } from "react";
import { useContext } from "react";
import { extractAllVideoUrlsFromOutlines } from "../utils/videoCacheUtils";
import { ControllerInfoContext } from "../context/controllerInfo";

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
      const result = await (window.electronAPI as unknown as { syncVideoCache: (urls: string[]) => Promise<{ downloaded: number; cleaned: number }> }).syncVideoCache(urlArray);
      console.log(
        `Video cache sync: ${result.downloaded} downloaded, ${result.cleaned} cleaned`
      );
    } catch (error) {
      console.error("Error syncing video cache:", error);
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
  };
};
