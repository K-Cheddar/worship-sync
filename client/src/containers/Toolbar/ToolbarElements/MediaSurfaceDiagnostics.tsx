import { Activity, Copy, RotateCw } from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import cn from "classnames";
import Drawer from "../../../components/Drawer/Drawer";
import Button from "../../../components/Button/Button";
import { useSelector } from "../../../hooks";
import { selectDisplayOutputs } from "../../../store/displayOutputsSlice";
import {
  closeElectronMediaSurfaceDiagnostics,
  requestElectronMediaSurfaceDiagnostics,
  requestElectronMediaSurfaceRetry,
  subscribeToElectronMediaSurfaceDiagnostics,
  type ElectronMediaSurfacePoolDiagnostics,
} from "../../../utils/electronMediaSurfaceDiagnostics";
import type { PreparedVideoMetrics } from "../../../types/electron";
import { GlobalInfoContext } from "../../../context/globalInfo";
import {
  MEDIA_READINESS_STATUS_EVENT,
  readMediaPreparationPublicationStatus,
  useRemoteMediaPreparationReadinessReports,
  type MediaPreparationPublicationStatus,
  type MediaReadinessLocalStatus,
} from "../../../hooks/useMediaPreparationManifest";
import type { MediaPreparationReadinessReport } from "../../../utils/mediaPreparationManifest";

type ReceivedDiagnostics = ElectronMediaSurfacePoolDiagnostics & {
  receivedAt: number;
};

const METRICS_STALE_MS = 12_000;
const DIAGNOSTICS_STALE_MS = 15_000;

const formatMetric = (
  value: PreparedVideoMetrics["memory"] | undefined,
  unit: "MB" | "%",
): string => {
  if (value?.status !== "available" || typeof value.value !== "number") {
    return value?.reason ?? "Unavailable";
  }
  return unit === "MB"
    ? `≈${(value.value / 1024).toFixed(0)} MB`
    : `${value.value.toFixed(1)}%`;
};

export const removeSensitiveQueryParameters = (value: string): string => {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/s--[^/]+--(?=\/|$)/gi, "/s--[redacted]--");
    return url.toString();
  } catch {
    return value.replace(/[?#].*$/, "");
  }
};

const secretField = /(?:^|[-_])(?:authorization|proxy-authorization|auth|cookie|set-cookie|token|secret|credential|password|signature|sig|key)(?:$|[-_])|(?:access|refresh|id|api|private|client)[-_]?(?:token|secret|key)|x[-_](?:amz|goog)[-_]/i;

export const sanitizeForCopy = (value: unknown, key = ""): unknown => {
  const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  if (normalizedKey !== "media-key" && secretField.test(normalizedKey)) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    return value
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, removeSensitiveQueryParameters)
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
      .replace(/\b((?:access|refresh|id)?token|api[-_]?key|auth[-_]?key|key|sig(?:nature)?|secret|credential|password|cookie|x-amz-(?:credential|signature|security-token)|x-goog-(?:credential|signature|security-token))\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
  }
  if (Array.isArray(value)) return value.map((entry) => sanitizeForCopy(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([childKey, child]) => [
      childKey,
      sanitizeForCopy(child, childKey),
    ]),
  );
};

const getOutputName = (
  entry: ReceivedDiagnostics,
  outputs: ReturnType<typeof selectDisplayOutputs>,
) => {
  if (entry.windowRole === "editor") return "Editor Preview";
  const output = outputs.find((candidate) => candidate.id === entry.outputId);
  return output?.name ?? entry.outputId ?? entry.windowRole;
};

const getInventoryCount = (entry: ReceivedDiagnostics) =>
  entry.discovery?.uniqueVideoInventoryCount ??
  new Set((entry.candidateDetails ?? []).map((candidate) => candidate.mediaKey)).size;

const getFiniteCount = (entry: ReceivedDiagnostics) =>
  entry.discovery?.finitePlayableSourceCount ??
  new Set(
    (entry.candidateDetails ?? [])
      .filter((candidate) => candidate.status === "eligible")
      .map((candidate) => candidate.mediaKey),
  ).size;

