import { app } from "electron";
import { join } from "node:path";
import * as fs from "node:fs";
import * as https from "node:https";
import * as http from "node:http";
import { URL } from "node:url";

interface MediaCacheEntry {
  url: string;
  localPath: string;
  lastUsed: number;
  contentType?: string;
}

export class MediaCacheManager {
  private cacheDir: string;
  private cacheIndexPath: string;
  private cacheIndex: Map<string, MediaCacheEntry>;
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

  /** Safely remove a file, ignoring errors */
  private cleanupFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.warn("Error removing file:", error);
    }
  }

  private getMediaFileName(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const ext = pathname.match(
        /\.(mp4|webm|mov|avi|mkv|jpg|jpeg|png|gif|webp|svg|avif)$/i
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
      const playbackIdMatch = url.match(/stream\.mux\.com\/([a-zA-Z0-9]+)/);
      if (playbackIdMatch) {
        const playbackId = playbackIdMatch[1];
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
    try {
      // Normalize to cache key (returns null for non-cacheable URLs like non-Mux HLS)
      const cacheKey = this.getCacheKey(url);
      if (!cacheKey) {
        console.log("Skipping non-cacheable URL:", url);
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

      if (this.isMuxUrl(downloadUrl)) {
        console.log(
          `[Media Cache] Downloading Mux video: ${downloadUrl} (original: ${url})`
        );
      }

      return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(localPath);
        const initialUrl = downloadUrl.includes("?")
          ? downloadUrl
          : `${downloadUrl}?download=video.mp4`;

        // Follow redirects within the same context to preserve cacheKey/localPath
        const makeRequest = (
          targetUrl: string,
          redirectsLeft: number = 5
        ) => {
          const urlObj = new URL(targetUrl);
          const client = urlObj.protocol === "https:" ? https : http;

          const request = client.get(
            targetUrl,
            { headers: { "User-Agent": "WorshipSync/1.0", Accept: "*/*" } },
            (response) => {
              // Follow redirects while preserving cache key context
              if (
                (response.statusCode === 301 ||
                  response.statusCode === 302) &&
                response.headers.location
              ) {
                if (redirectsLeft <= 0) {
                  file.close();
                  this.cleanupFile(localPath);
                  reject(new Error("Too many redirects"));
                  return;
                }
                makeRequest(response.headers.location, redirectsLeft - 1);
                return;
              }

              if (response.statusCode !== 200) {
                file.close();
                this.cleanupFile(localPath);

                if (response.statusCode === 404) {
                  if (this.isMuxUrl(downloadUrl)) {
                    console.warn(
                      `[Media Cache] Mux video returned 404 for: ${downloadUrl}`
                    );
                    console.warn(
                      `[Media Cache] Static renditions may not be ready. Video will stream via HLS.`
                    );
                  } else {
                    console.warn(
                      `[Media Cache] Media not available (404): ${downloadUrl}`
                    );
                  }
                  // Resolve with null instead of rejecting — allows sync to continue
                  resolve(null);
                  return;
                }

                reject(
                  new Error(
                    `Failed to download media: ${response.statusCode}`
                  )
                );
                return;
              }

              // Capture content-type for accurate serving by the protocol handler
              const responseContentType = (
                response.headers["content-type"] || ""
              )
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
            }
          );

          request.on("error", (error) => {
            file.close();
            this.cleanupFile(localPath);
            reject(error);
          });

          // 5 minute timeout — large files need more than 30s on moderate connections
          request.setTimeout(300000, () => {
            request.destroy();
            file.close();
            this.cleanupFile(localPath);
            reject(new Error("Download timeout"));
          });
        };

        makeRequest(initialUrl);
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
        urlsToRemove.push(url);
        this.cleanupFile(entry.localPath);
      }
    }

    for (const url of urlsToRemove) {
      this.cacheIndex.delete(url);
    }

    if (urlsToRemove.length > 0) {
      this.flushSaveIndex();
      console.log(`Cleaned up ${urlsToRemove.length} unused media file(s)`);
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
}
