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
type YouTubePlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  cueVideoById: (videoId: string) => void;
  loadVideoById: (videoId: string) => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  setVolume: (volume: number) => void;
  destroy: () => void;
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
};

type YouTubePlaylistPlayerProps = {
  queue: YouTubePlaylistEntry[];
  mode?: "playlist" | "preview";
  autoPlayEntryKey?: string | null;
  onPlayerReady?: () => void;
  onVideoUnavailable?: (entry: YouTubePlaylistEntry) => void;
  onCurrentEntryChange?: (entryKey: string) => void;
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
    previewAction,
  }: YouTubePlaylistPlayerProps,
  ref: ForwardedRef<YouTubePlaylistPlayerHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const playerReadyRef = useRef(false);
  const loadedVideoIdRef = useRef("");
  const shouldPlayRef = useRef(
    Boolean(autoPlayEntryKey && queue[0]?.entryKey === autoPlayEntryKey),
  );
  const queueRef = useRef(queue);
  const onVideoUnavailableRef = useRef(onVideoUnavailable);
  const onPlayerReadyRef = useRef(onPlayerReady);
  const onCurrentEntryChangeRef = useRef(onCurrentEntryChange);
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
  const currentEntry = queue[currentIndex] ?? null;
  const queueIdentity = useMemo(
    () => queue.map((entry) => `${entry.entryKey}:${entry.videoId}`).join("|"),
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

  const loadEntry = useCallback((index: number, play: boolean) => {
    const entry = queueRef.current[index];
    if (!entry || failedKeysRef.current.has(entry.entryKey)) return;
    setCurrentQueueIndex(index);
    setMessage("");
    shouldPlayRef.current = play;
    const player = playerRef.current;
    if (!player || !playerReadyRef.current) return;
    if (loadedVideoIdRef.current === entry.videoId) {
      if (play) player.playVideo();
      else player.cueVideoById(entry.videoId);
      return;
    }
    loadedVideoIdRef.current = entry.videoId;
    if (play) player.loadVideoById(entry.videoId);
    else player.cueVideoById(entry.videoId);
  }, []);

  const playAll = useCallback(() => {
    const firstIndex = findAvailablePlaylistIndex(queueRef.current, failedKeysRef.current, 0, 1);
    if (firstIndex === null) return;
    loadEntry(firstIndex, true);
  }, [loadEntry]);

  const playEntry = useCallback((entryKey: string) => {
    const index = queueRef.current.findIndex((entry) => entry.entryKey === entryKey);
    if (index >= 0) loadEntry(index, true);
  }, [loadEntry]);

  useImperativeHandle(ref, () => ({ playAll, playEntry }), [playAll, playEntry]);

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
    if (current && loadedVideoIdRef.current !== current.videoId) {
      if (current.entryKey === autoPlayEntryKey) {
        loadEntry(currentIndexRef.current, true);
      } else if (playerReadyRef.current) {
        loadedVideoIdRef.current = current.videoId;
        playerRef.current?.cueVideoById(current.videoId);
      }
    }
  }, [autoPlayEntryKey, loadEntry, queue, queueIdentity]);

  useEffect(() => {
    let cancelled = false;
    void loadYouTubeIframeApi()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        const initialEntry = queueRef.current[0];
        const player = new api.Player(containerRef.current, {
          videoId: initialEntry?.videoId,
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
              loadedVideoIdRef.current = initialEntry?.videoId || "";
              onPlayerReadyRef.current?.();
              if (shouldPlayRef.current) player.playVideo();
            },
            onStateChange: (event) => {
              if (event.data === 1) {
                setIsPlaying(true);
                setMessage("");
              } else if (event.data === 2) {
                setIsPlaying(false);
              } else if (event.data === 0) {
                const nextIndex = findAvailablePlaylistIndex(
                  queueRef.current,
                  failedKeysRef.current,
                  currentIndexRef.current + 1,
                  1,
                );
                if (nextIndex === null) {
                  shouldPlayRef.current = false;
                  setIsPlaying(false);
                  setMessage("Playlist finished");
                } else {
                  loadEntry(nextIndex, true);
                }
              }
            },
            onError: () => {
              const entry = queueRef.current[currentIndexRef.current];
              if (!entry) return;
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
        if (!cancelled) setMessage("The YouTube player could not load. Try again.");
      });

    return () => {
      cancelled = true;
      playerReadyRef.current = false;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [loadEntry, queue.length]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      setPosition(player.getCurrentTime());
      setDuration(player.getDuration());
    }, 500);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  const togglePlayback = () => {
    const player = playerRef.current;
    if (!player || !currentEntry) return;
    if (isPlaying) {
      player.pauseVideo();
      return;
    }
    shouldPlayRef.current = true;
    player.playVideo();
  };

  const previous = () => {
    const previousIndex = findAvailablePlaylistIndex(
      queueRef.current,
      failedKeysRef.current,
      currentIndexRef.current - 1,
      -1,
    );
    if (previousIndex === null) {
      playerRef.current?.seekTo(0, true);
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

  if (!queue.length) return null;

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
        <div className="aspect-video overflow-hidden rounded bg-black">
          <div ref={containerRef} className="h-full w-full" aria-label="YouTube player" />
        </div>
        <div className="flex min-w-0 flex-col justify-between gap-2">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                {isPreview ? "Preview" : "Rehearsal playlist"}
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
        </div>
      </div>
    </section>
  );
});

YouTubePlaylistPlayer.displayName = "YouTubePlaylistPlayer";

export default YouTubePlaylistPlayer;
