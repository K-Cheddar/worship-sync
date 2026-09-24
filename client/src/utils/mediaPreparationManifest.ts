import type { ElectronMediaSurfaceCandidate } from "./electronMediaSurfacePool";
import type { ElectronMediaDiscovery } from "./electronMediaSurfaceDiagnostics";
import { isHLSVideoSource } from "./isInstantVideoSource";
import { isPlayableMediaSource } from "./mediaSource";

export const MEDIA_PREPARATION_MANIFEST_VERSION = 1 as const;

export type MediaPreparationManifestMedia = {
  mediaKey: string;
  source: {
    kind: "remote-url";
    url: string;
  };
};

export type MediaPreparationManifestItem = {
  itemId: string;
  itemIndex: number;
  itemName: string;
  media: MediaPreparationManifestMedia[];
};

export type MediaPreparationManifest = {
  contract: "worshipsync.media-preparation";
  version: typeof MEDIA_PREPARATION_MANIFEST_VERSION;
  revision: number;
  publishedAt: number;
  outputId: string;
  controllerProfileId?: string;
  controllerProfileName?: string;
  outlineScope?: string;
  outlineId?: string | null;
  outlineName?: string;
  items: MediaPreparationManifestItem[];
};

/**
 * This is a portability and serialization check, not the network security
 * boundary. Electron's main-process safeHttpGet performs DNS, address, and
 * redirect validation before fetching. Manifests only carry portable HTTP(S)
 * URLs and reject renderer-local schemes, obvious local hosts, and credentials.
 */
export const isTransportSafeMediaUrl = (value: string | undefined): value is string => {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return !(
      hostname === "localhost" ||
      hostname === "ip6-localhost" ||
      hostname === "0.0.0.0" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
};

const getManifestItems = (
  discovery: ElectronMediaDiscovery,
): MediaPreparationManifestItem[] =>
  discovery.items
    .map((item) => {
      const media = new Map<string, MediaPreparationManifestMedia>();
      item.videos
        .filter((video) => video.status !== "excluded")
        .forEach((video) => {
          const url =
            video.transportSource ?? video.originalSource ?? video.source;
          if (!isTransportSafeMediaUrl(url) || media.has(video.mediaKey)) return;
          media.set(video.mediaKey, {
            mediaKey: video.mediaKey,
            source: { kind: "remote-url", url },
          });
        });
      return {
        itemId: item.itemId,
        itemIndex: item.itemIndex,
        itemName: item.itemName,
        media: [...media.values()].sort((left, right) =>
          left.mediaKey.localeCompare(right.mediaKey),
        ),
      };
    })
    .filter((item) => item.media.length > 0)
    .sort((left, right) => left.itemIndex - right.itemIndex || left.itemId.localeCompare(right.itemId));

export const getMediaPreparationManifestStructure = (
  manifest: Pick<
    MediaPreparationManifest,
    | "outputId"
    | "controllerProfileId"
    | "outlineScope"
    | "outlineId"
    | "items"
  >,
) =>
  JSON.stringify({
    outputId: manifest.outputId,
    controllerProfileId: manifest.controllerProfileId ?? null,
    outlineScope: manifest.outlineScope ?? null,
    outlineId: manifest.outlineId ?? null,
    items: manifest.items,
  });

export const buildMediaPreparationManifest = ({
  discovery,
  outputId,
  previous,
  publishedAt = Date.now(),
}: {
  discovery: ElectronMediaDiscovery;
  outputId: string;
  previous?: MediaPreparationManifest;
  publishedAt?: number;
}): MediaPreparationManifest => {
  const items = getManifestItems(discovery);
  const nextShape = {
    outputId,
    controllerProfileId: discovery.controllerProfileId,
    outlineScope: discovery.outlineScope,
    outlineId: discovery.outlineId ?? discovery.targetOutlineId ?? null,
    items,
  };
  const structure = getMediaPreparationManifestStructure(nextShape);
  const previousStructure = previous
    ? getMediaPreparationManifestStructure(previous)
    : undefined;
  return {
    contract: "worshipsync.media-preparation",
    version: MEDIA_PREPARATION_MANIFEST_VERSION,
    revision:
      previous && previousStructure === structure
        ? previous.revision
        : (previous?.revision ?? 0) + 1,
    publishedAt,
    outputId,
    controllerProfileId: discovery.controllerProfileId,
    controllerProfileName: discovery.controllerProfileName,
    outlineScope: discovery.outlineScope,
    outlineId: nextShape.outlineId,
    outlineName: discovery.outlineName ?? discovery.targetOutlineName,
    items,
  };
};

export const isMediaPreparationManifest = (
  value: unknown,
): value is MediaPreparationManifest => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MediaPreparationManifest>;
  const isRecord = (entry: unknown): entry is Record<string, unknown> =>
    Boolean(entry && typeof entry === "object");
  const validItems = Array.isArray(candidate.items) && candidate.items.every((item) => {
    if (!isRecord(item)) return false;
    if (
      typeof item.itemId !== "string" ||
      item.itemId.length === 0 ||
      !Number.isInteger(item.itemIndex) ||
      item.itemIndex < 0 ||
      typeof item.itemName !== "string" ||
      !Array.isArray(item.media)
    ) {
      return false;
    }
    return item.media.every((media) => {
      if (
        !isRecord(media) ||
        typeof media.mediaKey !== "string" ||
        media.mediaKey.length === 0
      ) return false;
      const source = media.source;
      return (
        isRecord(source) &&
        source.kind === "remote-url" &&
        typeof source.url === "string" &&
        isTransportSafeMediaUrl(source.url)
      );
    });
  });
  return (
    candidate.contract === "worshipsync.media-preparation" &&
    candidate.version === MEDIA_PREPARATION_MANIFEST_VERSION &&
    typeof candidate.revision === "number" &&
    Number.isInteger(candidate.revision) &&
    candidate.revision >= 1 &&
    typeof candidate.publishedAt === "number" &&
    Number.isFinite(candidate.publishedAt) &&
    typeof candidate.outputId === "string" &&
    candidate.outputId.length > 0 &&
    (candidate.controllerProfileId === undefined ||
      typeof candidate.controllerProfileId === "string") &&
    (candidate.outlineScope === undefined ||
      typeof candidate.outlineScope === "string") &&
    (candidate.outlineId === undefined ||
      candidate.outlineId === null ||
      typeof candidate.outlineId === "string") &&
    (candidate.outlineName === undefined ||
      typeof candidate.outlineName === "string") &&
    validItems
  );
};

export const mediaPreparationManifestToCandidates = (
  manifest: MediaPreparationManifest | undefined,
  cacheMap: Record<string, string> = {},
): ElectronMediaSurfaceCandidate[] =>
  manifest?.items.flatMap((item) =>
    item.media.map((media) => {
      const cachedSource = cacheMap[media.source.url];
      const useCache =
        Boolean(cachedSource) &&
        !isHLSVideoSource(cachedSource) &&
        isPlayableMediaSource(cachedSource);
      return {
        mediaKey: media.mediaKey,
        source: useCache ? cachedSource : media.source.url,
        originalSource: media.source.url,
        sourceKind: useCache ? ("cache" as const) : ("remote" as const),
        itemId: item.itemId,
        itemIndex: item.itemIndex,
        itemName: item.itemName,
        reason: useCache
          ? "renderer-local cached finite source"
          : "remote preparation manifest",
      };
    }),
  ) ?? [];
