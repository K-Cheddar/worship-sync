import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  LayoutTemplate,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Radio,
  Redo2,
  RefreshCw,
  Share2,
  Undo2,
  Upload,
} from "lucide-react";
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
} from "../../components/Button";
import Checkbox from "../../components/Checkbox/Checkbox";
import DebouncedInput from "../../components/DebouncedInput/DebouncedInput";
import Input from "../../components/Input/Input";
import Select from "../../components/Select/Select";
import TimePicker from "../../components/TimePicker/TimePicker";
import ServicePlanRolePickerContent from "../../components/ServicePlanRolePickerContent";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  lineTabsListShellClassName,
  lineTabsTriggerSmClassName,
} from "@/components/ui/tabs";
import { cn } from "@/utils/cnHelper";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { useToast } from "../../context/toastContext";
import { useDispatch, useSelector } from "../../hooks";
import { updateAllDocs } from "../../utils/dbUtils";
import { initiateAllItemsList } from "../../store/allItemsSlice";
import { upsertItemInAllDocs } from "../../store/allDocsSlice";
import { upsertItemInAllItemsList } from "../../store/allItemsSlice";
import { broadcastItemUpdate } from "../../store/store";
import { applyPouchAudit } from "../../utils/pouchAudit";
import { sortNamesInList } from "../../utils/sort";
import { getYouTubeVideoReference } from "../../utils/youtube";
import type { DBAllItems, DBItem } from "../../types";
import {
  getServicePlan,
  getServicePlanAssignmentHistory,
  getServicePlanMicrophones,
  listServicePlanTemplates,
  publishServicePlan,
  saveServicePlan,
  saveServicePlanAssignmentHistory,
  sendServicePlanShareEmail,
  unpublishServicePlan,
  updateServicePlanPublicLive,
  AuthApiError,
  type YouTubeSearchResult,
  type ServicePlanPublicUrls,
  type ServicePlanShareVersion,
} from "../../api/auth";
import { showApiErrorToast } from "../../utils/apiErrorToast";
import { keepElementInView } from "../../utils/generalUtils";
import { serverNow } from "../../utils/serverTime";
import { useSyncOnReconnect } from "../../hooks/useSyncOnReconnect";
import { getServicePlanKey } from "../../utils/servicePlanKeys";
import {
  formatOccurrenceRowLabel,
  getSharedOccurrenceTiming,
  isOccurrenceOnCalendarDay,
} from "../../utils/teamScheduleOccurrences";
import { memberName } from "../Teams/teamsUtils";
import TeamMicrophonesPanel from "../Teams/pages/TeamMicrophonesPanel";
import {
  getTeamMicrophoneRows,
  type TeamsAssignmentSummaryRow,
} from "../Teams/pages/teamsAssignmentsSummary";
import {
  getServicePlanningImportDataFromUrl,
  type ServicePlanningImportData,
} from "../../containers/Overlays/eventParser";
import {
  buildServicePlanSectionsFromImport,
  buildServicePlanSourceImport,
} from "./servicePlanFromImport";
import { parsePlanningCenterPdfText } from "./planningCenterPdfParser";
import { extractTextFromPdfFile } from "./extractPdfText";
import PlanningCenterAccountImportFields from "./PlanningCenterAccountImportFields";
import { getPlanningCenterPlanImport } from "../../api/planningCenter";
import {
  DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
  refreshServicePlanFromImport,
  type ServicePlanningRefreshOptions,
} from "./servicePlanImportSync";
import ServicePlanImportReviewWindow from "./ServicePlanImportReviewWindow";
import {
  applySelectedServicePlanImportChanges,
  summarizeServicePlanImport,
  type ServicePlanImportSummary,
} from "./servicePlanImportSummary";
import ServicePlanTemplateModal, {
  type ServicePlanTemplateModalMode,
} from "./ServicePlanTemplateModal";
import ServicePlanEmailModal, {
  type ServicePlanEmailDraft,
} from "./ServicePlanEmailModal";
import {
  formatPlanStartTimeDisplay,
  servicePlanElementDomId,
  type ServicePlanRoleNoteOption,
  type ServicePlanTeamNoteOption,
} from "./ServicePlanElementRow";
import ServicePlanSectionList, {
  servicePlanSectionDomId,
  type ServicePlanSelection,
} from "./ServicePlanSectionList";
import ServicePlanSetlist from "./ServicePlanSetlist";
import ServicePlanLibraryPicker from "./ServicePlanLibraryPicker";
import ViewSongSectionsDrawer from "../../components/SongSections/ViewSongSectionsDrawer";
import ViewPlainLyricsDrawer from "../../components/SongSections/ViewPlainLyricsDrawer";
import {
  applyPlanAnchorStartTime,
  type ServicePlanTimingSource,
} from "./servicePlanTimingUtils";
import {
  getServicePlanLiveProgress,
  getServicePlanLiveStartedAt,
  isServicePlanLiveOverridden,
  isServicePlanManualLive,
  isServicePlanTimelineAdjusted,
} from "./servicePlanLive";
import {
  isServicePlanUpdatedEvent,
  useTeamsLiveSync,
} from "../Teams/hooks/useTeamsLiveSync";
import {
  isMatchingServicePlanWrite,
  useServicePlanAutosave,
} from "./useServicePlanAutosave";
import {
  useServicePlanDraftHistory,
  type ServicePlanDraftSnapshot,
} from "./useServicePlanDraftHistory";
import {
  readServicePublicNotesTeam,
  writeServicePublicNotesTeam,
} from "../servicePublicNotesTeam";
import {
  readServicePlanHideNotes,
  readServicePlanImportSource,
  writeServicePlanHideNotes,
  writeServicePlanImportSource,
} from "./servicePlanViewPreferences";
import type {
  TeamRosterMember,
  TeamPosition,
  TeamRecord,
  TeamScheduleOccurrence,
  TeamService,
} from "../../api/authTypes";
import type {
  ServicePlan,
  ServicePlanImportSource,
  ServicePlanPayload,
  ServicePlanSection,
  ServicePlanSongReference,
  ServicePlanSourceImport,
  ServicePlanMicrophone,
  ServicePlanMicrophoneAudience,
  ServicePlanTemplate,
} from "../../types/servicePlan";
import { getServicePlanElementAssigneeNames } from "../../types/servicePlan";
import {
  addElement,
  addSection,
  cloneSectionsFromTemplate,
  createEmptyServicePlanSections,
  replaceMatchingPendingSongReferences,
  resolveServicePlanAddTarget,
} from "./servicePlanDraftUtils";
import { resolveServicePlanSongRefs } from "./servicePlanSongResolution";
import {
  collectServicePlanRoleNoteOptions,
  collectServicePlanTeamNoteLabels,
  collectServicePlanTeamNoteOptions,
} from "./servicePlanNoteOptions";
import { roleNoteMatchesServicePlanTeam } from "./servicePlanRoleNoteTeam";

const SERVICE_PLAN_LIST_SCROLL_ID = "service-plan-list";

const ALL_TEAMS_FILTER_VALUE = "__everyone__";

const SERVICE_PLAN_IMPORT_SOURCE_OPTIONS = [
  { value: "servicePlanning", label: "Service Planning" },
  { value: "planningCenter", label: "Planning Center account" },
  { value: "planningCenterPdf", label: "Planning Center PDF" },
];

const servicePlanImportSourceLabel = (source: ServicePlanImportSource): string => {
  if (source === "planningCenterPdf") return "Planning Center PDF";
  if (source === "planningCenter") return "Planning Center";
  return "Service Planning";
};

const parseImportSourceValue = (value: string): ServicePlanImportSource => {
  if (value === "planningCenterPdf") return "planningCenterPdf";
  if (value === "planningCenter") return "planningCenter";
  return "servicePlanning";
};
/** Live-row tracking needs second resolution; nothing else here does. */
const LIVE_CLOCK_ACTIVE_MS = 1_000;
/** Enough to catch midnight rollover and the service window opening. */
const LIVE_CLOCK_IDLE_MS = 30_000;
const SERVICE_PLAN_PAUSE_ICON_COLOR = "#fbbf24";
const SERVICE_PLAN_RESUME_ICON_COLOR = "#4ade80";
const SERVICE_PLAN_SCHEDULE_ICON_COLOR = "#22d3ee";

const ServicePlanSkeleton = () => (
  <div
    className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden"
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label="Loading service plan"
  >
    {Array.from({ length: 3 }, (_, sectionIndex) => (
      <section
        key={sectionIndex}
        className="overflow-hidden rounded-lg border border-gray-700 bg-gray-900/60"
      >
        <div className="flex items-center gap-3 border-b border-gray-700 bg-gray-800/70 px-3 py-2">
          <div className="h-4 w-4 animate-pulse rounded bg-white/10" />
          <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
        </div>
        <div className="flex flex-col divide-y divide-gray-800">
          {Array.from({ length: sectionIndex === 0 ? 3 : 2 }, (_, rowIndex) => (
            <div key={rowIndex} className="flex items-center gap-3 px-3 py-3">
              <div className="h-3 w-12 animate-pulse rounded bg-white/10" />
              <div className="h-4 flex-1 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
            </div>
          ))}
        </div>
      </section>
    ))}
  </div>
);

type ServicePlanImportPreview = {
  currentSections: ServicePlanSection[];
  sections: ServicePlanSection[];
  sourceImport: ServicePlanSourceImport;
  summary: ServicePlanImportSummary;
};

type ServicePlanEditorTab = "plan" | "setlist" | "microphones" | "serving";

const formatAdjustedTimelineTime = (timeMs: number, timezone: string): string =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(timeMs));

const formatServicePlanEmailDate = (startsAt: string, timezone?: string) => {
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) return "the scheduled date";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: timezone || undefined,
    }).format(parsed);
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(parsed);
  }
};

const urlsFromPublishResult = (result: {
  publicUrl: string;
  teamPublicUrl?: string;
  generalPublicUrl?: string;
  currentTeamPublicUrl?: string;
  currentGeneralPublicUrl?: string;
}): ServicePlanPublicUrls => {
  const team = result.teamPublicUrl || result.publicUrl;
  return {
    team,
    general: result.generalPublicUrl || team,
    currentTeam: result.currentTeamPublicUrl,
    currentGeneral: result.currentGeneralPublicUrl,
  };
};

/**
 * The occurrence's wall-clock HH:mm *in the plan's own timezone*. Element start
 * times are stored as bare wall-clock strings and rendered to viewers in the
 * plan's timezone, so seeding them from the editor's browser zone would put an
 * operator working from another timezone an hour or more out.
 */
const occurrenceLocalTime = (iso: string, timeZone: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    // An unusable stored zone shouldn't block seeding a time.
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
};

type ServicePlanEditorProps = {
  /** The service this plan belongs to (already chosen by the Plans list). */
  service: TeamService;
  /** The specific dated occurrence being planned (already chosen by the
   * Plans list) — this editor no longer picks a service/date itself. */
  occurrence: TeamScheduleOccurrence;
  /** Roster, for "Assigned to" suggestions (members + free-text history —
   * not roster-linked/position-ranked; see ServicePlanElementRow). */
  members: TeamRosterMember[];
  /** Roles available for role-specific operational notes. */
  positions?: TeamPosition[];
  teams?: TeamRecord[];
  /** Scheduled team holders for church microphones on this occurrence. */
  scheduledMicrophoneHolders?: ReadonlyMap<string, string[]>;
  /** Schedule-derived rows shown under linked plan items. */
  scheduledAssignmentRows?: TeamsAssignmentSummaryRow[];
  onOpenScheduledAssignment?: (row: TeamsAssignmentSummaryRow) => void;
  /**
   * Day-level microphone allocation for this occurrence's scheduled roles.
   * When the occurrence has slots on a team that uses microphone assignments,
   * the plan gains a Microphones tab beside the order of service — allocation
   * belongs to the plan, but not in the middle of the running order.
   */
  teamMicrophones?: {
    /** Every assignment row for this occurrence; filtered here to mic teams. */
    rows: TeamsAssignmentSummaryRow[];
    /**
     * Whether `rows` is the whole picture. Schedules outside the bootstrap's
     * hydration window arrive without their cells, and "no scheduled roles"
     * would otherwise be shown for a date whose roster simply isn't loaded.
     */
    assignmentsStatus?: "ready" | "loading" | "unavailable";
    /** Slot key (`scheduleId:occurrenceId:columnKey`) currently saving. */
    savingSlot?: string | null;
    onChange: (
      row: TeamsAssignmentSummaryRow,
      microphoneIds: string[],
    ) => void;
  };
  canEdit: boolean;
  /** Current-service controller surfaces already show live status elsewhere. */
  showSummary?: boolean;
  /** When set, renders a shared editor chrome with back control + title. */
  onBack?: () => void;
  backLabel?: string;
  /**
   * Adjacent-plan navigation for the Plans list chrome. When provided, the
   * header shows previous/next controls; omit a callback to disable that side.
   */
  planNavigation?: {
    onPrevious?: () => void;
    onNext?: () => void;
  };
  /** Who's serving content shown as a fourth workspace tab below 1024px. */
  mobileServingContent?: ReactNode;
  /** Initial workspace tab, used when returning from the mobile serving roster. */
  initialTab?: ServicePlanEditorTab;
  /** Whether this entry point should open the plan in edit mode. */
  initialEditing?: boolean;
  /**
   * Lets a surface that picked the occurrence itself — the Controller
   * workspace, which has no Plans list to go back to — offer that switch from
   * the plan actions menu. Options are pre-labelled by the caller.
   */
  occurrenceSwitcher?: {
    options: { occurrenceId: string; label: string }[];
    onSelect: (occurrenceId: string) => void;
  };
  /** Sends the already-loaded/drafted timing source to an embedded surface. */
  onPlanTimingChange?: (source: ServicePlanTimingSource | null) => void;
};

