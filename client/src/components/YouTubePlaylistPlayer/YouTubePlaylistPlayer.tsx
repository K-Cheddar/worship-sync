import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";

import Button from "../Button/Button";
import { cn } from "../../utils/cnHelper";
import { formatYouTubeDuration } from "../../utils/youtubeSearch";
import {
  findAvailablePlaylistIndex,
  type YouTubePlaylistEntry,
} from "./youtubePlaylist";

type YouTubePlayerEvent = { data: number };
type YouTubeVideoRequest = {
  videoId: string;
  startSeconds?: number;
  endSeconds?: number;
};
type YouTubePlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  cueVideoById: (request: string | YouTubeVideoRequest) => void;
  loadVideoById: (request: string | YouTubeVideoRequest) => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  setVolume: (volume: number) => void;
  destroy: () => void;
};

const getPlaybackIdentity = (entry: YouTubePlaylistEntry, rangeIndex: number) => {
  const range = entry.playbackRanges[rangeIndex] ?? {};
  return `${entry.entryKey}:${entry.videoId}:${range.startSeconds ?? 0}:${range.endSeconds ?? ""}`;
};

type YouTubeApi = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: YouTubePlayerEvent) => void;
        onError?: (event: YouTubePlayerEvent) => void;
      };
    },
  ) => YouTubePlayer;
};

type YouTubeWindow = Window & {
  YT?: YouTubeApi;
  onYouTubeIframeAPIReady?: () => void;
};

let iframeApiPromise: Promise<YouTubeApi> | null = null;

export const loadYouTubeIframeApi = () => {
  const currentWindow = window as YouTubeWindow;
  if (currentWindow.YT?.Player) return Promise.resolve(currentWindow.YT);
  if (iframeApiPromise) return iframeApiPromise;

  iframeApiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const previousReady = currentWindow.onYouTubeIframeAPIReady;
    const resolveIfReady = () => {
      previousReady?.();
      if (currentWindow.YT?.Player) resolve(currentWindow.YT);
      else reject(new Error("YouTube player API did not load."));
    };
    currentWindow.onYouTubeIframeAPIReady = resolveIfReady;
    const existingScript = document.getElementById("youtube-iframe-api");
    if (existingScript) return;
    const script = document.createElement("script");
    script.id = "youtube-iframe-api";
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("YouTube player API could not load."));
    document.head.appendChild(script);
  }).catch((error) => {
    iframeApiPromise = null;
    throw error;
  });
  return iframeApiPromise;
};

export type YouTubePlaylistPlayerHandle = {
  playAll: () => void;
  playEntry: (entryKey: string) => void;
  pause: () => void;
  resume: () => void;
  seekTo: (seconds: number) => void;
  seekToPlaybackPosition: (seconds: number) => void;
  setVolume: (volume: number) => void;
  stop: () => void;
};

type YouTubePlaylistPlayerProps = {
  queue: YouTubePlaylistEntry[];
  mode?: "playlist" | "preview";
  autoPlayEntryKey?: string | null;
  onPlayerReady?: () => void;
  onVideoUnavailable?: (entry: YouTubePlaylistEntry) => void;
  onCurrentEntryChange?: (entryKey: string) => void;
  externalPlayback?: boolean;
  onExternalRangeComplete?: (entryKey: string) => void;
  onExternalError?: (entryKey: string) => void;
  onPlaybackProgress?: (entryKey: string, position: number, duration: number) => void;
  onPlaybackStatusChange?: (entryKey: string, isPlaying: boolean) => void;
  onPlaybackRangeChange?: (entryKey: string, rangeIndex: number) => void;
  previewAction?: ReactNode;
};

