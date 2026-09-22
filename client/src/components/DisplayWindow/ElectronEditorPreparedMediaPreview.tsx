import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { VideoBackgroundPlaybackCue, Box } from "../../types";
import { useServiceVideoCandidates } from "../../hooks/useServiceVideoCandidates";
import {
  type ElectronMediaSurfaceCandidate,
  type ElectronMediaSurfaceView,
} from "../../utils/electronMediaSurfacePool";
import type { ElectronMediaDiscovery } from "../../utils/electronMediaSurfaceDiagnostics";
import {
  isMediaSurfaceVisible,
  type MediaSurfaceStatus,
} from "../../utils/mediaSurfaceLifecycle";
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
  const [statusByKey, setStatusByKey] = useState<
    Record<string, MediaSurfaceStatus>
  >({});
  const statusByKeyRef = useRef<Record<string, MediaSurfaceStatus>>({});
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
  useLayoutEffect(() => {
    statusByKeyRef.current = {};
    setStatusByKey({});
    onCurrentFrameReady(false);
  }, [
    currentMedia?.source,
    currentMediaKey,
    onCurrentFrameReady,
    preparedMediaContext?.outlineId,
  ]);
  const reportStatus = useCallback(
    (status: MediaSurfaceStatus) => {
      if (
        status.route !== "editor" ||
        status.role !== "editor-preview" ||
        status.outlineId !== preparedMediaContext?.outlineId
      ) {
        return;
      }
      const previous = statusByKeyRef.current[status.mediaKey];
      if (
        previous &&
        (status.generation < previous.generation ||
          (status.generation === previous.generation &&
            status.sourceIdentity !== previous.sourceIdentity))
      ) {
        return;
      }
      if (status.phase === "disposed") {
        delete statusByKeyRef.current[status.mediaKey];
        setStatusByKey((current) => {
          if (!(status.mediaKey in current)) return current;
          const next = { ...current };
          delete next[status.mediaKey];
          return next;
        });
      } else {
        statusByKeyRef.current[status.mediaKey] = status;
        setStatusByKey((current) => ({
          ...current,
          [status.mediaKey]: status,
        }));
      }
      if (status.mediaKey === currentMediaKey) {
        onCurrentFrameReady(isMediaSurfaceVisible(status));
      }
    },
    [
      currentMediaKey,
      onCurrentFrameReady,
      preparedMediaContext?.outlineId,
    ],
  );

  useEffect(() => {
    onCurrentFrameReady(
      currentMediaKey
        ? isMediaSurfaceVisible(statusByKey[currentMediaKey])
        : false,
    );
  }, [currentMediaKey, onCurrentFrameReady, statusByKey]);

  const views = useMemo<ElectronMediaSurfaceView[]>(() => {
    if (!currentMedia || !videoBox) return [];
    return [
      {
        mediaKey: currentMedia.mediaKey,
        source: currentMedia.source,
        videoBox,
        opacity:
          isMediaSurfaceVisible(statusByKey[currentMedia.mediaKey]) ? 1 : 0,
        zIndex: 1,
        shouldPlay: true,
        muted: true,
        volume,
        playback,
      },
    ];
  }, [
    currentMedia,
    playback,
    statusByKey,
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
        onStatusChange={reportStatus}
        route="editor"
        role="editor-preview"
        outlineId={preparedMediaContext?.outlineId}
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
