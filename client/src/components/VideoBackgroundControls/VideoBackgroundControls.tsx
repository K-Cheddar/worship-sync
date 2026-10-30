import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Info, Pause, Play, Repeat, SkipBack, Square } from "lucide-react";
import Button from "../Button/Button";
import Toggle from "../Toggle/Toggle";
import SegmentedControl from "../SegmentedControl/SegmentedControl";
import { Slider } from "../ui/Slider";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import type { MediaType, VideoBackgroundSendMode } from "../../types";
import {
  applyVideoBackgroundTransport,
  buildVideoPlaybackCue,
  formatVideoClock,
  getVideoPreviewSnapshot,
  logVideoCue,
  isVideoPlaybackComplete,
  resolveVideoPlaybackPosition,
  resolveSyncedVideoPlayback,
  subscribeVideoPreviewSnapshot,
} from "../../utils/videoBackgroundPlayback";
import { useDispatch, useSelector } from "../../hooks";
import { updateVideoPlayback } from "../../store/presentationSlice";
import { RootState } from "../../store/store";
import { cn } from "../../utils/cnHelper";

type VideoBackgroundControlsProps = {
  media: MediaType;
  mediaKey: string;
  /** Transmitting outputs showing this slide; controls sync to them when set. */
  syncOutputIds?: string[];
  /** Send mode of the slide these controls belong to. */
  sendMode: VideoBackgroundSendMode;
  onSendModeChange: (mode: VideoBackgroundSendMode) => void;
  loop: boolean;
  onLoopChange: (loop: boolean) => void;
  showSendMode?: boolean;
  className?: string;
};

// "Start over" rather than "Restart": the transport row now has a Restart
// button that acts immediately, and two controls reading "Restart" side by
// side is exactly the confusion this label is here to avoid.
const SEND_MODE_OPTIONS: { value: VideoBackgroundSendMode; label: string }[] = [
  { value: "continue", label: "Continue" },
  { value: "restart", label: "Start over" },
];

