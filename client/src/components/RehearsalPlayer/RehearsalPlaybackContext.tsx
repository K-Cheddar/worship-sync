import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { getSongAudioUrl } from "../../api/auth";
import type { YouTubePlaylistPlayerHandle } from "../YouTubePlaylistPlayer/YouTubePlaylistPlayer";
import type { YouTubePlaylistEntry } from "../YouTubePlaylistPlayer/youtubePlaylist";
import { GlobalInfoContext } from "../../context/globalInfo";
import type { RehearsalPlaybackEntry } from "./rehearsalPlaybackQueue";

type PlayerState = {
  queue: RehearsalPlaybackEntry[];
  index: number;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  currentRangeIndex: number | null;
  durationByEntryKey: Record<string, number>;
  volume: number;
  isMuted: boolean;
  error: string;
  playVersion: number;
};

type RehearsalPlaybackContextValue = PlayerState & {
  currentEntry: RehearsalPlaybackEntry | null;
  playEntry: (queue: RehearsalPlaybackEntry[], entryKey: string) => void;
  playQueue: (queue: RehearsalPlaybackEntry[], entryKey?: string) => void;
  togglePlayback: () => void;
  previous: () => void;
  next: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  stop: () => void;
  closeRequested: () => void;
  attachYouTubeEngine: (engine: YouTubePlaylistPlayerHandle | null) => void;
  attachAudioElement: (audio: HTMLAudioElement | null) => void;
  reportYouTubeProgress: (entryKey: string, position: number, duration: number) => void;
  reportYouTubeStatus: (entryKey: string, isPlaying: boolean) => void;
  reportYouTubeRangeChange: (entryKey: string, rangeIndex: number) => void;
  reportYouTubeEnded: (entryKey: string) => void;
  reportYouTubeError: (entryKey: string) => void;
};

type RehearsalPlaybackControllerValue = Omit<RehearsalPlaybackContextValue, "currentTime" | "duration">;

const emptyState: PlayerState = {
  queue: [],
  index: -1,
  isPlaying: false,
  isLoading: false,
  currentTime: 0,
  duration: 0,
  currentRangeIndex: null,
  durationByEntryKey: {},
  volume: 0.8,
  isMuted: false,
  error: "",
  playVersion: 0,
};

export const RehearsalPlaybackContext = createContext<RehearsalPlaybackContextValue | null>(null);
const RehearsalPlaybackControllerContext = createContext<RehearsalPlaybackControllerValue | null>(null);

const toYouTubeEntry = (entry: RehearsalPlaybackEntry): YouTubePlaylistEntry => {
  if (entry.source.kind !== "youtube") throw new Error("A YouTube source is required.");
  return {
    entryKey: entry.entryKey,
    songId: entry.songId,
    title: entry.title,
    artist: entry.artist ?? "",
    videoId: entry.source.videoId,
    playbackRanges: entry.source.ranges,
    ...(entry.source.durationSeconds === undefined ? {} : { durationSeconds: entry.source.durationSeconds }),
  };
};

