import { LoaderCircle, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import type { ReactNode } from "react";

import Button from "../Button/Button";
import FloatingWindow from "../FloatingWindow/FloatingWindow";
import { cn } from "../../utils/cnHelper";
import { formatYouTubeDuration } from "../../utils/youtubeSearch";
import { useRehearsalPlayback } from "./RehearsalPlaybackContext";

const RehearsalPlayerWindow = ({ youtubeEngine }: { youtubeEngine: ReactNode }) => {
  const {
    currentEntry,
    closeRequested,
    currentTime,
    duration,
    error,
    isLoading,
    isMuted,
    isPlaying,
    queue,
    setVolume,
    volume,
    toggleMute,
    togglePlayback,
    previous,
    next,
    seek,
    stop,
  } = useRehearsalPlayback();
  if (!currentEntry) return null;

  const progressDuration = Math.max(duration, currentEntry.source.durationSeconds ?? 0);
  let PlaybackIcon = Play;
  let playbackLabel = "Play rehearsal";
  if (isLoading) {
    PlaybackIcon = LoaderCircle;
    playbackLabel = "Loading rehearsal";
  } else if (isPlaying) {
    PlaybackIcon = Pause;
    playbackLabel = "Pause rehearsal";
  }
  return (
    <FloatingWindow
      title="Rehearsal"
      label="Rehearsal"
      defaultWidth={460}
      defaultHeight={470}
      defaultPosition={{
        x: Math.max(12, window.innerWidth - 484),
        y: Math.max(12, window.innerHeight - 506),
      }}
      onCloseRequested={closeRequested}
      onClose={stop}
      contentClassName="bg-gray-900"
    >
      <div className="flex min-h-0 flex-col gap-3">
        <div className={cn(currentEntry.source.kind !== "youtube" && "hidden")} aria-hidden={currentEntry.source.kind !== "youtube"}>
          {youtubeEngine}
        </div>
        {currentEntry.source.kind === "audio" ? (
          <div className="flex h-28 items-center justify-center rounded bg-gray-800 text-gray-400" aria-label="Audio playback">
            <Volume2 className="size-8" aria-hidden />
          </div>
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-white">{currentEntry.title}</p>
          {currentEntry.artist ? <p className="truncate text-sm text-gray-300">{currentEntry.artist}</p> : null}
          {currentEntry.effectiveKey ? <p className="mt-0.5 text-xs text-gray-400">Key: {currentEntry.effectiveKey}</p> : null}
        </div>
        <div>
          <input
            aria-label="Rehearsal progress"
            type="range"
            min={0}
            max={progressDuration || 0}
            step={1}
            value={Math.min(currentTime, progressDuration || 0)}
            disabled={!progressDuration || isLoading}
            onChange={(event) => seek(Number(event.currentTarget.value))}
            className="w-full accent-cyan-400"
          />
          <div className="flex justify-between text-xs tabular-nums text-gray-400" aria-live="off">
            <span>{formatYouTubeDuration(currentTime)}</span>
            <span>{progressDuration ? formatYouTubeDuration(progressDuration) : "--:--"}</span>
          </div>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button type="button" variant="tertiary" svg={SkipBack} aria-label="Previous song" onClick={previous} />
          <Button
            type="button"
            variant="cta"
            svg={PlaybackIcon}
            className={isLoading ? "animate-pulse" : undefined}
            aria-label={playbackLabel}
            disabled={isLoading}
            onClick={togglePlayback}
          />
          <Button type="button" variant="tertiary" svg={SkipForward} aria-label="Next song" onClick={next} disabled={queue.length < 2} />
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="tertiary" svg={isMuted ? VolumeX : Volume2} aria-label={isMuted ? "Unmute rehearsal" : "Mute rehearsal"} onClick={toggleMute} />
          <input
            aria-label="Rehearsal volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={isMuted ? 0 : volume}
            onChange={(event) => setVolume(Number(event.currentTarget.value))}
            className="min-w-0 flex-1 accent-cyan-400"
          />
        </div>
        {error ? <p role="alert" className="text-sm text-red-300">{error} Try again or choose another song.</p> : null}
      </div>
    </FloatingWindow>
  );
};

export default RehearsalPlayerWindow;
