import { app } from "electron";
import { join } from "node:path";
import * as fs from "node:fs";
import { URL } from "node:url";
import { safeHttpGet } from "./safeHttp";

interface MediaCacheEntry {
  url: string;
  localPath: string;
  lastUsed: number;
  contentType?: string;
}

export type MediaCacheEntryInfo = {
  source: string;
  sourceUrl: string;
  contentType?: string;
};

export type EnsureMediaCachedResult = {
  requested: number;
  cacheable: number;
  downloaded: number;
  failed: number;
  cacheMap: Record<string, string>;
};

/** Bound background cache warming so a service scan cannot saturate the booth. */
export const MEDIA_CACHE_WARM_CONCURRENCY = 3;

export const resolveMediaCacheRedirect = (
  response: {
    statusCode?: number;
    headers: { location?: string };
    resume: () => void;
  },
  targetUrl: string,
  redirectsLeft: number,
): { targetUrl: string; redirectsLeft: number } | undefined => {
  if (
    ![301, 302, 303, 307, 308].includes(response.statusCode ?? 0) ||
    !response.headers.location
  ) {
    return undefined;
  }
  if (redirectsLeft <= 0) throw new Error("Too many redirects");
  response.resume();
  return {
    targetUrl: new URL(response.headers.location, targetUrl).toString(),
    redirectsLeft: redirectsLeft - 1,
  };
};