export const RehearsalPlaybackProvider = ({ children }: { children: ReactNode }) => {
  const globalInfo = useContext(GlobalInfoContext);
  const youtubeRef = useRef<YouTubePlaylistPlayerHandle | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestRef = useRef(0);
  const startedPlayVersionRef = useRef(0);
  const sessionIdentityRef = useRef<string | null>(null);
  const activeAudioUrlRef = useRef("");
  const [state, setState] = useState<PlayerState>(emptyState);
  const currentEntry = state.queue[state.index] ?? null;
  const volumeRef = useRef(state.volume);
  const mutedRef = useRef(state.isMuted);
  volumeRef.current = state.volume;
  mutedRef.current = state.isMuted;

  const attachYouTubeEngine = useCallback((engine: YouTubePlaylistPlayerHandle | null) => {
    youtubeRef.current = engine;
  }, []);
  const attachAudioElement = useCallback((audio: HTMLAudioElement | null) => {
    audioRef.current = audio;
  }, []);

  const stopEngines = useCallback(() => {
    youtubeRef.current?.stop();
    activeAudioUrlRef.current = "";
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
  }, []);

  const stop = useCallback(() => {
    requestRef.current += 1;
    stopEngines();
    setState(emptyState);
  }, [stopEngines]);
  const closeRequested = useCallback(() => {
    requestRef.current += 1;
    stopEngines();
    setState((current) => ({ ...current, isPlaying: false, isLoading: false }));
  }, [stopEngines]);

  const playQueue = useCallback((queue: RehearsalPlaybackEntry[], entryKey?: string) => {
    if (!queue.length) return;
    const index = Math.max(0, queue.findIndex((entry) => entry.entryKey === entryKey));
    requestRef.current += 1;
    startedPlayVersionRef.current = 0;
    stopEngines();
    setState((current) => ({
      ...current,
      queue,
      index,
      isPlaying: false,
      isLoading: true,
      currentTime: 0,
      duration: queue[index].source.durationSeconds ?? 0,
      currentRangeIndex: null,
      durationByEntryKey: {},
      error: "",
      playVersion: current.playVersion + 1,
    }));
  }, [stopEngines]);

  const playEntry = useCallback((queue: RehearsalPlaybackEntry[], entryKey: string) => {
    playQueue(queue, entryKey);
  }, [playQueue]);

  const startEntry = useCallback(async () => {
    const entry = state.queue[state.index];
    if (!entry) return;
    const requestId = ++requestRef.current;
    stopEngines();
    setState((current) => ({ ...current, isLoading: true, isPlaying: false, error: "", currentTime: 0, duration: entry.source.durationSeconds ?? 0, currentRangeIndex: entry.source.kind === "youtube" ? 0 : null }));
    if (entry.source.kind === "youtube") {
      return;
    }
    if (!globalInfo?.churchId) {
      setState((current) => ({ ...current, isLoading: false, error: "Sign in to play this audio." }));
      return;
    }
    try {
      const result = await getSongAudioUrl({
        churchId: globalInfo.churchId,
        songId: entry.songId,
        audio: entry.source.audio,
        disposition: "inline",
      });
      if (requestRef.current !== requestId) return;
      const audio = audioRef.current;
      if (!audio) throw new Error("The audio player is unavailable. Try again.");
      activeAudioUrlRef.current = result.url;
      audio.src = result.url;
      audio.volume = mutedRef.current ? 0 : volumeRef.current;
      await audio.play();
      if (requestRef.current !== requestId) {
        audio.pause();
        return;
      }
      setState((current) => ({ ...current, isLoading: false, isPlaying: true, error: "" }));
    } catch (error) {
      if (requestRef.current !== requestId) return;
      activeAudioUrlRef.current = "";
      const message = error instanceof Error ? error.message : "The MP3 could not be played. Try again.";
      setState((current) => ({ ...current, isLoading: false, isPlaying: false, error: message }));
    }
  }, [globalInfo?.churchId, state.index, state.queue, stopEngines]);

  useEffect(() => {
    if (state.playVersion > 0 && startedPlayVersionRef.current !== state.playVersion) {
      startedPlayVersionRef.current = state.playVersion;
      void startEntry();
    }
  }, [startEntry, state.playVersion]);

  const changeIndex = useCallback((direction: 1 | -1) => {
    requestRef.current += 1;
    stopEngines();
    setState((current) => {
      if (!current.queue.length) return current;
      const nextIndex = current.index + direction;
      if (nextIndex < 0 || nextIndex >= current.queue.length) {
        if (direction > 0) return { ...emptyState, volume: current.volume, isMuted: current.isMuted };
        return { ...current, playVersion: current.playVersion + 1, isLoading: true, isPlaying: false, currentTime: 0, error: "", currentRangeIndex: null };
      }
      return { ...current, index: nextIndex, playVersion: current.playVersion + 1, isLoading: true, isPlaying: false, currentTime: 0, duration: current.queue[nextIndex].source.durationSeconds ?? 0, error: "", currentRangeIndex: null };
    });
  }, [stopEngines]);
  const previous = useCallback(() => changeIndex(-1), [changeIndex]);
  const next = useCallback(() => {
    if (state.queue.length && state.index >= state.queue.length - 1) {
      stop();
      return;
    }
    changeIndex(1);
  }, [changeIndex, state.index, state.queue.length, stop]);

  const togglePlayback = useCallback(() => {
    if (!currentEntry || state.isLoading) return;
    if (state.isPlaying) {
      youtubeRef.current?.pause();
      audioRef.current?.pause();
      setState((current) => ({ ...current, isPlaying: false }));
      return;
    }
    const audio = audioRef.current;
    if (currentEntry.source.kind === "audio" && audio?.src && audio.src === activeAudioUrlRef.current) {
      const entryKey = currentEntry.entryKey;
      const requestId = ++requestRef.current;
      setState((current) => ({ ...current, isLoading: true }));
      void audio.play().then(() => {
        if (requestRef.current !== requestId) {
          audio.pause();
          return;
        }
        setState((current) => current.queue[current.index]?.entryKey === entryKey
          ? { ...current, isLoading: false, isPlaying: true, error: "" }
          : current);
      }).catch(() => {
        if (requestRef.current !== requestId) return;
        activeAudioUrlRef.current = "";
        setState((current) => current.queue[current.index]?.entryKey === entryKey
          ? { ...current, isLoading: false, isPlaying: false, error: "The MP3 could not be played. Try again." }
          : current);
      });
      return;
    }
    if (currentEntry.source.kind === "youtube") {
      youtubeRef.current?.resume();
      setState((current) => ({ ...current, isLoading: false, isPlaying: true, error: "" }));
      return;
    }
    requestRef.current += 1;
    setState((current) => ({ ...current, playVersion: current.playVersion + 1 }));
  }, [currentEntry, state.isLoading, state.isPlaying]);

  const seek = useCallback((seconds: number) => {
    const position = Math.max(0, Math.min(seconds, state.duration || seconds));
    if (currentEntry?.source.kind === "youtube") youtubeRef.current?.seekToPlaybackPosition(position);
    else if (audioRef.current) audioRef.current.currentTime = position;
    setState((current) => ({ ...current, currentTime: position }));
  }, [currentEntry, state.duration]);

  const setVolume = useCallback((volume: number) => {
    const nextVolume = Math.max(0, Math.min(1, volume));
    youtubeRef.current?.setVolume(state.isMuted ? 0 : Math.round(nextVolume * 100));
    if (audioRef.current) audioRef.current.volume = state.isMuted ? 0 : nextVolume;
    setState((current) => ({ ...current, volume: nextVolume }));
  }, [state.isMuted]);

  const toggleMute = useCallback(() => {
    const isMuted = !state.isMuted;
    youtubeRef.current?.setVolume(isMuted ? 0 : Math.round(volumeRef.current * 100));
    if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volumeRef.current;
    mutedRef.current = isMuted;
    setState((current) => ({ ...current, isMuted }));
  }, [state.isMuted]);

  const reportYouTubeProgress = useCallback((entryKey: string, position: number, duration: number) => {
    setState((current) => {
      const entry = current.queue[current.index];
      if (entry?.entryKey !== entryKey || entry.source.kind !== "youtube") return current;
      return { ...current, currentTime: position, duration: entry.source.durationSeconds ?? duration };
    });
  }, []);
  const reportYouTubeStatus = useCallback((entryKey: string, isPlaying: boolean) => {
    setState((current) => current.queue[current.index]?.entryKey === entryKey
      ? { ...current, isPlaying, isLoading: false }
      : current);
  }, []);
  const reportYouTubeRangeChange = useCallback((entryKey: string, rangeIndex: number) => {
    setState((current) => current.queue[current.index]?.entryKey === entryKey
      ? { ...current, currentRangeIndex: rangeIndex }
      : current);
  }, []);
  const reportYouTubeEnded = useCallback((entryKey: string) => {
    if (state.queue[state.index]?.entryKey === entryKey) next();
  }, [next, state.index, state.queue]);
  const reportYouTubeError = useCallback((entryKey: string) => {
    if (state.queue[state.index]?.entryKey === entryKey) {
      setState((current) => ({ ...current, isLoading: false, isPlaying: false, error: "This video is unavailable or cannot be embedded." }));
    }
  }, [state.index, state.queue]);

  const handleAudioTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !activeAudioUrlRef.current || audio.src !== activeAudioUrlRef.current) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : undefined;
    setState((current) => {
      const entry = current.queue[current.index];
      if (entry?.source.kind !== "audio") return current;
      const durationByEntryKey = entry?.source.kind === "audio" && duration && current.durationByEntryKey[entry.entryKey] !== duration
        ? { ...current.durationByEntryKey, [entry.entryKey]: duration }
        : current.durationByEntryKey;
      const queue = entry?.source.kind === "audio" && duration && entry.source.durationSeconds !== duration
        ? current.queue.map((queueEntry, index) => {
            if (index !== current.index || queueEntry.source.kind !== "audio") return queueEntry;
            return { ...queueEntry, source: { ...queueEntry.source, durationSeconds: duration } };
          })
        : current.queue;
      return {
        ...current,
        queue,
        currentTime: audio.currentTime,
        duration: duration ?? current.duration,
        durationByEntryKey,
      };
    });
  }, []);
  const handleAudioEnded = useCallback(() => next(), [next]);
  const handleAudioError = useCallback(() => {
    if (!activeAudioUrlRef.current) return;
    activeAudioUrlRef.current = "";
    setState((current) => ({ ...current, isLoading: false, isPlaying: false, error: "This MP3 could not be loaded. Try playing it again." }));
  }, []);
  const handleAudioPlay = useCallback(() => setState((current) => {
    const audio = audioRef.current;
    return current.queue[current.index]?.source.kind === "audio" && activeAudioUrlRef.current && audio?.src === activeAudioUrlRef.current
      ? { ...current, isLoading: false, isPlaying: true }
      : current;
  }), []);
  const handleAudioPause = useCallback(() => setState((current) => {
    const audio = audioRef.current;
    return current.queue[current.index]?.source.kind === "audio" && activeAudioUrlRef.current && audio?.src === activeAudioUrlRef.current
      ? { ...current, isPlaying: false }
      : current;
  }), []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.addEventListener("timeupdate", handleAudioTimeUpdate);
    audio.addEventListener("loadedmetadata", handleAudioTimeUpdate);
    audio.addEventListener("ended", handleAudioEnded);
    audio.addEventListener("error", handleAudioError);
    audio.addEventListener("play", handleAudioPlay);
    audio.addEventListener("pause", handleAudioPause);
    return () => {
      audio.removeEventListener("timeupdate", handleAudioTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleAudioTimeUpdate);
      audio.removeEventListener("ended", handleAudioEnded);
      audio.removeEventListener("error", handleAudioError);
      audio.removeEventListener("play", handleAudioPlay);
      audio.removeEventListener("pause", handleAudioPause);
    };
  }, [handleAudioEnded, handleAudioError, handleAudioPause, handleAudioPlay, handleAudioTimeUpdate]);

  useLayoutEffect(() => {
    const identity = `${globalInfo?.loginState ?? ""}:${globalInfo?.sessionKind ?? ""}:${globalInfo?.userId ?? ""}:${globalInfo?.churchId ?? ""}`;
    if (sessionIdentityRef.current !== null && sessionIdentityRef.current !== identity) stop();
    sessionIdentityRef.current = identity;
    if (globalInfo?.loginState !== "success" || !globalInfo.churchId) stop();
  }, [globalInfo?.churchId, globalInfo?.loginState, globalInfo?.sessionKind, globalInfo?.userId, stop]);

  const value = useMemo<RehearsalPlaybackContextValue>(() => ({
    ...state,
    currentEntry,
    playEntry,
    playQueue,
    togglePlayback,
    previous,
    next,
    seek,
    setVolume,
    toggleMute,
    stop,
    closeRequested,
    attachYouTubeEngine,
    attachAudioElement,
    reportYouTubeProgress,
    reportYouTubeStatus,
    reportYouTubeRangeChange,
    reportYouTubeEnded,
    reportYouTubeError,
  }), [attachAudioElement, attachYouTubeEngine, closeRequested, currentEntry, next, playEntry, playQueue, previous, reportYouTubeEnded, reportYouTubeError, reportYouTubeProgress, reportYouTubeRangeChange, reportYouTubeStatus, seek, setVolume, state, stop, toggleMute, togglePlayback]);

  const controllerValue = useMemo<RehearsalPlaybackControllerValue>(() => ({
    queue: state.queue,
    index: state.index,
    isPlaying: state.isPlaying,
    isLoading: state.isLoading,
    volume: state.volume,
    isMuted: state.isMuted,
    error: state.error,
    playVersion: state.playVersion,
    currentRangeIndex: state.currentRangeIndex,
    durationByEntryKey: state.durationByEntryKey,
    currentEntry,
    playEntry,
    playQueue,
    togglePlayback,
    previous,
    next,
    seek,
    setVolume,
    toggleMute,
    stop,
    closeRequested,
    attachYouTubeEngine,
    attachAudioElement,
    reportYouTubeProgress,
    reportYouTubeStatus,
    reportYouTubeRangeChange,
    reportYouTubeEnded,
    reportYouTubeError,
  }), [attachAudioElement, attachYouTubeEngine, closeRequested, currentEntry, next, playEntry, playQueue, previous, reportYouTubeEnded, reportYouTubeError, reportYouTubeProgress, reportYouTubeRangeChange, reportYouTubeStatus, seek, setVolume, state.currentRangeIndex, state.durationByEntryKey, state.error, state.index, state.isLoading, state.isMuted, state.isPlaying, state.playVersion, state.queue, state.volume, stop, toggleMute, togglePlayback]);

  return (
    <RehearsalPlaybackControllerContext.Provider value={controllerValue}>
      <RehearsalPlaybackContext.Provider value={value}>{children}</RehearsalPlaybackContext.Provider>
    </RehearsalPlaybackControllerContext.Provider>
  );
};

export const useRehearsalPlayback = () => {
  const context = useContext(RehearsalPlaybackContext);
  if (!context) throw new Error("useRehearsalPlayback must be used within a RehearsalPlaybackProvider.");
  return context;
};

export const useRehearsalPlaybackController = () => {
  const context = useContext(RehearsalPlaybackControllerContext);
  if (!context) throw new Error("useRehearsalPlaybackController must be used within a RehearsalPlaybackProvider.");
  return context;
};

export const createYouTubeQueueEntry = (entry: RehearsalPlaybackEntry | null) =>
  entry?.source.kind === "youtube" ? toYouTubeEntry(entry) : null;
