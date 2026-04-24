import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, BookOpen, Plus, RefreshCcw, Check } from "lucide-react";
import Button from "../../components/Button/Button";
import ExpandCollapseChevronButton from "../../components/ExpandCollapseChevronButton/ExpandCollapseChevronButton";
import Input from "../../components/Input/Input";
import Spinner from "../../components/Spinner/Spinner";
import { useDispatch, useSelector } from "../../hooks";
import { useToast } from "../../context/toastContext";
import { useServicePlanningImport } from "../../hooks/useServicePlanningImport";
import {
  bibleRefToSearchString,
} from "../../integrations/servicePlanning/parseBibleReference";
import {
  startServicePlanningSync,
  setServicePlanningImportOutlinePreviewExpanded,
  setServicePlanningImportOverlaySummaryExpanded,
  setServicePlanningImportPreview,
  setServicePlanningImportUrl,
} from "../../store/servicePlanningImportSlice";
import type {
  OutlineItemCandidate,
  OverlaySyncPlanItem,
} from "../../types/servicePlanningImport";
import cn from "classnames";

const OverlayStatusBadge = ({ matched }: { matched: boolean }) =>
  matched ? (
    <span className="rounded-full bg-green-900/50 px-2 py-0.5 text-xs font-medium text-green-300">
      Overlay ✓
    </span>
  ) : null;

const OverlayPlanActionBadge = ({
  action,
}: {
  action: OverlaySyncPlanItem["action"];
}) => {
  const tone =
    action === "update"
      ? "bg-green-900/50 text-green-300"
      : action === "clone"
        ? "bg-cyan-900/50 text-cyan-300"
        : action === "create"
          ? "bg-blue-900/40 text-blue-300"
          : "bg-red-900/40 text-red-300";
  const label =
    action === "update"
      ? "Update existing"
      : action === "clone"
        ? "Copy participant"
        : action === "create"
          ? "Create new"
          : "Skip";

  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tone)}>
      {label}
    </span>
  );
};

const OverlayFieldSummary = ({
  label,
  value,
}: {
  label: string;
  value?: string;
}) => (
  <span className="rounded-md bg-gray-950/80 px-2 py-1 text-sm text-gray-300">
    <span className="text-gray-500">{label}:</span>{" "}
    {value?.trim() ? value : "—"}
  </span>
);

