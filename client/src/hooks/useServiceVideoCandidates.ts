import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ControllerInfoContext } from "../context/controllerInfo";
import { useGlobalBroadcast } from "./useGlobalBroadcast";
import type {
  DBItem,
  DBItemListDetails,
  ItemLists,
  ItemSlideType,
  MediaType,
} from "../types";
import { getVideoBackgroundMediaKey } from "../utils/videoBackgroundPlayback";
import {
  getVideoSourceKind,
  isHLSVideoSource,
} from "../utils/isInstantVideoSource";
import { isPlayableMediaSource } from "../utils/mediaSource";
import { parseLocalVideoFileAssetId } from "../utils/localVideoFileAssets";
import {
  acquireLocalVideoFileUrl,
  peekLocalVideoFileUrl,
} from "../utils/localVideoFileUrlCache";
import {
  selectElectronMediaSurfaceCandidates,
  type ElectronMediaSurfaceCandidate,
} from "../utils/electronMediaSurfacePool";
import {
  type ElectronMediaCandidateSourceKind,
  type ElectronMediaCandidateCacheStatus,
  type ElectronMediaCandidateStatus,
  type ElectronMediaSurfaceCandidateDiagnostic,
  type ElectronMediaDiscovery,
  type ElectronMediaDiscoveryRenderer,
} from "../utils/electronMediaSurfaceDiagnostics";
import { DEFAULT_ELECTRON_MEDIA_SURFACE_BUDGET } from "../utils/electronMediaSurfacePool";
import { isTransportSafeMediaUrl } from "../utils/mediaPreparationManifest";
import { getImageFromVideoUrl } from "../utils/generalUtils";

type ServiceItemMedia = {
  itemId: string;
  itemName: string;
  itemIndex: number;
  candidates: ElectronMediaSurfaceCandidate[];
  diagnostics: ElectronMediaSurfaceCandidateDiagnostic[];
  posterUrls: string[];
};

type CacheRequestState = {
  state:
    | "in-flight"
    | "succeeded"
    | "unavailable"
    | "retry-scheduled"
    | "retry-ready";
  attempt: number;
  lastResult: string;
  retryAt?: number;
};

const CACHE_RETRY_DELAYS_MS = [250, 500, 1000];
const MAX_CACHE_ATTEMPTS = CACHE_RETRY_DELAYS_MS.length;

export type ServiceVideoCandidateResult = {
  candidates: ElectronMediaSurfaceCandidate[];
  diagnostics: ElectronMediaSurfaceCandidateDiagnostic[];
  discovery: ElectronMediaDiscovery;
  poolCapacity: number;
  posterUrls: string[];
};

type PouchAllDocsResult = {
  rows?: Array<{
    id?: string;
    key?: string;
    error?: string;
    doc?: unknown;
  }>;
};

type SlideBearingDocument = Pick<DBItem, "_id" | "name" | "slides">;

const isSlideBearingDocument = (
  doc: unknown,
): doc is SlideBearingDocument => {
  if (!doc || typeof doc !== "object") return false;
  const candidate = doc as {
    _id?: unknown;
    name?: unknown;
    type?: unknown;
    slides?: unknown;
  };
  return (
    typeof candidate._id === "string" &&
    candidate._id.length > 0 &&
    typeof candidate.name === "string" &&
    candidate.type !== "heading" &&
    Array.isArray(candidate.slides)
  );
};

const getSourceKind = (source: string): ElectronMediaCandidateSourceKind => {
  const kind = getVideoSourceKind(source);
  return kind === "network" ? "remote" : kind;
};

const isMuxVideoSource = (source: string): boolean => {
  try {
    return new URL(source).hostname === "stream.mux.com";
  } catch {
    return source.includes("stream.mux.com");
  }
};

const getCandidateState = (
  status: ElectronMediaCandidateStatus,
  cacheStatus: ElectronMediaCandidateCacheStatus,
  reason: string,
) => ({ status, cacheStatus, eligible: status === "eligible", reason });

const resolveFiniteSource = async (
  source: string,
  cacheMap?: Record<string, string>,
): Promise<string | undefined> => {
  const mappedSource = cacheMap?.[source];
  if (
    mappedSource &&
    !isHLSVideoSource(mappedSource) &&
    isPlayableMediaSource(mappedSource)
  ) {
    return mappedSource;
  }

  const localVideoAssetId = parseLocalVideoFileAssetId(source);
  if (localVideoAssetId) {
    const cachedSource = peekLocalVideoFileUrl(localVideoAssetId);
    if (cachedSource && isPlayableMediaSource(cachedSource)) return cachedSource;
    const lease = acquireLocalVideoFileUrl(localVideoAssetId);
    try {
      const resolved = await lease.url;
      return resolved && isPlayableMediaSource(resolved) ? resolved : undefined;
    } finally {
      lease.release();
    }
  }

  const sourceKind = getSourceKind(source);
  if (!isHLSVideoSource(source) && sourceKind !== "remote") {
    return isPlayableMediaSource(source) ? source : undefined;
  }

  const getLocalMediaPath = window.electronAPI?.getLocalMediaPath;
  if (!getLocalMediaPath) {
    return isHLSVideoSource(source) || !isPlayableMediaSource(source)
      ? undefined
      : source;
  }
  try {
    const localSource = await getLocalMediaPath(source);
    if (
      localSource &&
      !isHLSVideoSource(localSource) &&
      isPlayableMediaSource(localSource)
    ) {
      return localSource;
    }
    return isHLSVideoSource(source) || !isPlayableMediaSource(source)
      ? undefined
      : source;
  } catch {
    return undefined;
  }
};

