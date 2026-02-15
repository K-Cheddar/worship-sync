import React, { useRef, useEffect, useState, useCallback } from "react";
import Hls from "hls.js";
import { Box } from "../../types";

type HLSPlayerProps = {
  src: string;
  className?: string;
  onLoadedData?: () => void;
  onError?: () => void;
  videoBox?: Box;
};

const HLSPlayer = ({
  src,
  className,
  onLoadedData,
  onError,
  videoBox,
}: HLSPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [actualSrc, setActualSrc] = useState<string | undefined>(undefined); // Start as undefined to prevent loading until we check cache
  const [isCheckingCache, setIsCheckingCache] = useState<boolean>(true);
  const cacheCheckIdRef = useRef(0);

  // Check for local cached video in Electron
  useEffect(() => {
    const checkId = ++cacheCheckIdRef.current;
    const checkLocalVideo = async () => {
      setIsCheckingCache(true);
      
      // Clear video src while checking
      if (videoRef.current) {
        videoRef.current.src = "";
      }
      
      if (window.electronAPI && src) {
        try {
          const localPath = await (window.electronAPI as unknown as { getLocalMediaPath: (url: string) => Promise<string | null> }).getLocalMediaPath(src);
          if (checkId !== cacheCheckIdRef.current) return; // src changed while awaiting — discard stale result
          if (localPath) {
            setActualSrc(localPath);
            setIsCheckingCache(false);
            return;
          }
        } catch (error) {
          if (checkId !== cacheCheckIdRef.current) return;
          console.warn("Error getting local video path:", error);
        }
      }
      if (checkId !== cacheCheckIdRef.current) return;
      // No cached version, use original URL
      setActualSrc(src);
      setIsCheckingCache(false);
    };

    checkLocalVideo();
  }, [src]);

  // Helper function to play native video (MP4, cached or remote)
  const playNative = useCallback((video: HTMLVideoElement, videoSrc: string) => {
    // Clear any existing HLS instance
    if (video.src && video.src !== videoSrc) {
      video.src = "";
    }
    
    // Set the source and handle loading
    video.src = videoSrc;
    
    const handleLoadedMetadata = () => {
      video.play().catch((e) => {
        console.warn("Error playing video", e);
      });
    };
    
    const handleError = (e: Event) => {
      const videoElement = e.target as HTMLVideoElement;
      const error = videoElement.error;
      console.error(`[HLSPlayer] Error loading video: ${videoSrc}`, {
        error,
        errorCode: error?.code,
        errorMessage: error?.message,
        networkState: videoElement.networkState,
        readyState: videoElement.readyState,
      });
      
      // Log more details about the error
      if (error) {
        switch (error.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            console.error(`[HLSPlayer] Video loading aborted`);
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            console.error(`[HLSPlayer] Network error while loading video`);
            break;
          case MediaError.MEDIA_ERR_DECODE:
            console.error(`[HLSPlayer] Video decode error`);
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            console.error(`[HLSPlayer] Video source not supported: ${videoSrc}`);
            break;
        }
      }
      
      // Fallback to original URL if cached video fails
      if (src && src !== videoSrc && videoSrc.startsWith("media-cache://")) {
        console.log(`[HLSPlayer] Falling back to original URL: ${src}`);
        setActualSrc(src);
      }
    };
    
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("error", handleError);
    
    // Try to load immediately
    video.load();
    
    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("error", handleError);
    };
  }, [src, setActualSrc]);

  // Helper function to play HLS streams
  const playHLS = useCallback((video: HTMLVideoElement, videoSrc: string) => {
    if (Hls.isSupported()) {
      const hls = new Hls();
      
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.error(`[HLSPlayer] HLS fatal error: ${data.type}`, data);
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            console.log(`[HLSPlayer] Network error for: ${videoSrc}`);
            // Try to recover
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            console.log(`[HLSPlayer] Media error for: ${videoSrc}`);
            hls.recoverMediaError();
          } else {
            console.error(`[HLSPlayer] Unrecoverable HLS error for: ${videoSrc}`);
            hls.destroy();
          }
        }
      });
      
      hls.loadSource(videoSrc);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch((e) => {
          console.warn("Error playing video", e);
        });
      });

      return () => {
        hls.destroy();
      };
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = videoSrc;
      video.load();
      
      const handleLoadedMetadata = () => {
        video.play().catch((e) => {
          console.warn("Error playing video", e);
        });
      };
      
      video.addEventListener("loadedmetadata", handleLoadedMetadata);
      
      return () => {
        video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      };
    }
    
    return () => {};
  }, []);

  useEffect(() => {
    // Don't load video while checking cache or if no source
    // Also ensure we clear the src if we're still checking
    if (isCheckingCache && videoRef.current) {
      videoRef.current.src = "";
      return;
    }
    
    if (!videoRef.current || !actualSrc) return;
    
    // 1. Cached MP4s (media-cache://)
    if (actualSrc.startsWith("media-cache://")) {
      return playNative(videoRef.current, actualSrc);
    }
    
    // 2. HLS streams (.m3u8)
    if (actualSrc.endsWith(".m3u8")) {
      return playHLS(videoRef.current, actualSrc);
    }
    
    // 3. Normal MP4 URLs
    return playNative(videoRef.current, actualSrc);
  }, [actualSrc, isCheckingCache, playNative, playHLS]);

  // Don't set src attribute until cache check is complete
  // This prevents the video from trying to load the original URL before we check cache
  const videoSrc = isCheckingCache ? undefined : (actualSrc || undefined);
  
  // Use preload="auto" for cached videos (instant playback), "metadata" for remote videos
  const preloadValue = actualSrc?.startsWith("media-cache://") ? "auto" : "metadata";
  
  return (
    <video
      ref={videoRef}
      src={videoSrc}
      preload={preloadValue}
      className={className || "absolute inset-0 w-full h-full object-cover z-0"}
      style={{
        filter: videoBox?.brightness
          ? `brightness(${videoBox.brightness}%)`
          : "",
      }}
      autoPlay
      muted
      loop
      onLoadedData={onLoadedData}
      onError={onError}
    />
  );
};

export default HLSPlayer;
