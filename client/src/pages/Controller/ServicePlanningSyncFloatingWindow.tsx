import {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Book, BookOpen, Check, ChevronDown, Download, FileText, Music, Plus, RefreshCw, RotateCcw, Square } from "lucide-react";
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
import type { OverlayInfo } from "../../types";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverClose,
  PopoverTrigger,
} from "../../components/ui/Popover";
import Input from "../../components/Input/Input";
import { useToast } from "../../context/toastContext";
import type { RootState } from "../../store/store";
import Button from "../../components/Button/Button";
import FloatingWindow, { type FloatingWindowHandle } from "../../components/FloatingWindow/FloatingWindow";
import Spinner from "../../components/Spinner/Spinner";
import ProfileImagePreview from "../../components/ProfileImagePreview/ProfileImagePreview";
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

import { useCurrentServicePlanSource } from "./useCurrentServicePlanSource";
import ActionBar, { type ActionBarItem as ActionBarItemDef } from "../../components/ActionBar/ActionBar";
import { MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS, MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE } from "../../containers/Media/mediaLibraryMediaActionUi";
import { getControllerRightPanelWidthPx } from "../../utils/controllerPanelLayout";
import { GlobalInfoContext } from "../../context/globalInfo";
import { getServicePlanMicrophones } from "../../api/auth";
import type { ServicePlanMicrophone } from "../../types/servicePlan";
import { useControllerBasePath } from "../../context/activeController";
import { useActiveControllerProfile } from "../../context/activeController";
import { formatServicePlanDuration } from "../Services/servicePlanDuration";
import { getServicePlanResourceTypeLabel } from "../Services/servicePlanResources";
import {
  formatControllerServicePlanLabel,
  isControllerServicePlanUpcoming,
  limitControllerServicePlans,
} from "./controllerServicePlanSelection";
import ControllerServicePlanView from "./ControllerServicePlanView";
import { useServicePlanOutlinePush } from "../Services/useServicePlanOutlinePush";

const MARGIN = 16;

const EMPTY_OVERLAY_LIST: OverlayInfo[] = [];