const buildVideoDiscovery = async ({
  media,
  itemId,
  itemIndex,
  itemName,
  cacheMap,
  cacheRequests,
}: {
  media: MediaType | undefined;
  itemId: string;
  itemIndex: number;
  itemName: string;
  cacheMap?: Record<string, string>;
  cacheRequests?: Map<string, CacheRequestState>;
}): Promise<{
  candidate?: ElectronMediaSurfaceCandidate;
  diagnostic?: ElectronMediaSurfaceCandidateDiagnostic;
}> => {
  if (media?.localVideoInput) {
    return {
      diagnostic: {
        mediaKey: `local:${media.localVideoInput.sourceId}`,
        originalSource: media.localVideoInput.sourceId,
        sourceKind: "local-capture",
        ...getCandidateState(
          "excluded",
          "not-cacheable",
          "local capture input is not a finite file video",
        ),
        itemId,
        itemName,
        itemIndex,
      },
    };
  }
  if (media?.type !== "video" || !media.background) return {};
  const mediaKey = getVideoBackgroundMediaKey(media);
  if (!mediaKey) return {};

  const originalSource = media.background;
  const transportSource = isTransportSafeMediaUrl(media.localVideoFile?.cloudUrl)
    ? media.localVideoFile?.cloudUrl
    : undefined;
  const resolvedSource = await resolveFiniteSource(originalSource, cacheMap);
  if (!resolvedSource) {
    const isCacheableMux =
      isMuxVideoSource(originalSource) && isHLSVideoSource(originalSource);
    const cacheRequest = cacheRequests?.get(mediaKey);
    const state = !isCacheableMux
      ? getCandidateState(
          "excluded",
          "not-cacheable",
          "no finite/cacheable rendition",
        )
      : cacheRequest?.state === "unavailable"
        ? getCandidateState("excluded", "unavailable", cacheRequest.lastResult)
        : cacheRequest?.state === "retry-scheduled"
          ? getCandidateState(
              "pending-cache",
              "retry-scheduled",
              cacheRequest.lastResult,
            )
          : getCandidateState(
              "pending-cache",
              "cache-in-progress",
              cacheRequest
                ? `Mux finite rendition cache attempt ${cacheRequest.attempt}/${MAX_CACHE_ATTEMPTS} in progress`
                : "Mux finite rendition cache is being requested",
            );
    return {
      diagnostic: {
        mediaKey,
        originalSource,
        transportSource,
        sourceKind: getSourceKind(originalSource),
        ...state,
        itemId,
        itemName,
        itemIndex,
      },
    };
  }

  const sourceKind = getSourceKind(resolvedSource);
  const wasResolvedFromCache = resolvedSource !== originalSource;
  const cacheRequest = cacheRequests?.get(mediaKey);
  const shouldWarmRemoteCache =
    sourceKind === "remote" && !wasResolvedFromCache;
  const cacheStatus: ElectronMediaCandidateCacheStatus = wasResolvedFromCache
    ? "cached"
    : cacheRequest?.state === "unavailable"
      ? "unavailable"
      : cacheRequest?.state === "retry-scheduled"
        ? "retry-scheduled"
        : shouldWarmRemoteCache
          ? "pending"
          : "not-required";
  const state = getCandidateState(
    "eligible",
    cacheStatus,
    wasResolvedFromCache
      ? "cached finite MP4 available"
      : cacheRequest?.state === "unavailable"
        ? cacheRequest.lastResult
        : cacheRequest?.state === "retry-scheduled"
          ? cacheRequest.lastResult
      : shouldWarmRemoteCache
        ? "finite video source available; cache warmup queued"
        : "finite video source available",
  );
  const diagnostic: ElectronMediaSurfaceCandidateDiagnostic = {
    mediaKey,
    originalSource,
    transportSource,
    resolvedSource,
    sourceKind,
    ...state,
    itemId,
    itemName,
    itemIndex,
  };

  return {
    candidate: {
      mediaKey,
      source: resolvedSource,
      itemId,
      itemIndex,
      originalSource,
      sourceKind,
      reason: diagnostic.reason,
      itemName,
    },
    diagnostic,
  };
};

