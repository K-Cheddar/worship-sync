import { Box, ItemSlideType, ItemProperties, DBItem, ItemLists, DBItemListDetails } from "../types";

/**
 * Extract all video background URLs from a box
 * Returns the original URLs - the cache manager will handle Mux HLS to MP4 conversion
 */
export const extractVideoUrlsFromBox = (box: Box): string[] => {
  const urls: string[] = [];
  
  if (box.mediaInfo?.type === "video" && box.mediaInfo?.background) {
    // For Mux videos with playbackId, prefer using the MP4 URL directly for caching
    // This is more efficient than converting HLS URLs later
    if (box.mediaInfo.source === "mux" && box.mediaInfo.muxPlaybackId) {
      // Use static rendition MP4 URL for Mux videos (better for caching)
      // Format: https://stream.mux.com/{playbackId}/highest.mp4
      urls.push(`https://stream.mux.com/${box.mediaInfo.muxPlaybackId}/highest.mp4`);
    } else {
      // For other videos, use the background URL as-is
      // The cache manager will handle Mux HLS to MP4 conversion if needed
      urls.push(box.mediaInfo.background);
    }
  }
  
  return urls;
};

/**
 * Extract all video background URLs from a slide
 */
export const extractVideoUrlsFromSlide = (slide: ItemSlideType): string[] => {
  const urls: string[] = [];
  
  for (const box of slide.boxes) {
    urls.push(...extractVideoUrlsFromBox(box));
  }
  
  return urls;
};

/**
 * Extract all video background URLs from an item
 */
export const extractVideoUrlsFromItem = (item: ItemProperties | DBItem): string[] => {
  const urls: string[] = [];
  
  // Check slides
  if (item.slides) {
    for (const slide of item.slides) {
      urls.push(...extractVideoUrlsFromSlide(slide));
    }
  }
  
  // Check arrangements
  if (item.arrangements) {
    for (const arrangement of item.arrangements) {
      if (arrangement.slides) {
        for (const slide of arrangement.slides) {
          urls.push(...extractVideoUrlsFromSlide(slide));
        }
      }
    }
  }
  
  return urls;
};

/**
 * Extract all unique video background URLs from all items in all outlines
 * This function should be called with the database to scan all items
 */
export const extractAllVideoUrlsFromOutlines = async (
  db: PouchDB.Database
): Promise<Set<string>> => {
  const videoUrls = new Set<string>();
  
  try {
    // Get all item lists
    const itemListsResponse = await db.get("ItemLists") as ItemLists;
    const itemLists = itemListsResponse?.itemLists || [];
    
    // For each outline, get its items
    for (const itemList of itemLists) {
      try {
        const itemListDetails = await db.get(itemList._id) as DBItemListDetails;
        const items = itemListDetails?.items || [];
        
        // For each item, get its full details and extract video URLs
        for (const serviceItem of items) {
          try {
            const item = await db.get(serviceItem._id);
            const urls = extractVideoUrlsFromItem(item as DBItem);
            urls.forEach((url) => videoUrls.add(url));
          } catch (error) {
            // Item might not exist, skip it
            console.warn(`Item ${serviceItem._id} not found:`, error);
          }
        }
      } catch (error) {
        // Item list might not exist, skip it
        console.warn(`Item list ${itemList._id} not found:`, error);
      }
    }
  } catch (error) {
    console.error("Error extracting video URLs from outlines:", error);
  }
  
  return videoUrls;
};
