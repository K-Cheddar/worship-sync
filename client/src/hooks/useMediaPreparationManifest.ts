import { onDisconnect, onValue, ref, remove, runTransaction, set } from "firebase/database";
import { useContext, useEffect, useRef, useState } from "react";
import { GlobalInfoContext } from "../context/globalInfo";
import { subscribeWithPermissionRetry } from "../utils/firebaseListeners";
import { getChurchDataPath } from "../utils/firebasePaths";
import {
  buildMediaPreparationManifest,
  getMediaPreparationManifestStructure,
  isMediaPreparationManifest,
  isMediaPreparationReadinessReport,
  type MediaPreparationManifest,
  type MediaPreparationReadinessReport,
} from "../utils/mediaPreparationManifest";
import type { ElectronMediaDiscovery } from "../utils/electronMediaSurfaceDiagnostics";
import { getOrCreateDeviceId } from "../utils/authStorage";
import { isHLSVideoSource } from "../utils/isInstantVideoSource";
import { isPlayableMediaSource } from "../utils/mediaSource";

const getManifestPath = (churchId: string, outputId: string) =>
  getChurchDataPath(
    churchId,
    "presentation",
    "mediaPreparation",
    encodeURIComponent(outputId),
  );

const getStorageKey = (churchId: string, outputId: string) =>
  `worshipsync:media-preparation:${churchId}:${outputId}`;

export type MediaPreparationPublicationStatus = {
  outputId: string;
  state: "publishing" | "published" | "failed";
  desiredRevision?: number;
  publishedAt: number;
  error?: string;
};

const getPublicationStatusKey = (churchId: string, outputId: string) =>
  `worshipsync:media-preparation-publication:${churchId}:${outputId}`;

export const readMediaPreparationPublicationStatus = (
  churchId: string | undefined,
  outputId: string | undefined,
): MediaPreparationPublicationStatus | undefined => {
  if (!churchId || !outputId) return undefined;
  try {
    const value = JSON.parse(localStorage.getItem(getPublicationStatusKey(churchId, outputId)) ?? "null");
    return value && value.outputId === outputId &&
      (value.state === "publishing" || value.state === "published" || value.state === "failed") &&
      typeof value.publishedAt === "number"
      ? value as MediaPreparationPublicationStatus
      : undefined;
  } catch {
    return undefined;
  }
};

