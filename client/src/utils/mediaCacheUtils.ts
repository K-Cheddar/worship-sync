import { MediaType } from "../types";

type PouchMissingDocError = {
  status?: number;
  name?: string;
  reason?: string;
};

const isMissingDocError = (error: unknown): boolean => {
  const maybeError = error as PouchMissingDocError;
  return (
    maybeError?.status === 404 ||
    maybeError?.name === "not_found" ||
    maybeError?.reason === "deleted"
  );
};

// ---------------------------------------------------------------------------
// Media doc (media list) extractors
// ---------------------------------------------------------------------------

/** Extract cacheable media URLs from the media list. Matches format expected by Electron cache. */
export const extractMediaUrlsFromBackgrounds = (backgrounds: MediaType[]): string[] => {
  const urls: string[] = [];
  for (const item of backgrounds) {
    if (item.type === "video") {
      if (item.source === "mux" && item.muxPlaybackId) {
        urls.push(`https://stream.mux.com/${item.muxPlaybackId}/highest.mp4`);
      } else if (item.background?.startsWith("http://") || item.background?.startsWith("https://")) {
        urls.push(item.background);
      }
      if (item.placeholderImage?.startsWith("http://") || item.placeholderImage?.startsWith("https://")) {
        urls.push(item.placeholderImage);
      }
    } else if (
      item.background?.startsWith("http://") ||
      item.background?.startsWith("https://")
    ) {
      urls.push(item.background);
    }
  }
  return urls;
};

/** Get all cacheable media URLs from the "media" doc in the database. */
export const getMediaUrlsFromMediaDoc = async (
  db: PouchDB.Database
): Promise<
  | { status: "loaded"; urls: Set<string> }
  | { status: "unavailable"; error: unknown }
> => {
  const urls = new Set<string>();
  try {
    const doc = (await db.get("media")) as { list?: MediaType[] };
    const list = doc?.list || [];
    extractMediaUrlsFromBackgrounds(list).forEach((url) => urls.add(url));
    return { status: "loaded", urls };
  } catch (error) {
    if (!isMissingDocError(error)) {
      console.warn("Failed to load media doc for media cache:", error);
    }
    if (isMissingDocError(error)) return { status: "loaded", urls };
    return { status: "unavailable", error };
  }
};