const YouTubePlaylistPlayer = forwardRef(function YouTubePlaylistPlayer(
  {
    queue,
    mode = "playlist",
    autoPlayEntryKey,
    onPlayerReady,
    onVideoUnavailable,
    onCurrentEntryChange,
    externalPlayback = false,
    onExternalRangeComplete,
    onExternalError,
    onPlaybackProgress,
    onPlaybackStatusChange,
    onPlaybackRangeChange,
    previewAction,
  }: YouTubePlaylistPlayerProps,
  ref: ForwardedRef<YouTubePlaylistPlayerHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const playerReadyRef = useRef(false);
  const loadedPlaybackIdentityRef = useRef("");
  const activeRangeIndexRef = useRef(0);
  const activeEntryKeyRef = useRef("");
  const rangeTransitioningRef = useRef(false);
  const canResumeRef = useRef(false);
  const cuedStartSecondsRef = useRef<number | null>(null);
  const shouldPlayRef = useRef(
    Boolean(autoPlayEntryKey && queue[0]?.entryKey === autoPlayEntryKey),
  );
  const queueRef = useRef(queue);
  const onVideoUnavailableRef = useRef(onVideoUnavailable);
  const onPlayerReadyRef = useRef(onPlayerReady);
  const onCurrentEntryChangeRef = useRef(onCurrentEntryChange);
  const onExternalRangeCompleteRef = useRef(onExternalRangeComplete);
  const onExternalErrorRef = useRef(onExternalError);
  const onPlaybackProgressRef = useRef(onPlaybackProgress);
  const onPlaybackStatusChangeRef = useRef(onPlaybackStatusChange);
  const onPlaybackRangeChangeRef = useRef(onPlaybackRangeChange);
  const failedKeysRef = useRef(new Set<string>());
  const currentIndexRef = useRef(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [message, setMessage] = useState("");
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  queueRef.current = queue;
  onVideoUnavailableRef.current = onVideoUnavailable;
  onPlayerReadyRef.current = onPlayerReady;
  onCurrentEntryChangeRef.current = onCurrentEntryChange;
  onExternalRangeCompleteRef.current = onExternalRangeComplete;
  onExternalErrorRef.current = onExternalError;
  onPlaybackProgressRef.current = onPlaybackProgress;
  onPlaybackStatusChangeRef.current = onPlaybackStatusChange;
  onPlaybackRangeChangeRef.current = onPlaybackRangeChange;
  const currentEntry = queue[currentIndex] ?? null;
  const queueIdentity = useMemo(
    () => queue.map((entry) => `${entry.entryKey}:${entry.videoId}:${entry.playbackRanges.map(({ startSeconds, endSeconds }) => `${startSeconds ?? 0}-${endSeconds ?? ""}`).join(",")}`).join("|"),
    [queue],
  );

  const setCurrentQueueIndex = (index: number) => {
    currentIndexRef.current = index;
    setCurrentIndex(index);
  };

  useEffect(() => {
    const entry = queue[currentIndex];
    if (entry) onCurrentEntryChangeRef.current?.(entry.entryKey);
  }, [currentIndex, queue]);

  const loadEntry = useCallback((index: number, play: boolean, rangeIndex = 0, startSeconds?: number) => {
    const entry = queueRef.current[index];
    if (!entry || failedKeysRef.current.has(entry.entryKey)) return;
    setCurrentQueueIndex(index);
    setMessage("");
    shouldPlayRef.current = play;
    activeRangeIndexRef.current = rangeIndex;
    activeEntryKeyRef.current = entry.entryKey;
    onPlaybackRangeChangeRef.current?.(entry.entryKey, rangeIndex);
    canResumeRef.current = false;
    const player = playerRef.current;
    if (!player || !playerReadyRef.current) return;
    const range = entry.playbackRanges[rangeIndex] ?? {};
    const playbackStart = startSeconds ?? range.startSeconds;
    const request: YouTubeVideoRequest = {
      videoId: entry.videoId,
      ...(playbackStart === undefined ? {} : { startSeconds: playbackStart }),
      ...(range.endSeconds === undefined ? {} : { endSeconds: range.endSeconds }),
    };
    cuedStartSecondsRef.current = play ? null : (request.startSeconds ?? 0);
    setPosition(request.startSeconds ?? 0);
    setDuration(0);
    loadedPlaybackIdentityRef.current = getPlaybackIdentity(entry, rangeIndex);
    if (play) player.loadVideoById(request);
    else player.cueVideoById(request);
  }, []);

  const advanceAfterRange = useCallback(() => {
    if (rangeTransitioningRef.current) return;
    const current = queueRef.current[currentIndexRef.current];
    if (!current) return;
    rangeTransitioningRef.current = true;
    const nextRangeIndex = activeRangeIndexRef.current + 1;
    if (nextRangeIndex < current.playbackRanges.length) {
      loadEntry(currentIndexRef.current, true, nextRangeIndex);
      return;
    }
    const nextIndex = findAvailablePlaylistIndex(
      queueRef.current,
      failedKeysRef.current,
      currentIndexRef.current + 1,
      1,
    );
    if (nextIndex === null) {
      shouldPlayRef.current = false;
      playerRef.current?.stopVideo();
      setIsPlaying(false);
      if (externalPlayback) onExternalRangeCompleteRef.current?.(current.entryKey);
      else setMessage("Playlist finished");
    } else {
      loadEntry(nextIndex, true);
    }
  }, [externalPlayback, loadEntry]);

  const playAll = useCallback(() => {
    const firstIndex = findAvailablePlaylistIndex(queueRef.current, failedKeysRef.current, 0, 1);
    if (firstIndex === null) return;
    loadEntry(firstIndex, true);
  }, [loadEntry]);

  const playEntry = useCallback((entryKey: string) => {
    const index = queueRef.current.findIndex((entry) => entry.entryKey === entryKey);
    if (index >= 0) loadEntry(index, true);
  }, [loadEntry]);

  const pause = useCallback(() => {
    shouldPlayRef.current = false;
    playerRef.current?.pauseVideo();
  }, []);
  const resume = useCallback(() => {
    shouldPlayRef.current = true;
    if (canResumeRef.current && cuedStartSecondsRef.current === null) playerRef.current?.playVideo();
    else if (queueRef.current[currentIndexRef.current]) {
      loadEntry(currentIndexRef.current, true, activeRangeIndexRef.current, cuedStartSecondsRef.current ?? undefined);
    }
  }, [loadEntry]);
  const seekTo = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds, true);
    setPosition(seconds);
  }, []);
  const seekToPlaybackPosition = useCallback((seconds: number) => {
    const entry = queueRef.current[currentIndexRef.current];
    const player = playerRef.current;
    if (!entry || !player) return;
    let remaining = Math.max(0, seconds);
    const fullDuration = player.getDuration();
    for (let index = 0; index < entry.playbackRanges.length; index += 1) {
      const range = entry.playbackRanges[index];
      const start = range.startSeconds ?? 0;
      const end = range.endSeconds ?? fullDuration;
      const rangeDuration = Math.max(0, end - start);
      if (remaining <= rangeDuration || index === entry.playbackRanges.length - 1) {
        const target = start + Math.min(remaining, rangeDuration);
        if (index === activeRangeIndexRef.current &&
          (shouldPlayRef.current || (canResumeRef.current && cuedStartSecondsRef.current === null))) {
          player.seekTo(target, true);
          setPosition(target);
        } else {
          // seekTo from CUED starts playback. Cue the chosen offset directly
          // while paused, including another scrub within the newly cued range.
          loadEntry(currentIndexRef.current, shouldPlayRef.current, index, target);
        }
        return;
      }
      remaining -= rangeDuration;
    }
  }, [loadEntry]);
  const setVolume = useCallback((volume: number) => {
    playerRef.current?.setVolume(volume);
  }, []);
  const stop = useCallback(() => {
    shouldPlayRef.current = false;
    canResumeRef.current = false;
    playerRef.current?.stopVideo();
    setIsPlaying(false);
  }, []);

  useImperativeHandle(ref, () => ({ playAll, playEntry, pause, resume, seekTo, seekToPlaybackPosition, setVolume, stop }), [playAll, pause, playEntry, resume, seekTo, seekToPlaybackPosition, setVolume, stop]);

  useEffect(() => {
    const currentKeys = new Set(queue.map((entry) => entry.entryKey));
    const nextFailed = new Set(
      Array.from(failedKeysRef.current).filter((key) => currentKeys.has(key)),
    );
    failedKeysRef.current = nextFailed;
    if (currentIndexRef.current >= queue.length) {
      setCurrentQueueIndex(Math.max(0, queue.length - 1));
    }
    const current = queue[currentIndexRef.current];
    if (current?.entryKey === autoPlayEntryKey) shouldPlayRef.current = true;
    const activeRangeIndex = current?.entryKey === activeEntryKeyRef.current
      ? activeRangeIndexRef.current
      : 0;
    if (current && loadedPlaybackIdentityRef.current !== getPlaybackIdentity(current, activeRangeIndex)) {
      if (current.entryKey === autoPlayEntryKey) {
        loadEntry(currentIndexRef.current, true, activeRangeIndex);
      } else if (playerReadyRef.current) {
        loadEntry(currentIndexRef.current, false, activeRangeIndex);
      }
    }
  }, [autoPlayEntryKey, loadEntry, queue, queueIdentity]);

  useEffect(() => {
    let cancelled = false;
    void loadYouTubeIframeApi()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        const player = new api.Player(containerRef.current, {
          playerVars: {
            autoplay: 0,
            controls: 1,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
          },
          events: {
            onReady: () => {
              playerReadyRef.current = true;
              onPlayerReadyRef.current?.();
              const currentIndex = currentIndexRef.current;
              if (queueRef.current[currentIndex]) {
                loadEntry(currentIndex, shouldPlayRef.current, activeRangeIndexRef.current);
              }
            },
            onStateChange: (event) => {
              if (event.data === 1) {
                shouldPlayRef.current = true;
                rangeTransitioningRef.current = false;
                canResumeRef.current = true;
                setIsPlaying(true);
                onPlaybackStatusChangeRef.current?.(activeEntryKeyRef.current, true);
                setMessage("");
              } else if (event.data === 2) {
                shouldPlayRef.current = false;
                canResumeRef.current = true;
                setIsPlaying(false);
                onPlaybackStatusChangeRef.current?.(activeEntryKeyRef.current, false);
              } else if (event.data === 5 && !shouldPlayRef.current) {
                canResumeRef.current = false;
                rangeTransitioningRef.current = false;
                setIsPlaying(false);
                onPlaybackStatusChangeRef.current?.(activeEntryKeyRef.current, false);
              } else if (event.data === 0) {
                canResumeRef.current = false;
                advanceAfterRange();
              }
            },
            onError: () => {
              const entry = queueRef.current[currentIndexRef.current];
              if (!entry) return;
              if (externalPlayback) {
                shouldPlayRef.current = false;
                canResumeRef.current = false;
                playerRef.current?.stopVideo();
                setIsPlaying(false);
                onPlaybackStatusChangeRef.current?.(entry.entryKey, false);
                onExternalErrorRef.current?.(entry.entryKey);
                return;
              }
              const nextFailed = new Set(failedKeysRef.current);
              nextFailed.add(entry.entryKey);
              failedKeysRef.current = nextFailed;
              setIsPlaying(false);
              setMessage("This video is unavailable or cannot be embedded. Skipping it.");
              onVideoUnavailableRef.current?.(entry);
              const nextIndex = findAvailablePlaylistIndex(
                queueRef.current,
                nextFailed,
                currentIndexRef.current + 1,
                1,
              );
              if (nextIndex !== null) loadEntry(nextIndex, true);
            },
          },
        });
        playerRef.current = player;
      })
      .catch(() => {
        if (cancelled) return;
        setMessage("The YouTube player could not load. Try again.");
        if (externalPlayback) {
          const entry = queueRef.current[currentIndexRef.current];
          if (entry) onExternalErrorRef.current?.(entry.entryKey);
        }
      });

    return () => {
      cancelled = true;
      playerReadyRef.current = false;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [advanceAfterRange, externalPlayback, loadEntry]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const currentTime = player.getCurrentTime();
      const currentDuration = player.getDuration();
      setPosition(currentTime);
      setDuration(currentDuration);
      const entry = queueRef.current[currentIndexRef.current];
      const range = entry?.playbackRanges[activeRangeIndexRef.current];
      if (entry && range) {
        const rangeStart = range.startSeconds ?? 0;
        const effectivePosition = entry.playbackRanges
          .slice(0, activeRangeIndexRef.current)
          .reduce((total, previousRange) => {
            const end = previousRange.endSeconds ?? currentDuration;
            return total + Math.max(0, end - (previousRange.startSeconds ?? 0));
          }, 0) + Math.max(0, currentTime - rangeStart);
        const effectiveDuration = entry.durationSeconds ?? entry.playbackRanges.reduce((total, currentRange) => {
          const end = currentRange.endSeconds ?? currentDuration;
          return total + Math.max(0, end - (currentRange.startSeconds ?? 0));
        }, 0);
        onPlaybackProgressRef.current?.(entry.entryKey, effectivePosition, effectiveDuration);
      }
      if (range?.endSeconds !== undefined && currentTime >= range.endSeconds) {
        advanceAfterRange();
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [advanceAfterRange, isPlaying]);

  const togglePlayback = () => {
    const player = playerRef.current;
    if (!player || !currentEntry) return;
    if (isPlaying) {
      pause();
      return;
    }
    resume();
  };

  const previous = () => {
    const previousIndex = findAvailablePlaylistIndex(
      queueRef.current,
      failedKeysRef.current,
      currentIndexRef.current - 1,
      -1,
    );
    if (previousIndex === null) {
      loadEntry(currentIndexRef.current, true);
      return;
    }
    loadEntry(previousIndex, true);
  };

  const next = () => {
    const nextIndex = findAvailablePlaylistIndex(
      queueRef.current,
      failedKeysRef.current,
      currentIndexRef.current + 1,
      1,
    );
    if (nextIndex === null) {
      shouldPlayRef.current = false;
      playerRef.current?.stopVideo();
      setIsPlaying(false);
      return;
    }
    loadEntry(nextIndex, true);
  };

  if (!queue.length && !externalPlayback) return null;

  const isPreview = mode === "preview";

  return (
    <section
      className="border-b border-gray-700 bg-gray-900/70 p-3"
      aria-label={isPreview ? "YouTube video preview" : "YouTube rehearsal player"}
    >
      <div
        data-testid="youtube-player-layout"
        className={cn(
          "grid gap-3",
          isPreview ? "grid-cols-1" : "sm:grid-cols-[minmax(0,18rem)_1fr]",
        )}
      >
        <div className={cn("aspect-video overflow-hidden rounded bg-black", externalPlayback && "min-h-32")}>
          <div ref={containerRef} className="h-full w-full" aria-label="YouTube player" />
        </div>
        {!externalPlayback ? <div className="flex min-w-0 flex-col justify-between gap-2">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                {isPreview ? "Preview" : "REHEARSAL PLAYLIST"}
              </p>
              <p className="truncate text-sm font-semibold text-white">{currentEntry?.title || "No song selected"}</p>
              {currentEntry?.artist ? <p className="truncate text-xs text-gray-400">{currentEntry.artist}</p> : null}
              {duration > 0 ? (
                <p className="mt-1 text-xs tabular-nums text-gray-400">
                  {formatYouTubeDuration(position)} / {formatYouTubeDuration(duration)}
                </p>
              ) : null}
            </div>
            {isPreview ? previewAction : null}
          </div>
          {!isPreview ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button type="button" variant="cta" svg={Play} padding="px-2 py-1" className="text-xs max-md:min-h-0" onClick={playAll}>
                Play All
              </Button>
              <Button type="button" variant="tertiary" svg={ChevronLeft} padding="px-2 py-1" className="text-xs max-md:min-h-0" aria-label="Previous video" onClick={previous} />
              <Button type="button" variant="tertiary" svg={isPlaying ? Pause : Play} padding="px-2 py-1" className="text-xs max-md:min-h-0" aria-label={isPlaying ? "Pause video" : "Play video"} onClick={togglePlayback} />
              <Button type="button" variant="tertiary" svg={ChevronRight} padding="px-2 py-1" className="text-xs max-md:min-h-0" aria-label="Next video" onClick={next} />
            </div>
          ) : null}
          {message ? <p className="text-xs text-amber-200" role="status">{message}</p> : null}
        </div> : null}
      </div>
    </section>
  );
});

YouTubePlaylistPlayer.displayName = "YouTubePlaylistPlayer";

export default YouTubePlaylistPlayer;