const publishManifestStatus = (
  churchId: string,
  status: MediaPreparationPublicationStatus,
) => {
  try {
    localStorage.setItem(
      getPublicationStatusKey(churchId, status.outputId),
      JSON.stringify(status),
    );
  } catch {
    // Diagnostics remain optional if browser storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent("worship-sync-media-manifest-publish-status", { detail: status }));
};

export const getMediaPreparationReadinessPath = (
  churchId: string,
  outputId: string,
) => getChurchDataPath(
  churchId,
  "presentation",
  "mediaPreparationReadiness",
  encodeURIComponent(outputId),
);

const mediaPreparationSessionId = typeof crypto !== "undefined" && crypto.randomUUID
  ? crypto.randomUUID()
  : `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

export const useReportRemoteMediaPreparationReadiness = ({
  enabled,
  outputId,
  manifest,
  source,
  manifestReceivedAt,
  candidateCount,
  finiteCandidateCount,
  pendingCacheCount,
  readyCount,
  preparingCount,
  failedCount,
  errors,
}: Omit<MediaPreparationReadinessReport, "contract" | "version" | "outputId" | "deviceId" | "sessionId" | "reportedAt" | "manifestRevision" | "manifestReceivedAt"> & {
  enabled: boolean;
  outputId?: string;
  manifest?: MediaPreparationManifest;
  manifestReceivedAt?: number;
}) => {
  const { firebaseDb, churchId, sharedDataReady } = useContext(GlobalInfoContext) || {};
  const latestReportRef = useRef<MediaPreparationReadinessReport | undefined>(undefined);
  const lastSignatureRef = useRef("");
  const lastWriteAtRef = useRef(0);
  const writeInFlightRef = useRef(false);
  const report: MediaPreparationReadinessReport | undefined = outputId
    ? {
        contract: "worshipsync.media-preparation-readiness",
        version: 1,
        outputId,
        deviceId: getOrCreateDeviceId(),
        sessionId: mediaPreparationSessionId,
        reportedAt: Date.now(),
        manifestRevision: manifest?.revision ?? null,
        manifestReceivedAt: manifest ? manifestReceivedAt ?? null : null,
        source,
        candidateCount,
        finiteCandidateCount,
        pendingCacheCount,
        readyCount,
        preparingCount,
        failedCount,
        errors: errors.slice(0, 8).map((error) => error.slice(0, 180)),
      }
    : undefined;

  latestReportRef.current = report;

  useEffect(() => {
    if (!enabled || !outputId || !firebaseDb || !churchId || !sharedDataReady) return;
    let active = true;
    const reportRef = ref(
      firebaseDb,
      `${getMediaPreparationReadinessPath(churchId, outputId)}/${encodeURIComponent(getOrCreateDeviceId())}/${encodeURIComponent(mediaPreparationSessionId)}`,
    );
    void onDisconnect(reportRef).remove().catch(() => undefined);
    const publishIfChanged = () => {
      const latest = latestReportRef.current;
      if (!active || !latest || writeInFlightRef.current) return;
      const signature = JSON.stringify({ ...latest, reportedAt: undefined });
      if (
        signature === lastSignatureRef.current &&
        Date.now() - lastWriteAtRef.current < 14_000
      ) return;
      writeInFlightRef.current = true;
      const value = { ...latest, reportedAt: Date.now() };
      void set(reportRef, value).then(() => {
        lastSignatureRef.current = signature;
        lastWriteAtRef.current = Date.now();
        if (!active) void remove(reportRef).catch(() => undefined);
      }).catch(() => {
        // A denied/unavailable feedback write must not affect presentation.
      }).finally(() => {
        writeInFlightRef.current = false;
      });
    };
    publishIfChanged();
    const interval = window.setInterval(publishIfChanged, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
      void remove(reportRef).catch(() => undefined);
    };
  }, [churchId, enabled, firebaseDb, outputId, sharedDataReady]);
};

export const useRemoteMediaPreparationReadinessReports = ({
  enabled,
  outputId,
}: {
  enabled: boolean;
  outputId?: string;
}) => {
  const { firebaseDb, churchId, sharedDataReady } = useContext(GlobalInfoContext) || {};
  const [reports, setReports] = useState<MediaPreparationReadinessReport[]>([]);
  useEffect(() => {
    setReports([]);
    if (!enabled || !outputId || !firebaseDb || !churchId || !sharedDataReady) return;
    let active = true;
    const unsubscribe = onValue(
      ref(firebaseDb, getMediaPreparationReadinessPath(churchId, outputId)),
      (snapshot) => {
        if (!active) return;
        const value = snapshot.val();
        if (!value || typeof value !== "object") {
          setReports([]);
          return;
        }
        const nextReports: MediaPreparationReadinessReport[] = [];
        Object.entries(value as Record<string, unknown>).forEach(([deviceId, deviceValue]) => {
          if (!deviceValue || typeof deviceValue !== "object") return;
          Object.entries(deviceValue as Record<string, unknown>).forEach(([sessionId, candidate]) => {
            if (
              isMediaPreparationReadinessReport(candidate) &&
              candidate.outputId === outputId &&
              encodeURIComponent(candidate.deviceId) === deviceId &&
              encodeURIComponent(candidate.sessionId) === sessionId &&
              Date.now() - candidate.reportedAt <= 24 * 60 * 60_000
            ) nextReports.push(candidate);
          });
        });
        setReports(nextReports.sort((left, right) => right.reportedAt - left.reportedAt));
      },
      () => {
        if (active) setReports([]);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [churchId, enabled, firebaseDb, outputId, sharedDataReady]);
  return reports;
};

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
  const [manifestReceivedAt, setManifestReceivedAt] = useState<number>();
  const [cacheMap, setCacheMap] = useState<Record<string, string>>({});
  const manifestRef = useRef<MediaPreparationManifest | undefined>(undefined);

  useEffect(() => {
    const cachedManifest = readCachedManifest(churchId, outputId);
    manifestRef.current = cachedManifest;
    setManifest(cachedManifest);
    setManifestReceivedAt(undefined);
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
          if (value == null) {
            manifestRef.current = undefined;
            setManifest(undefined);
            setManifestReceivedAt(Date.now());
            setCacheMap({});
            try {
              localStorage.removeItem(getStorageKey(churchId, outputId));
            } catch {
              // The live state is still cleared if storage is unavailable.
            }
            return;
          }
          // Ignore malformed or unsupported payloads and keep the last valid
          // manifest available to the stage during transient transport errors.
          return;
        }
        if (manifestRef.current && value.revision < manifestRef.current.revision) return;
        manifestRef.current = value;
        setManifest(value);
        setManifestReceivedAt(Date.now());
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
    const sources = [...new Set(manifest.items.flatMap((item) =>
      item.media.map((media) => media.source.url),
    ))];
    if (sources.length === 0) return;
    const retryDelays = [1000, 3000, 8000];
    const attempts = new Map<string, number>();
    const timers = new Map<string, number>();
    const ensureSource = async (source: string) => {
      if (!active || !window.electronAPI?.ensureMediaCached) return;
      const attempt = (attempts.get(source) ?? 0) + 1;
      attempts.set(source, attempt);
      try {
        const result = await window.electronAPI.ensureMediaCached([source]);
        if (!active) return;
        const cached = result.cacheMap[source];
        if (cached && !isHLSVideoSource(cached) && isPlayableMediaSource(cached)) {
          setCacheMap((current) => ({ ...current, [source]: cached }));
          attempts.delete(source);
          return;
        }
      } catch {
        // A failed cache warm is reported through readiness telemetry. The
        // existing poster/video fallback remains authoritative.
      }
      if (!active || !isHLSVideoSource(source) || attempt > retryDelays.length) return;
      const timer = window.setTimeout(() => {
        timers.delete(source);
        void ensureSource(source);
      }, retryDelays[attempt - 1]);
      timers.set(source, timer);
    };
    void Promise.all(sources.map(ensureSource));
    return () => {
      active = false;
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, [enabled, manifest]);

  return { manifest, cacheMap, manifestReceivedAt };
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
    const desiredManifest = buildMediaPreparationManifest({
      discovery,
      outputId,
      previous: revisionBaseline,
      publishedAt,
    });
    let active = true;
    publishManifestStatus(churchId, {
      outputId,
      state: "publishing",
      desiredRevision: desiredManifest.revision,
      publishedAt,
    });
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
          if (active) publishManifestStatus(churchId, {
            outputId,
            state: "failed",
            desiredRevision: desiredManifest.revision,
            publishedAt: Date.now(),
            error: "Manifest transaction did not return a valid published revision",
          });
          return;
        }
        manifestDrafts.set(key, committed);
        if (active) publishManifestStatus(churchId, {
          outputId,
          state: "published",
          desiredRevision: committed.revision,
          publishedAt: Date.now(),
        });
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
        publishManifestStatus(churchId, {
          outputId,
          state: "failed",
          desiredRevision: desiredManifest.revision,
          publishedAt: Date.now(),
          error: "Unable to publish the video preparation manifest",
        });
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
