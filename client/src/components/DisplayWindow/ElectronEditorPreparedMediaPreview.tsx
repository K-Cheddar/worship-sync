import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VideoBackgroundPlaybackCue, Box } from "../../types";
import { useServiceVideoCandidates } from "../../hooks/useServiceVideoCandidates";
import {
  type ElectronMediaSurfaceCandidate,
  type ElectronMediaSurfaceView,
} from "../../utils/electronMediaSurfacePool";
import type { ElectronMediaDiscovery } from "../../utils/electronMediaSurfaceDiagnostics";
import ElectronMediaSurfacePool from "./ElectronMediaSurfacePool";

type ElectronEditorPreparedMediaPreviewProps = {
  enabled: boolean;
  currentItemId?: string;
  currentMedia?: ElectronMediaSurfaceCandidate;
  preparedMediaContext?: Pick<
    ElectronMediaDiscovery,
    | "controllerProfileId"
    | "controllerProfileName"
    | "outlineScope"
    | "outlineId"
    | "outlineName"
    | "contextSource"
  >;
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
  preparedMediaContext,
  videoBox,
  playback,
  volume = 1,
  onCurrentFrameReady,
}: ElectronEditorPreparedMediaPreviewProps) => {
  const [readyByKey, setReadyByKey] = useState<Record<string, boolean>>({});
  const readyByKeyRef = useRef<Record<string, boolean>>({});
  const [geometryReadyByKey, setGeometryReadyByKey] = useState<
    Record<string, boolean>
  >({});
  const candidateResult = useServiceVideoCandidates({
    enabled,
    currentItemId,
    currentMedia,
    outlineId: preparedMediaContext?.outlineId,
    renderer: "editor",
    controllerProfileId: preparedMediaContext?.controllerProfileId,
    controllerProfileName: preparedMediaContext?.controllerProfileName,
    outlineScope: preparedMediaContext?.outlineScope,
    outlineName: preparedMediaContext?.outlineName,
    contextSource: preparedMediaContext?.contextSource,
    scope: "service",
  });

  const currentMediaKey = currentMedia?.mediaKey;
  const reportReady = useCallback(
    (mediaKey: string, ready: boolean) => {
      setReadyByKey((current) => {
        if (current[mediaKey] === ready) return current;
        const next = { ...current, [mediaKey]: ready };
        readyByKeyRef.current = next;
        return next;
      });
      if (mediaKey === currentMediaKey) onCurrentFrameReady(ready);
    },
    [currentMediaKey, onCurrentFrameReady],
  );

  const reportGeometryReady = useCallback(
    (mediaKey: string, ready: boolean) => {
      setGeometryReadyByKey((current) =>
        current[mediaKey] === ready
          ? current
          : { ...current, [mediaKey]: ready },
      );
      if (mediaKey === currentMediaKey) {
        onCurrentFrameReady(
          readyByKeyRef.current[mediaKey] === true && ready === true,
        );
      }
    },
    [currentMediaKey, onCurrentFrameReady],
  );

  useEffect(() => {
    onCurrentFrameReady(
      currentMediaKey
        ? readyByKey[currentMediaKey] === true &&
            geometryReadyByKey[currentMediaKey] === true
        : false,
    );
  }, [
    currentMediaKey,
    geometryReadyByKey,
    onCurrentFrameReady,
    readyByKey,
  ]);

  const views = useMemo<ElectronMediaSurfaceView[]>(() => {
    if (!currentMedia || !videoBox) return [];
    return [
      {
        mediaKey: currentMedia.mediaKey,
        source: currentMedia.source,
        videoBox,
        opacity:
          readyByKey[currentMedia.mediaKey] &&
          geometryReadyByKey[currentMedia.mediaKey] === true
            ? 1
            : 0,
        zIndex: 1,
        shouldPlay: true,
        muted: true,
        volume,
        playback,
      },
    ];
  }, [
    currentMedia,
    geometryReadyByKey,
    playback,
    readyByKey,
    videoBox,
    volume,
  ]);

  if (!enabled) return null;
  return (
    <div className="pointer-events-none absolute inset-0">
      <ElectronMediaSurfacePool
        enabled
        candidates={candidateResult.candidates}
        candidateDiagnostics={candidateResult.diagnostics}
        views={views}
        onReadyChange={reportReady}
        onGeometryReadyChange={reportGeometryReady}
        onFirstAdvancingFrameChange={NOOP}
        onSurfaceElement={NOOP}
        discovery={candidateResult.discovery}
        poolCapacity={candidateResult.poolCapacity}
        lastMediaKey={currentMediaKey}
        outputId={undefined}
        windowRole="editor"
      />
    </div>
  );
};

export default ElectronEditorPreparedMediaPreview;
