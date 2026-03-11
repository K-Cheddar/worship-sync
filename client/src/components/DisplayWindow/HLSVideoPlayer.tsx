import { useRef, useEffect, useCallback } from "react";
import Hls from "hls.js";
import { Box } from "../../types";

type HLSPlayerProps = {
  src: string;
  /** Original (pre-cache-resolution) URL; used as fallback if a cached file fails to load. */
  originalSrc?: string;
  className?: string;
  onLoadedData?: () => void;
  onError?: () => void;
  videoBox?: Box;
};

const HLSPlayer = ({
  src,
  originalSrc,
  className,
  onLoadedData,
  onError,
  videoBox,
}: HLSPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const originalSrcRef = useRef(originalSrc);
  originalSrcRef.current = originalSrc;

  const playNative = useCallback(
    (video: HTMLVideoElement, videoSrc: string) => {
      if (video.src && video.src !== videoSrc) {
        video.src = "";
      }

      video.src = videoSrc;
      let didFallback = false;

      const handleLoadedMetadata = () => {
        video.play().catch((e) => console.warn("Error playing video", e));
      };

      const handleError = (e: Event) => {
        const el = e.target as HTMLVideoElement;
        const error = el.error;
        console.error(`[HLSPlayer] Error loading video: ${videoSrc}`, {
          error,
          errorCode: error?.code,
          errorMessage: error?.message,
          networkState: el.networkState,
          readyState: el.readyState,
        });

        if (error) {
          switch (error.code) {
            case MediaError.MEDIA_ERR_ABORTED:
              console.error("[HLSPlayer] Video loading aborted");
              break;
            case MediaError.MEDIA_ERR_NETWORK:
              console.error("[HLSPlayer] Network error while loading video");
              break;
            case MediaError.MEDIA_ERR_DECODE:
              console.error("[HLSPlayer] Video decode error");
              break;
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
              console.error(
                `[HLSPlayer] Video source not supported: ${videoSrc}`
              );
              break;
          }
        }

        const fallback = originalSrcRef.current;
        if (
          !didFallback &&
          fallback &&
          fallback !== videoSrc &&
          videoSrc.startsWith("media-cache://")
        ) {
          didFallback = true;
          console.log(`[HLSPlayer] Falling back to original URL: ${fallback}`);
          video.src = fallback;
          video.load();
        }
      };

      const handleEnded = () => {
        video.currentTime = 0;
        video.play().catch((e) => console.warn("Error playing video", e));
      };

      video.addEventListener("loadedmetadata", handleLoadedMetadata);
      video.addEventListener("error", handleError);
      video.addEventListener("ended", handleEnded);

      video.load();

      return () => {
        video.removeEventListener("loadedmetadata", handleLoadedMetadata);
        video.removeEventListener("error", handleError);
        video.removeEventListener("ended", handleEnded);
      };
    },
    []
  );

  const playHLS = useCallback(
    (video: HTMLVideoElement, videoSrc: string) => {
      if (Hls.isSupported()) {
        hlsRef.current = null;
        const hls = new Hls();
        hlsRef.current = hls;

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            console.error(`[HLSPlayer] HLS fatal error: ${data.type}`, data);
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              console.error(
                `[HLSPlayer] Unrecoverable HLS error for: ${videoSrc}`
              );
              hls.destroy();
            }
          }
        });

        hls.loadSource(videoSrc);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch((e) => console.warn("Error playing video", e));
        });

        const handleEnded = () => {
          video.currentTime = 0;
          if (hlsRef.current) hlsRef.current.startLoad(0);
          video.play().catch((e) => console.warn("Error playing video", e));
        };

        video.addEventListener("ended", handleEnded);

        return () => {
          video.removeEventListener("ended", handleEnded);
          hlsRef.current = null;
          hls.destroy();
        };
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = videoSrc;
        video.load();

        const handleLoadedMetadata = () => {
          video.play().catch((e) => console.warn("Error playing video", e));
        };

        const handleEnded = () => {
          video.currentTime = 0;
          video.play().catch((e) => console.warn("Error playing video", e));
        };

        video.addEventListener("loadedmetadata", handleLoadedMetadata);
        video.addEventListener("ended", handleEnded);

        return () => {
          video.removeEventListener("loadedmetadata", handleLoadedMetadata);
          video.removeEventListener("ended", handleEnded);
        };
      }

      return () => { };
    },
    []
  );

  useEffect(() => {
    if (!videoRef.current || !src) return;

    if (src.endsWith(".m3u8")) {
      return playHLS(videoRef.current, src);
    }
    return playNative(videoRef.current, src);
  }, [src, playNative, playHLS]);

  const preloadValue = src.startsWith("media-cache://") ? "auto" : "metadata";

  return (
    <video
      ref={videoRef}
      data-testid="hls-video-player"
      preload={preloadValue}
      className={
        className || "absolute inset-0 w-full h-full object-cover z-0"
      }
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
