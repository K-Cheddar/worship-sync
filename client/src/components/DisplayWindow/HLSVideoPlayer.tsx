import React, { useRef, useEffect } from "react";
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

  useEffect(() => {
    // If not a HLS video no need to do this logic, src will be a normal video url
    if (!videoRef.current || !src.includes(".m3u8")) return;
    const video = videoRef.current;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(src);
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
      video.src = src;
      video.addEventListener("loadedmetadata", () => {
        video.play().catch((e) => {
          console.warn("Error playing video", e);
        });
      });
    }
  }, [src]);

  return (
    <video
      ref={videoRef}
      src={src}
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