const VideoBackgroundControls = ({
  media,
  mediaKey,
  syncOutputIds = [],
  sendMode,
  onSendModeChange,
  loop,
  onLoopChange,
  showSendMode = true,
  className,
}: VideoBackgroundControlsProps) => {
  const dispatch = useDispatch();
  const subscribeToMedia = useCallback(
    (listener: (next: ReturnType<typeof getVideoPreviewSnapshot>) => void) =>
      subscribeVideoPreviewSnapshot(mediaKey, listener),
    [mediaKey],
  );
  const getMediaSnapshot = useCallback(
    () => getVideoPreviewSnapshot(mediaKey),
    [mediaKey],
  );
  const snapshot = useSyncExternalStore(
    subscribeToMedia,
    getMediaSnapshot,
    getMediaSnapshot,
  );
  const syncedCue = useSelector((state: RootState) =>
    resolveSyncedVideoPlayback(state.presentation.outputs, mediaKey, syncOutputIds),
  );
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubSeconds, setScrubSeconds] = useState(0);
  const [liveClockTick, setLiveClockTick] = useState(0);

  const syncLive = syncOutputIds.length > 0;
  const measuredDuration =
    Number.isFinite(snapshot.duration) && snapshot.duration > 0
      ? snapshot.duration
      : 0;
  const metadataDuration =
    typeof media.duration === "number" &&
    Number.isFinite(media.duration) &&
    media.duration > 0
      ? media.duration
      : 0;
  const duration = measuredDuration || metadataDuration;

  // Live cues carry a timestamp rather than a ticking playhead, so the clock
  // has to advance itself. Off-air the preview element reports its own
  // playhead and this timer would only cost redundant renders.
  const liveCue = syncLive ? syncedCue : undefined;

  useEffect(() => {
    if (!liveCue || liveCue.paused || isScrubbing) return;
    const id = window.setInterval(() => {
      setLiveClockTick((tick) => tick + 1);
    }, 250);
    return () => window.clearInterval(id);
  }, [liveCue, isScrubbing]);

  const transportPosition = useMemo(() => {
    void liveClockTick;
    if (liveCue) return resolveVideoPlaybackPosition(liveCue, duration);
    return snapshot.currentTime;
  }, [duration, liveClockTick, liveCue, snapshot.currentTime]);

  const displaySeconds = isScrubbing ? scrubSeconds : transportPosition;
  const canSeek = duration > 0;
  const sliderMax = canSeek ? duration : 1;
  const isFinished = isVideoPlaybackComplete(liveCue?.loop ?? loop, transportPosition, duration);
  const isPaused = isFinished || (liveCue?.paused ?? snapshot.paused);
  const [smoothProgress, setSmoothProgress] = useState(false);
  const previousTimelineSample = useRef<{
    mediaKey: string;
    position: number;
    generation?: number;
  } | undefined>(undefined);

  // Animate the slider between measured samples without increasing playback
  // reports or React's render rate. Select the CSS transition before paint so
  // seeks, loop wraps, pauses, and a different clip take effect immediately.
  useLayoutEffect(() => {
    const previous = previousTimelineSample.current;
    const advance = previous ? displaySeconds - previous.position : 0;
    const explicitSeek = liveCue?.applySeek &&
      liveCue.generation !== previous?.generation;
    setSmoothProgress(Boolean(
      previous?.mediaKey === mediaKey && !isPaused && !isScrubbing &&
      !explicitSeek && advance > 0 && advance <= 1,
    ));
    previousTimelineSample.current = {
      mediaKey,
      position: displaySeconds,
      generation: liveCue?.generation,
    };
  }, [displaySeconds, isPaused, isScrubbing, liveCue?.applySeek, liveCue?.generation, mediaKey]);

  const pushTransport = (
    positionSeconds: number,
    paused: boolean,
    applySeek: boolean,
  ) => {
    if (applySeek) {
      previousTimelineSample.current = undefined;
      setSmoothProgress(false);
    }
    const cue = applyVideoBackgroundTransport(
      {
        mediaKey,
        positionSeconds,
        paused,
        applySeek,
        loop,
      },
      { emitPreviewCommands: !syncLive },
    );
    logVideoCue("controls.push", {
      syncLive,
      syncOutputIds,
      positionSeconds,
      paused,
      applySeek,
      generation: cue.generation,
      mediaKey: cue.mediaKey,
    });
    if (syncLive) {
      dispatch(
        updateVideoPlayback({
          videoPlayback: cue,
          outputIds: syncOutputIds,
        }),
      );
    }
  };

  const sendModeHint = useMemo(() => {
    const onSend =
      sendMode === "restart"
        ? "Sending this slide starts the video from the beginning."
        : "Sending this slide keeps the video playing from where it is now.";
    return syncLive
      ? `${onSend} Controls update the preview and live outputs together.`
      : onSend;
  }, [sendMode, syncLive]);

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md border border-white/12 bg-black/40 px-2 py-1.5",
        className,
      )}
      data-testid="video-background-controls"
    >
      <div className="flex min-w-0 items-center gap-2 max-md:gap-1">
        <Button
          type="button"
          variant="tertiary"
          svg={isPaused ? Play : Pause}
          aria-label={isPaused ? "Play video" : "Pause video"}
          title={isPaused ? "Play" : "Pause"}
          onClick={() => {
            pushTransport(isFinished ? 0 : transportPosition, !isPaused, isFinished);
          }}
        />
        <Button
          type="button"
          variant="tertiary"
          svg={SkipBack}
          aria-label="Restart video from the beginning"
          title="Restart from the beginning"
          onClick={() => {
            pushTransport(0, false, true);
          }}
        />
        <Button
          type="button"
          variant="tertiary"
          svg={Square}
          aria-label="Stop video"
          title="Stop (pause at the beginning)"
          onClick={() => {
            pushTransport(0, true, true);
          }}
        />
        <span className="w-[4.5rem] max-md:w-10 shrink-0 text-center text-xs tabular-nums text-gray-300">
          {formatVideoClock(displaySeconds)}
        </span>
        <Slider
          aria-label="Video timeline"
          data-smooth-progress={smoothProgress && !isPaused && !isScrubbing}
          min={0}
          max={sliderMax}
          step={0.1}
          disabled={!canSeek}
          value={[Math.min(displaySeconds, sliderMax)]}
          onValueChange={([value]) => {
            setIsScrubbing(true);
            setScrubSeconds(value);
          }}
          onValueCommit={([value]) => {
            pushTransport(value, isPaused, true);
            setIsScrubbing(false);
          }}
          onKeyUp={() => {
            // Radix can report a keyboard change after its commit callback.
            setIsScrubbing(false);
          }}
          className="min-w-0 flex-1 data-[smooth-progress=true]:[&_[data-slot=slider-range]]:transition-[left,right] data-[smooth-progress=true]:[&_[data-slot=slider-range]]:duration-250 data-[smooth-progress=true]:[&_[data-slot=slider-range]]:ease-linear data-[smooth-progress=true]:[&>span:has(>[data-slot=slider-thumb])]:transition-[left] data-[smooth-progress=true]:[&>span:has(>[data-slot=slider-thumb])]:duration-250 data-[smooth-progress=true]:[&>span:has(>[data-slot=slider-thumb])]:ease-linear"
        />
        <span className="w-[4.5rem] max-md:w-10 shrink-0 text-center text-xs tabular-nums text-gray-400">
          {formatVideoClock(duration)}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-1">
        <Toggle
          label="Loop"
          icon={Repeat}
          value={loop}
          className="shrink-0"
          labelClassName="text-xs"
          onChange={(nextLoop) => {
            onLoopChange(nextLoop);
            if (!liveCue) return;
            // Rebase with the old loop policy before changing it: a clip that
            // has wrapped must keep its current frame when looping is disabled.
            dispatch(updateVideoPlayback({
              videoPlayback: buildVideoPlaybackCue({
                mediaKey,
                positionSeconds: transportPosition,
                paused: isPaused,
                applySeek: false,
                loop: nextLoop,
              }),
              outputIds: syncOutputIds,
            }));
          }}
        />
      {showSendMode ? <>
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-gray-300">
          On send
        </span>
        <SegmentedControl
          ariaLabel="What the video does when this slide is sent"
          variant="compact"
          value={sendMode}
          onChange={onSendModeChange}
          options={SEND_MODE_OPTIONS}
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="tertiary" svg={Info} aria-label="About video send behavior" className="md:hidden shrink-0" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 max-w-[calc(100vw-2rem)] text-xs">{sendModeHint}</PopoverContent>
        </Popover>
        <p className="hidden md:block min-w-0 flex-1 text-[11px] leading-snug text-gray-400">
          {sendModeHint}
        </p>
      </> : null}
      </div>
    </div>
  );
};

export default VideoBackgroundControls;
