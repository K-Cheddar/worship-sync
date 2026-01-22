import { app } from "electron";
import { join } from "node:path";
import * as fs from "node:fs";
import * as https from "node:https";
import * as http from "node:http";
import { URL } from "node:url";

interface VideoCacheEntry {
  url: string;
  localPath: string;
  lastUsed: number;
}

export class VideoCacheManager {
  private cacheDir: string;
  private cacheIndexPath: string;
  private cacheIndex: Map<string, VideoCacheEntry>;

  constructor() {
    this.cacheDir = join(app.getPath("userData"), "video-cache");
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
        const entries = JSON.parse(data) as VideoCacheEntry[];
        this.cacheIndex = new Map(entries.map((entry) => [entry.url, entry]));
      }
    } catch (error) {
      console.error("Error loading video cache index:", error);
      this.cacheIndex = new Map();
    }
  }

  private saveCacheIndex(): void {
    try {
      const entries = Array.from(this.cacheIndex.values());
      fs.writeFileSync(
        this.cacheIndexPath,
        JSON.stringify(entries, null, 2),
        "utf-8"
      );
    } catch (error) {
      console.error("Error saving video cache index:", error);
    }
  }

  private getVideoFileName(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const ext = pathname.match(/\.(mp4|webm|mov|avi|mkv|m3u8)$/i)?.[1] || "mp4";
      // Create a safe filename from the URL
      const hash = this.hashString(url);
      return `${hash}.${ext}`;
    } catch {
      // Fallback if URL parsing fails
      const hash = this.hashString(url);
      return `${hash}.mp4`;
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
   * Convert Mux HLS URL to MP4 URL for caching
   * Mux HLS: https://stream.mux.com/{playbackId}.m3u8
   * Mux MP4 (static rendition): https://stream.mux.com/{playbackId}/highest.mp4
   * According to Mux docs: https://stream.mux.com/{PLAYBACK_ID}/{STATIC_RENDITION_NAME}
   */
  private convertMuxUrlToMp4(url: string): string | null {
    if (url.includes("stream.mux.com")) {
      const playbackIdMatch = url.match(/stream\.mux\.com\/([a-zA-Z0-9]+)/);
      if (playbackIdMatch) {
        const playbackId = playbackIdMatch[1];
        // Use the static rendition format: /{playbackId}/highest.mp4
        // The ?download= parameter is optional and just sets the download filename
        return `https://stream.mux.com/${playbackId}/highest.mp4`;
      }
    }
    return null;
  }

  /**
   * Check if a URL is a Mux video URL
   */
  private isMuxUrl(url: string): boolean {
    return url.includes("stream.mux.com");
  }

  /**
   * Download a video from a URL and save it locally
   * For Mux videos, converts HLS URLs to MP4 URLs for caching
   */
  async downloadVideo(url: string): Promise<string | null> {
    try {
      // Handle Mux videos - convert HLS to MP4 for caching
      let downloadUrl = url;
      let cacheKey = url; // Key to use in cache index
      
      if (this.isMuxUrl(url) && url.includes(".m3u8")) {
        const mp4Url = this.convertMuxUrlToMp4(url);
        if (mp4Url) {
          downloadUrl = mp4Url;
          cacheKey = mp4Url; // Use MP4 URL as cache key
          console.log(`Converting Mux HLS to MP4: ${url} -> ${downloadUrl}`);
        } else {
          console.log("Could not convert Mux URL to MP4:", url);
          return null;
        }
      } else if (this.isMuxUrl(url) && !url.includes(".m3u8") && !url.includes("/highest.mp4")) {
        // Mux MP4 URL that's not already in static rendition format - might be old format
        // Try to convert it to static rendition format
        const playbackIdMatch = url.match(/stream\.mux\.com\/([a-zA-Z0-9]+)(?:\.mp4)?$/);
        if (playbackIdMatch) {
          const playbackId = playbackIdMatch[1];
          downloadUrl = `https://stream.mux.com/${playbackId}/highest.mp4`;
          cacheKey = downloadUrl;
          console.log(`Converting Mux MP4 URL to static rendition format: ${url} -> ${downloadUrl}`);
        } else {
          downloadUrl = url;
          cacheKey = url;
        }
      } else if (this.isMuxUrl(url) && url.includes("/highest.mp4")) {
        // Already in static rendition format - use as-is
        downloadUrl = url;
        cacheKey = url;
      } else if (url.includes(".m3u8") && !this.isMuxUrl(url)) {
        // Skip non-Mux HLS streams - they can't be downloaded as a single file
        console.log("Skipping HLS stream caching:", url);
        return null;
      }

      // Check if already cached (using cache key, which is MP4 URL for Mux)
      const existing = this.cacheIndex.get(cacheKey);
      if (existing && fs.existsSync(existing.localPath)) {
        // Update last used timestamp
        existing.lastUsed = Date.now();
        this.saveCacheIndex();
        return existing.localPath;
      }

      const fileName = this.getVideoFileName(url);
      const localPath = join(this.cacheDir, fileName);

      // Log the download attempt for debugging
      if (this.isMuxUrl(downloadUrl)) {
        console.log(`[Video Cache] Attempting to download Mux video`);
        console.log(`[Video Cache] Download URL: ${downloadUrl}`);
        console.log(`[Video Cache] Original URL: ${url}`);
        console.log(`[Video Cache] Cache key: ${cacheKey}`);
      }

      // Download the video
      return new Promise((resolve, reject) => {
        const urlObj = new URL(downloadUrl);
        const isHttps = urlObj.protocol === "https:";
        const client = isHttps ? https : http;

        const file = fs.createWriteStream(localPath);
        
        // Try with download parameter first (though it shouldn't matter for programmatic downloads)
        // According to Mux docs: https://stream.mux.com/{PLAYBACK_ID}/{STATIC_RENDITION_NAME}?download={SAVED_FILE_NAME}
        const urlWithDownload = downloadUrl.includes('?') 
          ? downloadUrl 
          : `${downloadUrl}?download=video.mp4`;
        
        const request = client.get(urlWithDownload, {
          headers: {
            'User-Agent': 'WorshipSync/1.0',
            'Accept': '*/*',
          }
        }, (response) => {
          // Handle redirects
          if (response.statusCode === 301 || response.statusCode === 302) {
            if (response.headers.location) {
              file.close();
              try {
                if (fs.existsSync(localPath)) {
                  fs.unlinkSync(localPath);
                }
              } catch (unlinkError) {
                console.warn("Error removing file after redirect:", unlinkError);
              }
              return this.downloadVideo(response.headers.location)
                .then(resolve)
                .catch(reject);
            }
          }

          if (response.statusCode !== 200) {
            file.close();
            try {
              if (fs.existsSync(localPath)) {
                fs.unlinkSync(localPath);
              }
            } catch (unlinkError) {
              console.warn("Error removing file after failed download:", unlinkError);
            }
            
            // Handle 404 specifically - video might not be available for direct download
            if (response.statusCode === 404) {
              if (this.isMuxUrl(downloadUrl)) {
                console.warn(`[Video Cache] Mux video returned 404`);
                console.warn(`[Video Cache] URL attempted: ${urlWithDownload}`);
                console.warn(`[Video Cache] Base URL: ${downloadUrl}`);
                console.warn(`[Video Cache] Original URL: ${url}`);
                
                // Extract playback ID for debugging
                const playbackIdMatch = downloadUrl.match(/stream\.mux\.com\/([a-zA-Z0-9]+)/);
                if (playbackIdMatch) {
                  const playbackId = playbackIdMatch[1];
                  console.warn(`[Video Cache] Playback ID: ${playbackId}`);
                  console.warn(`[Video Cache] Expected format: https://stream.mux.com/${playbackId}/highest.mp4`);
                  console.warn(`[Video Cache] Alternative formats to try:`);
                  console.warn(`[Video Cache]   - https://stream.mux.com/${playbackId}/highest.mp4?download=video.mp4`);
                  console.warn(`[Video Cache]   - https://stream.mux.com/${playbackId}.mp4 (legacy format)`);
                }
                
                // Log response headers for debugging
                const responseHeaders = {
                  'content-type': response.headers['content-type'],
                  'content-length': response.headers['content-length'],
                  'location': response.headers['location'],
                };
                console.warn(`[Video Cache] Response headers:`, JSON.stringify(responseHeaders, null, 2));
                
                console.warn(`[Video Cache] Note: Static renditions may not be ready yet, or the URL format may be incorrect. Video will stream via HLS instead.`);
              } else {
                console.warn(`[Video Cache] Video not available for download (404): ${downloadUrl}`);
              }
              // Resolve with null instead of rejecting - this allows sync to continue
              resolve(null);
              return;
            }
            
            reject(new Error(`Failed to download video: ${response.statusCode}`));
            return;
          }

          response.pipe(file);

          file.on("finish", () => {
            file.close();
            // Save to cache index using cache key (MP4 URL for Mux, original for others)
            const entry: VideoCacheEntry = {
              url: cacheKey, // Store the cache key (MP4 URL for Mux)
              localPath,
              lastUsed: Date.now(),
            };
            this.cacheIndex.set(cacheKey, entry);
            this.saveCacheIndex();
            resolve(localPath);
          });
        });

        request.on("error", (error) => {
          file.close();
          try {
            if (fs.existsSync(localPath)) {
              fs.unlinkSync(localPath);
            }
          } catch (unlinkError) {
            console.warn("Error removing file after request error:", unlinkError);
          }
          reject(error);
        });

        request.setTimeout(30000, () => {
          request.destroy();
          file.close();
          try {
            if (fs.existsSync(localPath)) {
              fs.unlinkSync(localPath);
            }
          } catch (unlinkError) {
            console.warn("Error removing file after timeout:", unlinkError);
          }
          reject(new Error("Download timeout"));
        });
      });
    } catch (error) {
      console.error(`Error downloading video ${url}:`, error);
      return null;
    }
  }

  /**
   * Get the local path for a video URL if it's cached
   * For Mux videos, converts HLS URLs to MP4 for cache lookup
   */
  getLocalPath(url: string): string | null {
    // For Mux HLS URLs, convert to MP4 for cache lookup
    let lookupUrl = url;
    if (this.isMuxUrl(url) && url.includes(".m3u8")) {
      const mp4Url = this.convertMuxUrlToMp4(url);
      if (mp4Url) {
        lookupUrl = mp4Url;
      } else {
        return null;
      }
    } else if (url.includes(".m3u8") && !this.isMuxUrl(url)) {
      // For other HLS streams, they can't be cached
      return null;
    }

    // Check cache with the lookup URL (could be original or converted MP4)
    const entry = this.cacheIndex.get(lookupUrl);
    if (entry && fs.existsSync(entry.localPath)) {
      // Update last used timestamp
      entry.lastUsed = Date.now();
      this.saveCacheIndex();
      // Return the local file path - the main process will convert it to HTTP URL
      return entry.localPath;
    }
    return null;
  }

  /**
   * Remove videos that are not in the provided list of URLs
   */
  async cleanupUnusedVideos(usedUrls: Set<string>): Promise<void> {
    const urlsToRemove: string[] = [];
    
    for (const [url, entry] of this.cacheIndex.entries()) {
      if (!usedUrls.has(url)) {
        urlsToRemove.push(url);
        try {
          if (fs.existsSync(entry.localPath)) {
            fs.unlinkSync(entry.localPath);
          }
        } catch (error) {
          console.error(`Error removing video file ${entry.localPath}:`, error);
        }
      }
    }

    // Remove from cache index
    for (const url of urlsToRemove) {
      this.cacheIndex.delete(url);
    }

    if (urlsToRemove.length > 0) {
      this.saveCacheIndex();
      console.log(`Cleaned up ${urlsToRemove.length} unused video(s)`);
    }
  }

  /**
   * Get all cached video URLs
   */
  getAllCachedUrls(): string[] {
    return Array.from(this.cacheIndex.keys());
  }
}