const OverlaySummaryPanel = ({
  items,
  expanded,
  onExpandedChange,
}: {
  items: OverlaySyncPlanItem[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) => {
  const updateCount = items.filter((item) => item.action === "update").length;
  const cloneCount = items.filter((item) => item.action === "clone").length;
  const createCount = items.filter((item) => item.action === "create").length;
  const skipCount = items.filter((item) => item.action === "skip").length;

  return (
    <section className="rounded-lg border border-gray-700 bg-gray-900/40">
      <div className="flex items-start gap-2 border-b border-gray-700 px-4 py-3">
        <ExpandCollapseChevronButton
          expanded={expanded}
          onExpandedChange={onExpandedChange}
          expandLabel="Expand overlay sync summary"
          collapseLabel="Collapse overlay sync summary"
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Overlay sync summary
            </h3>
            <p className="mt-1 text-sm text-gray-400">
              Review the exact overlay changes before you sync.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-green-900/40 px-2 py-1 text-green-300">
              {updateCount} update{updateCount === 1 ? "" : "s"}
            </span>
            <span className="rounded-full bg-cyan-900/40 px-2 py-1 text-cyan-300">
              {cloneCount} clone{cloneCount === 1 ? "" : "s"}
            </span>
            <span className="rounded-full bg-blue-900/30 px-2 py-1 text-blue-300">
              {createCount} create{createCount === 1 ? "" : "s"}
            </span>
            <span className="rounded-full bg-red-900/30 px-2 py-1 text-red-300">
              {skipCount} skip{skipCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </div>

      {expanded ? (
        items.length === 0 ? (
          <div className="px-4 py-3 text-sm text-gray-400">
            No overlay changes are planned for this import.
          </div>
        ) : (
          <ul className="divide-y divide-gray-800">
            {items.map((item, index) => (
              <li
                key={`${item.sectionName}-${item.elementType}-${item.personIndex}-${index}`}
                className="space-y-3 px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <OverlayPlanActionBadge action={item.action} />
                      <OverlayFieldSummary label="Name" value={item.patch.name} />
                      <OverlayFieldSummary label="Title" value={item.patch.title} />
                      <OverlayFieldSummary label="Event" value={item.patch.event} />
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-400">
                    {item.action === "skip" ? (
                      <span>{item.reason}</span>
                    ) : (
                      <span>
                        {item.action === "clone"
                          ? "Template"
                          : item.action === "create"
                            ? "New overlay"
                            : "Current"}
                        :{" "}
                        <span className="text-gray-200">
                          {item.targetOverlayName?.trim() ||
                            item.targetOverlayEvent?.trim() ||
                            (item.action === "create"
                              ? item.patch.event?.trim() || "Participant overlay"
                              : "Unnamed overlay")}
                        </span>
                      </span>
                    )}
                  </div>
                </div>


              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
};

const OutlineStatusCell = ({
  candidate,
  onCreateClick,
  onBibleClick,
}: {
  candidate: OutlineItemCandidate;
  onCreateClick: (title: string) => void;
  onBibleClick: (candidate: OutlineItemCandidate) => void;
}) => {
  if (candidate.outlineItemType === "song") {
    if (candidate.matchedLibraryItem) {
      return (
        <span className="rounded-full bg-green-900/50 px-2 py-0.5 text-xs font-medium text-green-300">
          Song ✓
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1">
        <span className="rounded-full bg-red-900/40 px-2 py-0.5 text-xs font-medium text-red-300">
          Not found
        </span>
        <Button
          type="button"
          variant="tertiary"
          svg={Plus}
          iconSize="sm"
          padding="px-1 py-0.5"
          className="text-xs"
          aria-label={`Create song ${candidate.cleanedTitle}`}
          onClick={() => onCreateClick(candidate.cleanedTitle)}
        >
          Create
        </Button>
      </span>
    );
  }

  if (candidate.outlineItemType === "bible") {
    if (candidate.parsedRef) {
      return (
        <span className="flex items-center gap-1">
          <span className="rounded-full bg-blue-900/40 px-2 py-0.5 text-xs font-medium text-blue-300">
            Bible
          </span>
          <Button
            type="button"
            variant="tertiary"
            svg={BookOpen}
            iconSize="sm"
            padding="px-1 py-0.5"
            className="text-xs"
            aria-label={`Open ${candidate.title} in Bible`}
            onClick={() => onBibleClick(candidate)}
          >
            Open
          </Button>
        </span>
      );
    }
    return (
      <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
        Bible (unrecognized)
      </span>
    );
  }

  return null;
};

const ServicePlanningImportPanel = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { showToast } = useToast();
  const {
    loadPreview,
    isServicePlanningEnabled,
    servicePlanningAvailabilityMessage,
  } = useServicePlanningImport();

  const url = useSelector((s) => s.servicePlanningImport.url);
  const preview = useSelector((s) => s.servicePlanningImport.preview);
  const overlaySummaryExpanded = useSelector(
    (s) => s.servicePlanningImport.overlaySummaryExpanded,
  );
  const outlinePreviewExpanded = useSelector(
    (s) => s.servicePlanningImport.outlinePreviewExpanded,
  );
  const sync = useSelector((s) => s.servicePlanningImport.sync);
  const [isLoading, setIsLoading] = useState(false);
  const isSyncing = sync.status === "running";
  const matchedSongCount =
    preview?.outlineCandidates.filter(
      (candidate) =>
        candidate.outlineItemType === "song" && Boolean(candidate.matchedLibraryItem),
    ).length ?? 0;
  const bibleCount =
    preview?.outlineCandidates.filter(
      (candidate) =>
        candidate.outlineItemType === "bible" && Boolean(candidate.parsedRef),
    ).length ?? 0;
  const missingSongCount =
    preview?.outlineCandidates.filter(
      (candidate) =>
        candidate.outlineItemType === "song" && !candidate.matchedLibraryItem,
    ).length ?? 0;
  const unrecognizedBibleCount =
    preview?.outlineCandidates.filter(
      (candidate) =>
        candidate.outlineItemType === "bible" && !candidate.parsedRef,
    ).length ?? 0;

  const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error && error.message.trim() ? error.message : fallback;

  const handleLoad = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!trimmed.toLowerCase().startsWith("https://")) {
      showToast("URL must start with https://", "error");
      return;
    }
    setIsLoading(true);
    dispatch(setServicePlanningImportPreview(null));
    try {
      const result = await loadPreview(trimmed);
      dispatch(setServicePlanningImportPreview(result));
      if (
        result.outlineCandidates.length === 0 &&
        result.overlayCandidates.length === 0
      ) {
        showToast("No rows matched the current integration rules.", "info");
      }
    } catch (error) {
      showToast(
        getErrorMessage(
          error,
          "Failed to load planning data. Check the URL and try again.",
        ),
        "error",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSync = (overlays: boolean, outline: boolean) => {
    if (!preview) return;
    const mode = overlays && outline ? "both" : overlays ? "overlays" : "outline";
    dispatch(startServicePlanningSync({ mode }));
  };

  const handleCreateClick = (title: string) => {
    navigate(
      `/controller/create?type=song&name=${encodeURIComponent(title)}`,
    );
  };

  const handleBibleClick = (candidate: OutlineItemCandidate) => {
    if (!candidate.parsedRef) return;
    const params = new URLSearchParams();
    params.set("search", bibleRefToSearchString(candidate.parsedRef));
    if (candidate.parsedRef.version) {
      params.set("version", candidate.parsedRef.version);
    }
    navigate(`/controller/bible?${params.toString()}`);
  };

  // Group outline candidates by section for display
  const sectionMap = new Map<string, OutlineItemCandidate[]>();
  if (preview) {
    for (const c of preview.outlineCandidates) {
      const key = c.sectionName || "(no section)";
      if (!sectionMap.has(key)) sectionMap.set(key, []);
      sectionMap.get(key)!.push(c);
    }
  }

  const hasInsertableOutlineItems = Boolean(
    preview?.outlineCandidates.some(
      (candidate) =>
        Boolean(candidate.headingName) &&
        (
          (candidate.outlineItemType === "song" &&
            Boolean(candidate.matchedLibraryItem)) ||
          (candidate.outlineItemType === "bible" &&
            Boolean(candidate.parsedRef))
        ),
    ),
  );
  const hasOverlayPlan = Boolean(preview?.overlayPlan.length);

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-y-auto">
      <h2 className="text-xl font-bold">Service Planning Import</h2>
      {servicePlanningAvailabilityMessage ? (
        <div className="rounded-lg border border-yellow-400/40 bg-yellow-500/10 p-3 text-sm text-yellow-50">
          {servicePlanningAvailabilityMessage}
        </div>
      ) : null}

      <div className="flex gap-2 items-end flex-wrap">
        <Input
          label="Planning URL"
          value={url}
          onChange={(v) => dispatch(setServicePlanningImportUrl(String(v || "")))}
          disabled={isSyncing}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleLoad();
          }}
          placeholder="https://..."
          className="flex-1 min-w-0"
        />
        <Button
          type="button"
          variant="cta"
          svg={isLoading ? undefined : RefreshCcw}
          isLoading={isLoading}
          disabled={
            isLoading || isSyncing || !url.trim() || !isServicePlanningEnabled
          }
          onClick={() => void handleLoad()}
        >
          {isLoading ? "Loading…" : "Load"}
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Spinner width="16px" borderWidth="2px" className="border-cyan-400/80 border-b-transparent" />
          <span>Fetching planning data…</span>
        </div>
      )}

      {preview && !isLoading && (
        <>
          {hasOverlayPlan ? (
            <OverlaySummaryPanel
              items={preview.overlayPlan}
              expanded={overlaySummaryExpanded}
              onExpandedChange={(next) =>
                dispatch(setServicePlanningImportOverlaySummaryExpanded(next))
              }
            />
          ) : null}
          {sectionMap.size === 0 && preview.overlayCandidates.length === 0 ? (
            <p className="text-sm text-gray-400">No items matched the current integration rules.</p>
          ) : (
            <section className="rounded-lg border border-gray-700 bg-gray-900/40">
              <div className="flex items-start gap-2 border-b border-gray-700 px-3 py-3">
                <ExpandCollapseChevronButton
                  expanded={outlinePreviewExpanded}
                  onExpandedChange={(next) =>
                    dispatch(setServicePlanningImportOutlinePreviewExpanded(next))
                  }
                  expandLabel="Expand outline preview"
                  collapseLabel="Collapse outline preview"
                />
                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-white">
                      Outline preview
                    </h3>
                    <p className="mt-1 text-xs text-gray-400">
                      {preview.outlineCandidates.length} planning row
                      {preview.outlineCandidates.length === 1 ? "" : "s"} · overlay
                      match and library status
                    </p>
                  </div>
                  {!outlinePreviewExpanded ? (
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-green-900/40 px-2 py-1 text-green-300">
                        {matchedSongCount} song{matchedSongCount === 1 ? "" : "s"}
                      </span>
                      <span className="rounded-full bg-blue-900/30 px-2 py-1 text-blue-300">
                        {bibleCount} bible{bibleCount === 1 ? "" : "s"}
                      </span>
                      <span className="rounded-full bg-red-900/30 px-2 py-1 text-red-300">
                        {missingSongCount} not found
                      </span>
                      {unrecognizedBibleCount > 0 ? (
                        <span className="rounded-full bg-gray-800 px-2 py-1 text-gray-300">
                          {unrecognizedBibleCount} unrecognized
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              {outlinePreviewExpanded ? (
                <div className="space-y-4 p-3 pt-2">
                  {Array.from(sectionMap.entries()).map(([sectionName, candidates]) => (
                    <div key={sectionName} className="rounded-lg border border-gray-700 bg-gray-900/40">
                      <div className="flex items-center gap-2 border-b border-gray-700 px-3 py-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                          {sectionName}
                        </span>
                        {candidates[0]?.headingName && (
                          <>
                            <ExternalLink className="h-3 w-3 text-gray-500 shrink-0" />
                            <span className="text-xs text-cyan-300">
                              {candidates[0].headingName}
                            </span>
                          </>
                        )}
                      </div>
                      <ul className="divide-y divide-gray-800">
                        {candidates.map((c, i) => (
                          <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2">
                            <span className="flex-1 min-w-0">
                              <span className="text-sm text-gray-300">{c.elementType}</span>
                              {c.title && (
                                <span className="ml-2 text-xs text-gray-500">{c.title}</span>
                              )}
                            </span>
                            <div className="flex flex-wrap items-center gap-1">
                              <OverlayStatusBadge
                                matched={c.overlayReady}
                              />
                              <OutlineStatusCell
                                candidate={c}
                                onCreateClick={handleCreateClick}
                                onBibleClick={handleBibleClick}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          )}

          <div className="flex flex-wrap gap-2 mt-2 pt-4 border-t border-gray-700">
            <Button
              type="button"
              variant="secondary"
              svg={Check}
              isLoading={isSyncing}
              disabled={isSyncing || !isServicePlanningEnabled}
              onClick={() => void handleSync(true, false)}
            >
              Sync Overlays
            </Button>
            <Button
              type="button"
              variant="secondary"
              svg={Check}
              isLoading={isSyncing}
              disabled={
                isSyncing ||
                !isServicePlanningEnabled ||
                !hasInsertableOutlineItems
              }
              onClick={() => void handleSync(false, true)}
            >
              Sync Outline
            </Button>
            <Button
              type="button"
              variant="cta"
              svg={Check}
              isLoading={isSyncing}
              disabled={isSyncing || !isServicePlanningEnabled}
              onClick={() => void handleSync(true, true)}
            >
              Sync Both
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export default ServicePlanningImportPanel;
