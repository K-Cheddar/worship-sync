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
  const selectedOutline = useSelector(
    (state) => state.undoable.present.itemLists.selectedList,
  );
  const selectedOutlineScope = useSelector(
    (state) => state.undoable.present.itemLists.scope,
  );

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

  const sectionName = (entry: ReceivedDiagnostics): string =>
    entry.windowRole === "editor"
      ? "EDITOR PREVIEW"
      : entry.windowRole === "projector"
        ? "PROJECTOR"
        : displayName(entry);

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
              <h2 className="mb-3 font-semibold text-white">{sectionName(entry)}</h2>
              {sectionName(entry) !== displayName(entry) && (
                <p className="mb-3 text-xs text-gray-400">{displayName(entry)}</p>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                <Metric label="Controller selected outline" value={selectedOutline?.name || "—"} />
                <Metric label="Controller selected ID" value={selectedOutline?._id || "—"} />
                <Metric label="Controller selected scope" value={selectedOutlineScope || "—"} />
                <Metric label="Controller/profile" value={entry.discovery?.controllerProfileName ? `${entry.discovery.controllerProfileName} (${entry.discovery.controllerProfileId || "—"})` : entry.discovery?.controllerProfileId || "—"} />
                <Metric label="Target preparation outline" value={entry.discovery?.targetOutlineName || entry.discovery?.targetOutlineId || "—"} />
                <Metric label="Loaded preparation outline" value={entry.discovery?.loadedOutlineName || entry.discovery?.loadedOutlineId || "—"} />
                <Metric label="Outline load state" value={entry.discovery?.outlineLoadState || "—"} />
                <Metric label="Outline load error/retry" value={entry.discovery?.outlineLoadError ? `${entry.discovery.outlineLoadError} (attempt ${entry.discovery.outlineRetryAttempt ?? 0})` : entry.discovery?.outlineRetryAt ? `retry at ${new Date(entry.discovery.outlineRetryAt).toLocaleTimeString()}` : "—"} />
                <Metric label="Prepared outline" value={entry.discovery?.outlineName || "—"} />
                <Metric label="Prepared outline ID" value={entry.discovery?.outlineId || "—"} />
                <Metric label="Prepared outline scope" value={entry.discovery?.outlineScope || "—"} />
                <Metric label="Preparation context" value={entry.discovery?.contextSource || "—"} />
                <Metric label="Service items" value={entry.serviceItemCount ?? entry.discovery?.itemCount ?? "—"} />
                <Metric label="Finite videos discovered" value={entry.finiteVideoCount ?? entry.discoveredCount ?? entry.candidateDetails?.length ?? entry.candidateCount} />
                <Metric label="Pending cache" value={entry.pendingCacheCount ?? 0} />
                <Metric label="Candidates selected" value={entry.candidateCount} />
                <Metric label="Pool capacity" value={entry.poolCapacity ?? "—"} />
                <Metric label="Surfaces" value={entry.surfaceCount} />
                <Metric label="Ready" value={entry.readyCount} />
                <Metric label="Preparing" value={entry.preparingCount} />
                <Metric label="Playing" value={entry.playingCount} />
                <Metric label="Errors" value={entry.errorCount} />
                <Metric label="Evictions" value={entry.evictions.length} />
                <Metric label="Current item" value={entry.currentItemId || "—"} />
                <Metric label="Current-item videos" value={entry.currentItemVideoCount ?? "—"} />
                <Metric label="Current-item ready" value={entry.currentItemReadyCount ?? "—"} />
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
                        item {candidate.itemIndex ?? "—"} · {candidate.itemName || "unknown item"} · {candidate.itemId || "—"}
                      </div>
                      <div className="text-gray-400">
                        source {candidate.sourceKind} · cache {candidate.cacheStatus || "unknown"} · surface {candidate.surfaceState || "—"}
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
                        {surface.surfaceState ?? surface.phase} · {surface.sourceKind} · priority {surface.priority ?? "—"} · protected {surface.protected ? "yes" : "no"} · geometry {surface.geometryReady == null ? "—" : surface.geometryReady ? "ready" : `not ready (${surface.geometryReason || "unknown"})`}
                      </div>
                      <div className="text-gray-400">
                        frame presented {surface.framePresentedReady == null ? "—" : surface.framePresentedReady ? "yes" : "no"} · canonical source {surface.canonicalSourceMatch == null ? "—" : surface.canonicalSourceMatch ? "match" : "mismatch"}
                      </div>
                      <div className="text-gray-400">
                        prepare→frame ready {surface.prepareToFrameReadyMs?.toFixed(0) ?? "—"} ms · send→transition {surface.sendToTransitionStartMs?.toFixed(0) ?? "—"} ms · send→play {surface.sendToPlayRequestMs?.toFixed(0) ?? "—"} ms · send→resolved {surface.sendToPlayResolvedMs?.toFixed(0) ?? "—"} ms · send→advancing frame {surface.sendToFirstAdvancingFrameMs?.toFixed(0) ?? "—"} ms
                      </div>
                      <div className="text-gray-400">
                        send state {surface.sendStateBeforeRequest ?? "—"} · last used {surface.lastUsedAt ? new Date(surface.lastUsedAt).toLocaleTimeString() : "—"}
                      </div>
                      <div className="text-gray-400">
                        send {surface.sendTimestamp?.toFixed(1) ?? "—"} · transition {surface.transitionStartTimestamp?.toFixed(1) ?? "—"} · play request {surface.playRequestTimestamp?.toFixed(1) ?? "—"} · play resolved {surface.playResolvedTimestamp?.toFixed(1) ?? "—"} · first advancing frame {surface.firstAdvancingFrameTimestamp?.toFixed(1) ?? "—"} · complete {surface.transitionCompleteTimestamp?.toFixed(1) ?? "—"}
                      </div>
                      <div className="text-gray-400">
                        surface rect {surface.surfaceRect ? `${surface.surfaceRect.width.toFixed(0)}×${surface.surfaceRect.height.toFixed(0)}` : "—"} · video rect {surface.videoRect ? `${surface.videoRect.width.toFixed(0)}×${surface.videoRect.height.toFixed(0)}` : "—"} · intrinsic {surface.intrinsicVideoSize ? `${surface.intrinsicVideoSize.width}×${surface.intrinsicVideoSize.height}` : "—"}
                      </div>
                      <div className="text-gray-400">
                        object-fit {surface.objectFit || "—"} · source {surface.sourceUnchanged == null ? "—" : surface.sourceUnchanged ? "unchanged" : "changed"}
                      </div>
                      <div className="break-all text-gray-400">
                        expected: {surface.expectedSource || "—"} · currentSrc: {surface.actualCurrentSrc || "—"}
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