const getPreparedKeys = (entry: ReceivedDiagnostics) =>
  new Set(
    entry.surfaces
      .filter((surface) => surface.phase === "ready" || surface.phase === "playing")
      .map((surface) => surface.mediaKey),
  );

const getActionIssues = (entry: ReceivedDiagnostics): string[] => {
  const issues: string[] = [];
  if (entry.discovery?.outlineLoadState === "retrying") {
    issues.push(entry.discovery.outlineLoadError || "Waiting for service items to replicate");
  }
  if (entry.discovery?.outlineLoadState === "error") {
    issues.push(entry.discovery.outlineLoadError || "The service video inventory is incomplete");
  }
  const failed = entry.surfaces.filter((surface) => surface.phase === "error");
  failed.slice(0, 3).forEach((surface) => {
    issues.push(`${surface.mediaKey}: ${surface.error || "video could not be prepared"}`);
  });
  if (failed.length > 3) issues.push(`${failed.length - 3} more video preparation failures`);
  return issues;
};

const MediaSurfaceDiagnostics = ({ className }: { className?: string }) => {
  const [open, setOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Record<string, ReceivedDiagnostics>>({});
  const [remoteReadinessReports, setRemoteReadinessReports] = useState<Record<string, MediaPreparationReadinessReport[]>>({});
  const [metrics, setMetrics] = useState<PreparedVideoMetrics>();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const displayOutputs = useSelector(selectDisplayOutputs);

  useEffect(() => subscribeToElectronMediaSurfaceDiagnostics((next) => {
    const key = next.diagnosticId ?? `${next.outputId || ""}:${next.windowRole}`;
    setDiagnostics((current) => ({
      ...current,
      [key]: { ...next, receivedAt: Date.now() },
    }));
  }), []);

  useEffect(() => {
    if (!open) return;
    const api = window.electronAPI;
    const unsubscribeMetrics = api?.onPreparedVideoMetrics?.(setMetrics);
    void api?.subscribePreparedVideoMetrics?.().catch(() => undefined);
    requestElectronMediaSurfaceDiagnostics();
    const intervalId = window.setInterval(() => {
      requestElectronMediaSurfaceDiagnostics();
      setDiagnostics((current) => {
        const cutoff = Date.now() - DIAGNOSTICS_STALE_MS;
        return Object.fromEntries(
          Object.entries(current).filter(([, value]) => value.receivedAt >= cutoff),
        );
      });
      setMetrics((current) =>
        current?.timestamp && Date.now() - current.timestamp > METRICS_STALE_MS
          ? { ...current, status: "stale", reason: "Metrics are stale; waiting for the next app sample" }
          : current,
      );
    }, 4000);
    return () => {
      window.clearInterval(intervalId);
      unsubscribeMetrics?.();
      void api?.unsubscribePreparedVideoMetrics?.().catch(() => undefined);
      closeElectronMediaSurfaceDiagnostics();
    };
  }, [open]);

  const entries = useMemo(
    () => Object.values(diagnostics).sort((left, right) => {
      const leftName = getOutputName(left, displayOutputs);
      const rightName = getOutputName(right, displayOutputs);
      return leftName.localeCompare(rightName) || left.windowRole.localeCompare(right.windowRole);
    }),
    [diagnostics, displayOutputs],
  );
  const outputEntries = entries.filter((entry) => entry.windowRole !== "editor" && !entry.windowRole.endsWith("preview"));
  const editorPreviewEntries = entries.filter((entry) => entry.windowRole === "editor" || entry.windowRole.endsWith("preview"));
  const issues = outputEntries.reduce((count, entry) => count + getActionIssues(entry).length, 0);
  const toolbarSummary = outputEntries.length === 1
    ? `Videos · ${getPreparedKeys(outputEntries[0]).size}/${getInventoryCount(outputEntries[0])}`
    : issues > 0
      ? `Videos · ${issues} issue${issues === 1 ? "" : "s"}`
      : "Videos";
  const metricAvailable = metrics?.status === "available" && metrics.total;
  const { churchId } = useContext(GlobalInfoContext) || {};
  const receiveRemoteReports = useCallback((outputId: string, reports: MediaPreparationReadinessReport[]) => {
    setRemoteReadinessReports((current) => {
      const previous = current[outputId] ?? [];
      const unchanged = previous.length === reports.length && previous.every((report, index) => report === reports[index]);
      return unchanged ? current : { ...current, [outputId]: reports };
    });
  }, []);
  useEffect(() => {
    if (!open) setRemoteReadinessReports({});
  }, [open]);
  const electronMetricsLabel = !window.electronAPI
    ? "Unavailable — Electron only"
    : metricAvailable
      ? `App CPU ${formatMetric(metrics!.total!.cpu, "%")} · App RAM ${formatMetric(metrics!.total!.memory, "MB")}`
      : metrics?.status === "stale"
        ? "Metrics are stale"
        : metrics?.timestamp
          ? `App CPU ${formatMetric(metrics.total?.cpu, "%")} · App RAM ${formatMetric(metrics.total?.memory, "MB")}`
          : "Measuring app usage…";

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(sanitizeForCopy({
        generatedAt: new Date().toISOString(),
        appProcesses: metrics,
        outputs: entries,
        remoteReadiness: remoteReadinessReports,
      }), null, 2));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <>
      <Button
        svg={Activity}
        variant="tertiary"
        className={cn("shrink-0 text-xs", className)}
        onClick={() => setOpen(true)}
        aria-label="Open video readiness diagnostics"
        aria-expanded={open}
        data-testid="media-surface-diagnostics-trigger"
      >
        {toolbarSummary}
      </Button>
      <Drawer
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Video readiness"
        position="right"
        size="lg"
        contentClassName="min-h-0 overflow-auto"
      >
        <div className="space-y-4 text-sm text-gray-200" data-testid="media-surface-diagnostics-panel">
          <section className="rounded border border-gray-700 px-3 py-2" aria-label="Computer health">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-white">This computer</h2>
              <span className="text-xs text-gray-400">
                {electronMetricsLabel}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Approximate total across WorshipSync Electron processes. Working sets can overlap through shared memory; CPU can exceed 100% on multicore computers.
            </p>
          </section>

          {!outputEntries.length && (
            <p className="text-gray-400">No output has reported video readiness on this computer yet.</p>
          )}
          {outputEntries.map((entry) => {
            const inventoryCount = getInventoryCount(entry);
            const finiteCount = getFiniteCount(entry);
            const preparedCount = getPreparedKeys(entry).size;
            const pendingCount = entry.discovery?.pendingHlsCacheCount ?? entry.pendingCacheCount;
            const excludedCount = entry.discovery?.intentionallyExcludedVideoCount ?? 0;
            const activeSurface = entry.lastMediaKey
              ? entry.surfaces.find((surface) => surface.mediaKey === entry.lastMediaKey)
              : undefined;
            const playingHealthy = Boolean(activeSurface?.phase === "playing" || entry.playingCount > 0);
            const loadState = entry.discovery?.outlineLoadState;
            const inventoryIssue = loadState === "retrying" || loadState === "error";
            const actionIssues = getActionIssues(entry);
            const plan = entry.preparationSource === "server-manifest"
              ? entry.manifestOutlineName || entry.manifestOutlineId
              : entry.discovery?.targetOutlineName || entry.discovery?.loadedOutlineName || entry.discovery?.targetOutlineId || "No service plan selected";
            const receivedAt = Date.now() - entry.receivedAt;

            return (
              <section key={entry.diagnosticId ?? `${entry.outputId || ""}:${entry.windowRole}`} className="rounded border border-gray-700 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-white">{getOutputName(entry, displayOutputs)}</h2>
                    <p className="text-xs text-gray-400">Preparing: {plan}</p>
                  </div>
                  <span className={cn("rounded px-2 py-1 text-xs", actionIssues.length ? "bg-red-950 text-red-200" : "bg-emerald-950 text-emerald-200")}>
                    {actionIssues.length ? `${actionIssues.length} issue${actionIssues.length === 1 ? "" : "s"}` : "No action needed"}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                  <Count label="Distinct videos" value={inventoryCount} help="Unique media identities across the complete service video inventory." />
                  <Count label="Finite playable" value={finiteCount} help="Distinct videos with a finite playable source. Pending HLS sources are not counted here." />
                  <Count label="Prepared" value={preparedCount} help="Distinct videos with a prepared starting frame, including a video already playing." />
                  <Count label="Preparing" value={entry.preparingCount} help="Mounted output surfaces currently loading or decoding a starting frame." />
                  <Count label="Pending cache" value={pendingCount} help="HLS videos waiting for a finite cached rendition." />
                  <Count label="Failed" value={entry.errorCount + (loadState === "error" ? 1 : 0)} />
                  <Count label="Excluded" value={excludedCount} help="Distinct video sources that cannot be prepared as finite video." />
                  <Count label="Selected surfaces" value={entry.surfaceCount} help="Surfaces mounted in this output's bounded preparation pool; this is not the plan's video count." />
                </dl>

                <p className="mt-3 text-xs text-gray-300">
                  Playing video: <Status good={playingHealthy}>{playingHealthy ? "Frames advancing" : activeSurface?.phase === "error" ? "Needs attention" : "No video playing"}</Status>
                  <span className="mx-2 text-gray-600">·</span>
                  Source: <Status good={entry.preparationSource === "server-manifest" || entry.preparationSource === "local-pouchdb"}>{entry.preparationSource === "server-manifest" ? `Received remote manifest${entry.manifestRevision ? ` r${entry.manifestRevision}` : ""}` : entry.preparationSource === "cached-manifest" ? `Cached manifest${entry.manifestRevision ? ` r${entry.manifestRevision}` : ""} · live receipt pending` : entry.preparationSource === "local-pouchdb" ? "Local discovery" : entry.preparationSource === "local-fallback" ? "Local fallback" : "Waiting for source"}</Status>
                  <span className="mx-2 text-gray-600">·</span>
                  Report: {receivedAt <= DIAGNOSTICS_STALE_MS ? "Connected" : "Stale"}
                </p>

                {inventoryIssue && (
                  <p className="mt-2 text-xs text-amber-200" role="status">
                    {entry.discovery?.outlineLoadError || "Service video inventory is still loading."}
                    {entry.discovery?.missingItemIds?.length ? ` · ${entry.discovery.missingItemIds.length} item${entry.discovery.missingItemIds.length === 1 ? "" : "s"} missing` : ""}
                  </p>
                )}
                {actionIssues.length > 0 && (
                  <div className="mt-3 space-y-2" role="alert">
                    {actionIssues.slice(0, 3).map((issue) => <p key={issue} className="break-words text-xs text-red-200">{issue}</p>)}
                    <Button svg={RotateCw} variant="secondary" className="text-xs" onClick={() => requestElectronMediaSurfaceRetry({
                      outputId: entry.outputId,
                      mediaKeys: entry.surfaces.filter((surface) => surface.phase === "error").map((surface) => surface.mediaKey),
                    })}>
                      Retry preparation
                    </Button>
                  </div>
                )}

                {(inventoryIssue || entry.discovery?.targetOutlineId !== entry.discovery?.loadedOutlineId) && (
                  <p className="mt-2 text-xs text-gray-400">
                    Requested plan: {entry.discovery?.targetOutlineName || entry.discovery?.targetOutlineId || "—"}
                    {entry.discovery?.loadedOutlineId ? ` · Last loaded: ${entry.discovery.loadedOutlineName || entry.discovery.loadedOutlineId}` : ""}
                  </p>
                )}

                <details className="mt-3 border-t border-gray-700 pt-2">
                  <summary className="cursor-pointer text-xs font-medium text-gray-300">Advanced diagnostics</summary>
                  <div className="mt-3 space-y-3 text-xs text-gray-300">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Metric label="App CPU" value={formatMetric(metrics?.total?.cpu, "%")} />
                      <Metric label="App RAM" value={formatMetric(metrics?.total?.memory, "MB")} />
                      <Metric label="Pool capacity" value={entry.poolCapacity ?? "—"} />
                      <Metric label="Selected candidates" value={entry.candidateCount} />
                      <Metric label="Transition path" value={(entry.renderPath || entry.lastSendPath || "—").toUpperCase()} />
                      <Metric label="Last manifest change" value={entry.manifestPublishedAt ? new Date(entry.manifestPublishedAt).toLocaleString() : "—"} />
                      <Metric label="Inventory state" value={entry.discovery?.inventoryState || "—"} />
                      <Metric label="Requested outline ID" value={entry.discovery?.targetOutlineId || "—"} />
                      <Metric label="Loaded outline ID" value={entry.discovery?.loadedOutlineId || "—"} />
                      <Metric label="Current item ID" value={entry.currentItemId || "—"} />
                      <Metric label="Current item videos" value={entry.currentItemVideoCount ?? "—"} />
                      <Metric label="Evicted surfaces" value={entry.evictions.length} />
                    </div>
                    <details>
                      <summary className="cursor-pointer">Electron process breakdown ({metrics?.processes?.length ?? 0})</summary>
                      <p className="mt-1 text-gray-400">Working set is an approximate sum and can include shared memory. CPU is app-process CPU and may exceed 100%.</p>
                      <div className="mt-2 space-y-1">
                        {(metrics?.processes ?? []).map((process) => (
                          <p key={process.pid}>{process.labels.join(", ") || process.processType} (PID {process.pid}) · CPU {formatMetric(process.cpu, "%")} · RAM {formatMetric(process.memory, "MB")}</p>
                        ))}
                      </div>
                    </details>
                    <details>
                      <summary className="cursor-pointer">Candidate details ({entry.candidateDetails?.length ?? 0})</summary>
                      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-[11px]">{JSON.stringify(sanitizeForCopy(entry.candidateDetails ?? []), null, 2)}</pre>
                    </details>
                    <details>
                      <summary className="cursor-pointer">Prepared surfaces ({entry.surfaces.length})</summary>
                      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-[11px]">{JSON.stringify(sanitizeForCopy(entry.surfaces), null, 2)}</pre>
                    </details>
                  </div>
                </details>
              </section>
            );
          })}

          {editorPreviewEntries.length > 0 && (
            <section className="rounded border border-gray-700 p-3">
              <h3 className="font-semibold">Editor preview · separate preparation pool</h3>
              <p className="text-xs text-gray-400">These counts describe editor preview surfaces only; they do not indicate projector or service-wide readiness.</p>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {editorPreviewEntries.map((entry) => (
                  <span key={entry.diagnosticId ?? entry.windowRole}>
                    {entry.windowRole}: {getPreparedKeys(entry).size} ready or playing / {entry.candidateCount} selected
                  </span>
                ))}
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs">Editor preview diagnostics</summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px]">{JSON.stringify(sanitizeForCopy(editorPreviewEntries), null, 2)}</pre>
              </details>
            </section>
          )}

          {displayOutputs.filter((output) => output.enabled).map((output) => (
            <RemoteReadiness key={output.id} outputId={output.id} outputName={output.name} enabled={open} churchId={churchId} onReports={receiveRemoteReports} />
          ))}

          <div className="flex items-center gap-3 border-t border-gray-700 pt-3">
            <Button svg={Copy} variant="secondary" className="text-xs" onClick={() => void copyReport()}>
              Copy diagnostic report
            </Button>
            <span className="text-xs text-gray-400" role="status">
              {copyState === "copied" ? "Copied. Sensitive URL query values were removed." : copyState === "failed" ? "Clipboard access is unavailable." : ""}
            </span>
          </div>
        </div>
      </Drawer>
    </>
  );
};

