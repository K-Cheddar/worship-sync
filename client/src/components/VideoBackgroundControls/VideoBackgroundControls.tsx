import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pause, Play, SkipBack, Square } from "lucide-react";
import Button from "../Button/Button";
import SegmentedControl from "../SegmentedControl/SegmentedControl";
import { Slider } from "../ui/Slider";
import type { MediaType, VideoBackgroundSendMode } from "../../types";
import {
  applyVideoBackgroundTransport,
  formatVideoClock,
  getVideoPreviewSnapshot,
  logVideoCue,
  resolveVideoPlaybackPosition,
  resolveSyncedVideoPlayback,
  subscribeVideoPreviewSnapshot,
} from "../../utils/videoBackgroundPlayback";
import { useDispatch, useSelector } from "../../hooks";
import { updateVideoPlayback } from "../../store/presentationSlice";
import { RootState } from "../../store/store";

type VideoBackgroundControlsProps = {
  media: MediaType;
  mediaKey: string;
  /** Transmitting outputs showing this slide; controls sync to them when set. */
  syncOutputIds?: string[];
  /** Send mode of the slide these controls belong to. */
  sendMode: VideoBackgroundSendMode;
  onSendModeChange: (mode: VideoBackgroundSendMode) => void;
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
}: VideoBackgroundControlsProps) => {
  const dispatch = useDispatch();
  const snapshot = useSyncExternalStore(
    subscribeVideoPreviewSnapshot,
    getVideoPreviewSnapshot,
    getVideoPreviewSnapshot,
  );
  const syncedCue = useSelector((state: RootState) =>
    resolveSyncedVideoPlayback(state.presentation.outputs, mediaKey),
  );
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubSeconds, setScrubSeconds] = useState(0);
  const [liveClockTick, setLiveClockTick] = useState(0);

  const syncLive = syncOutputIds.length > 0;
  const duration = Math.max(
    snapshot.duration || 0,
    typeof media.duration === "number" ? media.duration : 0,
  );

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
  const isPaused = liveCue?.paused ?? snapshot.paused;

  const pushTransport = (
    positionSeconds: number,
    paused: boolean,
    applySeek: boolean,
  ) => {
    const cue = applyVideoBackgroundTransport(
      {
        mediaKey,
        positionSeconds,
        paused,
        applySeek,
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
      className="flex flex-col gap-1.5 rounded-md border border-white/12 bg-black/40 px-2 py-1.5"
      data-testid="video-background-controls"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Button
          type="button"
          variant="tertiary"
          svg={isPaused ? Play : Pause}
          aria-label={isPaused ? "Play video" : "Pause video"}
          title={isPaused ? "Play" : "Pause"}
          onClick={() => {
            pushTransport(transportPosition, !isPaused, false);
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
        <span className="w-[4.5rem] shrink-0 text-center text-xs tabular-nums text-gray-300">
          {formatVideoClock(displaySeconds)}
        </span>
        <Slider
          aria-label="Video timeline"
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
          className="flex-1"
        />
        <span className="w-[4.5rem] shrink-0 text-center text-xs tabular-nums text-gray-400">
          {formatVideoClock(duration)}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-1">
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
        <p className="min-w-0 flex-1 text-[11px] leading-snug text-gray-400">
          {sendModeHint}
        </p>
      </div>
    </div>
  );
};

export default VideoBackgroundControls;