const buildCandidateDiscovery = async (
  candidate: ElectronMediaSurfaceCandidate,
  currentItemId: string | undefined,
  cacheMap?: Record<string, string>,
  cacheRequests?: Map<string, CacheRequestState>,
): Promise<{
  candidate?: ElectronMediaSurfaceCandidate;
  diagnostic: ElectronMediaSurfaceCandidateDiagnostic;
}> => {
  const resolvedSource = await resolveFiniteSource(candidate.source, cacheMap);
  if (!resolvedSource) {
    const isCacheableMux =
      isMuxVideoSource(candidate.source) && isHLSVideoSource(candidate.source);
    const cacheRequest = cacheRequests?.get(candidate.mediaKey);
    const state = !isCacheableMux
      ? getCandidateState(
          "excluded",
          "not-cacheable",
          "no finite/cacheable rendition",
        )
      : cacheRequest?.state === "unavailable"
        ? getCandidateState("excluded", "unavailable", cacheRequest.lastResult)
        : cacheRequest?.state === "retry-scheduled"
          ? getCandidateState(
              "pending-cache",
              "retry-scheduled",
              cacheRequest.lastResult,
            )
          : getCandidateState(
              "pending-cache",
              "cache-in-progress",
              cacheRequest
                ? `Mux finite rendition cache attempt ${cacheRequest.attempt}/${MAX_CACHE_ATTEMPTS} in progress`
                : "Mux finite rendition cache is being requested",
            );
    return {
      diagnostic: {
        mediaKey: candidate.mediaKey,
        originalSource: candidate.source,
        sourceKind: getSourceKind(candidate.source),
        ...state,
        itemId: candidate.itemId ?? currentItemId,
        itemIndex: candidate.itemIndex,
        isCurrentItem: candidate.itemId === currentItemId,
      },
    };
  }
  const reason =
    resolvedSource !== candidate.source
      ? "cached finite MP4 available"
      : "finite video source available";
  return {
    candidate: {
      ...candidate,
      source: resolvedSource,
      originalSource: candidate.originalSource ?? candidate.source,
      sourceKind: getSourceKind(resolvedSource),
      reason,
    },
    diagnostic: {
      mediaKey: candidate.mediaKey,
      originalSource: candidate.source,
      resolvedSource,
      sourceKind: getSourceKind(resolvedSource),
      ...getCandidateState(
        "eligible",
        resolvedSource !== candidate.source ? "cached" : "not-required",
        reason,
      ),
      itemId: candidate.itemId ?? currentItemId,
      itemIndex: candidate.itemIndex,
      isCurrentItem: candidate.itemId === currentItemId,
    },
  };
};

const getLocalCaptureDiagnostic = (
  slide: ItemSlideType,
  doc: SlideBearingDocument,
  itemIndex: number,
): ElectronMediaSurfaceCandidateDiagnostic | undefined => {
  const source = slide.mediaSource;
  if (!source || source.kind !== "local-video-input") return undefined;
  return {
    mediaKey: `local:${source.sourceId}`,
    originalSource: source.sourceId,
    sourceKind: "local-capture",
    ...getCandidateState(
      "excluded",
      "not-cacheable",
      "local capture input is not a finite file video",
    ),
    itemId: doc._id,
    itemName: doc.name,
    itemIndex,
  };
};

const getItemMedia = async (
  doc: unknown,
  itemIndex: number,
  cacheMap?: Record<string, string>,
  cacheRequests?: Map<string, CacheRequestState>,
): Promise<ServiceItemMedia | undefined> => {
  if (!isSlideBearingDocument(doc)) return undefined;

  const discoveries = await Promise.all(
    doc.slides.flatMap((slide) => {
      if (!slide || !Array.isArray(slide.boxes)) return [];
      return [
        ...slide.boxes.map((box) =>
          buildVideoDiscovery({
            media: box.mediaInfo,
            itemId: doc._id,
            itemIndex,
            itemName: doc.name,
            cacheMap,
            cacheRequests,
          }),
        ),
        Promise.resolve({
          candidate: undefined,
          diagnostic: getLocalCaptureDiagnostic(slide, doc, itemIndex),
        }),
      ];
    }),
  );
  const candidates = discoveries
    .map((discovery) => discovery.candidate)
    .filter((candidate): candidate is ElectronMediaSurfaceCandidate =>
      Boolean(candidate),
    );
  const diagnostics = discoveries
    .map((discovery) => discovery.diagnostic)
    .filter(
      (diagnostic): diagnostic is ElectronMediaSurfaceCandidateDiagnostic =>
      Boolean(diagnostic),
    );
  const posterUrls = Array.from(
    new Set(
      doc.slides.flatMap((slide) =>
        Array.isArray(slide?.boxes)
          ? slide.boxes.flatMap((box) => {
              const media = box.mediaInfo;
              if (media?.type !== "video" || !media.background) return [];
              const poster =
                media.placeholderImage ||
                media.thumbnail ||
                getImageFromVideoUrl(media.background, {
                  width: 960,
                  height: 540,
                });
              return isTransportSafeMediaUrl(poster) ? [poster] : [];
            })
          : [],
      ),
    ),
  );
  return {
    itemId: doc._id,
    itemName: doc.name,
    itemIndex,
    candidates,
    diagnostics,
    posterUrls,
  };
};

