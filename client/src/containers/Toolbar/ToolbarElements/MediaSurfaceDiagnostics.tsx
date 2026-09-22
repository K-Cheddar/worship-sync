import { Activity } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Drawer from "../../../components/Drawer/Drawer";
import Button from "../../../components/Button/Button";
import { useSelector } from "../../../hooks";
import { selectDisplayOutputs } from "../../../store/displayOutputsSlice";
import {
  requestElectronMediaSurfaceDiagnostics,
  subscribeToElectronMediaSurfaceDiagnostics,
  type ElectronMediaSurfacePoolDiagnostics,
} from "../../../utils/electronMediaSurfaceDiagnostics";
import type { PreparedVideoMetrics } from "../../../types/electron";

type ReceivedDiagnostics = ElectronMediaSurfacePoolDiagnostics & {
  receivedAt: number;
};

const formatMetric = (
  value: PreparedVideoMetrics | undefined,
  key: "memory" | "cpu",
): string => {
  const metric = value?.[key];
  if (metric?.status === "available" && typeof metric.value === "number") {
    return key === "memory"
      ? `${(metric.value / 1024).toFixed(1)} MB`
      : `${metric.value.toFixed(1)}%`;
  }
  return metric?.reason ?? "—";
};

const MediaSurfaceDiagnostics = () => {
  const [open, setOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Record<string, ReceivedDiagnostics>>({});
  const displayOutputs = useSelector(selectDisplayOutputs);

  useEffect(() => {
    const unsubscribe = subscribeToElectronMediaSurfaceDiagnostics((next) => {
      const key = `${next.outputId || ""}:${next.windowRole}`;
      setDiagnostics((current) => ({
        ...current,
        [key]: { ...next, receivedAt: Date.now() },
      }));
    });
    requestElectronMediaSurfaceDiagnostics();
    const intervalId = window.setInterval(() => {
      requestElectronMediaSurfaceDiagnostics();
      const cutoff = Date.now() - 10_000;
      setDiagnostics((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([, value]) => value.receivedAt >= cutoff),
        ),
      );
    }, 5_000);
    return () => {
      unsubscribe();
      window.clearInterval(intervalId);
    };
  }, []);

  const entries = useMemo(
    () => Object.values(diagnostics).sort((left, right) => left.windowRole.localeCompare(right.windowRole)),
    [diagnostics],
  );
  const ready = entries.reduce((total, entry) => total + entry.readyCount, 0);
  const candidates = entries.reduce((total, entry) => total + entry.candidateCount, 0);
  const label = entries.length === 1 ? `Videos ${ready}/${candidates}` : "Videos";

  const displayName = (entry: ReceivedDiagnostics): string =>
    entry.windowRole === "editor"
      ? "Editor Preview"
      : entry.windowRole.endsWith("-preview")
        ? `${
            displayOutputs.find((output) => output.id === entry.outputId)?.name ||
            entry.outputId ||
            entry.windowRole.replace(/-preview$/, "")
          } Preview`
      :
    displayOutputs.find((output) => output.id === entry.outputId)?.name ||
    entry.outputId ||
    entry.windowRole;

  return (
    <>
      <Button
        svg={Activity}
        variant="tertiary"
        className="shrink-0 text-xs"
        onClick={() => setOpen(true)}
        aria-label="Open video readiness diagnostics"
        aria-expanded={open}
        data-testid="media-surface-diagnostics-trigger"
      >
        {label}
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
          {!entries.length && (
            <p className="text-gray-400">No connected Electron display has reported readiness yet.</p>
          )}
          {entries.map((entry) => (
            <section key={`${entry.outputId || ""}:${entry.windowRole}`} className="rounded border border-gray-700 p-3">
              <h2 className="mb-3 font-semibold text-white">{displayName(entry)}</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                <Metric label="Discovered" value={entry.discoveredCount ?? entry.candidateDetails?.length ?? entry.candidateCount} />
                <Metric label="Pending cache" value={entry.pendingCacheCount ?? 0} />
                <Metric label="Candidates" value={entry.candidateCount} />
                <Metric label="Surfaces" value={entry.surfaceCount} />
                <Metric label="Ready" value={entry.readyCount} />
                <Metric label="Preparing" value={entry.preparingCount} />
                <Metric label="Playing" value={entry.playingCount} />
                <Metric label="Errors" value={entry.errorCount} />
                <Metric label="Evictions" value={entry.evictions.length} />
                <Metric label="Last send path" value={(entry.renderPath || entry.lastSendPath || "—").toUpperCase()} />
                <Metric
                  label="Transition visual"
                  value={
                    entry.lastSendPath === "pool"
                      ? "prepared frame"
                      : entry.posterShown == null
                        ? "not recorded"
                        : entry.posterShown
                          ? "poster/fallback"
                          : "fallback video frame"
                  }
                />
                <Metric label="Renderer memory" value={formatMetric(entry.rendererMetrics, "memory")} />
                <Metric label="CPU" value={formatMetric(entry.rendererMetrics, "cpu")} />
              </dl>
              <p className="mt-3 break-all text-xs text-gray-400">
                Last media: {entry.lastMediaKey || "—"}
              </p>
              {entry.evictions.length > 0 && (
                <p className="mt-2 break-all text-xs text-gray-400">
                  Eviction reasons: {entry.evictions.join(", ")}
                </p>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-gray-300">
                  Candidate details ({entry.candidateDetails?.length ?? 0})
                </summary>
                <div className="mt-2 max-h-72 space-y-2 overflow-auto text-xs">
                  {(entry.candidateDetails ?? []).map((candidate) => (
                    <div key={candidate.mediaKey} className="border-t border-gray-700 pt-2">
                      <div className="break-all font-medium text-white">
                        {candidate.mediaKey} · {candidate.status || (candidate.eligible ? "eligible" : "excluded")}
                      </div>
                      <div>{candidate.reason} · cache {candidate.cacheStatus || "unknown"}</div>
                      <div className="break-all text-gray-400">
                        original: {candidate.originalSource}
                      </div>
                      {candidate.resolvedSource && (
                        <div className="break-all text-gray-400">
                          resolved: {candidate.resolvedSource}
                        </div>
                      )}
                      <div className="text-gray-400">
                        {candidate.itemName || candidate.itemId || "unknown item"} · {candidate.sourceKind}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-gray-300">Surface details ({entry.surfaces.length})</summary>
                <div className="mt-2 max-h-64 space-y-2 overflow-auto text-xs">
                  {entry.surfaces.map((surface) => (
                    <div key={surface.mediaKey} className="border-t border-gray-700 pt-2">
                      <div className="break-all font-medium text-white">{surface.mediaKey}</div>
                      <div>
                        {surface.surfaceState ?? surface.phase} · {surface.sourceKind} · priority {surface.priority ?? "—"} · protected {surface.protected ? "yes" : "no"}
                      </div>
                      <div className="text-gray-400">
                        prepare→frame ready {surface.prepareToFrameReadyMs?.toFixed(0) ?? "—"} ms · send→transition {surface.sendToTransitionStartMs?.toFixed(0) ?? "—"} ms · send→play {surface.sendToPlayRequestMs?.toFixed(0) ?? "—"} ms · send→resolved {surface.sendToPlayResolvedMs?.toFixed(0) ?? "—"} ms · send→advancing frame {surface.sendToFirstAdvancingFrameMs?.toFixed(0) ?? "—"} ms
                      </div>
                      <div className="text-gray-400">
                        send state {surface.sendStateBeforeRequest ?? "—"} · last used {surface.lastUsedAt ? new Date(surface.lastUsedAt).toLocaleTimeString() : "—"}
                      </div>
                      <div className="text-gray-400">
                        send snapshot t={surface.sendCurrentTime?.toFixed(2) ?? "-"} · readyState {surface.sendReadyState ?? "-"} · paused {surface.sendPaused == null ? "-" : surface.sendPaused ? "yes" : "no"} · seeking {surface.sendSeeking == null ? "-" : surface.sendSeeking ? "yes" : "no"} · buffered {surface.sendBufferedRanges?.map(([start, end]) => `${start.toFixed(2)}-${end.toFixed(2)}`).join(", ") || "-"}
                      </div>
                      {surface.error && <div className="text-red-300">{surface.error}</div>}
                    </div>
                  ))}
                </div>
              </details>
            </section>
          ))}
        </div>
      </Drawer>
    </>
  );
};

const Metric = ({ label, value }: { label: string; value: ReactNode }) => (
  <div>
    <dt className="text-gray-400">{label}</dt>
    <dd className="font-medium text-white">{value}</dd>
  </div>
);

export default MediaSurfaceDiagnostics;
