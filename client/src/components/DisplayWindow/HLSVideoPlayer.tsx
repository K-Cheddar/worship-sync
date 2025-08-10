import React, { useRef, useEffect } from "react";
import Hls from "hls.js";
import { Box } from "../../types";

type HLSPlayerProps = {
  src: string;
  onLoadedData: () => void;
  onError: () => void;
  videoBox?: Box;
};

const HLSPlayer = ({
  src,
  onLoadedData,
  onError,
  videoBox,
}: HLSPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play();
      });

      return () => {
        hls.destroy();
      };
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.addEventListener("loadedmetadata", () => {
        video.play();
      });
    }
  }, [src]);

  return (
    <video
      ref={videoRef}
      className="absolute inset-0 w-full h-full object-cover z-0"
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
