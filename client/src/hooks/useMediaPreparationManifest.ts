import { ref, runTransaction } from "firebase/database";
import { useContext, useEffect, useState } from "react";
import { GlobalInfoContext } from "../context/globalInfo";
import { subscribeWithPermissionRetry } from "../utils/firebaseListeners";
import { getChurchDataPath } from "../utils/firebasePaths";
import {
  buildMediaPreparationManifest,
  getMediaPreparationManifestStructure,
  isMediaPreparationManifest,
  type MediaPreparationManifest,
} from "../utils/mediaPreparationManifest";
import type { ElectronMediaDiscovery } from "../utils/electronMediaSurfaceDiagnostics";

const getManifestPath = (churchId: string, outputId: string) =>
  getChurchDataPath(
    churchId,
    "presentation",
    "mediaPreparation",
    encodeURIComponent(outputId),
  );

const getStorageKey = (churchId: string, outputId: string) =>
  `worshipsync:media-preparation:${churchId}:${outputId}`;

// A controller can have more than one output preview mounted, and an outline
// can change again before Firebase acknowledges the first write. Keep writes
// ordered per output so a stale completion cannot overwrite a newer revision.
const manifestWriteQueues = new Map<string, Promise<void>>();
const manifestDrafts = new Map<string, MediaPreparationManifest>();
const manifestPublicationGenerations = new Map<string, number>();

const readCachedManifest = (
  churchId: string | undefined,
  outputId: string | undefined,
): MediaPreparationManifest | undefined => {
  if (!churchId || !outputId) return undefined;
  try {
    const value = JSON.parse(
      localStorage.getItem(getStorageKey(churchId, outputId)) ?? "null",
    );
    return isMediaPreparationManifest(value) && value.outputId === outputId
      ? value
      : undefined;
  } catch {
    return undefined;
  }
};

export const useRemoteMediaPreparationManifest = ({
  enabled,
  outputId,
}: {
  enabled: boolean;
  outputId?: string;
}) => {
  const { firebaseDb, churchId, sharedDataReady } =
    useContext(GlobalInfoContext) || {};
  const [manifest, setManifest] = useState<MediaPreparationManifest>();
  const [cacheMap, setCacheMap] = useState<Record<string, string>>({});

  useEffect(() => {
    setManifest(readCachedManifest(churchId, outputId));
    setCacheMap({});
    if (!enabled || !firebaseDb || !sharedDataReady || !churchId || !outputId) {
      return;
    }

    let active = true;
    const unsubscribe = subscribeWithPermissionRetry(
      firebaseDb,
      getManifestPath(churchId, outputId),
      (snapshot) => {
        if (!active) return;
        const value = snapshot.val();
        if (!isMediaPreparationManifest(value) || value.outputId !== outputId) {
          setManifest(undefined);
          setCacheMap({});
          try {
            localStorage.removeItem(getStorageKey(churchId, outputId));
          } catch {
            // The authoritative empty value still clears in-memory state.
          }
          return;
        }
        setManifest(value);
        try {
          localStorage.setItem(
            getStorageKey(churchId, outputId),
            JSON.stringify(value),
          );
        } catch {
          // The live value remains usable if local storage is unavailable.
        }
      },
      { label: `presentation:mediaPreparation:${outputId}` },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [churchId, enabled, firebaseDb, outputId, sharedDataReady]);

  useEffect(() => {
    if (!enabled || !manifest || !window.electronAPI?.ensureMediaCached) return;
    let active = true;
    const sources = manifest.items.flatMap((item) =>
      item.media.map((media) => media.source.url),
    );
    if (sources.length === 0) return;
    void window.electronAPI
      .ensureMediaCached([...new Set(sources)])
      .then((result) => {
        if (active) setCacheMap((current) => ({ ...current, ...result.cacheMap }));
      })
      .catch((error) => {
        // Finite remote URLs remain valid pool candidates; a failed cache warm
        // should only make an HLS candidate unavailable, not blank the stage.
        console.warn("Unable to warm remote media preparation cache:", error);
      });
    return () => {
      active = false;
    };
  }, [enabled, manifest]);

  return { manifest, cacheMap };
};

/** Publish only after a complete local outline load, retaining the prior
 * manifest while a new outline is loading or temporarily unavailable. */
export const usePublishMediaPreparationManifest = ({
  enabled,
  discovery,
  outputId,
}: {
  enabled: boolean;
  discovery?: ElectronMediaDiscovery;
  outputId?: string;
}) => {
  const { firebaseDb, churchId, sessionKind, sharedDataReady } =
    useContext(GlobalInfoContext) || {};

  useEffect(() => {
    if (
      !enabled ||
      !outputId ||
      !firebaseDb ||
      !churchId ||
      !sharedDataReady ||
      sessionKind === "display"
    ) {
      return;
    }

    const key = getStorageKey(churchId, outputId);
    const generation = (manifestPublicationGenerations.get(key) ?? 0) + 1;
    manifestPublicationGenerations.set(key, generation);
    // A newly selected outline can spend one render in `loading`. Invalidate
    // the previous request immediately, while retaining its manifest until
    // the replacement discovery is complete.
    if (!discovery || discovery.outlineLoadState !== "loaded") return;

    const path = getManifestPath(churchId, outputId);
    const revisionBaseline =
      manifestDrafts.get(key) ?? readCachedManifest(churchId, outputId);
    const publishedAt = Date.now();
    let active = true;
    const previousWrite = manifestWriteQueues.get(key) ?? Promise.resolve();
    const write = previousWrite
      .catch(() => undefined)
      .then(async () => {
        // A slower outline load may finish after a newer selection. It must
        // not enter Firebase after that newer publication has been scheduled.
        if (manifestPublicationGenerations.get(key) !== generation) return;
        const result = await runTransaction(
          ref(firebaseDb, path),
          (current: unknown) => {
            if (manifestPublicationGenerations.get(key) !== generation) {
              return current;
            }
            const serverPrevious =
              isMediaPreparationManifest(current) &&
              current.outputId === outputId
                ? current
                : undefined;
            const baseline =
              serverPrevious ??
              revisionBaseline;
            const candidate = buildMediaPreparationManifest({
              discovery,
              outputId,
              previous: baseline,
              publishedAt,
            });
            if (
              serverPrevious &&
              getMediaPreparationManifestStructure(serverPrevious) ===
                getMediaPreparationManifestStructure(candidate)
            ) {
              return serverPrevious;
            }
            return candidate;
          },
        );
        const committed = result.snapshot.val();
        if (!isMediaPreparationManifest(committed) || committed.outputId !== outputId) {
          return;
        }
        manifestDrafts.set(key, committed);
        if (manifestPublicationGenerations.get(key) !== generation) return;
        try {
          localStorage.setItem(
            key,
            JSON.stringify(committed),
          );
        } catch {
          // Publishing remains successful even when this renderer cannot cache.
        }
      });
    manifestWriteQueues.set(key, write.then(() => undefined, () => undefined));
    void write.catch((error) => {
      if (manifestPublicationGenerations.get(key) === generation) {
        manifestDrafts.delete(key);
      }
      if (active) {
        console.error("Unable to publish media preparation manifest:", error);
      }
    });
    return () => {
      active = false;
    };
  }, [
    churchId,
    discovery,
    enabled,
    firebaseDb,
    outputId,
    sessionKind,
    sharedDataReady,
  ]);
};
