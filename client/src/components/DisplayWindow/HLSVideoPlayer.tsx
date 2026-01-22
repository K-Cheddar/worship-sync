import React, { useRef, useEffect, useState } from "react";
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

  // Check for local cached video in Electron
  useEffect(() => {
    const checkLocalVideo = async () => {
      setIsCheckingCache(true);
      
      // Clear video src while checking
      if (videoRef.current) {
        videoRef.current.src = "";
      }
      
      if (window.electronAPI && src) {
        try {
          const localPath = await (window.electronAPI as unknown as { getLocalVideoPath: (url: string) => Promise<string | null> }).getLocalVideoPath(src);
          if (localPath) {
            // Use the protocol URL returned by getLocalPath (video-cache://)
            // This is safer than file:// and works with Electron's security model
            console.log(`[HLSPlayer] Using cached video: ${localPath}`);
            // localPath is now an HTTP URL from the local server
            setActualSrc(localPath);
            setIsCheckingCache(false);
            return;
          }
        } catch (error) {
          console.warn("Error getting local video path:", error);
        }
      }
      // No cached version, use original URL
      setActualSrc(src);
      setIsCheckingCache(false);
    };

    checkLocalVideo();
  }, [src]);

  useEffect(() => {
    // Don't load video while checking cache or if no source
    // Also ensure we clear the src if we're still checking
    if (isCheckingCache && videoRef.current) {
      videoRef.current.src = "";
      return;
    }
    
    if (!videoRef.current || !actualSrc) return;
    
    // If it's a local cached file (http://127.0.0.1), don't use HLS
    if (actualSrc.startsWith("http://127.0.0.1") || actualSrc.startsWith("http://localhost")) {
      const video = videoRef.current;
      
      // Clear any existing HLS instance
      if (video.src && video.src !== actualSrc) {
        video.src = "";
      }
      
      // Set the source and handle loading
      video.src = actualSrc;
      
      const handleLoadedMetadata = () => {
        console.log(`[HLSPlayer] Cached video metadata loaded: ${actualSrc}`);
        video.play().catch((e) => {
          console.warn("Error playing cached video", e);
        });
      };
      
      const handleError = (e: Event) => {
        const video = e.target as HTMLVideoElement;
        const error = video.error;
        console.error(`[HLSPlayer] Error loading cached video: ${actualSrc}`, {
          error,
          errorCode: error?.code,
          errorMessage: error?.message,
          networkState: video.networkState,
          readyState: video.readyState,
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
              console.error(`[HLSPlayer] Video source not supported: ${actualSrc}`);
              break;
          }
        }
        
        // Fallback to original URL if cached video fails
        if (src && src !== actualSrc) {
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
    }

    // If it's an HLS video (.m3u8), use HLS.js
    if (!actualSrc.includes(".m3u8")) {
      const video = videoRef.current;
      
      // Clear any existing HLS instance
      if (video.src && video.src !== actualSrc) {
        video.src = "";
      }
      
      video.src = actualSrc;
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

    const video = videoRef.current;

    if (Hls.isSupported()) {
      const hls = new Hls();
      
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.error(`[HLSPlayer] HLS fatal error: ${data.type}`, data);
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            console.log(`[HLSPlayer] Network error for: ${actualSrc}`);
            // Try to recover
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            console.log(`[HLSPlayer] Media error for: ${actualSrc}`);
            hls.recoverMediaError();
          } else {
            console.error(`[HLSPlayer] Unrecoverable HLS error for: ${actualSrc}`);
            hls.destroy();
          }
        }
      });
      
      hls.loadSource(actualSrc);
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
      video.src = actualSrc;
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
  }, [actualSrc, isCheckingCache]);

  // Don't set src attribute until cache check is complete
  // This prevents the video from trying to load the original URL before we check cache
  const videoSrc = isCheckingCache ? undefined : (actualSrc || undefined);
  
  return (
    <video
      ref={videoRef}
      src={videoSrc}
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