const formatPreviewStartTime = (value: string) => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return value;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return value;
  const period = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${period}`;
};

const isPreviewHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

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

const getLineItemBaseBadges = (item: ServicePlanningLineItem) => {
  if (item.outlineItemType === "song") {
    if (!item.matchedLibraryItem) return [];
    return [
      <StatusBadge
        key="song"
        className="bg-green-900/60 text-green-300"
        label="Song"
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
          (candidate.outlineItemType === "bible" && Boolean(candidate.parsedRef)) ||
          (candidate.outlineItemType === "custom-document" &&
            candidate.matchedLibraryItem?.type === "free")
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

/**
 * Saved plans preserve a source element type for matching sync rules. That
 * value can be a generic internal type such as "free", so it must not take
 * precedence over the operator-facing item title in the Controller.
 */
const getLineItemDisplayTitle = (item: ServicePlanningLineItem): string =>
  (item.outlineItemType === "bible" && item.parsedRef
    ? getBibleImportDisplayName(item.parsedRef, item.parsedRef.version)
    : item.title.trim() || item.cleanedTitle.trim() || item.elementType.trim() || "Untitled item");

const ServicePlanningSyncFloatingWindow = ({
  hideOutlineActions = false,
  allowOverlaySync = true,
}: {
  hideOutlineActions?: boolean;
  /** Overlay sync belongs to the presentation/stream controller, not aux. */
  allowOverlaySync?: boolean;
}) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const controllerBasePath = useControllerBasePath();
  const controllerProfile = useActiveControllerProfile();
  const { churchBranding, churchId } = useContext(GlobalInfoContext) || {};
  const { loadPreview } = useServicePlanningImport();
  const { pushPlanToOutline } = useServicePlanOutlinePush();
  const { showToast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isPlanPickerOpen, setIsPlanPickerOpen] = useState(false);
  const [planSearch, setPlanSearch] = useState("");
  const [activePlanKey, setActivePlanKey] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isPushingSavedPlan, setIsPushingSavedPlan] = useState(false);
  const [activeTab, setActiveTab] = useState<"plan" | "assignments">("plan");
  const [microphones, setMicrophones] = useState<ServicePlanMicrophone[]>([]);
  // Keeps the Controller's copy of the plan in step with the Services editor.
  const {
    savedPlans,
    selectedPlan,
    selectedPlanDetails,
    selectedPlanKey,
    selectPlan,
    occurrence,
    returnToCurrentService,
    isManualSelection,
    isEnabled: isSavedPlanAccessEnabled,
    isLoading,
    isLoadingPlans,
    plansError,
    isPlanSourced,
    refresh: refreshPlan,
    refreshPlans,
  } = useCurrentServicePlanSource();
  const currentPlanRef = useRef(selectedPlanDetails);
  currentPlanRef.current = selectedPlanDetails;

  const preview = useSelector((s: RootState) => s.servicePlanningImport.preview);
  const allFreeFormDocs = useSelector((s: RootState) => s.allDocs.allFreeFormDocs);
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
  const selectedList = useSelector(
    (s: RootState) => s.undoable?.present?.itemLists?.selectedList,
  );
  const activeItemListId = useSelector(
    (s: RootState) => s.undoable?.present?.itemList?.selectedItemListId,
  );
  const activePlanElementId = useMemo(() => {
    if (!isPlanSourced || !selectedPlanDetails || !activeItemListId) return undefined;
    for (const section of selectedPlanDetails.sections) {
      for (const element of section.elements) {
        const pushedIds = element.pushedOutlineListIds?.length
          ? element.pushedOutlineListIds
          : element.pushedOutlineListId ? [element.pushedOutlineListId] : [];
        if (pushedIds.includes(activeItemListId) || activeItemListId.startsWith(`${element.id}::attachment:`)) {
          return element.id;
        }
      }
    }
    return undefined;
  }, [activeItemListId, isPlanSourced, selectedPlanDetails]);
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
    if (!churchId) {
      setMicrophones([]);
      return;
    }
    let cancelled = false;
    getServicePlanMicrophones(churchId)
      .then(({ microphones: result }) => {
        if (!cancelled) setMicrophones(result);
      })
      .catch(() => {
        if (!cancelled) setMicrophones([]);
      });
    return () => {
      cancelled = true;
    };
  }, [churchId]);

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
    allowOverlaySync &&
    !isContextChanging &&
    hasSyncableOverlayItems(preview, overlays);
  const canSyncOutline =
    !isContextChanging && Boolean(selectedList) && (isPlanSourced && selectedPlanDetails
      ? selectedPlanDetails.sections.length > 0
      : hasSyncableOutlineItems(preview));
  const canSyncAny = allowOverlaySync
    ? canSyncOverlays || canSyncOutline
    : canSyncOutline;

  const handleSync = useCallback((mode: "overlays" | "outline" | "both") => {
    if (mode !== "overlays" && isPlanSourced && selectedPlanDetails && canSyncOutline) {
      if (isPushingSavedPlan || isContextChanging || !selectedList) return;
      setIsPushingSavedPlan(true);
      const sourcePlan = selectedPlanDetails;
      void pushPlanToOutline(
        sourcePlan,
        () => currentPlanRef.current === sourcePlan,
      )
        .then((result) => {
          const added = result.items.filter((item) => item.type !== "heading").length;
          if (result.skippedTitles.length) {
            showToast(`${added} item${added === 1 ? "" : "s"} added; review unresolved attachments in the service plan.`, "info");
          } else if (added) {
            showToast(`${added} item${added === 1 ? "" : "s"} added to the live outline.`, "success");
          } else {
            showToast("All attached content is already in the live outline.", "success");
          }
          if (mode === "both" && allowOverlaySync && canSyncOverlays) {
            dispatch(setServicePlanningFloatingWindowDismissed(false));
            dispatch(startServicePlanningSync({ mode: "overlays" }));
          }
        })
        .catch((error: unknown) => {
          showToast(error instanceof Error ? error.message : "Could not add plan content to the outline.", "error");
        })
        .finally(() => setIsPushingSavedPlan(false));
      return;
    }
    const effectiveMode = allowOverlaySync ? mode : "outline";
    const shouldSyncOverlays = effectiveMode !== "outline" && canSyncOverlays;
    const shouldSyncOutline = effectiveMode !== "overlays" && canSyncOutline;
    if (!shouldSyncOverlays && !shouldSyncOutline) return;

    const nextMode =
      shouldSyncOverlays && shouldSyncOutline
        ? "both"
        : shouldSyncOverlays
          ? "overlays"
          : "outline";
    dispatch(setServicePlanningFloatingWindowDismissed(false));
    dispatch(startServicePlanningSync({ mode: nextMode }));
  }, [allowOverlaySync, canSyncOutline, canSyncOverlays, dispatch, isContextChanging, isPlanSourced, isPushingSavedPlan, pushPlanToOutline, selectedList, selectedPlanDetails, showToast]);

  const handleStopSync = useCallback(() => {
    dispatch(cancelServicePlanningSync());
  }, [dispatch]);

  const handleCreateClick = (title: string) => {
    navigate(
      `${controllerBasePath}/create?type=song&name=${encodeURIComponent(title)}`,
    );
  };

  const handleBibleClick = (item: ServicePlanningLineItem) => {
    if (!item.parsedRef) return;
    const params = new URLSearchParams();
    params.set("search", bibleRefToSearchString(item.parsedRef));
    if (item.parsedRef.version) {
      params.set("version", item.parsedRef.version);
    }
    navigate(`${controllerBasePath}/bible?${params.toString()}`);
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
  const planPickerPlans = useMemo(() => {
    const search = planSearch.trim().toLocaleLowerCase();
    const candidates = search ? savedPlans : visiblePlans;
    if (!search) return candidates;
    return candidates.filter((plan) =>
      `${plan.name || "Service plan"} ${plan.date} ${plan.startsAt || ""}`
        .toLocaleLowerCase()
        .includes(search),
    );
  }, [planSearch, savedPlans, visiblePlans]);
  const plansByGroup = useMemo(
    () => ({
      upcoming: planPickerPlans.filter((plan) =>
        isControllerServicePlanUpcoming(plan),
      ),
      recent: planPickerPlans.filter(
        (plan) => !isControllerServicePlanUpcoming(plan),
      ),
    }),
    [planPickerPlans],
  );
  const planPickerId = useId();
  const planPickerIndexByKey = useMemo(
    () => new Map(planPickerPlans.map((plan, index) => [plan.planKey, index])),
    [planPickerPlans],
  );
  const activePlan =
    planPickerPlans.find((plan) => plan.planKey === activePlanKey) ??
    planPickerPlans.find((plan) => plan.planKey === selectedPlanKey) ??
    planPickerPlans[0] ??
    null;
  const activePlanIndex = activePlan
    ? planPickerIndexByKey.get(activePlan.planKey) ?? -1
    : -1;
  const activePlanOptionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isPlanPickerOpen || activePlanIndex < 0) return;
    activePlanOptionRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activePlanIndex, isPlanPickerOpen]);
  const selectPickerPlan = (planKey: string) => {
    selectPlan(planKey);
    setIsPlanPickerOpen(false);
    setPlanSearch("");
    setActivePlanKey(null);
  };
  const isSyncRunning = sync.status === "running";
  const isSyncStopping = sync.status === "cancelling";
  const isSyncActive = isSyncRunning || isSyncStopping;
  const actionBarItemDefs = useMemo((): ActionBarItemDef[] => {
    const items = isSyncActive ? [
    {
      id: "stop-sync",
      label: isSyncStopping ? "Stopping..." : "Stop syncing",
      disabled: isSyncStopping,
      renderButton: (isMeasure: boolean) => (
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
      renderButton: (isMeasure: boolean) => (
        <Button variant="tertiary" svg={RefreshCw} className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)} disabled={isSyncActive || !canSyncAny} tabIndex={isMeasure ? -1 : undefined} onClick={isMeasure ? undefined : () => handleSync("both")}>Sync All</Button>
      ),
      onOverflowSelect: () => handleSync("both"),
      renderOverflowItem: () => <><RefreshCw className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-cyan-400")} />Sync All</>,
    },
    {
      id: "refresh",
      label: isRefreshing ? "Refreshing…" : "Refresh",
      disabled: isRefreshing || isSyncActive,
      renderButton: (isMeasure: boolean) => (
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
      renderButton: (isMeasure: boolean) => (
        <Button variant="tertiary" svg={RefreshCw} className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)} disabled={isSyncActive || !canSyncOverlays} tabIndex={isMeasure ? -1 : undefined} onClick={isMeasure ? undefined : () => handleSync("overlays")}>Sync overlays</Button>
      ),
      onOverflowSelect: () => handleSync("overlays"),
      renderOverflowItem: () => <><RefreshCw className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-cyan-400")} />Sync overlays</>,
    },
    {
      id: "sync-outline",
      label: isPushingSavedPlan ? "Importing…" : "Sync outline",
      disabled: isSyncActive || isPushingSavedPlan || !canSyncOutline,
      renderButton: (isMeasure: boolean) => (
        <Button variant="tertiary" svg={RefreshCw} className={cn("shrink-0", MEDIA_LIBRARY_ACTION_BAR_BTN_CLASS)} disabled={isSyncActive || isPushingSavedPlan || !canSyncOutline} tabIndex={isMeasure ? -1 : undefined} onClick={isMeasure ? undefined : () => handleSync("outline")}>{isPushingSavedPlan ? "Importing…" : "Sync outline"}</Button>
      ),
      onOverflowSelect: () => handleSync("outline"),
      renderOverflowItem: () => <><RefreshCw className={cn(MEDIA_LIBRARY_MEDIA_ACTION_LUCIDE_SIZE, "text-cyan-400")} />Sync outline</>,
    },
    {
      id: "import",
      label: "Import",
      disabled: isSyncActive,
      renderButton: (isMeasure: boolean) => isMeasure ? (
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
    ];
    return allowOverlaySync
      ? items
      : items.filter((item) => item.id !== "sync-all" && item.id !== "sync-overlays");
  }, [allowOverlaySync, canSyncAny, canSyncOutline, canSyncOverlays, handleRefresh, handleStopSync, handleSync, isPushingSavedPlan, isRefreshing, isSyncActive, isSyncStopping]);



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
  const sectionLabelColor = churchBranding?.colors?.[1]?.value || "#f97316";
  const sectionBorderColor = churchBranding?.colors?.[0]?.value || "#f97316";
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

  let selectedPlanLabel = "Choose a service plan";
  if (selectedPlan) {
    selectedPlanLabel = formatControllerServicePlanLabel(selectedPlan);
  } else if (!isPlanSourced && serviceOutline?.planLabel?.trim()) {
    selectedPlanLabel = serviceOutline.planLabel.trim();
  } else if (plansError) {
    selectedPlanLabel = "Saved plans unavailable";
  } else if (occurrence && !isLoadingPlans) {
    selectedPlanLabel = "No plan for current service";
  } else if (!isLoadingPlans && savedPlans.length === 0) {
    selectedPlanLabel = "No saved plans yet";
  }

  let savedPlanControl: ReactNode;
  if (!isSavedPlanAccessEnabled) {
    savedPlanControl = (
      <p className="text-xs text-zinc-400">
        Saved plans are not available for this account.
      </p>
    );
  } else {
    savedPlanControl = (
      <div className="flex min-w-0 flex-col gap-1">
        <Popover
          open={isPlanPickerOpen}
          onOpenChange={(open) => {
            setIsPlanPickerOpen(open);
            if (open) {
              setActivePlanKey(
                planPickerPlans.some((plan) => plan.planKey === selectedPlanKey)
                  ? selectedPlanKey
                  : planPickerPlans[0]?.planKey ?? null,
              );
            } else {
              setPlanSearch("");
              setActivePlanKey(null);
            }
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Select service plan: ${selectedPlanLabel}`}
              disabled={isSyncActive || isLoadingPlans}
              className="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-zinc-600 bg-zinc-900 px-2.5 text-left text-xs text-white outline-none transition-colors hover:border-zinc-400 focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="truncate">{selectedPlanLabel}</span>
              {isLoadingPlans ? (
                <Spinner width="14px" borderWidth="2px" />
              ) : (
                <ChevronDown size={14} className="shrink-0 text-zinc-400" aria-hidden />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            portal={false}
            align="start"
            data-testid="service-plan-picker-content"
            className="flex max-h-[min(var(--radix-popper-available-height),65vh,24rem)] w-(--radix-popover-trigger-width) flex-col overflow-hidden border-zinc-700 bg-gray-800 p-2 text-white"
          >
            <input
              type="search"
              autoFocus
              role="combobox"
              aria-label="Search all saved plans"
              aria-autocomplete="list"
              aria-expanded={isPlanPickerOpen}
              aria-controls={`${planPickerId}-listbox`}
              aria-activedescendant={
                activePlanIndex >= 0
                  ? `${planPickerId}-option-${activePlanIndex}`
                  : undefined
              }
              placeholder="Search all saved plans"
              value={planSearch}
              onChange={(event) => {
                setPlanSearch(event.target.value);
                setActivePlanKey(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  if (planPickerPlans.length === 0) return;
                  event.preventDefault();
                  const direction = event.key === "ArrowDown" ? 1 : -1;
                  const nextIndex = activePlanIndex < 0
                    ? direction > 0
                      ? 0
                      : planPickerPlans.length - 1
                    : (activePlanIndex + direction + planPickerPlans.length) %
                      planPickerPlans.length;
                  setActivePlanKey(planPickerPlans[nextIndex].planKey);
                } else if (event.key === "Home" || event.key === "End") {
                  if (planPickerPlans.length === 0) return;
                  event.preventDefault();
                  const index = event.key === "Home" ? 0 : planPickerPlans.length - 1;
                  setActivePlanKey(planPickerPlans[index].planKey);
                } else if (event.key === "Enter" && activePlan && !isSyncActive) {
                  event.preventDefault();
                  selectPickerPlan(activePlan.planKey);
                }
              }}
              className="mb-2 h-8 w-full shrink-0 rounded border border-zinc-600 bg-zinc-900 px-2 text-xs text-white outline-none placeholder:text-zinc-500 focus-visible:ring-2 focus-visible:ring-cyan-500"
            />
            {plansError ? (
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-700 py-2 text-xs">
                <span className="text-amber-300">{plansError}</span>
                <Button
                  type="button"
                  variant="tertiary"
                  className="shrink-0 text-xs"
                  onClick={() => void refreshPlans()}
                >
                  Try again
                </Button>
              </div>
            ) : null}
            <div
              id={`${planPickerId}-listbox`}
              role="listbox"
              aria-label="Saved service plans"
              className="min-h-0 flex-1 overflow-y-auto"
            >
              {planPickerPlans.length > 0 ? (
                ([
                  ["Upcoming", plansByGroup.upcoming],
                  ["Recent", plansByGroup.recent],
                ] as const).map(([group, plans]) =>
                  plans.length > 0 ? (
                    <div
                      key={group}
                      role="group"
                      aria-labelledby={`${planPickerId}-${group}`}
                    >
                      <p
                        id={`${planPickerId}-${group}`}
                        className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400"
                      >
                        {group}
                      </p>
                      {plans.map((plan) => {
                        const selected = plan.planKey === selectedPlanKey;
                        const optionIndex = planPickerIndexByKey.get(plan.planKey) ?? 0;
                        const active = plan.planKey === activePlan?.planKey;
                        return (
                          <button
                            key={plan.planKey}
                            id={`${planPickerId}-option-${optionIndex}`}
                            ref={active ? activePlanOptionRef : undefined}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            tabIndex={-1}
                            disabled={isSyncActive}
                            onMouseMove={() => setActivePlanKey(plan.planKey)}
                            onClick={() => selectPickerPlan(plan.planKey)}
                            className={cn(
                              "flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-zinc-700 disabled:opacity-60",
                              active && "bg-zinc-700 outline-none",
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {formatControllerServicePlanLabel(plan)}
                            </span>
                            {selected ? <Check size={14} className="shrink-0 text-cyan-300" aria-hidden /> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null,
                )
              ) : (
              <p className="px-2 py-3 text-xs text-zinc-400">
                {savedPlans.length === 0
                  ? "No saved plans yet."
                  : "No plans match your search."}
              </p>
              )}
            </div>
            {!planSearch.trim() && savedPlans.length > visiblePlans.length ? (
              <p className="border-t border-zinc-700 px-2 pt-2 text-[11px] text-zinc-400">
                Search to find more saved plans.
              </p>
            ) : null}
          </PopoverContent>
        </Popover>
        {isManualSelection ? (
          <Button
            type="button"
            variant="tertiary"
            svg={RotateCcw}
            className="self-start px-1 py-0.5 text-[11px] text-zinc-400 hover:text-white"
            disabled={isSyncActive}
            onClick={returnToCurrentService}
          >
            Return to current service
          </Button>
        ) : null}
        {plansError && !isPlanPickerOpen ? (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-amber-300">{plansError}</span>
            <Button
              type="button"
              variant="tertiary"
              className="shrink-0 text-xs"
              onClick={() => void refreshPlans()}
            >
              Try again
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  let emptyPreviewMessage = "Choose a saved plan to review it in the controller.";
  if (isLoading) {
    emptyPreviewMessage = "Loading the selected plan…";
  } else if (plansError) {
    emptyPreviewMessage = "Saved plans could not be loaded. Try again above.";
  } else if (!selectedPlan && occurrence) {
    emptyPreviewMessage =
      "No saved plan exists for the current service. Choose another saved plan above.";
  } else if (selectedPlan) {
    emptyPreviewMessage =
      "This plan has no controller preview yet. Refresh it or choose another plan.";
  }

  const planContextControls = (
    <section className="min-w-0">{savedPlanControl}</section>
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

        <div className="sticky -top-3 z-10 -mx-3 -mt-2 border-b border-zinc-700 bg-gray-800/95 px-3 pt-3 pb-2 backdrop-blur">
          <Tabs
            value={activeTab}
            onValueChange={(nextValue) =>
              setActiveTab(nextValue as "plan" | "assignments")
            }
            className="w-full gap-0"
          >
            <TabsList variant="line" className={lineTabsListShellClassName}>
              <TabsTrigger value="plan" className={lineTabsTriggerSmClassName}>
                Plan
              </TabsTrigger>
              {hasAssignments ? (
                <TabsTrigger
                  value="assignments"
                  className={lineTabsTriggerSmClassName}
                >
                  Assignments
                </TabsTrigger>
              ) : null}
            </TabsList>
          </Tabs>

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

          {serviceOutline?.loadedAt ? (
            <div className="mt-2 text-xs text-zinc-400">
              {isPlanSourced ? "Updated" : "Imported"}{" "}
              {new Date(serviceOutline.loadedAt).toLocaleString()}
            </div>
          ) : null}
        </div>

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

        {!isLoading && (preview || (isPlanSourced && selectedPlanDetails)) ? (
          <div className="flex flex-col gap-2">
            {activeTab === "plan" ? (
              isPlanSourced && selectedPlanDetails ? (
                <ControllerServicePlanView
                  key={`${churchId}:${controllerProfile.id}`}
                  plan={selectedPlanDetails}
                  churchId={churchId || ""}
                  controllerProfileId={controllerProfile.id}
                  activeItemId={activePlanElementId}
                />
              ) : (
              <div className="flex flex-col gap-2 pr-1">
                {Array.from(lineItemsBySection.entries()).map(([sectionName, items]) => (
                  <div
                    key={sectionName}
                    className="overflow-hidden rounded-lg border border-zinc-700/80 border-l-2 bg-zinc-950/40"
                    style={{ borderLeftColor: sectionBorderColor }}
                  >
                    {sectionName && (
                      <div className="border-b border-zinc-700/80 bg-zinc-950/80 px-2.5 py-1.5">
                        <span
                          className="text-xs font-semibold tracking-wide"
                          style={{ color: sectionLabelColor }}
                        >
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

                        const isSongNotFound =
                          item.selectedForOutline &&
                          item.outlineItemType === "song" &&
                          !item.attachedSongs?.length &&
                          !item.matchedLibraryItem;

                        const badges = [
                          ...getLineItemBaseBadges(item),
                          ...(item.overlayReady && !hasCompletedSync
                            ? [
                              <span
                                key="overlay-ready"
                                className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-900/60 text-emerald-300"
                                aria-label="Overlay ready"
                                title="Overlay ready"
                              >
                                <Check size={11} strokeWidth={3} aria-hidden />
                              </span>,
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

                        const displayTitle = getLineItemDisplayTitle(item);

                        return (
                          <li
                            key={`${sectionName}-${item.elementType}-${item.title}-${index}`}
                            ref={isActive ? activeItemRef : undefined}
                            className="flex flex-col gap-1.5 px-2.5 py-2"
                          >
                            <div className="flex flex-col gap-1.5">
                              {item.startTime || (item.durationMinutes ?? 0) > 0 ? (
                                <div className="flex flex-wrap gap-x-3 text-[11px] text-zinc-400">
                                  {item.startTime ? <span>{formatPreviewStartTime(item.startTime)}</span> : null}
                                  {(item.durationMinutes ?? 0) > 0 ? (
                                    <span>{formatServicePlanDuration({ durationMinutes: item.durationMinutes })}</span>
                                  ) : null}
                                </div>
                              ) : null}
                              <div className="flex items-start gap-2">
                                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                  {item.outlineItemType === "song" && (
                                    <Music size={11} className="shrink-0" color={iconColorMap.get("song")} />
                                  )}
                                  {item.outlineItemType === "bible" && (
                                    <Book size={11} className="shrink-0" color={iconColorMap.get("bible")} />
                                  )}
                                  <span className={cn(
                                    "wrap-break-word text-xs font-semibold",
                                    item.outlineItemType === "song"
                                      ? "text-blue-300"
                                      : item.outlineItemType === "bible"
                                        ? "text-yellow-300"
                                        : "text-zinc-100",
                                  )}>
                                    {displayTitle}
                                  </span>
                                </div>
                                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                                  {badges}
                                </div>
                              </div>

                              {item.attachedSongs?.length ? (
                                <div className="flex flex-col gap-1 border-l border-cyan-500/40 pl-2 text-xs text-cyan-200">
                                  {item.attachedSongs.map((song, index) => (
                                    <div key={`${song.songId || song.title}-${index}`} className="flex flex-wrap items-center gap-1.5">
                                      <Music size={11} className="shrink-0 text-cyan-400" aria-hidden />
                                      <span className="wrap-break-word">{song.title}</span>
                                      {song.inLibrary ? (
                                        <Check size={13} className="text-emerald-400" aria-label={`${song.title} is in library`} />
                                      ) : !hideOutlineActions ? (
                                        <div className="flex items-center gap-1 rounded border border-dashed border-amber-400/60 px-1.5 py-0.5 text-amber-100">
                                          <AlertTriangle size={12} aria-hidden />
                                          <span>Not in library</span>
                                          <Button variant="primary" svg={Plus} color="#22d3ee" iconSize="xs" className="min-h-0 px-1 py-0.5 text-xs" aria-label={`Create song ${song.title}`} onClick={() => handleCreateClick(song.title)}>Create song</Button>
                                        </div>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {item.attachedCustomDocuments?.length ? (
                                <div className="flex flex-col gap-1 border-l border-indigo-500/40 pl-2 text-xs text-indigo-200">
                                  {item.attachedCustomDocuments.map((document, documentIndex) => {
                                    const currentDocument = allFreeFormDocs.find(
                                      (candidate) => candidate._id === document.documentId && candidate.type === "free",
                                    );
                                    const title = currentDocument?.name?.trim() || document.title;
                                    return (
                                      <div key={`${document.documentId}:${documentIndex}`} className="flex flex-wrap items-center gap-1.5">
                                        <FileText size={11} className="shrink-0 text-indigo-300" aria-hidden />
                                        <span className="wrap-break-word">{title}</span>
                                        {currentDocument ? (
                                          <Check size={13} className="text-emerald-400" aria-label={`${title} is in the library`} />
                                        ) : (
                                          <span className="text-amber-200">Unavailable</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}

                              {item.contentResources?.length ? (
                                <div className="flex flex-col gap-1 border-l border-blue-500/40 pl-2 text-xs text-blue-100">
                                  {item.contentResources.map((resource) => {
                                    const content = (
                                      <>
                                        <span className="text-zinc-500">{getServicePlanResourceTypeLabel(resource.type)}:</span>{" "}
                                        <span className="wrap-break-word">{resource.title}</span>
                                      </>
                                    );
                                    return (
                                      <div key={resource.id} className="flex flex-col gap-0.5">
                                        {resource.url && isPreviewHttpUrl(resource.url) ? (
                                          <a
                                            href={resource.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="wrap-break-word underline decoration-blue-400/40 underline-offset-2 hover:text-blue-200"
                                          >
                                            {content}
                                          </a>
                                        ) : <div>{content}</div>}
                                        {resource.detail ? (
                                          <div className="whitespace-pre-wrap wrap-break-word text-zinc-300">{resource.detail}</div>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}

                              {(item.assigneeNames?.length || item.ledBy) && (
                                <div className="flex flex-wrap gap-x-1.5 text-xs text-zinc-400">
                                  <span>{item.assigneeNames?.length ? "Assigned:" : "Led by:"}</span>
                                  <span className="wrap-break-word text-zinc-300">
                                    {item.assigneeNames?.join(", ") || item.ledBy}
                                  </span>
                                </div>
                              )}
                              {item.microphoneAssignments?.length ? (
                                <div className="flex flex-col gap-1 text-xs text-zinc-400">
                                  {item.microphoneAssignments.map((assignment, assignmentIndex) => (
                                    <div key={`${assignment.assigneeName || "unassigned"}-${assignmentIndex}`} className="flex flex-wrap items-center gap-1.5">
                                      <span>{assignment.assigneeName || "Unassigned"}</span>
                                      {assignment.microphoneIds.map((microphoneId) => {
                                        const microphone = microphones.find((candidate) => candidate.id === microphoneId);
                                        const label = microphone
                                          ? `${microphone.name}${microphone.type ? ` · ${microphone.type}` : ""}`
                                          : microphoneId;
                                        return (
                                          <span
                                            key={microphoneId}
                                            className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900/70 px-1.5 py-0.5"
                                          >
                                            {microphone ? <span className="size-2 rounded-full" style={{ backgroundColor: microphone.color }} aria-hidden /> : null}
                                            {label}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {item.note ? (
                                <div className="whitespace-pre-wrap wrap-break-word rounded bg-zinc-900/70 px-2 py-1.5 text-xs text-zinc-300">
                                  <span className="mr-1 text-zinc-500">Notes</span>{item.note}
                                </div>
                              ) : null}
                              {item.teamNotes?.length ? (
                                <div className="flex flex-col gap-1">
                                  {item.teamNotes.map((teamNote, noteIndex) => (
                                    <div key={`${teamNote.teamName}-${noteIndex}`} className="whitespace-pre-wrap wrap-break-word text-xs text-zinc-400">
                                      <span className="text-zinc-500">{teamNote.teamName}:</span>{" "}{teamNote.note}
                                    </div>
                                  ))}
                                </div>
                              ) : null}

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
                                <div className="flex self-start flex-wrap items-center gap-2 rounded border border-dashed border-amber-400/60 bg-amber-400/5 px-2 py-1 text-xs text-amber-100">
                                  <div className="flex items-center gap-1.5">
                                    <AlertTriangle
                                      size={13}
                                      className="shrink-0 text-amber-300"
                                      aria-hidden
                                    />
                                    <span className="font-medium text-amber-50">
                                      Not in library
                                    </span>
                                  </div>
                                  <Button
                                    variant="primary"
                                    svg={Plus}
                                    color="#22d3ee"
                                    iconSize="xs"
                                    className="min-h-0 px-1.5 py-0.5 text-xs"
                                    aria-label={`Create song ${item.cleanedTitle || cleanPlanningTitle(item.title)}`}
                                    onClick={() =>
                                      handleCreateClick(
                                        item.cleanedTitle || cleanPlanningTitle(item.title),
                                      )
                                    }
                                  >
                                    Create song
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
              )
            ) : (
              <div className="flex flex-col gap-2 pr-1">
                <p className="text-xs text-zinc-400">Only teams that have at least one assignment will be shown.</p>
                {assignmentsByTeam.size === 0 ? (
                  <p className="text-zinc-400">No assignments found.</p>
                ) : null}
                {Array.from(assignmentsByTeam.entries()).map(([teamName, assignments]) => (
                  <section
                    key={teamName}
                    className="overflow-hidden rounded-lg border border-zinc-700/80 border-l-2 bg-zinc-950/40"
                    style={{ borderLeftColor: sectionBorderColor }}
                  >
                    <div className="border-b border-zinc-700/80 bg-zinc-950/80 px-2.5 py-1.5">
                      <h3
                        className="text-xs font-semibold tracking-wide"
                        style={{ color: sectionLabelColor }}
                      >
                        {teamName}
                      </h3>
                    </div>
                    <ul className="divide-y divide-zinc-700">
                      {assignments.map((assignment, index) => (
                        <li
                          key={`${teamName}-${assignment.role}-${assignment.name}-${index}`}
                          className="flex items-center gap-2 px-2.5 py-2"
                        >
                          {assignment.profileImageUrl ? (
                            <ProfileImagePreview
                              imageUrl={assignment.profileImageUrl}
                              memberName={assignment.name}
                              className="size-7"
                            />
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-zinc-100">
                              {assignment.name}
                            </p>
                            <p className="truncate text-[11px] text-zinc-400">
                              {assignment.role}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {((!preview && !(isPlanSourced && selectedPlanDetails)) || isLoading) && !isFailed ? (
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