const Count = ({ label, value, help }: { label: string; value: number; help?: string }) => (
  <div title={help}>
    <dt className="text-xs text-gray-400">{label}{help ? <span aria-hidden="true"> ⓘ</span> : null}</dt>
    <dd className="font-semibold text-white">{value}</dd>
  </div>
);

const Metric = ({ label, value }: { label: string; value: ReactNode }) => (
  <div><dt className="text-gray-400">{label}</dt><dd className="break-words font-medium text-white">{value}</dd></div>
);

const Status = ({ good, children }: { good: boolean; children: ReactNode }) => (
  <span className={good ? "text-emerald-200" : "text-amber-200"}>{children}</span>
);

const RemoteReadiness = ({
  outputId,
  outputName,
  enabled,
  churchId,
  onReports,
}: {
  outputId: string;
  outputName: string;
  enabled: boolean;
  churchId?: string;
  onReports: (outputId: string, reports: MediaPreparationReadinessReport[]) => void;
}) => {
  const reports = useRemoteMediaPreparationReadinessReports({ enabled, outputId });
  const [now, setNow] = useState(Date.now());
  const [reportingStatus, setReportingStatus] = useState<MediaReadinessLocalStatus["state"]>();
  const [publication, setPublication] = useState(() =>
    readMediaPreparationPublicationStatus(churchId, outputId),
  );
  useEffect(() => {
    if (enabled) onReports(outputId, reports);
  }, [enabled, onReports, outputId, reports]);
  useEffect(() => {
    setPublication(readMediaPreparationPublicationStatus(churchId, outputId));
    setReportingStatus(undefined);
    if (!enabled) return;
    const tick = window.setInterval(() => setNow(Date.now()), 5000);
    const update = (event: Event) => {
      const status = (event as CustomEvent<Partial<MediaPreparationPublicationStatus>>).detail;
      if (
        status?.outputId === outputId &&
        (status.state === "publishing" || status.state === "retrying" || status.state === "published" || status.state === "failed") &&
        typeof status.publishedAt === "number"
      ) {
        setPublication(status as MediaPreparationPublicationStatus);
      }
    };
    const updateReadinessStatus = (event: Event) => {
      const status = (event as CustomEvent<MediaReadinessLocalStatus>).detail;
      if (status?.outputId === outputId && status.churchId === churchId) setReportingStatus(status.state);
    };
    window.addEventListener("worship-sync-media-manifest-publish-status", update);
    window.addEventListener(MEDIA_READINESS_STATUS_EVENT, updateReadinessStatus);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("worship-sync-media-manifest-publish-status", update);
      window.removeEventListener(MEDIA_READINESS_STATUS_EVENT, updateReadinessStatus);
    };
  }, [churchId, enabled, outputId]);

  if (!enabled) return null;
  const publicationAge = publication ? now - publication.publishedAt : Number.POSITIVE_INFINITY;
  const currentPublication = publication && publicationAge < 5 * 60_000 ? publication : undefined;
  const reportsByDevice = new Map<string, MediaPreparationReadinessReport[]>();
  reports.forEach((report) => {
    reportsByDevice.set(report.deviceId, [...(reportsByDevice.get(report.deviceId) ?? []), report]);
  });
  const sortedDeviceIds = [...reportsByDevice.keys()].sort();
  const deviceNumbers = new Map(sortedDeviceIds.map((deviceId, index) => [deviceId, index + 1]));
  const sessionCards = [...reportsByDevice.entries()].flatMap(([deviceId, sessions]) => {
    const sorted = sessions.sort((a, b) => b.reportedAt - a.reportedAt);
    const activeSessions = sorted.filter((session) => now - session.reportedAt < 45_000);
    const visibleSessions = activeSessions.length > 0 ? activeSessions : sorted.slice(0, 1);
    return visibleSessions.map((report, index) => ({
      report,
      concurrentIndex: index + 1,
      concurrentCount: activeSessions.length,
      superseded: sorted.filter((session) => !visibleSessions.includes(session) && now - session.reportedAt >= 45_000),
    }));
  }).sort((a, b) => a.report.deviceId.localeCompare(b.report.deviceId) || a.report.sessionId.localeCompare(b.report.sessionId))
    .map((card) => ({ ...card, deviceNumber: deviceNumbers.get(card.report.deviceId) ?? 0 }));
  const publisherMessage = currentPublication?.state === "publishing"
    ? `Publishing r${currentPublication.desiredRevision ?? "?"}`
    : currentPublication?.state === "retrying"
      ? `Retrying publish r${currentPublication.desiredRevision ?? "?"}`
      : currentPublication?.state === "failed"
        ? `Publish failed${currentPublication.error ? ` — ${currentPublication.error}` : ""}`
        : currentPublication?.state === "published"
          ? `Published r${currentPublication.desiredRevision ?? "?"}`
          : "No recent publish result";
  return (
    <section className="rounded border border-gray-700 p-3" aria-label={`${outputName} remote readiness`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-white">Remote devices · {outputName}</h2>
        <Status good={currentPublication?.state === "published"}>{publisherMessage}</Status>
      </div>
      <p className="mt-1 text-xs text-gray-400">Publication is separate from each device’s receipt and preparation.</p>
      {reportingStatus && <p className="mt-1 text-xs text-amber-200" role="status">Local diagnostics link: {reportingStatus === "permission-denied" ? "blocked by Firebase permissions" : reportingStatus === "temporarily-unavailable" ? "temporarily unable to update" : reportingStatus === "disconnected" ? "disconnected" : reportingStatus === "subscribing" ? "reconnecting" : reportingStatus === "connected" ? "connected to readiness feed" : "reporting"}</p>}
      {sessionCards.length === 0 && <p className="mt-2 text-xs text-gray-400">No authenticated readiness report has arrived from this output.</p>}
      <div className="mt-2 space-y-2">
        {sessionCards.map(({ report: device, concurrentIndex, concurrentCount, superseded, deviceNumber }) => {
          const age = Math.max(0, now - device.reportedAt);
          const connection = age < 45_000 ? "Connected" : age < 120_000 ? "Stale" : "Disconnected";
          const revisionReceived = Boolean(currentPublication?.desiredRevision != null && device.manifestRevision === currentPublication.desiredRevision && device.manifestReceivedAt != null);
          const ready = connection === "Connected" && revisionReceived && device.source === "remote-manifest" && device.finiteCandidateCount > 0 && device.readyCount >= device.finiteCandidateCount && device.failedCount === 0 && device.pendingCacheCount === 0;
          return (
            <article key={`${device.deviceId}:${device.sessionId}`} role="group" className="rounded bg-gray-900/60 px-2 py-2 text-xs text-gray-300" aria-label={`Remote device ${deviceNumber}${concurrentCount > 1 ? `, window ${concurrentIndex}` : ""}`}>
              <div className="flex items-center justify-between gap-2"><strong className="text-white">Device {deviceNumber}{concurrentCount > 1 ? ` · window ${concurrentIndex}` : ""}</strong><Status good={ready}>{ready ? "Ready" : connection}</Status></div>
              <p className="mt-1">Manifest: {device.manifestRevision == null ? "none received" : `r${device.manifestRevision}${revisionReceived ? " · matches desired revision" : currentPublication?.desiredRevision != null ? ` · desired r${currentPublication.desiredRevision} not confirmed` : ""}`}{device.manifestReceivedAt ? ` · received ${new Date(device.manifestReceivedAt).toLocaleTimeString()}` : ""}</p>
              <p title="Inventory is unique media in this device’s report. Finite ready/preparing/failed counts describe playable finite sources; pending cache and excluded sources are separate.">{device.source === "remote-manifest" ? "Using received manifest" : device.source === "cached-manifest" ? "Using cached manifest; live receipt pending" : device.source === "browser-poster" ? "Browser poster fallback" : "Local fallback; manifest not confirmed"} · {device.candidateCount} videos: {device.readyCount}/{device.finiteCandidateCount} finite ready · {device.preparingCount} preparing · {device.failedCount} failed · {device.pendingCacheCount} pending cache · {device.excludedCount ?? 0} excluded{(device.pendingCacheFailedCount ?? 0) > 0 ? ` · ${device.pendingCacheFailedCount} pending-cache failed` : ""}{(device.excludedFailedCount ?? 0) > 0 ? ` · ${device.excludedFailedCount} excluded failed` : ""}</p>
              {device.errors.length > 0 && <p className="mt-1 text-red-200">{device.errors[0]}</p>}
              <p className="mt-1 text-gray-400">Last report {Math.floor(age / 1000)}s ago · {connection}</p>
              {superseded.length > 0 && <details className="mt-1"><summary className="cursor-pointer text-gray-400">{superseded.length} superseded session(s)</summary><ul className="mt-1 space-y-1">{superseded.map((old) => <li key={old.sessionId}>Previous window · r{old.manifestRevision ?? "—"} · report {new Date(old.reportedAt).toLocaleString()} · {old.readyCount} ready / {old.failedCount} failed</li>)}</ul></details>}
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default MediaSurfaceDiagnostics;
