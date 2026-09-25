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
import { isFirebasePermissionDenied } from "../utils/firebaseListeners";

export const MEDIA_READINESS_STATUS_EVENT = "worship-sync-media-readiness-status";
export type MediaReadinessLocalStatus = {
  outputId: string;
  churchId?: string;
  state: "reporting" | "connected" | "disconnected" | "temporarily-unavailable" | "permission-denied" | "subscribing";
};

const publishReadinessLocalStatus = (status: MediaReadinessLocalStatus) => {
  window.dispatchEvent(new CustomEvent(MEDIA_READINESS_STATUS_EVENT, { detail: status }));
};

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
  state: "publishing" | "retrying" | "published" | "failed";
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
      (value.state === "publishing" || value.state === "retrying" || value.state === "published" || value.state === "failed") &&
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
  excludedCount,
  readyCount,
  preparingCount,
  failedCount,
  pendingCacheFailedCount,
  excludedFailedCount,
  errors,
}: Omit<MediaPreparationReadinessReport, "contract" | "version" | "outputId" | "deviceId" | "sessionId" | "reportedAt" | "manifestRevision" | "manifestReceivedAt"> & {
  enabled: boolean;
  outputId?: string;
  manifest?: MediaPreparationManifest;
  manifestReceivedAt?: number;
}) => {
  const { firebaseDb, churchId, sharedDataReady } = useContext(GlobalInfoContext) || {};
  const latestReportRef = useRef<MediaPreparationReadinessReport | undefined>(undefined);
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
        excludedCount,
        readyCount,
        preparingCount,
        failedCount,
        pendingCacheFailedCount,
        excludedFailedCount,
        errors: errors.slice(0, 8).map((error) => error.slice(0, 180)),
      }
    : undefined;

  latestReportRef.current = report;

  useEffect(() => {
    if (!enabled || !outputId || !firebaseDb || !churchId || !sharedDataReady) return;
    let active = true;
    let writeInFlight = false;
    let permissionBlocked = false;
    let retryExhausted = false;
    let retryAttempt = 0;
    let retryTimer: number | undefined;
    let lastSignature = "";
    let failedSignature = "";
    let lastWriteAt = 0;
    let connectionState: boolean | undefined;
    const reportRef = ref(
      firebaseDb,
      `${getMediaPreparationReadinessPath(churchId, outputId)}/${encodeURIComponent(getOrCreateDeviceId())}/${encodeURIComponent(mediaPreparationSessionId)}`,
    );
    void onDisconnect(reportRef).remove().catch(() => undefined);
    const publishIfChanged = () => {
      const latest = latestReportRef.current;
      if (!active || !latest || writeInFlight || permissionBlocked) return;
      const signature = JSON.stringify({ ...latest, reportedAt: undefined });
      if (retryExhausted && signature !== failedSignature) {
        retryExhausted = false;
        retryAttempt = 0;
      }
      if (retryExhausted) return;
      if (
        signature === lastSignature &&
        Date.now() - lastWriteAt < 14_000
      ) return;
      writeInFlight = true;
      const value = { ...latest, reportedAt: Date.now() };
      publishReadinessLocalStatus({ outputId, churchId, state: "reporting" });
      void set(reportRef, value).then(() => {
        if (!active) {
          void remove(reportRef).catch(() => undefined);
          return;
        }
        retryAttempt = 0;
        retryExhausted = false;
        failedSignature = "";
        lastSignature = signature;
        lastWriteAt = Date.now();
        publishReadinessLocalStatus({ outputId, churchId, state: "reporting" });
      }).catch((error) => {
        if (!active) return;
        if (isFirebasePermissionDenied(error)) {
          permissionBlocked = true;
          publishReadinessLocalStatus({ outputId, churchId, state: "permission-denied" });
          return;
        }
        publishReadinessLocalStatus({ outputId, churchId, state: "temporarily-unavailable" });
        const delays = [1000, 3000, 10000];
        const delay = delays[retryAttempt];
        if (delay !== undefined && retryTimer === undefined) {
          retryAttempt += 1;
          retryTimer = window.setTimeout(() => {
            retryTimer = undefined;
            publishIfChanged();
          }, delay);
        } else {
          retryExhausted = true;
          failedSignature = signature;
        }
      }).finally(() => {
        writeInFlight = false;
      });
    };
    const unsubscribeConnection = onValue(ref(firebaseDb, ".info/connected"), (snapshot) => {
      if (!active) return;
      const connected = snapshot.val() === true;
      if (!connected) {
        connectionState = false;
        publishReadinessLocalStatus({ outputId, churchId, state: "disconnected" });
        return;
      }
      const reconnected = connectionState === false;
      connectionState = true;
      if (reconnected) {
        retryExhausted = false;
        failedSignature = "";
      }
      permissionBlocked = false;
      retryAttempt = 0;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      retryTimer = undefined;
      publishIfChanged();
    });
    const retryOnOffline = () => publishReadinessLocalStatus({ outputId, churchId, state: "disconnected" });
    const retryOnOnline = () => {
      permissionBlocked = false;
      retryExhausted = false;
      failedSignature = "";
      retryAttempt = 0;
      publishIfChanged();
    };
    window.addEventListener("online", retryOnOnline);
    window.addEventListener("offline", retryOnOffline);
    publishIfChanged();
    const interval = window.setInterval(publishIfChanged, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("online", retryOnOnline);
      window.removeEventListener("offline", retryOnOffline);
      unsubscribeConnection?.();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      void remove(reportRef).catch(() => undefined);
      publishReadinessLocalStatus({ outputId, churchId, state: "disconnected" });
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
  const subscriptionKey = `${churchId ?? ""}/${outputId ?? ""}`;
  const [reportState, setReportState] = useState<{ key: string; reports: MediaPreparationReadinessReport[] }>({ key: "", reports: [] });
  useEffect(() => {
    setReportState({ key: subscriptionKey, reports: [] });
    if (!enabled || !outputId || !firebaseDb || !churchId || !sharedDataReady) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeConnection: (() => void) | undefined;
    let retryTimer: number | undefined;
    let transientAttempt = 0;
    const pruneTimer = window.setInterval(() => {
      setReportState((current) => {
        if (current.key !== subscriptionKey) return current;
        const fresh = current.reports.filter((report) => Date.now() - report.reportedAt <= 24 * 60 * 60_000);
        return fresh.length === current.reports.length ? current : { key: subscriptionKey, reports: fresh };
      });
    }, 60_000);
    const path = getMediaPreparationReadinessPath(churchId, outputId);
    const subscribeConnection = () => onValue(ref(firebaseDb, ".info/connected"), (snapshot) => {
      if (!active) return;
      publishReadinessLocalStatus({ outputId, churchId, state: snapshot.val() === true ? "connected" : "disconnected" });
    });
    const attach = () => {
      if (!active) return;
      publishReadinessLocalStatus({ outputId, churchId, state: "subscribing" });
      unsubscribe = subscribeWithPermissionRetry(
      firebaseDb,
      path,
      (snapshot) => {
        if (!active) return;
        transientAttempt = 0;
        publishReadinessLocalStatus({ outputId, churchId, state: "reporting" });
        const value = snapshot.val();
        if (!value || typeof value !== "object") {
          setReportState({ key: subscriptionKey, reports: [] });
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
        setReportState({ key: subscriptionKey, reports: nextReports.sort((left, right) => right.reportedAt - left.reportedAt) });
      },
      {
        label: `media-preparation-readiness:${outputId}`,
        onPermissionDenied: () => {
          if (active) publishReadinessLocalStatus({ outputId, churchId, state: "permission-denied" });
        },
        onError: () => {
          if (!active) return;
          publishReadinessLocalStatus({ outputId, churchId, state: "temporarily-unavailable" });
          const delays = [1000, 3000, 10000];
          const delay = delays[transientAttempt];
          if (delay === undefined || retryTimer !== undefined) return;
          transientAttempt += 1;
          retryTimer = window.setTimeout(() => {
            retryTimer = undefined;
            unsubscribe?.();
            attach();
          }, delay);
        },
      },
      );
    };
    const retryOnOnline = () => {
      transientAttempt = 0;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      retryTimer = undefined;
      unsubscribe?.();
      attach();
    };
    attach();
    unsubscribeConnection = subscribeConnection();
    window.addEventListener("online", retryOnOnline);
    return () => {
      active = false;
      window.removeEventListener("online", retryOnOnline);
      unsubscribeConnection?.();
      window.clearInterval(pruneTimer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      unsubscribe?.();
    };
  }, [churchId, enabled, firebaseDb, outputId, sharedDataReady, subscriptionKey]);
  return reportState.key === subscriptionKey ? reportState.reports : [];
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
    let retryTimer: number | undefined;
    let resolveScheduledRetry: (() => void) | undefined;
    const retryDelays = [1000, 3000, 10000];
    const publishAttempt = (attempt: number): Promise<void> => {
      if (!active || manifestPublicationGenerations.get(key) !== generation) return Promise.resolve();
      return runTransaction(
        ref(firebaseDb, path),
        (current: unknown) => {
          if (manifestPublicationGenerations.get(key) !== generation) return current;
          const serverPrevious = isMediaPreparationManifest(current) && current.outputId === outputId
            ? current
            : undefined;
          const candidate = buildMediaPreparationManifest({
            discovery,
            outputId,
            previous: serverPrevious ?? revisionBaseline,
            publishedAt,
          });
          if (serverPrevious && getMediaPreparationManifestStructure(serverPrevious) === getMediaPreparationManifestStructure(candidate)) {
            return serverPrevious;
          }
          return candidate;
        },
      ).then((result) => {
        if (!active || manifestPublicationGenerations.get(key) !== generation) return;
        const committed = result.snapshot.val();
        if (!isMediaPreparationManifest(committed) || committed.outputId !== outputId) {
          throw new Error("Manifest transaction did not return a valid published revision");
        }
        manifestDrafts.set(key, committed);
        publishManifestStatus(churchId, {
          outputId,
          state: "published",
          desiredRevision: committed.revision,
          publishedAt: Date.now(),
        });
        try {
          localStorage.setItem(key, JSON.stringify(committed));
        } catch {
          // Publishing remains successful even when this renderer cannot cache.
        }
      }).catch((error) => {
        if (!active || manifestPublicationGenerations.get(key) !== generation) return;
        const delay = isFirebasePermissionDenied(error) ? undefined : retryDelays[attempt];
        if (delay !== undefined) {
          publishManifestStatus(churchId, {
            outputId,
            state: "retrying",
            desiredRevision: desiredManifest.revision,
            publishedAt: Date.now(),
            error: `Temporary publish failure; retry ${attempt + 1}/${retryDelays.length}`,
          });
          return new Promise<void>((resolve) => {
            resolveScheduledRetry = resolve;
            retryTimer = window.setTimeout(() => {
              retryTimer = undefined;
              resolveScheduledRetry = undefined;
              void publishAttempt(attempt + 1).then(resolve);
            }, delay);
          });
        }
        if (manifestPublicationGenerations.get(key) === generation) manifestDrafts.delete(key);
        publishManifestStatus(churchId, {
          outputId,
          state: "failed",
          desiredRevision: desiredManifest.revision,
          publishedAt: Date.now(),
          error: isFirebasePermissionDenied(error)
            ? "Manifest publication is blocked by Firebase permissions"
            : "Unable to publish the video preparation manifest after bounded retries",
        });
        console.error("Unable to publish media preparation manifest:", error);
      });
    };
    const write = previousWrite.catch(() => undefined).then(() => publishAttempt(0));
    manifestWriteQueues.set(key, write.then(() => undefined, () => undefined));
    return () => {
      active = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      resolveScheduledRetry?.();
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