export class MediaCacheManager {
  private cacheDir: string;
  private cacheIndexPath: string;
  private cacheIndex: Map<string, MediaCacheEntry>;
  private inFlightDownloads = new Map<string, Promise<string | null>>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.cacheDir = join(app.getPath("userData"), "media-cache");
    this.cacheIndexPath = join(this.cacheDir, "index.json");
    this.cacheIndex = new Map();
    this.ensureCacheDir();
    this.loadCacheIndex();
  }

  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private loadCacheIndex(): void {
    try {
      if (fs.existsSync(this.cacheIndexPath)) {
        const data = fs.readFileSync(this.cacheIndexPath, "utf-8");
        const entries = JSON.parse(data) as MediaCacheEntry[];
        this.cacheIndex = new Map(entries.map((entry) => [entry.url, entry]));
      }
    } catch (error) {
      console.error("Error loading media cache index:", error);
      this.cacheIndex = new Map();
    }
  }

  /** Write cache index atomically (write to temp file, then rename) */
  private saveCacheIndex(): void {
    try {
      const entries = Array.from(this.cacheIndex.values());
      const tmpPath = this.cacheIndexPath + ".tmp";
      fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), "utf-8");
      fs.renameSync(tmpPath, this.cacheIndexPath);
    } catch (error) {
      console.error("Error saving media cache index:", error);
    }
  }

  /** Debounced save — batches frequent lastUsed updates to avoid blocking the main process */
  private scheduleSaveIndex(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveCacheIndex();
    }, 5000);
  }

  /** Immediate save — used after downloads and cleanups where persistence matters */
  private flushSaveIndex(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveCacheIndex();
  }

  /** Safely remove a file, ignoring errors. Returns true when the file is gone. */
  private cleanupFile(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) return true;
      fs.unlinkSync(filePath);
      return !fs.existsSync(filePath);
    } catch (error) {
      console.warn("Error removing file:", error);
      return !fs.existsSync(filePath);
    }
  }

  private getMediaFileName(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const ext = pathname.match(
        /\.(3g2|3gp|avi|flv|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|mts|ogv|ts|webm|wmv|jpg|jpeg|png|gif|webp|svg|avif)$/i
      )?.[1];
      if (ext) {
        return `${this.hashString(url)}.${ext}`;
      }
      // Smart default: Cloudinary / image-path URLs → .jpg, everything else → .mp4
      const isLikelyImage =
        url.includes("cloudinary.com") || pathname.includes("/image/");
      return `${this.hashString(url)}.${isLikelyImage ? "jpg" : "mp4"}`;
    } catch {
      return `${this.hashString(url)}.mp4`;
    }
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Convert any Mux URL to static rendition MP4 URL.
   * Handles HLS (.m3u8), old-format (.mp4), and static rendition formats.
   */
  private convertMuxUrlToMp4(url: string): string | null {
    if (url.includes("stream.mux.com")) {
      const playbackIdMatch = url.match(/stream\.mux\.com\/([^/?]+)/);
      if (playbackIdMatch) {
        const playbackId = playbackIdMatch[1].replace(/\.(?:m3u8|mp4)$/i, "");
        return `https://stream.mux.com/${playbackId}/highest.mp4`;
      }
    }
    return null;
  }

  private isMuxUrl(url: string): boolean {
    return url.includes("stream.mux.com");
  }

  /**
   * Normalize a URL to its cache key form.
   * - Mux videos (any format: HLS, old MP4, static rendition) → static rendition MP4 URL
   * - Non-Mux HLS streams → null (can't be cached as a single file)
   * - Everything else → URL as-is
   */
  getCacheKey(url: string): string | null {
    if (this.isMuxUrl(url)) {
      return this.convertMuxUrlToMp4(url) || url;
    }
    if (url.includes(".m3u8")) {
      return null;
    }
    return url;
  }

  /**
   * Download media from a URL and save it locally.
   * For Mux videos, converts any URL format to MP4 static rendition for download.
   */
  async downloadMedia(url: string): Promise<string | null> {
    const cacheKey = this.getCacheKey(url);
    if (!cacheKey) {
      return this.downloadMediaInternal(url);
    }

    const inFlightDownload = this.inFlightDownloads.get(cacheKey);
    if (inFlightDownload) {
      return inFlightDownload;
    }

    const downloadPromise = this.downloadMediaInternal(url);
    this.inFlightDownloads.set(cacheKey, downloadPromise);
    try {
      return await downloadPromise;
    } finally {
      if (this.inFlightDownloads.get(cacheKey) === downloadPromise) {
        this.inFlightDownloads.delete(cacheKey);
      }
    }
  }

  /**
   * Additively warm the cache for the requested URLs. Unlike syncMediaCache,
   * this never removes entries that are not part of the request.
   */
  async ensureMediaCached(urls: string[]): Promise<EnsureMediaCachedResult> {
    const uniqueUrlsByCacheKey = new Map<string, string>();
    for (const url of urls) {
      const cacheKey = this.getCacheKey(url);
      if (cacheKey && !uniqueUrlsByCacheKey.has(cacheKey)) {
        uniqueUrlsByCacheKey.set(cacheKey, url);
      }
    }

    let downloaded = 0;
    let failed = 0;
    const queue = [...uniqueUrlsByCacheKey.values()];
    const warmOne = async () => {
      while (queue.length > 0) {
        // `shift` happens before the await, so each worker owns one URL and
        // the number of active downloads never exceeds the policy.
        const url = queue.shift();
        if (!url || this.getLocalPath(url)) continue;
        try {
          if (await this.downloadMedia(url)) {
            downloaded += 1;
          } else {
            failed += 1;
          }
        } catch {
          failed += 1;
        }
      }
    };
    await Promise.all(
      Array.from(
        {
          length: Math.min(MEDIA_CACHE_WARM_CONCURRENCY, queue.length),
        },
        () => warmOne(),
      ),
    );

    return {
      requested: urls.length,
      cacheable: uniqueUrlsByCacheKey.size,
      downloaded,
      failed,
      cacheMap: this.getMediaCacheMap(),
    };
  }

  private async downloadMediaInternal(url: string): Promise<string | null> {
    try {
      // Normalize to cache key (returns null for non-cacheable URLs like non-Mux HLS)
      const cacheKey = this.getCacheKey(url);
      if (!cacheKey) {
        return null;
      }

      // Check if already cached
      const existing = this.cacheIndex.get(cacheKey);
      if (existing && fs.existsSync(existing.localPath)) {
        existing.lastUsed = Date.now();
        this.scheduleSaveIndex();
        return existing.localPath;
      }

      // For Mux videos, cacheKey is already the MP4 static rendition URL
      const downloadUrl = cacheKey;
      // Use cacheKey for filename so extension matches actual content (always MP4 for Mux)
      const fileName = this.getMediaFileName(cacheKey);
      const localPath = join(this.cacheDir, fileName);

      return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(localPath);
        const initialUrl = downloadUrl.includes("?")
          ? downloadUrl
          : `${downloadUrl}?download=video.mp4`;

        // Follow redirects within the same context to preserve cacheKey/localPath
        void (async () => {
          try {
            const { response } = await safeHttpGet(initialUrl, {
              headers: { "User-Agent": "WorshipSync/1.0", Accept: "*/*" },
            });
            if (response.statusCode !== 200) {
              file.close();
              this.cleanupFile(localPath);

              if (response.statusCode === 404) {
                if (this.isMuxUrl(downloadUrl)) {
                  console.warn(`[Media Cache] Mux video returned 404 for: ${downloadUrl}`);
                  console.warn("[Media Cache] Static renditions may not be ready. Video will stream via HLS.");
                } else {
                  console.warn(`[Media Cache] Media not available (404): ${downloadUrl}`);
                }
                resolve(null);
                return;
              }

              reject(new Error(`Failed to download media: ${response.statusCode}`));
              return;
            }

            const responseContentType = (response.headers["content-type"] || "")
              .split(";")[0]
              .trim();
            response.pipe(file);
            file.on("finish", () => {
              file.close();
              const entry: MediaCacheEntry = {
                url: cacheKey,
                localPath,
                lastUsed: Date.now(),
                contentType: responseContentType || undefined,
              };
              this.cacheIndex.set(cacheKey, entry);
              this.flushSaveIndex();
              resolve(localPath);
            });
          } catch (error) {
            file.close();
            this.cleanupFile(localPath);
            reject(error);
          }
        })();
      });
    } catch (error) {
      console.error(`Error downloading media ${url}:`, error);
      return null;
    }
  }

  /**
   * Get the local path for a media URL if it's cached.
   * Normalizes all Mux URL formats (HLS, old-format, static rendition) for lookup.
   */
  getLocalPath(url: string): string | null {
    const lookupUrl = this.getCacheKey(url);
    if (!lookupUrl) return null;

    const entry = this.cacheIndex.get(lookupUrl);
    if (entry && fs.existsSync(entry.localPath)) {
      entry.lastUsed = Date.now();
      this.scheduleSaveIndex();
      return entry.localPath;
    }
    return null;
  }

  /**
   * Remove media that are not in the provided set of cache keys.
   * Callers should normalize URLs to cache keys before passing them in.
   */
  async cleanupUnusedMedia(usedUrls: Set<string>): Promise<void> {
    const urlsToRemove: string[] = [];

    for (const [url, entry] of this.cacheIndex.entries()) {
      if (!usedUrls.has(url)) {
        if (this.cleanupFile(entry.localPath)) {
          urlsToRemove.push(url);
        } else {
          console.warn(
            `[Media Cache] Retaining cache entry for file still in use: ${entry.localPath}`
          );
        }
      }
    }

    for (const url of urlsToRemove) {
      this.cacheIndex.delete(url);
    }

    if (urlsToRemove.length > 0) {
      this.flushSaveIndex();
    }
  }

  /**
   * Get the stored content-type for a cached file (looked up by filename).
   * Returns null if the file isn't in the index or has no stored content-type.
   */
  getContentTypeForFile(filename: string): string | null {
    for (const entry of this.cacheIndex.values()) {
      if (entry.localPath.endsWith(filename)) {
        return entry.contentType || null;
      }
    }
    return null;
  }

  /**
   * Get all cached media URLs
   */
  getAllCachedUrls(): string[] {
    return Array.from(this.cacheIndex.keys());
  }

  /**
   * Return a map of URL -> media-cache:// URL for all cached entries.
   * Includes cache key and, for Mux, the HLS URL form so the renderer can look up by either.
   */
  getMediaCacheMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const [cacheKey, entry] of this.cacheIndex) {
      if (!fs.existsSync(entry.localPath)) continue;
      const filename = entry.localPath.split(/[/\\]/).pop();
      if (!filename) continue;
      const mediaCacheUrl = `media-cache://${filename}`;
      map[cacheKey] = mediaCacheUrl;
      if (this.isMuxUrl(cacheKey)) {
        const playbackIdMatch = cacheKey.match(/stream\.mux\.com\/([^/?]+)/);
        if (playbackIdMatch) {
          const playbackId = playbackIdMatch[1];
          map[`https://stream.mux.com/${playbackId}.m3u8`] = mediaCacheUrl;
          map[`https://stream.mux.com/${playbackId}/master.m3u8`] = mediaCacheUrl;
        }
      }
    }
    return map;
  }

  /** Metadata for the dev-only prepared-video picker. */
  getMediaCacheEntries(): MediaCacheEntryInfo[] {
    const entries: MediaCacheEntryInfo[] = [];
    for (const [sourceUrl, entry] of this.cacheIndex) {
      if (!fs.existsSync(entry.localPath)) continue;
      const filename = entry.localPath.split(/[/\\]/).pop();
      if (!filename) continue;
      entries.push({
        source: `media-cache://${filename}`,
        sourceUrl,
        ...(entry.contentType ? { contentType: entry.contentType } : {}),
      });
    }
    return entries;
  }
}
