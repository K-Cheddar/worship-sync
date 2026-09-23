import { ref, set } from "firebase/database";
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
          return;
        }
        setManifest((current) => {
          if (current && value.revision < current.revision) return current;
          try {
            localStorage.setItem(
              getStorageKey(churchId, outputId),
              JSON.stringify(value),
            );
          } catch {
            // The live value remains usable if local storage is unavailable.
          }
          return value;
        });
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
      !discovery ||
      discovery.outlineLoadState !== "loaded" ||
      !outputId ||
      !firebaseDb ||
      !churchId ||
      !sharedDataReady ||
      sessionKind === "display"
    ) {
      return;
    }

    const key = getStorageKey(churchId, outputId);
    const previous =
      manifestDrafts.get(key) ?? readCachedManifest(churchId, outputId);
    const next = buildMediaPreparationManifest({
      discovery,
      outputId,
      previous,
    });
    if (
      previous &&
      getMediaPreparationManifestStructure(previous) ===
        getMediaPreparationManifestStructure(next)
    ) {
      return;
    }

    const path = getManifestPath(churchId, outputId);
    manifestDrafts.set(key, next);
    let active = true;
    const previousWrite = manifestWriteQueues.get(key) ?? Promise.resolve();
    const write = previousWrite
      .catch(() => undefined)
      .then(() => set(ref(firebaseDb, path), next))
      .then(() => {
        if (!active) return;
        try {
          localStorage.setItem(
            key,
            JSON.stringify(next),
          );
        } catch {
          // Publishing remains successful even when this renderer cannot cache.
        }
      });
    manifestWriteQueues.set(key, write.then(() => undefined, () => undefined));
    void write.catch((error) => {
      if (manifestDrafts.get(key) === next) {
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