const getChangedDocumentIds = (event: CustomEventInit): string[] => {
  const updates = event.detail;
  if (!Array.isArray(updates)) return [];
  return updates
    .map((update) =>
      update && typeof update._id === "string" ? update._id : "",
    )
    .filter(Boolean);
};

/**
 * Reads the active outline locally in each renderer. This is deliberately a
 * preparation input, not synchronized presentation state: a display may warm
 * its own cache-backed surfaces without changing what any other display shows.
 */
export const useServiceVideoCandidates = ({
  enabled,
  cacheMedia = true,
  outputId,
  currentItemId,
  currentMedia,
  outlineId,
  protectedMediaKeys,
  maxSurfaces,
  scope = "service",
  renderer = "projector",
  controllerProfileId,
  controllerProfileName,
  outlineScope,
  outlineName,
  contextSource,
}: {
  enabled: boolean;
  /** Discovery can be used by a controller manifest publisher without warming its own renderer cache. */
  cacheMedia?: boolean;
  outputId?: string;
  currentItemId?: string;
  currentMedia?: ElectronMediaSurfaceCandidate;
  /** Already-resolved outline for the output's controller scope. */
  outlineId?: string | null;
  protectedMediaKeys?: string[];
  maxSurfaces?: number;
  scope?: "service" | "current-item";
  renderer?: ElectronMediaDiscoveryRenderer;
  controllerProfileId?: string;
  controllerProfileName?: string;
  outlineScope?: string;
  outlineName?: string;
  contextSource?:
    | "local runtime selection"
    | "persisted ItemLists fallback"
    | "effective mirrored output source";
}): ServiceVideoCandidateResult => {
  const { db, updater } = useContext(ControllerInfoContext) || {};
  const [serviceMedia, setServiceMedia] = useState<ServiceItemMedia[]>([]);
  const [currentMediaDiscovery, setCurrentMediaDiscovery] = useState<{
    candidate?: ElectronMediaSurfaceCandidate;
    diagnostic?: ElectronMediaSurfaceCandidateDiagnostic;
  }>({});
  const loadGenerationRef = useRef(0);
  const cacheRequestsRef = useRef(new Map<string, CacheRequestState>());
  const cacheMapRef = useRef<Record<string, string>>({});
  const [cacheRevision, setCacheRevision] = useState(0);
  const activeListIdRef = useRef<string | undefined>(undefined);
  const serviceItemIdsRef = useRef<Set<string>>(new Set());
  const retryTimerRef = useRef<number | undefined>(undefined);
  const cacheRetryTimerRef = useRef<number | undefined>(undefined);
  const loadServiceMediaRef = useRef<
    ((isRetry?: boolean) => Promise<void>) | undefined
  >(undefined);
  const outlineRetryAttemptRef = useRef(0);
  const lastLoadTargetRef = useRef<string | undefined>(undefined);
  const [outlineLoad, setOutlineLoad] = useState<{
    targetOutlineId?: string | null;
    loadedOutlineId?: string;
    loadedOutlineName?: string;
    state: "loading" | "loaded" | "error" | "retrying";
    error?: string;
    retryAttempt: number;
    retryAt?: number;
  }>({ state: "loading", retryAttempt: 0 });

  useEffect(() => {
    let active = true;
    if (!currentMedia) {
      setCurrentMediaDiscovery({});
      return () => {
        active = false;
      };
    }
    void buildCandidateDiscovery(
      currentMedia,
      currentItemId,
      cacheMapRef.current,
      cacheRequestsRef.current,
    ).then((result) => {
      if (active) setCurrentMediaDiscovery(result);
    });
    return () => {
      active = false;
    };
  }, [cacheRevision, currentItemId, currentMedia]);

  const loadServiceMedia = useCallback(async (isRetry = false) => {
    const loadTarget = `${scope}:${outlineId === undefined ? "fallback" : outlineId ?? "none"}`;
    if (!isRetry && lastLoadTargetRef.current !== loadTarget) {
      outlineRetryAttemptRef.current = 0;
      lastLoadTargetRef.current = loadTarget;
    }
    const generation = ++loadGenerationRef.current;
    const apply = (next: ServiceItemMedia[]) => {
      if (generation === loadGenerationRef.current) setServiceMedia(next);
    };
    if (!enabled || !db) {
      activeListIdRef.current = undefined;
      serviceItemIdsRef.current = new Set();
      apply([]);
      return;
    }

    if (scope === "current-item") {
      setOutlineLoad((current) => ({ ...current, state: "loading", error: undefined }));
      apply([]);
    } else {
      setOutlineLoad((current) => ({
        ...current,
        state: isRetry ? "retrying" : "loading",
        error: undefined,
        retryAt: undefined,
      }));
    }

    try {
      if (scope === "current-item") {
        if (!currentItemId) {
          activeListIdRef.current = undefined;
          serviceItemIdsRef.current = new Set();
          apply([]);
          return;
        }
        const currentDoc = await db.get(currentItemId);
        if (generation !== loadGenerationRef.current) return;
        activeListIdRef.current = undefined;
        serviceItemIdsRef.current = new Set([currentItemId]);
        if (!isSlideBearingDocument(currentDoc)) {
          apply([]);
          return;
        }
        const currentItemMedia = await getItemMedia(
          currentDoc,
          0,
          cacheMapRef.current,
          cacheRequestsRef.current,
        );
        if (!currentItemMedia) {
          apply([]);
          return;
        }
        apply([currentItemMedia]);
        setOutlineLoad((current) => ({ ...current, state: "loaded", error: undefined }));
        return;
      }
      const lists =
        outlineId === undefined
          ? ((await db.get("ItemLists")) as ItemLists | undefined)
          : undefined;
      if (generation !== loadGenerationRef.current) return;
      // A display must warm the outline owned by its controller. The legacy
      // activeList is only the presentation fallback; using it for every
      // output leaks sanctuary media into auxiliary screens.
      const activeListId =
        outlineId === undefined ? lists?.activeList?._id : outlineId;
      setOutlineLoad((current) => ({
        ...current,
        targetOutlineId: activeListId,
      }));
      if (!activeListId) {
        activeListIdRef.current = undefined;
        serviceItemIdsRef.current = new Set();
        apply([]);
        setOutlineLoad((current) => ({
          ...current,
          state: "loaded",
          loadedOutlineId: undefined,
          loadedOutlineName: undefined,
          error: undefined,
        }));
        return;
      }

      const list = (await db.get(activeListId)) as DBItemListDetails;
      if (generation !== loadGenerationRef.current) return;
      if (!list || !Array.isArray(list.items)) {
        throw new Error("selected preparation outline is unavailable");
      }
      const itemIds = list.items
        .map((item) => item._id)
        .filter((itemId): itemId is string => Boolean(itemId));
      if (itemIds.length === 0) {
        activeListIdRef.current = activeListId;
        serviceItemIdsRef.current = new Set();
        apply([]);
        setOutlineLoad((current) => ({
          ...current,
          state: "loaded",
          loadedOutlineId: activeListId,
          loadedOutlineName: list.name,
          error: undefined,
        }));
        return;
      }

      const response = (await db.allDocs({
        keys: itemIds,
        include_docs: true,
      })) as PouchAllDocsResult;
      if (generation !== loadGenerationRef.current) return;
      const docsById = new Map<string, SlideBearingDocument>();
      for (const row of response.rows ?? []) {
        if (row.error || !isSlideBearingDocument(row.doc)) continue;
        docsById.set(row.doc._id, row.doc);
      }
      const nextServiceMedia = (
        await Promise.all(
          itemIds.map(async (itemId, itemIndex) => {
            const doc = docsById.get(itemId);
            if (!doc) return undefined;
            return getItemMedia(
              doc,
              itemIndex,
              cacheMapRef.current,
              cacheRequestsRef.current,
            );
          }),
        )
      ).filter((media): media is ServiceItemMedia => Boolean(media));
      if (generation !== loadGenerationRef.current) return;
      activeListIdRef.current = activeListId;
      serviceItemIdsRef.current = new Set(itemIds);
      apply(nextServiceMedia);
      setOutlineLoad((current) => ({
        ...current,
        state: "loaded",
        loadedOutlineId: activeListId,
        loadedOutlineName: list.name,
        error: undefined,
        retryAttempt: 0,
      }));
      outlineRetryAttemptRef.current = 0;
    } catch (error) {
      if (generation !== loadGenerationRef.current) return;
      if (scope === "current-item") {
        apply([]);
        setOutlineLoad((current) => ({
          ...current,
          state: "error",
          error: error instanceof Error ? error.message : String(error),
        }));
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const attempt = outlineRetryAttemptRef.current + 1;
      outlineRetryAttemptRef.current = attempt;
      const retryDelay = CACHE_RETRY_DELAYS_MS[Math.min(attempt - 1, CACHE_RETRY_DELAYS_MS.length - 1)] ?? 1000;
      if (attempt <= MAX_CACHE_ATTEMPTS) {
        const retryAt = Date.now() + retryDelay;
        setOutlineLoad((current) => ({
          ...current,
          state: "retrying",
          error: message,
          retryAttempt: attempt,
          retryAt,
        }));
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = undefined;
          void loadServiceMediaRef.current?.(true);
        }, retryDelay);
      } else {
        setOutlineLoad((current) => ({
          ...current,
          state: "error",
          error: message,
          retryAttempt: attempt,
          retryAt: undefined,
        }));
      }
    }
  }, [currentItemId, db, enabled, outlineId, scope]);

  loadServiceMediaRef.current = loadServiceMedia;

  useEffect(() => {
    void loadServiceMedia();
    return () => {
      loadGenerationRef.current += 1;
      if (retryTimerRef.current !== undefined) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = undefined;
      }
      if (cacheRetryTimerRef.current !== undefined) {
        window.clearTimeout(cacheRetryTimerRef.current);
        cacheRetryTimerRef.current = undefined;
      }
    };
  }, [loadServiceMedia]);

  useEffect(() => {
    if (!enabled || !cacheMedia || !window.electronAPI?.ensureMediaCached) return;
    const diagnosticsByKey = new Map<string, ElectronMediaSurfaceCandidateDiagnostic>();
    [
      ...serviceMedia.flatMap((item) => item.diagnostics),
      ...(currentMediaDiscovery.diagnostic
        ? [currentMediaDiscovery.diagnostic]
        : []),
    ].forEach((diagnostic) => {
      if (!diagnosticsByKey.has(diagnostic.mediaKey)) {
        diagnosticsByKey.set(diagnostic.mediaKey, diagnostic);
      }
    });
    const currentServiceIndex = serviceMedia.find(
      (item) => item.itemId === currentItemId,
    )?.itemIndex;
    const orderedServiceMedia = [...serviceMedia].sort((left, right) => {
      const leftDistance =
        currentServiceIndex == null
          ? Number.MAX_SAFE_INTEGER
          : Math.abs(left.itemIndex - currentServiceIndex);
      const rightDistance =
        currentServiceIndex == null
          ? Number.MAX_SAFE_INTEGER
          : Math.abs(right.itemIndex - currentServiceIndex);
      return leftDistance - rightDistance || left.itemIndex - right.itemIndex;
    });
    const orderedKeys = [
      ...(currentMediaDiscovery.diagnostic
        ? [currentMediaDiscovery.diagnostic.mediaKey]
        : []),
      ...orderedServiceMedia.flatMap((item) =>
        item.diagnostics.map((diagnostic) => diagnostic.mediaKey),
      ),
    ];
    const pending = Array.from(new Set(orderedKeys))
      .map((mediaKey) => diagnosticsByKey.get(mediaKey))
      .filter(
        (diagnostic): diagnostic is ElectronMediaSurfaceCandidateDiagnostic =>
          Boolean(
              diagnostic &&
              (diagnostic.cacheStatus === "pending" ||
                diagnostic.cacheStatus === "cache-in-progress") &&
              (diagnostic.sourceKind === "hls" ||
                diagnostic.sourceKind === "remote"),
          ),
      );
    const requests = pending.filter((diagnostic) => {
      const current = cacheRequestsRef.current.get(diagnostic.mediaKey);
      if (current?.state === "in-flight" || current?.state === "succeeded") {
        return false;
      }
      const attempt = (current?.attempt ?? 0) + 1;
      cacheRequestsRef.current.set(diagnostic.mediaKey, {
        state: "in-flight",
        attempt,
        lastResult: `cache request in progress (attempt ${attempt}/${MAX_CACHE_ATTEMPTS})`,
      });
      return true;
    });
    if (!requests.length) return;

    let active = true;
    const ensure = window.electronAPI.ensureMediaCached([
      ...new Set(requests.map((diagnostic) => diagnostic.originalSource)),
    ]);
    const scheduleCacheRetry = () => {
      const retryRequests = requests.filter(
        (request) =>
          cacheRequestsRef.current.get(request.mediaKey)?.state ===
          "retry-scheduled",
      );
      if (!retryRequests.length) return false;
      const retryAt = Math.min(
        ...retryRequests.map(
          (request) =>
            cacheRequestsRef.current.get(request.mediaKey)?.retryAt ??
            Date.now(),
        ),
      );
      if (cacheRetryTimerRef.current !== undefined) {
        window.clearTimeout(cacheRetryTimerRef.current);
      }
      cacheRetryTimerRef.current = window.setTimeout(() => {
        cacheRetryTimerRef.current = undefined;
        retryRequests.forEach((request) => {
          const current = cacheRequestsRef.current.get(request.mediaKey);
          if (current?.state === "retry-scheduled") {
            cacheRequestsRef.current.set(request.mediaKey, {
              ...current,
              state: "retry-ready",
            });
          }
        });
        void loadServiceMediaRef.current?.();
      }, Math.max(0, retryAt - Date.now()));
      return true;
    };
    void ensure
      .then((result) => {
        cacheMapRef.current = { ...cacheMapRef.current, ...result.cacheMap };
        if (active) setCacheRevision((revision) => revision + 1);
        requests.forEach((request) => {
          const resolved = result.cacheMap[request.originalSource];
          const current = cacheRequestsRef.current.get(request.mediaKey);
          if (resolved && isPlayableMediaSource(resolved) && !isHLSVideoSource(resolved)) {
            cacheRequestsRef.current.set(request.mediaKey, {
              state: "succeeded",
              attempt: current?.attempt ?? 1,
              lastResult: "cached finite rendition available",
            });
            return;
          }
          const isMux =
            isMuxVideoSource(request.originalSource) &&
            isHLSVideoSource(request.originalSource);
          const attempt = current?.attempt ?? 1;
          if (isMux && attempt < MAX_CACHE_ATTEMPTS) {
            const retryAt = Date.now() + CACHE_RETRY_DELAYS_MS[attempt - 1];
            cacheRequestsRef.current.set(request.mediaKey, {
              state: "retry-scheduled",
              attempt,
              retryAt,
              lastResult: `Mux finite rendition returned no cache entry; retry ${attempt}/${MAX_CACHE_ATTEMPTS} scheduled`,
            });
          } else {
            cacheRequestsRef.current.set(request.mediaKey, {
              state: "unavailable",
              attempt,
              lastResult: isMux
                ? `Mux finite rendition unavailable after ${attempt}/${MAX_CACHE_ATTEMPTS} attempts; fallback-only`
                : "finite cache unavailable; fallback-only",
            });
          }
        });
        if (active) {
          scheduleCacheRetry();
          // The Electron result includes a fresh map; rerunning discovery makes
          // the cache-backed source visible to the pool without a page reload.
          void loadServiceMedia();
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        requests.forEach((request) => {
          const current = cacheRequestsRef.current.get(request.mediaKey);
          const attempt = current?.attempt ?? 1;
          const isMux =
            isMuxVideoSource(request.originalSource) &&
            isHLSVideoSource(request.originalSource);
          if (isMux && attempt < MAX_CACHE_ATTEMPTS) {
            cacheRequestsRef.current.set(request.mediaKey, {
              state: "retry-scheduled",
              attempt,
              retryAt: Date.now() + CACHE_RETRY_DELAYS_MS[attempt - 1],
              lastResult: `cache request failed (${message}); retry ${attempt}/${MAX_CACHE_ATTEMPTS} scheduled`,
            });
          } else {
            cacheRequestsRef.current.set(request.mediaKey, {
              state: "unavailable",
              attempt,
              lastResult: `cache unavailable (${message}); fallback-only`,
            });
          }
        });
        if (active) {
          scheduleCacheRetry();
          console.error("Unable to ensure service video cache:", error);
          void loadServiceMedia();
        }
      });
    return () => {
      active = false;
    };
  }, [
    currentItemId,
    cacheMedia,
    currentMediaDiscovery.diagnostic,
    enabled,
    loadServiceMedia,
    serviceMedia,
    scope,
  ]);

  const handleUpdate = useCallback(
    (event: CustomEventInit) => {
      const ids = getChangedDocumentIds(event);
      if (
        ids.length === 0 ||
        ids.includes("ItemLists") ||
        ids.includes(activeListIdRef.current ?? "") ||
        ids.some((id) => serviceItemIdsRef.current.has(id))
      ) {
        void loadServiceMedia();
      }
    },
    [loadServiceMedia],
  );

  useEffect(() => {
    if (!enabled || !updater) return;
    updater.addEventListener("update", handleUpdate);
    return () => updater.removeEventListener("update", handleUpdate);
  }, [enabled, handleUpdate, updater]);

  useGlobalBroadcast(handleUpdate);

  const posterUrls = useMemo(() => {
    const currentItemIndex = serviceMedia.find(
      (item) => item.itemId === currentItemId,
    )?.itemIndex;
    return Array.from(
      new Set(
        [...serviceMedia]
          .sort((left, right) => {
            if (currentItemIndex == null) {
              return left.itemIndex - right.itemIndex;
            }
            return (
              Math.abs(left.itemIndex - currentItemIndex) -
                Math.abs(right.itemIndex - currentItemIndex) ||
              left.itemIndex - right.itemIndex
            );
          })
          .flatMap((item) => item.posterUrls),
      ),
    ).slice(0, 8);
  }, [currentItemId, serviceMedia]);

  const candidateResult = useMemo(() => {
    const candidates = serviceMedia.flatMap((item) => item.candidates);
    const diagnostics: ElectronMediaSurfaceCandidateDiagnostic[] = serviceMedia
      .flatMap((item) => item.diagnostics)
      .map((diagnostic) => ({
        ...diagnostic,
        isCurrentItem:
          diagnostic.isCurrentItem ?? diagnostic.itemId === currentItemId,
      }));
    // Finite current media is already known from the live lane. Include it
    // synchronously so a transition cannot begin on the fallback while the
    // asynchronous local-path lookup is still settling.
    const immediateCurrentCandidate =
      currentMedia &&
      !isHLSVideoSource(currentMedia.source) &&
      isPlayableMediaSource(currentMedia.source)
        ? currentMedia
        : undefined;
    const currentCandidate =
      currentMediaDiscovery.candidate ?? immediateCurrentCandidate;
    if (currentCandidate) candidates.unshift(currentCandidate);
    if (currentMediaDiscovery.diagnostic) {
      diagnostics.unshift({
        ...currentMediaDiscovery.diagnostic,
        isCurrentItem:
          currentMediaDiscovery.diagnostic.isCurrentItem ??
          currentMediaDiscovery.diagnostic.itemId === currentItemId,
      });
    }
    const diagnosticsByKey = new Map<
      string,
      ElectronMediaSurfaceCandidateDiagnostic
    >();
    diagnostics.forEach((diagnostic) => {
      const previous = diagnosticsByKey.get(diagnostic.mediaKey);
      if (
        !previous ||
        (diagnostic.status === "eligible" && previous.status !== "eligible")
      ) {
        diagnosticsByKey.set(diagnostic.mediaKey, diagnostic);
      }
    });
    const selected = selectElectronMediaSurfaceCandidates({
      candidates,
      currentMediaKey: currentMedia?.mediaKey,
      currentItemId,
      protectedMediaKeys,
      maxSurfaces,
    });
    const discoveryItems = serviceMedia.map((item) => {
      const videos = new Map<string, ElectronMediaSurfaceCandidateDiagnostic>();
      item.diagnostics.forEach((diagnostic) => {
        const previous = videos.get(diagnostic.mediaKey);
        if (
          !previous ||
          (diagnostic.status === "eligible" && previous.status !== "eligible")
        ) {
          videos.set(diagnostic.mediaKey, diagnostic);
        }
      });
      return {
        itemIndex: item.itemIndex,
        itemId: item.itemId,
        itemName: item.itemName,
        videos: [...videos.values()].map((diagnostic) => ({
          mediaKey: diagnostic.mediaKey,
          source: diagnostic.resolvedSource ?? diagnostic.originalSource,
          originalSource: diagnostic.originalSource,
          transportSource: diagnostic.transportSource,
          resolvedSource: diagnostic.resolvedSource,
          sourceKind: diagnostic.sourceKind,
          status: diagnostic.status,
          cacheStatus: diagnostic.cacheStatus,
        })),
      };
    });
    const finiteVideoKeys = new Set(
      diagnostics
        .filter((diagnostic) => diagnostic.status !== "excluded")
        .map((diagnostic) => diagnostic.mediaKey),
    );
    const discovery: ElectronMediaDiscovery = {
      renderer,
      outputId,
      controllerProfileId,
      controllerProfileName,
      outlineScope,
      outlineId: outlineLoad.loadedOutlineId,
      outlineName: outlineLoad.loadedOutlineName,
      targetOutlineId:
        outlineId === undefined ? outlineLoad.targetOutlineId : outlineId,
      targetOutlineName: outlineName,
      loadedOutlineId: outlineLoad.loadedOutlineId,
      loadedOutlineName: outlineLoad.loadedOutlineName,
      outlineLoadState: outlineLoad.state,
      outlineLoadError: outlineLoad.error,
      outlineRetryAttempt: outlineLoad.retryAttempt,
      outlineRetryAt: outlineLoad.retryAt,
      contextSource,
      currentItemId,
      itemCount: serviceMedia.length,
      uniqueFiniteVideoCount: finiteVideoKeys.size,
      items: discoveryItems,
    };
    return {
      candidates: selected,
      diagnostics: [...diagnosticsByKey.values()],
      discovery,
      poolCapacity: Math.max(
        0,
        Math.floor(maxSurfaces ?? DEFAULT_ELECTRON_MEDIA_SURFACE_BUDGET),
      ),
      posterUrls,
    };
  }, [
    controllerProfileId,
    controllerProfileName,
    currentItemId,
    currentMedia,
    maxSurfaces,
    outlineId,
    outlineName,
    outlineLoad,
    contextSource,
    posterUrls,
    outlineScope,
    outputId,
    protectedMediaKeys,
    serviceMedia,
    currentMediaDiscovery,
    renderer,
  ]);

  return candidateResult;
};
