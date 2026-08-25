import {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Book, BookOpen, Download, Music, Plus, RefreshCw, Square } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "../../hooks";
import {
  cancelServicePlanningSync,
  clearServicePlanningSyncState,
  markServicePlanningUrlSelection,
  setServicePlanningFloatingWindowDismissed,
  setServicePlanningImportUrl,
  setServicePlanningServiceOutline,
  startServicePlanningSync,
} from "../../store/servicePlanningImportSlice";
import {
  useServicePlanningImport,
  overlayPlanHasExecutableChange,
} from "../../hooks/useServicePlanningImport";
import type { ItemList, OverlayInfo } from "../../types";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverClose,
} from "../../components/ui/Popover";
import Input from "../../components/Input/Input";
import { useToast } from "../../context/toastContext";
import type { RootState } from "../../store/store";
import Button from "../../components/Button/Button";
import FloatingWindow, { type FloatingWindowHandle } from "../../components/FloatingWindow/FloatingWindow";
import Spinner from "../../components/Spinner/Spinner";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  lineTabsListShellClassName,
  lineTabsTriggerSmClassName,
} from "../../components/ui/tabs";
import type {
  ServicePlanningLineItem,
  ServicePlanningPreview,
  ServicePlanningTeamAssignment,
} from "../../types/servicePlanningImport";
import type { ServicePlanningSyncItem } from "../../store/servicePlanningImportSlice";
import { getServicePlanningLineItemKey } from "../../utils/servicePlanningSyncKeys";
import { cleanPlanningTitle } from "../../integrations/servicePlanning/cleanPlanningTitle";
import { getBibleImportDisplayName } from "../../utils/servicePlanningBibleImport";
import { bibleRefToSearchString } from "../../integrations/servicePlanning/parseBibleReference";
import { cn } from "../../utils/cnHelper";
import { iconColorMap } from "../../utils/itemTypeMaps";

import Select from "../../components/Select/Select";
import { useCurrentServicePlanSource } from "./useCurrentServicePlanSource";
import ActionBar, { type ActionBarItem as ActionBarItemDef } from "../../components/ActionBar/ActionBar";
import { MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS, MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE } from "../../containers/Media/mediaLibraryMediaActionUi";
import { getControllerRightPanelWidthPx } from "../../utils/controllerPanelLayout";
import { ControllerInfoContext } from "../../context/controllerInfo";
import {
  selectItemList,
  updateItemLists,
} from "../../store/itemListsSlice";
import { createNewItemList } from "../../utils/itemUtil";
import { setItemListIsLoading } from "../../store/itemListSlice";
import {
  formatControllerServicePlanLabel,
  isControllerServicePlanUpcoming,
  limitControllerServicePlans,
} from "./controllerServicePlanSelection";

const MARGIN = 16;

const EMPTY_OVERLAY_LIST: OverlayInfo[] = [];
const EMPTY_ITEM_LISTS: ItemList[] = [];

