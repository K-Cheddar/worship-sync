import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";

import { GlobalInfoContext } from "../../context/globalInfo";
import YouTubePlaylistPlayer from "../YouTubePlaylistPlayer/YouTubePlaylistPlayer";
import type { YouTubePlaylistPlayerHandle } from "../YouTubePlaylistPlayer/YouTubePlaylistPlayer";
import RehearsalPlayerWindow from "./RehearsalPlayerWindow";
import { createYouTubeQueueEntry, useRehearsalPlaybackController } from "./RehearsalPlaybackContext";

// Keep playback through "/": Home navigation uses it as a signed-in redirect.
const isRehearsalIneligibleRoute = (pathname: string) =>
  pathname === "/privacy" ||
  pathname === "/terms" ||
  pathname === "/support" ||
  pathname === "/invite" ||
  pathname.startsWith("/a/") ||
  pathname === "/projector" ||
  pathname === "/projector-full" ||
  pathname === "/monitor" ||
  pathname === "/stream" ||
  pathname === "/stream-info" ||
  pathname === "/credits" ||
  (pathname.startsWith("/boards/") && !pathname.startsWith("/boards/controller")) ||
  pathname.startsWith("/restream/connect-complete") ||
  pathname.startsWith("/youtube/connect-complete") ||
  pathname.startsWith("/canva/connect-complete") ||
  pathname.startsWith("/planning-center/connect-complete") ||
  pathname.startsWith("/services/") ||
  pathname.startsWith("/teams/intake") ||
  pathname.startsWith("/teams/schedule/") ||
  pathname.startsWith("/schedule-response") ||
  pathname.startsWith("/services-response") ||
  pathname.startsWith("/login") ||
  pathname.startsWith("/auth/") ||
  pathname.startsWith("/recovery/") ||
  pathname.startsWith("/workstation/pair") ||
  pathname.startsWith("/workstation/operator") ||
  pathname.startsWith("/display/pair") ||
  pathname.startsWith("/device-pairing/");

const RehearsalPlayerHost = () => {
  const location = useLocation();
  const globalInfo = useContext(GlobalInfoContext);
  const youtubeRef = useRef<YouTubePlaylistPlayerHandle | null>(null);
  const {
    attachAudioElement,
    attachYouTubeEngine,
    currentEntry,
    isLoading,
    stop,
    playVersion,
    reportYouTubeEnded,
    reportYouTubeError,
    reportYouTubeProgress,
    reportYouTubeStatus,
    reportYouTubeRangeChange,
    volume,
    isMuted,
  } = useRehearsalPlaybackController();

  const eligible = globalInfo?.loginState === "success" && globalInfo.sessionKind !== "display" && !isRehearsalIneligibleRoute(location.pathname);
  const youtubeEntry = useMemo(
    () => currentEntry?.source.kind === "youtube" ? createYouTubeQueueEntry(currentEntry) : null,
    [currentEntry],
  );
  const youtubeQueue = useMemo(() => youtubeEntry ? [youtubeEntry] : [], [youtubeEntry]);

  useLayoutEffect(() => {
    if (!eligible) stop();
  }, [eligible, stop]);

  const setYouTubeRef = useCallback((value: YouTubePlaylistPlayerHandle | null) => {
    youtubeRef.current = value;
    attachYouTubeEngine(value);
  }, [attachYouTubeEngine]);

  useEffect(() => {
    if (youtubeEntry && isLoading) youtubeRef.current?.playEntry(youtubeEntry.entryKey);
  }, [isLoading, playVersion, youtubeEntry]);

  useEffect(() => {
    if (youtubeEntry) youtubeRef.current?.setVolume(isMuted ? 0 : Math.round(volume * 100));
  }, [isMuted, volume, youtubeEntry]);

  const engine = (
    <YouTubePlaylistPlayer
      ref={setYouTubeRef}
      queue={youtubeQueue}
      externalPlayback
      onPlayerReady={() => youtubeRef.current?.setVolume(isMuted ? 0 : Math.round(volume * 100))}
      onExternalRangeComplete={reportYouTubeEnded}
      onExternalError={reportYouTubeError}
      onPlaybackProgress={reportYouTubeProgress}
      onPlaybackStatusChange={reportYouTubeStatus}
      onPlaybackRangeChange={reportYouTubeRangeChange}
    />
  );

  return (
    <>
      <audio ref={attachAudioElement} className="hidden" preload="metadata" />
      {eligible && currentEntry ? <RehearsalPlayerWindow youtubeEngine={engine} /> : null}
    </>
  );
};

export default RehearsalPlayerHost;
