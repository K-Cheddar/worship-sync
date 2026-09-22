import { useCallback, useEffect, useMemo, useState } from "react";
import type { VideoBackgroundPlaybackCue, Box } from "../../types";
import { useServiceVideoCandidates } from "../../hooks/useServiceVideoCandidates";
import {
  ELECTRON_EDITOR_MEDIA_SURFACE_BUDGET,
  type ElectronMediaSurfaceCandidate,
  type ElectronMediaSurfaceView,
} from "../../utils/electronMediaSurfacePool";
import ElectronMediaSurfacePool from "./ElectronMediaSurfacePool";

type ElectronEditorPreparedMediaPreviewProps = {
  enabled: boolean;
  currentItemId?: string;
  currentMedia?: ElectronMediaSurfaceCandidate;
  videoBox?: Box;
  playback?: VideoBackgroundPlaybackCue;
  volume?: number;
  onCurrentFrameReady: (ready: boolean) => void;
};

const NOOP = () => undefined;

const ElectronEditorPreparedMediaPreview = ({
  enabled,
  currentItemId,
  currentMedia,
  videoBox,
  playback,
  volume = 1,
  onCurrentFrameReady,
}: ElectronEditorPreparedMediaPreviewProps) => {
  const [readyByKey, setReadyByKey] = useState<Record<string, boolean>>({});
  const candidateResult = useServiceVideoCandidates({
    enabled,
    currentItemId,
    currentMedia,
    maxSurfaces: ELECTRON_EDITOR_MEDIA_SURFACE_BUDGET,
    scope: "current-item",
  });

  const currentMediaKey = currentMedia?.mediaKey;
  const reportReady = useCallback(
    (mediaKey: string, ready: boolean) => {
      setReadyByKey((current) =>
        current[mediaKey] === ready
          ? current
          : { ...current, [mediaKey]: ready },
      );
      if (mediaKey === currentMediaKey) onCurrentFrameReady(ready);
    },
    [currentMediaKey, onCurrentFrameReady],
  );

  useEffect(() => {
    onCurrentFrameReady(
      currentMediaKey ? readyByKey[currentMediaKey] === true : false,
    );
  }, [currentMediaKey, onCurrentFrameReady, readyByKey]);

  const views = useMemo<ElectronMediaSurfaceView[]>(() => {
    if (!currentMedia || !videoBox) return [];
    return [
      {
        mediaKey: currentMedia.mediaKey,
        source: currentMedia.source,
        videoBox,
        opacity: readyByKey[currentMedia.mediaKey] ? 1 : 0,
        zIndex: 1,
        shouldPlay: true,
        muted: true,
        volume,
        playback,
      },
    ];
  }, [currentMedia, playback, readyByKey, videoBox, volume]);

  if (!enabled) return null;
  return (
    <div className="pointer-events-none absolute inset-0">
      <ElectronMediaSurfacePool
        enabled
        candidates={candidateResult.candidates}
        candidateDiagnostics={candidateResult.diagnostics}
        views={views}
        onReadyChange={reportReady}
        onFirstAdvancingFrameChange={NOOP}
        onSurfaceElement={NOOP}
        lastMediaKey={currentMediaKey}
        outputId={undefined}
        windowRole="editor"
      />
    </div>
  );
};

export default ElectronEditorPreparedMediaPreview;
