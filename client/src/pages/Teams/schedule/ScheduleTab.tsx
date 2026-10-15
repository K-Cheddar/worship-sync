import {
  Fragment,
  startTransition,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  ChevronsDownUp,
  ChevronsUpDown,
  Clipboard,
  ClipboardPaste,
  Copy,
  LayoutGrid,
  Link2,
  MoreHorizontal,
  MessageSquareText,
  Send,
  Plus,
  Printer,
  Redo2,
  Undo2,
  Users,
  Wand2,
  Pencil,
} from "lucide-react";
import Button from "../../../components/Button/Button";
import Menu from "../../../components/Menu/Menu";
import Modal from "../../../components/Modal/Modal";
import ConfirmDialog from "../../../components/Modal/ConfirmDialog";
import Drawer from "../../../components/Drawer/Drawer";
import SegmentedControl from "../../../components/SegmentedControl/SegmentedControl";
import type { MenuItemType } from "../../../types";
import Icon from "../../../components/Icon/Icon";
import Select from "../../../components/Select/Select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { cn } from "@/utils/cnHelper";
import { serverDate, serverNow } from "@/utils/serverTime";
import {
  findNextUpcomingOccurrenceId,
  formatOccurrenceRowLabel,
  isOccurrenceToday,
  formatOccurrenceTiming,
  generateScheduleOccurrences,
  getOccurrenceDate,
  getOccurrenceTimeZoneAbbreviation,
  getSharedOccurrenceTiming,
  occurrenceScheduleDetailsMatch,
  preserveStoredOccurrenceIds,
} from "@/utils/teamScheduleOccurrences";
import {
  getCreateScheduleDefaultRange,
  getCreateScheduleDefaultServiceIds,
  formatSuggestedScheduleName,
} from "./scheduleCreateDefaults";
import {
  ensureTeamScheduleForPeriod,
} from "../../../api/auth";
import {
  findReusablePeriodSchedule,
  findOverlappingPeriodSchedules,
  mergeCurrentScheduleOccurrences,
  resolveDisplayedPeriodRange,
  filterOccurrencesToRange,
  formatSchedulePeriodName,
  type SchedulePeriodPreset,
} from "./schedulePeriodUtils";
import {
  buildTeamSchedulePeriod,
  findInitialTeamSchedulePeriod,
} from "./teamSchedulePeriod";
import { useScheduleNotificationHistory } from "./useScheduleNotificationHistory";
import RangeSelector from "../components/RangeSelector";
import {
  resolveRangePreset,
  shiftRange,
  useRangeSelection,
} from "../rangeSelection";
import {
  createTeamRosterMember,
  getTeamScheduleDetail,
  sendTeamSchedule,
  getTeamSchedulePublicLink,
  getServicePlanMicrophones,
  getServiceEquipment,
  updateTeam,
  updateTeamSchedule,
  updateTeamScheduleAssignment,
  updateTeamScheduleAssignmentsBatch,
  updateTeamScheduleAssignmentMicrophones,
  updateTeamScheduleAssignmentIems,
  updateTeamScheduleAssignmentSwap,
  updateTeamScheduleGuest,
  removeTeamScheduleGuest,
  addTeamSchedulePositionSlot,
  removeTeamSchedulePositionSlot,
  getNotificationIntentPreview,
  resolveReplacementNotificationIntent,
  prepareReplacementNotificationIntent,
  sendNotificationIntent,
} from "../../../api/auth";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import {
  canRefreshScheduleOccurrences,
  rekeyAssignmentsByServiceDate,
  rekeyScheduleOccurrenceRowsByServiceDate,
} from "./scheduleDraftUtils";
import { buildScheduleExportModel } from "./scheduleExport";
import ScheduleBrowserDialog from "./ScheduleBrowserDialog";
import ScheduleOverlapPicker from "./ScheduleOverlapPicker";
import PortableDataImportDialog from "../../../components/PortableDataTransfer/PortableDataImportDialog";
import { createScheduleCsvMenuItems } from "./scheduleCsvActions";
import SmsConfirmationModal from "../components/SmsConfirmationModal";
import {
  ALL_TEAMS_SCHEDULE_FILTER,
  readScheduleTeamFilter,
  writeScheduleTeamFilter,
} from "../teamsLocalStore";
import SchedulePdfExportButton from "./SchedulePdfExportButton";
import { parsePlainDate } from "@/utils/plainDate";
import {
  ADMIN_SCHEDULE_LAYOUTS,
  hasStoredTeamScheduleAdminLayout,
  resolveInitialTeamScheduleAdminLayout,
  responsiveDefaultTeamScheduleAdminLayout,
  toScheduleExportLayout,
  writeTeamScheduleAdminLayout,
  type TeamScheduleAdminLayout,
} from "../teamScheduleAdminLayout";
import {
  OCCURRENCE_ORGANIZE_OPTIONS,
  readScheduleOrganizeMode,
  writeScheduleOrganizeMode,
  type OccurrenceOrganizeMode,
} from "../occurrenceOrganizeMode";
import {
  isHydratedSchedule,
  onlyHydratedSchedules,
  type PositionRequirement,
  type TeamPosition,
  type TeamRecord,
  type TeamRosterMember,
  type TeamSchedule,
  type TeamScheduleAssignments,
  type TeamScheduleGuest,
  type TeamScheduleOccurrence,
  type TeamScheduleShadowKind,
  type NotificationIntent,
} from "../../../api/authTypes";
import type { ServiceEquipment, ServicePlanMicrophone } from "../../../types/servicePlan";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import PositionIconBadge from "../../../components/icons/PositionIconBadge";
import {
  panelClassName,
  panelShellClassName,
  scheduleGridScrollClassName,
  scheduleGridFrameClassName,
  scheduleTabRootClassName,
  scheduleWorkspaceBodyRowClassName,
  scheduleWorkspaceMainColumnClassName,
  scheduleWorkspacePanelClassName,
  teamsCreatePanelFormClassName,
  teamsCreatePanelFormOpenMobileClassName,
  teamsManagerPageRootClassName,
} from "../teamsStyles";
import type {
  PendingCellAssignment,
  TeamsData,
  TeamsScheduleDrafts,
} from "../types";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import {
  buildTeamSchedulePublicUrl,
  countScheduleAssignmentsForMember,
  getMemberServingHistories,
  getCellMemberIds,
  getCellPrimaryMemberId,
  getCellShadowAssignments,
  getDuplicateScheduleFirstNames,
  isActive,
  normalizeAssignmentCell,
  scheduleMemberName,
  scheduleGuestToDisplayMember,
  serializeAssignmentCell,
  serviceDateBlockedOut,
  shadowKindLabel,
  defaultScheduleMembersSort,
  type MemberServingHistory,
  type ScheduleMembersSort as ScheduleMembersSortState,
} from "../teamsUtils";
import { buildScheduleReturnTo } from "../teamsReturnNavigation";
import {
  isMemberAvailableOnDate,
  servingFrequencyTargetReached,
} from "../memberPreferences";
import {
  useTeamsRestoreOnMount,
  useTeamsReturnNavigation,
} from "../hooks/useTeamsReturnNavigation";
import { useTeamsUnsavedChanges } from "../hooks/useTeamsUnsavedChanges";
import { useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";
import TeamsReturnBackButton from "../components/TeamsReturnBackButton";
import type { TeamsReturnTo } from "../teamsReturnNavigation";
import {
  buildScheduleColumns,
  computeOccurrenceFill,
  getRequiredCount,
  isOccurrenceStaffingSlot,
  makeSlotKey,
  parseSlotKey,
  resolveOccurrenceRequirements,
  type OccurrenceFill,
  type ScheduleSlotColumn,
} from "./scheduleRequirements";
import ScheduleTodayBadge from "./ScheduleTodayBadge";
import ScheduleUpNextBadge from "./ScheduleUpNextBadge";
import ScheduleGridCell from "./ScheduleGridCell";
import ScheduleBoardView from "./ScheduleBoardView";
import ScheduleAssignmentPicker, {
  type ScheduleAssignmentSwapRecommendation,
} from "./ScheduleAssignmentPicker";
import {
  computeLevelBalanceBoost,
  getManualScheduleAssignmentIssue,
  type ScheduleMemberRecommendationStats,
} from "./scheduleMemberPickerUtils";
import { buildAutoFillPlan, type AutoFillEntry } from "./scheduleAutoFill";
import ScheduleMembersPanel from "./ScheduleMembersPanel";
import ScheduleMessagesPanel from "./ScheduleMessagesPanel";
import ScheduleInitialSmsSendFlow from "./ScheduleInitialSmsSendFlow";
import {
  ScheduleAssignmentProvider,
  type ScheduleAssignmentHandlers,
} from "./ScheduleAssignmentContext";
import ScheduleOccurrenceDateButton from "./ScheduleOccurrenceDateButton";
import SchedulePasteRowDialog from "./SchedulePasteRowDialog";
import {
  findCrossTeamScheduleOccurrenceConflicts,
  formatCrossTeamScheduleConflictWarning,
  scheduleDateRangesOverlap,
} from "./scheduleConflicts";
import type { RowPasteApplyEntry } from "./schedulePasteRow";
import ScheduleEditForm from "./ScheduleEditForm";
import type { ScheduleEquipmentHolder } from "./ScheduleEquipmentSelect";
import {
  buildScheduleCopyDraft,
  CUSTOM_SCHEDULE_DRAFT_KEY,
  getScheduleCopyDraftKey,
} from "./scheduleDraftUtils";
import {
  cellsMatch,
  type ScheduleCellChange,
  type ScheduleCellState,
  type ScheduleUndoEntry,
} from "./scheduleUndo";
import { useScheduleUndoStack } from "./useScheduleUndoStack";
import {
  buildOccurrenceSummaryGroups,
  formatOccurrenceMessage,
  formatSummaryMemberToken,
  OCCURRENCE_EMPTY_SLOT_LABEL,
} from "./occurrenceSummary";
import {
  capScheduleColumnLabelForSizing,
  getAssignmentCellContentLabel,
  getScheduleAxisHighlight,
  pickLongestLabel,
  scheduleAxisHighlightClassName,
  scheduleCellPaddingClassName,
  type ScheduleFocusedCell,
  type ScheduleGridLayout,
  scheduleDateColumnClassName,
  scheduleGridBottomBorderClassName,
  scheduleGridLeftBorderClassName,
  scheduleGridRightBorderClassName,
  scheduleGridTopBorderClassName,
  scheduleOccurrenceHeaderHighlightClassName,
  schedulePositionColumnClassName,
  scheduleStickyPositionColumnClassName,
  scheduleStickyPositionLabelClassName,
  scheduleRowTone,
  scheduleServiceHeaderBottomBorderClassName,
  scheduleServiceHeaderLeftBorderClassName,
  scheduleServiceHeaderTopBorderClassName,
  scheduleGridCellKey,
  scheduleStickyRowTone,
  serviceHeaderRowTone,
  toScheduleColumnMinCh,
  toSchedulePositionColumnMinCh,
} from "./scheduleUtils";
import type { TeamSchedulePayload } from "../../../api/auth";

// Temporarily hidden. The "Paste from Excel" row-import flow is built, tested, and
// wired, but held back from operators for now. Flip to true to re-enable the
// toolbar entry point (see SchedulePasteRowDialog + schedulePasteRow).
const SHOW_PASTE_FROM_EXCEL = false;

// Paces the auto-fill reveal animation (see commitAutoFillAssignments).
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type ScheduleAssignmentSwapPlan = ScheduleAssignmentSwapRecommendation & {
  serviceId: string;
  serviceDate: string;
  targetCellKey: string;
  targetPositionId: string;
  sourceCellKey: string;
  sourcePositionId: string;
  currentMemberId: string;
};

type PendingCrossTeamConflict = {
  memberId: string;
  warning: string;
  fingerprint: string;
  conflicts: Array<{
    memberId: string;
    scheduleId: string;
    scheduleName?: string;
    teamId?: string;
    occurrenceId: string;
    conflictingOccurrenceId?: string;
    cellKeys?: string[];
  }>;
  isMove?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
};

type OccurrenceConflictDetails = Pick<PendingCrossTeamConflict, "fingerprint" | "conflicts">;

type ScheduleFormState =
  | { mode: "edit"; scheduleId: string }
  | { mode: "create-custom" }
  | { mode: "copy"; sourceScheduleId: string; sourceSchedule: TeamSchedule };

const getOccurrenceConflictDetails = (error: unknown): OccurrenceConflictDetails | null => {
  const details = (error as { details?: unknown } | null)?.details;
  if (!details || typeof details !== "object") return null;
  const payload = details as { conflictFingerprint?: unknown; occurrenceConflicts?: unknown };
  if (typeof payload.conflictFingerprint !== "string" || !Array.isArray(payload.occurrenceConflicts)) return null;
  return {
    fingerprint: payload.conflictFingerprint,
    conflicts: payload.occurrenceConflicts as PendingCrossTeamConflict["conflicts"],
  };
};

type ScheduleCellMapField = "assignments" | "microphoneAssignments" | "iemAssignments";
type PositionSlotSaveOutcome = "saved" | "failed" | "cancelled";
type PendingPositionSlotSave = {
  promise: Promise<PositionSlotSaveOutcome>;
  outcome: PositionSlotSaveOutcome | "saving";
  resolve: (outcome: PositionSlotSaveOutcome) => void;
  retry: () => Promise<PositionSlotSaveOutcome>;
};
const wasPositionSlotSaveCancelled = (save: PendingPositionSlotSave) =>
  save.outcome === "cancelled";

export type PendingScheduleCellEdit = {
  churchId: string;
  scheduleId: string;
  field: ScheduleCellMapField;
  occurrenceId: string;
  cellKey: string;
  value: unknown;
  sequence: number;
};

const scheduleCellEditKey = (
  churchId: string,
  scheduleId: string,
  field: ScheduleCellMapField,
  occurrenceId: string,
  cellKey: string,
) => JSON.stringify([churchId, scheduleId, field, occurrenceId, cellKey]);

const schedulePositionSlotSaveKey = (
  churchId: string,
  scheduleId: string,
  occurrenceId: string,
  cellKey: string,
) => JSON.stringify([churchId, scheduleId, occurrenceId, cellKey]);

const setScheduleCellMapValue = (
  schedule: TeamSchedule,
  field: ScheduleCellMapField,
  occurrenceId: string,
  cellKey: string,
  value: unknown,
): TeamSchedule => {
  const scheduleRecord = schedule as unknown as Record<string, unknown>;
  const map = {
    ...((scheduleRecord[field] || {}) as Record<string, Record<string, unknown>>),
  };
  const row = { ...(map[occurrenceId] || {}) };
  const shouldStore = field === "assignments"
    ? Boolean(value)
    : Array.isArray(value) && value.length > 0;
  if (shouldStore) row[cellKey] = value;
  else delete row[cellKey];
  if (Object.keys(row).length > 0) map[occurrenceId] = row;
  else delete map[occurrenceId];
  return { ...schedule, [field]: map };
};

export const applyPendingScheduleCellEdits = (
  schedule: TeamSchedule,
  pending: Iterable<PendingScheduleCellEdit>,
) => [...pending].reduce(
  (current, edit) => edit.churchId === schedule.churchId && edit.scheduleId === schedule.scheduleId
    ? setScheduleCellMapValue(current, edit.field, edit.occurrenceId, edit.cellKey, edit.value)
    : current,
  schedule,
);

const virtualSchedulePreviewKey = (churchId: string, scheduleId: string) =>
  JSON.stringify([churchId, scheduleId]);

type PendingAvailabilityConfirmation = {
  memberId: string;
  kind: "blockout" | "recurringAvailability";
  isMove?: boolean;
  onConfirm: () => void;
};

const ScheduleTab = ({
  data,
  serviceTimeZone,
  canEdit: canEditSelectedSchedule,
  editableTeamIds,
  canEditMember,
  onEditMember,
  selectedScheduleId,
  setSelectedScheduleId,
  scheduleDrafts,
  onScheduleSaved,
  onScheduleRemoved,
  onMemberSaved,
  onTeamSaved,
  onScheduleDraftChanged,
  onScheduleDraftFlush,
  onScheduleDraftClear,
  trackTeamsSave,
  onImported,
}: {
  data: TeamsData;
  serviceTimeZone: string;
  canEdit: boolean;
  /** Teams this user can edit, used to default the team filter. */
  editableTeamIds?: Set<string>;
  canEditMember?: (member: TeamRosterMember) => boolean;
  onEditMember?: (memberId: string, returnTo: TeamsReturnTo) => void;
  selectedScheduleId: string;
  setSelectedScheduleId: (scheduleId: string, hydrate?: boolean) => void;
  scheduleDrafts: TeamsScheduleDrafts;
  onScheduleSaved: (schedule: TeamSchedule, replaceId?: string) => void;
  onScheduleRemoved: (scheduleId: string) => void;
  onMemberSaved: (member: TeamRosterMember, replaceId?: string) => void;
  onTeamSaved: (team: TeamRecord, replaceId?: string) => void;
  onScheduleDraftChanged: (draftKey: string, draft: TeamSchedulePayload) => void;
  onScheduleDraftFlush: (draftKey: string, draft: TeamSchedulePayload) => void;
  /** Clears an intent-specific draft key after a successful create. */
  onScheduleDraftClear: (draftKey: string) => void;
  // Registers an in-flight schedule save with the page so inbound sync stays
  // gated until it settles (prevents a bootstrap/SSE from reverting pending edits).
  trackTeamsSave: <T>(run: Promise<T>) => Promise<T>;
  onImported: () => void | Promise<void>;
}) => {
  const context = useContext(GlobalInfoContext);
  const { showToast, removeToast } = useToast();
  const churchId = context?.churchId || "";
  const isChurchAdmin = context?.role === "admin";
  const churchName = context?.churchName || "";
  const activeTeams = useMemo(() => data.teams.filter(isActive), [data.teams]);
  const schedules = data.schedules;
  const [viewingSavedSchedule, setViewingSavedSchedule] = useState(false);
  // Archived schedules stay out of the quick-switcher; the browse dialog's
  // status filter is the one place to go through everything.
  const [isBrowsingSchedules, setIsBrowsingSchedules] = useState(false);
  const [scheduleImportOpen, setScheduleImportOpen] = useState(false);
  const [scheduleCsvBusy, setScheduleCsvBusy] = useState(false);

  // Team narrowing for the picker, remembered per church. Most operators work a
  // single team, so re-narrowing a church-wide list on every visit is friction.
  // "" means every team; the stored sentinel distinguishes a deliberate "All
  // teams" from "nothing chosen yet", which is what lets the default below
  // apply only once.
  const [scheduleTeamFilter, setScheduleTeamFilter] = useState<string | null>(
    () => {
      const stored = churchId ? readScheduleTeamFilter(churchId) : null;
      if (stored) return stored === ALL_TEAMS_SCHEDULE_FILTER ? "" : stored;
      const editable = [...(editableTeamIds || [])];
      return editable.length === 1 ? editable[0] : "";
    },
  );
  useEffect(() => {
    if (!churchId) return;
    const stored = readScheduleTeamFilter(churchId);
    if (stored) {
      setScheduleTeamFilter(stored === ALL_TEAMS_SCHEDULE_FILTER ? "" : stored);
      return;
    }
    // No saved choice: narrow for someone scoped to exactly one team, otherwise
    // show everything.
    const editable = [...(editableTeamIds || [])];
    setScheduleTeamFilter(editable.length === 1 ? editable[0] : "");
  }, [churchId, editableTeamIds]);

  const updateScheduleTeamFilter = useCallback(
    (teamId: string) => {
      setScheduleTeamFilter(teamId);
      setPeriodScheduleSelection(null);
      setViewingSavedSchedule(false);
      writeScheduleTeamFilter(churchId, teamId || ALL_TEAMS_SCHEDULE_FILTER);
    },
    [churchId],
  );

  // Create-form defaults: prefer the schedule team filter, else first editable
  // active team, else first active team. Range/services follow that team.
  const defaultTeamId = useMemo(() => {
    if (
      scheduleTeamFilter &&
      activeTeams.some((team) => team.teamId === scheduleTeamFilter)
    ) {
      return scheduleTeamFilter;
    }
    const firstEditable = activeTeams.find((team) =>
      editableTeamIds?.has(team.teamId),
    );
    return firstEditable?.teamId || activeTeams[0]?.teamId || "";
  }, [activeTeams, editableTeamIds, scheduleTeamFilter]);
  const workspaceTeamId = (scheduleTeamFilter || defaultTeamId) ?? "";
  const activeServices = useMemo(() => data.services.filter(isActive), [data.services]);
  const { initialTeamPeriodResult, periodReferenceTime } = useMemo(() => {
    const referenceTime = serverDate();
    return {
      initialTeamPeriodResult: findInitialTeamSchedulePeriod({
        services: activeServices,
        positions: data.positions,
        teamId: workspaceTeamId,
        schedules: data.schedules,
        now: referenceTime,
        timeZone: serviceTimeZone,
      }),
      periodReferenceTime: referenceTime,
    };
  },
    [activeServices, data.positions, data.schedules, serviceTimeZone, workspaceTeamId],
  );
  const initialPeriodRange = useMemo(() => ({
    start: initialTeamPeriodResult.start,
    end: initialTeamPeriodResult.end,
  }), [initialTeamPeriodResult.end, initialTeamPeriodResult.start]);
  const resolveSchedulePresetRange = useCallback(
    (
      preset: Exclude<SchedulePeriodPreset, "upcoming" | "custom">,
      referenceTime: Date,
    ) => resolveRangePreset(preset, referenceTime),
    [],
  );
  const {
    preset: periodPreset,
    range: periodRange,
    selectPreset: selectRangePreset,
    selectCustomRange,
    setSelection: setPeriodSelection,
  } = useRangeSelection({
    now: periodReferenceTime,
    initialPreset: initialTeamPeriodResult.preset,
    initialRange: initialPeriodRange,
    resolvePresetRange: resolveSchedulePresetRange,
    resolveUpcomingRange: () => initialPeriodRange,
  });
  const [periodScheduleSelection, setPeriodScheduleSelection] = useState<{
    scope: string;
    scheduleId: string;
  } | null>(null);
  const periodSelectionScope = `${workspaceTeamId}:${periodPreset}:${periodRange.start}:${periodRange.end}`;
  const hasExplicitPeriodSelectionRef = useRef(false);
  const periodTeamIdRef = useRef(workspaceTeamId);
  useEffect(() => {
    if (periodTeamIdRef.current !== workspaceTeamId) {
      periodTeamIdRef.current = workspaceTeamId;
      hasExplicitPeriodSelectionRef.current = false;
    }
    if (hasExplicitPeriodSelectionRef.current) return;
    setPeriodSelection(initialTeamPeriodResult.preset, initialPeriodRange);
  }, [initialPeriodRange, initialTeamPeriodResult.preset, setPeriodSelection, workspaceTeamId]);
  const canEdit = viewingSavedSchedule
    ? canEditSelectedSchedule
    : Boolean(
      (workspaceTeamId && editableTeamIds?.has(workspaceTeamId)) ||
      (!editableTeamIds && canEditSelectedSchedule),
    );
  const persistedPeriodRange = periodRange;
  const teamPeriod = useMemo(
    () => buildTeamSchedulePeriod({
      services: activeServices,
      positions: data.positions,
      teamId: workspaceTeamId,
      startDate: persistedPeriodRange.start,
      endDate: persistedPeriodRange.end,
      timeZone: serviceTimeZone,
    }),
    [activeServices, data.positions, persistedPeriodRange.end, persistedPeriodRange.start, serviceTimeZone, workspaceTeamId],
  );
  const periodServiceIds = teamPeriod.serviceIds;
  const generatedPeriodOccurrences = useMemo(
    () => filterOccurrencesToRange(teamPeriod.occurrences, periodRange, serviceTimeZone),
    [periodRange, serviceTimeZone, teamPeriod.occurrences],
  );
  const operatorSelectedPeriodScheduleId = periodScheduleSelection?.scope === periodSelectionScope
    ? periodScheduleSelection.scheduleId
    : undefined;
  const periodScheduleMatch = useMemo(() => findReusablePeriodSchedule({
    schedules,
    churchId,
    teamId: workspaceTeamId,
    occurrences: generatedPeriodOccurrences,
    visibleStartDate: periodRange.start,
    visibleEndDate: periodRange.end,
    timeZone: serviceTimeZone,
    operatorSelectedScheduleId: operatorSelectedPeriodScheduleId,
  }), [
    churchId,
    generatedPeriodOccurrences,
    periodRange.end,
    periodRange.start,
    operatorSelectedPeriodScheduleId,
    schedules,
    serviceTimeZone,
    workspaceTeamId,
  ]);
  const matchedPeriodSchedule = periodScheduleMatch.schedule;
  const overlappingPeriodSchedules = useMemo(() => viewingSavedSchedule
    ? []
    : findOverlappingPeriodSchedules({
      schedules,
      churchId,
      teamId: workspaceTeamId,
      range: periodRange,
    }), [churchId, periodRange, schedules, viewingSavedSchedule, workspaceTeamId]);
  const explicitlySelectedPeriodSchedule = periodScheduleSelection?.scope === periodSelectionScope
    ? overlappingPeriodSchedules.find((schedule) => schedule.scheduleId === periodScheduleSelection.scheduleId) || null
    : null;
  const preferredPeriodSchedule = matchedPeriodSchedule;
  const virtualPeriodSchedule = useMemo(() => {
    if (
      !workspaceTeamId ||
      generatedPeriodOccurrences.length === 0
    ) {
      return null;
    }
    return {
      scheduleId: `virtual:${workspaceTeamId}:${persistedPeriodRange.start}:${persistedPeriodRange.end}`,
      churchId,
      name: formatSchedulePeriodName(persistedPeriodRange.start, persistedPeriodRange.end),
      teamId: workspaceTeamId,
      startDate: persistedPeriodRange.start,
      endDate: persistedPeriodRange.end,
      serviceIds: periodServiceIds,
      occurrences: generatedPeriodOccurrences,
      assignments: {},
      guests: [],
      source: "generated-period" as const,
    };
  }, [
    churchId,
    generatedPeriodOccurrences,
    persistedPeriodRange.end,
    persistedPeriodRange.start,
    periodServiceIds,
    workspaceTeamId,
  ]);
  const periodScheduleChoices = useMemo(() => {
    if (matchedPeriodSchedule || !virtualPeriodSchedule) return overlappingPeriodSchedules;
    return [virtualPeriodSchedule, ...overlappingPeriodSchedules];
  }, [matchedPeriodSchedule, overlappingPeriodSchedules, virtualPeriodSchedule]);
  // Normal navigation is occurrence-first. Saved schedule history is opened
  // only by an explicit history/deep-link action.
  const selectedScheduleRecord = viewingSavedSchedule
    ? schedules.find((schedule) => schedule.scheduleId === selectedScheduleId) || null
    : explicitlySelectedPeriodSchedule || preferredPeriodSchedule || virtualPeriodSchedule;
  const displayedPeriodRange = useMemo(() => resolveDisplayedPeriodRange({
    preset: periodPreset,
    selectedRange: periodRange,
    scheduleRange: selectedScheduleRecord?.startDate && selectedScheduleRecord.endDate
      ? { start: selectedScheduleRecord.startDate, end: selectedScheduleRecord.endDate }
      : null,
    viewingSavedSchedule,
  }), [periodPreset, periodRange, selectedScheduleRecord?.endDate, selectedScheduleRecord?.startDate, viewingSavedSchedule]);
  useEffect(() => {
    if (viewingSavedSchedule) return;
    const nextId = (explicitlySelectedPeriodSchedule || preferredPeriodSchedule)?.scheduleId || "";
    if (selectedScheduleId !== nextId) setSelectedScheduleId(nextId, Boolean(nextId));
  }, [explicitlySelectedPeriodSchedule, preferredPeriodSchedule, selectedScheduleId, setSelectedScheduleId, viewingSavedSchedule]);
  const [virtualSchedulePreviews, setVirtualSchedulePreviews] = useState<Map<string, TeamSchedule>>(
    () => new Map(),
  );
  const virtualSchedulePreviewsRef = useRef(virtualSchedulePreviews);
  useLayoutEffect(() => { virtualSchedulePreviewsRef.current = virtualSchedulePreviews; }, [virtualSchedulePreviews]);
  const pendingScheduleCellEditsRef = useRef(new Map<string, PendingScheduleCellEdit>());
  const scheduleCellEditSequenceRef = useRef(0);
  const selectedSchedulePreview = selectedScheduleRecord
    ? virtualSchedulePreviews.get(virtualSchedulePreviewKey(churchId, selectedScheduleRecord.scheduleId))
    : undefined;
  const selectedScheduleSource = selectedSchedulePreview || selectedScheduleRecord;
  const selectedSchedule = isHydratedSchedule(selectedScheduleSource)
    ? applyPendingScheduleCellEdits(
      selectedScheduleSource as TeamSchedule,
      pendingScheduleCellEditsRef.current.values(),
    )
    : null;
  const latestScheduleRef = useRef(selectedSchedule);
  const schedulesByOwnerRef = useRef(new Map<string, TeamSchedule>());
  useEffect(() => {
    latestScheduleRef.current = selectedSchedule;
    if (selectedSchedule) {
      schedulesByOwnerRef.current.set(
        virtualSchedulePreviewKey(selectedSchedule.churchId, selectedSchedule.scheduleId),
        selectedSchedule,
      );
    }
  }, [selectedSchedule]);
  const scheduleTabMountedRef = useRef(true);
  useEffect(() => {
    scheduleTabMountedRef.current = true;
    return () => { scheduleTabMountedRef.current = false; };
  }, []);
  const updateVirtualSchedulePreview = useCallback((schedule: TeamSchedule | null, scheduleId?: string) => {
    const key = virtualSchedulePreviewKey(schedule?.churchId || churchId, schedule?.scheduleId || scheduleId || "");
    const next = new Map(virtualSchedulePreviewsRef.current);
    if (schedule) next.set(key, schedule);
    else next.delete(key);
    virtualSchedulePreviewsRef.current = next;
    if (scheduleTabMountedRef.current) setVirtualSchedulePreviews(next);
  }, [churchId]);
  const publishScheduleSnapshot = useCallback((
    incoming: TeamSchedule,
    fields?: Array<keyof TeamSchedule>,
    replaceId?: string,
  ) => {
    const ownerKey = virtualSchedulePreviewKey(incoming.churchId, incoming.scheduleId);
    const active = latestScheduleRef.current;
    const current = active?.scheduleId === incoming.scheduleId && active.churchId === incoming.churchId
      ? active
      : schedulesByOwnerRef.current.get(ownerKey) || null;
    const sameOwner = current?.scheduleId === incoming.scheduleId && current.churchId === incoming.churchId;
    const merged = sameOwner ? { ...current } : { ...incoming };
    if (sameOwner) {
      if (fields) {
        fields.forEach((field) => {
          (merged as unknown as Record<string, unknown>)[field] =
            (incoming as unknown as Record<string, unknown>)[field];
        });
      } else {
        Object.assign(merged, incoming);
      }
    }
    const withPendingEdits = applyPendingScheduleCellEdits(
      merged,
      pendingScheduleCellEditsRef.current.values(),
    );
    if (incoming.scheduleId.startsWith("virtual:")) {
      updateVirtualSchedulePreview(withPendingEdits);
    } else {
      schedulesByOwnerRef.current.set(ownerKey, withPendingEdits);
      if (activeChurchIdRef.current === incoming.churchId) {
        onScheduleSaved(withPendingEdits, replaceId);
      }
    }
    if (
      activeChurchIdRef.current === incoming.churchId &&
      activeScheduleIdRef.current === incoming.scheduleId
    ) latestScheduleRef.current = withPendingEdits;
    return withPendingEdits;
  }, [onScheduleSaved, updateVirtualSchedulePreview]);
  const publishScheduleCellResponses = useCallback((
    incoming: TeamSchedule,
    field: ScheduleCellMapField,
    cells: Array<{ occurrenceId: string; cellKey: string }>,
  ) => {
    const ownerKey = virtualSchedulePreviewKey(incoming.churchId, incoming.scheduleId);
    const active = latestScheduleRef.current;
    const current = active?.scheduleId === incoming.scheduleId && active.churchId === incoming.churchId
      ? active
      : schedulesByOwnerRef.current.get(ownerKey) || incoming;
    const incomingMap = (incoming as unknown as Record<string, unknown>)[field] as
      | Record<string, Record<string, unknown>>
      | undefined;
    const merged = cells.reduce(
      (schedule, cell) => setScheduleCellMapValue(
        schedule,
        field,
        cell.occurrenceId,
        cell.cellKey,
        incomingMap?.[cell.occurrenceId]?.[cell.cellKey],
      ),
      current,
    );
    return publishScheduleSnapshot(merged, [field]);
  }, [publishScheduleSnapshot]);
  const activeChurchIdRef = useRef(churchId);
  useLayoutEffect(() => { activeChurchIdRef.current = churchId; }, [churchId]);
  const activeScheduleIdRef = useRef(selectedScheduleRecord?.scheduleId || "");
  useLayoutEffect(() => {
    activeScheduleIdRef.current = selectedScheduleRecord?.scheduleId || "";
  }, [selectedScheduleRecord?.scheduleId]);
  const confirmedPeriodReconciliationRef = useRef<string | null>(null);
  const pendingScheduleEnsuresRef = useRef(new Map<string, Promise<TeamSchedule | null>>());
  const periodOccurrenceSignature = generatedPeriodOccurrences.map((occurrence) =>
    JSON.stringify([
      occurrence.logicalOccurrenceId || occurrence.occurrenceId,
      occurrence.occurrenceId,
      occurrence.groupId || "",
      [...(occurrence.serviceIds || [occurrence.serviceId])].sort(),
      occurrence.serviceDate || "",
      occurrence.startsAt,
      [...(occurrence.positionRequirements || [])]
        .map(({ positionId, count, minLevelId }) => [positionId, count, minLevelId || ""])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ]),
  ).sort().join("|");
  const serviceDefinitionSignature = activeServices.map((service) => JSON.stringify([
    service.serviceId,
    service.reccurence,
    service.time || "",
    service.dateTimeISO || "",
    service.dayOfWeek ?? "",
    [...(service.daysOfWeek || [])].map(({ day, time }) => [day, time]).sort(),
    service.startDateISO || "",
    service.endDateISO || "",
    service.ordinal ?? "",
    service.weekday ?? "",
    service.serviceGroupId || "",
    [...(service.positionRequirements || [])]
      .map(({ positionId, count, minLevelId }) => [positionId, count, minLevelId || ""])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  ])).sort().join("|");
  const scheduleOccurrenceSignature = (occurrences: TeamScheduleOccurrence[] = []) => occurrences
    .map((occurrence) => JSON.stringify([
      occurrence.logicalOccurrenceId || occurrence.occurrenceId,
      occurrence.occurrenceId,
      occurrence.groupId || "",
      [...(occurrence.serviceIds || [occurrence.serviceId])].sort(),
      occurrence.serviceDate || "",
      occurrence.startsAt,
      [...(occurrence.positionRequirements || [])]
        .map(({ positionId, count, minLevelId }) => [positionId, count, minLevelId || ""])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ]))
    .sort()
    .join("|");
  const makePeriodReconciliationKey = useCallback((
    scheduleId: string,
    occurrences: TeamScheduleOccurrence[] = selectedScheduleRecord?.occurrences || [],
    scheduleMetadata?: Pick<TeamSchedule, "scheduleId" | "churchId" | "teamId" | "startDate" | "endDate" | "archivedAt" | "source" | "generatedPeriodKey" | "occurrences">,
  ) => {
    const activeSchedule = scheduleMetadata || schedules.find((schedule) => schedule.scheduleId === scheduleId);
    const ownershipEntry = (schedule: {
      scheduleId: string;
      churchId: string;
      teamId: string;
      startDate?: string;
      endDate?: string;
      archivedAt?: string | null;
      source?: string;
      generatedPeriodKey?: string;
      occurrences?: TeamScheduleOccurrence[];
    }) => JSON.stringify([
      schedule.scheduleId,
      schedule.churchId,
      schedule.teamId,
      schedule.startDate || "",
      schedule.endDate || "",
      schedule.archivedAt || "",
      schedule.source || "",
      schedule.generatedPeriodKey || "",
      (schedule.occurrences || []).map((occurrence) =>
        [occurrence.logicalOccurrenceId || occurrence.occurrenceId, occurrence.occurrenceId],
      ).sort(),
    ]);
    const ownershipSignature = schedules
      .filter((schedule) =>
        !schedule.archivedAt &&
        schedule.churchId === churchId &&
        schedule.teamId === workspaceTeamId &&
        schedule.startDate && schedule.endDate &&
        schedule.startDate <= periodRange.end && schedule.endDate >= periodRange.start &&
        schedule.scheduleId !== scheduleId,
      )
      .map(ownershipEntry)
      .sort()
      .join("|");
    return JSON.stringify([
    churchId,
    workspaceTeamId,
    periodRange.start,
    periodRange.end,
    scheduleId,
    activeSchedule ? ownershipEntry(activeSchedule) : "",
    periodOccurrenceSignature,
    serviceDefinitionSignature,
    scheduleOccurrenceSignature(occurrences),
    ownershipSignature,
    serviceTimeZone,
    ]);
  }, [
    churchId,
    periodRange.end,
    periodRange.start,
    periodOccurrenceSignature,
    schedules,
    selectedScheduleRecord?.occurrences,
    serviceDefinitionSignature,
    serviceTimeZone,
    workspaceTeamId,
  ]);
  const periodReconciliationKey = makePeriodReconciliationKey(
    selectedScheduleRecord?.scheduleId || "virtual",
    selectedScheduleRecord?.occurrences || [],
    selectedScheduleRecord || virtualPeriodSchedule || undefined,
  );
  const ensureActiveSchedule = useCallback(async (
    requestedSchedule?: TeamSchedule | null,
  ): Promise<TeamSchedule | null> => {
    const active = requestedSchedule || latestScheduleRef.current;
    if (!active) throw new Error("Choose a service period before scheduling.");
    if (!active.scheduleId.startsWith("virtual:") && viewingSavedSchedule) return active;
    const requestKey = makePeriodReconciliationKey(active.scheduleId, active.occurrences || [], active);
    if (
      !active.scheduleId.startsWith("virtual:") &&
      confirmedPeriodReconciliationRef.current === requestKey
    ) return active;
    if (!churchId) throw new Error("Church information is unavailable.");
    const pending = pendingScheduleEnsuresRef.current.get(requestKey);
    if (pending) return pending;
    const request = Promise.resolve().then(async () => {
        try {
          const result = await trackTeamsSave(ensureTeamScheduleForPeriod(churchId, {
            name: formatSuggestedScheduleName(persistedPeriodRange.start, persistedPeriodRange.end),
            teamId: workspaceTeamId,
            startDate: persistedPeriodRange.start,
            endDate: persistedPeriodRange.end,
            serviceIds: periodServiceIds,
            occurrences: teamPeriod.occurrences,
            visibleStartDate: periodRange.start,
            visibleEndDate: periodRange.end,
            ...(operatorSelectedPeriodScheduleId
              ? { operatorSelectedScheduleId: operatorSelectedPeriodScheduleId }
              : {}),
            visibleOccurrenceIds: generatedPeriodOccurrences.map((occurrence) => occurrence.occurrenceId),
            timeZone: serviceTimeZone,
          }));
          const wasPersisted = !active.scheduleId.startsWith("virtual:");
          const addedOccurrences = wasPersisted
            ? (result.schedule.occurrences || []).filter((occurrence) =>
              !(active.occurrences || []).some((saved) => saved.occurrenceId === occurrence.occurrenceId),
            ).length
            : 0;
          let schedule = result.schedule;
          if (active.scheduleId.startsWith("virtual:")) {
            const previewKey = virtualSchedulePreviewKey(churchId, active.scheduleId);
            const preview = virtualSchedulePreviewsRef.current.get(previewKey) || active;
            const remappedPending = new Map(pendingScheduleCellEditsRef.current);
            for (const [key, edit] of remappedPending) {
              if (edit.churchId !== churchId || edit.scheduleId !== active.scheduleId) continue;
              remappedPending.delete(key);
              const remappedEdit = { ...edit, scheduleId: schedule.scheduleId };
              remappedPending.set(scheduleCellEditKey(
                remappedEdit.churchId,
                remappedEdit.scheduleId,
                remappedEdit.field,
                remappedEdit.occurrenceId,
                remappedEdit.cellKey,
              ), remappedEdit);
            }
            pendingScheduleCellEditsRef.current = remappedPending;
            schedule = applyPendingScheduleCellEdits(schedule, remappedPending.values());
            updateVirtualSchedulePreview(null, active.scheduleId);
            if (preview.guests?.length && !schedule.guests?.length) {
              schedule = { ...schedule, guests: preview.guests };
            }
          }
          if (activeChurchIdRef.current === churchId) {
            publishScheduleSnapshot(
              schedule,
              undefined,
              active.scheduleId.startsWith("virtual:") ? active.scheduleId : undefined,
            );
          }
          if (activeChurchIdRef.current === churchId && activeScheduleIdRef.current === active.scheduleId) {
            latestScheduleRef.current = schedule;
            setSelectedScheduleId(schedule.scheduleId);
            if (active.scheduleId.startsWith("virtual:")) setViewingSavedSchedule(false);
          }
          if (
            activeChurchIdRef.current === churchId &&
            activeScheduleIdRef.current === active.scheduleId
          ) {
            confirmedPeriodReconciliationRef.current = makePeriodReconciliationKey(
              schedule.scheduleId,
              schedule.occurrences || [],
              schedule,
            );
          }
          if (addedOccurrences > 0 && activeChurchIdRef.current === churchId) {
            showToast(
              `${addedOccurrences} ${addedOccurrences === 1 ? "service" : "services"} added to ${schedule.name}.`,
              "success",
            );
          }
          return schedule;
        } finally {
          if (pendingScheduleEnsuresRef.current.get(requestKey) === request) {
            pendingScheduleEnsuresRef.current.delete(requestKey);
          }
        }
      });
    pendingScheduleEnsuresRef.current.set(requestKey, request);
    return request;
  }, [
    churchId,
    generatedPeriodOccurrences,
    makePeriodReconciliationKey,
    teamPeriod.occurrences,
    publishScheduleSnapshot,
    persistedPeriodRange.end,
    persistedPeriodRange.start,
    periodRange.end,
    periodRange.start,
    periodServiceIds,
    operatorSelectedPeriodScheduleId,
    setSelectedScheduleId,
    serviceTimeZone,
    showToast,
    trackTeamsSave,
    updateVirtualSchedulePreview,
    viewingSavedSchedule,
    workspaceTeamId,
  ]);
  useEffect(() => {
    if (
      !canEdit ||
      viewingSavedSchedule ||
      !selectedSchedule ||
      selectedSchedule.scheduleId.startsWith("virtual:") ||
      periodScheduleMatch.schedule?.scheduleId !== selectedSchedule.scheduleId ||
      periodScheduleMatch.ambiguous ||
      periodScheduleMatch.ownershipConflict ||
      generatedPeriodOccurrences.length === 0 ||
      confirmedPeriodReconciliationRef.current === periodReconciliationKey
    ) return;
    let active = true;
    const offerRetry = () => {
      if (!active) return;
      let toastId = "";
      toastId = showToast({
        message: "Couldn't check this schedule for newly added services. Retry to refresh the schedule.",
        variant: "error",
        persist: true,
        children: (
          <div className="mt-2 flex justify-center">
            <Button variant="primary" className="text-sm" onClick={() => {
              removeToast(toastId);
              void ensureActiveSchedule(selectedSchedule).catch(offerRetry);
            }}>Retry</Button>
          </div>
        ),
      });
    };
    void ensureActiveSchedule(selectedSchedule).catch(offerRetry);
    return () => { active = false; };
  }, [
    canEdit,
    ensureActiveSchedule,
    generatedPeriodOccurrences.length,
    periodReconciliationKey,
    periodScheduleMatch.schedule?.scheduleId,
    periodScheduleMatch.ambiguous,
    periodScheduleMatch.ownershipConflict,
    selectedSchedule,
    removeToast,
    showToast,
    viewingSavedSchedule,
  ]);
  const scheduleDisplayMembers = useMemo(
    () => [
      ...data.members,
      ...(selectedSchedule?.guests || []).map((guest) => scheduleGuestToDisplayMember(guest, churchId)),
    ],
    [churchId, data.members, selectedSchedule?.guests],
  );
  const recentScheduleGuests = useMemo(() => {
    const byId = new Map<string, TeamScheduleGuest>();
    const newestFirst = [...schedules].sort((left, right) =>
      String(right.startDate || "").localeCompare(String(left.startDate || "")),
    );
    [selectedScheduleRecord, ...newestFirst].forEach((schedule) => {
      (schedule?.guests || []).forEach((guest) => {
        if (!byId.has(guest.guestId)) byId.set(guest.guestId, guest);
      });
    });
    return [...byId.values()];
  }, [schedules, selectedScheduleRecord]);
  const editableScheduleGuestIds = useMemo(
    () => new Set((selectedSchedule?.guests || []).map((guest) => guest.guestId)),
    [selectedSchedule?.guests],
  );
  const isSelectedScheduleLoading = Boolean(selectedScheduleRecord && !selectedSchedule);
  const scheduleDraftKey = selectedScheduleRecord?.scheduleId || "new";
  const [formState, setFormState] = useState<ScheduleFormState | null>(null);
  const showForm = formState !== null;
  const selectedTeam = data.teams.find((team) => team.teamId === selectedScheduleRecord?.teamId) || null;
  const defaultRange = useMemo(
    () =>
      getCreateScheduleDefaultRange({
        churchId,
        teamId: defaultTeamId,
        services: data.services,
        positions: data.positions,
        schedules: data.schedules,
        timeZone: serviceTimeZone,
      }),
    [churchId, data.positions, data.schedules, data.services, defaultTeamId, serviceTimeZone],
  );
  const defaultServiceIds = useMemo(
    () =>
      getCreateScheduleDefaultServiceIds({
        teamId: defaultTeamId,
        schedules: data.schedules,
        services: data.services,
        range: defaultRange,
        timeZone: serviceTimeZone,
      }),
    [data.schedules, data.services, defaultRange, defaultTeamId, serviceTimeZone],
  );

  const selectPeriodPreset = (preset: SchedulePeriodPreset) => {
    hasExplicitPeriodSelectionRef.current = true;
    setPeriodScheduleSelection(null);
    selectRangePreset(preset);
    setViewingSavedSchedule(false);
  };
  const shiftPeriod = (direction: -1 | 1) => {
    hasExplicitPeriodSelectionRef.current = true;
    setPeriodScheduleSelection(null);
    setPeriodSelection("custom", shiftRange(periodPreset, displayedPeriodRange, direction));
    setViewingSavedSchedule(false);
  };

  // Positions are owned by a team, so a schedule's positions are the team's own positions.
  const schedulePositions = useMemo(
    () =>
      selectedTeam
        ? data.positions.filter((position) => position.teamId === selectedTeam.teamId)
        : ([] as TeamPosition[]),
    [data.positions, selectedTeam],
  );
  const teamPositionIds = useMemo(
    () => schedulePositions.map((position) => position.positionId),
    [schedulePositions],
  );
  const serviceById = useMemo(
    () => new Map(data.services.map((service) => [service.serviceId, service])),
    [data.services],
  );
  // Stable placeholder for dateless services in legacy schedules that carry no
  // occurrences and no date range. Computed once so it never drifts as the memo
  // below recomputes on data refreshes.
  const fallbackStartsAt = useMemo(() => serverDate().toISOString(), []);
  // What occurrences this schedule's services + date range produce now. The
  // stable identity is compared separately from current scheduled details.
  const regeneratedOccurrences = useMemo(() => {
    if (
      !selectedSchedule?.startDate ||
      !selectedSchedule?.endDate ||
      selectedSchedule.scheduleId.startsWith("virtual:")
    ) return null;
    return generateScheduleOccurrences({
      services: data.services,
      serviceIds: selectedSchedule.serviceIds || [],
      startDate: selectedSchedule.startDate,
      endDate: selectedSchedule.endDate,
      timeZone: serviceTimeZone,
    });
  }, [data.services, selectedSchedule, serviceTimeZone]);
  const baseScheduleOccurrences = useMemo(() => {
    if (selectedSchedule?.occurrences?.length) {
      if (viewingSavedSchedule) return selectedSchedule.occurrences;
      const currentScheduleOccurrences = selectedSchedule.startDate && selectedSchedule.endDate
        ? filterOccurrencesToRange(generatedPeriodOccurrences, {
            start: selectedSchedule.startDate,
            end: selectedSchedule.endDate,
          }, serviceTimeZone)
        : [];
      return mergeCurrentScheduleOccurrences(
        selectedSchedule.occurrences,
        currentScheduleOccurrences,
        serviceTimeZone,
        schedules.filter((schedule) =>
          schedule.scheduleId !== selectedSchedule.scheduleId &&
          schedule.churchId === selectedSchedule.churchId &&
          schedule.teamId === selectedSchedule.teamId,
        ),
      ).occurrences;
    }
    if (regeneratedOccurrences) return regeneratedOccurrences;
    return (selectedSchedule?.serviceIds || [])
      .map((serviceId) => {
        const service = serviceById.get(serviceId);
        if (!service) return null;
        return {
          occurrenceId: service.serviceId,
          serviceId: service.serviceId,
          name: service.name,
          startsAt: service.dateTimeISO || fallbackStartsAt,
        };
      })
      .filter(Boolean) as TeamScheduleOccurrence[];
  }, [fallbackStartsAt, generatedPeriodOccurrences, regeneratedOccurrences, schedules, selectedSchedule, serviceById, serviceTimeZone, viewingSavedSchedule]);
  // A saved schedule keeps its stored occurrence shape (so the grid stays stable);
  // if the services changed since — combined/un-combined, or a time/recurrence
  // edit — the stored occurrence ids drift from what we'd generate now, and the
  // grid stays on the old shape until a re-save re-keys it.
  const occurrencesStale = useMemo(() => {
    if (!canEdit || !selectedSchedule) return false;
    if (selectedSchedule.scheduleId.startsWith("local-")) return false;
    const stored = selectedSchedule.occurrences || [];
    if (stored.length === 0 || !regeneratedOccurrences) return false;
    return !occurrenceScheduleDetailsMatch(stored, regeneratedOccurrences, serviceTimeZone);
  }, [canEdit, regeneratedOccurrences, selectedSchedule, serviceTimeZone]);
  const refreshBlocked = Boolean(selectedSchedule && regeneratedOccurrences &&
    !canRefreshScheduleOccurrences({
      schedule: selectedSchedule,
      services: data.services,
      regeneratedOccurrences,
      timeZone: serviceTimeZone,
    }));
  const [applyingGrouping, setApplyingGrouping] = useState(false);
  // Spreadsheet-style undo/redo for the assignment grid. The stack is
  // session-local and per-schedule (reset when the active schedule changes or an
  // occurrence-shape change invalidates cell keys). Applying an entry lives in
  // applyUndoEntry, which reuses the same per-cell save path as manual edits.
  const {
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    record: recordUndoEntry,
    takeUndo,
    takeRedo,
    pushUndo,
    pushRedo,
    reset: resetUndoHistory,
  } = useScheduleUndoStack();
  // Export/share actions live in a toolbar overflow menu; the PDF preview modal is
  // rendered headless and opened from that menu item.
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [microphones, setMicrophones] = useState<ServicePlanMicrophone[]>([]);
  const [microphoneCatalogStatus, setMicrophoneCatalogStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [iems, setIems] = useState<ServiceEquipment[]>([]);
  const [iemCatalogStatus, setIemCatalogStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const undoShortcut = useMemo(() => {
    const isMac =
      typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
    return {
      undo: isMac ? "⌘Z" : "Ctrl+Z",
      redo: isMac ? "⌘⇧Z" : "Ctrl+Shift+Z",
    };
  }, []);
  // Refresh snapshots only when every saved occurrence has one exact logical
  // counterpart. Legacy map keys are retained by preserveStoredOccurrenceIds.
  const refreshScheduleOccurrences = useCallback(async () => {
    if (!canEdit || !selectedSchedule || !regeneratedOccurrences || refreshBlocked || applyingGrouping) return;
    const sourceOccurrences = selectedSchedule.occurrences || [];
    const refreshedOccurrences = preserveStoredOccurrenceIds(
      sourceOccurrences,
      regeneratedOccurrences,
      serviceTimeZone,
    );
    if (!refreshedOccurrences) return;
    const assignments = rekeyAssignmentsByServiceDate({
      sourceOccurrences,
      targetOccurrences: refreshedOccurrences,
      assignments: selectedSchedule.assignments || {},
    });
    const microphoneAssignments = rekeyScheduleOccurrenceRowsByServiceDate({
      sourceOccurrences,
      targetOccurrences: refreshedOccurrences,
      rows: selectedSchedule.microphoneAssignments,
    });
    const iemAssignments = rekeyScheduleOccurrenceRowsByServiceDate({
      sourceOccurrences,
      targetOccurrences: refreshedOccurrences,
      rows: selectedSchedule.iemAssignments,
    });
    const additionalPositionSlots = rekeyScheduleOccurrenceRowsByServiceDate({
      sourceOccurrences,
      targetOccurrences: refreshedOccurrences,
      rows: selectedSchedule.additionalPositionSlots,
    });
    setApplyingGrouping(true);
    // Re-keying occurrences changes every cell key, so the current undo history no
    // longer maps onto the grid — drop it rather than let it target stale cells.
    resetUndoHistory();
    onScheduleSaved({
      ...selectedSchedule,
      occurrences: refreshedOccurrences,
      assignments,
      microphoneAssignments,
      iemAssignments,
      additionalPositionSlots,
    });
    try {
      const response = await updateTeamSchedule(
        churchId,
        selectedSchedule.scheduleId,
        {
          name: selectedSchedule.name,
          description: selectedSchedule.description || "",
          teamId: selectedSchedule.teamId,
          startDate: selectedSchedule.startDate || "",
          endDate: selectedSchedule.endDate || "",
          serviceIds: selectedSchedule.serviceIds || [],
          occurrences: refreshedOccurrences,
          assignments,
          microphoneAssignments,
          iemAssignments,
          additionalPositionSlots,
        },
      );
      onScheduleSaved(response.schedule);
      showToast("Schedule updated to match its services.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not update this schedule.");
      onScheduleSaved(selectedSchedule);
    } finally {
      setApplyingGrouping(false);
    }
  }, [
    applyingGrouping,
    canEdit,
    churchId,
    onScheduleSaved,
    regeneratedOccurrences,
    serviceTimeZone,
    refreshBlocked,
    resetUndoHistory,
    selectedSchedule,
    showToast,
  ]);
  const allRequirementsByOccurrence = useMemo(() => {
    const map = new Map<string, PositionRequirement[]>();
    const allowLegacyFallback =
      viewingSavedSchedule || selectedSchedule?.source == null;
    baseScheduleOccurrences.forEach((occurrence) => {
      const service = serviceById.get(occurrence.serviceId);
      map.set(
        occurrence.occurrenceId,
        resolveOccurrenceRequirements({
          occurrence,
          service,
          teamPositionIds,
          fallbackToAllTeamPositions: allowLegacyFallback,
        }),
      );
    });
    return map;
  }, [baseScheduleOccurrences, selectedSchedule?.source, serviceById, teamPositionIds, viewingSavedSchedule]);
  const scheduleOccurrences = useMemo(() => {
    if (viewingSavedSchedule) return baseScheduleOccurrences;
    return filterOccurrencesToRange(baseScheduleOccurrences, displayedPeriodRange, serviceTimeZone).filter((occurrence) =>
      (allRequirementsByOccurrence.get(occurrence.occurrenceId)?.length || 0) > 0 ||
      (selectedSchedule?.additionalPositionSlots?.[occurrence.occurrenceId] || [])
        .some((slotKey) => {
          const slot = parseSlotKey(slotKey);
          return Boolean(slot && teamPositionIds.includes(slot.positionId));
        }),
    );
  }, [allRequirementsByOccurrence, baseScheduleOccurrences, displayedPeriodRange, selectedSchedule, serviceTimeZone, teamPositionIds, viewingSavedSchedule]);
  const requirementsByOccurrence = useMemo(
    () => new Map(scheduleOccurrences.map((occurrence) => [
      occurrence.occurrenceId,
      allRequirementsByOccurrence.get(occurrence.occurrenceId) || [],
    ])),
    [allRequirementsByOccurrence, scheduleOccurrences],
  );
  const scheduleColumns = useMemo(
    () =>
      buildScheduleColumns({
        occurrences: scheduleOccurrences,
        requirementsByOccurrence,
        additionalPositionSlots: selectedSchedule?.additionalPositionSlots,
        positions: data.positions,
        teamPositionIds,
      }),
    [
      data.positions,
      requirementsByOccurrence,
      scheduleOccurrences,
      selectedSchedule?.additionalPositionSlots,
      teamPositionIds,
    ],
  );
  // Load each catalog only when its independent team option is enabled.
  useEffect(() => {
    if (!churchId) {
      setMicrophones([]);
      setMicrophoneCatalogStatus("idle");
      setIems([]);
      setIemCatalogStatus("idle");
      return undefined;
    }
    let cancelled = false;
    if (selectedTeam?.usesMicrophoneAssignments) {
      setMicrophoneCatalogStatus("loading");
      getServicePlanMicrophones(churchId).then((result) => {
        if (!cancelled) { setMicrophones(result.microphones); setMicrophoneCatalogStatus("ready"); }
      }).catch(() => { if (!cancelled) setMicrophoneCatalogStatus("error"); });
    } else { setMicrophones([]); setMicrophoneCatalogStatus("idle"); }
    if (selectedTeam?.usesIemAssignments) {
      setIemCatalogStatus("loading");
      Promise.resolve().then(() => getServiceEquipment(churchId)).then((result) => {
        if (!cancelled) { setIems(result.equipment.filter((item) => item.category === "iem")); setIemCatalogStatus("ready"); }
      }).catch(() => { if (!cancelled) setIemCatalogStatus("error"); });
    } else { setIems([]); setIemCatalogStatus("idle"); }
    return () => {
      cancelled = true;
    };
  }, [churchId, selectedTeam?.usesIemAssignments, selectedTeam?.usesMicrophoneAssignments]);
  const teamMembers = useMemo(() => {
    if (!selectedTeam) return [] as TeamRosterMember[];
    const membersById = new Map(
      data.members.map((member) => [member.memberId, member]),
    );
    return (selectedTeam.memberIds || [])
      .map((memberId) => membersById.get(memberId))
      .filter(Boolean) as TeamRosterMember[];
  }, [data.members, selectedTeam]);
  const activeTeamMembers = useMemo(() => teamMembers.filter(isActive), [teamMembers]);
  const duplicateScheduleFirstNames = useMemo(
    () => getDuplicateScheduleFirstNames(activeTeamMembers),
    [activeTeamMembers],
  );
  const scheduleAssignmentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    activeTeamMembers.forEach((member) => {
      counts.set(
        member.memberId,
        countScheduleAssignmentsForMember(selectedSchedule?.assignments, member.memberId),
      );
    });
    return counts;
  }, [activeTeamMembers, selectedSchedule?.assignments]);
  const memberServingHistory = useMemo<Map<string, MemberServingHistory>>(() => {
    if (!selectedTeam) return new Map<string, MemberServingHistory>();
    return getMemberServingHistories(
      selectedTeam.teamId,
      activeTeamMembers.map((member) => member.memberId),
      data.schedules,
      undefined,
      serviceTimeZone,
    );
  }, [activeTeamMembers, data.schedules, selectedTeam, serviceTimeZone]);
  useEffect(() => {
    if (!showForm) return;
    const scrollContainer = document.querySelector(".teams-section-scroll");
    if (scrollContainer instanceof HTMLElement) {
      scrollContainer.scrollTop = 0;
    }
  }, [showForm]);
  const [membersPanelOpenOverride, setMembersPanelOpenOverride] = useState<boolean | null>(null);
  const [membersDrawerAnimationsEnabled, setMembersDrawerAnimationsEnabled] = useState(false);
  const [expandedMemberIds, setExpandedMemberIds] = useState<string[]>([]);
  const [membersSort, setMembersSort] = useState<ScheduleMembersSortState>(
    defaultScheduleMembersSort,
  );
  // Cell keys auto-fill placed someone into within the last ~900ms, purely to
  // drive a brief highlight as the animation reveals picks one at a time.
  const [justFilledCellKeys, setJustFilledCellKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [autoFilling, setAutoFilling] = useState(false);
  const {
    intents: scheduleNotificationIntents,
    nextCursor: scheduleNotificationNextCursor,
    loading: loadingScheduleNotifications,
    refresh: refreshScheduleNotificationHistory,
    addIntents: addScheduleNotificationIntents,
    loadOlder: loadOlderScheduleNotifications,
  } = useScheduleNotificationHistory({
    churchId,
    scheduleId: selectedScheduleId,
    canEdit,
    showToast,
  });
  const [sendingNotificationIntentId, setSendingNotificationIntentId] = useState("");
  const [scheduleSmsPreview, setScheduleSmsPreview] = useState<{
    intent: NotificationIntent;
    recipientName: string;
    phoneNumberSnapshot: string;
    message: string;
    segmentCount: number;
    approvalVersion: string;
  } | null>(null);
  const [sendingScheduleSms, setSendingScheduleSms] = useState(false);
  const scheduleSmsSendLockRef = useRef(false);
  const [replacementIntentToClose, setReplacementIntentToClose] = useState<NotificationIntent | null>(null);
  const [closingReplacement, setClosingReplacement] = useState(false);
  const [scheduleMessagesOpen, setScheduleMessagesOpen] = useState(false);
  const [scheduleInitialSmsOpen, setScheduleInitialSmsOpen] = useState(false);
  const scheduleActionsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const membersDrawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const wasScheduleMessagesOpenRef = useRef(false);
  const wasMembersDrawerOpenRef = useRef(false);
  const scheduleNotificationCounts = useMemo(() => {
    const responseTrackedIntents = scheduleNotificationIntents.filter((intent) => intent.intentType !== "schedule_initial_notification");
    const responded = responseTrackedIntents.filter((intent) => {
      if (intent.intentType === "replacement_request") return Boolean(intent.replacementResolvedAt);
      const response = selectedSchedule?.responses?.[intent.occurrenceId]?.[intent.cellKey || ""];
      return response?.memberId === intent.memberId && ["accepted", "declined"].includes(response.response);
    }).length;
    return {
      requested: scheduleNotificationIntents.length,
      accepted: scheduleNotificationIntents.filter((intent) => ["accepted", "sent", "delivered"].includes(intent.attemptStatus || "")).length,
      delivered: scheduleNotificationIntents.filter((intent) => intent.attemptStatus === "delivered").length,
      failed: scheduleNotificationIntents.filter((intent) => ["failed", "undelivered"].includes(intent.attemptStatus || "")).length,
      uncertain: scheduleNotificationIntents.filter((intent) => intent.status === "unknown" || intent.attemptOutcome === "unknown").length,
      responded,
      waiting: responseTrackedIntents.length - responded,
      optedOut: scheduleNotificationIntents.filter((intent) => intent.previewError?.toLowerCase().includes("opted out")).length,
    };
  }, [scheduleNotificationIntents, selectedSchedule?.responses]);
  const pendingScheduleMessageCount = scheduleNotificationIntents.filter((intent) =>
    ["preview", "ready"].includes(intent.status),
  ).length;
  const scheduleMessagesRequiringAttention = scheduleNotificationIntents.filter(
    (intent) =>
      ["preview", "ready"].includes(intent.status) ||
      ["failed", "undelivered"].includes(intent.attemptStatus || "") ||
      intent.status === "unknown" ||
      intent.attemptOutcome === "unknown",
  ).length;

  const handleSendScheduleIntent = async (intent: NotificationIntent) => {
    if (!canEdit || sendingNotificationIntentId || scheduleSmsPreview || intent.churchId !== churchId) return;
    setSendingNotificationIntentId(intent.intentId);
    let awaitingConfirmation = false;
    try {
      const preview = await getNotificationIntentPreview(churchId, intent.intentId);
      if (latestScheduleRef.current?.scheduleId !== intent.sourceId || latestScheduleRef.current?.churchId !== churchId) return;
      if (!preview.preview.eligible) {
        showToast("This volunteer can't receive a text message right now. Check the current assignment and consent.", "error");
        return;
      }
      const memberName = data.members.find((member) => member.memberId === intent.memberId);
      const recipient = memberName ? `${memberName.firstName} ${memberName.lastName}`.trim() : "this volunteer";
      setScheduleSmsPreview({
        intent: { ...intent, intentId: preview.preview.intentId },
        recipientName: recipient,
        phoneNumberSnapshot: preview.preview.phoneNumberSnapshot,
        message: preview.preview.message,
        segmentCount: preview.preview.segmentCount,
        approvalVersion: preview.preview.approvalVersion,
      });
      awaitingConfirmation = true;
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not send this schedule message.");
      try {
        await refreshScheduleNotificationHistory(intent.sourceId);
      } catch { /* Keep the last known queue visible. */ }
    } finally {
      if (!awaitingConfirmation) setSendingNotificationIntentId("");
    }
  };

  const confirmScheduleSms = async () => {
    const preview = scheduleSmsPreview;
    if (!preview || scheduleSmsSendLockRef.current) return;
    if (preview.intent.churchId !== churchId) {
      setScheduleSmsPreview(null);
      setSendingNotificationIntentId("");
      return;
    }
    scheduleSmsSendLockRef.current = true;
    setScheduleSmsPreview(null);
    setSendingScheduleSms(true);
    try {
      const result = await sendNotificationIntent(churchId, preview.intent.intentId, preview.approvalVersion);
      await refreshScheduleNotificationHistory(preview.intent.sourceId);
      showToast(
        result.success
          ? "Your text message was sent. Delivery updates may take a moment."
          : result.outcome === "unknown"
            ? "We couldn't confirm whether this text was sent. Review delivery history before trying again."
            : result.errorMessage || "This text message wasn't sent. Review delivery history before preparing a retry.",
        result.success ? "success" : "error",
      );
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not send this schedule message.");
      try {
        await refreshScheduleNotificationHistory(preview.intent.sourceId);
      } catch { /* Keep the last known queue visible. */ }
    } finally {
      scheduleSmsSendLockRef.current = false;
      setSendingScheduleSms(false);
      setSendingNotificationIntentId("");
    }
  };

  const cancelScheduleSms = () => {
    if (scheduleSmsSendLockRef.current) return;
    setScheduleSmsPreview(null);
    setSendingNotificationIntentId("");
  };

  const handleResolveReplacementIntent = async (intent: NotificationIntent) => {
    if (!canEdit || intent.replacementResolvedAt || ["sending", "unknown"].includes(intent.status)) return;
    setReplacementIntentToClose(intent);
  };

  const confirmResolveReplacementIntent = async () => {
    const intent = replacementIntentToClose;
    if (!intent || closingReplacement) return;
    if (intent.churchId !== churchId) {
      setReplacementIntentToClose(null);
      return;
    }
    setClosingReplacement(true);
    setSendingNotificationIntentId(intent.intentId);
    try {
      await resolveReplacementNotificationIntent(churchId, intent.intentId);
      await refreshScheduleNotificationHistory(intent.sourceId);
      showToast("Invitation closed. The schedule remains unchanged.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not close this replacement invitation.");
    } finally {
      setClosingReplacement(false);
      setSendingNotificationIntentId("");
      setReplacementIntentToClose(null);
    }
  };
  const [autoFillConfirmOpen, setAutoFillConfirmOpen] = useState(false);
  // Auto-fill applies an optimistic batch before its one network save settles.
  // Keep navigation protected for that entire interval so leaving cannot strand
  // a partially persisted schedule.
  useTeamsUnsavedChanges(autoFilling);
  // Synchronous double-click guard for handleAutoFillSchedule — see there.
  const autoFillRunningRef = useRef(false);
  const pendingScheduleSlotRestoreRef = useRef<{
    activeSlot: ScheduleFocusedCell;
    slotPickerMode?: "assign" | "replace";
  } | null>(null);
  const [membersPanelQuery, setMembersPanelQuery] = useState("");
  const [pendingAdditionalPositionRemoval, setPendingAdditionalPositionRemoval] = useState<{
    serviceId: string;
    cellKey: string;
  } | null>(null);
  const [memberPositionFilterIds, setMemberPositionFilterIds] = useState<string[]>([]);
  const [highlightedMemberIds, setHighlightedMemberIds] = useState<string[]>([]);
  const highlightedMemberIdSet = useMemo(
    () => new Set(highlightedMemberIds),
    [highlightedMemberIds],
  );
  const toggleHighlightedMember = useCallback((memberId: string) => {
    startTransition(() => {
      setHighlightedMemberIds((current) =>
        current.includes(memberId)
          ? current.filter((id) => id !== memberId)
          : [...current, memberId],
      );
    });
  }, []);
  const [copyingLink, setCopyingLink] = useState(false);
  const [pasteRowOpen, setPasteRowOpen] = useState(false);
  const [scheduleLayout, setScheduleLayout] = useState<TeamScheduleAdminLayout>(
    resolveInitialTeamScheduleAdminLayout,
  );
  const [organizeMode, setOrganizeMode] = useState<OccurrenceOrganizeMode>(
    readScheduleOrganizeMode,
  );
  // Once the operator deliberately picks a layout it wins for the rest of the
  // session; until then the layout tracks the viewport (see the effect below).
  const hasExplicitLayoutPreference = useRef(hasStoredTeamScheduleAdminLayout());
  const isNarrowViewport = useMediaQuery("(max-width: 1023px)");
  const scheduleWorkspaceRef = useRef<HTMLElement | null>(null);
  const [scheduleWorkspaceWidth, setScheduleWorkspaceWidth] = useState(0);
  const shouldOverlayMembers =
    isNarrowViewport ||
    (scheduleWorkspaceWidth > 0 && scheduleWorkspaceWidth < 1120);
  const membersPanelOpen = membersPanelOpenOverride ?? !shouldOverlayMembers;
  const setMembersPanelOpen = useCallback<Dispatch<SetStateAction<boolean>>>(
    (nextOpen) => {
      setMembersPanelOpenOverride((currentOverride) => {
        const currentOpen = currentOverride ?? !shouldOverlayMembers;
        return typeof nextOpen === "function"
          ? nextOpen(currentOpen)
          : nextOpen;
      });
    },
    [shouldOverlayMembers],
  );
  const handleMembersPanelOpenChange = useCallback(
    (open: boolean) => {
      setMembersDrawerAnimationsEnabled(true);
      setMembersPanelOpen(open);
    },
    [setMembersPanelOpen],
  );

  useEffect(() => {
    if (scheduleMessagesOpen) {
      wasScheduleMessagesOpenRef.current = true;
    } else if (wasScheduleMessagesOpenRef.current) {
      scheduleActionsTriggerRef.current?.focus();
      wasScheduleMessagesOpenRef.current = false;
    }
  }, [scheduleMessagesOpen]);
  useEffect(() => {
    if (shouldOverlayMembers && membersPanelOpen) {
      wasMembersDrawerOpenRef.current = true;
    } else if (shouldOverlayMembers && wasMembersDrawerOpenRef.current) {
      membersDrawerTriggerRef.current?.focus();
      wasMembersDrawerOpenRef.current = false;
    }
  }, [membersPanelOpen, shouldOverlayMembers]);

  // With no stored preference, follow the viewport so a mid-session resize across
  // the breakpoint swaps to the layout that reads best at that width.
  useEffect(() => {
    if (hasExplicitLayoutPreference.current) return;
    setScheduleLayout(responsiveDefaultTeamScheduleAdminLayout(isNarrowViewport));
  }, [isNarrowViewport]);

  const scheduleLayoutOptions = useMemo(
    () =>
      ADMIN_SCHEDULE_LAYOUTS.flatMap(
        (value): { value: TeamScheduleAdminLayout; label: string }[] => {
          if (value === "board") {
            return [{ value, label: "Cards" }];
          }
          if (value === "grid") {
            return [{ value, label: "Grid" }];
          }
          if (value === "transpose") {
            return [{ value, label: "By position" }];
          }
          return [];
        },
      ),
    [],
  );

  // Persist only deliberate switches, so an explicit choice wins over the
  // responsive default and pins the layout against further viewport-driven swaps.
  const changeScheduleLayout = useCallback((layout: TeamScheduleAdminLayout) => {
    hasExplicitLayoutPreference.current = true;
    setScheduleLayout(layout);
    writeTeamScheduleAdminLayout(layout);
  }, []);

  const changeOrganizeMode = useCallback((mode: OccurrenceOrganizeMode) => {
    setOrganizeMode(mode);
    writeScheduleOrganizeMode(mode);
  }, []);
  const [activeSlot, setActiveSlot] = useState<ScheduleFocusedCell | null>(null);
  // The standard grid flow supports replacing, shadowing, and clearing slots.
  const [slotPickerMode, setSlotPickerMode] = useState<"assign" | "replace">(
    "assign",
  );
  const [assignmentQuery, setAssignmentQuery] = useState("");
  const [pickerAnchorEl, setPickerAnchorEl] = useState<HTMLElement | null>(null);
  const pickerInputRef = useRef<HTMLInputElement>(null);
  const [pendingCellAssignment, setPendingCellAssignment] =
    useState<PendingCellAssignment | null>(null);
  const [pendingMoveAssignment, setPendingMoveAssignment] =
    useState<PendingCellAssignment | null>(null);
  const pendingCellAssignmentRef = useRef<PendingCellAssignment | null>(null);
  const [pendingCrossTeamConflict, setPendingCrossTeamConflict] =
    useState<PendingCrossTeamConflict | null>(null);
  const [pendingAvailabilityConfirmation, setPendingAvailabilityConfirmation] =
    useState<PendingAvailabilityConfirmation | null>(null);
  const [guestRemovalConfirmation, setGuestRemovalConfirmation] = useState<string | null>(null);
  const guestRemovalResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const guestRemovalOwnerRef = useRef("");
  const resolveGuestRemoval = (confirmed: boolean) => {
    guestRemovalResolveRef.current?.(confirmed);
    guestRemovalResolveRef.current = null;
    setGuestRemovalConfirmation(null);
  };
  useLayoutEffect(() => {
    guestRemovalOwnerRef.current = `${churchId}:${selectedScheduleRecord?.scheduleId || ""}`;
    setGuestRemovalConfirmation(null);
    return () => {
      guestRemovalOwnerRef.current = "";
      // A confirmation belongs to the schedule/church that requested it.
      guestRemovalResolveRef.current?.(false);
      guestRemovalResolveRef.current = null;
    };
  }, [churchId, selectedScheduleRecord?.scheduleId]);
  // Assignment saves are read-modify-write transactions. Keep dependent edits
  // ordered for a schedule while allowing a different schedule to save freely.
  const assignmentSaveQueuesRef = useRef(new Map<string, Promise<unknown>>());
  const pendingPositionSlotSavesRef = useRef(new Map<string, PendingPositionSlotSave>());
  const positionSlotSaveToastIdsRef = useRef(new Map<string, string>());
  const scheduleCellSaveWorkersRef = useRef(new Map<string, Promise<void>>());
  const scheduleCellSaveFailuresRef = useRef(new Map<string, number>());
  const scheduleCellSaveToastIdsRef = useRef(new Map<string, string>());
  useEffect(() => () => {
    for (const toastId of scheduleCellSaveToastIdsRef.current.values()) removeToast(toastId);
    scheduleCellSaveToastIdsRef.current.clear();
  }, [removeToast]);
  const runLatestScheduleCellSaveRef = useRef<((
    key: string,
    field: ScheduleCellMapField,
    failureMessage: string,
    send: (edit: PendingScheduleCellEdit) => Promise<TeamSchedule>,
  ) => Promise<void>) | null>(null);
  const stageScheduleCellEdit = useCallback((
    schedule: TeamSchedule,
    field: ScheduleCellMapField,
    occurrenceId: string,
    cellKey: string,
    value: unknown,
  ) => {
    const key = scheduleCellEditKey(schedule.churchId, schedule.scheduleId, field, occurrenceId, cellKey);
    const pending = new Map(pendingScheduleCellEditsRef.current);
    const edit: PendingScheduleCellEdit = {
      churchId: schedule.churchId,
      scheduleId: schedule.scheduleId,
      field,
      occurrenceId,
      cellKey,
      value,
      sequence: ++scheduleCellEditSequenceRef.current,
    };
    pending.set(key, edit);
    pendingScheduleCellEditsRef.current = pending;
    scheduleCellSaveFailuresRef.current.delete(key);
    const toastId = scheduleCellSaveToastIdsRef.current.get(key);
    if (toastId) {
      removeToast(toastId);
      scheduleCellSaveToastIdsRef.current.delete(key);
    }
    const optimistic = setScheduleCellMapValue(schedule, field, occurrenceId, cellKey, value);
    publishScheduleSnapshot(optimistic, [field]);
    return { key, edit, optimistic };
  }, [publishScheduleSnapshot, removeToast]);
  const clearScheduleCellEdit = useCallback((edit: PendingScheduleCellEdit) => {
    const key = scheduleCellEditKey(
      edit.churchId,
      edit.scheduleId,
      edit.field,
      edit.occurrenceId,
      edit.cellKey,
    );
    const pending = new Map(pendingScheduleCellEditsRef.current);
    if (pending.get(key)?.sequence !== edit.sequence) return false;
    pending.delete(key);
    pendingScheduleCellEditsRef.current = pending;
    return true;
  }, []);
  const saveLatestScheduleCellEdit = useCallback((
    key: string,
    field: ScheduleCellMapField,
    failureMessage: string,
    send: (edit: PendingScheduleCellEdit) => Promise<TeamSchedule>,
  ): Promise<void> => {
    const inFlight = scheduleCellSaveWorkersRef.current.get(key);
    if (inFlight) return inFlight;
    const worker = (async () => {
      while (true) {
        const edit = pendingScheduleCellEditsRef.current.get(key);
        if (!edit) return;
        try {
          const schedule = await trackTeamsSave(send(edit));
          const latest = pendingScheduleCellEditsRef.current.get(key);
          if (!latest) return;
          if (latest.sequence !== edit.sequence) continue;
          publishScheduleCellResponses(schedule, field, [edit]);
          clearScheduleCellEdit(edit);
          scheduleCellSaveFailuresRef.current.delete(key);
          const toastId = scheduleCellSaveToastIdsRef.current.get(key);
          if (toastId) {
            removeToast(toastId);
            scheduleCellSaveToastIdsRef.current.delete(key);
          }
          return;
        } catch {
          const latest = pendingScheduleCellEditsRef.current.get(key);
          if (!latest || latest.sequence !== edit.sequence) continue;
          scheduleCellSaveFailuresRef.current.set(key, edit.sequence);
          const previousToastId = scheduleCellSaveToastIdsRef.current.get(key);
          if (previousToastId) removeToast(previousToastId);
          const toastId = showToast({
            message: `${failureMessage} Your choice is still here. Retry the save when ready.`,
            variant: "error",
            persist: true,
            children: (
              <div className="mt-2 flex justify-center">
                <Button
                  variant="primary"
                  className="text-sm"
                  onClick={() => {
                    if (scheduleCellSaveFailuresRef.current.get(key) !== edit.sequence) return;
                    scheduleCellSaveFailuresRef.current.delete(key);
                    removeToast(toastId);
                    scheduleCellSaveToastIdsRef.current.delete(key);
                    void runLatestScheduleCellSaveRef.current?.(key, field, failureMessage, send);
                  }}
                >
                  Retry save
                </Button>
              </div>
            ),
          });
          scheduleCellSaveToastIdsRef.current.set(key, toastId);
          return;
        }
      }
    })();
    scheduleCellSaveWorkersRef.current.set(key, worker);
    void worker.finally(() => {
      if (scheduleCellSaveWorkersRef.current.get(key) === worker) {
        scheduleCellSaveWorkersRef.current.delete(key);
      }
      const latest = pendingScheduleCellEditsRef.current.get(key);
      if (latest && scheduleCellSaveFailuresRef.current.get(key) !== latest.sequence) {
        void runLatestScheduleCellSaveRef.current?.(key, field, failureMessage, send);
      }
    });
    return worker;
  }, [clearScheduleCellEdit, publishScheduleCellResponses, removeToast, showToast, trackTeamsSave]);
  runLatestScheduleCellSaveRef.current = saveLatestScheduleCellEdit;
  const queueEquipmentCellSave = useCallback((edit: PendingScheduleCellEdit) => {
    if (edit.field !== "microphoneAssignments" && edit.field !== "iemAssignments") return;
    const key = scheduleCellEditKey(
      edit.churchId,
      edit.scheduleId,
      edit.field,
      edit.occurrenceId,
      edit.cellKey,
    );
    const isMicrophone = edit.field === "microphoneAssignments";
    const failureMessage = isMicrophone
      ? "Couldn't save the microphone choice."
      : "Couldn't save the IEM choice.";
    const send = async (pendingEdit: PendingScheduleCellEdit) => {
      if (pendingEdit.field === "microphoneAssignments") {
        const response = await updateTeamScheduleAssignmentMicrophones(
          pendingEdit.churchId,
          pendingEdit.scheduleId,
          {
            serviceId: pendingEdit.occurrenceId,
            positionSlotKey: pendingEdit.cellKey,
            microphoneIds: pendingEdit.value as string[],
          },
        );
        return response.schedule;
      }
      const response = await updateTeamScheduleAssignmentIems(
        pendingEdit.churchId,
        pendingEdit.scheduleId,
        {
          serviceId: pendingEdit.occurrenceId,
          positionSlotKey: pendingEdit.cellKey,
          iemIds: pendingEdit.value as string[],
        },
      );
      return response.schedule;
    };
    return saveLatestScheduleCellEdit(key, edit.field, failureMessage, send);
  }, [saveLatestScheduleCellEdit]);
  const resumePendingEquipmentSaves = useCallback((
    schedule: TeamSchedule,
    occurrenceId: string,
    cellKey: string,
  ) => {
    [...pendingScheduleCellEditsRef.current.values()]
      .filter((edit) =>
        edit.churchId === schedule.churchId &&
        edit.scheduleId === schedule.scheduleId &&
        edit.occurrenceId === occurrenceId &&
        edit.cellKey === cellKey &&
        (edit.field === "microphoneAssignments" || edit.field === "iemAssignments"),
      )
      .forEach((edit) => { void queueEquipmentCellSave(edit); });
  }, [queueEquipmentCellSave]);
  const cancelPendingPositionSlotWork = useCallback((
    churchId: string,
    scheduleId: string,
    occurrenceId: string,
    cellKey: string,
  ) => {
    const slotKey = schedulePositionSlotSaveKey(churchId, scheduleId, occurrenceId, cellKey);
    const slotSave = pendingPositionSlotSavesRef.current.get(slotKey);
    if (slotSave) {
      if (slotSave.outcome !== "saved" && slotSave.outcome !== "cancelled") {
        slotSave.outcome = "cancelled";
        slotSave.resolve("cancelled");
      }
      pendingPositionSlotSavesRef.current.delete(slotKey);
    }
    const positionToastId = positionSlotSaveToastIdsRef.current.get(slotKey);
    if (positionToastId) removeToast(positionToastId);
    positionSlotSaveToastIdsRef.current.delete(slotKey);
    const nextEdits = new Map(pendingScheduleCellEditsRef.current);
    ( ["assignments", "microphoneAssignments", "iemAssignments"] as const).forEach((field) => {
      const key = scheduleCellEditKey(churchId, scheduleId, field, occurrenceId, cellKey);
      nextEdits.delete(key);
      scheduleCellSaveFailuresRef.current.delete(key);
      const toastId = scheduleCellSaveToastIdsRef.current.get(key);
      if (toastId) removeToast(toastId);
      scheduleCellSaveToastIdsRef.current.delete(key);
    });
    pendingScheduleCellEditsRef.current = nextEdits;
  }, [removeToast]);
  const showPositionSlotDependencyRetry = useCallback((edit: PendingScheduleCellEdit) => {
    const cellKey = scheduleCellEditKey(
      edit.churchId,
      edit.scheduleId,
      edit.field,
      edit.occurrenceId,
      edit.cellKey,
    );
    const previousToastId = scheduleCellSaveToastIdsRef.current.get(cellKey);
    if (previousToastId) removeToast(previousToastId);
    const message = edit.field === "microphoneAssignments"
      ? "Couldn't save the microphone choice because its position hasn't been saved. Your choice is still here."
      : "Couldn't save the IEM choice because its position hasn't been saved. Your choice is still here.";
    const toastId = showToast({
      message,
      variant: "error",
      persist: true,
      children: (
        <div className="mt-2 flex justify-center">
          <Button variant="primary" className="text-sm" onClick={() => {
            if (pendingScheduleCellEditsRef.current.get(cellKey)?.sequence !== edit.sequence) return;
            removeToast(toastId);
            scheduleCellSaveToastIdsRef.current.delete(cellKey);
            void (async () => {
              const slotKey = schedulePositionSlotSaveKey(
                edit.churchId,
                edit.scheduleId,
                edit.occurrenceId,
                edit.cellKey,
              );
              const dependency = pendingPositionSlotSavesRef.current.get(slotKey);
              const outcome = !dependency
                ? "saved"
                : dependency.outcome === "failed"
                  ? await dependency.retry()
                  : dependency.outcome === "cancelled"
                    ? "cancelled"
                    : await dependency.promise;
              if (outcome !== "saved") return;
              const latest = pendingScheduleCellEditsRef.current.get(cellKey);
              if (latest) void queueEquipmentCellSave(latest);
            })();
          }}>Retry save</Button>
        </div>
      ),
    });
    scheduleCellSaveToastIdsRef.current.set(cellKey, toastId);
  }, [queueEquipmentCellSave, removeToast, showToast]);
  const enqueueAssignmentSave = useCallback(
    <T,>(scheduleId: string, task: () => Promise<T>) => {
      const previous = assignmentSaveQueuesRef.current.get(scheduleId) || Promise.resolve();
      const run = previous.then(task, task);
      const queue = run.then(
        () => undefined,
        () => undefined,
      );
      assignmentSaveQueuesRef.current.set(scheduleId, queue);
      void queue.then(() => {
        if (assignmentSaveQueuesRef.current.get(scheduleId) === queue) {
          assignmentSaveQueuesRef.current.delete(scheduleId);
        }
      });
      return trackTeamsSave(run);
    },
    [trackTeamsSave],
  );
  const [detailOccurrenceId, setDetailOccurrenceId] = useState<string | null>(null);
  const formDraftKey = !formState
    ? scheduleDraftKey
    : formState.mode === "edit"
      ? formState.scheduleId
      : formState.mode === "copy"
        ? getScheduleCopyDraftKey(formState.sourceScheduleId)
        : CUSTOM_SCHEDULE_DRAFT_KEY;
  const formSelectedSchedule = formState?.mode === "edit" ? selectedSchedule : null;
  const formCopySourceSchedule = formState?.mode === "copy"
    ? formState.sourceSchedule
    : null;
  const persistedDraft = scheduleDrafts[formDraftKey];

  useEffect(() => {
    pendingCellAssignmentRef.current = pendingCellAssignment;
  }, [pendingCellAssignment]);

  useEffect(() => {
    if (!pendingCellAssignment) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-schedule-assignment-menu]")) return;
      setPendingCellAssignment(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [pendingCellAssignment]);

  useEffect(() => {
    setPendingCellAssignment(null);
    setPendingMoveAssignment((pending) =>
      pending?.scheduleId === selectedScheduleId ? pending : null,
    );
    setDetailOccurrenceId(null);
    setHighlightedMemberIds([]);
    setMemberPositionFilterIds([]);
    setActiveSlot(null);
    setAssignmentQuery("");
    setPickerAnchorEl(null);
    setPendingCrossTeamConflict(null);
    setPendingAvailabilityConfirmation(null);
    resetUndoHistory();
  }, [resetUndoHistory, selectedScheduleId]);

  const clearActiveSlot = useCallback(() => {
    setActiveSlot(null);
    setSlotPickerMode("assign");
    setAssignmentQuery("");
    setPickerAnchorEl(null);
    setPendingCellAssignment(null);
    setMemberPositionFilterIds([]);
  }, []);

  const getCrossTeamConflictWarning = useCallback(
    (memberId: string, occurrenceId: string) =>
      formatCrossTeamScheduleConflictWarning(
        findCrossTeamScheduleOccurrenceConflicts({
          schedule: selectedSchedule,
          occurrenceId,
          memberId,
          cellKey: activeSlot?.columnKey,
          timeZone: serviceTimeZone,
          // Conflict checks only need the schedules overlapping this one, and
          // selecting a schedule hydrates exactly that set.
          schedules: onlyHydratedSchedules(data.schedules),
          teams: data.teams,
        }),
      ),
    [activeSlot?.columnKey, data.schedules, data.teams, selectedSchedule, serviceTimeZone],
  );

  const hasUnhydratedOverlappingTeamSchedule = useMemo(
    () =>
      Boolean(
        selectedSchedule &&
        data.schedules.some(
          (schedule) =>
            schedule.scheduleId !== selectedSchedule.scheduleId &&
            schedule.teamId !== selectedSchedule.teamId &&
            !schedule.archivedAt &&
            !isHydratedSchedule(schedule) &&
            !selectedSchedule?.scheduleId.startsWith("virtual:") &&
            scheduleDateRangesOverlap(selectedSchedule, schedule),
        ),
      ),
    [data.schedules, selectedSchedule],
  );

  const requestCrossTeamConflictConfirmation = useCallback(
    ({
      memberId,
      warning,
      isMove,
      onConfirm,
      onCancel,
      fingerprint = "",
      conflicts = [],
    }: Omit<PendingCrossTeamConflict, "fingerprint" | "conflicts"> &
      Partial<Pick<PendingCrossTeamConflict, "fingerprint" | "conflicts">>) => {
      setPendingCrossTeamConflict({
        memberId,
        warning,
        fingerprint,
        conflicts,
        isMove,
        onConfirm,
        onCancel,
      });
    },
    [],
  );

  const dismissCrossTeamConflict = useCallback(() => {
    setPendingCrossTeamConflict((pending) => {
      pending?.onCancel?.();
      return null;
    });
  }, []);

  const dismissAvailabilityConfirmation = useCallback(() => {
    setPendingAvailabilityConfirmation(null);
  }, []);

  const assignmentConflictPayload = (fingerprint?: string | boolean) =>
    typeof fingerprint === "string" && fingerprint
      ? { confirmedOccurrenceConflictFingerprint: fingerprint }
      : {};

  const positionNameById = useMemo(() => {
    const map = new Map<string, string>();
    schedulePositions.forEach((position) => map.set(position.positionId, position.name));
    return map;
  }, [schedulePositions]);

  const describeMemberName = useCallback(
    (memberId: string | null | undefined) => {
      if (!memberId) return "member";
      const member = scheduleDisplayMembers.find(
        (item) => item.memberId === memberId,
      );
      return member
        ? scheduleMemberName(member, duplicateScheduleFirstNames)
        : "member";
    },
    [duplicateScheduleFirstNames, scheduleDisplayMembers],
  );

  // Push a completed assignment edit onto the undo stack. Cells whose value did
  // not actually change are dropped so an undo never issues an empty write.
  const recordAssignmentChange = useCallback(
    (label: string, changes: ScheduleCellChange[], scheduleId = selectedSchedule?.scheduleId) => {
      if (!scheduleId) return;
      const meaningful = changes.filter(
        (change) => !cellsMatch(change.before, change.after),
      );
      if (meaningful.length === 0) return;
      recordUndoEntry({
        scheduleId,
        label,
        changes: meaningful,
      });
    },
    [recordUndoEntry, selectedSchedule],
  );

  // Re-apply an undo/redo entry as one atomic server mutation. The server compares
  // the captured expected values again so a concurrent edit is skipped safely.
  const applyUndoEntry = useCallback(
    (entry: ScheduleUndoEntry, direction: "undo" | "redo") => {
      if (!canEdit || !selectedSchedule || selectedSchedule.scheduleId !== entry.scheduleId) {
        if (direction === "undo") pushUndo(entry);
        else pushRedo(entry);
        return;
      }
      const previousSchedule = selectedSchedule;
      let nextAssignments: TeamScheduleAssignments = {
        ...(selectedSchedule.assignments || {}),
      };
      const changes: Array<{
        serviceId: string;
        positionSlotKey: string;
        serviceDate: string;
        expectedCell: ScheduleCellState;
        assignment: ScheduleCellState;
      }> = [];
      let skipped = 0;
      // Undo restores each cell's "before"; redo re-applies its "after". Process
      // undo in reverse so a member is cleared from a slot before being restored
      // to another (mirrors how the forward edit was ordered).
      const ordered =
        direction === "undo" ? [...entry.changes].reverse() : entry.changes;
      for (const change of ordered) {
        const expected = direction === "undo" ? change.after : change.before;
        const desired = direction === "undo" ? change.before : change.after;
        const liveCell = nextAssignments[change.occurrenceId]?.[change.cellKey] ?? "";
        if (!cellsMatch(liveCell, expected)) {
          skipped += 1;
          continue;
        }
        const row = { ...(nextAssignments[change.occurrenceId] || {}) };
        const serialized = serializeAssignmentCell(
          normalizeAssignmentCell(desired || undefined),
        );
        if (serialized) {
          row[change.cellKey] = serialized;
        } else {
          delete row[change.cellKey];
        }
        if (Object.keys(row).length > 0) {
          nextAssignments[change.occurrenceId] = row;
        } else {
          const trimmed = { ...nextAssignments };
          delete trimmed[change.occurrenceId];
          nextAssignments = trimmed;
        }
        changes.push({
          serviceId: change.occurrenceId,
          positionSlotKey: change.cellKey,
          serviceDate: change.serviceDate,
          expectedCell: liveCell,
          assignment: serialized || "",
        });
      }
      if (skipped > 0) {
        showToast(
          "Some changes were edited by someone else and were left as they are.",
          "neutral",
        );
      }
      if (changes.length === 0) {
        if (direction === "undo") pushUndo(entry);
        else pushRedo(entry);
        return;
      }

      const stagedEdits = changes.map((change) => stageScheduleCellEdit(
        previousSchedule,
        "assignments",
        change.serviceId,
        change.positionSlotKey,
        change.assignment,
      ).edit);
      clearActiveSlot();
      let mutationSchedule = previousSchedule;
      let historyRecorded = false;
      const restore = () => {
        let current = schedulesByOwnerRef.current.get(virtualSchedulePreviewKey(
          mutationSchedule.churchId,
          mutationSchedule.scheduleId,
        )) || mutationSchedule;
        let changed = false;
        stagedEdits.forEach((edit, index) => {
          if (!clearScheduleCellEdit(edit)) return;
          const change = changes[index];
          if (!change) return;
          current = setScheduleCellMapValue(
            current,
            "assignments",
            change.serviceId,
            change.positionSlotKey,
            change.expectedCell,
          );
          changed = true;
        });
        if (changed) publishScheduleSnapshot(current, ["assignments"]);
        if (direction === "undo") pushUndo(entry);
        else pushRedo(entry);
      };
      const persist = async (fingerprint?: string): Promise<void> => {
        try {
          const response = await enqueueAssignmentSave(previousSchedule.scheduleId, () => updateTeamScheduleAssignmentsBatch(
            churchId,
            previousSchedule.scheduleId,
            {
              changes,
              skipChangedCells: true,
              ...assignmentConflictPayload(fingerprint),
            },
          ));
          mutationSchedule = response.schedule;
          publishScheduleCellResponses(response.schedule, "assignments", stagedEdits);
          stagedEdits.forEach(clearScheduleCellEdit);
          publishScheduleCellResponses(response.schedule, "assignments", stagedEdits);
          if (response.skipped.length) {
            showToast("Some changes were edited by someone else and were left as they are.", "neutral");
          }
          if (!historyRecorded) {
            historyRecorded = true;
            if (direction === "undo") pushRedo(entry);
            else pushUndo(entry);
          }
        } catch (error) {
          const conflictDetails = getOccurrenceConflictDetails(error);
          if (conflictDetails) {
            requestCrossTeamConflictConfirmation({
              memberId: conflictDetails.conflicts[0]?.memberId || "",
              warning: "already scheduled in an overlapping service",
              ...conflictDetails,
              onConfirm: () => {
                void persist(conflictDetails.fingerprint);
              },
              onCancel: restore,
            });
            return;
          }
          const toastId = showToast({
            message: `Couldn't ${direction} that change. Your schedule is still here. Retry the save when ready.`,
            variant: "error",
            persist: true,
            children: (
              <div className="mt-2 flex justify-center">
                <Button variant="primary" className="text-sm" onClick={() => {
                  removeToast(toastId);
                  void persist(fingerprint);
                }}>Retry save</Button>
              </div>
            ),
          });
        }
      };
      void persist();
    },
    [
      canEdit,
      churchId,
      clearActiveSlot,
      clearScheduleCellEdit,
      enqueueAssignmentSave,
      publishScheduleCellResponses,
      publishScheduleSnapshot,
      pushRedo,
      pushUndo,
      requestCrossTeamConflictConfirmation,
      removeToast,
      selectedSchedule,
      stageScheduleCellEdit,
      showToast,
    ],
  );

  const handleUndo = useCallback(() => {
    // Auto-fill records its undo entry for the fully-filled end state before
    // the reveal animation finishes applying it — undoing mid-reveal would
    // diff against a grid that doesn't match either state yet.
    if (autoFilling) return;
    const entry = takeUndo();
    if (!entry) return;
    applyUndoEntry(entry, "undo");
  }, [applyUndoEntry, autoFilling, takeUndo]);

  const handleRedo = useCallback(() => {
    if (autoFilling) return;
    const entry = takeRedo();
    if (!entry) return;
    applyUndoEntry(entry, "redo");
  }, [applyUndoEntry, autoFilling, takeRedo]);

  // Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z or Ctrl+Y to redo — only on the schedule
  // grid, and never while typing in a field (so native field undo still works).
  useEffect(() => {
    if (!canEdit) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      event.preventDefault();
      if (key === "y" || event.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [canEdit, handleRedo, handleUndo]);

  const activateSlot = useCallback(
    (
      cell: ScheduleFocusedCell,
      anchorEl: HTMLElement,
      mode: "assign" | "replace" = "assign",
    ) => {
      setActiveSlot(cell);
      setSlotPickerMode(mode);
      setPickerAnchorEl(anchorEl);
      setPendingCellAssignment(null);
      const column = scheduleColumns.find((item) => item.columnKey === cell.columnKey);
      if (column) {
        setMemberPositionFilterIds([column.positionId]);
      }
      // Start with an empty query even when the slot is occupied. Pre-filling it
      // with the current assignee's name filters the candidate list down to that
      // one name (who is then excluded as the current primary), leaving the
      // picker showing "No eligible members" with no way to replace or shadow.
      setAssignmentQuery("");
    },
    [scheduleColumns],
  );

  // Set when the user arrived from somewhere that wants them back — e.g. a plan's
  // "Who's serving" panel — so they aren't stranded in the schedule.
  const { returnTo: scheduleReturnTo, finishEditing: returnFromSchedule } =
    useTeamsReturnNavigation();
  const { requestDiscardAction } = useTeamsNavigationGuard();

  useTeamsRestoreOnMount({
    onSchedulePeriodRestore: (restore) => {
      hasExplicitPeriodSelectionRef.current = true;
      setViewingSavedSchedule(false);
      updateScheduleTeamFilter(restore.teamId);
      setPeriodSelection("custom", { start: restore.startDate, end: restore.endDate });
      setSelectedScheduleId("");
      setDetailOccurrenceId(restore.occurrenceId);
    },
    onScheduleRestore: (restore) => {
      if (restore.scheduleId) {
        const restoredSchedule = schedules.find(
          (schedule) => schedule.scheduleId === restore.scheduleId,
        );
        setViewingSavedSchedule(true);
        if (restoredSchedule?.startDate && restoredSchedule.endDate) {
          setPeriodSelection(
            "custom",
            { start: restoredSchedule.startDate, end: restoredSchedule.endDate },
          );
        }
        setSelectedScheduleId(restore.scheduleId, true);
      }
      if (restore.membersPanelOpen !== undefined) {
        setMembersPanelOpen(restore.membersPanelOpen);
      }
      if (restore.activeSlot) {
        pendingScheduleSlotRestoreRef.current = {
          activeSlot: restore.activeSlot,
          slotPickerMode: restore.slotPickerMode,
        };
      }
    },
  });

  useEffect(() => {
    const pending = pendingScheduleSlotRestoreRef.current;
    if (!pending?.activeSlot) return;
    const column = scheduleColumns.find(
      (item) => item.columnKey === pending.activeSlot.columnKey,
    );
    const occurrence = scheduleOccurrences.find(
      (item) => item.occurrenceId === pending.activeSlot.occurrenceId,
    );
    if (!column || !occurrence) return;
    setActiveSlot(pending.activeSlot);
    setSlotPickerMode(pending.slotPickerMode ?? "assign");
    setMemberPositionFilterIds([column.positionId]);
    setAssignmentQuery("");
    setPickerAnchorEl(null);
    pendingScheduleSlotRestoreRef.current = null;
  }, [scheduleColumns, scheduleOccurrences]);

  useEffect(() => {
    if (!activeSlot || guestRemovalConfirmation !== null) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pendingCellAssignmentRef.current) {
        setPendingCellAssignment(null);
        return;
      }
      clearActiveSlot();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeSlot, clearActiveSlot, guestRemovalConfirmation]);

  useEffect(() => {
    if (!activeSlot || guestRemovalConfirmation !== null) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-schedule-assignment-menu]")) return;
      if (target.closest("[data-schedule-members-panel]")) return;
      if (target.closest("[data-schedule-members-trigger]")) return;
      if (target.closest("[data-schedule-cell-trigger]")) return;
      clearActiveSlot();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [activeSlot, clearActiveSlot, guestRemovalConfirmation]);

  const activeGridLayout = useMemo<ScheduleGridLayout>(
    () => (scheduleLayout === "transpose" ? "transpose" : "grid"),
    [scheduleLayout],
  );

  const getAxisHighlightClassName = useCallback(
    (
      occurrenceId?: string,
      columnKey?: string,
      options?: { rowIndex?: number; surface?: "body" | "sticky" | "header" },
    ) =>
      scheduleAxisHighlightClassName(
        getScheduleAxisHighlight({
          layout: activeGridLayout,
          focusedCell: activeSlot,
          occurrenceId,
          columnKey,
        }),
        options,
      ),
    [activeGridLayout, activeSlot],
  );

  const positionIconById = useMemo(
    () => new Map(data.positions.map((position) => [position.positionId, position.icon])),
    [data.positions],
  );

  const detailOccurrence = detailOccurrenceId
    ? scheduleOccurrences.find((item) => item.occurrenceId === detailOccurrenceId) || null
    : null;
  const detailSummaryGroups = useMemo(() => {
    if (!detailOccurrence) return [];
    return buildOccurrenceSummaryGroups({
      columns: scheduleColumns,
      requirements: requirementsByOccurrence.get(detailOccurrence.occurrenceId),
      assignmentsRow: selectedSchedule?.assignments?.[detailOccurrence.occurrenceId],
      members: scheduleDisplayMembers,
      duplicateFirstNames: duplicateScheduleFirstNames,
      additionalSlotKeys:
        selectedSchedule?.additionalPositionSlots?.[detailOccurrence.occurrenceId],
    });
  }, [
    scheduleDisplayMembers,
    detailOccurrence,
    duplicateScheduleFirstNames,
    requirementsByOccurrence,
    scheduleColumns,
    selectedSchedule?.additionalPositionSlots,
    selectedSchedule?.assignments,
  ]);
  const detailMessage = useMemo(
    () =>
      detailOccurrence
        ? formatOccurrenceMessage({
          startsAt: detailOccurrence.startsAt,
          groups: detailSummaryGroups,
          timeZone: serviceTimeZone,
        })
        : "",
    [detailOccurrence, detailSummaryGroups, serviceTimeZone],
  );

  const copyDetailOccurrenceAssignments = useCallback(async () => {
    if (!detailMessage) return;
    try {
      await navigator.clipboard?.writeText(detailMessage);
      showToast("Schedule copied.", "success");
    } catch {
      showToast("Could not copy to the clipboard.", "neutral");
    }
  }, [detailMessage, showToast]);

  const openServiceSummary = useCallback((occurrenceId: string) => {
    setDetailOccurrenceId(occurrenceId);
  }, []);

  const canShowScheduleWorkspace = Boolean(
    selectedSchedule &&
    scheduleColumns.length > 0 &&
    scheduleOccurrences.length > 0,
  );

  useLayoutEffect(() => {
    const element = scheduleWorkspaceRef.current;
    if (
      !canShowScheduleWorkspace ||
      showForm ||
      !element ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }
    setScheduleWorkspaceWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      setScheduleWorkspaceWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [canShowScheduleWorkspace, selectedScheduleId, showForm]);

  // Distinguishes "still loading this schedule's assignments" from the genuine
  // empty states, so an operator never reads a mid-fetch grid as an unstaffed
  // service.
  const scheduleWorkspaceEmptyMessage = (() => {
    const messageClassName =
      "rounded-md border border-gray-700 bg-gray-950/50 p-4 text-sm text-gray-300";
    if (isSelectedScheduleLoading) {
      return (
        <p className={messageClassName} role="status">
          Loading this schedule&apos;s assignments…
        </p>
      );
    }
    if (!workspaceTeamId) {
      return (
        <p className={messageClassName}>
          Choose a team to see its service occurrences.
        </p>
      );
    }
    if (generatedPeriodOccurrences.length === 0 && !viewingSavedSchedule) {
      return (
        <p className={messageClassName}>
          No service occurrences are configured for this period. Visit{" "}
          <Link className="font-medium text-cyan-300 underline" to="/teams-and-services/service-setup">Service Setup</Link>{" "}
          to review service schedules.
        </p>
      );
    }
    if (scheduleOccurrences.length > 0 && scheduleColumns.length === 0) {
      return (
        <p className={messageClassName}>
          These services do not have any positions configured for this team. Update position requirements in{" "}
          <Link className="font-medium text-cyan-300 underline" to="/teams-and-services/service-setup">Service Setup</Link>.
        </p>
      );
    }
    if (!selectedSchedule || !selectedTeam) {
      return <p className={messageClassName}>Choose a team and date range to view scheduling needs.</p>;
    }
    return (
      <p className={messageClassName}>
        This schedule needs at least one service occurrence and one required
        position. Set position requirements on a service, or add positions to the team.
      </p>
    );
  })();

  const getAssignmentIssue = useCallback(
    (
      memberId: string,
      occurrenceId: string,
      positionId: string,
      source?: { serviceId?: string; positionId?: string },
      assignmentKind: "primary" | TeamScheduleShadowKind = "primary",
    ) => {
      const member = data.members.find((item) => item.memberId === memberId);
      const occurrence = scheduleOccurrences.find((item) => item.occurrenceId === occurrenceId);
      if (!member || !occurrence || !selectedTeam) return "Not available";
      if (member.archivedAt) return "Member archived";
      if (!selectedTeam.memberIds.includes(memberId)) return "Not on this team";
      // Being already assigned in this service is the dominant, most actionable
      // reason — it applies even to eligible members and tells the admin the
      // person is taken (vs. simply not eligible). Surface it before the
      // eligibility/blockout checks so those don't mask it.
      if (assignmentKind !== "shadow" && !(member.positionIds || []).includes(positionId)) {
        return "Not eligible for this position";
      }
      if (serviceDateBlockedOut(member, getOccurrenceDate(occurrence, serviceTimeZone))) return "Blocked out";
      if (!isMemberAvailableOnDate(member, getOccurrenceDate(occurrence, serviceTimeZone))) {
        return "Unavailable this week of the month";
      }
      // Intake service availability is intentionally not a hard block; it is
      // surfaced as a soft warning. Blockouts and recurring availability need
      // an explicit confirmation before a manual assignment can continue.
      return "";
    },
    [data.members, scheduleOccurrences, selectedTeam, serviceTimeZone],
  );

  // Soft, non-blocking warning: the member marked this service unavailable on an
  // intake form. They can still be scheduled (e.g. you confirmed with them), but
  // the scheduler should know. Empty string when there's nothing to warn about.
  const getServiceAvailabilityWarning = useCallback(
    (memberId: string, occurrenceId: string) => {
      const member = data.members.find((item) => item.memberId === memberId);
      if (member?.serviceAvailability?.[occurrenceId] === "unavailable") {
        return "Marked this service unavailable on intake";
      }
      return "";
    },
    [data.members],
  );

  const getBlockoutWarning = useCallback(
    (memberId: string, occurrenceId: string) => {
      const member = data.members.find((item) => item.memberId === memberId);
      const occurrence = scheduleOccurrences.find(
        (item) => item.occurrenceId === occurrenceId,
      );
      return member && occurrence && serviceDateBlockedOut(member, getOccurrenceDate(occurrence, serviceTimeZone))
        ? "Blocked out"
        : "";
    },
    [data.members, scheduleOccurrences, serviceTimeZone],
  );

  const [isSendingSchedule, setIsSendingSchedule] = useState(false);
  const [isConfirmingSend, setIsConfirmingSend] = useState(false);

  /**
   * How many distinct people a send would email. Shown before the click,
   * because sending is irreversible — there is no unsend, and an owner
   * exploring the button should not discover what it does by mailing the whole
   * team. Counts people, not slots: someone on four services gets one email.
   */
  const sendRecipientCount = useMemo(() => {
    const holders = new Set<string>();
    Object.values(selectedSchedule?.assignments || {}).forEach((row) => {
      Object.values(row || {}).forEach((cell) => {
        getCellMemberIds(cell).forEach((id) => holders.add(id));
      });
    });
    return holders.size;
  }, [selectedSchedule?.assignments]);

  /**
   * Tell everyone on this schedule. Deliberately a button rather than a
   * side-effect of saving: an owner shuffles the grid for a while, and mailing
   * on every change trains volunteers to ignore the emails.
   *
   * Re-sending is safe and is the normal way schedules get built — the server
   * skips anyone already told about a service, so this only reaches newly
   * added slots.
   */
  const handleSendSchedule = useCallback(async () => {
    if (!selectedSchedule || !churchId) return;
    setIsSendingSchedule(true);
    try {
      const schedule = await ensureActiveSchedule();
      if (!schedule) return;
      const result = await sendTeamSchedule(
        churchId,
        schedule.scheduleId,
      );
      await refreshScheduleNotificationHistory(schedule.scheduleId);
      const unreachable = result.unreachableMemberIds?.length || 0;
      const sentLabel =
        result.notified === 0
          ? "Everyone on this schedule has already been notified."
          : `Sent to ${result.notified} ${result.notified === 1 ? "person" : "people"}.`;
      // Who could *not* be told is the part worth interrupting for: the failure
      // that matters is an owner assuming everyone knows.
      showToast(
        unreachable > 0
          ? `${sentLabel} ${unreachable} ${unreachable === 1 ? "person has" : "people have"} no email on file.`
          : sentLabel,
        unreachable > 0 ? "warning" : "success",
      );
      onScheduleSaved({ ...schedule, sentAt: result.sentAt });
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not send this schedule.");
    } finally {
      setIsSendingSchedule(false);
      setIsConfirmingSend(false);
    }
  }, [churchId, ensureActiveSchedule, onScheduleSaved, refreshScheduleNotificationHistory, selectedSchedule, showToast]);

  const commitAssignment = async ({
    serviceId,
    cellKey,
    basePositionId,
    memberId,
    sourceServiceId,
    sourcePositionSlotKey,
    allowBlockout = false,
    allowRecurringAvailability = false,
    confirmedOccurrenceConflictFingerprint,
  }: {
    serviceId: string;
    cellKey: string;
    basePositionId: string;
    memberId: string | null;
    sourceServiceId?: string;
    sourcePositionSlotKey?: string;
    allowBlockout?: boolean;
    allowRecurringAvailability?: boolean;
    confirmedOccurrenceConflictFingerprint?: string;
  }) => {
    if (!canEdit) return;
    if (!selectedSchedule) return;
    const previousSchedule = selectedSchedule;
    const occurrence = scheduleOccurrences.find((item) => item.occurrenceId === serviceId);
    if (memberId) {
      const issue = getAssignmentIssue(memberId, serviceId, basePositionId, {
        serviceId: sourceServiceId,
        positionId: sourcePositionSlotKey,
      });
      if (issue === "Blocked out" && !allowBlockout) {
        setPendingAvailabilityConfirmation({
          memberId,
          kind: "blockout",
          isMove: Boolean(sourceServiceId && sourcePositionSlotKey),
          onConfirm: () =>
            void commitAssignment({
              serviceId,
              cellKey,
              basePositionId,
              memberId,
              sourceServiceId,
              sourcePositionSlotKey,
              allowBlockout: true,
              allowRecurringAvailability,
            }),
        });
        return;
      }
      if (
        issue === "Unavailable this week of the month" &&
        !allowRecurringAvailability
      ) {
        setPendingAvailabilityConfirmation({
          memberId,
          kind: "recurringAvailability",
          isMove: Boolean(sourceServiceId && sourcePositionSlotKey),
          onConfirm: () =>
            void commitAssignment({
              serviceId,
              cellKey,
              basePositionId,
              memberId,
              sourceServiceId,
              sourcePositionSlotKey,
              allowBlockout,
              allowRecurringAvailability: true,
            }),
        });
        return;
      }
      const blockingIssue =
        (allowBlockout && issue === "Blocked out") ||
          (allowRecurringAvailability &&
            issue === "Unavailable this week of the month")
          ? ""
          : issue;
      if (blockingIssue) {
        showToast(blockingIssue, "neutral");
        return;
      }
    }
    const nextAssignments = { ...(previousSchedule.assignments || {}) };
    let targetRow = { ...(nextAssignments[serviceId] || {}) };
    if (sourceServiceId && sourcePositionSlotKey) {
      const sourceRow = { ...(nextAssignments[sourceServiceId] || {}) };
      const sourceCell = normalizeAssignmentCell(sourceRow[sourcePositionSlotKey]);
      const nextSourceCell = serializeAssignmentCell({
        primaryMemberId: "",
        shadows: sourceCell.shadows,
      });
      if (nextSourceCell) {
        sourceRow[sourcePositionSlotKey] = nextSourceCell;
      } else {
        delete sourceRow[sourcePositionSlotKey];
      }
      if (Object.keys(sourceRow).length > 0) {
        nextAssignments[sourceServiceId] = sourceRow;
      } else {
        delete nextAssignments[sourceServiceId];
      }
      if (sourceServiceId === serviceId) {
        targetRow = sourceRow;
      }
    }
    const targetCell = normalizeAssignmentCell(targetRow[cellKey]);
    const nextTargetCell = serializeAssignmentCell({
      primaryMemberId: memberId || "",
      shadows: targetCell.shadows,
    });
    if (nextTargetCell) {
      targetRow[cellKey] = nextTargetCell;
    } else {
      delete targetRow[cellKey];
    }
    if (Object.keys(targetRow).length > 0) {
      nextAssignments[serviceId] = targetRow;
    } else {
      delete nextAssignments[serviceId];
    }

    const serviceDate = occurrence ? getOccurrenceDate(occurrence, serviceTimeZone) : "";
    const undoChanges: ScheduleCellChange[] = [];
    if (sourceServiceId && sourcePositionSlotKey) {
      const sourceOccurrence = scheduleOccurrences.find(
        (item) => item.occurrenceId === sourceServiceId,
      );
      undoChanges.push({
        occurrenceId: sourceServiceId,
        cellKey: sourcePositionSlotKey,
        serviceDate: sourceOccurrence ? getOccurrenceDate(sourceOccurrence, serviceTimeZone) : "",
        before:
          previousSchedule.assignments?.[sourceServiceId]?.[sourcePositionSlotKey] ?? "",
        after: nextAssignments[sourceServiceId]?.[sourcePositionSlotKey] ?? "",
      });
    }
    undoChanges.push({
      occurrenceId: serviceId,
      cellKey,
      serviceDate,
      before: previousSchedule.assignments?.[serviceId]?.[cellKey] ?? "",
      after: nextAssignments[serviceId]?.[cellKey] ?? "",
    });
    const positionName = positionNameById.get(basePositionId) || "position";

    const stagedEdits: PendingScheduleCellEdit[] = [];
    if (sourceServiceId && sourcePositionSlotKey) {
      const stagedSource = stageScheduleCellEdit(
        previousSchedule,
        "assignments",
        sourceServiceId,
        sourcePositionSlotKey,
        nextAssignments[sourceServiceId]?.[sourcePositionSlotKey] ?? "",
      );
      stagedEdits.push(stagedSource.edit);
    }
    const stagedTarget = stageScheduleCellEdit(
      previousSchedule,
      "assignments",
      serviceId,
      cellKey,
      nextAssignments[serviceId]?.[cellKey] ?? "",
    );
    stagedEdits.push(stagedTarget.edit);
    const optimisticSchedule = applyPendingScheduleCellEdits(
      { ...previousSchedule, assignments: nextAssignments },
      pendingScheduleCellEditsRef.current.values(),
    );
    clearActiveSlot();
    let mutationSchedule = optimisticSchedule;
    let assignmentUndoRecorded = false;

    const restoreAssignmentEdits = () => {
      const active = latestScheduleRef.current;
      let current = active?.scheduleId === mutationSchedule.scheduleId && active.churchId === mutationSchedule.churchId
        ? active
        : schedulesByOwnerRef.current.get(virtualSchedulePreviewKey(mutationSchedule.churchId, mutationSchedule.scheduleId)) || mutationSchedule;
      let changed = false;
      const beforeValues = [
        ...(sourceServiceId && sourcePositionSlotKey ? [{
          occurrenceId: sourceServiceId,
          cellKey: sourcePositionSlotKey,
          value: previousSchedule.assignments?.[sourceServiceId]?.[sourcePositionSlotKey] ?? "",
        }] : []),
        {
          occurrenceId: serviceId,
          cellKey,
          value: previousSchedule.assignments?.[serviceId]?.[cellKey] ?? "",
        },
      ];
      stagedEdits.forEach((edit) => {
        if (!clearScheduleCellEdit(edit)) return;
        const before = beforeValues.find((item) => item.occurrenceId === edit.occurrenceId && item.cellKey === edit.cellKey);
        if (!before) return;
        current = setScheduleCellMapValue(current, "assignments", edit.occurrenceId, edit.cellKey, before.value);
        changed = true;
      });
      if (changed) publishScheduleSnapshot(current, ["assignments"]);
    };
    const saveAssignment = async (fingerprint?: string): Promise<void> => {
      try {
        const ensuredSchedule = await ensureActiveSchedule(mutationSchedule);
        if (!ensuredSchedule) return;
        mutationSchedule = ensuredSchedule;
        stagedEdits.forEach((edit, index) => {
          const remappedEdit = [...pendingScheduleCellEditsRef.current.values()].find((pendingEdit) =>
            pendingEdit.churchId === edit.churchId &&
            pendingEdit.scheduleId === ensuredSchedule.scheduleId &&
            pendingEdit.field === edit.field &&
            pendingEdit.occurrenceId === edit.occurrenceId &&
            pendingEdit.cellKey === edit.cellKey &&
            pendingEdit.sequence === edit.sequence,
          );
          if (remappedEdit) stagedEdits[index] = remappedEdit;
        });
        const response = await enqueueAssignmentSave(ensuredSchedule.scheduleId, () => updateTeamScheduleAssignment(
          churchId,
          ensuredSchedule.scheduleId,
          {
            serviceId,
            positionSlotKey: cellKey,
            memberId,
            serviceDate,
            sourceServiceId,
            sourcePositionSlotKey,
            ...(allowBlockout ? { allowBlockout: true } : {}),
            ...(allowRecurringAvailability
              ? { allowRecurringAvailability: true }
              : {}),
            ...assignmentConflictPayload(fingerprint),
          },
        ));
        if (!assignmentUndoRecorded) {
          assignmentUndoRecorded = true;
          recordAssignmentChange(
            sourceServiceId
              ? `move ${describeMemberName(memberId)}`
              : memberId
                ? `assign ${describeMemberName(memberId)} to ${positionName}`
                : `remove ${describeMemberName(targetCell.primaryMemberId)} from ${positionName}`,
            undoChanges,
            ensuredSchedule.scheduleId,
          );
        }
        publishScheduleCellResponses(response.schedule, "assignments", stagedEdits);
        stagedEdits.forEach(clearScheduleCellEdit);
        publishScheduleCellResponses(response.schedule, "assignments", stagedEdits);
      } catch (error) {
        const conflictDetails = memberId ? getOccurrenceConflictDetails(error) : null;
        if (conflictDetails) {
          requestCrossTeamConflictConfirmation({
            memberId: memberId || "",
            warning: "already scheduled in an overlapping service",
            ...conflictDetails,
            isMove: Boolean(sourceServiceId && sourcePositionSlotKey),
            onConfirm: () => {
              void saveAssignment(conflictDetails.fingerprint);
            },
            onCancel: restoreAssignmentEdits,
          });
          return;
        }
        const allEditsStillCurrent = stagedEdits.every((edit) => {
          const key = scheduleCellEditKey(edit.churchId, edit.scheduleId, edit.field, edit.occurrenceId, edit.cellKey);
          return pendingScheduleCellEditsRef.current.get(key)?.sequence === edit.sequence;
        });
        if (!allEditsStillCurrent) {
          showApiErrorToast(showToast, error, "A newer assignment is still being saved.");
          return;
        }
        const toastId = showToast({
          message: "Couldn't save this assignment. Your choice is still here. Retry the save when ready.",
          variant: "error",
          persist: true,
          children: (
            <div className="mt-2 flex justify-center">
              <Button variant="primary" className="text-sm" onClick={() => {
                const stillCurrent = stagedEdits.every((edit) => {
                  const key = scheduleCellEditKey(edit.churchId, edit.scheduleId, edit.field, edit.occurrenceId, edit.cellKey);
                  return pendingScheduleCellEditsRef.current.get(key)?.sequence === edit.sequence;
                });
                removeToast(toastId);
                if (stillCurrent) void saveAssignment(fingerprint);
              }}>Retry save</Button>
            </div>
          ),
        });
      }
    };
    void saveAssignment(confirmedOccurrenceConflictFingerprint);
  };

  const commitGuestAssignment = async (
    guest: Omit<TeamScheduleGuest, "guestId"> & { guestId?: string },
  ) => {
    if (!canEdit || !selectedSchedule || !activeSlot) return;
    const occurrence = scheduleOccurrences.find(
      (item) => item.occurrenceId === activeSlot.occurrenceId,
    );
    const column = scheduleColumns.find(
      (item) => item.columnKey === activeSlot.columnKey,
    );
    if (!occurrence || !column) return;

    const previousSchedule = selectedSchedule;
    const before =
      previousSchedule.assignments?.[activeSlot.occurrenceId]?.[
      activeSlot.columnKey
      ] ?? "";
    const moveSource = guest.guestId
      ? getActiveSlotMoveSource(guest.guestId)
      : null;
    const sourceBefore = moveSource
      ? previousSchedule.assignments?.[moveSource.serviceId]?.[
        moveSource.positionSlotKey
      ] ?? ""
      : "";
    try {
      const schedule = await ensureActiveSchedule();
      if (!schedule) return;
      const response = await enqueueAssignmentSave(schedule.scheduleId, () =>
        updateTeamScheduleAssignment(churchId, schedule.scheduleId, {
          serviceId: activeSlot.occurrenceId,
          positionSlotKey: activeSlot.columnKey,
          memberId: null,
          guest,
          serviceDate: getOccurrenceDate(occurrence, serviceTimeZone),
          sourceServiceId: moveSource?.serviceId,
          sourcePositionSlotKey: moveSource?.positionSlotKey,
        }),
      );
      const after =
        response.schedule.assignments?.[activeSlot.occurrenceId]?.[
        activeSlot.columnKey
        ] ?? "";
      onScheduleSaved(response.schedule);
      const changes: ScheduleCellChange[] = [];
      if (moveSource) {
        changes.push({
          occurrenceId: moveSource.serviceId,
          cellKey: moveSource.positionSlotKey,
          serviceDate: getOccurrenceDate(occurrence, serviceTimeZone),
          before: sourceBefore,
          after: response.schedule.assignments?.[moveSource.serviceId]?.[
            moveSource.positionSlotKey
          ] ?? "",
        });
      }
      changes.push(
        {
          occurrenceId: activeSlot.occurrenceId,
          cellKey: activeSlot.columnKey,
          serviceDate: getOccurrenceDate(occurrence, serviceTimeZone),
          before,
          after,
        },
      );
      recordAssignmentChange(
        `${moveSource ? "move" : "assign"} ${guest.name} to ${column.label}`,
        changes,
      );
      clearActiveSlot();
      showToast(`${guest.name} added as a guest.`, "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not assign this guest.");
      throw error;
    }
  };

  const commitGuestEdit = async (guest: TeamScheduleGuest) => {
    if (!canEdit || !selectedSchedule) return;
    try {
      const schedule = await ensureActiveSchedule();
      if (!schedule) return;
      const response = await enqueueAssignmentSave(schedule.scheduleId, () =>
        updateTeamScheduleGuest(churchId, schedule.scheduleId, guest),
      );
      onScheduleSaved(response.schedule);
      showToast("Guest details updated.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not update this guest.");
      throw error;
    }
  };

  const commitGuestRemoval = async (guest: TeamScheduleGuest) => {
    if (!canEdit || !selectedSchedule || !editableScheduleGuestIds.has(guest.guestId)) return false;
    const owner = `${churchId}:${selectedSchedule.scheduleId}`;
    const assignmentCount = Object.values(selectedSchedule.assignments || {}).reduce(
      (count, row) => count + Object.values(row || {}).filter((cell) =>
        getCellPrimaryMemberId(cell) === guest.guestId ||
        getCellShadowAssignments(cell).some((shadow) => shadow.memberId === guest.guestId),
      ).length,
      0,
    );
    const confirmation = assignmentCount
      ? `Remove ${guest.name} from this schedule? This will clear ${assignmentCount} ${assignmentCount === 1 ? "assignment" : "assignments"}.`
      : `Remove ${guest.name} from this schedule?`;
    if (guestRemovalResolveRef.current) return false;
    const confirmed = await new Promise<boolean>((resolve) => {
      guestRemovalResolveRef.current = resolve;
      setGuestRemovalConfirmation(confirmation);
    });
    if (!confirmed || guestRemovalOwnerRef.current !== owner) return false;
    try {
      const schedule = await ensureActiveSchedule();
      if (!schedule || !schedule.guests?.some((item) => item.guestId === guest.guestId)) return false;
      const response = await enqueueAssignmentSave(schedule.scheduleId, () =>
        removeTeamScheduleGuest(churchId, schedule.scheduleId, guest.guestId),
      );
      onScheduleSaved(response.schedule);
      showToast("Guest removed from this schedule.", "success");
      return true;
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not remove this guest.");
      throw error;
    }
  };

  const requestCellMemberAction = ({
    serviceId,
    cellKey,
    basePositionId,
    memberId,
    currentPrimaryMemberId,
    sourceServiceId,
    sourcePositionSlotKey,
  }: {
    serviceId: string;
    cellKey: string;
    basePositionId: string;
    memberId: string;
    currentPrimaryMemberId: string;
    sourceServiceId?: string;
    sourcePositionSlotKey?: string;
  }) => {
    if (!canEdit) return;
    if (memberId === currentPrimaryMemberId) return;
    if (currentPrimaryMemberId) {
      const nextPending: PendingCellAssignment = {
        scheduleId: selectedSchedule?.scheduleId,
        serviceId,
        cellKey,
        basePositionId,
        memberId,
        sourceServiceId,
        sourcePositionSlotKey,
      };
      pendingCellAssignmentRef.current = nextPending;
      setPendingCellAssignment(nextPending);
      return;
    }
    if (sourceServiceId && sourcePositionSlotKey) {
      setPendingMoveAssignment({
        scheduleId: selectedSchedule?.scheduleId,
        serviceId,
        cellKey,
        basePositionId,
        memberId,
        sourceServiceId,
        sourcePositionSlotKey,
      });
      return;
    }
    void commitAssignment({
      serviceId,
      cellKey,
      basePositionId,
      memberId,
      sourceServiceId,
      sourcePositionSlotKey,
    });
  };

  const confirmPendingReplace = () => {
    if (!canEdit) return;
    const pending = pendingCellAssignmentRef.current;
    if (!pending) return;
    setPendingCellAssignment(null);
    if (pending.sourceServiceId && pending.sourcePositionSlotKey) {
      setPendingMoveAssignment(pending);
      return;
    }
    void commitAssignment({
      serviceId: pending.serviceId,
      cellKey: pending.cellKey,
      basePositionId: pending.basePositionId,
      memberId: pending.memberId,
      sourceServiceId: pending.sourceServiceId,
      sourcePositionSlotKey: pending.sourcePositionSlotKey,
    });
  };

  const confirmPendingMove = () => {
    if (!canEdit || !pendingMoveAssignment) return;
    const pending = pendingMoveAssignment;
    if (!selectedSchedule || pending.scheduleId !== selectedSchedule.scheduleId) {
      setPendingMoveAssignment(null);
      showToast("The schedule changed. Choose this move again.", "neutral");
      return;
    }
    setPendingMoveAssignment(null);
    void commitAssignment({
      serviceId: pending.serviceId,
      cellKey: pending.cellKey,
      basePositionId: pending.basePositionId,
      memberId: pending.memberId,
      sourceServiceId: pending.sourceServiceId,
      sourcePositionSlotKey: pending.sourcePositionSlotKey,
    });
  };

  const confirmPendingShadow = (shadowKind: TeamScheduleShadowKind) => {
    if (!canEdit) return;
    const pending = pendingCellAssignmentRef.current;
    if (!pending) return;
    setPendingCellAssignment(null);
    void commitShadowAssignment({
      serviceId: pending.serviceId,
      cellKey: pending.cellKey,
      basePositionId: pending.basePositionId,
      memberId: pending.memberId,
      shadowKind,
      action: "add",
    });
  };

  const getAssignmentActionIssues = useCallback(
    (
      memberId: string,
      occurrenceId: string,
      positionId: string,
      source?: { serviceId?: string; positionId?: string },
    ) => ({
      replace: getAssignmentIssue(memberId, occurrenceId, positionId, source),
      shadow: getAssignmentIssue(memberId, occurrenceId, positionId, undefined, "shadow"),
      reverseShadow: getAssignmentIssue(
        memberId,
        occurrenceId,
        positionId,
        undefined,
        "reverse_shadow",
      ),
    }),
    [getAssignmentIssue],
  );

  const handleAssignmentAction = ({
    serviceId,
    cellKey,
    basePositionId,
    memberId,
    action,
    sourceServiceId,
    sourcePositionSlotKey,
  }: {
    serviceId: string;
    cellKey: string;
    basePositionId: string;
    memberId: string;
    action: "replace" | TeamScheduleShadowKind;
    sourceServiceId?: string;
    sourcePositionSlotKey?: string;
  }) => {
    if (!canEdit) return;
    if (action === "replace") {
      void commitAssignment({
        serviceId,
        cellKey,
        basePositionId,
        memberId,
        sourceServiceId,
        sourcePositionSlotKey,
      });
      return;
    }
    void commitShadowAssignment({
      serviceId,
      cellKey,
      basePositionId,
      memberId,
      shadowKind: action,
      action: "add",
    });
  };

  const commitShadowAssignment = async ({
    serviceId,
    cellKey,
    basePositionId,
    memberId,
    shadowKind,
    action,
    allowBlockout = false,
    allowRecurringAvailability = false,
    confirmedOccurrenceConflictFingerprint,
  }: {
    serviceId: string;
    cellKey: string;
    basePositionId: string;
    memberId: string;
    shadowKind: TeamScheduleShadowKind;
    action: "add" | "remove";
    allowBlockout?: boolean;
    allowRecurringAvailability?: boolean;
    confirmedOccurrenceConflictFingerprint?: string;
  }) => {
    if (!canEdit) return;
    if (!selectedSchedule) return;
    const previousSchedule = selectedSchedule;
    const occurrence = scheduleOccurrences.find((item) => item.occurrenceId === serviceId);
    if (action === "add") {
      const issue = getAssignmentIssue(
        memberId,
        serviceId,
        basePositionId,
        undefined,
        shadowKind,
      );
      if (issue === "Blocked out" && !allowBlockout) {
        setPendingAvailabilityConfirmation({
          memberId,
          kind: "blockout",
          onConfirm: () =>
            void commitShadowAssignment({
              serviceId,
              cellKey,
              basePositionId,
              memberId,
              shadowKind,
              action,
              allowBlockout: true,
              allowRecurringAvailability,
            }),
        });
        return;
      }
      if (
        issue === "Unavailable this week of the month" &&
        !allowRecurringAvailability
      ) {
        setPendingAvailabilityConfirmation({
          memberId,
          kind: "recurringAvailability",
          onConfirm: () =>
            void commitShadowAssignment({
              serviceId,
              cellKey,
              basePositionId,
              memberId,
              shadowKind,
              action,
              allowBlockout,
              allowRecurringAvailability: true,
            }),
        });
        return;
      }
      const blockingIssue =
        (allowBlockout && issue === "Blocked out") ||
          (allowRecurringAvailability &&
            issue === "Unavailable this week of the month")
          ? ""
          : issue;
      if (blockingIssue) {
        showToast(blockingIssue, "neutral");
        return;
      }
    }

    const nextAssignments = { ...(previousSchedule.assignments || {}) };
    const targetRow = { ...(nextAssignments[serviceId] || {}) };
    const targetCell = normalizeAssignmentCell(targetRow[cellKey]);
    const nextShadows =
      action === "add"
        ? [
          ...targetCell.shadows.filter((shadow) => shadow.memberId !== memberId),
          { memberId, kind: shadowKind },
        ]
        : targetCell.shadows.filter(
          (shadow) => !(shadow.memberId === memberId && shadow.kind === shadowKind),
        );
    const nextTargetCell = serializeAssignmentCell({
      primaryMemberId: targetCell.primaryMemberId,
      shadows: nextShadows,
    });
    if (nextTargetCell) {
      targetRow[cellKey] = nextTargetCell;
    } else {
      delete targetRow[cellKey];
    }
    if (Object.keys(targetRow).length > 0) {
      nextAssignments[serviceId] = targetRow;
    } else {
      delete nextAssignments[serviceId];
    }

    const serviceDate = occurrence ? getOccurrenceDate(occurrence, serviceTimeZone) : "";
    const before = previousSchedule.assignments?.[serviceId]?.[cellKey] ?? "";
    const after = nextAssignments[serviceId]?.[cellKey] ?? "";
    const staged = stageScheduleCellEdit(
      previousSchedule,
      "assignments",
      serviceId,
      cellKey,
      after,
    );
    const optimisticSchedule = staged.optimistic;
    let mutationSchedule = optimisticSchedule;
    let shadowUndoRecorded = false;
    if (action === "add") {
      clearActiveSlot();
    }
    const isShadowEditPending = (scheduleId: string) =>
      [...pendingScheduleCellEditsRef.current.values()].some((edit) =>
        edit.churchId === staged.edit.churchId &&
        edit.scheduleId === scheduleId &&
        edit.field === staged.edit.field &&
        edit.occurrenceId === staged.edit.occurrenceId &&
        edit.cellKey === staged.edit.cellKey &&
        edit.sequence === staged.edit.sequence,
      );
    const saveShadow = async (fingerprint?: string): Promise<void> => {
      // The operator may have removed or replaced this shadow while a failed
      // save's Retry button was still visible.
      if (!scheduleTabMountedRef.current || !isShadowEditPending(mutationSchedule.scheduleId)) return;
      try {
        const ensuredSchedule = await ensureActiveSchedule(mutationSchedule);
        if (!ensuredSchedule) return;
        mutationSchedule = ensuredSchedule;
        if (!isShadowEditPending(ensuredSchedule.scheduleId)) return;
        const persistedEdit = [...pendingScheduleCellEditsRef.current.values()].find((edit) =>
          edit.churchId === staged.edit.churchId &&
          edit.scheduleId === ensuredSchedule.scheduleId &&
          edit.field === staged.edit.field &&
          edit.occurrenceId === staged.edit.occurrenceId &&
          edit.cellKey === staged.edit.cellKey &&
          edit.sequence === staged.edit.sequence,
        );
        if (!persistedEdit) return;
        const response = await enqueueAssignmentSave(ensuredSchedule.scheduleId, async () => {
          if (!isShadowEditPending(ensuredSchedule.scheduleId)) return null;
          return updateTeamScheduleAssignment(
          churchId,
          ensuredSchedule.scheduleId,
          {
            serviceId,
            positionSlotKey: cellKey,
            memberId,
            serviceDate,
            shadowAction: action,
            shadowKind,
            ...(allowBlockout ? { allowBlockout: true } : {}),
            ...(allowRecurringAvailability
              ? { allowRecurringAvailability: true }
              : {}),
            ...assignmentConflictPayload(fingerprint),
          },
        );
        });
        if (!response) return;
        if (!shadowUndoRecorded) {
          shadowUndoRecorded = true;
          recordAssignmentChange(
            `${action === "add" ? "add" : "remove"} ${describeMemberName(memberId)} as ${shadowKindLabel(shadowKind).toLowerCase()}`,
            [{ occurrenceId: serviceId, cellKey, serviceDate, before, after }],
            ensuredSchedule.scheduleId,
          );
        }
        publishScheduleCellResponses(response.schedule, "assignments", [persistedEdit]);
        clearScheduleCellEdit(persistedEdit);
        publishScheduleCellResponses(response.schedule, "assignments", [persistedEdit]);
      } catch (error) {
        if (!scheduleTabMountedRef.current || !isShadowEditPending(mutationSchedule.scheduleId)) return;
        const conflictDetails = action === "add" ? getOccurrenceConflictDetails(error) : null;
        if (conflictDetails) {
          requestCrossTeamConflictConfirmation({
            memberId,
            warning: "already scheduled in an overlapping service",
            ...conflictDetails,
            onConfirm: () =>
              void saveShadow(conflictDetails.fingerprint),
            onCancel: () => {
              const key = scheduleCellEditKey(
                staged.edit.churchId,
                mutationSchedule.scheduleId,
                staged.edit.field,
                staged.edit.occurrenceId,
                staged.edit.cellKey,
              );
              const currentEdit = pendingScheduleCellEditsRef.current.get(key);
              if (currentEdit?.sequence !== staged.edit.sequence) return;
              clearScheduleCellEdit(currentEdit);
              const current = schedulesByOwnerRef.current.get(virtualSchedulePreviewKey(
                mutationSchedule.churchId,
                mutationSchedule.scheduleId,
              )) || mutationSchedule;
              publishScheduleSnapshot(
                setScheduleCellMapValue(current, "assignments", serviceId, cellKey, before),
                ["assignments"],
              );
            },
          });
          return;
        }
        const retryKey = scheduleCellEditKey(
          staged.edit.churchId, mutationSchedule.scheduleId, staged.edit.field,
          staged.edit.occurrenceId, staged.edit.cellKey,
        );
        const previousToastId = scheduleCellSaveToastIdsRef.current.get(retryKey);
        if (previousToastId) removeToast(previousToastId);
        const toastId = showToast({
          message: "Couldn't save this shadow assignment. Your choice is still here. Retry the save when ready.",
          variant: "error",
          persist: true,
          children: (
            <div className="mt-2 flex justify-center">
              <Button variant="primary" className="text-sm" onClick={() => {
                removeToast(toastId);
                if (!isShadowEditPending(mutationSchedule.scheduleId)) return;
                scheduleCellSaveToastIdsRef.current.delete(retryKey);
                void saveShadow(fingerprint);
              }}>Retry save</Button>
            </div>
          ),
        });
        scheduleCellSaveToastIdsRef.current.set(retryKey, toastId);
      }
    };
    void saveShadow(confirmedOccurrenceConflictFingerprint);
  };

  // Fill a whole occurrence row at once from a pasted Excel row. Re-validates
  // every entry against the current schedule (eligibility, blockout, already
  // assigned) and dedupes within the batch, applies them as one optimistic
  // update, then persists each cell through the same serialized queue as manual
  // assignment. A failed batch keeps its staged choices available for retry.
  const commitRowAssignments = async (
    occurrenceId: string,
    entries: RowPasteApplyEntry[],
    confirmedOccurrenceConflictFingerprint?: string,
  ) => {
    if (!canEdit || !selectedSchedule || entries.length === 0) return;
    const previousSchedule = selectedSchedule;
    const occurrence = scheduleOccurrences.find(
      (item) => item.occurrenceId === occurrenceId,
    );
    const serviceDate = occurrence ? getOccurrenceDate(occurrence, serviceTimeZone) : "";

    let nextAssignments = { ...(selectedSchedule.assignments || {}) };
    let targetRow = { ...(nextAssignments[occurrenceId] || {}) };
    const applied: RowPasteApplyEntry[] = [];
    const usedMemberIds = new Set<string>();
    for (const entry of entries) {
      if (usedMemberIds.has(entry.memberId)) continue;
      if (getAssignmentIssue(entry.memberId, occurrenceId, entry.positionId)) continue;
      const cell = normalizeAssignmentCell(targetRow[entry.columnKey]);
      const nextCell = serializeAssignmentCell({
        primaryMemberId: entry.memberId,
        shadows: cell.shadows,
      });
      if (!nextCell) continue;
      targetRow[entry.columnKey] = nextCell;
      usedMemberIds.add(entry.memberId);
      applied.push(entry);
    }
    if (applied.length === 0) {
      showToast("Those slots changed — nothing to paste.", "neutral");
      return;
    }

    if (Object.keys(targetRow).length > 0) {
      nextAssignments[occurrenceId] = targetRow;
    } else {
      delete nextAssignments[occurrenceId];
    }

    const changes = applied.map((entry) => ({
      serviceId: occurrenceId,
      positionSlotKey: entry.columnKey,
      serviceDate,
      expectedCell: previousSchedule.assignments?.[occurrenceId]?.[entry.columnKey] || "" as const,
      assignment: nextAssignments[occurrenceId]?.[entry.columnKey] || "" as const,
    }));
    const stagedEdits = changes.map((change) => stageScheduleCellEdit(
      previousSchedule,
      "assignments",
      change.serviceId,
      change.positionSlotKey,
      change.assignment,
    ).edit);
    const optimisticSchedule = applyPendingScheduleCellEdits(
      { ...previousSchedule, assignments: nextAssignments },
      pendingScheduleCellEditsRef.current.values(),
    );
    let mutationSchedule = optimisticSchedule;
    let historyRecorded = false;
    const restore = () => {
      let current = schedulesByOwnerRef.current.get(virtualSchedulePreviewKey(
        mutationSchedule.churchId,
        mutationSchedule.scheduleId,
      )) || mutationSchedule;
      let changed = false;
      stagedEdits.forEach((edit, index) => {
        if (!clearScheduleCellEdit(edit)) return;
        const change = changes[index];
        if (!change) return;
        current = setScheduleCellMapValue(current, "assignments", change.serviceId, change.positionSlotKey, change.expectedCell);
        changed = true;
      });
      if (changed) publishScheduleSnapshot(current, ["assignments"]);
    };

    const save = async (fingerprint?: string): Promise<void> => {
      try {
        const schedule = await ensureActiveSchedule(mutationSchedule);
        if (!schedule) return;
        mutationSchedule = schedule;
        const persistedEdits = stagedEdits.map((edit) => [...pendingScheduleCellEditsRef.current.values()].find((pendingEdit) =>
          pendingEdit.churchId === edit.churchId &&
          pendingEdit.scheduleId === schedule.scheduleId &&
          pendingEdit.field === edit.field &&
          pendingEdit.occurrenceId === edit.occurrenceId &&
          pendingEdit.cellKey === edit.cellKey &&
          pendingEdit.sequence === edit.sequence,
        ) || edit);
        const response = await enqueueAssignmentSave(schedule.scheduleId, () => updateTeamScheduleAssignmentsBatch(
          churchId,
          schedule.scheduleId,
          { changes, ...assignmentConflictPayload(fingerprint) },
        ));
        if (!historyRecorded) {
          historyRecorded = true;
          recordAssignmentChange(`paste ${applied.length} assignments`, changes.map((change) => ({
            occurrenceId: change.serviceId,
            cellKey: change.positionSlotKey,
            serviceDate: change.serviceDate,
            before: change.expectedCell,
            after: change.assignment,
          })), schedule.scheduleId);
        }
        publishScheduleCellResponses(response.schedule, "assignments", persistedEdits);
        persistedEdits.forEach(clearScheduleCellEdit);
        publishScheduleCellResponses(response.schedule, "assignments", persistedEdits);
        showToast(
          `Assigned ${applied.length} ${applied.length === 1 ? "person" : "people"} from your pasted row.`,
          "success",
        );
      } catch (error) {
        const conflictDetails = getOccurrenceConflictDetails(error);
        if (conflictDetails) {
          requestCrossTeamConflictConfirmation({
            memberId: conflictDetails.conflicts[0]?.memberId || applied[0].memberId,
            warning: "already scheduled in an overlapping service",
            ...conflictDetails,
            onConfirm: () => void save(conflictDetails.fingerprint),
            onCancel: restore,
          });
          return;
        }
        const toastId = showToast({
          message: "Couldn't paste these assignments. Your choices are still here. Retry the save when ready.",
          variant: "error",
          persist: true,
          children: (
            <div className="mt-2 flex justify-center">
              <Button variant="primary" className="text-sm" onClick={() => {
                removeToast(toastId);
                void save(fingerprint);
              }}>Retry save</Button>
            </div>
          ),
        });
      }
    };
    await save(confirmedOccurrenceConflictFingerprint);
  };

  // Writes an auto-fill plan's entries the same way commitRowAssignments does,
  // except the optimistic update is revealed one slot at a time (with a brief
  // highlight) instead of all at once, so the fill reads as something that
  // happened rather than a single instantaneous jump. The reveal is purely
  // local state — network persistence still runs as one batch afterward, so
  // the animation's pacing isn't at the mercy of network latency, and undo/redo
  // still treats the whole batch as one step. Auto-fill only ever targets slots
  // that were empty, so this never overwrites an existing assignment.
  const commitAutoFillAssignments = async (
    entries: AutoFillEntry[],
    unfilledCount: number,
  ) => {
    if (!canEdit || !selectedSchedule || entries.length === 0) return;
    let previousSchedule: TeamSchedule;
    try {
      const ensuredSchedule = await ensureActiveSchedule();
      if (!ensuredSchedule) return;
      previousSchedule = ensuredSchedule;
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not start this schedule.");
      return;
    }
    const serviceDateByOccurrenceId = new Map(
      scheduleOccurrences.map((occurrence) => [
        occurrence.occurrenceId,
        getOccurrenceDate(occurrence, serviceTimeZone),
      ]),
    );

    // Precompute the full before/after diff up front so undo/redo treats the
    // whole batch as one step, independent of how the reveal below is paced.
    const finalAssignments = { ...(previousSchedule.assignments || {}) };
    const undoChanges: ScheduleCellChange[] = [];
    const batchChanges: Array<{
      serviceId: string;
      positionSlotKey: string;
      serviceDate: string;
      expectedCell: ScheduleCellState;
      assignment: ScheduleCellState;
    }> = [];
    entries.forEach((entry) => {
      const targetRow = { ...(finalAssignments[entry.occurrenceId] || {}) };
      const before = serializeAssignmentCell(
        normalizeAssignmentCell(
          previousSchedule.assignments?.[entry.occurrenceId]?.[entry.columnKey],
        ),
      ) || "";
      const cell = normalizeAssignmentCell(targetRow[entry.columnKey]);
      const nextCell = serializeAssignmentCell({
        primaryMemberId: entry.memberId,
        shadows: cell.shadows,
      });
      if (nextCell) {
        targetRow[entry.columnKey] = nextCell;
      }
      finalAssignments[entry.occurrenceId] = targetRow;
      undoChanges.push({
        occurrenceId: entry.occurrenceId,
        cellKey: entry.columnKey,
        serviceDate: serviceDateByOccurrenceId.get(entry.occurrenceId) || "",
        before,
        after: finalAssignments[entry.occurrenceId]?.[entry.columnKey] ?? "",
      });
      batchChanges.push({
        serviceId: entry.occurrenceId,
        positionSlotKey: entry.columnKey,
        serviceDate: serviceDateByOccurrenceId.get(entry.occurrenceId) || "",
        expectedCell: before,
        assignment: nextCell || "",
      });
    });
    const totalOpenSlots = entries.length + unfilledCount;
    const gapLabel = unfilledCount
      ? ` ${unfilledCount} slot${unfilledCount === 1 ? "" : "s"} ${unfilledCount === 1 ? "needs" : "need"
      } a person you'll have to assign manually.`
      : "";
    // Persist the completed plan as one targeted assignment batch. This keeps
    // the save independent of filtered occurrence lists and unrelated schedule
    // state. Start saving before the local reveal so both run together, then
    // keep autoFilling true until this request settles.
    let saveFailed = false;
    let historyRecorded = false;
    const pendingAutoFillEdits = new Map<string, PendingScheduleCellEdit>();
    const preserveAutoFillChoices = () => {
      let current = schedulesByOwnerRef.current.get(virtualSchedulePreviewKey(
        previousSchedule.churchId,
        previousSchedule.scheduleId,
      )) || previousSchedule;
      batchChanges.forEach((change) => {
        const key = scheduleCellEditKey(
          current.churchId,
          current.scheduleId,
          "assignments",
          change.serviceId,
          change.positionSlotKey,
        );
        if (pendingScheduleCellEditsRef.current.has(key)) return;
        const cell = current.assignments?.[change.serviceId]?.[change.positionSlotKey] ?? "";
        if (!cellsMatch(cell, change.expectedCell) && !cellsMatch(cell, change.assignment)) return;
        const staged = stageScheduleCellEdit(
          current,
          "assignments",
          change.serviceId,
          change.positionSlotKey,
          change.assignment,
        );
        pendingAutoFillEdits.set(key, staged.edit);
        current = staged.optimistic;
      });
    };
    const restoreAutoFillChoices = () => {
      let current = schedulesByOwnerRef.current.get(virtualSchedulePreviewKey(
        previousSchedule.churchId,
        previousSchedule.scheduleId,
      )) || previousSchedule;
      let changed = false;
      for (const [key, edit] of pendingAutoFillEdits) {
        if (pendingScheduleCellEditsRef.current.get(key)?.sequence !== edit.sequence) continue;
        const change = batchChanges.find((item) =>
          item.serviceId === edit.occurrenceId && item.positionSlotKey === edit.cellKey,
        );
        if (!change || !clearScheduleCellEdit(edit)) continue;
        current = setScheduleCellMapValue(
          current,
          "assignments",
          change.serviceId,
          change.positionSlotKey,
          change.expectedCell,
        );
        changed = true;
      }
      if (changed) publishScheduleSnapshot(current, ["assignments"]);
    };
    const saveWithConflictConfirmation = async (fingerprint?: string): Promise<void> => {
      try {
        const response = await enqueueAssignmentSave(previousSchedule.scheduleId, () =>
          updateTeamScheduleAssignmentsBatch(churchId, previousSchedule.scheduleId, {
            changes: batchChanges,
            ...assignmentConflictPayload(fingerprint),
          }),
        );
        publishScheduleCellResponses(response.schedule, "assignments", batchChanges.map((change) => ({
          occurrenceId: change.serviceId,
          cellKey: change.positionSlotKey,
        })));
        for (const [key, edit] of pendingAutoFillEdits) {
          if (pendingScheduleCellEditsRef.current.get(key)?.sequence === edit.sequence) {
            clearScheduleCellEdit(edit);
          }
        }
        publishScheduleCellResponses(response.schedule, "assignments", batchChanges.map((change) => ({
          occurrenceId: change.serviceId,
          cellKey: change.positionSlotKey,
        })));
        const acceptedKeys = new Set(response.accepted.map(({ serviceId, positionSlotKey }) =>
          `${serviceId}:${positionSlotKey}`,
        ));
        const acceptedChanges = undoChanges.filter((change) =>
          acceptedKeys.has(`${change.occurrenceId}:${change.cellKey}`),
        );
        if (!historyRecorded && acceptedChanges.length) {
          historyRecorded = true;
          recordAssignmentChange(
            `auto-fill ${acceptedChanges.length} ${acceptedChanges.length === 1 ? "slot" : "slots"}`,
            acceptedChanges,
            response.schedule.scheduleId,
          );
        }
        if (response.skipped.length) {
          showToast(
            `${response.skipped.length} slot${response.skipped.length === 1 ? " was" : "s were"} changed elsewhere and left as-is. Review the schedule before filling again.`,
            "neutral",
          );
          return;
        }
        showToast(
          `Auto-filled ${acceptedChanges.length} of ${totalOpenSlots} open slot${totalOpenSlots === 1 ? "" : "s"}.${gapLabel}`,
          "success",
        );
      } catch (error) {
        const conflictDetails = getOccurrenceConflictDetails(error);
        saveFailed = true;
        setJustFilledCellKeys(() => new Set());
        preserveAutoFillChoices();
        if (conflictDetails) {
          requestCrossTeamConflictConfirmation({
            memberId: conflictDetails.conflicts[0]?.memberId || "",
            warning: "already scheduled in an overlapping service",
            ...conflictDetails,
            onConfirm: () => {
              void saveWithConflictConfirmation(conflictDetails.fingerprint);
            },
            onCancel: restoreAutoFillChoices,
          });
          return;
        }
        const toastId = showToast({
          message: "Couldn't save the auto-fill. Your picks are still here. Review them or retry the save.",
          variant: "error",
          persist: true,
          children: (
            <div className="mt-2 flex justify-center">
              <Button variant="primary" className="text-sm" onClick={() => {
                removeToast(toastId);
                void saveWithConflictConfirmation();
              }}>Retry save</Button>
            </div>
          ),
        });
      }
    };
    const save = saveWithConflictConfirmation();
    // The reveal may outlast a fast rejected request. Observe it immediately so
    // the browser does not report a transient unhandled rejection; stop adding
    // highlight keys and clear any already shown while retaining the choices
    // for retry. The awaited save owns the user-facing error.
    void save.catch(() => {
      saveFailed = true;
      setJustFilledCellKeys(() => new Set());
    });

    // Reveal picks in the order the algorithm made them, one at a time. Total
    // pacing is capped so a big schedule doesn't take forever to watch, but a
    // small one still gets a visible beat per slot.
    const stepDelayMs = Math.round(Math.max(35, Math.min(150, 1800 / entries.length)));
    for (const entry of entries) {
      if (saveFailed) break;
      const nextCell = finalAssignments[entry.occurrenceId]?.[entry.columnKey] ?? "";

      const cellKey = scheduleGridCellKey(entry.occurrenceId, entry.columnKey);
      setJustFilledCellKeys((prev) => new Set(prev).add(cellKey));
      setTimeout(() => {
        setJustFilledCellKeys((prev) => {
          if (!prev.has(cellKey)) return prev;
          const next = new Set(prev);
          next.delete(cellKey);
          return next;
        });
      }, 900);

      const current = schedulesByOwnerRef.current.get(virtualSchedulePreviewKey(
        previousSchedule.churchId,
        previousSchedule.scheduleId,
      )) || latestScheduleRef.current || previousSchedule;
      const revealSnapshot = setScheduleCellMapValue(
        current,
        "assignments",
        entry.occurrenceId,
        entry.columnKey,
        nextCell,
      );
      publishScheduleSnapshot(revealSnapshot, ["assignments"]);
      // eslint-disable-next-line no-await-in-loop -- pacing the reveal is the point
      await sleep(stepDelayMs);
    }

    await save;
  };

  const handleAutoFillSchedule = async () => {
    // A synchronous ref guard, not just the autoFilling state: two clicks
    // dispatched before React re-renders the disabled button would both read
    // the same (still-false) state value and could each plan and commit a
    // bulk write against the same starting grid.
    if (!canEdit || !selectedSchedule || autoFillRunningRef.current) return;
    if (hasUnhydratedOverlappingTeamSchedule) {
      showToast(
        "Other team schedules are still loading. Try Auto-fill again in a moment.",
        "neutral",
      );
      return;
    }
    autoFillRunningRef.current = true;
    try {
      let getAutoFillCrossTeamConflictWarning = getCrossTeamConflictWarning;
      const overlappingSchedule = data.schedules.find(
        (schedule) => schedule.teamId !== selectedSchedule.teamId &&
          !schedule.archivedAt && scheduleDateRangesOverlap(selectedSchedule, schedule),
      );
      const hasOverlappingTeamSchedule = data.schedules.some(
        (schedule) =>
          schedule.scheduleId !== selectedSchedule.scheduleId &&
          schedule.teamId !== selectedSchedule.teamId &&
          !schedule.archivedAt &&
          scheduleDateRangesOverlap(selectedSchedule, schedule),
      );
      if (hasOverlappingTeamSchedule) {
        try {
          // The bulk save is protected by the server's current conflict check.
          // Read those same related schedules immediately before planning so a
          // stale bootstrap or live-sync gap cannot make Auto-fill nominate a
          // person who is already serving elsewhere.
          const detail = await getTeamScheduleDetail(
            churchId,
            selectedSchedule.scheduleId.startsWith("virtual:")
              ? overlappingSchedule?.scheduleId || ""
              : selectedSchedule.scheduleId,
          );
          getAutoFillCrossTeamConflictWarning = (memberId, occurrenceId) =>
            formatCrossTeamScheduleConflictWarning(
              findCrossTeamScheduleOccurrenceConflicts({
                schedule: selectedSchedule,
                occurrenceId,
                memberId,
                schedules: detail.relatedSchedules,
                teams: data.teams,
                timeZone: serviceTimeZone,
              }),
            );
        } catch (error) {
          showApiErrorToast(
            showToast,
            error,
            "Could not check other team schedules before auto-fill.",
          );
          return;
        }
      }

      const plan = buildAutoFillPlan({
        occurrences: scheduleOccurrences,
        columns: scheduleColumns,
        requirementsByOccurrence,
        assignments: selectedSchedule.assignments,
        members: activeTeamMembers,
        positions: data.positions,
        qualificationLevels: data.qualificationLevels,
        duplicateFirstNames: duplicateScheduleFirstNames,
        getAssignmentIssue: (memberId, occurrenceId, positionId) =>
          getAssignmentIssue(memberId, occurrenceId, positionId),
        getServiceAvailabilityWarning,
        getCrossTeamConflictWarning: getAutoFillCrossTeamConflictWarning,
      });

      const totalOpenSlots = plan.entries.length + plan.unfilledSlots.length;
      if (totalOpenSlots === 0) {
        showToast("Every slot is already filled.", "neutral");
        return;
      }
      if (plan.entries.length === 0) {
        showToast("No eligible person was available for the open slots.", "neutral");
        return;
      }

      setAutoFilling(true);
      try {
        await commitAutoFillAssignments(plan.entries, plan.unfilledSlots.length);
      } finally {
        setAutoFilling(false);
      }
    } finally {
      autoFillRunningRef.current = false;
    }
  };

  // Create a brand-new roster member straight from a schedule cell: make the
  // person, add them to this team (so they're eligible), then assign them to the
  // cell. Keeps the scheduler in flow instead of bouncing to the Members tab.
  const createMemberForCell = async ({
    serviceId,
    cellKey,
    basePositionId,
    firstName,
    lastName,
  }: {
    serviceId: string;
    cellKey: string;
    basePositionId: string;
    firstName: string;
    lastName: string;
  }) => {
    if (!canEdit) return;
    if (!selectedSchedule || !selectedTeam) return;
    const trimmedFirst = firstName.trim();
    if (!trimmedFirst) return;
    const occurrence = scheduleOccurrences.find((item) => item.occurrenceId === serviceId);
    const serviceDate = occurrence ? getOccurrenceDate(occurrence, serviceTimeZone) : "";
    try {
      const schedule = await ensureActiveSchedule();
      if (!schedule) return;
      const { member } = await createTeamRosterMember(churchId, {
        firstName: trimmedFirst,
        lastName: lastName.trim(),
        positionIds: [basePositionId],
        blockoutDates: [],
      });
      const teamResponse = await updateTeam(churchId, selectedTeam.teamId, {
        name: selectedTeam.name,
        description: selectedTeam.description,
        icon: selectedTeam.icon,
        memberIds: [...selectedTeam.memberIds, member.memberId],
        baseMemberIds: selectedTeam.memberIds,
      });
      await enqueueAssignmentSave(schedule.scheduleId, async () => {
        const response = await updateTeamScheduleAssignment(
          churchId,
          schedule.scheduleId,
          {
            serviceId,
            positionSlotKey: cellKey,
            memberId: member.memberId,
            serviceDate,
          },
        );
        onScheduleSaved(response.schedule);
      });
      // Pull the new member + team membership into the page data so the roster,
      // member panel, and cell label all reflect the addition.
      onMemberSaved(member);
      onTeamSaved(teamResponse.team);
      clearActiveSlot();
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not add this member.");
    }
  };

  const scheduleHasMultipleServices = useMemo(() => {
    const serviceIds = new Set(
      scheduleOccurrences.map((occurrence) => occurrence.serviceId),
    );
    return serviceIds.size > 1;
  }, [scheduleOccurrences]);

  const effectiveOrganizeMode: OccurrenceOrganizeMode =
    scheduleHasMultipleServices ? organizeMode : "byService";

  const occurrencesByService = useMemo(() => {
    type OccurrenceGroup = {
      key: string;
      serviceId: string;
      serviceName: string;
      occurrences: TeamScheduleOccurrence[];
      sharedTiming: ReturnType<typeof getSharedOccurrenceTiming>;
    };

    if (effectiveOrganizeMode === "byDate") {
      return [...scheduleOccurrences]
        .sort(
          (a, b) =>
            new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
            a.name.localeCompare(b.name),
        )
        .map((occurrence) => ({
          key: occurrence.occurrenceId,
          serviceId: occurrence.serviceId,
          serviceName: occurrence.name,
          occurrences: [occurrence],
          sharedTiming: getSharedOccurrenceTiming([occurrence], serviceTimeZone),
        }));
    }

    const groups: OccurrenceGroup[] = [];
    const groupIndex = new Map<string, number>();

    scheduleOccurrences.forEach((occurrence) => {
      const existingIndex = groupIndex.get(occurrence.serviceId);
      if (existingIndex !== undefined) {
        groups[existingIndex].occurrences.push(occurrence);
        return;
      }
      groupIndex.set(occurrence.serviceId, groups.length);
      groups.push({
        key: occurrence.serviceId,
        serviceId: occurrence.serviceId,
        serviceName: occurrence.name,
        occurrences: [occurrence],
        sharedTiming: { sharedWeekday: null, sharedTime: null },
      });
    });

    return groups.map((group) => ({
      ...group,
      sharedTiming: getSharedOccurrenceTiming(group.occurrences, serviceTimeZone),
    }));
  }, [effectiveOrganizeMode, scheduleOccurrences, serviceTimeZone]);

  const occurrenceRowOffsets = useMemo(() => {
    let offset = 0;
    return occurrencesByService.map((group) => {
      const start = offset;
      offset += group.occurrences.length;
      return start;
    });
  }, [occurrencesByService]);

  const scheduleDateColumnMinCh = useMemo(() => {
    const labels = ["Date & time"];
    scheduleOccurrences.forEach((occurrence) => {
      const group = occurrencesByService.find((item) =>
        item.occurrences.some((itemOccurrence) => itemOccurrence.occurrenceId === occurrence.occurrenceId),
      );
      labels.push(
        formatOccurrenceRowLabel(
          occurrence,
          group?.sharedTiming || { sharedWeekday: null, sharedTime: null },
          serviceTimeZone,
        ),
      );
    });
    return toScheduleColumnMinCh(pickLongestLabel(...labels));
  }, [occurrencesByService, scheduleOccurrences, serviceTimeZone]);

  const scheduleColumnMinCh = useMemo(() => {
    const minChByColumn = new Map<string, number>();
    scheduleColumns.forEach((column) => {
      const labels = [column.label];
      scheduleOccurrences.forEach((occurrence) => {
        const assignmentCell =
          selectedSchedule?.assignments?.[occurrence.occurrenceId]?.[column.columnKey];
        labels.push(
          capScheduleColumnLabelForSizing(
            getAssignmentCellContentLabel({
              assignmentCell,
              positionName: column.label,
              members: scheduleDisplayMembers,
              duplicateFirstNames: duplicateScheduleFirstNames,
            }),
          ),
        );
      });
      minChByColumn.set(
        column.columnKey,
        toSchedulePositionColumnMinCh({
          longestLabel: pickLongestLabel(...labels),
          headerLabel: column.label,
          hasIcon: Boolean(column.position.icon),
        }),
      );
    });
    return minChByColumn;
  }, [
    scheduleDisplayMembers,
    duplicateScheduleFirstNames,
    scheduleColumns,
    scheduleOccurrences,
    selectedSchedule?.assignments,
  ]);

  const scheduleDateRangeLabel = useMemo(() => {
    const format = (value?: string) => {
      const parsed = value ? parsePlainDate(value) : undefined;
      return parsed
        ? parsed.toLocaleDateString(undefined, {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
        : "";
    };
    const start = format(selectedSchedule?.startDate);
    const end = format(selectedSchedule?.endDate);
    if (start && end) return `${start} – ${end}`;
    return start || end;
  }, [selectedSchedule?.startDate, selectedSchedule?.endDate]);

  const scheduleDateBounds = useMemo(() => {
    const startDate = selectedSchedule?.startDate || "";
    const endDate = selectedSchedule?.endDate || "";
    if (startDate || endDate) {
      return {
        startDate: startDate || endDate,
        endDate: endDate || startDate,
      };
    }
    if (scheduleOccurrences.length === 0) {
      return { startDate: "", endDate: "" };
    }
    const occurrenceDates = scheduleOccurrences
      .map((occurrence) => getOccurrenceDate(occurrence, serviceTimeZone))
      .sort();
    return {
      startDate: occurrenceDates[0] || "",
      endDate: occurrenceDates[occurrenceDates.length - 1] || "",
    };
  }, [
    scheduleOccurrences,
    serviceTimeZone,
    selectedSchedule?.endDate,
    selectedSchedule?.startDate,
  ]);

  const scheduleExportModel = useMemo(() => {
    if (!selectedSchedule) return null;
    return buildScheduleExportModel({
      churchName,
      scheduleName: selectedSchedule.name,
      dateRangeLabel: scheduleDateRangeLabel,
      columns: scheduleColumns.map((column) => ({
        columnKey: column.columnKey,
        positionId: column.positionId,
        slot: column.slot,
        label: column.label,
      })),
      groups: occurrencesByService.map((group) => ({
        serviceName: group.serviceName,
        timingLabel: [
          group.sharedTiming.sharedWeekday,
          [group.sharedTiming.sharedTime, group.sharedTiming.sharedTime && group.occurrences[0]
            ? getOccurrenceTimeZoneAbbreviation(group.occurrences[0].startsAt, serviceTimeZone)
            : null].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(" · "),
        occurrences: group.occurrences.map((occurrence) => ({
          occurrenceId: occurrence.occurrenceId,
          rowLabel: formatOccurrenceRowLabel(occurrence, group.sharedTiming, serviceTimeZone),
        })),
      })),
      requiredCountFor: (occurrenceId, positionId) =>
        getRequiredCount(requirementsByOccurrence.get(occurrenceId), positionId),
      additionalPositionSlots: selectedSchedule.additionalPositionSlots,
      assignments: selectedSchedule.assignments,
      members: scheduleDisplayMembers,
      duplicateFirstNames: duplicateScheduleFirstNames,
    });
  }, [
    churchName,
    scheduleDisplayMembers,
    duplicateScheduleFirstNames,
    occurrencesByService,
    requirementsByOccurrence,
    scheduleColumns,
    scheduleDateRangeLabel,
    serviceTimeZone,
    selectedSchedule,
  ]);

  const copyPublicLink = useCallback(async () => {
    if (!canEdit) return;
    if (!selectedSchedule) return;
    setCopyingLink(true);
    try {
      const schedule = await ensureActiveSchedule();
      if (!schedule) return;
      const { publicToken } = await getTeamSchedulePublicLink(
        churchId,
        schedule.scheduleId,
      );
      const url = buildTeamSchedulePublicUrl(publicToken);
      await navigator.clipboard.writeText(url);
      showToast("View-only link copied to clipboard.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not create a view-only link.");
    } finally {
      setCopyingLink(false);
    }
  }, [canEdit, churchId, ensureActiveSchedule, selectedSchedule, showToast]);


  // Seed a copy-specific draft and open an explicit create flow. The operator
  // typically just changes the date; assignments are remapped onto the new
  // dates on save.
  const handleCopySchedule = useCallback(() => {
    if (!canEdit || !selectedSchedule) return;
    onScheduleDraftFlush(
      getScheduleCopyDraftKey(selectedSchedule.scheduleId),
      buildScheduleCopyDraft({
        source: selectedSchedule,
        occurrences: scheduleOccurrences,
      }),
    );
    setFormState({
      mode: "copy",
      sourceScheduleId: selectedSchedule.scheduleId,
      sourceSchedule: selectedSchedule,
    });
  }, [
    canEdit,
    onScheduleDraftFlush,
    scheduleOccurrences,
    selectedSchedule,
  ]);

  const occurrenceTimingById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getSharedOccurrenceTiming>>();
    occurrencesByService.forEach((group) => {
      group.occurrences.forEach((occurrence) => {
        map.set(occurrence.occurrenceId, group.sharedTiming);
      });
    });
    return map;
  }, [occurrencesByService]);

  const pasteRowOccurrenceOptions = useMemo(
    () =>
      scheduleOccurrences.map((occurrence) => ({
        occurrenceId: occurrence.occurrenceId,
        label: `${occurrence.name} — ${formatOccurrenceRowLabel(
          occurrence,
          occurrenceTimingById.get(occurrence.occurrenceId) || {
            sharedWeekday: null,
            sharedTime: null,
          },
          serviceTimeZone,
        )}`,
      })),
    [scheduleOccurrences, occurrenceTimingById, serviceTimeZone],
  );

  const getIssueForOccurrence = useCallback(
    (occurrenceId: string, memberId: string, positionId: string) =>
      getAssignmentIssue(memberId, occurrenceId, positionId),
    [getAssignmentIssue],
  );

  const activeSlotMeta = useMemo(() => {
    if (!activeSlot) return null;
    const occurrence = scheduleOccurrences.find(
      (item) => item.occurrenceId === activeSlot.occurrenceId,
    );
    const column = scheduleColumns.find((item) => item.columnKey === activeSlot.columnKey);
    if (!occurrence || !column) return null;
    const sharedTiming = occurrenceTimingById.get(occurrence.occurrenceId);
    const assignmentCell =
      selectedSchedule?.assignments?.[activeSlot.occurrenceId]?.[activeSlot.columnKey];
    const primaryMemberId = getCellPrimaryMemberId(assignmentCell);
    const response = selectedSchedule?.responses?.[activeSlot.occurrenceId]?.[activeSlot.columnKey]?.response;
    const primaryMember = scheduleDisplayMembers.find(
      (item) => item.memberId === primaryMemberId,
    );
    const currentShadows = getCellShadowAssignments(assignmentCell).map((shadow) => {
      const member = scheduleDisplayMembers.find(
        (item) => item.memberId === shadow.memberId,
      );
      return {
        memberId: shadow.memberId,
        kind: shadow.kind,
        label: scheduleMemberName(member, duplicateScheduleFirstNames),
      };
    });
    return {
      positionLabel: column.label,
      occurrenceLabel: sharedTiming
        ? formatOccurrenceRowLabel(occurrence, sharedTiming, serviceTimeZone)
        : occurrence.name,
      currentAssigneeLabel: primaryMember
        ? scheduleMemberName(primaryMember, duplicateScheduleFirstNames)
        : "Empty",
      positionId: column.positionId,
      currentPrimaryMemberId: primaryMemberId,
      isVacantOrDeclined: !primaryMemberId || response === "declined",
      currentAssigneeIsGuest: Boolean(primaryMember?.scheduleGuest),
      hasCurrentAssignee: Boolean(primaryMemberId),
      currentShadows,
      occurrenceName: occurrence.name,
    };
  }, [
    activeSlot,
    duplicateScheduleFirstNames,
    occurrenceTimingById,
    scheduleColumns,
    scheduleOccurrences,
    scheduleDisplayMembers,
    selectedSchedule?.assignments,
    selectedSchedule?.responses,
    serviceTimeZone,
  ]);
  const memberAssignmentMode = Boolean(canEdit && activeSlot);

  useEffect(() => {
    setExpandedMemberIds([]);
  }, [activeSlotMeta?.positionId, memberAssignmentMode]);

  const activeSlotRecommendationStats = useMemo(() => {
    const stats = new Map<string, ScheduleMemberRecommendationStats>();
    activeTeamMembers.forEach((member) => {
      stats.set(member.memberId, {
        assignmentCount: scheduleAssignmentCounts.get(member.memberId) || 0,
        nearestAssignmentDistance: null,
      });
    });
    if (!activeSlot || !selectedSchedule?.assignments) return stats;

    const activeOccurrenceIndex = scheduleOccurrences.findIndex(
      (occurrence) => occurrence.occurrenceId === activeSlot.occurrenceId,
    );
    if (activeOccurrenceIndex < 0) return stats;
    const activeOccurrenceDate = parsePlainDate(
      getOccurrenceDate(scheduleOccurrences[activeOccurrenceIndex], serviceTimeZone),
    );

    const activeMemberIds = new Set(activeTeamMembers.map((member) => member.memberId));
    const assignedDatesByMember = new Map<string, Date[]>();
    const occurrenceIndexById = new Map(
      scheduleOccurrences.map((occurrence, index) => [occurrence.occurrenceId, index]),
    );
    const occurrenceById = new Map(
      scheduleOccurrences.map((occurrence) => [occurrence.occurrenceId, occurrence]),
    );
    Object.entries(selectedSchedule.assignments).forEach(([occurrenceId, row]) => {
      const occurrenceIndex = occurrenceIndexById.get(occurrenceId);
      if (occurrenceIndex === undefined || !row) return;
      const occurrence = occurrenceById.get(occurrenceId);
      const occurrenceDate = occurrence
        ? parsePlainDate(getOccurrenceDate(occurrence, serviceTimeZone)) || undefined
        : undefined;
      const distance = Math.abs(occurrenceIndex - activeOccurrenceIndex);
      const assignedMemberIds = new Set<string>();
      Object.values(row).forEach((cell) => {
        getCellMemberIds(cell).forEach((memberId) => {
          if (activeMemberIds.has(memberId)) assignedMemberIds.add(memberId);
        });
      });
      assignedMemberIds.forEach((memberId) => {
        const current = stats.get(memberId);
        if (!current) return;
        stats.set(memberId, {
          ...current,
          nearestAssignmentDistance:
            current.nearestAssignmentDistance === null
              ? distance
              : Math.min(current.nearestAssignmentDistance, distance),
        });
        if (occurrenceDate && !Number.isNaN(occurrenceDate.getTime())) {
          const dates = assignedDatesByMember.get(memberId) || [];
          dates.push(occurrenceDate);
          assignedDatesByMember.set(memberId, dates);
        }
      });
    });

    activeTeamMembers.forEach((member) => {
      const current = stats.get(member.memberId);
      if (!current) return;
      stats.set(member.memberId, {
        ...current,
        servingFrequencyTargetReached: servingFrequencyTargetReached({
          servingFrequency: member.servingFrequency,
          occurrenceDate: activeOccurrenceDate || undefined,
          assignedDates: assignedDatesByMember.get(member.memberId) || [],
        }),
      });
    });

    const activePosition = activeSlotMeta
      ? data.positions.find((item) => item.positionId === activeSlotMeta.positionId)
      : undefined;
    if (activePosition) {
      const requiredCount = getRequiredCount(
        requirementsByOccurrence.get(activeSlot.occurrenceId),
        activePosition.positionId,
      );
      const occurrenceAssignments =
        selectedSchedule.assignments[activeSlot.occurrenceId] || {};
      const siblingAssignedMemberIds = scheduleColumns
        .filter(
          (column) =>
            column.positionId === activePosition.positionId &&
            column.columnKey !== activeSlot.columnKey &&
            column.slot < requiredCount,
        )
        .map((column) => getCellPrimaryMemberId(occurrenceAssignments[column.columnKey]))
        .filter((memberId): memberId is string => Boolean(memberId));
      const boosts = computeLevelBalanceBoost({
        position: activePosition,
        requiredCountForOccurrence: requiredCount,
        siblingAssignedMemberIds,
        members: activeTeamMembers,
        qualificationLevels: data.qualificationLevels,
      });
      boosts.forEach((levelBalanceBoost, memberId) => {
        const current = stats.get(memberId);
        if (!current) return;
        stats.set(memberId, { ...current, levelBalanceBoost });
      });
    }

    return stats;
  }, [
    activeSlot,
    activeSlotMeta,
    activeTeamMembers,
    data.positions,
    data.qualificationLevels,
    requirementsByOccurrence,
    scheduleAssignmentCounts,
    scheduleColumns,
    scheduleOccurrences,
    serviceTimeZone,
    selectedSchedule?.assignments,
  ]);

  const activeSlotSwapRecommendations = useMemo<ScheduleAssignmentSwapPlan[]>(() => {
    if (!activeSlot || !activeSlotMeta?.currentPrimaryMemberId || !selectedSchedule) {
      return [];
    }
    if (slotPickerMode === "replace") return [];

    const occurrenceAssignments =
      selectedSchedule.assignments?.[activeSlot.occurrenceId] || {};
    const currentMemberId = activeSlotMeta.currentPrimaryMemberId;
    const currentMember = data.members.find(
      (item) => item.memberId === currentMemberId,
    );
    if (!currentMember) return [];

    const plans: ScheduleAssignmentSwapPlan[] = [];
    for (const column of scheduleColumns) {
      if (column.columnKey === activeSlot.columnKey) continue;

      const sourceCell = occurrenceAssignments[column.columnKey];
      const candidateMemberId = getCellPrimaryMemberId(sourceCell);
      if (!candidateMemberId || candidateMemberId === currentMemberId) continue;
      const candidateMember = data.members.find(
        (item) => item.memberId === candidateMemberId,
      );
      if (!candidateMember) continue;

      const candidateTargetIssue = getAssignmentIssue(
        candidateMemberId,
        activeSlot.occurrenceId,
        activeSlotMeta.positionId,
        {
          serviceId: activeSlot.occurrenceId,
          positionId: column.columnKey,
        },
      );
      if (candidateTargetIssue) continue;

      const currentSourceIssue = getAssignmentIssue(
        currentMemberId,
        activeSlot.occurrenceId,
        column.positionId,
        {
          serviceId: activeSlot.occurrenceId,
          positionId: activeSlot.columnKey,
        },
      );
      if (currentSourceIssue) continue;

      const occurrence = scheduleOccurrences.find(
        (item) => item.occurrenceId === activeSlot.occurrenceId,
      );
      plans.push({
        swapId: `${activeSlot.occurrenceId}:${activeSlot.columnKey}:${column.columnKey}:${candidateMemberId}`,
        serviceId: activeSlot.occurrenceId,
        serviceDate: occurrence ? getOccurrenceDate(occurrence, serviceTimeZone) : "",
        targetCellKey: activeSlot.columnKey,
        targetPositionId: activeSlotMeta.positionId,
        sourceCellKey: column.columnKey,
        sourcePositionId: column.positionId,
        candidateMemberId,
        currentMemberId,
        candidateLabel: scheduleMemberName(candidateMember, duplicateScheduleFirstNames),
        currentMemberLabel: scheduleMemberName(currentMember, duplicateScheduleFirstNames),
        sourcePositionLabel: column.label,
        targetPositionLabel: activeSlotMeta.positionLabel,
      });
    }

    return plans
      .sort((a, b) => {
        const aStats = activeSlotRecommendationStats.get(a.candidateMemberId);
        const bStats = activeSlotRecommendationStats.get(b.candidateMemberId);
        const aCount = aStats?.assignmentCount ?? 0;
        const bCount = bStats?.assignmentCount ?? 0;
        if (aCount !== bCount) return aCount - bCount;
        const aSpacing =
          aStats?.nearestAssignmentDistance ?? Number.POSITIVE_INFINITY;
        const bSpacing =
          bStats?.nearestAssignmentDistance ?? Number.POSITIVE_INFINITY;
        if (aSpacing !== bSpacing) return aSpacing > bSpacing ? -1 : 1;
        return a.candidateLabel.localeCompare(b.candidateLabel);
      })
      .slice(0, 3);
  }, [
    activeSlot,
    activeSlotMeta,
    activeSlotRecommendationStats,
    data.members,
    duplicateScheduleFirstNames,
    getAssignmentIssue,
    scheduleColumns,
    scheduleOccurrences,
    serviceTimeZone,
    selectedSchedule,
    slotPickerMode,
  ]);

  const handleEditMemberFromPanel = useCallback(
    (memberId: string) => {
      if (!onEditMember || !selectedScheduleId) return;
      onEditMember(
        memberId,
        buildScheduleReturnTo({
          scheduleId: selectedScheduleId,
          activeSlot: activeSlot ?? undefined,
          slotPickerMode,
          membersPanelOpen,
        }),
      );
    },
    [
      activeSlot,
      membersPanelOpen,
      onEditMember,
      selectedScheduleId,
      slotPickerMode,
    ],
  );

  const getActiveSlotMoveSource = useCallback(
    (primaryAssigneeId: string) => {
      if (!activeSlot || !selectedSchedule) return null;
      const row = selectedSchedule.assignments?.[activeSlot.occurrenceId] || {};
      const sourceEntry = Object.entries(row).find(([cellKey, cell]) => {
        if (cellKey === activeSlot.columnKey) return false;
        return getCellPrimaryMemberId(cell) === primaryAssigneeId;
      });
      if (!sourceEntry) return null;
      const [sourcePositionSlotKey] = sourceEntry;
      const sourceColumn = scheduleColumns.find(
        (column) => column.columnKey === sourcePositionSlotKey,
      );
      return {
        serviceId: activeSlot.occurrenceId,
        positionSlotKey: sourcePositionSlotKey,
        positionLabel: sourceColumn?.label || "another position",
      };
    },
    [activeSlot, scheduleColumns, selectedSchedule],
  );

  const handleActiveSlotMemberSelect = (memberId: string) => {
    if (!canEdit) return;
    if (!activeSlot || !activeSlotMeta) return;
    const moveSource = getActiveSlotMoveSource(memberId);
    if (slotPickerMode === "replace") {
      // Day-of replacement: swap the fill-in straight into the slot without the
      // replace/shadow confirmation step.
      void commitAssignment({
        serviceId: activeSlot.occurrenceId,
        cellKey: activeSlot.columnKey,
        basePositionId: activeSlotMeta.positionId,
        memberId,
        sourceServiceId: moveSource?.serviceId,
        sourcePositionSlotKey: moveSource?.positionSlotKey,
      });
      return;
    }
    requestCellMemberAction({
      serviceId: activeSlot.occurrenceId,
      cellKey: activeSlot.columnKey,
      basePositionId: activeSlotMeta.positionId,
      memberId,
      currentPrimaryMemberId: activeSlotMeta.currentPrimaryMemberId,
      sourceServiceId: moveSource?.serviceId,
      sourcePositionSlotKey: moveSource?.positionSlotKey,
    });
  };

  const activeSlotGetIssue = useCallback(
    (memberId: string) => {
      if (!activeSlot || !activeSlotMeta) return "Not available";
      const moveSource = getActiveSlotMoveSource(memberId);
      if (moveSource) {
        return getManualScheduleAssignmentIssue(getAssignmentIssue(
          memberId,
          activeSlot.occurrenceId,
          activeSlotMeta.positionId,
          {
            serviceId: moveSource.serviceId,
            positionId: moveSource.positionSlotKey,
          },
        ));
      }
      return getManualScheduleAssignmentIssue(getAssignmentIssue(
        memberId,
        activeSlot.occurrenceId,
        activeSlotMeta.positionId,
      ));
    },
    [
      activeSlot,
      activeSlotMeta,
      getActiveSlotMoveSource,
      getAssignmentIssue,
    ],
  );

  const activeSlotGetWarning = useCallback(
    (memberId: string) => {
      if (!activeSlot) return "";
      const warnings: string[] = [];
      const moveSource = getActiveSlotMoveSource(memberId);
      if (moveSource) {
        warnings.push(`Will move from ${moveSource.positionLabel}`);
      }
      const conflictWarning = getCrossTeamConflictWarning(
        memberId,
        activeSlot.occurrenceId,
      );
      if (conflictWarning) warnings.push(conflictWarning);
      const availabilityWarning = getServiceAvailabilityWarning(
        memberId,
        activeSlot.occurrenceId,
      );
      if (availabilityWarning) warnings.push(availabilityWarning);
      const blockoutWarning = getBlockoutWarning(memberId, activeSlot.occurrenceId);
      if (blockoutWarning) warnings.push(blockoutWarning);
      return warnings.join(". ");
    },
    [
      activeSlot,
      getActiveSlotMoveSource,
      getCrossTeamConflictWarning,
      getBlockoutWarning,
      getServiceAvailabilityWarning,
    ],
  );

  const activeSlotGetGuestWarning = useCallback(
    (guestId: string) => {
      const moveSource = getActiveSlotMoveSource(guestId);
      return moveSource ? `Will move from ${moveSource.positionLabel}` : "";
    },
    [getActiveSlotMoveSource],
  );

  const activeSlotGetAssignmentActionIssues = useCallback(
    (memberId: string) => {
      if (!activeSlot || !activeSlotMeta) {
        return {
          replace: "Not available",
          shadow: "Not available",
          reverseShadow: "Not available",
        };
      }
      const moveSource = getActiveSlotMoveSource(memberId);
      const issues = getAssignmentActionIssues(
        memberId,
        activeSlot.occurrenceId,
        activeSlotMeta.positionId,
        moveSource
          ? {
            serviceId: moveSource.serviceId,
            positionId: moveSource.positionSlotKey,
          }
          : undefined,
      );
      return {
        replace: getManualScheduleAssignmentIssue(issues.replace),
        shadow: getManualScheduleAssignmentIssue(issues.shadow),
        reverseShadow: getManualScheduleAssignmentIssue(issues.reverseShadow),
      };
    },
    [
      activeSlot,
      activeSlotMeta,
      getActiveSlotMoveSource,
      getAssignmentActionIssues,
    ],
  );

  const handleActiveSlotAssignmentAction = (
    memberId: string,
    action: "replace" | TeamScheduleShadowKind,
  ) => {
    if (!canEdit) return;
    if (!activeSlot || !activeSlotMeta) return;
    const moveSource = getActiveSlotMoveSource(memberId);
    handleAssignmentAction({
      serviceId: activeSlot.occurrenceId,
      cellKey: activeSlot.columnKey,
      basePositionId: activeSlotMeta.positionId,
      memberId,
      action,
      sourceServiceId: action === "replace" ? moveSource?.serviceId : undefined,
      sourcePositionSlotKey:
        action === "replace" ? moveSource?.positionSlotKey : undefined,
    });
    setPendingCellAssignment(null);
  };

  const handleActiveSlotCreateMember = async (member: {
    firstName: string;
    lastName: string;
  }) => {
    if (!canEdit) return;
    if (!activeSlot || !activeSlotMeta) return;
    await createMemberForCell({
      serviceId: activeSlot.occurrenceId,
      cellKey: activeSlot.columnKey,
      basePositionId: activeSlotMeta.positionId,
      firstName: member.firstName,
      lastName: member.lastName,
    });
  };

  const handleActiveSlotClearAssignment = () => {
    if (!canEdit) return;
    if (!activeSlot || !activeSlotMeta?.currentPrimaryMemberId) return;
    void commitAssignment({
      serviceId: activeSlot.occurrenceId,
      cellKey: activeSlot.columnKey,
      basePositionId: activeSlotMeta.positionId,
      memberId: null,
    });
  };

  const handleActiveSlotRemoveShadow = (
    memberId: string,
    shadowKind: TeamScheduleShadowKind,
  ) => {
    if (!canEdit) return;
    if (!activeSlot || !activeSlotMeta) return;
    void commitShadowAssignment({
      serviceId: activeSlot.occurrenceId,
      cellKey: activeSlot.columnKey,
      basePositionId: activeSlotMeta.positionId,
      memberId,
      shadowKind,
      action: "remove",
    });
  };

  const commitActiveSlotSwapRecommendation = async (
    recommendation: ScheduleAssignmentSwapRecommendation,
    confirmedFingerprint?: string,
  ) => {
    if (!canEdit || !selectedSchedule) return;
    const plan = activeSlotSwapRecommendations.find(
      (item) => item.swapId === recommendation.swapId,
    );
    if (!plan) {
      showToast("Swap is no longer available.", "neutral");
      return;
    }

    const candidateTargetIssue = getAssignmentIssue(
      plan.candidateMemberId,
      plan.serviceId,
      plan.targetPositionId,
      {
        serviceId: plan.serviceId,
        positionId: plan.sourceCellKey,
      },
    );
    const currentSourceIssue = getAssignmentIssue(
      plan.currentMemberId,
      plan.serviceId,
      plan.sourcePositionId,
      {
        serviceId: plan.serviceId,
        positionId: plan.targetCellKey,
      },
    );
    const issue = candidateTargetIssue || currentSourceIssue;
    if (issue) {
      showToast(issue, "neutral");
      return;
    }
    let previousSchedule: TeamSchedule;
    try {
      const ensuredSchedule = await ensureActiveSchedule();
      if (!ensuredSchedule) return;
      previousSchedule = ensuredSchedule;
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not start this schedule.");
      return;
    }
    const nextAssignments: TeamScheduleAssignments = {
      ...(previousSchedule.assignments || {}),
    };
    const occurrenceAssignments = {
      ...(nextAssignments[plan.serviceId] || {}),
    };
    const previousTargetValue =
      previousSchedule.assignments?.[plan.serviceId]?.[plan.targetCellKey] ?? "";
    const previousSourceValue =
      previousSchedule.assignments?.[plan.serviceId]?.[plan.sourceCellKey] ?? "";
    const targetCell = normalizeAssignmentCell(previousTargetValue);
    const sourceCell = normalizeAssignmentCell(previousSourceValue);
    const nextTargetValue = serializeAssignmentCell({
      primaryMemberId: plan.candidateMemberId,
      shadows: targetCell.shadows,
    });
    const nextSourceValue = serializeAssignmentCell({
      primaryMemberId: plan.currentMemberId,
      shadows: sourceCell.shadows,
    });

    if (nextTargetValue) {
      occurrenceAssignments[plan.targetCellKey] = nextTargetValue;
    } else {
      delete occurrenceAssignments[plan.targetCellKey];
    }
    if (nextSourceValue) {
      occurrenceAssignments[plan.sourceCellKey] = nextSourceValue;
    } else {
      delete occurrenceAssignments[plan.sourceCellKey];
    }
    nextAssignments[plan.serviceId] = occurrenceAssignments;

    const changes: ScheduleCellChange[] = [
      {
        occurrenceId: plan.serviceId,
        cellKey: plan.targetCellKey,
        serviceDate: plan.serviceDate,
        before: previousTargetValue,
        after: nextAssignments[plan.serviceId]?.[plan.targetCellKey] ?? "",
      },
      {
        occurrenceId: plan.serviceId,
        cellKey: plan.sourceCellKey,
        serviceDate: plan.serviceDate,
        before: previousSourceValue,
        after: nextAssignments[plan.serviceId]?.[plan.sourceCellKey] ?? "",
      },
    ];
    const stagedEdits = [
      stageScheduleCellEdit(
        previousSchedule,
        "assignments",
        plan.serviceId,
        plan.targetCellKey,
        changes[0].after,
      ).edit,
      stageScheduleCellEdit(
        previousSchedule,
        "assignments",
        plan.serviceId,
        plan.sourceCellKey,
        changes[1].after,
      ).edit,
    ];
    let mutationSchedule = applyPendingScheduleCellEdits(
      { ...previousSchedule, assignments: nextAssignments },
      pendingScheduleCellEditsRef.current.values(),
    );
    clearActiveSlot();
    let historyRecorded = false;
    const restore = () => {
      let current = schedulesByOwnerRef.current.get(virtualSchedulePreviewKey(
        mutationSchedule.churchId,
        mutationSchedule.scheduleId,
      )) || mutationSchedule;
      let changed = false;
      stagedEdits.forEach((edit, index) => {
        if (!clearScheduleCellEdit(edit)) return;
        const change = changes[index];
        if (!change) return;
        current = setScheduleCellMapValue(
          current,
          "assignments",
          change.occurrenceId,
          change.cellKey,
          change.before,
        );
        changed = true;
      });
      if (changed) publishScheduleSnapshot(current, ["assignments"]);
    };
    const saveSwap = async (fingerprint?: string): Promise<void> => {
      try {
        const ensuredSchedule = await ensureActiveSchedule(mutationSchedule);
        if (!ensuredSchedule) return;
        mutationSchedule = ensuredSchedule;
        const persistedEdits = stagedEdits.map((edit) =>
          [...pendingScheduleCellEditsRef.current.values()].find((pendingEdit) =>
            pendingEdit.churchId === edit.churchId &&
            pendingEdit.scheduleId === ensuredSchedule.scheduleId &&
            pendingEdit.field === edit.field &&
            pendingEdit.occurrenceId === edit.occurrenceId &&
            pendingEdit.cellKey === edit.cellKey &&
            pendingEdit.sequence === edit.sequence,
          ) || edit,
        );
        const response = await enqueueAssignmentSave(ensuredSchedule.scheduleId, () =>
          updateTeamScheduleAssignmentSwap(churchId, ensuredSchedule.scheduleId, {
            serviceId: plan.serviceId,
            targetPositionSlotKey: plan.targetCellKey,
            sourcePositionSlotKey: plan.sourceCellKey,
            currentMemberId: plan.currentMemberId,
            candidateMemberId: plan.candidateMemberId,
            serviceDate: plan.serviceDate,
            ...assignmentConflictPayload(fingerprint),
          }),
        );
        if (!historyRecorded) {
          historyRecorded = true;
          recordAssignmentChange(
            `swap ${plan.currentMemberLabel} and ${plan.candidateLabel}`,
            changes,
            ensuredSchedule.scheduleId,
          );
        }
        publishScheduleCellResponses(response.schedule, "assignments", persistedEdits);
        persistedEdits.forEach(clearScheduleCellEdit);
        publishScheduleCellResponses(response.schedule, "assignments", persistedEdits);
      } catch (error) {
        const conflictDetails = getOccurrenceConflictDetails(error);
        if (conflictDetails) {
          requestCrossTeamConflictConfirmation({
            memberId: conflictDetails.conflicts[0]?.memberId || plan.candidateMemberId,
            warning: "already scheduled in an overlapping service",
            isMove: true,
            ...conflictDetails,
            onConfirm: () =>
              void saveSwap(conflictDetails.fingerprint),
            onCancel: restore,
          });
          return;
        }
        const toastId = showToast({
          message: "Couldn't save this swap. Your choices are still here. Retry the save when ready.",
          variant: "error",
          persist: true,
          children: (
            <div className="mt-2 flex justify-center">
              <Button variant="primary" className="text-sm" onClick={() => {
                removeToast(toastId);
                void saveSwap(fingerprint);
              }}>Retry save</Button>
            </div>
          ),
        });
      }
    };
    await saveSwap(confirmedFingerprint);
  };

  const pendingPickerSubmenu = (() => {
    if (!canEdit || !pendingCellAssignment || !activeSlot || !activeSlotMeta) return null;
    if (
      pendingCellAssignment.serviceId !== activeSlot.occurrenceId ||
      pendingCellAssignment.cellKey !== activeSlot.columnKey
    ) {
      return null;
    }
    const pendingMember = data.members.find(
      (item) => item.memberId === pendingCellAssignment.memberId,
    );
    if (!pendingMember) return null;
    return {
      memberId: pendingCellAssignment.memberId,
      title: `Assign ${scheduleMemberName(pendingMember, duplicateScheduleFirstNames)}`,
      issues: (() => {
        const issues = getAssignmentActionIssues(
          pendingCellAssignment.memberId,
          activeSlot.occurrenceId,
          activeSlotMeta.positionId,
          pendingCellAssignment.sourceServiceId &&
            pendingCellAssignment.sourcePositionSlotKey
            ? {
              serviceId: pendingCellAssignment.sourceServiceId,
              positionId: pendingCellAssignment.sourcePositionSlotKey,
            }
            : undefined,
        );
        return {
          replace: getManualScheduleAssignmentIssue(issues.replace),
          shadow: getManualScheduleAssignmentIssue(issues.shadow),
          reverseShadow: getManualScheduleAssignmentIssue(issues.reverseShadow),
        };
      })(),
      onBack: () => setPendingCellAssignment(null),
      onReplace: confirmPendingReplace,
      onAddShadow: () => confirmPendingShadow("shadow"),
      onAddReverseShadow: () => confirmPendingShadow("reverse_shadow"),
    };
  })();

  const pendingAdditionalPositionRemovalDetails = pendingAdditionalPositionRemoval
    ? {
      label:
        scheduleColumns.find(
          (column) => column.columnKey === pendingAdditionalPositionRemoval.cellKey,
        )?.label || "this position",
      memberCount: getCellMemberIds(
        selectedSchedule?.assignments?.[pendingAdditionalPositionRemoval.serviceId]?.[
        pendingAdditionalPositionRemoval.cellKey
        ],
      ).length,
      microphoneCount:
        selectedSchedule?.microphoneAssignments?.[
          pendingAdditionalPositionRemoval.serviceId
        ]?.[pendingAdditionalPositionRemoval.cellKey]?.length || 0,
    }
    : null;

  const pendingCrossTeamConflictMember = pendingCrossTeamConflict
    ? data.members.find(
      (item) => item.memberId === pendingCrossTeamConflict.memberId,
    )
    : null;
  const pendingCrossTeamConflictMemberLabel = pendingCrossTeamConflictMember
    ? scheduleMemberName(
      pendingCrossTeamConflictMember,
      duplicateScheduleFirstNames,
    )
    : "This person";
  const pendingAvailabilityMember = pendingAvailabilityConfirmation
    ? data.members.find(
      (item) => item.memberId === pendingAvailabilityConfirmation.memberId,
    )
    : null;
  const pendingAvailabilityMemberLabel = pendingAvailabilityMember
    ? scheduleMemberName(pendingAvailabilityMember, duplicateScheduleFirstNames)
    : "This person";
  const pendingAvailabilityConfirmationIsRecurring =
    pendingAvailabilityConfirmation?.kind === "recurringAvailability";

  // Flattened occurrences (in service order) for the by-position orientation,
  // where dates become columns.
  const flatOccurrences = useMemo(
    () =>
      occurrencesByService.flatMap((group) =>
        group.occurrences.map((occurrence) => ({ occurrence, group })),
      ),
    [occurrencesByService],
  );

  // Filled/required per occurrence, shared by every layout's fill badge so the
  // board and both grids read from one computation. Includes occurrence-added
  // additionalPositionSlots in the staffing target for that date only.
  const fillByOccurrence = useMemo(() => {
    const map = new Map<string, OccurrenceFill>();
    scheduleOccurrences.forEach((occurrence) => {
      map.set(
        occurrence.occurrenceId,
        computeOccurrenceFill(
          scheduleColumns,
          requirementsByOccurrence.get(occurrence.occurrenceId),
          selectedSchedule?.assignments?.[occurrence.occurrenceId],
          selectedSchedule?.responses?.[occurrence.occurrenceId],
          selectedSchedule?.additionalPositionSlots?.[occurrence.occurrenceId],
        ),
      );
    });
    return map;
  }, [
    scheduleColumns,
    requirementsByOccurrence,
    scheduleOccurrences,
    selectedSchedule?.assignments,
    selectedSchedule?.additionalPositionSlots,
    // Without this the badge would not move when an accept or decline arrives
    // over SSE — the count would only catch up on a full reload.
    selectedSchedule?.responses,
  ]);
  const staffingProgress = useMemo(
    () => [...fillByOccurrence.values()].reduce(
      (total, fill) => ({ required: total.required + fill.required, filled: total.filled + fill.filled }),
      { required: 0, filled: 0 },
    ),
    [fillByOccurrence],
  );

  // The soonest service from today onward, highlighted in every layout.
  const nextUpcomingOccurrenceId = useMemo(
    () => findNextUpcomingOccurrenceId(scheduleOccurrences, serverNow()),
    [scheduleOccurrences],
  );

  const microphoneHoldersByOccurrence = useMemo(() => {
    const holdersByOccurrence = new Map<
      string,
      Map<string, ScheduleEquipmentHolder[]>
    >();
    if (!selectedSchedule || !selectedTeam?.usesMicrophoneAssignments) {
      return holdersByOccurrence;
    }
    scheduleOccurrences.forEach((occurrence) => {
      const requirements = requirementsByOccurrence.get(occurrence.occurrenceId);
      const additionalSlots =
        selectedSchedule.additionalPositionSlots?.[occurrence.occurrenceId] || [];
      const holdersByMicrophone = new Map<string, ScheduleEquipmentHolder[]>();
      scheduleColumns.forEach((column) => {
        if (!isOccurrenceStaffingSlot(column, requirements, additionalSlots)) return;
        const memberId = getCellPrimaryMemberId(
          selectedSchedule.assignments?.[occurrence.occurrenceId]?.[column.columnKey],
        );
        const member = scheduleDisplayMembers.find((item) => item.memberId === memberId);
        const label = member
          ? scheduleMemberName(member, duplicateScheduleFirstNames)
          : column.label;
        const slotKey = `${occurrence.occurrenceId}:${column.columnKey}`;
        const microphoneIds =
          selectedSchedule.microphoneAssignments?.[occurrence.occurrenceId]?.[
          column.columnKey
          ] || [];
        microphoneIds.forEach((microphoneId) => {
          const holders = holdersByMicrophone.get(microphoneId) || [];
          holders.push({ slotKey, label });
          holdersByMicrophone.set(microphoneId, holders);
        });
      });
      holdersByOccurrence.set(occurrence.occurrenceId, holdersByMicrophone);
    });
    return holdersByOccurrence;
  }, [
    duplicateScheduleFirstNames,
    requirementsByOccurrence,
    scheduleColumns,
    scheduleDisplayMembers,
    scheduleOccurrences,
    selectedSchedule,
    selectedTeam?.usesMicrophoneAssignments,
  ]);

  const iemHoldersByOccurrence = useMemo(() => {
    const holdersByOccurrence = new Map<string, Map<string, { slotKey: string; label: string }[]>>();
    if (!selectedTeam?.usesIemAssignments || !selectedSchedule) return holdersByOccurrence;
    scheduleOccurrences.forEach((occurrence) => {
      const holdersByIem = new Map<string, { slotKey: string; label: string }[]>();
      scheduleColumns.forEach((column) => {
        const cell = selectedSchedule.assignments?.[occurrence.occurrenceId]?.[column.columnKey];
        const memberId = getCellPrimaryMemberId(cell);
        const member = scheduleDisplayMembers.find((item) => item.memberId === memberId);
        const label = member ? scheduleMemberName(member, duplicateScheduleFirstNames) : column.label;
        const slotKey = `${occurrence.occurrenceId}:${column.columnKey}`;
        (selectedSchedule.iemAssignments?.[occurrence.occurrenceId]?.[column.columnKey] || []).forEach((iemId) => {
          const holders = holdersByIem.get(iemId) || [];
          holders.push({ slotKey, label });
          holdersByIem.set(iemId, holders);
        });
      });
      holdersByOccurrence.set(occurrence.occurrenceId, holdersByIem);
    });
    return holdersByOccurrence;
  }, [duplicateScheduleFirstNames, scheduleColumns, scheduleDisplayMembers, scheduleOccurrences, selectedSchedule, selectedTeam?.usesIemAssignments]);

  const saveMicrophoneAssignment = useCallback(
    async (
      { occurrenceId, columnKey }: { occurrenceId: string; columnKey: string },
      microphoneIds: string[],
    ) => {
      if (!canEdit || !churchId || !selectedSchedule) return;
      const { optimistic } = stageScheduleCellEdit(
        selectedSchedule,
        "microphoneAssignments",
        occurrenceId,
        columnKey,
        microphoneIds,
      );
      const queueSave = (schedule: TeamSchedule) => {
        const saveKey = scheduleCellEditKey(churchId, schedule.scheduleId, "microphoneAssignments", occurrenceId, columnKey);
        const edit = pendingScheduleCellEditsRef.current.get(saveKey);
        if (!edit) return;
        void queueEquipmentCellSave(edit);
      };
      try {
        const schedule = await ensureActiveSchedule(optimistic);
        if (!schedule) return;
        const positionSlotSave = pendingPositionSlotSavesRef.current.get(
          schedulePositionSlotSaveKey(churchId, schedule.scheduleId, occurrenceId, columnKey),
        );
        if (positionSlotSave) {
          const outcome = positionSlotSave.outcome === "failed"
            ? "failed"
            : positionSlotSave.outcome === "cancelled"
              ? "cancelled"
              : await positionSlotSave.promise;
          if (outcome === "failed") {
            const key = scheduleCellEditKey(churchId, schedule.scheduleId, "microphoneAssignments", occurrenceId, columnKey);
            const edit = pendingScheduleCellEditsRef.current.get(key);
            if (edit) showPositionSlotDependencyRetry(edit);
            return;
          }
          if (outcome === "cancelled") return;
        }
        queueSave(schedule);
      } catch {
        const message = "Couldn't prepare this schedule for the microphone change. Your choice is still here.";
        const toastId = showToast({
          message,
          variant: "error",
          persist: true,
          children: (
            <div className="mt-2 flex justify-center">
              <Button variant="primary" className="text-sm" onClick={() => {
                removeToast(toastId);
                void ensureActiveSchedule(optimistic).then((schedule) => {
                  if (schedule) queueSave(schedule);
                }).catch(() => showToast(message, "error"));
              }}>Retry save</Button>
            </div>
          ),
        });
      }
    },
    [
      canEdit,
      churchId,
      ensureActiveSchedule,
      removeToast,
      queueEquipmentCellSave,
      showPositionSlotDependencyRetry,
      selectedSchedule,
      showToast,
      stageScheduleCellEdit,
    ],
  );

  const saveIemAssignment = useCallback(
    async ({ occurrenceId, columnKey }: { occurrenceId: string; columnKey: string }, iemIds: string[]) => {
      if (!canEdit || !churchId || !selectedSchedule) return;
      const { optimistic } = stageScheduleCellEdit(
        selectedSchedule,
        "iemAssignments",
        occurrenceId,
        columnKey,
        iemIds,
      );
      const queueSave = (schedule: TeamSchedule) => {
        const saveKey = scheduleCellEditKey(churchId, schedule.scheduleId, "iemAssignments", occurrenceId, columnKey);
        const edit = pendingScheduleCellEditsRef.current.get(saveKey);
        if (!edit) return;
        void queueEquipmentCellSave(edit);
      };
      try {
        const schedule = await ensureActiveSchedule(optimistic);
        if (!schedule) return;
        const positionSlotSave = pendingPositionSlotSavesRef.current.get(
          schedulePositionSlotSaveKey(churchId, schedule.scheduleId, occurrenceId, columnKey),
        );
        if (positionSlotSave) {
          const outcome = positionSlotSave.outcome === "failed"
            ? "failed"
            : positionSlotSave.outcome === "cancelled"
              ? "cancelled"
              : await positionSlotSave.promise;
          if (outcome === "failed") {
            const key = scheduleCellEditKey(churchId, schedule.scheduleId, "iemAssignments", occurrenceId, columnKey);
            const edit = pendingScheduleCellEditsRef.current.get(key);
            if (edit) showPositionSlotDependencyRetry(edit);
            return;
          }
          if (outcome === "cancelled") return;
        }
        queueSave(schedule);
      } catch {
        const toastId = showToast({
          message: "Couldn't prepare this schedule for the IEM change. Your choice is still here.",
          variant: "error",
          persist: true,
          children: (
            <div className="mt-2 flex justify-center">
              <Button variant="primary" className="text-sm" onClick={() => {
                removeToast(toastId);
                void ensureActiveSchedule(optimistic).then((schedule) => {
                  if (schedule) queueSave(schedule);
                }).catch(() => showToast("Couldn't prepare this schedule for the IEM change. Your choice is still here.", "error"));
              }}>Retry save</Button>
            </div>
          ),
        });
      }
    },
    [canEdit, churchId, ensureActiveSchedule, queueEquipmentCellSave, removeToast, selectedSchedule, showPositionSlotDependencyRetry, showToast, stageScheduleCellEdit],
  );

  // Grid occurrence headers are sticky (positioned), so the badge anchors to the
  // header cell. Absolute so it never adds row/column height; it straddles the
  // cell's top edge like the board's card ribbon. Up next takes precedence over
  // Today when an occurrence is both.
  const renderOccurrenceMarker = (occurrence: {
    occurrenceId: string;
    startsAt: string;
  }) => {
    if (occurrence.occurrenceId === nextUpcomingOccurrenceId) {
      return (
        <span className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2">
          <ScheduleUpNextBadge />
        </span>
      );
    }
    if (isOccurrenceToday(occurrence, serviceTimeZone)) {
      return (
        <span className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2">
          <ScheduleTodayBadge />
        </span>
      );
    }
    return null;
  };

  const occurrenceHeaderHighlightClassName = (occurrence: {
    occurrenceId: string;
    startsAt: string;
  }) =>
    scheduleOccurrenceHeaderHighlightClassName({
      isNextUpcoming: occurrence.occurrenceId === nextUpcomingOccurrenceId,
      isToday: isOccurrenceToday(occurrence, serviceTimeZone),
    });

  // Board accordion state lives here so the header's expand-all/collapse-all
  // controls and the per-card chevrons stay in sync. Default expanded on desktop
  // and collapsed on phones; `overrides` only records explicit toggles.
  const boardCardsExpandedByDefault = useMediaQuery("(min-width: 768px)");
  const [boardExpandOverrides, setBoardExpandOverrides] = useState<
    Map<string, boolean>
  >(() => new Map());
  const isBoardCardExpanded = (occurrenceId: string) =>
    boardExpandOverrides.get(occurrenceId) ?? boardCardsExpandedByDefault;
  const toggleBoardCard = (occurrenceId: string) =>
    setBoardExpandOverrides((prev) => {
      const next = new Map(prev);
      next.set(
        occurrenceId,
        !(prev.get(occurrenceId) ?? boardCardsExpandedByDefault),
      );
      return next;
    });
  const setAllBoardCardsExpanded = (expanded: boolean) =>
    setBoardExpandOverrides(
      new Map(
        scheduleOccurrences.map((occurrence) => [
          occurrence.occurrenceId,
          expanded,
        ]),
      ),
    );
  const allBoardCardsExpanded = scheduleOccurrences.every((occurrence) =>
    isBoardCardExpanded(occurrence.occurrenceId),
  );
  const allBoardCardsCollapsed = scheduleOccurrences.every(
    (occurrence) => !isBoardCardExpanded(occurrence.occurrenceId),
  );

  const scheduleOccurrenceColumnCh = useMemo(() => {
    const chByOccurrence = new Map<string, number>();
    flatOccurrences.forEach(({ occurrence, group }) => {
      const labels = [
        formatOccurrenceRowLabel(occurrence, group.sharedTiming, serviceTimeZone),
      ];
      scheduleColumns.forEach((column) => {
        const assignmentCell =
          selectedSchedule?.assignments?.[occurrence.occurrenceId]?.[column.columnKey];
        labels.push(
          capScheduleColumnLabelForSizing(
            getAssignmentCellContentLabel({
              assignmentCell,
              positionName: column.label,
              members: scheduleDisplayMembers,
              duplicateFirstNames: duplicateScheduleFirstNames,
            }),
          ),
        );
      });
      chByOccurrence.set(
        occurrence.occurrenceId,
        toScheduleColumnMinCh(pickLongestLabel(...labels)),
      );
    });
    return chByOccurrence;
  }, [
    scheduleDisplayMembers,
    duplicateScheduleFirstNames,
    flatOccurrences,
    scheduleColumns,
    selectedSchedule?.assignments,
    serviceTimeZone,
  ]);

  const cellAxisHighlightMap = useMemo(() => {
    const map = new Map<string, string>();
    // Cards have no row/column cross to highlight, so the board layout never reads
    // this map — skip building it (and the grid-semantics fallback) entirely.
    if (scheduleLayout === "board" || !activeSlot) return map;

    if (activeGridLayout === "transpose") {
      scheduleColumns.forEach((column, columnIndex) => {
        flatOccurrences.forEach(({ occurrence }) => {
          const className = scheduleAxisHighlightClassName(
            getScheduleAxisHighlight({
              layout: activeGridLayout,
              focusedCell: activeSlot,
              occurrenceId: occurrence.occurrenceId,
              columnKey: column.columnKey,
            }),
            { rowIndex: columnIndex, surface: "body" },
          );
          if (className) {
            map.set(
              scheduleGridCellKey(occurrence.occurrenceId, column.columnKey),
              className,
            );
          }
        });
      });
      return map;
    }

    scheduleOccurrences.forEach((occurrence, rowIndex) => {
      scheduleColumns.forEach((column) => {
        const className = scheduleAxisHighlightClassName(
          getScheduleAxisHighlight({
            layout: activeGridLayout,
            focusedCell: activeSlot,
            occurrenceId: occurrence.occurrenceId,
            columnKey: column.columnKey,
          }),
          { rowIndex, surface: "body" },
        );
        if (className) {
          map.set(
            scheduleGridCellKey(occurrence.occurrenceId, column.columnKey),
            className,
          );
        }
      });
    });
    return map;
  }, [
    activeGridLayout,
    flatOccurrences,
    activeSlot,
    scheduleColumns,
    scheduleOccurrences,
    scheduleLayout,
  ]);

  const getAdditionalPositionOptions = useCallback(
    (occurrenceId: string) => {
      const requirements = requirementsByOccurrence.get(occurrenceId) || [];
      const enabledSlots = new Set(selectedSchedule?.additionalPositionSlots?.[occurrenceId] || []);
      return schedulePositions.filter(isActive).map((position) => {
        const requiredCount = getRequiredCount(requirements, position.positionId);
        let nextSlot = requiredCount;
        while (enabledSlots.has(makeSlotKey(position.positionId, nextSlot))) {
          nextSlot += 1;
        }
        return [{
          positionId: position.positionId,
          label: `${position.name}${nextSlot > 0 ? ` ${nextSlot + 1}` : ""}`,
        }];
      }).flat();
    },
    [requirementsByOccurrence, schedulePositions, selectedSchedule?.additionalPositionSlots],
  );

  const addPositionSlot = useCallback(
    async ({ serviceId, cellKey }: { serviceId: string; cellKey: string }) => {
      if (!canEdit || !churchId || !selectedSchedule) return;
      let previousSchedule: TeamSchedule;
      try {
        const ensuredSchedule = await ensureActiveSchedule();
        if (!ensuredSchedule) return;
        previousSchedule = ensuredSchedule;
      } catch (error) {
        showApiErrorToast(showToast, error, "Could not start this schedule.");
        return;
      }
      const additionalPositionSlots = {
        ...(previousSchedule.additionalPositionSlots || {}),
        [serviceId]: [
          ...new Set([
            ...(previousSchedule.additionalPositionSlots?.[serviceId] || []),
            cellKey,
          ]),
        ],
      };
      const saveKey = schedulePositionSlotSaveKey(
        churchId,
        previousSchedule.scheduleId,
        serviceId,
        cellKey,
      );
      const existingSave = pendingPositionSlotSavesRef.current.get(saveKey);
      if (existingSave) {
        if (existingSave.outcome === "failed") void existingSave.retry();
        return;
      }
      publishScheduleSnapshot(
        { ...previousSchedule, additionalPositionSlots },
        ["additionalPositionSlots"],
      );
      let retryPositionSlotSave!: () => Promise<PositionSlotSaveOutcome>;
      const makeAttempt = (): PendingPositionSlotSave => {
        let resolve!: (outcome: PositionSlotSaveOutcome) => void;
        const attempt: PendingPositionSlotSave = {
          promise: new Promise((settle) => { resolve = settle; }),
          outcome: "saving",
          resolve: (outcome) => resolve(outcome),
          retry: () => retryPositionSlotSave(),
        };
        return attempt;
      };
      const initialAttempt = makeAttempt();
      pendingPositionSlotSavesRef.current.set(saveKey, initialAttempt);
      let retryToastId: string | null = null;
      const saveAttempt = async (attempt: PendingPositionSlotSave): Promise<PositionSlotSaveOutcome> => {
        attempt.outcome = "saving";
        try {
          await enqueueAssignmentSave(previousSchedule.scheduleId, () =>
            addTeamSchedulePositionSlot(
              churchId,
              previousSchedule.scheduleId,
              { serviceId, positionSlotKey: cellKey },
            ),
          );
          if (wasPositionSlotSaveCancelled(attempt)) return "cancelled";
          if (pendingPositionSlotSavesRef.current.get(saveKey) === attempt) {
            pendingPositionSlotSavesRef.current.delete(saveKey);
          }
          attempt.outcome = "saved";
          attempt.resolve("saved");
          if (retryToastId) removeToast(retryToastId);
          positionSlotSaveToastIdsRef.current.delete(saveKey);
          showToast("Position added for this date.", "success");
          resumePendingEquipmentSaves(previousSchedule, serviceId, cellKey);
          return "saved";
        } catch {
          if (wasPositionSlotSaveCancelled(attempt)) return "cancelled";
          attempt.outcome = "failed";
          attempt.resolve("failed");
          if (retryToastId) removeToast(retryToastId);
          retryToastId = showToast({
            message: "Couldn't save this position. It stays visible while you retry.",
            variant: "error",
            persist: true,
            children: (
              <div className="mt-2 flex justify-center">
                <Button variant="primary" className="text-sm" onClick={() => {
                  if (retryToastId) removeToast(retryToastId);
                  retryToastId = null;
                  positionSlotSaveToastIdsRef.current.delete(saveKey);
                  void retryPositionSlotSave();
                }}>Retry save</Button>
              </div>
            ),
          });
          positionSlotSaveToastIdsRef.current.set(saveKey, retryToastId);
          return "failed";
        }
      };
      retryPositionSlotSave = async () => {
        const current = pendingPositionSlotSavesRef.current.get(saveKey);
        if (current?.outcome === "saving") return current.promise;
        if (current?.outcome === "failed") {
          const toastId = positionSlotSaveToastIdsRef.current.get(saveKey);
          if (toastId) removeToast(toastId);
          positionSlotSaveToastIdsRef.current.delete(saveKey);
          retryToastId = null;
          const nextAttempt = makeAttempt();
          pendingPositionSlotSavesRef.current.set(saveKey, nextAttempt);
          return saveAttempt(nextAttempt);
        }
        if (current?.outcome === "cancelled" || initialAttempt.outcome === "cancelled") {
          return "cancelled";
        }
        if (current?.outcome === "saved" || initialAttempt.outcome === "saved" || !current) {
          return "saved";
        }
        return current.promise;
      };
      await saveAttempt(initialAttempt);
    },
    [canEdit, churchId, enqueueAssignmentSave, ensureActiveSchedule, publishScheduleSnapshot, removeToast, resumePendingEquipmentSaves, selectedSchedule, showToast],
  );

  const addAdditionalPosition = useCallback(
    async ({ serviceId, positionId }: { serviceId: string; positionId: string }) => {
      if (!selectedSchedule) return;
      const requirements = requirementsByOccurrence.get(serviceId);
      const requiredCount = getRequiredCount(requirements, positionId);
      const enabledSlots = new Set(selectedSchedule.additionalPositionSlots?.[serviceId] || []);
      let nextSlot = requiredCount;
      while (enabledSlots.has(makeSlotKey(positionId, nextSlot))) {
        nextSlot += 1;
      }
      await addPositionSlot({ serviceId, cellKey: makeSlotKey(positionId, nextSlot) });
    },
    [addPositionSlot, requirementsByOccurrence, selectedSchedule],
  );

  const renderAdditionalPositionMenu = (occurrenceId: string) => {
    const options = getAdditionalPositionOptions(occurrenceId);
    if (!canEdit || options.length === 0) return null;
    return (
      <Menu
        align="end"
        menuItems={options.map((option) => ({
          text: `Add ${option.label}`,
          onClick: () =>
            void addAdditionalPosition({
              serviceId: occurrenceId,
              positionId: option.positionId,
            }),
        }))}
        TriggeringButton={
          <Button type="button" variant="tertiary" iconSize="sm" className="text-xs">
            Add position
          </Button>
        }
      />
    );
  };

  const requestRemoveAdditionalPosition = useCallback(
    ({ serviceId, cellKey }: { serviceId: string; cellKey: string }) => {
      if (!canEdit) return;
      setPendingAdditionalPositionRemoval({ serviceId, cellKey });
    },
    [canEdit],
  );

  const confirmRemoveAdditionalPosition = useCallback(async () => {
    if (!churchId || !selectedSchedule || !pendingAdditionalPositionRemoval) return;
    const { serviceId, cellKey } = pendingAdditionalPositionRemoval;
    let previousSchedule: TeamSchedule;
    try {
      const ensuredSchedule = await ensureActiveSchedule();
      if (!ensuredSchedule) return;
      previousSchedule = ensuredSchedule;
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not start this schedule.");
      return;
    }
    cancelPendingPositionSlotWork(churchId, previousSchedule.scheduleId, serviceId, cellKey);
    const additionalPositionSlots = { ...(previousSchedule.additionalPositionSlots || {}) };
    const nextSlots = (additionalPositionSlots[serviceId] || []).filter(
      (slotKey) => slotKey !== cellKey,
    );
    if (nextSlots.length) additionalPositionSlots[serviceId] = nextSlots;
    else delete additionalPositionSlots[serviceId];

    const assignments = { ...(previousSchedule.assignments || {}) };
    const assignmentRow = { ...(assignments[serviceId] || {}) };
    delete assignmentRow[cellKey];
    if (Object.keys(assignmentRow).length) assignments[serviceId] = assignmentRow;
    else delete assignments[serviceId];

    const microphoneAssignments = { ...(previousSchedule.microphoneAssignments || {}) };
    const microphoneRow = { ...(microphoneAssignments[serviceId] || {}) };
    delete microphoneRow[cellKey];
    if (Object.keys(microphoneRow).length) microphoneAssignments[serviceId] = microphoneRow;
    else delete microphoneAssignments[serviceId];
    const iemAssignments = { ...(previousSchedule.iemAssignments || {}) };
    const iemRow = { ...(iemAssignments[serviceId] || {}) };
    delete iemRow[cellKey];
    if (Object.keys(iemRow).length) iemAssignments[serviceId] = iemRow;
    else delete iemAssignments[serviceId];

    setPendingAdditionalPositionRemoval(null);
    const optimisticSchedule = {
      ...previousSchedule,
      additionalPositionSlots,
      assignments,
      microphoneAssignments,
      iemAssignments,
    };
    publishScheduleSnapshot(optimisticSchedule, [
      "additionalPositionSlots",
      "assignments",
      "microphoneAssignments",
      "iemAssignments",
    ]);
    const saveRemoval = async (): Promise<void> => {
      try {
        const response = await enqueueAssignmentSave(previousSchedule.scheduleId, () =>
          removeTeamSchedulePositionSlot(
            churchId,
            previousSchedule.scheduleId,
            { serviceId, positionSlotKey: cellKey },
          ),
        );
        const affectedCell = [{ occurrenceId: serviceId, cellKey }];
        publishScheduleCellResponses(response.schedule, "assignments", affectedCell);
        publishScheduleCellResponses(response.schedule, "microphoneAssignments", affectedCell);
        publishScheduleCellResponses(response.schedule, "iemAssignments", affectedCell);
        showToast("Position removed from this service.", "success");
      } catch (error) {
        const toastId = showToast({
          message: "Couldn't remove this position yet. Your change stays visible while you retry.",
          variant: "error",
          persist: true,
          children: (
            <div className="mt-2 flex justify-center">
              <Button variant="primary" className="text-sm" onClick={() => {
                removeToast(toastId);
                void saveRemoval();
              }}>Retry save</Button>
            </div>
          ),
        });
      }
    };
    await saveRemoval();
  }, [
    cancelPendingPositionSlotWork,
    churchId,
    enqueueAssignmentSave,
    ensureActiveSchedule,
    pendingAdditionalPositionRemoval,
    publishScheduleCellResponses,
    publishScheduleSnapshot,
    removeToast,
    selectedSchedule,
    showToast,
  ]);

  const assignmentHandlers: ScheduleAssignmentHandlers = {
    getAssignmentIssue,
    getAssignmentActionIssues,
    handleAssignmentAction,
    requestCellMemberAction,
    commitAssignment,
    commitShadowAssignment,
    createMemberForCell,
    addAdditionalPosition,
    requestRemoveAdditionalPosition,
    activateSlot,
    clearActiveSlot,
    setPendingCellAssignment,
    confirmPendingReplace,
    confirmPendingShadow,
  };

  const buildGridCellProps = useCallback(
    (
      occurrence: TeamScheduleOccurrence,
      column: ScheduleSlotColumn,
      rowTone: string,
    ) => {
      const assignmentCell =
        selectedSchedule?.assignments?.[occurrence.occurrenceId]?.[column.columnKey];
      const cellKey = scheduleGridCellKey(occurrence.occurrenceId, column.columnKey);
      const isActiveSlot =
        activeSlot?.occurrenceId === occurrence.occurrenceId &&
        activeSlot?.columnKey === column.columnKey;
      const requirements = requirementsByOccurrence.get(occurrence.occurrenceId);
      const requiredCount = getRequiredCount(requirements, column.positionId);
      const additionalSlotKeys =
        selectedSchedule?.additionalPositionSlots?.[occurrence.occurrenceId];
      const isAdditionalPosition = Boolean(
        additionalSlotKeys?.includes(column.columnKey),
      );
      const isSlotEnabled = isOccurrenceStaffingSlot(
        column,
        requirements,
        additionalSlotKeys,
      );

      return {
        occurrenceId: occurrence.occurrenceId,
        occurrenceName: occurrence.name,
        // Lets a cell flag an assignee who has since blocked this date out.
        // The picker only warns while filling a slot, so without this a
        // blockout added after the fact is invisible in the grid.
        occurrenceDate: getOccurrenceDate(occurrence, serviceTimeZone),
        columnKey: column.columnKey,
        positionId: column.positionId,
        columnLabel: column.label,
        rowTone,
        slot: column.slot,
        requiredCount,
        isSlotEnabled,
        isAdditionalPosition,
        axisHighlightClassName: cellAxisHighlightMap.get(cellKey) ?? "",
        assignmentCell,
        assignmentResponse:
          selectedSchedule?.responses?.[occurrence.occurrenceId]?.[
          column.columnKey
          ],
        isMemberHighlighted: getCellMemberIds(assignmentCell).some((memberId) =>
          highlightedMemberIdSet.has(memberId),
        ),
        isActiveSlot,
        justFilled: justFilledCellKeys.has(cellKey),
        allMembers: scheduleDisplayMembers,
        duplicateFirstNames: duplicateScheduleFirstNames,
        canEdit,
        microphones: selectedTeam?.usesMicrophoneAssignments ? microphones : undefined,
        microphoneIds:
          selectedSchedule?.microphoneAssignments?.[occurrence.occurrenceId]?.[
          column.columnKey
          ],
        microphoneHolders: selectedTeam?.usesMicrophoneAssignments
          ? microphoneHoldersByOccurrence.get(occurrence.occurrenceId)
          : undefined,
        microphonesLoading: microphoneCatalogStatus === "loading",
        microphonesUnavailable: microphoneCatalogStatus === "error",
        onMicrophoneChange: selectedTeam?.usesMicrophoneAssignments
          ? (microphoneIds: string[]) => {
            void saveMicrophoneAssignment(
              { occurrenceId: occurrence.occurrenceId, columnKey: column.columnKey },
              microphoneIds,
            );
          }
          : undefined,
        iems: selectedTeam?.usesIemAssignments ? iems : undefined,
        iemLoading: iemCatalogStatus === "loading",
        iemUnavailable: iemCatalogStatus === "error",
        iemIds: selectedSchedule?.iemAssignments?.[occurrence.occurrenceId]?.[column.columnKey],
        iemHoldersByIem: selectedTeam?.usesIemAssignments
          ? iemHoldersByOccurrence.get(occurrence.occurrenceId)
          : undefined,
        onIemChange: selectedTeam?.usesIemAssignments
          ? (iemIds: string[]) => { void saveIemAssignment({ occurrenceId: occurrence.occurrenceId, columnKey: column.columnKey }, iemIds); }
          : undefined,
      };
    },
    [
      activeSlot,
      canEdit,
      cellAxisHighlightMap,
      scheduleDisplayMembers,
      duplicateScheduleFirstNames,
      highlightedMemberIdSet,
      justFilledCellKeys,
      microphoneCatalogStatus,
      microphoneHoldersByOccurrence,
      microphones,
      iems,
      iemCatalogStatus,
      iemHoldersByOccurrence,
      requirementsByOccurrence,
      serviceTimeZone,
      saveMicrophoneAssignment,
      saveIemAssignment,
      selectedSchedule,
      selectedTeam?.usesMicrophoneAssignments,
      selectedTeam?.usesIemAssignments,
    ],
  );


  const renderScheduleMembersPanel = (drawer = false) => (
    <ScheduleMembersPanel
      open={membersPanelOpen}
      drawer={drawer}
      expandedMemberIds={expandedMemberIds}
      onExpandedMemberIdsChange={setExpandedMemberIds}
      membersSort={membersSort}
      onMembersSortChange={setMembersSort}
      onOpenChange={handleMembersPanelOpenChange}
      mode={memberAssignmentMode ? "assign" : "browse"}
      activeTeamMembers={activeTeamMembers}
      schedulePositions={schedulePositions}
      scheduleStartDate={scheduleDateBounds.startDate}
      scheduleEndDate={scheduleDateBounds.endDate}
      scheduleAssignmentCounts={scheduleAssignmentCounts}
      memberServingHistory={memberServingHistory}
      recommendationStats={activeSlotRecommendationStats}
      duplicateFirstNames={duplicateScheduleFirstNames}
      highlightedMemberIdSet={highlightedMemberIdSet}
      onToggleHighlight={toggleHighlightedMember}
      memberPositionFilterIds={memberPositionFilterIds}
      onMemberPositionFilterChange={setMemberPositionFilterIds}
      membersPanelQuery={membersPanelQuery}
      onMembersPanelQueryChange={setMembersPanelQuery}
      assignmentQuery={assignmentQuery}
      onAssignmentQueryChange={setAssignmentQuery}
      slotContext={
        activeSlotMeta
          ? {
            positionLabel: activeSlotMeta.positionLabel,
            occurrenceLabel: activeSlotMeta.occurrenceLabel,
            currentAssigneeLabel: activeSlotMeta.currentAssigneeLabel,
            positionId: activeSlotMeta.positionId,
            currentPrimaryMemberId: activeSlotMeta.currentPrimaryMemberId,
          }
          : undefined
      }
      onClearSlot={clearActiveSlot}
      onSelectMember={canEdit
        ? (memberId) => {
          if (drawer) handleMembersPanelOpenChange(false);
          handleActiveSlotMemberSelect(memberId);
        }
        : () => undefined}
      getIssue={activeSlotGetIssue}
      getAssignmentActionIssues={activeSlotGetAssignmentActionIssues}
      getWarning={activeSlotGetWarning}
      canEditMember={canEditMember}
      onEditMember={handleEditMemberFromPanel}
    />
  );

  const openSavedScheduleForReview = (scheduleId: string) => {
    const schedule = schedules.find((item) => item.scheduleId === scheduleId);
    if (!schedule) return;
    setFormState(null);
    setPeriodScheduleSelection(null);
    if (schedule.teamId !== workspaceTeamId) {
      setScheduleTeamFilter(schedule.teamId);
      writeScheduleTeamFilter(churchId, schedule.teamId);
    }
    if (schedule.startDate && schedule.endDate) {
      hasExplicitPeriodSelectionRef.current = true;
      setPeriodSelection("custom", { start: schedule.startDate, end: schedule.endDate });
    }
    setViewingSavedSchedule(true);
    setSelectedScheduleId(schedule.scheduleId, true);
  };

  const scheduleEditForm = (
    <ScheduleEditForm
      mode={formState?.mode || "create-custom"}
      draftKey={formDraftKey}
      persistedDraft={persistedDraft}
      selectedSchedule={formSelectedSchedule}
      copySourceSchedule={formCopySourceSchedule}
      defaultTeamId={defaultTeamId}
      defaultServiceIds={defaultServiceIds}
      defaultRange={defaultRange}
      services={data.services}
      positions={data.positions}
      activeTeams={activeTeams}
      schedules={onlyHydratedSchedules(data.schedules)}
      seedSchedules={data.schedules}
      churchId={churchId}
      serviceTimeZone={serviceTimeZone}
      canEdit={canEdit}
      onDraftChange={onScheduleDraftChanged}
      onDraftFlush={onScheduleDraftFlush}
      onDraftClear={onScheduleDraftClear}
      onScheduleSaved={onScheduleSaved}
      onScheduleRemoved={onScheduleRemoved}
      setSelectedScheduleId={setSelectedScheduleId}
      onReviewSchedule={(scheduleId) => requestDiscardAction(() => openSavedScheduleForReview(scheduleId))}
      onCancel={() => requestDiscardAction(() => setFormState(null))}
    />
  );

  const scheduleActionsMenuItems: MenuItemType[] = [
    ...(isChurchAdmin ? createScheduleCsvMenuItems({
      churchId,
      onImport: () => setScheduleImportOpen(true),
      onExportError: (error) => showApiErrorToast(showToast, error, "Could not download schedules CSV."),
      exportBusy: scheduleCsvBusy,
      setExportBusy: setScheduleCsvBusy,
    }) : []),
    ...(canEdit
      ? [{
        element: (
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" aria-hidden />
            Create schedule
          </span>
        ),
        onClick: () => setFormState({ mode: "create-custom" }),
      }]
      : []),
    {
      text: "Schedule history",
      onClick: () => setIsBrowsingSchedules(true),
    },
    ...(canEdit && selectedSchedule && !selectedSchedule.scheduleId.startsWith("virtual:")
      ? [
        {
          element: (
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <MessageSquareText className="h-4 w-4" aria-hidden />
                Messages
                {scheduleMessagesRequiringAttention > 0 ? (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500/20 px-1.5 py-0.5 text-xs font-semibold text-amber-200">
                    {scheduleMessagesRequiringAttention}
                  </span>
                ) : null}
              </span>
              {scheduleNotificationIntents.length > 0 ? (
                <span className="pl-6 text-xs text-gray-400">
                  {pendingScheduleMessageCount} pending · {scheduleNotificationCounts.delivered} delivered · {scheduleNotificationCounts.failed} failed
                </span>
              ) : null}
            </span>
          ),
          onClick: () => {
            if (shouldOverlayMembers) handleMembersPanelOpenChange(false);
            setScheduleMessagesOpen(true);
          },
          "aria-expanded": scheduleMessagesOpen,
        },
        {
          element: (
            <span className="flex items-center gap-2">
              <Pencil className="h-4 w-4" aria-hidden />
              {selectedSchedule.source === "generated-period"
                ? "Schedule details"
                : "Edit schedule"}
            </span>
          ),
          onClick: () => setFormState({
            mode: "edit",
            scheduleId: selectedSchedule.scheduleId,
          }),
        },
        {
          element: (
            <span className="flex items-center gap-2">
              <Copy className="h-4 w-4" aria-hidden />
              Copy schedule
            </span>
          ),
          onClick: handleCopySchedule,
        },
      ]
      : []),
  ];

  const scheduleWorkflowActions = (
    <div
      className="flex flex-wrap items-center justify-end gap-2"
      role="group"
      aria-label="Schedule actions"
    >
      {canEdit && selectedSchedule ? (
        <Popover
          open={isConfirmingSend}
          onOpenChange={(open) => {
            if (!open && isSendingSchedule) return;
            setIsConfirmingSend(open);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="cta"
              svg={Send}
              iconSize="sm"
              disabled={isSendingSchedule || sendRecipientCount === 0}
            >
              Send schedule
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[min(20rem,calc(100vw-2rem))] border-gray-700 bg-gray-900 p-3 text-gray-100"
          >
            {selectedSchedule.published === false ? (
              <>
                <p className="text-sm text-amber-200">Publish this schedule before sending email or text messages.</p>
                <Button variant="tertiary" disabled={isSendingSchedule} onClick={() => setIsConfirmingSend(false)}>Close</Button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-300">
                  Email {sendRecipientCount} {sendRecipientCount === 1 ? "person" : "people"} on this schedule?
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="cta"
                    svg={Send}
                    iconSize="sm"
                    disabled={isSendingSchedule}
                    onClick={handleSendSchedule}
                  >
                    {isSendingSchedule ? "Sending…" : "Yes, send email"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={isSendingSchedule || selectedSchedule.scheduleId.startsWith("virtual:")}
                    onClick={() => {
                      setIsConfirmingSend(false);
                      setScheduleInitialSmsOpen(true);
                    }}
                  >
                    Review volunteers for text messages
                  </Button>
                  <Button
                    variant="tertiary"
                    disabled={isSendingSchedule}
                    onClick={() => setIsConfirmingSend(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </PopoverContent>
        </Popover>
      ) : null}
      <Menu
        align="end"
        menuItems={scheduleActionsMenuItems}
        TriggeringButton={
          <Button
            variant="tertiary"
            svg={MoreHorizontal}
            iconSize="sm"
            ref={scheduleActionsTriggerRef}
            aria-label="More schedule options"
          />
        }
      />
    </div>
  );
  const scheduleRangeSummary = selectedSchedule && scheduleOccurrences.length > 0
    ? `${scheduleOccurrences.length} ${scheduleOccurrences.length === 1 ? "service" : "services"} · ${selectedSchedule.scheduleId.startsWith("virtual:")
      ? "Staffing not started"
      : `${staffingProgress.filled} of ${staffingProgress.required} positions filled`
    }`
    : undefined;

  return (
    <div className={scheduleTabRootClassName}>
      {isChurchAdmin ? (
        <PortableDataImportDialog
          open={scheduleImportOpen}
          onOpenChange={setScheduleImportOpen}
          churchId={churchId}
          type="schedules"
          onImported={onImported}
        />
      ) : null}
      {showForm ? (
        <div
          className={cn(
            teamsManagerPageRootClassName,
            teamsCreatePanelFormOpenMobileClassName,
          )}
        >
          <div
            className={cn(
              "w-full min-w-0",
              teamsCreatePanelFormClassName,
              "lg:mx-auto",
            )}
          >
            {scheduleEditForm}
          </div>
        </div>
      ) : (
        <>
          <h2 className="sr-only">Schedules</h2>
          <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div role="group" aria-label="Team schedule identity" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              {scheduleReturnTo ? (
                <TeamsReturnBackButton
                  returnTo={scheduleReturnTo}
                  onClick={() => returnFromSchedule()}
                />
              ) : null}
              <h1 className="sr-only flex min-w-0 items-center gap-2 text-xl font-semibold text-gray-100 sm:not-sr-only">
                <Icon svg={CalendarDays} size="md" className="shrink-0 text-cyan-200" />
                <span className="truncate">Team schedule</span>
              </h1>
            </div>
            {scheduleWorkflowActions}
          </header>

          <section className={cn(panelShellClassName, "w-full shrink-0 px-3 py-3")}>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:gap-4">
              <Select
                className="w-full sm:w-60"
                label="Team"
                labelLayout="inline"
                value={workspaceTeamId}
                onChange={updateScheduleTeamFilter}
                options={activeTeams.map((team) => ({ label: team.name, value: team.teamId }))}
                disabled={!activeTeams.length}
              />
              {periodScheduleChoices.length > 1 && selectedScheduleRecord ? (
                <ScheduleOverlapPicker
                  schedules={periodScheduleChoices}
                  selectedScheduleId={selectedScheduleRecord.scheduleId}
                  onSelect={(scheduleId) => {
                    hasExplicitPeriodSelectionRef.current = true;
                    setPeriodScheduleSelection({ scope: periodSelectionScope, scheduleId });
                    setViewingSavedSchedule(false);
                    setSelectedScheduleId(scheduleId, !scheduleId.startsWith("virtual:"));
                  }}
                />
              ) : null}
              <RangeSelector
                preset={periodPreset}
                range={displayedPeriodRange}
                onPresetChange={selectPeriodPreset}
                onCustomRangeChange={(range) => {
                  hasExplicitPeriodSelectionRef.current = true;
                  setPeriodScheduleSelection(null);
                  selectCustomRange(range);
                  setViewingSavedSchedule(false);
                }}
                onNavigate={shiftPeriod}
                className="min-w-0 flex-1 sm:min-w-0"
                labelLayout="inline"
              />
            </div>
            {periodScheduleMatch.ambiguous && !viewingSavedSchedule ? (
              <div role="status" className="mt-3 rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
                This schedule contains services that have changed since it was saved. Review it before making changes.
                {periodScheduleMatch.reviewSchedule ? (
                  <Button
                    type="button"
                    variant="tertiary"
                    className="mt-2"
                    onClick={() => {
                      const scheduleId = periodScheduleMatch.reviewSchedule?.scheduleId;
                      if (scheduleId) openSavedScheduleForReview(scheduleId);
                    }}
                  >
                    Review existing schedule
                  </Button>
                ) : null}
              </div>
            ) : null}
            {periodScheduleMatch.ownershipConflict && !viewingSavedSchedule ? (
              <div role="alert" className="mt-3 rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
                More than one saved schedule contains the same service occurrence. Review ownership before making changes.
                {periodScheduleMatch.reviewSchedule ? (
                  <Button
                    type="button"
                    variant="tertiary"
                    className="mt-2"
                    onClick={() => {
                      const scheduleId = periodScheduleMatch.reviewSchedule?.scheduleId;
                      if (scheduleId) openSavedScheduleForReview(scheduleId);
                    }}
                  >
                    Review existing schedule
                  </Button>
                ) : null}
              </div>
            ) : null}
          </section>

          {canShowScheduleWorkspace ? (
            <section
              ref={scheduleWorkspaceRef}
              className={cn(panelClassName, scheduleWorkspacePanelClassName)}
            >
              <div className="shrink-0">
                <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  {scheduleRangeSummary ? (
                    <p role="status" className="min-w-0 px-0.5 text-xs text-gray-400">
                      {scheduleRangeSummary}
                    </p>
                  ) : null}
                  <div
                    role="group"
                    aria-label="Team schedule controls"
                    className="flex min-w-0 shrink-0 flex-nowrap items-center justify-end gap-2 lg:ml-auto"
                  >
                    {selectedSchedule && shouldOverlayMembers ? (
                      <Button
                        type="button"
                        variant="tertiary"
                        svg={Users}
                        iconSize="sm"
                        ref={membersDrawerTriggerRef}
                        data-schedule-members-trigger
                        aria-controls="schedule-members-panel"
                        aria-expanded={membersPanelOpen}
                        aria-pressed={membersPanelOpen}
                        aria-label="Members"
                        title={membersPanelOpen ? "Hide Members panel" : "Show Members panel"}
                        className={cn(
                          "gap-1.5",
                          membersPanelOpen
                            ? "bg-gray-700 text-white"
                            : "text-gray-300",
                        )}
                        onClick={() => {
                          setMembersDrawerAnimationsEnabled(true);
                          if (!membersPanelOpen) setScheduleMessagesOpen(false);
                          setMembersPanelOpen((open) => !open);
                        }}
                      >
                        <span className="hidden sm:inline">Members</span>
                      </Button>
                    ) : null}
                    {/* Desktop: Organize + Layout sit labeled in the toolbar.
                        Narrow: both move into the overflow menu to save space. */}
                    {!isNarrowViewport ? (
                      <>
                        {scheduleHasMultipleServices ? (
                          <div className="flex flex-col gap-1">
                            <span className="px-0.5 text-xs font-semibold text-gray-400">
                              Organize
                            </span>
                            <SegmentedControl
                              ariaLabel="Organize schedule"
                              variant="compact"
                              value={organizeMode}
                              onChange={changeOrganizeMode}
                              options={OCCURRENCE_ORGANIZE_OPTIONS}
                            />
                          </div>
                        ) : null}
                        <div className="flex flex-col gap-1">
                          <span className="px-0.5 text-xs font-semibold text-gray-400">
                            Layout
                          </span>
                          <SegmentedControl
                            ariaLabel="Schedule layout"
                            variant="compact"
                            value={scheduleLayout}
                            onChange={changeScheduleLayout}
                            options={scheduleLayoutOptions}
                          />
                        </div>
                      </>
                    ) : null}
                    {/* Board accordion: expand/collapse every service at once. */}
                    {scheduleLayout === "board" && scheduleOccurrences.length > 1 ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="tertiary"
                          svg={ChevronsUpDown}
                          iconSize="sm"
                          disabled={allBoardCardsExpanded}
                          onClick={() => setAllBoardCardsExpanded(true)}
                          aria-label="Expand all services"
                          title="Expand all services"
                        />
                        <Button
                          variant="tertiary"
                          svg={ChevronsDownUp}
                          iconSize="sm"
                          disabled={allBoardCardsCollapsed}
                          onClick={() => setAllBoardCardsExpanded(false)}
                          aria-label="Collapse all services"
                          title="Collapse all services"
                        />
                      </div>
                    ) : null}
                    {/* Edit history: the frequent, in-flow controls stay visible. */}
                    {canEdit ? (
                      <>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="tertiary"
                            svg={Undo2}
                            iconSize="sm"
                            disabled={!canUndo || autoFilling}
                            onClick={handleUndo}
                            aria-label={undoLabel ? `Undo ${undoLabel}` : "Undo"}
                            title={
                              undoLabel
                                ? `Undo ${undoLabel} (${undoShortcut.undo})`
                                : `Nothing to undo (${undoShortcut.undo})`
                            }
                          />
                          <Button
                            variant="tertiary"
                            svg={Redo2}
                            iconSize="sm"
                            disabled={!canRedo || autoFilling}
                            onClick={handleRedo}
                            aria-label={redoLabel ? `Redo ${redoLabel}` : "Redo"}
                            title={
                              redoLabel
                                ? `Redo ${redoLabel} (${undoShortcut.redo})`
                                : `Nothing to redo (${undoShortcut.redo})`
                            }
                          />
                        </div>
                        {SHOW_PASTE_FROM_EXCEL ? (
                          <Button
                            variant="tertiary"
                            svg={ClipboardPaste}
                            iconSize="sm"
                            onClick={() => setPasteRowOpen(true)}
                          >
                            Paste from Excel
                          </Button>
                        ) : null}
                        <span
                          aria-hidden
                          className="mx-0.5 h-5 w-px self-center bg-gray-700"
                        />
                      </>
                    ) : null}
                    {/* Infrequent schedule actions, including auto-fill.
                        On narrow viewports, Organize and Layout live here too. */}
                    <Menu
                      align="end"
                      menuItems={[
                        ...(canEdit
                          ? [
                            {
                              element: (
                                <span className="flex items-center gap-2">
                                  <Wand2 className="h-4 w-4" aria-hidden />
                                  {autoFilling ? "Auto-filling…" : "Auto-fill"}
                                </span>
                              ),
                              onClick: () => setAutoFillConfirmOpen(true),
                              disabled: autoFilling,
                            },
                          ]
                          : []),
                        ...(isNarrowViewport && scheduleHasMultipleServices
                          ? [
                            {
                              element: (
                                <span className="flex items-center gap-2">
                                  <CalendarDays className="h-4 w-4" aria-hidden />
                                  Organize
                                </span>
                              ),
                              subItems: OCCURRENCE_ORGANIZE_OPTIONS.map(
                                (option) => ({
                                  text: `${organizeMode === option.value ? "✓ " : ""}${option.label}`,
                                  onClick: () => changeOrganizeMode(option.value),
                                }),
                              ),
                            },
                          ]
                          : []),
                        ...(isNarrowViewport
                          ? [
                            {
                              element: (
                                <span className="flex items-center gap-2">
                                  <LayoutGrid className="h-4 w-4" aria-hidden />
                                  Layout
                                </span>
                              ),
                              subItems: scheduleLayoutOptions.map((option) => ({
                                text: `${scheduleLayout === option.value ? "✓ " : ""}${option.label}`,
                                onClick: () => changeScheduleLayout(option.value),
                              })),
                            },
                          ]
                          : []),
                        {
                          element: (
                            <span className="flex items-center gap-2">
                              <Printer className="h-4 w-4" aria-hidden />
                              Save as PDF
                            </span>
                          ),
                          onClick: () => setPdfPreviewOpen(true),
                          disabled: !scheduleExportModel,
                        },
                        ...(canEdit
                          ? [
                            {
                              element: (
                                <span className="flex items-center gap-2">
                                  <Link2 className="h-4 w-4" aria-hidden />
                                  {copyingLink
                                    ? "Copying…"
                                    : "Copy view-only link"}
                                </span>
                              ),
                              onClick: () => void copyPublicLink(),
                              disabled: copyingLink,
                              preventClose: copyingLink,
                            },
                          ]
                          : []),
                      ] as MenuItemType[]}
                      TriggeringButton={
                        <Button
                          variant="tertiary"
                          svg={MoreHorizontal}
                          iconSize="sm"
                          aria-label="More schedule actions"
                        />
                      }
                    />
                    {/* A modal, not a popover: this opens from a menu item, and
                     * the menu's own focus handling as it closes dismisses a
                     * non-modal popover before anyone can reach Continue. Same
                     * pattern as the PDF preview below. */}
                    <Modal
                      isOpen={autoFillConfirmOpen}
                      onClose={() => setAutoFillConfirmOpen(false)}
                      title="Auto-fill"
                      size="sm"
                      description="Fill this schedule's empty slots with eligible team members."
                    >
                      <p className="text-sm leading-snug text-gray-300">
                        Fills empty slots with eligible team members. Existing
                        assignments stay as they are, and you can undo
                        afterward.
                      </p>
                      <div className="mt-4 flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => setAutoFillConfirmOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          disabled={autoFilling}
                          onClick={() => {
                            setAutoFillConfirmOpen(false);
                            void handleAutoFillSchedule();
                          }}
                        >
                          Continue
                        </Button>
                      </div>
                    </Modal>
                    <Modal
                      isOpen={Boolean(pendingAdditionalPositionRemoval)}
                      onClose={() => setPendingAdditionalPositionRemoval(null)}
                      title="Remove added position"
                      size="sm"
                    >
                      <p className="text-sm leading-snug text-gray-300">
                        Remove {pendingAdditionalPositionRemovalDetails?.label || "this position"} from
                        this service? This does not change the service&apos;s required positions.
                      </p>
                      {pendingAdditionalPositionRemovalDetails?.memberCount ||
                        pendingAdditionalPositionRemovalDetails?.microphoneCount ? (
                        <p className="mt-3 text-sm leading-snug text-amber-100">
                          This will also clear {pendingAdditionalPositionRemovalDetails.memberCount
                            ? "the assigned person"
                            : ""}
                          {pendingAdditionalPositionRemovalDetails.memberCount &&
                            pendingAdditionalPositionRemovalDetails.microphoneCount
                            ? " and "
                            : ""}
                          {pendingAdditionalPositionRemovalDetails.microphoneCount
                            ? "the microphone assignment"
                            : ""}.
                        </p>
                      ) : null}
                      <div className="mt-4 flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => setPendingAdditionalPositionRemoval(null)}
                        >
                          Cancel
                        </Button>
                        <Button variant="destructive" onClick={() => void confirmRemoveAdditionalPosition()}>
                          Remove position
                        </Button>
                      </div>
                    </Modal>
                    <SchedulePdfExportButton
                      model={scheduleExportModel}
                      layout={toScheduleExportLayout(scheduleLayout)}
                      hideTrigger
                      open={pdfPreviewOpen}
                      onOpenChange={setPdfPreviewOpen}
                    />
                  </div>
                </div>
              </div>

              {(occurrencesStale || (canEdit && refreshBlocked)) && !showForm ? (
                <div className="mt-4 flex shrink-0 flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-amber-100">
                    {refreshBlocked
                      ? "These saved occurrence rows cannot be matched one-to-one to current services. Assignments and equipment remain preserved. Review the saved schedule before creating a replacement."
                      : "The scheduled time or occurrence details changed. Refresh the snapshot; its saved occurrence IDs and related schedule records will be kept."}
                  </p>
                  <Button
                    variant="secondary"
                    iconSize="sm"
                    disabled={applyingGrouping || refreshBlocked}
                    onClick={() => void refreshScheduleOccurrences()}
                  >
                    {applyingGrouping ? "Refreshing..." : "Refresh schedule"}
                  </Button>
                </div>
              ) : null}

              <ScheduleAssignmentProvider handlers={assignmentHandlers}>
                <div className={scheduleWorkspaceBodyRowClassName}>
                  <div className={scheduleWorkspaceMainColumnClassName}>
                    <div className="flex min-w-0 flex-col outline-none max-lg:flex-none lg:min-h-0 lg:flex-1">
                      {scheduleLayout === "board" ? (
                        <div className={scheduleGridScrollClassName}>
                          <ScheduleBoardView
                            groups={occurrencesByService}
                            columns={scheduleColumns}
                            teamName={selectedTeam?.name || ""}
                            timeZone={serviceTimeZone}
                            canEdit={canEdit}
                            nextUpcomingOccurrenceId={nextUpcomingOccurrenceId}
                            fillByOccurrence={fillByOccurrence}
                            isExpanded={isBoardCardExpanded}
                            onToggleExpanded={toggleBoardCard}
                            serviceArchivedById={(serviceId) =>
                              Boolean(
                                data.services.find(
                                  (item) => item.serviceId === serviceId,
                                )?.archivedAt,
                              )
                            }
                            onOpenServiceSummary={openServiceSummary}
                            getAdditionalPositionOptions={getAdditionalPositionOptions}
                            buildCellProps={buildGridCellProps}
                          />
                        </div>
                      ) : scheduleLayout === "transpose" ? (
                        <div className={scheduleGridScrollClassName}>
                          <div className={scheduleGridFrameClassName}>
                            <table className="w-max border-collapse text-left text-sm table-auto">
                              <colgroup>
                                <col />
                                {flatOccurrences.map(({ occurrence }) => {
                                  const columnCh =
                                    scheduleOccurrenceColumnCh.get(occurrence.occurrenceId) ??
                                    toScheduleColumnMinCh("Empty");
                                  return (
                                    <col
                                      key={occurrence.occurrenceId}
                                      style={{
                                        width: `${columnCh}ch`,
                                        minWidth: `${columnCh}ch`,
                                        maxWidth: `${columnCh}ch`,
                                      }}
                                    />
                                  );
                                })}
                              </colgroup>
                              <thead>
                                <tr>
                                  <th
                                    rowSpan={2}
                                    className={cn(
                                      "sticky left-0 top-0 z-20 border-b text-gray-200",
                                      scheduleGridBottomBorderClassName,
                                      schedulePositionColumnClassName,
                                      scheduleStickyPositionColumnClassName,
                                      scheduleCellPaddingClassName,
                                      scheduleStickyRowTone(1),
                                    )}
                                  >
                                    Position
                                  </th>
                                  {occurrencesByService.map((group) => (
                                    <th
                                      key={group.key}
                                      colSpan={group.occurrences.length}
                                      className={cn(
                                        "border-b bg-gray-950 text-center font-semibold text-white",
                                        scheduleServiceHeaderBottomBorderClassName,
                                        scheduleServiceHeaderLeftBorderClassName,
                                        scheduleCellPaddingClassName,
                                        serviceHeaderRowTone,
                                      )}
                                    >
                                      <div className="flex flex-col items-center gap-0.5">
                                        <span className="whitespace-nowrap">
                                          {group.serviceName}
                                        </span>
                                        {group.sharedTiming.sharedWeekday ||
                                          group.sharedTiming.sharedTime ? (
                                          <span className="font-normal text-gray-300">
                                            {[
                                              group.sharedTiming.sharedWeekday,
                                              [group.sharedTiming.sharedTime, group.sharedTiming.sharedTime && group.occurrences[0]
                                                ? getOccurrenceTimeZoneAbbreviation(group.occurrences[0].startsAt, serviceTimeZone)
                                                : null].filter(Boolean).join(" "),
                                            ]
                                              .filter(Boolean)
                                              .join(" ")}
                                          </span>
                                        ) : null}
                                      </div>
                                    </th>
                                  ))}
                                </tr>
                                <tr>
                                  {flatOccurrences.map(({ occurrence, group }) => (
                                    <th
                                      key={occurrence.occurrenceId}
                                      className={cn(
                                        "sticky top-0 z-10 border-b bg-gray-950 text-gray-200",
                                        scheduleGridBottomBorderClassName,
                                        scheduleGridLeftBorderClassName,
                                        schedulePositionColumnClassName,
                                        scheduleCellPaddingClassName,
                                        occurrenceHeaderHighlightClassName(occurrence),
                                        getAxisHighlightClassName(occurrence.occurrenceId, undefined, {
                                          surface: "header",
                                        }),
                                      )}
                                    >
                                      {/* Keep "Add position" in the date header — not a fake assignment
                                          row — so the position grid stays clean. */}
                                      {renderOccurrenceMarker(occurrence)}
                                      <div className="flex flex-col items-start gap-1">
                                        <ScheduleOccurrenceDateButton
                                          label={formatOccurrenceRowLabel(occurrence, group.sharedTiming, serviceTimeZone)}
                                          ariaLabel={`View and copy assignments for ${group.serviceName} on ${formatOccurrenceRowLabel(occurrence, group.sharedTiming, serviceTimeZone)}`}
                                          onClick={() => openServiceSummary(occurrence.occurrenceId)}
                                        />
                                        {renderAdditionalPositionMenu(occurrence.occurrenceId)}
                                      </div>
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {scheduleColumns.map((column, columnIndex) => {
                                  const rowTone = scheduleRowTone(columnIndex);
                                  const stickyTone = scheduleStickyRowTone(columnIndex);
                                  return (
                                    <tr
                                      key={column.columnKey}
                                      className={cn("border-t", scheduleGridTopBorderClassName, rowTone)}
                                    >
                                      <th
                                        className={cn(
                                          "sticky left-0 z-10 align-middle",
                                          scheduleGridRightBorderClassName,
                                          schedulePositionColumnClassName,
                                          scheduleStickyPositionColumnClassName,
                                          scheduleCellPaddingClassName,
                                          stickyTone,
                                          getAxisHighlightClassName(undefined, column.columnKey, {
                                            rowIndex: columnIndex,
                                            surface: "sticky",
                                          }),
                                        )}
                                      >
                                        <span className="inline-flex min-w-0 max-w-full items-center gap-2">
                                          {column.position.icon ? (
                                            <PositionIconBadge
                                              icon={column.position.icon}
                                              className="h-6 w-6 rounded"
                                              iconClassName="h-4 w-4"
                                            />
                                          ) : null}
                                          <span className={cn(scheduleStickyPositionLabelClassName, "font-medium text-white")}>
                                            {column.label}
                                          </span>
                                          {column.position.archivedAt ? (
                                            <span className="shrink-0 text-xs text-gray-500">(archived)</span>
                                          ) : null}
                                        </span>
                                      </th>
                                      {flatOccurrences.map(({ occurrence }) => (
                                        <ScheduleGridCell
                                          key={scheduleGridCellKey(occurrence.occurrenceId, column.columnKey)}
                                          {...buildGridCellProps(occurrence, column, rowTone)}
                                        />
                                      ))}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                        <div className={scheduleGridScrollClassName}>
                          <div className={scheduleGridFrameClassName}>
                            <table className="w-max border-collapse text-left text-sm table-auto">
                              <colgroup>
                                <col style={{ minWidth: `${scheduleDateColumnMinCh}ch` }} />
                                {scheduleColumns.map((column) => {
                                  const columnCh =
                                    scheduleColumnMinCh.get(column.columnKey) ??
                                    toScheduleColumnMinCh("Empty");
                                  return (
                                    <col
                                      key={column.columnKey}
                                      style={{
                                        width: `${columnCh}ch`,
                                        minWidth: `${columnCh}ch`,
                                        maxWidth: `${columnCh}ch`,
                                      }}
                                    />
                                  );
                                })}
                              </colgroup>
                              <thead>
                                <tr>
                                  <th className={cn("sticky left-0 top-0 z-20 border-b bg-gray-950 text-gray-200", scheduleGridBottomBorderClassName, scheduleDateColumnClassName, scheduleCellPaddingClassName)}>
                                    Date &amp; time
                                  </th>
                                  {scheduleColumns.map((column) => {
                                    return (
                                      <th key={column.columnKey} className={cn("sticky top-0 z-10 border-b bg-gray-950 text-gray-200", scheduleGridBottomBorderClassName, scheduleGridLeftBorderClassName, schedulePositionColumnClassName, scheduleCellPaddingClassName, getAxisHighlightClassName(undefined, column.columnKey, { surface: "header" }))}>
                                        <span className="inline-flex items-center gap-2">
                                          {column.position.icon ? (
                                            <PositionIconBadge
                                              icon={column.position.icon}
                                              className="h-6 w-6 rounded"
                                              iconClassName="h-4 w-4"
                                            />
                                          ) : null}
                                          <span>{column.label}</span>
                                          {column.position.archivedAt ? <span className="text-xs text-gray-500">(archived)</span> : null}
                                        </span>
                                      </th>
                                    );
                                  })}
                                </tr>
                              </thead>
                              <tbody>
                                {effectiveOrganizeMode === "byDate"
                                  ? flatOccurrences.map(({ occurrence, group }, rowIndex) => {
                                    const service = data.services.find(
                                      (item) => item.serviceId === group.serviceId,
                                    );
                                    const rowTone = scheduleRowTone(rowIndex);
                                    const stickyTone = scheduleStickyRowTone(rowIndex);
                                    const dateLabel = formatOccurrenceTiming(occurrence, serviceTimeZone);
                                    return (
                                      <tr
                                        key={occurrence.occurrenceId}
                                        className={cn(
                                          "border-t",
                                          scheduleGridTopBorderClassName,
                                          rowTone,
                                        )}
                                      >
                                        <th
                                          className={cn(
                                            "sticky left-0 z-10 align-middle",
                                            scheduleGridRightBorderClassName,
                                            scheduleDateColumnClassName,
                                            scheduleCellPaddingClassName,
                                            stickyTone,
                                            occurrenceHeaderHighlightClassName(occurrence),
                                            getAxisHighlightClassName(
                                              occurrence.occurrenceId,
                                              undefined,
                                              { rowIndex, surface: "sticky" },
                                            ),
                                          )}
                                        >
                                          {renderOccurrenceMarker(occurrence)}
                                          <div className="flex flex-col items-start gap-1">
                                            <span className="text-xs font-semibold text-white">
                                              {group.serviceName}
                                              {service?.archivedAt ? (
                                                <span className="ml-1.5 font-normal text-gray-500">
                                                  Archived
                                                </span>
                                              ) : null}
                                            </span>
                                            <ScheduleOccurrenceDateButton
                                              label={dateLabel}
                                              ariaLabel={`View and copy assignments for ${group.serviceName} on ${dateLabel}`}
                                              onClick={() =>
                                                openServiceSummary(occurrence.occurrenceId)
                                              }
                                            />
                                            {renderAdditionalPositionMenu(
                                              occurrence.occurrenceId,
                                            )}
                                          </div>
                                        </th>                                        {scheduleColumns.map((column) => (
                                          <ScheduleGridCell
                                            key={scheduleGridCellKey(
                                              occurrence.occurrenceId,
                                              column.columnKey,
                                            )}
                                            {...buildGridCellProps(
                                              occurrence,
                                              column,
                                              rowTone,
                                            )}
                                          />
                                        ))}
                                      </tr>
                                    );
                                  })
                                  : occurrencesByService.map((group, groupIndex) => {
                                    const service = data.services.find(
                                      (item) => item.serviceId === group.serviceId,
                                    );
                                    return (
                                      <Fragment key={group.key}>
                                        <tr
                                          className={cn(
                                            "border-t",
                                            scheduleServiceHeaderTopBorderClassName,
                                            serviceHeaderRowTone,
                                          )}
                                        >
                                          <th
                                            colSpan={scheduleColumns.length + 1}
                                            className={cn(
                                              "p-0 text-left align-top",
                                              serviceHeaderRowTone,
                                            )}
                                          >
                                            <div
                                              className={cn(
                                                "sticky left-0 z-10 inline-flex w-max max-w-full flex-nowrap items-center gap-x-2 p-2 font-semibold text-white",
                                              )}
                                            >
                                              <span className="shrink-0">
                                                {group.serviceName}
                                              </span>
                                              {group.sharedTiming.sharedWeekday ? (
                                                <span className="shrink-0 font-normal text-gray-300">
                                                  {group.sharedTiming.sharedWeekday}
                                                </span>
                                              ) : null}
                                              {group.sharedTiming.sharedTime ? (
                                                <span className="shrink-0 font-normal text-gray-300">
                                                  {[
                                                    group.sharedTiming.sharedTime,
                                                    group.occurrences[0]
                                                      ? getOccurrenceTimeZoneAbbreviation(group.occurrences[0].startsAt, serviceTimeZone)
                                                      : null,
                                                  ].filter(Boolean).join(" ")}
                                                </span>
                                              ) : null}
                                              {service?.archivedAt ? (
                                                <span className="shrink-0 text-xs font-normal text-gray-500">
                                                  Archived
                                                </span>
                                              ) : null}
                                            </div>
                                          </th>
                                        </tr>
                                        {group.occurrences.map(
                                          (occurrence, occurrenceIndex) => {
                                            const rowIndex =
                                              occurrenceRowOffsets[groupIndex] +
                                              occurrenceIndex;
                                            const rowTone = scheduleRowTone(rowIndex);
                                            const stickyTone =
                                              scheduleStickyRowTone(rowIndex);
                                            return (
                                              <Fragment key={occurrence.occurrenceId}>
                                                <tr
                                                  className={cn(
                                                    "border-t",
                                                    scheduleGridTopBorderClassName,
                                                    rowTone,
                                                  )}
                                                >
                                                  <th
                                                    className={cn(
                                                      "sticky left-0 z-10 align-middle",
                                                      scheduleGridRightBorderClassName,
                                                      scheduleDateColumnClassName,
                                                      scheduleCellPaddingClassName,
                                                      stickyTone,
                                                      occurrenceHeaderHighlightClassName(
                                                        occurrence,
                                                      ),
                                                      getAxisHighlightClassName(
                                                        occurrence.occurrenceId,
                                                        undefined,
                                                        {
                                                          rowIndex,
                                                          surface: "sticky",
                                                        },
                                                      ),
                                                    )}
                                                  >
                                                    {renderOccurrenceMarker(occurrence)}
                                                    <div className="flex flex-col items-start gap-1">
                                                      <ScheduleOccurrenceDateButton
                                                        label={formatOccurrenceRowLabel(
                                                          occurrence,
                                                          group.sharedTiming,
                                                          serviceTimeZone,
                                                        )}
                                                        ariaLabel={`View and copy assignments for ${group.serviceName} on ${formatOccurrenceRowLabel(occurrence, group.sharedTiming, serviceTimeZone)}`}
                                                        onClick={() =>
                                                          openServiceSummary(
                                                            occurrence.occurrenceId,
                                                          )
                                                        }
                                                      />
                                                      {renderAdditionalPositionMenu(
                                                        occurrence.occurrenceId,
                                                      )}
                                                    </div>
                                                  </th>                                                  {scheduleColumns.map((column) => (
                                                    <ScheduleGridCell
                                                      key={scheduleGridCellKey(
                                                        occurrence.occurrenceId,
                                                        column.columnKey,
                                                      )}
                                                      {...buildGridCellProps(
                                                        occurrence,
                                                        column,
                                                        rowTone,
                                                      )}
                                                    />
                                                  ))}
                                                </tr>
                                              </Fragment>
                                            );
                                          },
                                        )}
                                      </Fragment>
                                    );
                                  })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <ScheduleAssignmentPicker
                    open={Boolean(canEdit && activeSlot && activeSlotMeta && pickerAnchorEl)}
                    anchorEl={pickerAnchorEl}
                    label={`${activeSlotMeta?.occurrenceName || ""} ${activeSlotMeta?.positionLabel || ""}`}
                    positionId={activeSlotMeta?.positionId || ""}
                    positionName={activeSlotMeta?.positionLabel || ""}
                    members={activeTeamMembers}
                    assignmentQuery={assignmentQuery}
                    onAssignmentQueryChange={setAssignmentQuery}
                    currentPrimaryMemberId={activeSlotMeta?.currentPrimaryMemberId || ""}
                    currentAssigneeLabel={activeSlotMeta?.currentAssigneeLabel || "Empty"}
                    currentAssigneeIsGuest={activeSlotMeta?.currentAssigneeIsGuest}
                    hasCurrentAssignee={activeSlotMeta?.hasCurrentAssignee}
                    duplicateFirstNames={duplicateScheduleFirstNames}
                    recommendationStats={activeSlotRecommendationStats}
                    getIssue={activeSlotGetIssue}
                    getAssignmentActionIssues={
                      slotPickerMode === "replace"
                        ? undefined
                        : activeSlotGetAssignmentActionIssues
                    }
                    getWarning={activeSlotGetWarning}
                    onSelectMember={handleActiveSlotMemberSelect}
                    onAssignmentAction={handleActiveSlotAssignmentAction}
                    swapRecommendations={activeSlotSwapRecommendations}
                    onApplySwapRecommendation={(recommendation) =>
                      void commitActiveSlotSwapRecommendation(recommendation)
                    }
                    onCreateMember={
                      slotPickerMode === "replace"
                        ? undefined
                        : handleActiveSlotCreateMember
                    }
                    recentGuests={recentScheduleGuests}
                    editableGuestIds={editableScheduleGuestIds}
                    getGuestWarning={activeSlotGetGuestWarning}
                    onAssignGuest={
                      slotPickerMode === "replace"
                        ? undefined
                        : commitGuestAssignment
                    }
                    onEditGuest={
                      slotPickerMode === "replace" ? undefined : commitGuestEdit
                    }
                    onRemoveGuest={
                      slotPickerMode === "replace"
                        ? undefined
                        : (guestId) => {
                          const guest = selectedSchedule?.guests?.find(
                            (item) => item.guestId === guestId,
                          );
                          if (guest) return commitGuestRemoval(guest);
                        }
                    }
                    onClearAssignment={
                      slotPickerMode === "replace"
                        ? undefined
                        : handleActiveSlotClearAssignment
                    }
                    onClose={clearActiveSlot}
                    currentShadows={activeSlotMeta?.currentShadows}
                    onRemoveShadow={
                      slotPickerMode === "replace"
                        ? undefined
                        : handleActiveSlotRemoveShadow
                    }
                    pendingSubmenu={pendingPickerSubmenu}
                    inputRef={pickerInputRef}
                  />
                  {!shouldOverlayMembers ? renderScheduleMembersPanel() : null}
                </div>
              </ScheduleAssignmentProvider>
              {shouldOverlayMembers ? (
                <Drawer
                  isOpen={membersPanelOpen}
                  onClose={() => handleMembersPanelOpenChange(false)}
                  title="Members"
                  position="right"
                  size="xl"
                  showBackdrop
                  animationEnabled={membersDrawerAnimationsEnabled}
                  className="!max-w-[min(32rem,90vw)] max-sm:!max-w-full"
                  contentPadding="p-3"
                >
                  {renderScheduleMembersPanel(true)}
                </Drawer>
              ) : null}
              {canEdit && selectedSchedule ? (
                <ScheduleMessagesPanel
                  key={`${churchId}:${selectedSchedule.scheduleId}`}
                  open={scheduleMessagesOpen}
                  onOpenChange={setScheduleMessagesOpen}
                  intents={scheduleNotificationIntents}
                  members={data.members}
                  duplicateFirstNames={duplicateScheduleFirstNames}
                  counts={scheduleNotificationCounts}
                  loading={loadingScheduleNotifications}
                  nextCursor={scheduleNotificationNextCursor}
                  sendingIntentId={sendingNotificationIntentId}
                  getVolunteerResponse={(intent) => {
                    const response = selectedSchedule.responses?.[intent.occurrenceId]?.[intent.cellKey || ""];
                    return response?.memberId === intent.memberId ? response.response : "waiting";
                  }}
                  onSend={(intent) => void handleSendScheduleIntent(intent)}
                  onCloseInvitation={(intent) => void handleResolveReplacementIntent(intent)}
                  onLoadOlder={() => void loadOlderScheduleNotifications()}
                  replacementVacancies={!scheduleMessagesOpen || selectedSchedule.scheduleId.startsWith("virtual:") ? [] : scheduleOccurrences.flatMap((occurrence) => scheduleColumns.flatMap((column) => {
                    if (!isOccurrenceStaffingSlot(column, requirementsByOccurrence.get(occurrence.occurrenceId), selectedSchedule.additionalPositionSlots?.[occurrence.occurrenceId])) return [];
                    const cell = selectedSchedule.assignments?.[occurrence.occurrenceId]?.[column.columnKey];
                    const holderId = typeof cell === "string" ? cell : cell?.primaryMemberId || "";
                    if (holderId && selectedSchedule.responses?.[occurrence.occurrenceId]?.[column.columnKey]?.response !== "declined") return [];
                    return [{ occurrenceId: occurrence.occurrenceId, cellKey: column.columnKey,
                      label: `${occurrence.name} · ${formatOccurrenceRowLabel(occurrence, { sharedWeekday: null, sharedTime: null }, serviceTimeZone)} · ${column.label}`,
                      memberIds: activeTeamMembers.filter((member) => member.memberId !== holderId && member.positionIds.includes(column.positionId) && member.serviceAvailability?.[occurrence.occurrenceId] !== "unavailable").map((member) => member.memberId),
                    }];
                  }))}
                  onPrepareReplacement={async (vacancy, memberId) => {
                    const scheduleId = selectedSchedule.scheduleId;
                    const result = await prepareReplacementNotificationIntent(churchId, { scheduleId, occurrenceId: vacancy.occurrenceId, cellKey: vacancy.cellKey, memberId });
                    if (latestScheduleRef.current?.scheduleId !== scheduleId || latestScheduleRef.current?.churchId !== churchId) return;
                    addScheduleNotificationIntents([result.intent]);
                    await handleSendScheduleIntent(result.intent);
                  }}
                />
              ) : null}
              {canEdit && selectedSchedule && !selectedSchedule.scheduleId.startsWith("virtual:") ? (
                <Drawer
                  key={`${churchId}:${selectedSchedule.scheduleId}:initial-sms`}
                  isOpen={scheduleInitialSmsOpen}
                  onClose={() => setScheduleInitialSmsOpen(false)}
                  title="Send schedule text messages"
                  position="right"
                  size="xl"
                  showBackdrop
                  className="!max-w-[min(46rem,90vw)] max-sm:!max-w-full"
                  contentPadding="p-0"
                  contentClassName="scrollbar-variable min-h-0 flex-1 overflow-y-auto"
                >
                  <ScheduleInitialSmsSendFlow
                    key={`${churchId}:${selectedSchedule.scheduleId}`}
                    churchId={churchId}
                    schedule={selectedSchedule}
                    scheduleName={selectedSchedule.name || "Schedule"}
                    teamName={data.teams.find((team) => team.teamId === selectedSchedule.teamId)?.name || "Team"}
                    timeZone={serviceTimeZone}
                    onClose={() => setScheduleInitialSmsOpen(false)}
                  />
                </Drawer>
              ) : null}
              {scheduleSmsPreview ? <SmsConfirmationModal
                isOpen
                recipientName={scheduleSmsPreview.recipientName}
                phoneNumberSnapshot={scheduleSmsPreview.phoneNumberSnapshot}
                message={scheduleSmsPreview.message}
                segmentCount={scheduleSmsPreview.segmentCount}
                busy={sendingScheduleSms}
                onCancel={cancelScheduleSms}
                onSend={() => void confirmScheduleSms()}
              /> : null}
              <Modal
                isOpen={Boolean(replacementIntentToClose)}
                onClose={() => { if (!closingReplacement) setReplacementIntentToClose(null); }}
                title="Close replacement invitation?"
                description="This allows the administrator to choose another candidate. The schedule assignment will not change."
                size="sm"
              >
                <div className="flex justify-end gap-2 text-sm">
                  <Button variant="secondary" disabled={closingReplacement} onClick={() => setReplacementIntentToClose(null)}>Cancel</Button>
                  <Button disabled={closingReplacement} isLoading={closingReplacement} onClick={() => void confirmResolveReplacementIntent()}>Close invitation</Button>
                </div>
              </Modal>
              {canEdit ? (
                <SchedulePasteRowDialog
                  open={pasteRowOpen}
                  onOpenChange={setPasteRowOpen}
                  occurrences={pasteRowOccurrenceOptions}
                  columns={scheduleColumns}
                  members={activeTeamMembers}
                  duplicateFirstNames={duplicateScheduleFirstNames}
                  defaultOccurrenceId={
                    activeSlot?.occurrenceId || detailOccurrenceId || undefined
                  }
                  getIssueForOccurrence={getIssueForOccurrence}
                  onApply={(occurrenceId, entries) =>
                    void commitRowAssignments(occurrenceId, entries)
                  }
                />
              ) : null}
            </section>
          ) : (
            <section className={panelClassName}>
              <div>
                <div className="mt-0">
                  {/* Assignments for schedules outside the loaded window arrive on
                    demand. Say so rather than dropping to an empty grid, which
                    would read as "nobody is assigned". */}
                  {scheduleWorkspaceEmptyMessage}
                </div>
              </div>
            </section>
          )}
        </>
      )}
      <ConfirmDialog
        open={guestRemovalConfirmation !== null}
        title="Remove guest from schedule?"
        description={guestRemovalConfirmation ?? ""}
        confirmLabel="Remove guest"
        destructive
        zIndexLevel={2}
        onConfirm={() => resolveGuestRemoval(true)}
        onCancel={() => resolveGuestRemoval(false)}
      />
      <ScheduleBrowserDialog
        isOpen={isBrowsingSchedules}
        onClose={() => setIsBrowsingSchedules(false)}
        schedules={schedules}
        teams={data.teams}
        selectedScheduleId={selectedScheduleId}
        // Opens already narrowed to the team the picker is showing.
        initialTeamId={workspaceTeamId}
        onSelectSchedule={(scheduleId) => {
          const selectedHistorySchedule = schedules.find(
            (schedule) => schedule.scheduleId === scheduleId,
          );
          setViewingSavedSchedule(true);
          if (selectedHistorySchedule?.startDate && selectedHistorySchedule.endDate) {
            setPeriodSelection(
              "custom",
              {
                start: selectedHistorySchedule.startDate,
                end: selectedHistorySchedule.endDate,
              },
            );
          }
          setSelectedScheduleId(scheduleId, true);
          setFormState(null);
        }}
      />
      <Modal
        isOpen={Boolean(detailOccurrence)}
        onClose={() => setDetailOccurrenceId(null)}
        title={detailOccurrence?.name || "Service schedule"}
        size="md"
        description={
          detailOccurrence
            ? `Assignments for ${detailOccurrence.name} on ${formatOccurrenceTiming(detailOccurrence, serviceTimeZone)}.`
            : "Service assignments."
        }
        headerAction={
          <Button
            variant="tertiary"
            svg={Clipboard}
            iconSize="sm"
            disabled={!detailMessage}
            onClick={() => void copyDetailOccurrenceAssignments()}
          >
            Copy
          </Button>
        }
      >
        {detailOccurrence ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              {formatOccurrenceTiming(detailOccurrence, serviceTimeZone)}
            </p>
            {detailSummaryGroups.length === 0 ? (
              <p className="rounded-md border border-gray-700 bg-gray-950/60 p-3 text-sm text-gray-300">
                This service has no required positions for this date.
              </p>
            ) : (
              <div className="rounded-md border border-gray-700 bg-gray-950/60 p-3">
                <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2">
                  {detailSummaryGroups.flatMap((group) => group.positions).map((position) => {
                    const positionIcon = positionIconById.get(position.positionId);
                    const empty = position.members.length === 0;
                    return (
                      <Fragment key={position.positionId}>
                        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-white">
                          {positionIcon ? (
                            <PositionIconBadge
                              icon={positionIcon}
                              className="h-6 w-6 rounded"
                              iconClassName="h-4 w-4"
                            />
                          ) : null}
                          {position.name}:
                        </span>
                        <span
                          className={cn(
                            "min-w-0 text-sm",
                            empty ? "italic text-amber-300/80" : "text-gray-200",
                          )}
                        >
                          {empty
                            ? OCCURRENCE_EMPTY_SLOT_LABEL
                            : position.members.map(formatSummaryMemberToken).join(", ")}
                        </span>
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Modal>
      <Modal
        isOpen={Boolean(pendingMoveAssignment)}
        onClose={() => setPendingMoveAssignment(null)}
        title="Move assignment"
        size="sm"
        description="Confirm the volunteer's new position in this service."
      >
        {pendingMoveAssignment ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-200">
              Move {describeMemberName(pendingMoveAssignment.memberId)} from{" "}
              {positionNameById.get(pendingMoveAssignment.sourcePositionSlotKey?.split("::")[0] || "") || "their current position"}{" "}
              to {positionNameById.get(pendingMoveAssignment.basePositionId) || "this position"}?
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="tertiary" onClick={() => setPendingMoveAssignment(null)}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={confirmPendingMove}>
                Move anyway
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
      <Modal
        isOpen={Boolean(pendingAvailabilityConfirmation)}
        onClose={dismissAvailabilityConfirmation}
        title={
          pendingAvailabilityConfirmationIsRecurring
            ? "Recurring availability"
            : "Blocked-out date"
        }
        size="sm"
        description={
          pendingAvailabilityConfirmationIsRecurring
            ? "Confirm whether to schedule this member outside their recurring availability."
            : "Confirm whether to schedule this member despite their blocked-out date."
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-200">
            {pendingAvailabilityConfirmationIsRecurring
              ? `${pendingAvailabilityMemberLabel} is not available during this week of the month.`
              : `${pendingAvailabilityMemberLabel} marked this date as blocked out.`}
          </p>
          <p className="text-sm text-gray-400">
            Confirm that they are available before scheduling them.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="tertiary"
              onClick={dismissAvailabilityConfirmation}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                const pending = pendingAvailabilityConfirmation;
                setPendingAvailabilityConfirmation(null);
                pending?.onConfirm();
              }}
            >
              {pendingAvailabilityConfirmation?.isMove
                ? "Move anyway"
                : "Schedule anyway"}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        isOpen={Boolean(pendingCrossTeamConflict)}
        onClose={dismissCrossTeamConflict}
        title="Schedule conflict"
        size="sm"
        description="Confirm whether to schedule this member despite a team conflict."
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-200">
            {pendingCrossTeamConflictMemberLabel} has these overlapping schedule assignments:
          </p>
          {pendingCrossTeamConflict?.conflicts.length ? (
            <ul className="max-h-48 space-y-2 overflow-y-auto rounded border border-gray-700 p-3 text-sm text-gray-300">
              {pendingCrossTeamConflict.conflicts.map((conflict, index) => {
                const teamName = data.teams.find((team) => team.teamId === conflict.teamId)?.name;
                return (
                  <li key={`${conflict.scheduleId}:${conflict.conflictingOccurrenceId || conflict.occurrenceId}:${index}`}>
                    {teamName || conflict.teamId || "Another team"}
                    {conflict.scheduleName ? ` · ${conflict.scheduleName}` : ""}
                    {conflict.conflictingOccurrenceId ? ` · ${conflict.conflictingOccurrenceId}` : ""}
                  </li>
                );
              })}
            </ul>
          ) : pendingCrossTeamConflict?.fingerprint ? (
            <p className="text-sm text-amber-300">The conflict set changed. There are no current overlaps; confirm again to continue.</p>
          ) : (
            <p className="text-sm text-gray-200">{pendingCrossTeamConflict?.warning}</p>
          )}
          <p className="text-sm text-gray-400">
            Confirm only if these schedule overlaps are intentional.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="tertiary"
              onClick={dismissCrossTeamConflict}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                const pending = pendingCrossTeamConflict;
                setPendingCrossTeamConflict(null);
                pending?.onConfirm();
              }}
            >
              {pendingCrossTeamConflict?.isMove
                ? "Move anyway"
                : "Schedule anyway"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ScheduleTab;