type ServicePlanTimingMetadata = Pick<
  ServicePlan,
  "planKey" | "startsAt" | "timezone" | "publicLive"
>;

/**
 * Build or import a service's order-of-service plan for one dated occurrence,
 * then edit every element freely. This is a separate planning document
 * (Firestore-backed ServicePlan) from the live PouchDB outline. Edits autosave
 * here; applying items into the Controller list is a separate, opt-in step
 * for the presentation operator (see servicePlanOutlineBridge.ts).
 *
 * The occurrence itself is chosen up front by the Plans list (see
 * TeamsPlansPage.tsx) — this component is purely "the editor for this one
 * already-chosen date," not a picker.
 */
const ServicePlanEditor = ({
  service,
  occurrence,
  members,
  positions = [],
  teams = [],
  scheduledMicrophoneHolders,
  scheduledAssignmentRows,
  onOpenScheduledAssignment,
  teamMicrophones,
  canEdit,
  showSummary = true,
  onBack,
  backLabel = "Back to Plans",
  planNavigation,
  mobileServingContent,
  initialTab = "plan",
  initialEditing = false,
  occurrenceSwitcher,
  onPlanTimingChange,
}: ServicePlanEditorProps) => {
  const { churchId, access, churchBranding, churchIntegrations } =
    useContext(GlobalInfoContext) || {};
  const planningCenterConnected = Boolean(
    churchIntegrations?.planningCenter?.enabled &&
    churchIntegrations?.planningCenter?.connected,
  );
  const { db } = useContext(ControllerInfoContext) || {};
  const { showToast } = useToast();
  const dispatch = useDispatch();
  const allSongDocs = useSelector((state) => state.allDocs.allSongDocs);
  const isAllItemsInitialized = useSelector(
    (state) => state.allItems?.isInitialized ?? false,
  );
  const [assignmentHistory, setAssignmentHistory] = useState<string[]>([]);
  const [microphones, setMicrophones] = useState<ServicePlanMicrophone[]>([]);
  const [microphoneAudiences, setMicrophoneAudiences] = useState<
    ServicePlanMicrophoneAudience[] | undefined
  >();
  const [viewSongRef, setViewSongRef] = useState<ServicePlanSongReference | null>(
    null,
  );
  const [pendingSongCreateRef, setPendingSongCreateRef] = useState<
    Extract<ServicePlanSongReference, { kind: "pending" }> | null
  >(null);

  // The song library (allDocs.allSongDocs) is normally populated by the
  // Controller page's own lifecycle hook — a session that opens straight to
  // Teams and Services without ever visiting the Controller would otherwise
  // see an empty library here (no search results, no import song matches).
  useEffect(() => {
    if (!db) return;
    updateAllDocs(dispatch);
  }, [db, dispatch]);

  // Teams/Services can open without the Controller lifecycle. Initialize the
  // shared lightweight index here too so embedded song creation can safely
  // persist a complete list for older Controller clients.
  useEffect(() => {
    if (!db || isAllItemsInitialized) return;
    let cancelled = false;

    const initializeAllItems = async () => {
      try {
        const allItemsDoc = (await db.get("allItems")) as DBAllItems;
        if (cancelled) return;
        dispatch(
          initiateAllItemsList(sortNamesInList(allItemsDoc.items || [])),
        );
      } catch (error) {
        console.error("Could not initialize the song library index:", error);
      }
    };

    initializeAllItems();
    return () => {
      cancelled = true;
    };
  }, [db, dispatch, isAllItemsInitialized]);

  const planKey = getServicePlanKey(occurrence);
  const defaultPlanTemplateId = service.defaultPlanTemplateId?.trim() || "";

  const [plan, setPlan] = useState<ServicePlan | null>(null);
  const [planName, setPlanName] = useState("");
  const [sections, setSections] = useState<ServicePlanSection[] | null>(null);
  const [selectedPlanTarget, setSelectedPlanTarget] = useState<ServicePlanSelection | null>(null);
  const [sourceImport, setSourceImport] = useState<ServicePlanSourceImport | undefined>(
    undefined,
  );

  const notifyPlanTimingChange = useCallback(
    (
      nextSections: ServicePlanSection[] | null,
      sourcePlan?: ServicePlanTimingMetadata | null,
    ) => {
      if (!onPlanTimingChange) return;
      if (!nextSections) {
        onPlanTimingChange(null);
        return;
      }
      onPlanTimingChange({
        planKey: sourcePlan?.planKey || planKey,
        startsAt: sourcePlan?.startsAt || occurrence.startsAt,
        timezone:
          sourcePlan?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        sections: nextSections,
        publicLive: sourcePlan?.publicLive,
      });
    },
    [occurrence.startsAt, onPlanTimingChange, planKey],
  );
  // Do not expose the empty-plan actions until the first fetch has answered.
  // Otherwise a fast click can create a local draft that the initial response
  // immediately replaces.
  const [loading, setLoading] = useState(Boolean(churchId && planKey));
  const [planTemplates, setPlanTemplates] = useState<ServicePlanTemplate[]>([]);
  const [planTemplatesLoading, setPlanTemplatesLoading] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importSource, setImportSource] = useState<ServicePlanImportSource>(
    readServicePlanImportSource,
  );
  const [importUrl, setImportUrl] = useState("");
  const [importPcoServiceTypeId, setImportPcoServiceTypeId] = useState("");
  const [importPcoPlanId, setImportPcoPlanId] = useState("");
  const [importing, setImporting] = useState(false);
  const planningCenterPdfInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ServicePlanImportPreview | null>(null);
  const [refreshOptions, setRefreshOptions] = useState<ServicePlanningRefreshOptions>(
    DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
  );
  const [templateModal, setTemplateModal] =
    useState<ServicePlanTemplateModalMode | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [updatingPublicLive, setUpdatingPublicLive] = useState(false);
  const [publicUrls, setPublicUrls] = useState<ServicePlanPublicUrls | null>(null);
  const [nowMs, setNowMs] = useState(() => serverNow());
  const [draftChangeVersion, setDraftChangeVersion] = useState(0);
  const [conflictPlan, setConflictPlan] = useState<ServicePlan | null>(null);
  // An SSE message can arrive after our write commits but before its response.
  // Hold a truly newer remote revision until the local acknowledgement lands.
  const pendingRemotePlanRef = useRef<ServicePlan | null>(null);
  // View-only: collapses note chrome so operators can scan structure/timing.
  const [hideNotes, setHideNotes] = useState(readServicePlanHideNotes);
  // Same preference as the public team view — filter team notes by label.
  const [teamNotesFilter, setTeamNotesFilter] = useState(() =>
    readServicePublicNotesTeam(),
  );
  const [roleNotesFilter, setRoleNotesFilter] = useState("");
  // Compact read layout by default; Edit switches to stacked/editable fields.
  const [isEditing, setIsEditing] = useState(initialEditing);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  // Microphones live beside the running order rather than inside it.
  const [planTab, setPlanTab] = useState<ServicePlanEditorTab>(initialTab);
  const planTabPlanKeyRef = useRef(planKey);
  const [planActionsOpen, setPlanActionsOpen] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailModalInitialVersion, setEmailModalInitialVersion] =
    useState<ServicePlanShareVersion>("detailed");
  const [showServiceDetails, setShowServiceDetails] = useState(false);
  /** Drill-in panels replace side submenus so nested pickers stay on-screen. */
  const [planActionsView, setPlanActionsView] = useState<
    "root" | "roleNotes" | "switchService"
  >("root");

  const handlePlanActionsOpenChange = useCallback((open: boolean) => {
    setPlanActionsOpen(open);
    if (!open) setPlanActionsView("root");
  }, []);

  const markDraftChanged = useCallback(() => {
    setDraftChangeVersion((version) => version + 1);
  }, []);

  const restoreDraftSnapshot = useCallback(
    (snapshot: ServicePlanDraftSnapshot) => {
      setSections(snapshot.sections);
      setPlanName(snapshot.planName);
      setSourceImport(snapshot.sourceImport);
      notifyPlanTimingChange(snapshot.sections, plan);
      // An undone plan is still the plan of record — autosave persists it the
      // same way it persists any other edit.
      markDraftChanged();
    },
    [markDraftChanged, notifyPlanTimingChange, plan],
  );

  const {
    canUndo,
    canRedo,
    record: recordDraftHistory,
    undo: undoDraft,
    redo: redoDraft,
    reset: resetDraftHistory,
  } = useServicePlanDraftHistory({
    draft: { sections, planName, sourceImport },
    onRestore: restoreDraftSnapshot,
  });

  /**
   * The single funnel for every draft edit: it records the pre-edit snapshot
   * for undo, applies the change, and marks the draft for autosave. Grouping
   * fields into one call keeps a compound edit (an import, a template) a
   * single undo step. `coalesceKey` names the field being edited so a typing
   * burst collapses instead of costing an undo press per character.
   */
  const updateDraft = useCallback(
    (
      changes: {
        sections?: ServicePlanSection[];
        planName?: string;
        sourceImport?: ServicePlanSourceImport;
      },
      coalesceKey?: string,
    ) => {
      recordDraftHistory(coalesceKey);
      if (changes.sections) setSections(changes.sections);
      if (changes.planName !== undefined) setPlanName(changes.planName);
      if ("sourceImport" in changes) setSourceImport(changes.sourceImport);
      notifyPlanTimingChange(changes.sections ?? sections, plan);
      markDraftChanged();
    },
    [markDraftChanged, notifyPlanTimingChange, plan, recordDraftHistory, sections],
  );

  const updateDraftSections = useCallback(
    (next: ServicePlanSection[], coalesceKey?: string) => {
      updateDraft({ sections: next }, coalesceKey);
    },
    [updateDraft],
  );

  const updateDraftName = useCallback((next: string) => {
    updateDraft({ planName: next }, "planName");
  }, [updateDraft]);

  // The live clock is started further down, once the plan's live state is
  // known — it only needs to run at second resolution when the timeline is
  // actually moving. See LIVE_CLOCK_* below.

  useEffect(() => {
    if (!churchId || !canEdit) {
      setPlanTemplates([]);
      setPlanTemplatesLoading(false);
      return undefined;
    }

    let cancelled = false;
    setPlanTemplatesLoading(true);
    listServicePlanTemplates(churchId)
      .then((response) => {
        if (!cancelled) setPlanTemplates(response.templates);
      })
      .catch((error) => {
        if (cancelled) return;
        setPlanTemplates([]);
        showApiErrorToast(
          showToast,
          error,
          "Could not load plan templates. Try again.",
        );
      })
      .finally(() => {
        if (!cancelled) setPlanTemplatesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canEdit, churchId, showToast]);

  useEffect(() => {
    onPlanTimingChange?.(null);
    setPlan(null);
    setSections(null);
    setPlanName("");
    setSourceImport(undefined);
    setTemplateModal(null);
    setPendingSongCreateRef(null);
    setShowImport(false);
    setImportUrl("");
    setRefreshOptions(DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    setImportPreview(null);
    setPublicUrls(null);
    setEmailModalOpen(false);
    setConflictPlan(null);
    pendingRemotePlanRef.current = null;
    setDraftChangeVersion(0);
    setIsEditing(initialEditing);
    setShowServiceDetails(false);
    // A different date is a different running order — open on it, not on
    // whichever side tab the previous plan was left on. On first mount, keep
    // the caller's requested tab (used when returning to the mobile roster).
    if (planTabPlanKeyRef.current !== planKey) {
      planTabPlanKeyRef.current = planKey;
      setPlanTab("plan");
    }
    resetDraftHistory();
    if (!planKey || !churchId) return;
    let cancelled = false;
    setLoading(true);
    getServicePlan(churchId, planKey)
      .then((res) => {
        if (cancelled) return;
        setPlan(res.servicePlan);
        setSections(res.servicePlan?.sections ?? null);
        notifyPlanTimingChange(
          res.servicePlan?.sections ?? null,
          res.servicePlan,
        );
        setPlanName(res.servicePlan?.name || occurrence.name || "");
        setSourceImport(res.servicePlan?.sourceImport);
        setDraftChangeVersion(0);
        // Restores the share links for an already-published plan, so they
        // survive a reload instead of only existing in the publish response.
        setPublicUrls(res.publicUrls ?? null);
      })
      .catch((error) => {
        if (!cancelled) {
          showApiErrorToast(showToast, error, "Could not load this service plan.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [churchId, notifyPlanTimingChange, occurrence.startsAt, planKey]);

  // Assignment suggestions are church-wide, not per-occurrence, so this loads
  // once per church rather than resetting on every occurrence switch.
  useEffect(() => {
    if (!churchId) return;
    let cancelled = false;
    getServicePlanAssignmentHistory(churchId)
      .then((res) => {
        if (!cancelled) setAssignmentHistory(res.values);
      })
      .catch(() => {
        // Suggestions are a nice-to-have — the field still works without them.
      });
    return () => {
      cancelled = true;
    };
  }, [churchId]);

  useEffect(() => {
    if (!churchId) return;
    let cancelled = false;
    getServicePlanMicrophones(churchId)
      .then((res) => {
        if (!cancelled) {
          setMicrophones(res.microphones);
          setMicrophoneAudiences(res.audiences);
        }
      })
      .catch(() => {
        // Microphones are optional operational metadata. The plan remains usable.
      });
    return () => {
      cancelled = true;
    };
  }, [churchId]);

  const assignedToSuggestions = useMemo(
    () => Array.from(new Set([...members.map((member) => memberName(member)), ...assignmentHistory])),
    [members, assignmentHistory],
  );

  const removeAssignmentHistoryValue = useCallback((value: string) => {
    const normalized = value.trim().toLowerCase();
    const next = assignmentHistory.filter(
      (entry) => entry.trim().toLowerCase() !== normalized,
    );
    if (next.length === assignmentHistory.length || !churchId) return;
    setAssignmentHistory(next);
    saveServicePlanAssignmentHistory(churchId, next).catch(() => {
      // Best-effort — the current plan remains usable if history saving fails.
    });
  }, [assignmentHistory, churchId]);

  const isAssignmentHistoryValueRemovable = useCallback(
    (value: string) => assignmentHistory.some(
      (entry) => entry.trim().toLowerCase() === value.trim().toLowerCase(),
    ),
    [assignmentHistory],
  );

  // The published timeline renders in this timezone, so it must stay whatever
  // it was first saved as. Re-stamping the current browser's zone on every
  // save would let an editor working from another timezone silently shift the
  // wall-clock times public viewers see.
  const planTimezone =
    plan?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  /** Best-effort: remembers any newly-typed "Assigned to" names for future
   * suggestions. Never blocks or fails the plan save itself. */
  const rememberAssignmentHistory = (savedSections: ServicePlanSection[]) => {
    if (!churchId) return;
    const usedNames = savedSections.flatMap((section) =>
      section.elements.flatMap(getServicePlanElementAssigneeNames),
    );
    const merged = Array.from(new Set([...assignmentHistory, ...usedNames]));
    if (merged.length === assignmentHistory.length) return;
    setAssignmentHistory(merged);
    saveServicePlanAssignmentHistory(churchId, merged).catch(() => {
      // Best-effort — suggestions just won't include these names yet.
    });
  };

  const buildAutosavePayload = useCallback(() => {
    if (!sections) return null;
    return {
      serviceId: occurrence.serviceId,
      serviceIds: occurrence.serviceIds || [occurrence.serviceId],
      groupId: occurrence.groupId,
      date: occurrence.startsAt.slice(0, 10),
      name: planName || occurrence.name,
      startsAt: occurrence.startsAt,
      timezone: planTimezone,
      sections,
      ...(sourceImport ? { sourceImport } : {}),
    };
  }, [occurrence, planName, planTimezone, sections, sourceImport]);

  const saveAutosavePayload = useCallback(
    (payload: ServicePlanPayload, baseRevision: number) => {
      if (!churchId) return Promise.reject(new Error("A church is required."));
      // Autosave consumes the saved plan itself, not the response envelope —
      // handing back the wrapper would leave `sections`/`revision` undefined.
      return saveServicePlan(churchId, planKey, { ...payload, baseRevision })
        .then((res) => res.servicePlan);
    },
    [churchId, planKey],
  );

  const getConflictPlan = useCallback((error: unknown) => {
    if (!(error instanceof AuthApiError) || error.status !== 409) return null;
    const details = error.details;
    if (!details || typeof details !== "object" || !("servicePlan" in details)) {
      return null;
    }
    const latestPlan = details.servicePlan;
    return latestPlan && typeof latestPlan === "object"
      ? latestPlan as ServicePlan
      : null;
  }, []);

  const loadLatestPlan = useCallback(async () => {
    if (!churchId) return null;
    const response = await getServicePlan(churchId, planKey);
    return response.servicePlan;
  }, [churchId, planKey]);

  const autosave = useServicePlanAutosave({
    enabled: Boolean(canEdit && churchId && sections),
    resetKey: planKey,
    changeVersion: draftChangeVersion,
    // The previous occurrence's plan stays in state until its fetch effect
    // clears it. Feeding that revision in as the new plan's base is what
    // made prev/next look like a conflict.
    baseRevision: plan?.planKey === planKey ? plan.revision || 0 : 0,
    buildPayload: buildAutosavePayload,
    save: saveAutosavePayload,
    getConflictPlan,
    isOwnWrite: isMatchingServicePlanWrite,
    loadLatest: loadLatestPlan,
    onSaved: (savedPlan) => {
      // Defence in depth alongside the hook's generation guard: this editor
      // stays mounted across prev/next, so a late response could otherwise
      // describe a plan the operator has already navigated away from.
      if (savedPlan.planKey && savedPlan.planKey !== planKey) return;
      setPlan(savedPlan);
      notifyPlanTimingChange(savedPlan.sections, savedPlan);
      rememberAssignmentHistory(savedPlan.sections);
    },
    onConflict: (latestPlan) => {
      if (latestPlan.planKey && latestPlan.planKey !== planKey) return;
      pendingRemotePlanRef.current = null;
      setConflictPlan(latestPlan);
    },
  });

  // The hook returns a fresh object every render, so an effect depending on
  // `autosave` runs after every render — once a second, thanks to the live
  // clock. These three members are what the deferred-conflict effect actually
  // watches, and the two callbacks are stable.
  const {
    state: autosaveState,
    getRevision: getAutosaveRevision,
    markConflict: markAutosaveConflict,
  } = autosave;

  const planRef = useRef<ServicePlan | null>(plan);
  planRef.current = plan;
  const churchIdRef = useRef(churchId);
  churchIdRef.current = churchId;
  const planKeyRef = useRef(planKey);
  planKeyRef.current = planKey;
  const autosaveRef = useRef(autosave);
  autosaveRef.current = autosave;
  const isMountedRef = useRef(true);
  const resumeReconciliationInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const applyRemoteServicePlan = useCallback(
    (servicePlan: ServicePlan) => {
      if (servicePlan.planKey !== planKeyRef.current) return;
      const currentAutosave = autosaveRef.current;
      const incomingRevision = servicePlan.revision ?? 0;
      const knownRevision = currentAutosave.getRevision();
      if (incomingRevision <= knownRevision) {
        // Publishing and live-progress changes share the document but do not
        // alter editable plan content. Keep those controls current without
        // turning a local text edit into a content conflict.
        if (incomingRevision === knownRevision) {
          setPlan((current) => current ? {
            ...current,
            published: servicePlan.published,
            publicLive: servicePlan.publicLive,
            updatedAt: servicePlan.updatedAt,
          } : current);
          notifyPlanTimingChange(servicePlan.sections, servicePlan);
        }
        return;
      }
      const expectedInFlightRevision =
        currentAutosave.getInFlightExpectedRevision();
      if (incomingRevision === expectedInFlightRevision) {
        // This is the broadcast echo of our in-flight save. Its HTTP response
        // carries the same plan and will update the local revision moments later.
        return;
      }
      if (expectedInFlightRevision !== null) {
        // A revision beyond the expected acknowledgement is a real concurrent
        // edit. Defer the conflict until our save response advances its revision.
        pendingRemotePlanRef.current = servicePlan;
        return;
      }
      if (currentAutosave.state !== "saved") {
        // Never replace unsaved operator work with a resume snapshot. The
        // existing revision/conflict UI remains the recovery boundary.
        setConflictPlan(servicePlan);
        currentAutosave.markConflict();
        return;
      }
      setPlan(servicePlan);
      setSections(servicePlan.sections);
      setPlanName(servicePlan.name || occurrence.name || "");
      setSourceImport(servicePlan.sourceImport);
      notifyPlanTimingChange(servicePlan.sections, servicePlan);
      resetDraftHistory();
      currentAutosave.acceptRemoteRevision(servicePlan);
    },
    [notifyPlanTimingChange, occurrence.name, resetDraftHistory],
  );

  const reconcilePlanOnResume = useCallback(async () => {
    if (!isMountedRef.current) return;
    setNowMs(serverNow());
    if (!churchId || !planKey || !planRef.current) {
      return;
    }
    const existing = resumeReconciliationInFlightRef.current;
    if (existing) return existing;

    const churchIdAtStart = churchId;
    const planKeyAtStart = planKey;
    let request!: Promise<void>;
    request = getServicePlan(churchIdAtStart, planKeyAtStart)
      .then((response) => {
        if (
          !isMountedRef.current ||
          churchIdRef.current !== churchIdAtStart ||
          planKeyRef.current !== planKeyAtStart ||
          !planRef.current ||
          response.servicePlan?.planKey !== planKeyAtStart
        ) {
          return;
        }
        if (response.servicePlan) applyRemoteServicePlan(response.servicePlan);
      })
      .catch((error) => {
        // Resume recovery is best-effort; retain the usable local plan and let
        // the next reconnect or page visit retry it.
        console.error("Could not reconcile the service plan after resume:", error);
      })
      .finally(() => {
        if (resumeReconciliationInFlightRef.current === request) {
          resumeReconciliationInFlightRef.current = null;
        }
      });
    resumeReconciliationInFlightRef.current = request;
    return request;
  }, [applyRemoteServicePlan, churchId, planKey]);

  useSyncOnReconnect(reconcilePlanOnResume);

  // Clean editors follow remote plan changes. Local edits are never silently
  // replaced; the server's revision check turns that situation into a conflict.
  useTeamsLiveSync(churchId, (event) => {
    if (!isServicePlanUpdatedEvent(event)) return;
    applyRemoteServicePlan(event.servicePlan);
  });

  useEffect(() => {
    const pendingRemotePlan = pendingRemotePlanRef.current;
    if (!pendingRemotePlan || autosaveState !== "saved") return;
    if ((pendingRemotePlan.revision ?? 0) <= getAutosaveRevision()) {
      pendingRemotePlanRef.current = null;
      return;
    }
    pendingRemotePlanRef.current = null;
    setConflictPlan(pendingRemotePlan);
    markAutosaveConflict();
  }, [autosaveState, getAutosaveRevision, markAutosaveConflict]);

  // Undo/redo shortcuts, edit mode only. Fields that own their own undo keep
  // it: TipTap handles the keystroke inside a rich-text field (and marks it
  // handled), and plain inputs carry `data-ignore-undo` so the browser's
  // character-level undo still applies — the same contract the Controller
  // toolbar's undo uses.
  useEffect(() => {
    if (!canEdit || !isEditing) return;
    const handleUndoRedoKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.getAttribute?.("data-ignore-undo") === "true") return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) {
        redoDraft();
        return;
      }
      undoDraft();
    };
    document.addEventListener("keydown", handleUndoRedoKey);
    return () => document.removeEventListener("keydown", handleUndoRedoKey);
  }, [canEdit, isEditing, redoDraft, undoDraft]);

  useEffect(() => {
    if (autosave.state === "saved") return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [autosave.state]);

  const reloadConflictPlan = () => {
    if (!conflictPlan) return;
    setPlan(conflictPlan);
    setSections(conflictPlan.sections);
    notifyPlanTimingChange(conflictPlan.sections, conflictPlan);
    setPlanName(conflictPlan.name || occurrence.name || "");
    setSourceImport(conflictPlan.sourceImport);
    setConflictPlan(null);
    pendingRemotePlanRef.current = null;
    resetDraftHistory();
    autosave.acceptRemoteRevision(conflictPlan);
  };

  /** Undo history is scoped to a single editing session: Done commits the
   * plan, so there is nothing left to step back through. */
  const toggleEditing = () => {
    if (isEditing) {
      // Selection is an editing affordance; do not leave a section or item
      // highlighted after returning to the read-only plan view.
      setSelectedPlanTarget(null);
    }
    resetDraftHistory();
    setIsEditing((editing) => !editing);
  };

  const startFromScratch = () => {
    const nextSections = createEmptyServicePlanSections();
    updateDraft({
      sections: nextSections,
      planName: occurrence.name || service.name || "",
    });
    // Sole starter section is the only place items can go — select it so the
    // footer Add item control is immediately usable without an extra click.
    setSelectedPlanTarget({ sectionId: nextSections[0].id });
    setIsEditing(true);
  };

  const applySavedTemplate = (template: ServicePlanTemplate) => {
    updateDraft({
      sections: cloneSectionsFromTemplate(template.sections),
      ...(planName
        ? {}
        : { planName: occurrence.name || service.name || "" }),
    });
    setIsEditing(true);
    showToast(`Applied "${template.name}".`, "success");
  };

  /**
   * An import is meant to be reviewed in full, so it always lands on "All
   * teams" with notes shown. The team filter is shared with the public plan
   * view and persists across sessions, so an operator who once focused a
   * single team there would otherwise open a freshly imported plan and see
   * only that team's notes — looking exactly like every other team's notes
   * failed to import. The stored value has to be cleared too, or the effect
   * that restores the saved preference re-applies it immediately.
   */
  const showAllTeamNotesForReview = () => {
    setTeamNotesFilter("");
    writeServicePublicNotesTeam("");
    setHideNotes(false);
    writeServicePlanHideNotes(false);
  };

  const handleHideNotesChange = (checked: boolean) => {
    setHideNotes(checked);
    writeServicePlanHideNotes(checked);
  };

  const handleImportSourceChange = (value: string) => {
    const next = parseImportSourceValue(value);
    setImportSource(next);
    writeServicePlanImportSource(next);
  };

  const openPlanningCenterPdfPicker = () => {
    handleImportSourceChange("planningCenterPdf");
    // Keep this in the same user-gesture turn as the menu click so the OS
    // file dialog is allowed to open.
    planningCenterPdfInputRef.current?.click();
  };

  const openImportSourceForm = (source: ServicePlanImportSource) => {
    handleImportSourceChange(source);
    if (source === "planningCenterPdf") {
      openPlanningCenterPdfPicker();
      return;
    }
    setShowImport(true);
  };

  const openImportUpdates = () => {
    const preferredSource =
      sourceImport?.source === "planningCenterPdf" ||
        sourceImport?.source === "planningCenter" ||
        sourceImport?.source === "servicePlanning"
        ? sourceImport.source
        : readServicePlanImportSource();
    if (preferredSource === "planningCenterPdf") {
      openPlanningCenterPdfPicker();
      return;
    }
    setImportSource(preferredSource);
    writeServicePlanImportSource(preferredSource);
    setImportUrl(
      preferredSource === "servicePlanning" &&
        sourceImport?.source === "servicePlanning"
        ? sourceImport.sourceUrl
        : preferredSource === "servicePlanning"
          ? importUrl
          : "",
    );
    if (sourceImport?.source === "planningCenter") {
      setImportPcoServiceTypeId(sourceImport.planningCenterServiceTypeId || "");
      setImportPcoPlanId(sourceImport.planningCenterPlanId || "");
    }
    setShowImport(true);
  };

  const applyImportedPlanData = (
    data: ServicePlanningImportData,
    source: ServicePlanImportSource,
    nextSourceUrl: string,
    sourceExtras: {
      planningCenterServiceTypeId?: string;
      planningCenterPlanId?: string;
    } = {},
  ) => {
    const importedSections = buildServicePlanSectionsFromImport(data, allSongDocs);
    const hasElements = importedSections.some((section) => section.elements.length > 0);
    const hasSourceTiming = importedSections.some((section) =>
      section.elements.some((element) => Boolean(element.startTime)),
    );
    // Preserve the source's actual schedule when the printout provides it.
    // Older printouts without time columns still receive our normal
    // occurrence-time anchor as a useful starting point.
    const freshImportSections =
      hasElements && !hasSourceTiming
        ? applyPlanAnchorStartTime(
          importedSections,
          occurrenceLocalTime(occurrence.startsAt, planTimezone),
        )
        : importedSections;
    // A plan with no items yet has nothing to reconcile — a draft started
    // from scratch carries one empty section, which would otherwise survive
    // the refresh and leave a stray blank section above the imported ones.
    const nextSections =
      hasPlanContent && sections
        ? refreshServicePlanFromImport(sections, importedSections, {
          ...refreshOptions,
          // Only plans imported before item-level provenance existed can have
          // their unmarked items regarded as source-owned, and then only when
          // removal was chosen. On a tracked plan those are operator items.
          treatUnmarkedItemsAsSource:
            refreshOptions.removeMissing && isLegacyUntrackedImport,
        })
        : freshImportSections;
    // One draft update, so undo reverts the whole import rather than peeling
    // it back a field at a time. The occurrence being planned names the plan
    // — the imported source's own plan label (its own date/service, not
    // necessarily this one) is provenance info only, kept on
    // sourceImport.planLabel, never the name.
    const nextSourceImport = buildServicePlanSourceImport(
      data,
      nextSourceUrl,
      source,
      sourceExtras,
    );
    if (hasPlanContent && sections) {
      setImportPreview({
        currentSections: sections,
        sections: nextSections,
        sourceImport: nextSourceImport,
        summary: summarizeServicePlanImport(sections, nextSections),
      });
      setShowImport(false);
      return;
    }
    applyImportedDraft({
      sections: nextSections,
      planName: occurrence.name || service.name || "",
      sourceImport: nextSourceImport,
    });
    setShowImport(false);
    setImportUrl("");
    setIsEditing(true);
    showAllTeamNotesForReview();
    showToast(
      `Imported from ${servicePlanImportSourceLabel(source)}. Review the plan.`,
      "success",
    );
  };

  const handlePlanningCenterPdfSelected = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const text = await extractTextFromPdfFile(file);
      const data = parsePlanningCenterPdfText(text);
      applyImportedPlanData(data, "planningCenterPdf", "");
    } catch (error) {
      showApiErrorToast(
        showToast,
        error,
        "Could not import from Planning Center PDF.",
      );
    } finally {
      setImporting(false);
    }
  };

  const handleImportPlan = async () => {
    const usingPcoAccount = importSource === "planningCenter";
    const trimmedUrl = importUrl.trim();
    if (importSource === "planningCenterPdf") {
      openPlanningCenterPdfPicker();
      return;
    }
    if (usingPcoAccount && (!churchId || !importPcoServiceTypeId || !importPcoPlanId))
      return;
    if (!usingPcoAccount && !trimmedUrl) return;
    setImporting(true);
    const sourceLabel = servicePlanImportSourceLabel(importSource);
    try {
      let data: ServicePlanningImportData;
      let nextSourceUrl = "";
      let sourceExtras: {
        planningCenterServiceTypeId?: string;
        planningCenterPlanId?: string;
      } = {};

      if (usingPcoAccount && churchId) {
        const imported = await getPlanningCenterPlanImport(
          churchId,
          importPcoServiceTypeId,
          importPcoPlanId,
        );
        data = {
          planLabel: imported.planLabel,
          sections: imported.sections,
          teamAssignments: imported.teamAssignments,
        };
        nextSourceUrl = imported.sourceUrl;
        sourceExtras = {
          planningCenterServiceTypeId: imported.serviceTypeId,
          planningCenterPlanId: imported.planId,
        };
      } else {
        data = await getServicePlanningImportDataFromUrl(trimmedUrl);
        nextSourceUrl = trimmedUrl;
      }

      applyImportedPlanData(data, importSource, nextSourceUrl, sourceExtras);
    } catch (error) {
      showApiErrorToast(showToast, error, `Could not import from ${sourceLabel}.`);
    } finally {
      setImporting(false);
    }
  };

  const applyImportedDraft = (draft: {
    sections: ServicePlanSection[];
    planName: string;
    sourceImport: ServicePlanSourceImport;
  }) => {
    updateDraft(draft);
  };

  const applyImportPreview = (selectedChangeKeys: string[]) => {
    if (!importPreview) return;
    applyImportedDraft({
      sections: applySelectedServicePlanImportChanges(
        importPreview.currentSections,
        importPreview.sections,
        importPreview.summary,
        new Set(selectedChangeKeys),
      ),
      planName: occurrence.name || service.name || "",
      sourceImport: importPreview.sourceImport,
    });
    setImportPreview(null);
    setImportUrl("");
    setIsEditing(true);
    showAllTeamNotesForReview();
    showToast(
      `Imported from ${servicePlanImportSourceLabel(importPreview.sourceImport.source)}. Review the plan.`,
      "success",
    );
  };

  const updateRefreshOption = (
    key: keyof Omit<ServicePlanningRefreshOptions, "treatUnmarkedItemsAsSource">,
    checked: boolean,
  ) => {
    setRefreshOptions((current) => ({ ...current, [key]: checked }));
  };

  const handleAddElement = (sectionId: string, insertAfterElementId?: string): string | null => {
    if (!sections) return null;
    const existingElementIds = new Set(
      sections.flatMap((section) => section.elements.map((element) => element.id)),
    );
    let next = addElement(sections, sectionId, "free", insertAfterElementId);
    const newElement = next
      .find((section) => section.id === sectionId)
      ?.elements.find((element) => !existingElementIds.has(element.id));
    if (!newElement) return null;
    const anchor = next
      .flatMap((section) => section.elements)
      .find((element) => element.startTime)?.startTime
      || occurrenceLocalTime(occurrence.startsAt, planTimezone);
    next = applyPlanAnchorStartTime(next, anchor);
    updateDraftSections(next);
    setSelectedPlanTarget({ sectionId, elementId: newElement.id });
    window.requestAnimationFrame(() => {
      const row = document.getElementById(servicePlanElementDomId(newElement.id));
      row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      row?.querySelector<HTMLInputElement>('input[placeholder="Item name"]')?.focus({ preventScroll: true });
    });
    return newElement.id;
  };

  const handleAddSection = () => {
    if (!sections) return;
    const selectedSectionId = selectedPlanTarget?.sectionId;
    const next = addSection(sections, "New section", selectedSectionId);
    const newSection = next.find(
      (section) => !sections.some((existing) => existing.id === section.id),
    );
    updateDraftSections(next);
    if (!newSection) return;
    setSelectedPlanTarget({ sectionId: newSection.id });
    window.requestAnimationFrame(() => {
      const section = document.getElementById(servicePlanSectionDomId(newSection.id));
      section?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      section?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    });
  };

  const ensurePublishedUrls = async ({
    flushBeforeReuse = false,
  }: { flushBeforeReuse?: boolean } = {}): Promise<ServicePlanPublicUrls | null> => {
    if (!churchId || !planKey || !plan) return null;
    if (!flushBeforeReuse && plan.published && publicUrls?.team) return publicUrls;
    if (!(await autosave.flush())) return null;
    if (plan.published && publicUrls?.team) return publicUrls;
    const result = await publishServicePlan(churchId, planKey);
    setPlan(result.servicePlan);
    const urls = urlsFromPublishResult(result);
    setPublicUrls(urls);
    return urls;
  };

  const sharePlanLink = async (
    kind: "detailed" | "simple",
    action: "copy" | "view",
  ) => {
    if (!churchId || !planKey || !plan) return;
    setPublishing(true);
    try {
      const urls = await ensurePublishedUrls();
      if (!urls?.team) {
        showToast("Could not get a share link. Try again.", "error");
        return;
      }
      const url =
        kind === "detailed" ? urls.team : urls.general || urls.team;
      const label = kind === "detailed" ? "Detailed view" : "Simple view";
      if (action === "view") {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      try {
        await navigator.clipboard?.writeText(url);
        showToast(`${label} link copied.`, "success");
      } catch {
        showToast(`${label} link is ready. Use Share to copy it again.`, "success");
      }
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not publish this service plan.");
    } finally {
      setPublishing(false);
    }
  };

  const openServicePlanEmailModal = (shareVersion: ServicePlanShareVersion) => {
    setShareMenuOpen(false);
    setPlanActionsOpen(false);
    setEmailModalInitialVersion(shareVersion);
    setEmailModalOpen(true);
  };

  const handleSendServicePlanEmail = async (draft: ServicePlanEmailDraft) => {
    if (!churchId || !planKey || !plan) {
      throw new Error("This service plan is not ready to email. Try again in a moment.");
    }
    setPublishing(true);
    try {
      const urls = await ensurePublishedUrls({ flushBeforeReuse: true });
      if (!urls?.team) {
        throw new Error("Could not get a share link. Try again in a moment.");
      }
      return await sendServicePlanShareEmail(churchId, planKey, draft);
    } finally {
      setPublishing(false);
    }
  };

  /**
   * Makes this plan reachable through the church's shared links.
   *
   * Distinct from copying a per-plan URL: the current-service link is shared
   * once and resolves to whichever published plan is running or next, so this is
   * a recurring action with no URL to copy. Publishing several plans ahead is
   * expected — eligibility is per plan, and the link picks by time.
   */
  const handlePublish = async () => {
    if (!churchId || !planKey || !plan) return;
    setPublishing(true);
    try {
      if (!(await autosave.flush())) return;
      const result = await publishServicePlan(churchId, planKey);
      setPlan(result.servicePlan);
      setPublicUrls(urlsFromPublishResult(result));
      showToast("Shared links enabled.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not publish this service plan.");
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!churchId || !planKey || !plan) return;
    setPublishing(true);
    try {
      const result = await unpublishServicePlan(churchId, planKey);
      setPlan(result.servicePlan);
      setPublicUrls(null);
      showToast("Shared links disabled.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not unpublish this service plan.");
    } finally {
      setPublishing(false);
    }
  };

  const handleMakePublicLive = async (elementId: string) => {
    if (!churchId || !planKey || !plan) return;
    setUpdatingPublicLive(true);
    try {
      const result = await updateServicePlanPublicLive(churchId, planKey, {
        mode: isManualLive ? "manual" : "anchored",
        currentElementId: elementId,
      });
      setPlan(result.servicePlan);
      notifyPlanTimingChange(result.servicePlan.sections, result.servicePlan);
      showToast(
        isManualLive
          ? "Live item updated. Automatic advance remains paused."
          : "Live timeline updated. Following items will advance automatically.",
        "success",
      );
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not update shared service progress.");
    } finally {
      setUpdatingPublicLive(false);
    }
  };

  const handlePauseAutomaticAdvance = async () => {
    if (!churchId || !planKey || !plan || !liveElementId) return;
    setUpdatingPublicLive(true);
    try {
      const result = await updateServicePlanPublicLive(churchId, planKey, {
        mode: "manual",
        currentElementId: liveElementId,
      });
      setPlan(result.servicePlan);
      notifyPlanTimingChange(result.servicePlan.sections, result.servicePlan);
      showToast("Automatic advance paused.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not pause automatic advance.");
    } finally {
      setUpdatingPublicLive(false);
    }
  };

  const handleContinueAutomaticAdvance = async () => {
    if (!churchId || !planKey || !plan || !liveElementId) return;
    setUpdatingPublicLive(true);
    try {
      const result = await updateServicePlanPublicLive(churchId, planKey, {
        mode: "anchored",
        currentElementId: liveElementId,
      });
      setPlan(result.servicePlan);
      notifyPlanTimingChange(result.servicePlan.sections, result.servicePlan);
      showToast("Automatic advance resumed.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not resume automatic advance.");
    } finally {
      setUpdatingPublicLive(false);
    }
  };

  const handleResumePublicSchedule = async () => {
    if (!churchId || !planKey || !plan) return;
    setUpdatingPublicLive(true);
    try {
      const result = await updateServicePlanPublicLive(churchId, planKey, {
        mode: "schedule",
      });
      setPlan(result.servicePlan);
      notifyPlanTimingChange(result.servicePlan.sections, result.servicePlan);
      showToast("Returned to the planned schedule.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not update shared service progress.");
    } finally {
      setUpdatingPublicLive(false);
    }
  };

  const anchorStartTime = sections?.[0]?.elements?.[0]?.startTime || "";
  const occurrenceTiming = formatOccurrenceRowLabel(
    occurrence,
    getSharedOccurrenceTiming([occurrence]),
  );
  // Starter actions stay available both before a plan exists and after every
  // section has been removed. A fresh "Start from scratch" draft still has one
  // empty section, so it does not bounce back into this empty state.
  const defaultPlanTemplate =
    planTemplates.find(
      (template) => template.templateId === defaultPlanTemplateId,
    ) || null;
  const defaultPlanTemplateMissing = Boolean(
    defaultPlanTemplateId && !planTemplatesLoading && !defaultPlanTemplate,
  );
  const loadingInitialContent = loading;
  const hasSections = Boolean(sections && sections.length > 0);
  /** Whether the draft holds anything an import would have to reconcile. */
  const hasPlanContent = Boolean(
    sections?.some((section) => section.elements.length > 0),
  );
  const teamNoteLabels = useMemo(
    () => collectServicePlanTeamNoteLabels(sections, microphoneAudiences),
    [microphoneAudiences, sections],
  );
  /** Scheduled slots on teams that use microphone assignments, if any. */
  const microphoneRows = useMemo(
    () =>
      teamMicrophones ? getTeamMicrophoneRows(teamMicrophones.rows, teams) : [],
    [teamMicrophones, teams],
  );
  // Keep the workspace stable at three desktop tabs (four on mobile). The mic
  // panel already explains an empty catalog or a service with no eligible
  // scheduled roles, which is more useful than making the tab disappear.
  const showMicrophoneTab = Boolean(teamMicrophones);
  const showServingTab = Boolean(mobileServingContent);
  const activeTab: ServicePlanEditorTab =
    (planTab === "microphones" && !showMicrophoneTab) ||
      (planTab === "serving" && !showServingTab)
      ? "plan"
      : planTab;
  const scheduledRows = useMemo(
    () => scheduledAssignmentRows || [],
    [scheduledAssignmentRows],
  );
  const filledScheduledRows = scheduledRows.filter((row) => Boolean(row.memberName));
  const micCoveredRows = scheduledRows.filter(
    (row) => Boolean(row.memberName) && row.microphoneIds.length > 0,
  );
  const respondedRows = filledScheduledRows.filter((row) => (row.response || "pending") !== "pending");
  // Empty 0/0 fill/response/mic counts are noise — only surface the summary when
  // there is at least one scheduled slot (or mic coverage) worth scanning.
  const hasFillStats = scheduledRows.length > 0;
  const hasResponseStats = filledScheduledRows.length > 0;
  const hasMicStats = Boolean(teamMicrophones) && filledScheduledRows.length > 0;
  const hasUsefulSummary = hasFillStats || hasMicStats;
  const hasSummaryDetails = hasMicStats;
  const workspaceSummary = hasUsefulSummary ? (
    <div className="shrink-0 rounded-lg border border-gray-700/80 bg-gray-900/70 px-2.5 py-1.5 text-xs" aria-label="Service summary">
      <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-gray-100">{plan || hasSections ? "Plan ready" : "Plan needs work"}</span>
        {hasFillStats ? (
          <span className="text-gray-300">{filledScheduledRows.length}/{scheduledRows.length} filled</span>
        ) : null}
        {hasResponseStats ? (
          <span className="text-gray-300">{respondedRows.length}/{filledScheduledRows.length} responses</span>
        ) : null}
        {hasSummaryDetails ? (
          <button
            type="button"
            className="ml-auto cursor-pointer rounded px-1.5 py-0.5 text-cyan-300 hover:bg-gray-800 hover:text-cyan-100"
            aria-expanded={summaryExpanded}
            onClick={() => setSummaryExpanded((expanded) => !expanded)}
          >
            {summaryExpanded ? "Hide details" : "Details"}
          </button>
        ) : null}
      </div>
      {summaryExpanded && hasSummaryDetails ? (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 border-t border-gray-700/70 pt-1 text-gray-400">
          {hasMicStats ? (
            <span>Mics: {micCoveredRows.length}/{filledScheduledRows.length} covered</span>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;
  const roleNoteOptions = useMemo(
    () => collectServicePlanRoleNoteOptions(sections, positions, teams, microphoneAudiences),
    [microphoneAudiences, positions, sections, teams],
  );
  const scheduledPositionOptions = useMemo(
    () => {
      const options = new Map<string, ServicePlanRoleNoteOption>();
      positions
        .filter((position) => !position.archivedAt)
        .forEach((position) => options.set(position.positionId, {
          positionId: position.positionId,
          roleName: position.name,
          label: position.name,
          teamId: position.teamId,
          teamName: teams.find((team) => team.teamId === position.teamId)?.name,
          ...(position.icon ? { icon: position.icon } : {}),
        }));
      // Keep the picker useful while a lean/stale bootstrap is being hydrated:
      // schedule rows are authoritative for positions already visible on this
      // date and carry the same stable position IDs.
      scheduledRows.forEach((row) => {
        if (options.has(row.positionId)) return;
        options.set(row.positionId, {
          positionId: row.positionId,
          roleName: row.positionName,
          label: row.positionName,
          teamName: row.teamName,
        });
      });
      return Array.from(options.values());
    },
    [positions, scheduledRows, teams],
  );
  const teamNoteOptions = useMemo<ServicePlanTeamNoteOption[]>(
    () => collectServicePlanTeamNoteOptions(teams),
    [teams],
  );
  const roleNoteFilterOptions = useMemo(
    () => roleNoteOptions.filter((role) =>
      roleNoteMatchesServicePlanTeam(role, teamNotesFilter),
    ),
    [roleNoteOptions, teamNotesFilter],
  );
  /**
   * Songs an import couldn't find that the library has since gained. Resolved
   * once for the whole plan rather than per row, since matching runs over the
   * whole library.
   */
  const resolvedSongRefs = useMemo(
    () => resolveServicePlanSongRefs(sections, allSongDocs),
    [sections, allSongDocs],
  );
  const linkYouTubeVideoToSong = useCallback(
    async (song: DBItem, result: YouTubeSearchResult) => {
      if (!db) throw new Error("The song library is not available. Try again.");
      const existing = (await db.get(song._id)) as DBItem;
      const currentLinks = existing.songLinks ?? [];
      const existingYouTubeIndex = currentLinks.findIndex(
        (link) => getYouTubeVideoReference(link.url)?.videoId === result.videoId,
      );
      if (existingYouTubeIndex >= 0) return;

      const replacementIndex = currentLinks.findIndex((link) =>
        getYouTubeVideoReference(link.url),
      );
      const nextLink = {
        id:
          replacementIndex >= 0
            ? currentLinks[replacementIndex].id
            : `youtube-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        label: "YouTube",
        url: result.watchUrl,
        ...(result.durationSeconds === undefined
          ? {}
          : { durationSeconds: result.durationSeconds }),
      };
      const nextLinks = [...currentLinks];
      if (replacementIndex >= 0) nextLinks[replacementIndex] = nextLink;
      else nextLinks.push(nextLink);

      const audited = applyPouchAudit(
        existing,
        { ...existing, songLinks: nextLinks },
        { isNew: false },
      );
      const savedResult = await db.put(audited);
      const saved = { ...audited, _rev: savedResult.rev };
      dispatch(upsertItemInAllDocs(saved));
      dispatch(
        upsertItemInAllItemsList({
          _id: saved._id,
          name: saved.name,
          type: saved.type,
          listId: saved._id,
          background: typeof saved.background === "string" ? saved.background : "",
        }),
      );
      broadcastItemUpdate(saved);
    },
    [db, dispatch],
  );
  const viewLibrarySong = useMemo(() => {
    if (!viewSongRef || viewSongRef.kind !== "library") return null;
    return (
      allSongDocs.find(
        (doc) => doc._id === viewSongRef.songId && doc.type === "song",
      ) ?? null
    );
  }, [viewSongRef, allSongDocs]);
  // Pending ("Not in library") songs open Create song for operators who can
  // create library songs (full or music access) instead of a lyrics viewer.
  const viewPlainLyrics = useMemo(() => {
    if (!viewSongRef) return null;
    if (viewSongRef.kind === "pending") {
      return {
        title: viewSongRef.title,
        lyricsText: viewSongRef.lyricsText,
        emptyMessage:
          "This song is not in the library yet. Add it from Songs, then link it to this service.",
      };
    }
    if (viewLibrarySong) return null;
    return {
      title: viewSongRef.songName,
      lyricsText: "",
      emptyMessage:
        "This song is not in the library right now. Open Songs to restore it, then try again.",
    };
  }, [viewSongRef, viewLibrarySong]);

  const canCreateLibrarySong = Boolean(
    canEdit && (access === "full" || access === "music"),
  );

  const openPendingSongCreator = useCallback(
    (songRef: Extract<ServicePlanSongReference, { kind: "pending" }>) => {
      if (!canCreateLibrarySong) {
        setViewSongRef(songRef);
        return;
      }
      setPendingSongCreateRef(songRef);
    },
    [canCreateLibrarySong],
  );

  const handlePendingSongCreated = useCallback(
    (songRef: ServicePlanSongReference) => {
      if (!pendingSongCreateRef || songRef.kind !== "library" || !sections) {
        return;
      }
      updateDraftSections(
        replaceMatchingPendingSongReferences(
          sections,
          pendingSongCreateRef,
          songRef,
        ),
      );
      setPendingSongCreateRef(null);
    },
    [pendingSongCreateRef, sections, updateDraftSections],
  );

  useEffect(() => {
    if (!teamNoteLabels.length) {
      if (teamNotesFilter) setTeamNotesFilter("");
      return;
    }
    if (teamNotesFilter && teamNoteLabels.includes(teamNotesFilter)) return;
    const stored = readServicePublicNotesTeam();
    if (stored && teamNoteLabels.includes(stored)) {
      setTeamNotesFilter(stored);
      return;
    }
    if (teamNotesFilter) setTeamNotesFilter("");
  }, [teamNoteLabels, teamNotesFilter]);

  const handleTeamNotesFilterChange = (value: string) => {
    const next = value === ALL_TEAMS_FILTER_VALUE ? "" : value;
    setTeamNotesFilter(next);
    writeServicePublicNotesTeam(next);
  };

  useEffect(() => {
    if (!roleNotesFilter) return;
    if (roleNoteFilterOptions.some((option) => option.positionId === roleNotesFilter)) return;
    setRoleNotesFilter("");
  }, [roleNoteFilterOptions, roleNotesFilter]);

  /**
   * True only for plans imported before item-level provenance existed — every
   * item unmarked, so a refresh has nothing but titles to go on. A plan with
   * any marked item is tracked, and its unmarked items are the operator's own
   * additions rather than untracked source items.
   */
  const isLegacyUntrackedImport = Boolean(
    (sourceImport?.source === "servicePlanning" ||
      sourceImport?.source === "planningCenterPdf" ||
      sourceImport?.source === "planningCenter") &&
    sections?.length &&
    !sections.some(
      (section) =>
        section.sourcePlanningManaged ||
        section.elements.some((element) => element.sourcePlanningManaged),
    ),
  );
  const isEmpty = !loadingInitialContent && !hasSections;
  const showChrome = Boolean(onBack);
  const publicSharingEnabled = Boolean(plan?.published);
  const isServiceDay = isOccurrenceOnCalendarDay(occurrence, planTimezone);
  const isManualLive = isServicePlanManualLive(plan);
  const isTimelineAdjusted = isServicePlanTimelineAdjusted(plan);
  const isLiveOverridden = isServicePlanLiveOverridden(plan);

  /**
   * The live clock re-renders the whole plan, so it runs at second resolution
   * only while the timeline is genuinely moving: the service day, or an
   * anchored override counting up from its own start. Every other session —
   * planning next Sunday, which is most of them — still ticks, just slowly,
   * so midnight rollover and the arrival of the service window are picked up
   * and promote the clock to full rate on their own.
   */
  const liveClockIntervalMs =
    isServiceDay || isTimelineAdjusted
      ? LIVE_CLOCK_ACTIVE_MS
      : LIVE_CLOCK_IDLE_MS;

  useEffect(() => {
    const interval = window.setInterval(
      () => setNowMs(serverNow()),
      liveClockIntervalMs,
    );
    return () => window.clearInterval(interval);
  }, [liveClockIntervalMs]);

  const liveProgress =
    plan && sections
      ? getServicePlanLiveProgress({ ...plan, sections }, nowMs)
      : null;
  const liveElementId = liveProgress?.current?.item.id ?? null;
  const followedLiveElementIdRef = useRef<string | null>(null);

  // In view mode, keep the live row centered in the plan list as the schedule advances.
  useEffect(() => {
    if (isEditing) return;
    if (!liveElementId) {
      followedLiveElementIdRef.current = null;
      return;
    }
    if (followedLiveElementIdRef.current === liveElementId) return;
    followedLiveElementIdRef.current = liveElementId;
    const scrollToLive = () => {
      const child = document.getElementById(
        servicePlanElementDomId(liveElementId),
      );
      const parent = document.getElementById(SERVICE_PLAN_LIST_SCROLL_ID);
      if (!child || !parent) return;
      keepElementInView({
        child,
        parent,
        shouldScrollToCenter: true,
      });
    };
    // Double rAF matches ItemSlides: wait for section expand / layout first.
    let innerFrame = 0;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(scrollToLive);
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      window.cancelAnimationFrame(innerFrame);
    };
  }, [isEditing, liveElementId]);

  const liveStartedAt = getServicePlanLiveStartedAt(plan);
  const liveStartedAtLabel = liveStartedAt
    ? formatAdjustedTimelineTime(Date.parse(liveStartedAt), planTimezone)
    : null;
  const adjustedStartTimes = useMemo(() => {
    if (!isTimelineAdjusted || !liveProgress || !liveElementId) return new Map<string, string>();
    const liveIndex = liveProgress.items.findIndex(
      (timed) => timed.item.id === liveElementId,
    );
    if (liveIndex < 0) return new Map<string, string>();
    return new Map(
      liveProgress.items.slice(liveIndex).map((timed) => [
        timed.item.id,
        formatAdjustedTimelineTime(timed.startsAtMs, planTimezone),
      ]),
    );
  }, [isTimelineAdjusted, liveElementId, liveProgress, planTimezone]);
  const shareActionsDisabled = !canEdit || publishing || !hasSections;
  const showLiveToolbarActions = Boolean(
    canEdit && !isEditing && isServiceDay && liveElementId,
  );

  const closeShareMenus = useCallback(() => {
    setShareMenuOpen(false);
    setPlanActionsOpen(false);
  }, []);

  const shareViewActions = (
    kind: "detailed" | "simple",
    label: string,
  ) => (
    <div className="space-y-1.5 px-2 py-1.5">
      <DropdownMenuLabel className="p-0 text-xs font-medium text-gray-300">
        {label}
      </DropdownMenuLabel>
      <ButtonGroup className="w-full border-gray-500" display="flex">
        <ButtonGroupItem
          type="button"
          variant="primary"
          iconSize="sm"
          svg={Copy}
          color="#22d3ee"
          disabled={shareActionsDisabled}
          className="max-md:min-h-0"
          aria-label={`Copy ${label.toLowerCase()} link`}
          onClick={() => {
            closeShareMenus();
            void sharePlanLink(kind, "copy");
          }}
        >
          Copy
        </ButtonGroupItem>
        <ButtonGroupItem
          type="button"
          variant="primary"
          iconSize="sm"
          svg={ExternalLink}
          color="#22d3ee"
          disabled={shareActionsDisabled}
          className="max-md:min-h-0"
          aria-label={`View ${label.toLowerCase()}`}
          onClick={() => {
            closeShareMenus();
            void sharePlanLink(kind, "view");
          }}
        >
          View
        </ButtonGroupItem>
        <ButtonGroupItem
          type="button"
          variant="primary"
          iconSize="sm"
          svg={Mail}
          color="#22d3ee"
          disabled={shareActionsDisabled}
          className="max-md:min-h-0"
          aria-label={`Email ${label.toLowerCase()}`}
          onClick={() => openServicePlanEmailModal(kind)}
        >
          Email
        </ButtonGroupItem>
      </ButtonGroup>
    </div>
  );

  // Publishing is its own action, not a by-product of copying a link: the
  // church's current-service link is shared once and resolves to whichever
  // published plan is running or next, so making a plan reachable meant
  // copying a URL you did not want. Paired with Disable so the control is
  // symmetric — sharing could previously be turned off but never explicitly on.
  //
  // Worded as enable/disable rather than "live": any number of plans can be
  // published at once, and the current-service link picks by time. A plan
  // published for next month is eligible, not live.
  const renderSharePublishingItems = () =>
    publicSharingEnabled ? (
      <>
        <DropdownMenuItem disabled>
          <Check aria-hidden />
          Shared links enabled
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={!canEdit || publishing}
          onSelect={() => {
            void handleUnpublish();
          }}
        >
          Disable shared links
        </DropdownMenuItem>
      </>
    ) : (
      <DropdownMenuItem
        disabled={shareActionsDisabled}
        onSelect={() => {
          void handlePublish();
        }}
      >
        <Share2 aria-hidden />
        Enable shared links
      </DropdownMenuItem>
    );

  const renderShareMenuBody = () => (
    <>
      {shareViewActions("detailed", "Detailed view")}
      {shareViewActions("simple", "Simple view")}
      <DropdownMenuSeparator className="my-1 bg-gray-600" />
      {renderSharePublishingItems()}
    </>
  );

  const canSwitchOccurrence = Boolean(
    occurrenceSwitcher && occurrenceSwitcher.options.length > 1,
  );

  const planActionsBackItem = (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault();
        setPlanActionsView("root");
      }}
    >
      <span className="flex items-center gap-1.5">
        <ChevronLeft aria-hidden className="size-4 text-gray-400" />
        Back
      </span>
    </DropdownMenuItem>
  );

  // Prefer a header Share control when the toolbar has room; fall back to the
  // overflow menu below md (same pattern as live pause/resume actions).
  const shareToolbar =
    plan || hasSections ? (
      <DropdownMenu open={shareMenuOpen} onOpenChange={setShareMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            svg={Share2}
            iconSize="sm"
            className="hidden max-md:min-h-0 md:inline-flex"
            disabled={publishing}
            aria-label={publishing ? "Updating share options" : "Share"}
            aria-haspopup="menu"
          >
            Share
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {renderShareMenuBody()}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const planActionsMenu =
    plan || hasSections || canSwitchOccurrence ? (
      <DropdownMenu open={planActionsOpen} onOpenChange={handlePlanActionsOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            svg={MoreHorizontal}
            iconSize="sm"
            className="max-md:min-h-0"
            disabled={publishing}
            aria-label={publishing ? "Updating plan actions" : "Plan actions"}
            aria-haspopup="menu"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={cn(
            planActionsView === "roleNotes" || planActionsView === "switchService"
              ? "w-72"
              : "w-64",
            // Role notes already scrolls its own team-filter and role list
            // internally (see ServicePlanRolePickerContent); capping the
            // outer menu too nests a second scrollbar inside the first.
            planActionsView === "switchService" && "max-h-80 overflow-y-auto",
          )}
        >
          {planActionsView === "roleNotes" ? (
            <>
              {planActionsBackItem}
              <DropdownMenuSeparator className="my-1 bg-gray-600" />
              <DropdownMenuLabel className="text-xs font-normal text-gray-400">
                Role notes
              </DropdownMenuLabel>
              <ServicePlanRolePickerContent
                value={roleNotesFilter}
                onValueChange={setRoleNotesFilter}
                onSelectionComplete={() => setPlanActionsOpen(false)}
                options={roleNoteFilterOptions}
                teamFilterStorageKey="worshipsyncServicePlanRoleTeamFilter"
                lockedTeamName={teamNotesFilter || undefined}
              />
            </>
          ) : planActionsView === "switchService" && occurrenceSwitcher ? (
            <>
              {planActionsBackItem}
              <DropdownMenuSeparator className="my-1 bg-gray-600" />
              <DropdownMenuLabel className="text-xs font-normal text-gray-400">
                Switch service
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={occurrence.occurrenceId}
                onValueChange={(value) => {
                  occurrenceSwitcher.onSelect(value);
                  setPlanActionsOpen(false);
                }}
                aria-label="Switch service"
              >
                {occurrenceSwitcher.options.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.occurrenceId}
                    value={option.occurrenceId}
                  >
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          ) : (
            <>
              {hasSections ? (
                <>
                  <DropdownMenuLabel className="text-xs text-gray-400">
                    Notes
                  </DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={hideNotes}
                    onCheckedChange={(checked) => handleHideNotesChange(Boolean(checked))}
                  >
                    Hide notes
                  </DropdownMenuCheckboxItem>
                  {teamNoteLabels.length > 0 ? (
                    <DropdownMenuRadioGroup
                      value={teamNotesFilter || ALL_TEAMS_FILTER_VALUE}
                      onValueChange={handleTeamNotesFilterChange}
                      aria-label="Team notes"
                    >
                      <DropdownMenuRadioItem
                        value={ALL_TEAMS_FILTER_VALUE}
                        disabled={hideNotes}
                      >
                        All teams
                      </DropdownMenuRadioItem>
                      {teamNoteLabels.map((team) => (
                        <DropdownMenuRadioItem
                          key={team}
                          value={team}
                          disabled={hideNotes}
                        >
                          {team}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  ) : null}
                  {roleNoteFilterOptions.length > 0 ? (
                    <DropdownMenuItem
                      disabled={hideNotes}
                      onSelect={(event) => {
                        event.preventDefault();
                        setPlanActionsView("roleNotes");
                      }}
                    >
                      Role notes
                      <ChevronRight
                        aria-hidden
                        className="ml-auto size-4 text-gray-400"
                      />
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator className="my-1 bg-gray-600" />
                </>
              ) : null}
              <DropdownMenuItem
                disabled={!canEdit}
                onSelect={() => setShowServiceDetails(true)}
              >
                <Pencil aria-hidden />
                Edit service details
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1 bg-gray-600" />
              <DropdownMenuItem
                disabled={!canEdit || !hasSections}
                onSelect={() => setTemplateModal("save")}
              >
                <LayoutTemplate aria-hidden />
                Save as template
              </DropdownMenuItem>
              {canEdit && hasSections ? (
                <DropdownMenuItem
                  disabled={importing}
                  onSelect={openImportUpdates}
                >
                  <RefreshCw aria-hidden />
                  Import updates
                </DropdownMenuItem>
              ) : null}
              {isServiceDay && liveElementId ? (
                <>
                  <DropdownMenuSeparator
                    className={cn(
                      "my-1 bg-gray-600",
                      showLiveToolbarActions && "lg:hidden",
                    )}
                  />
                  <DropdownMenuItem
                    className={showLiveToolbarActions ? "lg:hidden" : undefined}
                    disabled={!canEdit || updatingPublicLive}
                    onSelect={() => {
                      if (isManualLive) {
                        void handleContinueAutomaticAdvance();
                        return;
                      }
                      void handlePauseAutomaticAdvance();
                    }}
                  >
                    <Radio aria-hidden />
                    {isManualLive
                      ? "Continue automatic timing"
                      : "Pause automatic advance"}
                  </DropdownMenuItem>
                  {isLiveOverridden ? (
                    <DropdownMenuItem
                      className={showLiveToolbarActions ? "lg:hidden" : undefined}
                      disabled={!canEdit || updatingPublicLive}
                      onSelect={() => {
                        void handleResumePublicSchedule();
                      }}
                    >
                      <Radio aria-hidden />
                      Return to planned schedule
                    </DropdownMenuItem>
                  ) : null}
                </>
              ) : null}
              {(plan || hasSections) ? (
                <div className="md:hidden">
                  <DropdownMenuSeparator className="my-1 bg-gray-600" />
                  {renderShareMenuBody()}
                </div>
              ) : null}
              {occurrenceSwitcher && canSwitchOccurrence ? (
                <>
                  <DropdownMenuSeparator className="my-1 bg-gray-600" />
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      setPlanActionsView("switchService");
                    }}
                  >
                    Switch service
                    <ChevronRight
                      aria-hidden
                      className="ml-auto size-4 text-gray-400"
                    />
                  </DropdownMenuItem>
                </>
              ) : null}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const planBody = (
    <>
      <Sheet open={showServiceDetails} onOpenChange={setShowServiceDetails}>
        <SheetContent side="right" className="w-full max-w-md gap-0">
          <SheetHeader>
            <SheetTitle>Edit service details</SheetTitle>
            <SheetDescription>
              Update the name or planned start time for this service.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-6 py-5">
            <DebouncedInput
              key={`plan-name:${planKey}`}
              label="Plan name"
              value={planName}
              disabled={!canEdit}
              onChange={updateDraftName}
            />
            <TimePicker
              label="Service start time"
              labelLayout="stacked"
              value={anchorStartTime}
              disabled={!canEdit || !sections || sections.every((section) => section.elements.length === 0)}
              onChange={(value) => {
                if (!value || !sections) return;
                updateDraftSections(
                  applyPlanAnchorStartTime(sections, String(value)),
                  "anchorStartTime",
                );
              }}
            />
            <p className="text-xs text-gray-400">Changes save automatically.</p>
          </div>
        </SheetContent>
      </Sheet>
      {loadingInitialContent ? <ServicePlanSkeleton /> : null}

      {!loadingInitialContent && isEmpty && canEdit ? (
        <div
          className={cn(
            "flex flex-col gap-3",
            showChrome &&
            "flex-1 items-center justify-center rounded-lg border border-dashed border-gray-700 bg-black/20 px-4 py-8 text-center",
          )}
        >
          {showChrome ? (
            <>
              <p className="text-sm font-medium text-gray-200">
                {plan ? "This plan is empty" : "No plan yet"}
              </p>
              <p className="max-w-md text-sm text-gray-400">
                {defaultPlanTemplateMissing
                  ? "The default template is unavailable. Choose another template here or update Service setup."
                  : "Apply a saved template, build from a blank plan, or import from Service Planning or Planning Center."}
              </p>
            </>
          ) : null}
          <div className="flex flex-wrap justify-center gap-2">
            <div className="inline-flex">
              <Button
                type="button"
                variant="primary"
                className="rounded-r-none border-r-0"
                disabled={planTemplatesLoading}
                onClick={() => {
                  if (defaultPlanTemplate) {
                    applySavedTemplate(defaultPlanTemplate);
                    return;
                  }
                  setTemplateModal("apply");
                }}
              >
                {defaultPlanTemplate
                  ? `Apply ${defaultPlanTemplate.name}`
                  : "Apply a template"}
              </Button>
              <Button
                type="button"
                variant="primary"
                className="rounded-l-none border-l-2 border-l-gray-500 px-2"
                svg={ChevronDown}
                iconSize="sm"
                disabled={planTemplatesLoading}
                aria-haspopup="dialog"
                aria-label="Choose a template"
                onClick={() => setTemplateModal("apply")}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={startFromScratch}
            >
              Start from scratch
            </Button>
            <DropdownMenu>
              <div className="inline-flex">
                <Button
                  type="button"
                  variant="secondary"
                  className="rounded-r-none border-r-0"
                  isSelected={showImport || importing}
                  disabled={importing}
                  onClick={() => openImportSourceForm(importSource)}
                >
                  {importing
                    ? "Importing…"
                    : `Import from ${servicePlanImportSourceLabel(importSource)}`}
                </Button>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    className="rounded-l-none border-l-2 border-l-gray-400 px-2"
                    svg={ChevronDown}
                    iconSize="sm"
                    isSelected={showImport || importing}
                    disabled={importing}
                    aria-haspopup="menu"
                    aria-label="Choose import source"
                  />
                </DropdownMenuTrigger>
              </div>
              <DropdownMenuContent align="center" className="min-w-56">
                <DropdownMenuLabel className="text-xs font-normal text-gray-400">
                  Import from
                </DropdownMenuLabel>
                {SERVICE_PLAN_IMPORT_SOURCE_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onSelect={() => {
                      openImportSourceForm(
                        parseImportSourceValue(option.value),
                      );
                    }}
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : null}
      {isEmpty && !canEdit ? (
        <p className="text-xs text-gray-500">
          You don&apos;t have permission to create a plan for this service.
        </p>
      ) : null}

      {hasSections && sections ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <ServicePlanSectionList
            sections={sections}
            canEdit={canEdit}
            isEditing={isEditing}
            sectionLabelColor={churchBranding?.colors?.[1]?.value}
            sectionBorderColor={churchBranding?.colors?.[0]?.value}
            onSectionsChange={updateDraftSections}
            selection={selectedPlanTarget}
            onSelectionChange={setSelectedPlanTarget}
            scrollId={SERVICE_PLAN_LIST_SCROLL_ID}
            header={
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-100">
                  {planName.trim() || occurrence.name || service.name}
                </p>
                {anchorStartTime ? (
                  <p className="mt-0.5 text-xs text-gray-400">
                    Starts {formatPlanStartTimeDisplay(anchorStartTime)}
                  </p>
                ) : null}
              </div>
            }
            assignedToHistoryValues={assignedToSuggestions}
            onRemoveAssignedToHistoryValue={removeAssignmentHistoryValue}
            isAssignedToHistoryValueRemovable={isAssignmentHistoryValueRemovable}
            roleNoteOptions={roleNoteOptions}
            scheduledPositionOptions={scheduledPositionOptions}
            teamNoteOptions={teamNoteOptions}
            microphones={microphones}
            microphoneAudiences={microphoneAudiences}
            scheduledMicrophoneHolders={scheduledMicrophoneHolders}
            scheduledAssignmentRows={scheduledAssignmentRows}
            onOpenScheduledAssignment={onOpenScheduledAssignment}
            isServiceDay={isServiceDay}
            liveElementId={liveElementId}
            isManualLive={isManualLive}
            isTimelineAdjusted={isTimelineAdjusted}
            adjustedStartTimes={adjustedStartTimes}
            liveStartedAtLabel={liveStartedAtLabel}
            publicLiveBusy={updatingPublicLive}
            onMakePublicLive={handleMakePublicLive}
            hideNotes={hideNotes}
            teamNotesFilter={teamNotesFilter}
            roleNotesFilter={roleNotesFilter}
            onViewSongLyrics={setViewSongRef}
            allSongDocs={allSongDocs}
            canCreateLibrarySong={canCreateLibrarySong}
            onCreatePendingSong={openPendingSongCreator}
            resolvedSongRefs={resolvedSongRefs}
          />

          {/* Autosave state is rendered in the plan toolbar under the tabs.
            <div
              className={cn(
                "hidden flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs",
                autosave.state === "conflict"
                  ? "border-amber-700/70 bg-amber-950/30 text-amber-100"
                  : autosave.state === "error"
                    ? "border-red-800/70 bg-red-950/30 text-red-100"
                    : "border-slate-700 bg-slate-900/70 text-slate-300",
              )}
              role={autosave.state === "error" || autosave.state === "conflict" ? "alert" : "status"}
            >
              {autosave.state === "dirty" ? "Changes waiting to save." : null}
              {autosave.state === "saving" ? "Saving changes…" : null}
              {autosave.state === "retrying" ? "Could not save. Retrying…" : null}
              {autosave.state === "error" ? "Could not save your changes." : null}
              {autosave.state === "conflict" ? "Another editor changed this plan." : null}
              {autosave.state === "error" ? (
                <Button variant="tertiary" className="h-auto min-h-0 px-0 py-0 text-xs" onClick={autosave.retry}>
                  Retry
                </Button>
              ) : null}
              {autosave.state === "conflict" ? (
                <Button variant="tertiary" className="h-auto min-h-0 px-0 py-0 text-xs" onClick={reloadConflictPlan}>
                  Reload latest
                </Button>
              ) : null}
            </div>
          */}

        </div>
      ) : null}
    </>
  );

  /**
   * Add section plus the plan's save state. It stays in the footer chrome
   * (not inside the running order) so edit ↔ view does not shift the list,
   * and a failed or conflicted save is never hidden behind another tab.
   */
  const planAddTarget = sections
    ? resolveServicePlanAddTarget(sections, selectedPlanTarget)
    : null;
  const planToolbar =
    hasSections && sections ? (
      <div className="flex min-h-9 shrink-0 flex-wrap gap-2">
        {canEdit && isEditing && activeTab === "plan" ? (
          <>
            <Button
              type="button"
              variant="tertiary"
              svg={Plus}
              iconSize="sm"
              className="max-md:min-h-0"
              onClick={() =>
                planAddTarget &&
                handleAddElement(
                  planAddTarget.sectionId,
                  planAddTarget.insertAfterElementId,
                )
              }
            >
              Add item
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="tertiary"
                  svg={ChevronDown}
                  iconSize="sm"
                  className="max-md:min-h-0"
                  aria-label="Choose item destination"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-56">
                {sections.map((section) => (
                  <DropdownMenuItem
                    key={section.id}
                    onSelect={() => void handleAddElement(section.id)}
                  >
                    Add to {section.name.trim() || "Untitled section"}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex items-center border-l border-gray-600 pl-2">
              <Button
                type="button"
                variant="tertiary"
                svg={Plus}
                iconSize="sm"
                className="max-md:min-h-0"
                onClick={handleAddSection}
              >
                Add section
              </Button>
            </div>
          </>
        ) : null}
        <div
          className={cn(
            "ml-auto flex min-h-9 items-center gap-2 rounded-md px-2.5 text-xs font-medium",
            autosave.state === "conflict"
              ? "bg-amber-950/50 text-amber-100"
              : autosave.state === "error"
                ? "bg-red-950/50 text-red-100"
                : "text-gray-400",
          )}
          role={autosave.state === "error" || autosave.state === "conflict" ? "alert" : "status"}
          aria-live="polite"
        >
          {autosave.state === "saved" ? "Synced" : null}
          {autosave.state === "dirty" ? "Saving soon" : null}
          {autosave.state === "saving" ? "Saving…" : null}
          {autosave.state === "retrying" ? "Retrying save…" : null}
          {autosave.state === "error" ? "Could not save" : null}
          {autosave.state === "conflict" ? "Plan changed elsewhere" : null}
          {autosave.state === "error" ? (
            <Button variant="tertiary" className="h-auto min-h-0 px-0 py-0 text-xs" onClick={autosave.retry}>
              Retry
            </Button>
          ) : null}
          {autosave.state === "conflict" ? (
            <Button variant="tertiary" className="h-auto min-h-0 px-0 py-0 text-xs" onClick={reloadConflictPlan}>
              Reload latest
            </Button>
          ) : null}
        </div>
      </div>
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700/80 bg-gray-950/70">
      {showChrome || plan || hasSections || canSwitchOccurrence ? (
        <header className="shrink-0 space-y-2 border-b border-gray-800 px-3 py-2">
          {showChrome ? (
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="tertiary"
                svg={ArrowLeft}
                iconSize="sm"
                className="max-md:min-h-0"
                onClick={onBack}
              >
                {backLabel}
              </Button>
              {planNavigation ? (
                <div
                  className="flex shrink-0 items-center gap-1"
                  role="group"
                  aria-label="Plan navigation"
                >
                  <Button
                    type="button"
                    variant="secondary"
                    svg={ChevronLeft}
                    iconSize="sm"
                    className="max-md:min-h-0"
                    aria-label="Previous plan"
                    disabled={!planNavigation.onPrevious}
                    onClick={planNavigation.onPrevious}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    svg={ChevronRight}
                    iconSize="sm"
                    className="max-md:min-h-0"
                    aria-label="Next plan"
                    disabled={!planNavigation.onNext}
                    onClick={planNavigation.onNext}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold text-gray-50 sm:text-lg">
                {occurrence.name || service.name}
              </h2>
              <p className="mt-0.5 text-xs text-gray-400">{occurrenceTiming}</p>
            </div>
            {plan || hasSections || canSwitchOccurrence ? (
              <div className="flex shrink-0 items-center gap-1.5">
                {canEdit && isEditing && hasSections ? (
                  <div
                    className="flex shrink-0 items-center"
                    role="group"
                    aria-label="Undo and redo"
                  >
                    <Button
                      type="button"
                      variant="tertiary"
                      svg={Undo2}
                      iconSize="sm"
                      className="max-md:min-h-0"
                      aria-label="Undo"
                      disabled={!canUndo}
                      onClick={undoDraft}
                    />
                    <Button
                      type="button"
                      variant="tertiary"
                      svg={Redo2}
                      iconSize="sm"
                      className="max-md:min-h-0"
                      aria-label="Redo"
                      disabled={!canRedo}
                      onClick={redoDraft}
                    />
                  </div>
                ) : null}
                {showLiveToolbarActions ? (
                  <>
                    <Button
                      type="button"
                      variant="primary"
                      svg={Radio}
                      iconSize="sm"
                      color={
                        isManualLive
                          ? SERVICE_PLAN_RESUME_ICON_COLOR
                          : SERVICE_PLAN_PAUSE_ICON_COLOR
                      }
                      className="hidden max-md:min-h-0 lg:inline-flex"
                      disabled={updatingPublicLive}
                      title={
                        isManualLive
                          ? "Continue automatic timing"
                          : "Pause automatic advance"
                      }
                      onClick={() => {
                        if (isManualLive) {
                          void handleContinueAutomaticAdvance();
                          return;
                        }
                        void handlePauseAutomaticAdvance();
                      }}
                    >
                      {isManualLive
                        ? "Resume auto-advance"
                        : "Pause auto-advance"}
                    </Button>
                    {isLiveOverridden ? (
                      <Button
                        type="button"
                        variant="primary"
                        svg={Radio}
                        iconSize="sm"
                        color={SERVICE_PLAN_SCHEDULE_ICON_COLOR}
                        className="hidden max-md:min-h-0 lg:inline-flex"
                        disabled={updatingPublicLive}
                        onClick={() => void handleResumePublicSchedule()}
                        title="Return to planned schedule"
                      >
                        Resume schedule
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {canEdit && hasSections ? (
                  <Button
                    type="button"
                    variant={isEditing ? "secondary" : "primary"}
                    svg={isEditing ? undefined : Pencil}
                    iconSize="sm"
                    className="max-md:min-h-0"
                    onClick={toggleEditing}
                  >
                    {isEditing ? "Done" : "Edit"}
                  </Button>
                ) : null}
                {shareToolbar}
                {planActionsMenu}
              </div>
            ) : null}
          </div>
        </header>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 sm:gap-3 sm:p-3">
        {showSummary ? workspaceSummary : null}
        <Tabs
          value={activeTab}
          onValueChange={(next) => setPlanTab(next as ServicePlanEditorTab)}
          className="min-h-0 flex-1 gap-2"
        >
          <TabsList
            variant="line"
            className={cn(lineTabsListShellClassName, "shrink-0")}
            aria-label="Plan view"
          >
            <TabsTrigger
              value="plan"
              className={lineTabsTriggerSmClassName}
              aria-label="Plan / Order of service"
            >
              Plan
            </TabsTrigger>
            <TabsTrigger
              value="setlist"
              className={lineTabsTriggerSmClassName}
              aria-label="Setlist"
            >
              Setlist
            </TabsTrigger>
            {showMicrophoneTab ? (
              <TabsTrigger
                value="microphones"
                className={lineTabsTriggerSmClassName}
                aria-label="Mic Assignments"
              >
                Mics
              </TabsTrigger>
            ) : null}
            {showServingTab ? (
              <TabsTrigger
                value="serving"
                className={lineTabsTriggerSmClassName}
                aria-label="People / Who's serving"
              >
                People
              </TabsTrigger>
            ) : null}
          </TabsList>
          {/* The running order stays mounted so switching tabs never
              remounts the list or loses where the operator was. */}
          <TabsContent
            value="plan"
            forceMount
            className="flex min-h-0 flex-1 flex-col gap-2 data-[state=inactive]:hidden sm:gap-3"
          >
            {planBody}
          </TabsContent>
          <TabsContent
            value="setlist"
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <ServicePlanSetlist
              sections={sections}
              songs={allSongDocs}
              resolvedSongRefs={resolvedSongRefs}
              onViewSong={setViewSongRef}
              onCreatePendingSong={
                canCreateLibrarySong ? openPendingSongCreator : undefined
              }
              onLinkYouTubeVideo={
                canEdit ? linkYouTubeVideoToSong : undefined
              }
            />
          </TabsContent>
          {showMicrophoneTab ? (
            <TabsContent
              value="microphones"
              className="scrollbar-variable min-h-0 flex-1 overflow-y-auto"
            >
              <TeamMicrophonesPanel
                rows={microphoneRows}
                microphones={microphones}
                canEdit={canEdit}
                assignmentsStatus={teamMicrophones?.assignmentsStatus}
                savingSlot={teamMicrophones?.savingSlot}
                onChange={(row, microphoneIds) =>
                  teamMicrophones?.onChange(row, microphoneIds)
                }
              />
            </TabsContent>
          ) : null}
          {showServingTab ? (
            <TabsContent
              value="serving"
              className="scrollbar-variable min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-700 bg-black/20 p-3"
            >
              {mobileServingContent}
            </TabsContent>
          ) : null}
        </Tabs>
        {planToolbar}
      </div>

      {canEdit ? (
        <Sheet open={showImport} onOpenChange={setShowImport}>
          <SheetContent side="right" className="w-full max-w-lg gap-0">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <RefreshCw className="size-5 text-cyan-400" aria-hidden />
                {hasPlanContent ? "Import updates" : "Import plan"}
              </SheetTitle>
              <SheetDescription>
                {hasPlanContent
                  ? `Choose what to refresh from ${servicePlanImportSourceLabel(importSource)}. Local item order, roster links, and outline history stay in place.`
                  : `Import from ${servicePlanImportSourceLabel(importSource)}. Review everything before saving.`}
              </SheetDescription>
            </SheetHeader>
            <div className="scrollbar-variable flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-5">
              <Select
                label="Import from"
                options={SERVICE_PLAN_IMPORT_SOURCE_OPTIONS}
                value={importSource}
                disabled={importing}
                onChange={(value) => {
                  const next = parseImportSourceValue(value);
                  if (next === "planningCenterPdf") {
                    openPlanningCenterPdfPicker();
                    setShowImport(false);
                    return;
                  }
                  handleImportSourceChange(next);
                }}
              />
              {importSource === "planningCenterPdf" ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-400">
                    Choose a Planning Center order-of-service PDF. WorshipSync
                    reads the plan text from the file.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    svg={Upload}
                    iconSize="sm"
                    disabled={importing}
                    onClick={openPlanningCenterPdfPicker}
                  >
                    {importing ? "Importing…" : "Choose PDF"}
                  </Button>
                </div>
              ) : importSource === "planningCenter" ? (
                churchId && planningCenterConnected ? (
                  <PlanningCenterAccountImportFields
                    churchId={churchId}
                    disabled={importing}
                    serviceTypeId={importPcoServiceTypeId}
                    planId={importPcoPlanId}
                    onServiceTypeIdChange={setImportPcoServiceTypeId}
                    onPlanIdChange={setImportPcoPlanId}
                  />
                ) : (
                  <p className="text-xs text-amber-100/90">
                    Connect Planning Center in Integrations first, then return
                    here to import a plan.
                  </p>
                )
              ) : (
                <Input
                  label="Planning URL"
                  placeholder="https://..."
                  value={importUrl}
                  disabled={importing}
                  onChange={(value) => setImportUrl(String(value))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleImportPlan();
                    }
                  }}
                />
              )}
              {hasPlanContent && importSource !== "planningCenterPdf" ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-gray-100">
                    Update from {servicePlanImportSourceLabel(importSource)}
                  </legend>
                  <div className="grid gap-2 pt-1 sm:grid-cols-2">
                    <Checkbox
                      label="Titles and content"
                      checked={refreshOptions.updateTitles}
                      disabled={importing}
                      onCheckedChange={(checked) => updateRefreshOption("updateTitles", checked)}
                    />
                    <Checkbox
                      label="Assigned to"
                      checked={refreshOptions.updateAssignments}
                      disabled={importing}
                      onCheckedChange={(checked) => updateRefreshOption("updateAssignments", checked)}
                    />
                    <Checkbox
                      label="Start times and durations"
                      checked={refreshOptions.updateTiming}
                      disabled={importing}
                      onCheckedChange={(checked) => updateRefreshOption("updateTiming", checked)}
                    />
                    <Checkbox
                      label="Notes"
                      checked={refreshOptions.updateNotes}
                      disabled={importing}
                      onCheckedChange={(checked) => updateRefreshOption("updateNotes", checked)}
                    />
                    <Checkbox
                      label="Add new source items"
                      checked={refreshOptions.addMissing}
                      disabled={importing}
                      onCheckedChange={(checked) => updateRefreshOption("addMissing", checked)}
                    />
                    <Checkbox
                      label="Remove source items no longer listed"
                      checked={refreshOptions.removeMissing}
                      disabled={importing}
                      onCheckedChange={(checked) => updateRefreshOption("removeMissing", checked)}
                    />
                  </div>
                </fieldset>
              ) : null}
              {hasPlanContent && importSource !== "planningCenterPdf" ? (
                <p className="text-xs text-gray-400">
                  Removing items is off by default. Turn it on only when this
                  imported plan is the source of truth.
                </p>
              ) : null}
              {hasPlanContent && isLegacyUntrackedImport ? (
                <p className="text-xs text-amber-200">
                  This plan was imported before source tracking. If you remove
                  missing items, current unmarked items will be treated as
                  imported items for this refresh.
                </p>
              ) : null}
              {importSource !== "planningCenterPdf" ? (
                <Button
                  variant="cta"
                  svg={hasPlanContent ? RefreshCw : Upload}
                  iconSize="sm"
                  color={hasPlanContent ? "#22d3ee" : undefined}
                  className="w-full justify-center"
                  onClick={() => void handleImportPlan()}
                  disabled={
                    importing ||
                    (importSource === "planningCenter"
                      ? !planningCenterConnected ||
                      !importPcoServiceTypeId ||
                      !importPcoPlanId
                      : !importUrl.trim())
                  }
                >
                  {importing
                    ? "Importing…"
                    : hasPlanContent
                      ? "Apply updates"
                      : "Import plan"}
                </Button>
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      <input
        ref={planningCenterPdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        aria-label="Planning Center PDF"
        onChange={(event) => void handlePlanningCenterPdfSelected(event)}
      />

      {importPreview ? (
        <ServicePlanImportReviewWindow
          summary={importPreview.summary}
          onApply={applyImportPreview}
          onClose={() => setImportPreview(null)}
        />
      ) : null}

      {templateModal && churchId ? (
        <ServicePlanTemplateModal
          mode={templateModal}
          churchId={churchId}
          serviceId={service.serviceId}
          serviceName={service.name}
          sections={sections || []}
          onClose={() => setTemplateModal(null)}
          onApply={(templateSections) => {
            updateDraft({
              sections: templateSections,
              ...(planName
                ? {}
                : { planName: occurrence.name || service.name || "" }),
            });
            setIsEditing(true);
          }}
        />
      ) : null}

      {emailModalOpen ? (
        <ServicePlanEmailModal
          serviceName={planName.trim() || occurrence.name || service.name || "Service"}
          dateLabel={formatServicePlanEmailDate(occurrence.startsAt, planTimezone)}
          initialShareVersion={emailModalInitialVersion}
          onClose={() => setEmailModalOpen(false)}
          onSend={handleSendServicePlanEmail}
        />
      ) : null}

      {pendingSongCreateRef ? (
        <ServicePlanLibraryPicker
          isOpen
          initialQuery={pendingSongCreateRef.title}
          initialLyrics={pendingSongCreateRef.lyricsText}
          startInCreate
          onClose={() => setPendingSongCreateRef(null)}
          onSelectSong={handlePendingSongCreated}
        />
      ) : null}

      <ViewSongSectionsDrawer
        song={viewLibrarySong}
        isOpen={Boolean(viewSongRef?.kind === "library" && viewLibrarySong)}
        onClose={() => setViewSongRef(null)}
      />
      <ViewPlainLyricsDrawer
        title={viewPlainLyrics?.title ?? null}
        lyricsText={viewPlainLyrics?.lyricsText ?? ""}
        emptyMessage={viewPlainLyrics?.emptyMessage}
        isOpen={Boolean(viewPlainLyrics)}
        onClose={() => setViewSongRef(null)}
      />
    </div>
  );
};

export default ServicePlanEditor;