const StatusBadge = ({
  className,
  label,
}: {
  className: string;
  label: string;
}) => (
  <span
    className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${className}`}
  >
    {label}
  </span>
);

const getLineItemBaseBadges = (item: ServicePlanningLineItem, hideNotFound = false) => {
  if (item.outlineItemType === "song") {
    if (!item.matchedLibraryItem && hideNotFound) return [];
    return [
      <StatusBadge
        key="song"
        className={
          item.matchedLibraryItem
            ? "bg-green-900/60 text-green-300"
            : "bg-red-900/50 text-red-300"
        }
        label={item.matchedLibraryItem ? "Song" : "Song not found"}
      />,
    ];
  }

  if (item.outlineItemType === "bible") {
    return [
      <StatusBadge
        key="bible"
        className={
          item.parsedRef
            ? "bg-blue-900/60 text-blue-300"
            : "bg-zinc-700 text-zinc-400"
        }
        label={item.parsedRef ? "Bible" : "Bible unrecognized"}
      />,
    ];
  }

  return [];
};

type SyncBadgeData =
  | { type: "active"; phase: "outline" | "overlays" }
  | { type: "badge"; label: string; className: string }
  | null;

const getSyncBadgeData = ({
  item,
  isRunning,
  activeLabel,
  activeSublabel,
}: {
  item: ServicePlanningSyncItem;
  isRunning: boolean;
  activeLabel: string;
  activeSublabel: string;
}): SyncBadgeData => {
  const isActive =
    isRunning &&
    item.status === "pending" &&
    item.label === activeLabel &&
    (activeSublabel ? item.sublabel === activeSublabel : true);
  const phaseLabel = item.phase === "outline" ? "Outline" : "Overlay";

  if (isActive) return { type: "active", phase: item.phase };

  if (item.status === "pending")
    return {
      type: "badge",
      label: `${phaseLabel} pending`,
      className: "bg-zinc-800 text-zinc-400",
    };

  if (item.status === "already-present")
    return {
      type: "badge",
      label: item.phase === "outline" ? "Outline ready" : "Overlay current",
      className: "bg-zinc-700 text-zinc-300",
    };

  if (item.status === "added")
    return {
      type: "badge",
      label: "Outline added",
      className: "bg-cyan-900/60 text-cyan-300",
    };

  if (item.status === "updated")
    return {
      type: "badge",
      label: "Overlay updated",
      className: "bg-green-900/60 text-green-300",
    };

  if (item.status === "created")
    return {
      type: "badge",
      label: "Overlay created",
      className: "bg-blue-900/60 text-blue-300",
    };

  if (item.status === "found")
    return {
      type: "badge",
      label: "Overlay found",
      className: "bg-zinc-700 text-zinc-300",
    };

  return null;
};

const pluralizeBadgeLabel = (label: string, count: number): string => {
  const [phase, ...rest] = label.split(" ");
  const phaseP = phase === "Outline" ? "outlines" : "overlays";
  return `${count} ${phaseP} ${rest.join(" ")}`;
};

/** Hide no-op overlay badges when the same row also changed during sync. */
const filterRedundantOverlayBadges = (
  badges: NonNullable<SyncBadgeData>[],
): NonNullable<SyncBadgeData>[] => {
  const badgeLabels = badges
    .filter((badge) => badge.type === "badge")
    .map((badge) => badge.label);
  const hasOverlayChange = badgeLabels.some(
    (label) => label === "Overlay updated" || label === "Overlay created",
  );

  if (!hasOverlayChange) return badges;

  return badges.filter(
    (badge) =>
      badge.type !== "badge" ||
      (badge.label !== "Overlay current" && badge.label !== "Overlay found"),
  );
};

const hasSyncableOutlineItems = (preview: ServicePlanningPreview | null): boolean =>
  Boolean(
    preview?.outlineCandidates.some(
      (candidate) =>
        !candidate.outlineAlreadyPresent &&
        (
          (candidate.outlineItemType === "song" &&
            Boolean(candidate.matchedLibraryItem)) ||
          (candidate.outlineItemType === "bible" && Boolean(candidate.parsedRef))
        ),
    ),
  );

const hasSyncableOverlayItems = (
  preview: ServicePlanningPreview | null,
  overlays: OverlayInfo[],
): boolean =>
  Boolean(preview && overlayPlanHasExecutableChange(preview.overlayPlan, overlays));

const getPreviewLineItems = (preview: ServicePlanningPreview | null) => {
  const maybeItems = (preview as Partial<ServicePlanningPreview> | null)?.lineItems;
  return Array.isArray(maybeItems) ? maybeItems : [];
};

const getPreviewTeamAssignments = (preview: ServicePlanningPreview | null) => {
  const maybeAssignments = (preview as Partial<ServicePlanningPreview> | null)
    ?.teamAssignments;
  return Array.isArray(maybeAssignments) ? maybeAssignments : [];
};

const buildLineItemsBySection = (preview: ServicePlanningPreview | null) => {
  const sections = new Map<string, ServicePlanningLineItem[]>();
  if (!preview) return sections;

  for (const item of getPreviewLineItems(preview)) {
    const key = item.sectionName || "";
    if (!sections.has(key)) {
      sections.set(key, []);
    }
    sections.get(key)?.push(item);
  }

  return sections;
};

const buildAssignmentsByTeam = (preview: ServicePlanningPreview | null) => {
  const teams = new Map<string, ServicePlanningTeamAssignment[]>();
  if (!preview) return teams;

  for (const assignment of getPreviewTeamAssignments(preview)) {
    if (!teams.has(assignment.teamName)) {
      teams.set(assignment.teamName, []);
    }
    teams.get(assignment.teamName)?.push(assignment);
  }

  return teams;
};

const ServicePlanningSyncFloatingWindow = ({ hideOutlineActions = false }: { hideOutlineActions?: boolean }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { db } = useContext(ControllerInfoContext) || {};
  const { loadPreview } = useServicePlanningImport();
  const { showToast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [activeTab, setActiveTab] = useState<"plan" | "assignments">("plan");
  // Keeps the Controller's copy of the plan in step with the Services editor.
  const {
    savedPlans,
    selectedPlan,
    selectedPlanKey,
    selectPlan,
    pinSelectedPlan,
    isEnabled: isSavedPlanAccessEnabled,
    isLoading,
    isLoadingPlans,
    plansError,
    isPlanSourced,
    refresh: refreshPlan,
    refreshPlans,
  } = useCurrentServicePlanSource();

  const preview = useSelector((s: RootState) => s.servicePlanningImport.preview);
  const overlays = useSelector(
    (s: RootState) => s.undoable?.present?.overlays?.list ?? EMPTY_OVERLAY_LIST,
  );
  const sync = useSelector((s: RootState) => s.servicePlanningImport.sync);
  const url = useSelector((s: RootState) => s.servicePlanningImport.url);
  const serviceOutline = useSelector(
    (s: RootState) => s.servicePlanningImport.serviceOutline,
  );
  const floatingWindowDismissed = useSelector(
    (s: RootState) => s.servicePlanningImport.floatingWindowDismissed,
  );
  const currentLists = useSelector(
    (s: RootState) =>
      s.undoable?.present?.itemLists?.currentLists ?? EMPTY_ITEM_LISTS,
  );
  const selectedList = useSelector(
    (s: RootState) => s.undoable?.present?.itemLists?.selectedList,
  );
  const targetOutlineLoading = useSelector(
    (s: RootState) => s.undoable?.present?.itemList?.isLoading ?? false,
  );
  const outlinePlanBinding = useSelector(
    (s: RootState) => s.servicePlanningImport.outlinePlanBinding,
  );
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeItemRef = useRef<HTMLLIElement | null>(null);
  const floatingWindowRef = useRef<FloatingWindowHandle>(null);
  const floatingWindowRestoreId = useSelector(
    (s: RootState) => s.servicePlanningImport.floatingWindowRestoreId,
  );
  const prevRestoreIdRef = useRef(floatingWindowRestoreId);
  useEffect(() => {
    if (floatingWindowRestoreId !== prevRestoreIdRef.current) {
      prevRestoreIdRef.current = floatingWindowRestoreId;
      floatingWindowRef.current?.restore();
    }
  }, [floatingWindowRestoreId]);

  const handleImport = useCallback(async () => {
    const trimmed = importUrl.trim();
    if (!trimmed) return;
    if (!trimmed.toLowerCase().startsWith("https://")) {
      showToast("URL must start with https://", "error");
      return;
    }
    setIsImporting(true);
    try {
      const result = await loadPreview(trimmed);
      dispatch(setServicePlanningImportUrl(trimmed));
      dispatch(setServicePlanningServiceOutline(result));
      dispatch(markServicePlanningUrlSelection());
      dispatch(setServicePlanningFloatingWindowDismissed(false));
      setIsImportOpen(false);
      setImportUrl("");
      showToast("Plan loaded", "success");
    } catch (error) {
      showToast(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Failed to load plan. Check the URL and try again.",
        "error",
      );
    } finally {
      setIsImporting(false);
    }
  }, [dispatch, importUrl, loadPreview, setImportUrl, showToast]);

  const handleRefresh = useCallback(async () => {
    if (
      isRefreshing ||
      sync.status === "running" ||
      sync.status === "cancelling"
    ) {
      return;
    }
    // A plan-sourced preview follows the Services plan, so re-read that rather
    // than re-scraping `url` — which is only the plan's original import source
    // and may belong to a different service entirely.
    if (isPlanSourced) {
      setIsRefreshing(true);
      try {
        await refreshPlan();
        showToast("Plan refreshed", "success");
      } catch {
        showToast("Failed to refresh plan", "error");
      } finally {
        setIsRefreshing(false);
      }
      return;
    }

    if (!url) return;
    setIsRefreshing(true);
    try {
      const result = await loadPreview(url);
      dispatch(setServicePlanningServiceOutline(result));
      showToast("Plan refreshed", "success");
    } catch {
      showToast("Failed to refresh plan", "error");
    } finally {
      setIsRefreshing(false);
    }
  }, [
    dispatch,
    isPlanSourced,
    isRefreshing,
    loadPreview,
    refreshPlan,
    showToast,
    sync.status,
    url,
  ]);

  const isContextChanging = isLoading || targetOutlineLoading;
  const canSyncOverlays =
    !isContextChanging && hasSyncableOverlayItems(preview, overlays);
  const canSyncOutline =
    !isContextChanging && Boolean(selectedList) && hasSyncableOutlineItems(preview);
  const canSyncAny = canSyncOverlays || canSyncOutline;

  const handleSync = useCallback((mode: "overlays" | "outline" | "both") => {
    const shouldSyncOverlays = mode !== "outline" && canSyncOverlays;
    const shouldSyncOutline = mode !== "overlays" && canSyncOutline;
    if (!shouldSyncOverlays && !shouldSyncOutline) return;

    const nextMode =
      shouldSyncOverlays && shouldSyncOutline
        ? "both"
        : shouldSyncOverlays
          ? "overlays"
          : "outline";
    dispatch(setServicePlanningFloatingWindowDismissed(false));
    dispatch(startServicePlanningSync({ mode: nextMode }));
  }, [canSyncOutline, canSyncOverlays, dispatch]);

  const handleStopSync = useCallback(() => {
    dispatch(cancelServicePlanningSync());
  }, [dispatch]);

  const handleCreateClick = (title: string) => {
    navigate(
      `/controller/create?type=song&name=${encodeURIComponent(title)}`,
    );
  };

  const handleBibleClick = (item: ServicePlanningLineItem) => {
    if (!item.parsedRef) return;
    const params = new URLSearchParams();
    params.set("search", bibleRefToSearchString(item.parsedRef));
    if (item.parsedRef.version) {
      params.set("version", item.parsedRef.version);
    }
    navigate(`/controller/bible?${params.toString()}`);
  };

  const visiblePlans = useMemo(
    () =>
      limitControllerServicePlans({
        plans: savedPlans,
        selectedPlanKey,
        boundPlanKey: outlinePlanBinding?.planKey,
      }),
    [outlinePlanBinding?.planKey, savedPlans, selectedPlanKey],
  );
  const planOptions = useMemo(
    () =>
      visiblePlans.map((plan) => ({
        value: plan.planKey,
        label: formatControllerServicePlanLabel(plan),
        group: isControllerServicePlanUpcoming(plan) ? "Upcoming" : "Recent",
      })),
    [visiblePlans],
  );
  const outlineOptions = useMemo(
    () =>
      currentLists.map((list) => ({
        value: list._id,
        label: list.name,
      })),
    [currentLists],
  );

  const handleCreateOutline = useCallback(async () => {
    const planName = selectedPlan?.name?.trim() || "Service plan";
    const date = selectedPlan?.date
      ? new Date(`${selectedPlan.date}T12:00:00`).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })
      : "";
    try {
      const newList = await createNewItemList({
        db,
        name: `${planName}${date ? ` · ${date}` : ""}`,
        currentLists,
      });
      pinSelectedPlan();
      dispatch(updateItemLists([...currentLists, newList]));
      dispatch(setItemListIsLoading(true));
      dispatch(selectItemList(newList._id));
      showToast(`Created ${newList.name}`, "success");
    } catch {
      showToast("Could not create the outline. Try again.", "error");
    }
  }, [currentLists, db, dispatch, pinSelectedPlan, selectedPlan, showToast]);

  const isSyncRunning = sync.status === "running";
  const isSyncStopping = sync.status === "cancelling";
  const isSyncActive = isSyncRunning || isSyncStopping;
  const actionBarItemDefs = useMemo((): ActionBarItemDef[] => isSyncActive ? [
    {
      id: "stop-sync",
      label: isSyncStopping ? "Stopping..." : "Stop syncing",
      disabled: isSyncStopping,
      renderButton: (isMeasure) => (
        <Button variant="tertiary" svg={Square} color="#ef4444" className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)} disabled={isSyncStopping} tabIndex={isMeasure ? -1 : undefined} onClick={isMeasure || isSyncStopping ? undefined : handleStopSync}>{isSyncStopping ? "Stopping..." : "Stop syncing"}</Button>
      ),
      onOverflowSelect: isSyncStopping ? undefined : handleStopSync,
      renderOverflowItem: () => <><Square className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-red-400")} />{isSyncStopping ? "Stopping..." : "Stop syncing"}</>,
    },
  ] : [
    {
      id: "sync-all",
      label: "Sync All",
      disabled: isSyncActive || !canSyncAny,
      renderButton: (isMeasure) => (
        <Button variant="tertiary" svg={RefreshCw} className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)} disabled={isSyncActive || !canSyncAny} tabIndex={isMeasure ? -1 : undefined} onClick={isMeasure ? undefined : () => handleSync("both")}>Sync All</Button>
      ),
      onOverflowSelect: () => handleSync("both"),
      renderOverflowItem: () => <><RefreshCw className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-cyan-400")} />Sync All</>,
    },
    {
      id: "import",
      label: "Import",
      disabled: isSyncActive,
      renderButton: (isMeasure) => isMeasure ? (
        <Button variant="tertiary" svg={Download} className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)} tabIndex={-1}>Import</Button>
      ) : (
        <Button
          variant="tertiary"
          svg={Download}
          className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)}
          disabled={isSyncActive}
          onClick={() => setIsImportOpen(true)}
        >
          Import
        </Button>
      ),
      onOverflowSelect: () => setIsImportOpen(true),
      renderOverflowItem: () => <><Download className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-cyan-400")} />Import</>,
    },
    {
      id: "refresh",
      label: isRefreshing ? "Refreshing…" : "Refresh",
      disabled: isRefreshing || isSyncActive,
      renderButton: (isMeasure) => (
        <Button
          variant="tertiary"
          svg={RefreshCw}
          iconSize="sm"
          color={isRefreshing ? "#22d3ee" : undefined}
          className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS, isRefreshing && "[&_svg]:animate-spin")}
          disabled={isRefreshing || isSyncActive}
          tabIndex={isMeasure ? -1 : undefined}
          onClick={isMeasure ? undefined : () => void handleRefresh()}
        >
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </Button>
      ),
      onOverflowSelect: () => void handleRefresh(),
      renderOverflowItem: () => <><RefreshCw className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-cyan-400")} />{isRefreshing ? "Refreshing…" : "Refresh"}</>,
    },
    {
      id: "sync-overlays",
      label: "Sync overlays",
      disabled: isSyncActive || !canSyncOverlays,
      renderButton: (isMeasure) => (
        <Button variant="tertiary" svg={RefreshCw} className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)} disabled={isSyncActive || !canSyncOverlays} tabIndex={isMeasure ? -1 : undefined} onClick={isMeasure ? undefined : () => handleSync("overlays")}>Sync overlays</Button>
      ),
      onOverflowSelect: () => handleSync("overlays"),
      renderOverflowItem: () => <><RefreshCw className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-cyan-400")} />Sync overlays</>,
    },
    {
      id: "sync-outline",
      label: "Sync outline",
      disabled: isSyncActive || !canSyncOutline,
      renderButton: (isMeasure) => (
        <Button variant="tertiary" svg={RefreshCw} className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)} disabled={isSyncActive || !canSyncOutline} tabIndex={isMeasure ? -1 : undefined} onClick={isMeasure ? undefined : () => handleSync("outline")}>Sync outline</Button>
      ),
      onOverflowSelect: () => handleSync("outline"),
      renderOverflowItem: () => <><RefreshCw className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-cyan-400")} />Sync outline</>,
    },
  ], [canSyncAny, canSyncOutline, canSyncOverlays, handleRefresh, handleStopSync, handleSync, isRefreshing, isSyncActive, isSyncStopping]);



  // The outline action can open this window before a plan is loaded. Keeping
  // the empty state visible is what lets an operator recover when the nearest
  // scheduled occurrence has no saved plan.
  const isVisible = !floatingWindowDismissed;
  const windowWidth = getControllerRightPanelWidthPx(window.innerWidth);
  const maxWindowHeight = Math.max(window.innerHeight - MARGIN * 2, 240);
  const defaultPosition = {
    x: Math.max(window.innerWidth - windowWidth - MARGIN, 0),
    y: MARGIN,
  };

  const lineItemsBySection = useMemo(
    () => buildLineItemsBySection(preview),
    [preview],
  );
  const assignmentsByTeam = useMemo(
    () => buildAssignmentsByTeam(preview),
    [preview],
  );
  const hasAssignments = getPreviewTeamAssignments(preview).length > 0;
  const syncItemsByLineItemKey = useMemo(() => {
    const grouped = new Map<string, ServicePlanningSyncItem[]>();
    for (const item of sync.syncItems) {
      if (!item.sourceLineItemKey) continue;
      if (!grouped.has(item.sourceLineItemKey)) {
        grouped.set(item.sourceLineItemKey, []);
      }
      grouped.get(item.sourceLineItemKey)?.push(item);
    }
    return grouped;
  }, [sync.syncItems]);

  const activeKey = sync.status === "running" || sync.status === "cancelling"
    ? `${sync.activeLabel}::${sync.activeSublabel}`
    : null;

  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeKey]);

  useEffect(() => {
    if (!hasAssignments && activeTab === "assignments") {
      setActiveTab("plan");
    }
  }, [activeTab, hasAssignments]);

  if (!isVisible) return null;

  const isRunning = sync.status === "running";
  const isCancelling = sync.status === "cancelling";
  const isFailed = sync.status === "failed";
  const isCancelled = sync.status === "cancelled";
  const isPreviewOnly = sync.status === "idle" && Boolean(preview);

  const planLabel = serviceOutline?.planLabel?.trim() || "Service Planning";
  const stateLabel = isPreviewOnly
    ? null
    : isRunning
      ? "Syncing"
      : isCancelling
        ? "Stopping"
        : isFailed
          ? "Sync Failed"
          : isCancelled
            ? "Sync Stopped"
            : "Sync Complete";

  const titleNode = (
    <span className="flex min-w-0 items-baseline gap-1.5 truncate">
      <span className="truncate">{planLabel}</span>
      {stateLabel ? (
        <span className="shrink-0 text-[11px] font-normal text-zinc-400">
          ({stateLabel})
        </span>
      ) : null}
    </span>
  );

  const handleClose = () => {
    if (autoCloseRef.current !== null) clearTimeout(autoCloseRef.current);
    dispatch(clearServicePlanningSyncState());
    dispatch(setServicePlanningFloatingWindowDismissed(true));
  };

  let savedPlanControl: ReactNode;
  if (!isSavedPlanAccessEnabled) {
    savedPlanControl = (
      <p className="text-xs text-zinc-400">
        Saved plans are not available for this account.
      </p>
    );
  } else if (plansError) {
    savedPlanControl = (
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-amber-300">{plansError}</p>
        <Button
          type="button"
          variant="tertiary"
          className="shrink-0 text-xs"
          onClick={() => void refreshPlans()}
        >
          Try again
        </Button>
      </div>
    );
  } else if (isLoadingPlans) {
    savedPlanControl = (
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <Spinner width="14px" borderWidth="2px" />
        Loading saved plans…
      </div>
    );
  } else if (planOptions.length > 0) {
    savedPlanControl = (
      <div className="flex flex-col gap-1">
        <Select
          label="Service plan"
          selectClassName="h-8 text-xs"
          disablePortal
          value={selectedPlanKey || ""}
          onChange={selectPlan}
          disabled={isSyncActive}
          options={planOptions}
        />
        <div className="flex items-center justify-between gap-2">
          {savedPlans.length > planOptions.length ? (
            <p className="text-[11px] text-zinc-500">
              Showing {planOptions.length} of {savedPlans.length} plans
            </p>
          ) : (
            <span />
          )}
          <Button
            type="button"
            variant="tertiary"
            className="shrink-0 text-xs"
            onClick={() => navigate("/teams-and-services/plans")}
          >
            View all plans
          </Button>
        </div>
      </div>
    );
  } else {
    savedPlanControl = (
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-zinc-400">No saved plans yet.</p>
        <Button
          type="button"
          variant="tertiary"
          className="shrink-0 text-xs"
          onClick={() => navigate("/teams-and-services/plans")}
        >
          Open Plans
        </Button>
      </div>
    );
  }

  let outlineBindingMessage: string | null = null;
  if (selectedList && outlinePlanBinding) {
    outlineBindingMessage =
      outlinePlanBinding.planKey === selectedPlanKey
        ? `Linked to ${outlinePlanBinding.planName}`
        : `Currently linked to ${outlinePlanBinding.planName}. Syncing the outline will relink it.`;
  } else if (selectedList && selectedPlan) {
    outlineBindingMessage = `Syncing will link ${selectedList.name} to this plan.`;
  }

  let emptyPreviewMessage = "Choose a saved plan to review it in the controller.";
  if (isLoading) {
    emptyPreviewMessage = "Loading the selected plan…";
  } else if (selectedPlan) {
    emptyPreviewMessage =
      "This plan has no controller preview yet. Refresh it or choose another plan.";
  }

  const planContextControls = (
    <section className="rounded-lg border border-zinc-700 bg-zinc-950/35 p-2.5">
      <div className="flex flex-col gap-2">
        {savedPlanControl}

        <div className="flex items-end gap-2">
          <Select
            label="Target outline"
            className="min-w-0 flex-1"
            selectClassName="h-8 text-xs"
            disablePortal
            value={selectedList?._id || ""}
            onChange={(outlineId) => {
              dispatch(setItemListIsLoading(true));
              dispatch(selectItemList(outlineId));
            }}
            disabled={isSyncActive || outlineOptions.length === 0}
            options={outlineOptions}
          />
          <Button
            type="button"
            variant="tertiary"
            svg={Plus}
            iconSize="sm"
            className="h-8 shrink-0 text-xs"
            disabled={isSyncActive || !selectedPlan}
            onClick={() => void handleCreateOutline()}
          >
            New
          </Button>
        </div>

        {outlineBindingMessage ? (
          <p className="text-[11px] text-zinc-400">
            {outlineBindingMessage}
          </p>
        ) : null}
      </div>
    </section>
  );

  return (
    <FloatingWindow
      ref={floatingWindowRef}
      title={titleNode}
      label={planLabel}
      onClose={handleClose}
      defaultPosition={defaultPosition}
      defaultWidth={windowWidth}
      defaultHeight={maxWindowHeight}
      autoHeight
    >
      <div className="flex flex-col gap-3 text-sm text-white">
        {planContextControls}

        {isFailed ? (
          <p className="text-red-400">{sync.error || "Try again."}</p>
        ) : null}

        {(isRunning || isCancelling) && sync.totalSteps > 0 ? (
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Spinner width="14px" borderWidth="2px" />
            <span>
              Step {Math.min(sync.currentStep + 1, sync.totalSteps)} of {sync.totalSteps}
            </span>
          </div>
        ) : null}

        {!isLoading && preview ? (
          <div className="flex flex-col gap-2">
            <div className="sticky -top-3 z-10 -mx-3 -mt-2 border-b border-zinc-700 bg-gray-800/95 px-3 pt-3 pb-2 backdrop-blur">
              <Tabs
                value={activeTab}
                onValueChange={(nextValue) =>
                  setActiveTab(nextValue as "plan" | "assignments")
                }
                className="w-full gap-0"
              >
                <TabsList
                  variant="line"
                  className={lineTabsListShellClassName}
                >
                  <TabsTrigger
                    value="plan"
                    className={lineTabsTriggerSmClassName}
                  >
                    Plan
                  </TabsTrigger>
                  {hasAssignments && (
                    <TabsTrigger
                      value="assignments"
                      className={lineTabsTriggerSmClassName}
                    >
                      Assignments
                    </TabsTrigger>
                  )}
                </TabsList>
              </Tabs>

              {serviceOutline?.loadedAt ? (
                <div className="mt-2 text-xs text-zinc-400">
                  {isPlanSourced ? "Updated" : "Imported"}{" "}
                  {new Date(serviceOutline.loadedAt).toLocaleString()}
                </div>
              ) : null}

              <Popover open={isImportOpen} onOpenChange={setIsImportOpen}>
                <PopoverAnchor asChild>
                  <div className="w-full">
                    <ActionBar items={actionBarItemDefs} className="mt-2" disablePortal />
                  </div>
                </PopoverAnchor>
                <PopoverContent
                  portal={false}
                  align="start"
                  className="w-(--radix-popover-trigger-width) bg-gray-800 border-gray-700 text-white"
                >
                  <div className="flex flex-col gap-3">
                    <p className="text-sm font-semibold">Load Service Plan</p>
                    <Input
                      label="Planning URL"
                      value={importUrl}
                      onChange={(v) => setImportUrl(String(v))}
                      placeholder="https://..."
                      disabled={isImporting}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleImport(); }}
                    />
                    <div className="flex justify-end gap-2">
                      <PopoverClose asChild>
                        <Button variant="tertiary" className="text-sm" disabled={isImporting}>Cancel</Button>
                      </PopoverClose>
                      <Button
                        variant="cta"
                        className="text-sm"
                        isLoading={isImporting}
                        disabled={isImporting || !importUrl.trim()}
                        onClick={() => void handleImport()}
                      >
                        {isImporting ? "Loading…" : "Load"}
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {activeTab === "plan" ? (
              <div className="flex flex-col gap-2 pr-1">
                {Array.from(lineItemsBySection.entries()).map(([sectionName, items]) => (
                  <div
                    key={sectionName}
                    className="rounded bg-zinc-950/40"
                  >
                    {sectionName && (
                      <div className="bg-zinc-950/60 px-2 py-1">
                        <span className="text-xs font-semibold tracking-wide text-white">
                          {sectionName}
                        </span>
                      </div>
                    )}
                    <ul className="divide-y divide-zinc-700">
                      {items.map((item, index) => {
                        const lineItemKey = getServicePlanningLineItemKey(item);
                        const relatedSyncItems =
                          syncItemsByLineItemKey.get(lineItemKey) ?? [];

                        const syncBadgeDataList = filterRedundantOverlayBadges(
                          relatedSyncItems
                            .map((syncItem) =>
                              getSyncBadgeData({
                                item: syncItem,
                                isRunning,
                                activeLabel: sync.activeLabel,
                                activeSublabel: sync.activeSublabel,
                              }),
                            )
                            .filter((d): d is NonNullable<SyncBadgeData> => d !== null),
                        );

                        const activeSyncData = syncBadgeDataList.find(
                          (d) => d.type === "active",
                        );
                        const isActive = Boolean(activeSyncData);

                        const hasCompletedSync = syncBadgeDataList.some(
                          (d) =>
                            d.type === "badge" &&
                            (d.label === "Overlay updated" ||
                              d.label === "Overlay created" ||
                              d.label === "Overlay found"),
                        );

                        // Count deduplicated badge labels
                        const labelCounts = new Map<
                          string,
                          { label: string; className: string; count: number }
                        >();
                        for (const data of syncBadgeDataList) {
                          if (data.type !== "badge") continue;
                          const existing = labelCounts.get(data.label);
                          if (existing) existing.count++;
                          else labelCounts.set(data.label, { label: data.label, className: data.className, count: 1 });
                        }

                        const badges = [
                          ...getLineItemBaseBadges(item, hideOutlineActions),
                          ...(item.overlayReady && !hasCompletedSync
                            ? [
                              <StatusBadge
                                key="overlay-ready"
                                className="bg-emerald-900/60 text-emerald-300"
                                label="Overlay ready"
                              />,
                            ]
                            : []),
                          ...(isActive && activeSyncData?.type === "active"
                            ? [
                              <span
                                key="active"
                                className="inline-flex shrink-0 items-center gap-1 rounded bg-cyan-900/60 px-1 py-0.5 text-[10px] font-medium text-cyan-200"
                              >
                                <Spinner width="10px" borderWidth="2px" />
                                {`Syncing ${activeSyncData.phase === "outline" ? "outline" : "overlay"}`}
                              </span>,
                            ]
                            : []),
                          ...Array.from(labelCounts.values()).map(
                            ({ label, className, count }) => (
                              <StatusBadge
                                key={label}
                                className={className}
                                label={count > 1 ? pluralizeBadgeLabel(label, count) : label}
                              />
                            ),
                          ),
                        ];

                        const isSongNotFound =
                          item.selectedForOutline &&
                          item.outlineItemType === "song" &&
                          !item.matchedLibraryItem;

                        return (
                          <li
                            key={`${sectionName}-${item.elementType}-${item.title}-${index}`}
                            ref={isActive ? activeItemRef : undefined}
                            className="flex flex-col gap-2 px-2 py-1.5"
                          >
                            <div className="flex flex-col gap-2">
                              <div className="flex gap-2">
                                <div className="flex min-w-0 items-center gap-1">
                                  {item.outlineItemType === "song" && (
                                    <Music size={11} className="shrink-0" color={iconColorMap.get("song")} />
                                  )}
                                  {item.outlineItemType === "bible" && (
                                    <Book size={11} className="shrink-0" color={iconColorMap.get("bible")} />
                                  )}
                                  <span className="wrap-break-word text-xs text-zinc-100">
                                    {item.elementType}
                                  </span>
                                </div>
                                <div className="flex flex-wrap justify-end gap-1 h-fit">
                                  {badges}
                                </div>
                              </div>

                              {(item.title || item.assigneeNames?.length || item.ledBy) && (
                                <div className="flex gap-2 flex-wrap">
                                  {item.title && (
                                    <div className={cn(
                                      "wrap-break-word text-xs",
                                      item.outlineItemType === "song"
                                        ? "font-medium text-blue-300"
                                        : item.outlineItemType === "bible"
                                          ? "font-medium text-yellow-300"
                                          : "text-zinc-300"
                                    )}>
                                      {item.outlineItemType === "bible" && item.parsedRef
                                        ? getBibleImportDisplayName(item.parsedRef, item.parsedRef.version)
                                        : item.title}
                                    </div>
                                  )}
                                  <div className="flex gap-2">

                                    {(item.assigneeNames?.length || item.ledBy) && item.title && (
                                      <div className="text-xs font-light text-zinc-400">
                                        {item.assigneeNames?.length ? "Assigned:" : "Led by:"}
                                      </div>
                                    )}
                                    {(item.assigneeNames?.length || item.ledBy) && (
                                      <div className="wrap-break-word text-xs text-zinc-300">
                                        {item.assigneeNames?.join(", ") || item.ledBy}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {!hideOutlineActions &&
                                item.outlineItemType === "bible" &&
                                item.parsedRef ? (
                                <Button
                                  variant="primary"
                                  color="#22d3ee"
                                  svg={BookOpen}
                                  iconSize="sm"
                                  className="self-start text-xs"
                                  aria-label={`Open ${item.title} in Bible`}
                                  onClick={() => handleBibleClick(item)}
                                >
                                  Open
                                </Button>
                              ) : null}

                              {isSongNotFound && !hideOutlineActions ? (
                                <Button
                                  variant="primary"
                                  svg={Plus}
                                  color="#22d3ee"
                                  iconSize="sm"
                                  className="self-start text-xs"
                                  aria-label={`Create song ${item.cleanedTitle || cleanPlanningTitle(item.title)}`}
                                  onClick={() =>
                                    handleCreateClick(
                                      item.cleanedTitle || cleanPlanningTitle(item.title),
                                    )
                                  }
                                >
                                  Create song
                                </Button>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2 pr-1">
                <p className="text-xs text-zinc-400">Only teams that have at least one assignment will be shown.</p>
                {assignmentsByTeam.size === 0 ? (
                  <p className="text-zinc-400">No assignments found.</p>
                ) : null}
                {Array.from(assignmentsByTeam.entries()).map(([teamName, assignments]) => (
                  <div key={teamName} className="rounded bg-zinc-950/40">
                    <div className="bg-zinc-950/60 px-2 py-1">
                      <span className="text-xs font-semibold tracking-wide text-white">
                        {teamName}
                      </span>
                    </div>
                    <ul className="divide-y divide-zinc-700">
                      {assignments.map((assignment, index) => (
                        <li
                          key={`${teamName}-${assignment.role}-${assignment.name}-${index}`}
                          className="flex items-start justify-between gap-3 px-2 py-1.5"
                        >
                          <div className="wrap-break-word text-xs text-zinc-300">
                            {assignment.role}
                          </div>
                          <div className="wrap-break-word text-right text-xs text-zinc-100">
                            {assignment.name}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {(!preview || isLoading) && !isFailed ? (
          <div
            className="flex items-center gap-2 text-zinc-400"
            role={isLoading ? "status" : undefined}
            aria-live={isLoading ? "polite" : undefined}
          >
            {isLoading ? <Spinner width="14px" borderWidth="2px" /> : null}
            <p>{emptyPreviewMessage}</p>
          </div>
        ) : null}
      </div>
    </FloatingWindow>
  );
};

export default ServicePlanningSyncFloatingWindow;
