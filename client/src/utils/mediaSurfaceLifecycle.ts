export type MediaSurfaceLifecyclePhase =
  | "candidate"
  | "preparing"
  | "ready-paused"
  | "activation-requested"
  | "active-playing"
  | "retiring/resetting"
  | "disposed";

export type MediaSurfaceRouteRole = {
  route: string;
  role: string;
};

export type MediaSurfaceIdentity = MediaSurfaceRouteRole & {
  mediaKey: string;
  /** The source actually assigned to the media element, never the opaque input reference. */
  sourceIdentity: string;
  generation: number;
  outlineId?: string | null;
};

export type MediaSurfaceFrameMetadata = {
  mediaTime?: number;
  presentedFrames?: number;
  currentTime?: number;
  expectedDisplayTime?: number;
};

export type MediaSurfaceStatus = MediaSurfaceIdentity & {
  phase: MediaSurfaceLifecyclePhase;
  geometryReady: boolean;
  advancingFrame: boolean;
  frame?: MediaSurfaceFrameMetadata;
  error?: string;
  timestamp: number;
};

export type MediaSurfaceStatusExpectation = Partial<
  Pick<MediaSurfaceIdentity, "mediaKey" | "sourceIdentity" | "generation" | "outlineId">
> & MediaSurfaceRouteRole;

export const mediaSurfaceStatusKey = ({
  mediaKey,
  route,
  role,
}: Pick<MediaSurfaceIdentity, "mediaKey" | "route" | "role">): string =>
  `${route}:${role}:${mediaKey}`;

export const isCurrentMediaSurfaceStatus = (
  status: MediaSurfaceStatus,
  expected: MediaSurfaceStatusExpectation,
): boolean => {
  if (status.route !== expected.route || status.role !== expected.role) return false;
  if (expected.mediaKey && status.mediaKey !== expected.mediaKey) return false;
  if (
    expected.sourceIdentity &&
    status.sourceIdentity !== expected.sourceIdentity
  ) {
    return false;
  }
  if (
    expected.outlineId !== undefined &&
    status.outlineId !== expected.outlineId
  ) {
    return false;
  }
  return expected.generation == null || status.generation === expected.generation;
};

export const isMediaSurfaceVisible = (status: MediaSurfaceStatus | undefined) =>
  status?.phase === "active-playing" &&
  status.geometryReady &&
  status.advancingFrame;

const finite = (value: number | undefined): number | undefined =>
  value != null && Number.isFinite(value) ? value : undefined;

export const isAdvancingMediaFrame = (
  previous: MediaSurfaceFrameMetadata | undefined,
  next: MediaSurfaceFrameMetadata | undefined,
): boolean => {
  if (!next) return false;
  const nextPresented = finite(next.presentedFrames);
  const previousPresented = finite(previous?.presentedFrames);
  if (
    nextPresented != null &&
    previousPresented != null &&
    nextPresented > previousPresented
  ) {
    return true;
  }

  const nextMediaTime = finite(next.mediaTime ?? next.currentTime);
  const previousMediaTime = finite(previous?.mediaTime ?? previous?.currentTime);
  return (
    nextMediaTime != null &&
    previousMediaTime != null &&
    nextMediaTime > previousMediaTime + 0.0005
  );
};

