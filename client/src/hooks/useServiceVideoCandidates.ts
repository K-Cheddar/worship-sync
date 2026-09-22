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

type ServiceItemMedia = {
  itemId: string;
  itemName: string;
  itemIndex: number;
  candidates: ElectronMediaSurfaceCandidate[];
  diagnostics: ElectronMediaSurfaceCandidateDiagnostic[];
};

export type ServiceVideoCandidateResult = {
  candidates: ElectronMediaSurfaceCandidate[];
  diagnostics: ElectronMediaSurfaceCandidateDiagnostic[];
  discovery: ElectronMediaDiscovery;
  poolCapacity: number;
};

type PouchAllDocsResult = {
  rows?: Array<{
    id?: string;
    key?: string;
    error?: string;
    doc?: DBItem;
  }>;
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
  if (mappedSource && !isHLSVideoSource(mappedSource)) return mappedSource;

  const sourceKind = getSourceKind(source);
  if (!isHLSVideoSource(source) && sourceKind !== "remote") return source;

  const getLocalMediaPath = window.electronAPI?.getLocalMediaPath;
  if (!getLocalMediaPath) {
    return isHLSVideoSource(source) ? undefined : source;
  }
  try {
    const localSource = await getLocalMediaPath(source);
    if (localSource && !isHLSVideoSource(localSource)) return localSource;
    return isHLSVideoSource(source) ? undefined : source;
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
}: {
  media: MediaType | undefined;
  itemId: string;
  itemIndex: number;
  itemName: string;
  cacheMap?: Record<string, string>;
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
  const resolvedSource = await resolveFiniteSource(originalSource, cacheMap);
  if (!resolvedSource) {
    const isCacheableMux =
      isMuxVideoSource(originalSource) && isHLSVideoSource(originalSource);
    const state = isCacheableMux
      ? getCandidateState(
          "pending-cache",
          "pending",
          "finite Mux rendition is being cached",
        )
      : getCandidateState(
          "excluded",
          "not-cacheable",
          "no finite/cacheable rendition",
        );
    return {
      diagnostic: {
        mediaKey,
        originalSource,
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
  const shouldWarmRemoteCache =
    sourceKind === "remote" && !wasResolvedFromCache;
  const state = getCandidateState(
    "eligible",
    wasResolvedFromCache
      ? "cached"
      : shouldWarmRemoteCache
        ? "pending"
        : "not-required",
    wasResolvedFromCache
      ? "cached finite MP4 available"
      : shouldWarmRemoteCache
        ? "finite video source available; cache warmup queued"
        : "finite video source available",
  );
  const diagnostic: ElectronMediaSurfaceCandidateDiagnostic = {
    mediaKey,
    originalSource,
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
): Promise<{
  candidate?: ElectronMediaSurfaceCandidate;
  diagnostic: ElectronMediaSurfaceCandidateDiagnostic;
}> => {
  const resolvedSource = await resolveFiniteSource(candidate.source);
  if (!resolvedSource) {
    const isCacheableMux =
      isMuxVideoSource(candidate.source) && isHLSVideoSource(candidate.source);
    const state = isCacheableMux
      ? getCandidateState(
          "pending-cache",
          "pending",
          "finite Mux rendition is being cached",
        )
      : getCandidateState(
          "excluded",
          "not-cacheable",
          "no finite/cacheable rendition",
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
  doc: DBItem,
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
  doc: DBItem,
  itemIndex: number,
  cacheMap?: Record<string, string>,
): Promise<ServiceItemMedia> => {
  const discoveries = await Promise.all(
    doc.slides.flatMap((slide) => [
      ...slide.boxes.map((box) =>
        buildVideoDiscovery({
          media: box.mediaInfo,
          itemId: doc._id,
          itemIndex,
          itemName: doc.name,
          cacheMap,
        }),
      ),
      Promise.resolve({
        candidate: undefined,
        diagnostic: getLocalCaptureDiagnostic(slide, doc, itemIndex),
      }),
    ]),
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
  return {
    itemId: doc._id,
    itemName: doc.name,
    itemIndex,
    candidates,
    diagnostics,
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
}: {
  enabled: boolean;
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
}): ServiceVideoCandidateResult => {
  const { db, updater } = useContext(ControllerInfoContext) || {};
  const [serviceMedia, setServiceMedia] = useState<ServiceItemMedia[]>([]);
  const [currentMediaDiscovery, setCurrentMediaDiscovery] = useState<{
    candidate?: ElectronMediaSurfaceCandidate;
    diagnostic?: ElectronMediaSurfaceCandidateDiagnostic;
  }>({});
  const loadGenerationRef = useRef(0);
  const requestedCacheMediaKeysRef = useRef(new Set<string>());
  const cacheMapRef = useRef<Record<string, string>>({});
  const activeListIdRef = useRef<string | undefined>(undefined);
  const serviceItemIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    if (!currentMedia) {
      setCurrentMediaDiscovery({});
      return () => {
        active = false;
      };
    }
    void buildCandidateDiscovery(currentMedia, currentItemId).then((result) => {
      if (active) setCurrentMediaDiscovery(result);
    });
    return () => {
      active = false;
    };
  }, [currentItemId, currentMedia]);

  const loadServiceMedia = useCallback(async () => {
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

    if (scope === "current-item") apply([]);

    try {
      if (scope === "current-item") {
        if (!currentItemId) {
          activeListIdRef.current = undefined;
          serviceItemIdsRef.current = new Set();
          apply([]);
          return;
        }
        const currentDoc = (await db.get(currentItemId)) as DBItem | undefined;
        if (generation !== loadGenerationRef.current) return;
        activeListIdRef.current = undefined;
        serviceItemIdsRef.current = new Set([currentItemId]);
        if (!currentDoc || !Array.isArray(currentDoc.slides)) {
          apply([]);
          return;
        }
        apply([
          await getItemMedia(currentDoc, 0, cacheMapRef.current),
        ]);
        return;
      }
      const lists = (await db.get("ItemLists")) as ItemLists | undefined;
      if (generation !== loadGenerationRef.current) return;
      // A display must warm the outline owned by its controller. The legacy
      // activeList is only the presentation fallback; using it for every
      // output leaks sanctuary media into auxiliary screens.
      const activeListId =
        outlineId === undefined ? lists?.activeList?._id : outlineId;
      if (!activeListId) {
        activeListIdRef.current = undefined;
        serviceItemIdsRef.current = new Set();
        apply([]);
        return;
      }
      // Do not let a previous outline's prepared surfaces survive while the
      // newly selected outline is being read. The live lane still contributes
      // the current media candidate synchronously, so clearing here avoids
      // cross-outline playback without creating a blank handoff.
      if (activeListIdRef.current !== activeListId) apply([]);

      const list = (await db.get(activeListId)) as DBItemListDetails;
      if (generation !== loadGenerationRef.current) return;
      const itemIds = list.items
        .map((item) => item._id)
        .filter((itemId): itemId is string => Boolean(itemId));
      activeListIdRef.current = activeListId;
      serviceItemIdsRef.current = new Set(itemIds);
      if (itemIds.length === 0) {
        apply([]);
        return;
      }

      const response = (await db.allDocs({
        keys: itemIds,
        include_docs: true,
      })) as PouchAllDocsResult;
      if (generation !== loadGenerationRef.current) return;
      const docsById = new Map<string, DBItem>(
        (response.rows ?? [])
          .map((row) => row.doc)
          .filter((doc): doc is DBItem => Boolean(doc?._id))
          .map((doc) => [doc._id, doc]),
      );
      const nextServiceMedia = await Promise.all(
        itemIds.flatMap((itemId, itemIndex) => {
          const doc = docsById.get(itemId);
          return doc ? [getItemMedia(doc, itemIndex, cacheMapRef.current)] : [];
        }),
      );
      if (generation !== loadGenerationRef.current) return;
      apply(nextServiceMedia);
    } catch {
      // Preparation is optional. The existing lane path remains authoritative
      // when local outline discovery is unavailable or still syncing. A
      // current-item preview must not retain a previous item's candidates.
      if (scope === "current-item") apply([]);
    }
  }, [currentItemId, db, enabled, outlineId, scope]);

  useEffect(() => {
    void loadServiceMedia();
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [loadServiceMedia]);

  useEffect(() => {
    if (!enabled || !window.electronAPI?.ensureMediaCached) return;
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
              diagnostic.cacheStatus === "pending" &&
              (diagnostic.sourceKind === "hls" ||
                diagnostic.sourceKind === "remote"),
          ),
      );
    const requests = pending.filter((diagnostic) => {
      if (requestedCacheMediaKeysRef.current.has(diagnostic.mediaKey)) {
        return false;
      }
      requestedCacheMediaKeysRef.current.add(diagnostic.mediaKey);
      return true;
    });
    if (!requests.length) return;

    let active = true;
    const ensure = window.electronAPI.ensureMediaCached([
      ...new Set(requests.map((diagnostic) => diagnostic.originalSource)),
    ]);
    void ensure
      .then((result) => {
        if (!active) return;
        cacheMapRef.current = result.cacheMap;
        // The Electron result includes a fresh map; rerunning discovery makes
        // the cache-backed source visible to the pool without a page reload.
        void loadServiceMedia();
      })
      .catch((error) => {
        if (active) {
          requests.forEach((request) =>
            requestedCacheMediaKeysRef.current.delete(request.mediaKey),
          );
          console.error("Unable to ensure service video cache:", error);
        }
      });
    return () => {
      active = false;
    };
  }, [
    currentItemId,
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
      currentMedia && !isHLSVideoSource(currentMedia.source)
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
      outlineId,
      outlineName,
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
    };
  }, [
    controllerProfileId,
    controllerProfileName,
    currentItemId,
    currentMedia,
    maxSurfaces,
    outlineId,
    outlineName,
    outlineScope,
    outputId,
    protectedMediaKeys,
    serviceMedia,
    currentMediaDiscovery,
    renderer,
  ]);

  const previousReconciliationRef = useRef<
    | {
        count: number;
        keys: string[];
      }
    | undefined
  >(undefined);
  const previousDiscoverySignatureRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const signature = JSON.stringify(candidateResult.discovery);
    if (signature === previousDiscoverySignatureRef.current) return;
    previousDiscoverySignatureRef.current = signature;
    console.debug("[prepared-media] discovery", candidateResult.discovery);
  }, [candidateResult.discovery]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const next = {
      count: candidateResult.candidates.length,
      keys: candidateResult.candidates.map((candidate) => candidate.mediaKey),
    };
    const previous = previousReconciliationRef.current;
    if (
      !previous ||
      previous.count !== next.count ||
      previous.keys.join("\u0000") !== next.keys.join("\u0000")
    ) {
      console.debug("[prepared-surface] candidate reconciliation", {
        outputId,
        serviceId: activeListIdRef.current,
        serviceItemCount: serviceItemIdsRef.current.size,
        selectedItemId: currentItemId,
        liveItemId: currentItemId,
        previousCandidateCount: previous?.count ?? 0,
        nextCandidateCount: next.count,
        previousMediaKeys: previous?.keys ?? [],
        nextMediaKeys: next.keys,
        discoveredCount: candidateResult.diagnostics.length,
      });
    }
    previousReconciliationRef.current = next;
  }, [candidateResult, currentItemId, outputId]);

  return candidateResult;
};
