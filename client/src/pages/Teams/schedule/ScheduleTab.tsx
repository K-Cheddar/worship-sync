import {
  Fragment,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  Clipboard,
  ClipboardList,
  Copy,
  Link2,
  Plus,
  RefreshCw,
  UserX,
} from "lucide-react";
import Button from "../../../components/Button/Button";
import SegmentedControl from "../../../components/SegmentedControl/SegmentedControl";
import Icon from "../../../components/Icon/Icon";
import Select from "../../../components/Select/Select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  lineTabsListShellClassName,
  lineTabsTriggerClassName,
} from "@/components/ui/tabs";
import { cn } from "@/utils/cnHelper";
import {
  formatOccurrenceRowLabel,
  formatOccurrenceTiming,
  generateScheduleOccurrences,
  getDefaultScheduleRange,
  getOccurrenceDate,
  getSharedOccurrenceTiming,
} from "@/utils/teamScheduleOccurrences";
import {
  createTeamRosterMember,
  getTeamSchedulePublicLink,
  updateTeam,
  updateTeamScheduleAssignment,
  updateTeamScheduleAttendance,
} from "../../../api/auth";
import { buildScheduleExportModel } from "./scheduleExport";
import SchedulePdfExportButton from "./SchedulePdfExportButton";
import { SCHEDULE_EXPORT_LAYOUTS } from "./scheduleExportPdf";
import { parsePlainDate } from "@/utils/plainDate";
import {
  ADMIN_SCHEDULE_LAYOUTS,
  readTeamScheduleAdminLayout,
  writeTeamScheduleAdminLayout,
} from "../teamScheduleAdminLayout";
import type {
  PositionRequirement,
  TeamPosition,
  TeamRecord,
  TeamRosterMember,
  TeamSchedule,
  TeamScheduleAttendanceStatus,
  TeamScheduleOccurrence,
  TeamScheduleShadowKind,
} from "../../../api/authTypes";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import { resolvePositionLucideIcon } from "../lucidePositionIcons";
import { panelClassName, panelHeaderPaddingClassName, panelShellClassName } from "../teamsStyles";
import type {
  PendingCellAssignment,
  TeamsData,
  TeamsScheduleDrafts,
} from "../types";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import {
  buildTeamSchedulePublicUrl,
  countScheduleAssignmentsForMember,
  getCellMemberIds,
  getCellPrimaryMemberId,
  getDuplicateScheduleFirstNames,
  isActive,
  normalizeAssignmentCell,
  scheduleMemberName,
  serializeAssignmentCell,
} from "../teamsUtils";
import {
  buildScheduleColumns,
  getRequiredCount,
  resolveOccurrenceRequirements,
  type ScheduleSlotColumn,
} from "./scheduleRequirements";
import ScheduleGridCell from "./ScheduleGridCell";
import ScheduleAssignmentPicker from "./ScheduleAssignmentPicker";
import ScheduleMembersPanel from "./ScheduleMembersPanel";
import {
  ScheduleAssignmentProvider,
  type ScheduleAssignmentHandlers,
} from "./ScheduleAssignmentContext";
import ScheduleOccurrenceDateButton from "./ScheduleOccurrenceDateButton";
import ScheduleEditForm from "./ScheduleEditForm";
import { buildScheduleCopyDraft } from "./scheduleDraftUtils";
import {
  buildOccurrenceSummaryGroups,
  formatOccurrenceMessage,
  formatSummaryMemberToken,
  OCCURRENCE_EMPTY_SLOT_LABEL,
} from "./occurrenceSummary";
import {
  buildAttendanceRows,
  buildRescheduleSuggestions,
  countAttendanceStatuses,
  type ScheduleAttendanceRow,
} from "./scheduleAttendance";
import {
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
  schedulePositionColumnClassName,
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

const ScheduleTab = ({
  data,
  canEdit,
  selectedScheduleId,
  setSelectedScheduleId,
  scheduleDrafts,
  onScheduleSaved,
  onScheduleRemoved,
  onMemberSaved,
  onTeamSaved,
  onScheduleDraftChanged,
  onScheduleDraftFlush,
  onRefresh,
}: {
  data: TeamsData;
  canEdit: boolean;
  selectedScheduleId: string;
  setSelectedScheduleId: (scheduleId: string) => void;
  scheduleDrafts: TeamsScheduleDrafts;
  onScheduleSaved: (schedule: TeamSchedule, replaceId?: string) => void;
  onScheduleRemoved: (scheduleId: string) => void;
  onMemberSaved: (member: TeamRosterMember, replaceId?: string) => void;
  onTeamSaved: (team: TeamRecord, replaceId?: string) => void;
  onScheduleDraftChanged: (draftKey: string, draft: TeamSchedulePayload) => void;
  onScheduleDraftFlush: (draftKey: string, draft: TeamSchedulePayload) => void;
  onRefresh: () => void;
}) => {
  const context = useContext(GlobalInfoContext);
  const { showToast } = useToast();
  const churchId = context?.churchId || "";
  const churchName = context?.churchName || "";
  const activeTeams = useMemo(() => data.teams.filter(isActive), [data.teams]);
  const activeServices = useMemo(
    () => data.services.filter(isActive),
    [data.services],
  );
  const defaultTeamId = activeTeams[0]?.teamId || "";
  const defaultServiceIds = useMemo(
    () => activeServices.map((service) => service.serviceId),
    [activeServices],
  );
  const defaultRange = useMemo(getDefaultScheduleRange, []);
  const schedules = data.schedules;
  const selectedSchedule = selectedScheduleId
    ? schedules.find((schedule) => schedule.scheduleId === selectedScheduleId) || null
    : null;
  const draftKey = selectedSchedule?.scheduleId || "new";
  const selectedTeam = data.teams.find((team) => team.teamId === selectedSchedule?.teamId) || null;
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
  // Stable placeholder for dateless services in legacy schedules that carry no
  // occurrences and no date range. Computed once so it never drifts as the memo
  // below recomputes on data refreshes.
  const fallbackStartsAt = useMemo(() => new Date().toISOString(), []);
  const scheduleOccurrences = useMemo(() => {
    if (selectedSchedule?.occurrences?.length) return selectedSchedule.occurrences;
    if (selectedSchedule?.startDate && selectedSchedule.endDate) {
      return generateScheduleOccurrences({
        services: data.services,
        serviceIds: selectedSchedule.serviceIds || [],
        startDate: selectedSchedule.startDate,
        endDate: selectedSchedule.endDate,
      });
    }
    return (selectedSchedule?.serviceIds || [])
      .map((serviceId) => {
        const service = data.services.find((item) => item.serviceId === serviceId);
        if (!service) return null;
        return {
          occurrenceId: service.serviceId,
          serviceId: service.serviceId,
          name: service.name,
          startsAt: service.dateTimeISO || fallbackStartsAt,
        };
      })
      .filter(Boolean) as TeamScheduleOccurrence[];
  }, [data.services, selectedSchedule, fallbackStartsAt]);
  const requirementsByOccurrence = useMemo(() => {
    const map = new Map<string, PositionRequirement[]>();
    scheduleOccurrences.forEach((occurrence) => {
      const service = data.services.find(
        (item) => item.serviceId === occurrence.serviceId,
      );
      map.set(
        occurrence.occurrenceId,
        resolveOccurrenceRequirements({ occurrence, service, teamPositionIds }),
      );
    });
    return map;
  }, [data.services, scheduleOccurrences, teamPositionIds]);
  const scheduleColumns = useMemo(
    () =>
      buildScheduleColumns({
        occurrences: scheduleOccurrences,
        requirementsByOccurrence,
        positions: data.positions,
        teamPositionIds,
      }),
    [data.positions, requirementsByOccurrence, scheduleOccurrences, teamPositionIds],
  );
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
  const [showForm, setShowForm] = useState(false);
  const [membersPanelOpen, setMembersPanelOpen] = useState(true);
  const [membersPanelQuery, setMembersPanelQuery] = useState("");
  const [memberPositionFilterIds, setMemberPositionFilterIds] = useState<string[]>([]);
  const membersPanelRef = useRef<HTMLDivElement>(null);
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
  const [scheduleLayout, setScheduleLayout] = useState(readTeamScheduleAdminLayout);
  const [scheduleWorkspaceTab, setScheduleWorkspaceTab] = useState<
    "schedule" | "attendance"
  >("schedule");

  const scheduleLayoutOptions = useMemo(
    () =>
      ADMIN_SCHEDULE_LAYOUTS.flatMap((value) => {
        const option = SCHEDULE_EXPORT_LAYOUTS.find((item) => item.value === value);
        return option ? [{ value, label: option.label }] : [];
      }),
    [],
  );

  useEffect(() => {
    writeTeamScheduleAdminLayout(scheduleLayout);
  }, [scheduleLayout]);
  const [activeSlot, setActiveSlot] = useState<ScheduleFocusedCell | null>(null);
  // "assign" is the grid flow (replace / shadow / clear). "replace" is the
  // attendance day-of flow, which only swaps in an eligible fill-in: no shadows,
  // no clear, and a direct one-tap replacement.
  const [slotPickerMode, setSlotPickerMode] = useState<"assign" | "replace">(
    "assign",
  );
  const [assignmentQuery, setAssignmentQuery] = useState("");
  const [pickerAnchorEl, setPickerAnchorEl] = useState<HTMLElement | null>(null);
  const pickerInputRef = useRef<HTMLInputElement>(null);
  const [pendingCellAssignment, setPendingCellAssignment] =
    useState<PendingCellAssignment | null>(null);
  const pendingCellAssignmentRef = useRef<PendingCellAssignment | null>(null);
  // Assignment saves are read-modify-write transactions on the same schedule
  // document. The UI updates optimistically, so a member can be removed from one
  // cell and immediately re-added (e.g. as a reverse shadow) before the first
  // save lands. Sent concurrently, the server validates the second request
  // against the pre-removal schedule and rejects it ("Members can only serve one
  // position per service"). Chaining the network calls keeps them in order so
  // each one validates against the previous result.
  const assignmentSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const scheduleMutationSeqRef = useRef(0);
  const enqueueAssignmentSave = useCallback(<T,>(task: () => Promise<T>) => {
    const run = assignmentSaveQueueRef.current.then(task, task);
    assignmentSaveQueueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);
  const [detailOccurrenceId, setDetailOccurrenceId] = useState<string | null>(null);
  const persistedDraft = scheduleDrafts[draftKey];

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
    setDetailOccurrenceId(null);
    setScheduleWorkspaceTab("schedule");
    setHighlightedMemberIds([]);
    setMemberPositionFilterIds([]);
    setActiveSlot(null);
    setAssignmentQuery("");
    setPickerAnchorEl(null);
  }, [selectedScheduleId]);

  const clearActiveSlot = useCallback(() => {
    setActiveSlot(null);
    setSlotPickerMode("assign");
    setAssignmentQuery("");
    setPickerAnchorEl(null);
    setPendingCellAssignment(null);
    setMemberPositionFilterIds([]);
  }, []);

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
      setMembersPanelOpen(true);
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

  useEffect(() => {
    if (!activeSlot) return undefined;
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
  }, [activeSlot, clearActiveSlot]);

  useEffect(() => {
    if (!activeSlot) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-schedule-assignment-menu]")) return;
      if (target.closest("[data-schedule-members-panel]")) return;
      if (target.closest("[data-schedule-cell-trigger]")) return;
      clearActiveSlot();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [activeSlot, clearActiveSlot]);

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
      members: data.members,
      duplicateFirstNames: duplicateScheduleFirstNames,
    });
  }, [
    data.members,
    detailOccurrence,
    duplicateScheduleFirstNames,
    requirementsByOccurrence,
    scheduleColumns,
    selectedSchedule?.assignments,
  ]);
  const detailMessage = useMemo(
    () =>
      detailOccurrence
        ? formatOccurrenceMessage({
          startsAt: detailOccurrence.startsAt,
          groups: detailSummaryGroups,
        })
        : "",
    [detailOccurrence, detailSummaryGroups],
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

  const openAttendanceForOccurrence = useCallback((occurrenceId: string) => {
    setDetailOccurrenceId(occurrenceId);
    setScheduleWorkspaceTab("attendance");
  }, []);

  const returnToScheduleGrid = useCallback(() => {
    clearActiveSlot();
    setScheduleWorkspaceTab("schedule");
  }, [clearActiveSlot]);

  const canShowScheduleWorkspace = Boolean(
    selectedSchedule &&
    scheduleColumns.length > 0 &&
    scheduleOccurrences.length > 0,
  );

  const handleScheduleWorkspaceTabChange = useCallback(
    (value: string) => {
      const tab = value as "schedule" | "attendance";
      setScheduleWorkspaceTab(tab);
      if (tab === "attendance" && !detailOccurrenceId && scheduleOccurrences[0]) {
        setDetailOccurrenceId(scheduleOccurrences[0].occurrenceId);
      }
    },
    [detailOccurrenceId, scheduleOccurrences],
  );

  const serviceDateBlockedOut = (member: TeamRosterMember, serviceDate: string) =>
    (member.blockoutDates || []).some((range) => {
      if (!serviceDate) return false;
      const start = range.startDate;
      const end = range.endDate || start;
      return start <= serviceDate && serviceDate <= end;
    });

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
      if (assignmentKind !== "shadow" && !(member.positionIds || []).includes(positionId)) {
        return "Not eligible for this position";
      }
      if (serviceDateBlockedOut(member, getOccurrenceDate(occurrence))) return "Blocked out";
      const row = selectedSchedule?.assignments?.[occurrenceId] || {};
      const assignedElsewhere = Object.entries(row).some(([assignedPositionSlotKey, cell]) => {
        const isSourceCell =
          source?.serviceId === occurrenceId && source?.positionId === assignedPositionSlotKey;
        if (isSourceCell && assignmentKind === "primary") return false;
        const assignedMemberIds = getCellMemberIds(cell);
        return assignedMemberIds.includes(memberId);
      });
      return assignedElsewhere ? "Already assigned in this service" : "";
    },
    [data.members, scheduleOccurrences, selectedSchedule?.assignments, selectedTeam],
  );

  const commitAssignment = async ({
    serviceId,
    cellKey,
    basePositionId,
    memberId,
    sourceServiceId,
    sourcePositionSlotKey,
  }: {
    serviceId: string;
    cellKey: string;
    basePositionId: string;
    memberId: string | null;
    sourceServiceId?: string;
    sourcePositionSlotKey?: string;
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
      if (issue) {
        showToast(issue, "neutral");
        return;
      }
    }
    const nextAssignments = { ...(selectedSchedule.assignments || {}) };
    const targetRow = { ...(nextAssignments[serviceId] || {}) };
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
    const mutationSeq = ++scheduleMutationSeqRef.current;
    onScheduleSaved({ ...selectedSchedule, assignments: nextAssignments });
    clearActiveSlot();

    const serviceDate = occurrence ? getOccurrenceDate(occurrence) : "";
    await enqueueAssignmentSave(async () => {
      try {
        await updateTeamScheduleAssignment(
          churchId,
          selectedSchedule.scheduleId,
          {
            serviceId,
            positionSlotKey: cellKey,
            memberId,
            serviceDate,
            sourceServiceId,
            sourcePositionSlotKey: sourcePositionSlotKey,
          },
        );
      } catch (error) {
        if (scheduleMutationSeqRef.current === mutationSeq) {
          onScheduleSaved(previousSchedule);
        }
        showApiErrorToast(showToast, error, "Could not update this assignment.");
      }
    });
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
  }: {
    serviceId: string;
    cellKey: string;
    basePositionId: string;
    memberId: string;
    shadowKind: TeamScheduleShadowKind;
    action: "add" | "remove";
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
      if (issue) {
        showToast(issue, "neutral");
        return;
      }
    }

    const nextAssignments = { ...(selectedSchedule.assignments || {}) };
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
    const mutationSeq = ++scheduleMutationSeqRef.current;
    onScheduleSaved({ ...selectedSchedule, assignments: nextAssignments });
    if (action === "add") {
      clearActiveSlot();
    }

    const serviceDate = occurrence ? getOccurrenceDate(occurrence) : "";
    await enqueueAssignmentSave(async () => {
      try {
        await updateTeamScheduleAssignment(
          churchId,
          selectedSchedule.scheduleId,
          {
            serviceId,
            positionSlotKey: cellKey,
            memberId,
            serviceDate,
            shadowAction: action,
            shadowKind,
          },
        );
      } catch (error) {
        if (scheduleMutationSeqRef.current === mutationSeq) {
          onScheduleSaved(previousSchedule);
        }
        showApiErrorToast(showToast, error, "Could not update this assignment.");
      }
    });
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
    const serviceDate = occurrence ? getOccurrenceDate(occurrence) : "";
    try {
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
      });
      await enqueueAssignmentSave(async () => {
        const response = await updateTeamScheduleAssignment(
          churchId,
          selectedSchedule.scheduleId,
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

  const occurrencesByService = useMemo(() => {
    const groups: {
      serviceId: string;
      serviceName: string;
      occurrences: TeamScheduleOccurrence[];
      sharedTiming: ReturnType<typeof getSharedOccurrenceTiming>;
    }[] = [];
    const groupIndex = new Map<string, number>();

    scheduleOccurrences.forEach((occurrence) => {
      const existingIndex = groupIndex.get(occurrence.serviceId);
      if (existingIndex !== undefined) {
        groups[existingIndex].occurrences.push(occurrence);
        return;
      }
      groupIndex.set(occurrence.serviceId, groups.length);
      groups.push({
        serviceId: occurrence.serviceId,
        serviceName: occurrence.name,
        occurrences: [occurrence],
        sharedTiming: { sharedWeekday: null, sharedTime: null },
      });
    });

    return groups.map((group) => ({
      ...group,
      sharedTiming: getSharedOccurrenceTiming(group.occurrences),
    }));
  }, [scheduleOccurrences]);

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
        ),
      );
    });
    return toScheduleColumnMinCh(pickLongestLabel(...labels));
  }, [occurrencesByService, scheduleOccurrences]);

  const scheduleColumnMinCh = useMemo(() => {
    const minChByColumn = new Map<string, number>();
    scheduleColumns.forEach((column) => {
      const labels = [column.label];
      scheduleOccurrences.forEach((occurrence) => {
        const assignmentCell =
          selectedSchedule?.assignments?.[occurrence.occurrenceId]?.[column.columnKey];
        labels.push(
          getAssignmentCellContentLabel({
            assignmentCell,
            positionName: column.label,
            members: data.members,
            duplicateFirstNames: duplicateScheduleFirstNames,
          }),
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
    data.members,
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
        timingLabel: [group.sharedTiming.sharedWeekday, group.sharedTiming.sharedTime]
          .filter(Boolean)
          .join(" · "),
        occurrences: group.occurrences.map((occurrence) => ({
          occurrenceId: occurrence.occurrenceId,
          rowLabel: formatOccurrenceRowLabel(occurrence, group.sharedTiming),
        })),
      })),
      requiredCountFor: (occurrenceId, positionId) =>
        getRequiredCount(requirementsByOccurrence.get(occurrenceId), positionId),
      assignments: selectedSchedule.assignments,
      members: data.members,
      duplicateFirstNames: duplicateScheduleFirstNames,
    });
  }, [
    churchName,
    data.members,
    duplicateScheduleFirstNames,
    occurrencesByService,
    requirementsByOccurrence,
    scheduleColumns,
    scheduleDateRangeLabel,
    selectedSchedule,
  ]);

  const copyPublicLink = useCallback(async () => {
    if (!canEdit) return;
    if (!selectedSchedule) return;
    setCopyingLink(true);
    try {
      const { publicToken } = await getTeamSchedulePublicLink(
        churchId,
        selectedSchedule.scheduleId,
      );
      const url = buildTeamSchedulePublicUrl(publicToken);
      await navigator.clipboard.writeText(url);
      showToast("View-only link copied to clipboard.", "success");
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not create a view-only link.");
    } finally {
      setCopyingLink(false);
    }
  }, [canEdit, churchId, selectedSchedule, showToast]);


  // Seed the "new schedule" draft from the selected schedule and open the form
  // in create mode. The operator typically just changes the date; assignments are
  // remapped onto the new dates on save (attendance is left behind by design).
  const handleCopySchedule = useCallback(() => {
    if (!canEdit || !selectedSchedule) return;
    onScheduleDraftFlush(
      "new",
      buildScheduleCopyDraft({
        source: selectedSchedule,
        occurrences: scheduleOccurrences,
      }),
    );
    setSelectedScheduleId("");
    setShowForm(true);
  }, [
    canEdit,
    onScheduleDraftFlush,
    scheduleOccurrences,
    selectedSchedule,
    setSelectedScheduleId,
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

  const attendanceRows = useMemo(
    () =>
      buildAttendanceRows({
        schedule: selectedSchedule,
        occurrences: scheduleOccurrences,
        columns: scheduleColumns,
        members: data.members,
        duplicateFirstNames: duplicateScheduleFirstNames,
        occurrenceTimingById,
        requiredCountFor: (occurrenceId, positionId) =>
          getRequiredCount(requirementsByOccurrence.get(occurrenceId), positionId),
      }),
    [
      data.members,
      duplicateScheduleFirstNames,
      occurrenceTimingById,
      requirementsByOccurrence,
      scheduleColumns,
      scheduleOccurrences,
      selectedSchedule,
    ],
  );

  const reschedulableRows = useMemo(
    () =>
      attendanceRows.filter(
        (row) =>
          row.isPrimary &&
          row.columnKey &&
          row.positionId,
      ),
    [attendanceRows],
  );

  const absentMemberIdsByOccurrence = useMemo(() => {
    const map = new Map<string, Set<string>>();
    attendanceRows.forEach((row) => {
      if (row.status !== "absent") return;
      const existing = map.get(row.occurrenceId) || new Set<string>();
      existing.add(row.memberId);
      map.set(row.occurrenceId, existing);
    });
    return map;
  }, [attendanceRows]);

  const commitAttendanceStatus = useCallback(
    async (
      row: ScheduleAttendanceRow,
      status: TeamScheduleAttendanceStatus | "",
    ) => {
      if (!canEdit) return;
      if (!selectedSchedule) return;
      const previousSchedule = selectedSchedule;
      const nextAttendance = { ...(selectedSchedule.attendance || {}) };
      const occurrenceAttendance = {
        ...(nextAttendance[row.occurrenceId] || {}),
      };
      if (status) {
        occurrenceAttendance[row.memberId] = {
          status,
          columnKey: row.columnKey,
          positionId: row.positionId,
          positionLabel: row.positionLabel,
          updatedAt: new Date().toISOString(),
        };
      } else {
        delete occurrenceAttendance[row.memberId];
      }
      if (Object.keys(occurrenceAttendance).length > 0) {
        nextAttendance[row.occurrenceId] = occurrenceAttendance;
      } else {
        delete nextAttendance[row.occurrenceId];
      }

      const nextSchedule = {
        ...selectedSchedule,
        attendance: nextAttendance,
      };
      const mutationSeq = ++scheduleMutationSeqRef.current;
      onScheduleSaved(nextSchedule);

      try {
        // Patch just this attendance cell instead of re-PUTting the whole
        // schedule, so a concurrent assignment edit by another admin isn't
        // clobbered.
        await updateTeamScheduleAttendance(
          churchId,
          selectedSchedule.scheduleId,
          {
            occurrenceId: row.occurrenceId,
            memberId: row.memberId,
            status,
            columnKey: row.columnKey,
            positionId: row.positionId,
            positionLabel: row.positionLabel,
          },
        );
      } catch (error) {
        if (scheduleMutationSeqRef.current === mutationSeq) {
          onScheduleSaved(previousSchedule);
        }
        showApiErrorToast(showToast, error, "Could not update attendance.");
      }
    },
    [churchId, canEdit, onScheduleSaved, selectedSchedule, showToast],
  );

  const rescheduleSuggestionRows = useMemo(
    () =>
      reschedulableRows.map((row) => ({
        row,
        suggestions: buildRescheduleSuggestions({
          row,
          members: activeTeamMembers,
          duplicateFirstNames: duplicateScheduleFirstNames,
          assignmentCounts: scheduleAssignmentCounts,
          excludedMemberIds: absentMemberIdsByOccurrence.get(row.occurrenceId),
          getIssue: getAssignmentIssue,
        }),
      })),
    [
      absentMemberIdsByOccurrence,
      reschedulableRows,
      activeTeamMembers,
      duplicateScheduleFirstNames,
      getAssignmentIssue,
      scheduleAssignmentCounts,
    ],
  );

  const detailAttendanceRows = useMemo(
    () =>
      detailOccurrence
        ? attendanceRows.filter(
          (row) => row.occurrenceId === detailOccurrence.occurrenceId,
        )
        : [],
    [attendanceRows, detailOccurrence],
  );

  const detailRescheduleSuggestionRows = useMemo(
    () =>
      detailOccurrence
        ? rescheduleSuggestionRows.filter(
          ({ row }) => row.occurrenceId === detailOccurrence.occurrenceId,
        )
        : [],
    [detailOccurrence, rescheduleSuggestionRows],
  );

  const detailAttendanceCounts = useMemo(
    () => countAttendanceStatuses(detailAttendanceRows),
    [detailAttendanceRows],
  );

  const activateAttendanceRowSlot = useCallback(
    (
      row: ScheduleAttendanceRow,
      anchorEl: HTMLElement,
    ) => {
      if (!row.columnKey || !row.positionId) {
        showToast("This attendance record is no longer assigned to a slot.", "neutral");
        return;
      }
      activateSlot(
        { occurrenceId: row.occurrenceId, columnKey: row.columnKey },
        anchorEl,
        "replace",
      );
    },
    [activateSlot, showToast],
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
    const primaryMember = data.members.find(
      (item) => item.memberId === primaryMemberId,
    );
    return {
      positionLabel: column.label,
      occurrenceLabel: sharedTiming
        ? formatOccurrenceRowLabel(occurrence, sharedTiming)
        : occurrence.name,
      currentAssigneeLabel: primaryMember
        ? scheduleMemberName(primaryMember, duplicateScheduleFirstNames)
        : "Empty",
      positionId: column.positionId,
      currentPrimaryMemberId: primaryMemberId,
      occurrenceName: occurrence.name,
    };
  }, [
    activeSlot,
    data.members,
    duplicateScheduleFirstNames,
    occurrenceTimingById,
    scheduleColumns,
    scheduleOccurrences,
    selectedSchedule?.assignments,
  ]);

  const handleActiveSlotMemberSelect = (memberId: string) => {
    if (!canEdit) return;
    if (!activeSlot || !activeSlotMeta) return;
    if (slotPickerMode === "replace") {
      // Day-of replacement: swap the fill-in straight into the slot without the
      // replace/shadow confirmation step.
      void commitAssignment({
        serviceId: activeSlot.occurrenceId,
        cellKey: activeSlot.columnKey,
        basePositionId: activeSlotMeta.positionId,
        memberId,
      });
      return;
    }
    requestCellMemberAction({
      serviceId: activeSlot.occurrenceId,
      cellKey: activeSlot.columnKey,
      basePositionId: activeSlotMeta.positionId,
      memberId,
      currentPrimaryMemberId: activeSlotMeta.currentPrimaryMemberId,
    });
  };

  const activeSlotGetIssue = useCallback(
    (memberId: string) => {
      if (!activeSlot || !activeSlotMeta) return "Not available";
      if (absentMemberIdsByOccurrence.get(activeSlot.occurrenceId)?.has(memberId)) {
        return "Marked no-show for this service";
      }
      return getAssignmentIssue(
        memberId,
        activeSlot.occurrenceId,
        activeSlotMeta.positionId,
      );
    },
    [absentMemberIdsByOccurrence, activeSlot, activeSlotMeta, getAssignmentIssue],
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
      if (absentMemberIdsByOccurrence.get(activeSlot.occurrenceId)?.has(memberId)) {
        const issue = "Marked no-show for this service";
        return {
          replace: issue,
          shadow: issue,
          reverseShadow: issue,
        };
      }
      return getAssignmentActionIssues(
        memberId,
        activeSlot.occurrenceId,
        activeSlotMeta.positionId,
      );
    },
    [
      absentMemberIdsByOccurrence,
      activeSlot,
      activeSlotMeta,
      getAssignmentActionIssues,
    ],
  );

  const handleActiveSlotAssignmentAction = (
    memberId: string,
    action: "replace" | TeamScheduleShadowKind,
  ) => {
    if (!canEdit) return;
    if (!activeSlot || !activeSlotMeta) return;
    handleAssignmentAction({
      serviceId: activeSlot.occurrenceId,
      cellKey: activeSlot.columnKey,
      basePositionId: activeSlotMeta.positionId,
      memberId,
      action,
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
      issues: getAssignmentActionIssues(
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
      ),
      onBack: () => setPendingCellAssignment(null),
      onReplace: confirmPendingReplace,
      onAddShadow: () => confirmPendingShadow("shadow"),
      onAddReverseShadow: () => confirmPendingShadow("reverse_shadow"),
    };
  })();

  // Flattened occurrences (in service order) for the by-position orientation,
  // where dates become columns.
  const flatOccurrences = useMemo(
    () =>
      occurrencesByService.flatMap((group) =>
        group.occurrences.map((occurrence) => ({ occurrence, group })),
      ),
    [occurrencesByService],
  );

  const cellAxisHighlightMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!activeSlot) return map;

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
  ]);

  const assignmentHandlers: ScheduleAssignmentHandlers = {
    getAssignmentIssue,
    getAssignmentActionIssues,
    handleAssignmentAction,
    requestCellMemberAction,
    commitAssignment,
    commitShadowAssignment,
    createMemberForCell,
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

      return {
        occurrenceId: occurrence.occurrenceId,
        occurrenceName: occurrence.name,
        columnKey: column.columnKey,
        positionId: column.positionId,
        columnLabel: column.label,
        rowTone,
        slot: column.slot,
        requiredCount: getRequiredCount(
          requirementsByOccurrence.get(occurrence.occurrenceId),
          column.positionId,
        ),
        axisHighlightClassName: cellAxisHighlightMap.get(cellKey) ?? "",
        assignmentCell,
        isMemberHighlighted: getCellMemberIds(assignmentCell).some((memberId) =>
          highlightedMemberIdSet.has(memberId),
        ),
        isActiveSlot,
        allMembers: data.members,
        duplicateFirstNames: duplicateScheduleFirstNames,
        canEdit,
      };
    },
    [
      activeSlot,
      canEdit,
      cellAxisHighlightMap,
      data.members,
      duplicateScheduleFirstNames,
      highlightedMemberIdSet,
      requirementsByOccurrence,
      selectedSchedule,
    ],
  );

  const attendanceWorkspacePanel =
    selectedSchedule &&
      selectedTeam &&
      scheduleColumns.length > 0 &&
      scheduleOccurrences.length > 0 ? (
      <div className="rounded-lg border border-gray-800 bg-gray-950/45 p-4">
        {!detailOccurrence ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start gap-3">
              <Icon svg={ClipboardList} size="md" className="text-cyan-200" />
              <div>
                <h3 className="text-base font-semibold text-white">
                  Select a service
                </h3>
                <p className="mt-1 text-sm text-gray-400">
                  Choose one service to take attendance, copy assignments, or select replacements.
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {scheduleOccurrences.map((occurrence) => (
                <ScheduleOccurrenceDateButton
                  key={occurrence.occurrenceId}
                  label={`${occurrence.name} - ${formatOccurrenceRowLabel(
                    occurrence,
                    occurrenceTimingById.get(occurrence.occurrenceId) || {
                      sharedWeekday: null,
                      sharedTime: null,
                    },
                  )}`}
                  ariaLabel={`Open attendance for ${occurrence.name} on ${formatOccurrenceRowLabel(
                    occurrence,
                    occurrenceTimingById.get(occurrence.occurrenceId) || {
                      sharedWeekday: null,
                      sharedTime: null,
                    },
                  )}`}
                  onClick={() => openAttendanceForOccurrence(occurrence.occurrenceId)}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-white">
                  <ClipboardList className="h-4 w-4 text-cyan-200" aria-hidden />
                  {detailOccurrence.name}
                </h3>
                <p className="mt-1 text-sm text-gray-400">
                  {formatOccurrenceTiming(detailOccurrence)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="tertiary"
                  svg={ChevronLeft}
                  iconSize="sm"
                  onClick={returnToScheduleGrid}
                >
                  Back
                </Button>
                <Button
                  variant="tertiary"
                  svg={Clipboard}
                  iconSize="sm"
                  onClick={() => void copyDetailOccurrenceAssignments()}
                >
                  Copy
                </Button>
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              {scheduleOccurrences.map((occurrence) => {
                const selected = occurrence.occurrenceId === detailOccurrence.occurrenceId;
                return (
                  <ScheduleOccurrenceDateButton
                    key={occurrence.occurrenceId}
                    label={formatOccurrenceRowLabel(
                      occurrence,
                      occurrenceTimingById.get(occurrence.occurrenceId) || {
                        sharedWeekday: null,
                        sharedTime: null,
                      },
                    )}
                    ariaLabel={`Open attendance for ${occurrence.name} on ${formatOccurrenceRowLabel(
                      occurrence,
                      occurrenceTimingById.get(occurrence.occurrenceId) || {
                        sharedWeekday: null,
                        sharedTime: null,
                      },
                    )}`}
                    className={cn(
                      "w-auto shrink-0",
                      selected && "border-cyan-300 bg-cyan-500/20 text-white",
                    )}
                    onClick={() => openAttendanceForOccurrence(occurrence.occurrenceId)}
                  />
                );
              })}
            </div>

            {detailSummaryGroups.length === 0 ? (
              <p className="rounded-md border border-gray-800 bg-gray-950 p-3 text-sm text-gray-300">
                This service has no required positions for this date.
              </p>
            ) : (
              <div className="rounded-md border border-gray-800 bg-gray-950/60 p-3">
                <div className="grid grid-cols-[max-content_1fr] items-baseline gap-x-4 gap-y-1.5">
                  {detailSummaryGroups.flatMap((group) => group.positions).map((position) => {
                    const PositionIcon = resolvePositionLucideIcon(
                      positionIconById.get(position.positionId),
                    );
                    const empty = position.members.length === 0;
                    return (
                      <Fragment key={position.positionId}>
                        <span className="inline-flex items-center gap-1.5 font-medium text-white">
                          {PositionIcon ? (
                            <PositionIcon
                              className="h-4 w-4 shrink-0 text-cyan-200"
                              aria-hidden
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

            <div className="rounded-md border border-gray-800 bg-gray-950/60 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-white">
                    Attendance and changes
                  </h4>
                  <p className="mt-1 text-sm text-gray-400">
                    Everyone is counted present by default. Mark no-show on the day
                    of service, then choose a fill-in from the members list.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-gray-300">
                  <span className="rounded border border-emerald-300/30 bg-emerald-500/10 px-2 py-1">
                    {detailAttendanceCounts.present + detailAttendanceCounts.unmarked} present
                  </span>
                  <span className="rounded border border-rose-300/30 bg-rose-500/10 px-2 py-1">
                    {detailAttendanceCounts.absent} no-show
                  </span>
                </div>
              </div>

              {detailAttendanceRows.length === 0 ? (
                <p className="mt-3 rounded-md border border-gray-800 bg-gray-950 p-3 text-sm text-gray-300">
                  Assign members to this service before taking attendance.
                </p>
              ) : (
                <div className="mt-3 overflow-auto rounded-md border border-gray-800">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 bg-gray-950 text-xs uppercase text-gray-400">
                        <th className="px-3 py-2 font-medium">Person</th>
                        <th className="px-3 py-2 font-medium">Position</th>
                        <th className="px-3 py-2 font-medium">Attendance</th>
                        <th className="px-3 py-2 font-medium">Replacement or fill-in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailAttendanceRows.map((row) => {
                        const replacement = detailRescheduleSuggestionRows.find(
                          (item) =>
                            item.row.occurrenceId === row.occurrenceId &&
                            item.row.memberId === row.memberId &&
                            item.row.columnKey === row.columnKey,
                        );
                        const suggestionLabels =
                          replacement?.suggestions.map((suggestion) => suggestion.memberLabel) ||
                          [];
                        const canOpenReplacement =
                          canEdit &&
                          row.isPrimary &&
                          Boolean(row.columnKey) &&
                          Boolean(row.positionId);
                        return (
                          <tr
                            key={`${row.occurrenceId}-${row.memberId}-${row.columnKey || "record"}`}
                            className="border-b border-gray-900 last:border-0"
                          >
                            <td className="px-3 py-2 text-white">{row.memberLabel}</td>
                            <td className="px-3 py-2 text-gray-300">{row.positionLabel}</td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap items-center gap-2">
                                {row.status === "absent" ? (
                                  <>
                                    <span className="inline-flex items-center gap-1 rounded border border-rose-300/40 bg-rose-500/15 px-2 py-1 text-xs font-medium text-rose-50">
                                      <UserX className="h-3.5 w-3.5" aria-hidden />
                                      No-show
                                    </span>
                                    <Button
                                      variant="tertiary"
                                      svg={Check}
                                      iconSize="xs"
                                      disabled={!canEdit}
                                      onClick={() => void commitAttendanceStatus(row, "present")}
                                    >
                                      Mark present
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <span className="inline-flex items-center gap-1 rounded border border-emerald-300/40 bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-50">
                                      <Check className="h-3.5 w-3.5" aria-hidden />
                                      Present
                                    </span>
                                    <Button
                                      variant="tertiary"
                                      svg={UserX}
                                      iconSize="xs"
                                      disabled={!canEdit}
                                      onClick={() => void commitAttendanceStatus(row, "absent")}
                                    >
                                      Mark no-show
                                    </Button>
                                  </>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              {canOpenReplacement ? (
                                <div className="space-y-1.5">
                                  <Button
                                    variant="tertiary"
                                    svg={RefreshCw}
                                    iconSize="xs"
                                    onClick={(event) =>
                                      activateAttendanceRowSlot(row, event.currentTarget)
                                    }
                                  >
                                    {row.status === "absent"
                                      ? "Choose fill-in"
                                      : "Choose replacement"}
                                  </Button>
                                  <p className="text-xs text-gray-400">
                                    {suggestionLabels.length > 0
                                      ? `Suggested: ${suggestionLabels.join(", ")}`
                                      : "No available match yet."}
                                  </p>
                                </div>
                              ) : row.status === "absent" ? (
                                <span className="text-sm text-gray-400">
                                  No-show recorded.
                                </span>
                              ) : row.status === "present" ? (
                                <span className="text-sm text-gray-400">
                                  Present recorded.
                                </span>
                              ) : row.isPrimary ? (
                                <span className="text-sm text-gray-400">
                                  Select the grid cell to assign this slot.
                                </span>
                              ) : (
                                <span className="text-sm text-gray-500">
                                  Replacement applies to primary slots.
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    ) : null;

  return (
    <div className="space-y-4">
      <section className={panelShellClassName}>
        <div className={cn(panelHeaderPaddingClassName, showForm ? "pb-0" : "pb-4")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Schedules</h2>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            Assign people to services by position.
          </p>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <Select
                className="min-w-56"
                label="Open schedule"
                value={selectedSchedule?.scheduleId || ""}
                onChange={(scheduleId) => {
                  setSelectedScheduleId(scheduleId);
                  setShowForm(false);
                }}
                options={schedules.map((schedule) => ({
                  label: `${schedule.name}${schedule.archivedAt ? " (archived)" : ""}`,
                  value: schedule.scheduleId,
                }))}
              />
              {canEdit ? (
                <Button
                  variant="secondary"
                  svg={Plus}
                  iconSize="sm"
                  onClick={() => {
                    setSelectedScheduleId("");
                    setShowForm(true);
                  }}
                >
                  New schedule
                </Button>
              ) : null}
              {canEdit && selectedSchedule && !showForm ? (
                <Button variant="tertiary" iconSize="sm" onClick={() => setShowForm(true)}>
                  Edit schedule
                </Button>
              ) : null}
              {canEdit && selectedSchedule && !showForm ? (
                <Button
                  variant="tertiary"
                  svg={Copy}
                  iconSize="sm"
                  onClick={handleCopySchedule}
                >
                  Copy schedule
                </Button>
              ) : null}
            </div>
            <Button variant="tertiary" svg={RefreshCw} iconSize="sm" onClick={onRefresh}>
              Refresh
            </Button>
          </div>
        </div>

        {showForm ? (
          <div className="border-t border-gray-700/50 px-4 pb-4">
            <ScheduleEditForm
              draftKey={draftKey}
              persistedDraft={persistedDraft}
              selectedSchedule={selectedSchedule}
              defaultTeamId={defaultTeamId}
              defaultServiceIds={defaultServiceIds}
              defaultRange={defaultRange}
              services={data.services}
              activeTeams={activeTeams}
              churchId={churchId}
              canEdit={canEdit}
              onDraftChange={onScheduleDraftChanged}
              onDraftFlush={onScheduleDraftFlush}
              onScheduleSaved={onScheduleSaved}
              onScheduleRemoved={onScheduleRemoved}
              setSelectedScheduleId={setSelectedScheduleId}
              onCancel={() => setShowForm(false)}
            />
          </div>
        ) : null}
      </section>

      {canShowScheduleWorkspace ? (
        <Tabs
          value={scheduleWorkspaceTab}
          onValueChange={handleScheduleWorkspaceTabChange}
          className="w-full gap-0"
        >
          <TabsList
            variant="line"
            className={lineTabsListShellClassName}
            aria-label="Schedule workspace"
          >
            <TabsTrigger value="schedule" className={lineTabsTriggerClassName}>
              Schedule
            </TabsTrigger>
            <TabsTrigger value="attendance" className={lineTabsTriggerClassName}>
              Attendance
            </TabsTrigger>
          </TabsList>

          <section className={cn(panelClassName, "mt-4")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Icon svg={CalendarDays} size="md" className="text-cyan-200" />
                  Team schedule
                </h2>
                <p className="mt-1 text-sm text-gray-400">
                  Schedule members first, then switch to attendance when you are tracking one service.
                </p>
              </div>
              {scheduleWorkspaceTab === "schedule" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <SegmentedControl
                    ariaLabel="Schedule layout"
                    variant="admin"
                    value={scheduleLayout}
                    onChange={setScheduleLayout}
                    options={scheduleLayoutOptions}
                  />
                  <SchedulePdfExportButton
                    model={scheduleExportModel}
                    layout={scheduleLayout}
                  />
                  {canEdit ? (
                    <Button
                      variant="tertiary"
                      svg={Link2}
                      iconSize="sm"
                      disabled={copyingLink}
                      onClick={() => void copyPublicLink()}
                    >
                      {copyingLink ? "Copying..." : "Copy view-only link"}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <ScheduleAssignmentProvider handlers={assignmentHandlers}>
              <div className="mt-4 flex min-w-0 flex-col gap-4 lg:flex-row lg:items-stretch">
                <div className="min-w-0 flex-1">
                  <TabsContent value="schedule" className="outline-none">
                    {scheduleLayout === "transpose" ? (
                      <div className={cn("overflow-auto rounded-lg border border-gray-800")}>
                        <table className="w-max max-w-full border-collapse text-left text-sm table-auto">
                          <thead>
                            <tr>
                              <th
                                rowSpan={2}
                                className={cn(
                                  "sticky left-0 top-0 z-20 border-b bg-gray-950 text-gray-200",
                                  scheduleGridBottomBorderClassName,
                                  schedulePositionColumnClassName,
                                  scheduleCellPaddingClassName,
                                )}
                              >
                                Position
                              </th>
                              {occurrencesByService.map((group) => (
                                <th
                                  key={group.serviceId}
                                  colSpan={group.occurrences.length}
                                  className={cn(
                                    "border-b bg-gray-950 text-center font-semibold text-white",
                                    scheduleServiceHeaderBottomBorderClassName,
                                    scheduleServiceHeaderLeftBorderClassName,
                                    scheduleCellPaddingClassName,
                                    serviceHeaderRowTone,
                                  )}
                                >
                                  <span className="inline-flex items-center gap-x-2">
                                    <span>{group.serviceName}</span>
                                    {group.sharedTiming.sharedWeekday ? (
                                      <span className="font-normal text-gray-300">
                                        {group.sharedTiming.sharedWeekday}
                                      </span>
                                    ) : null}
                                    {group.sharedTiming.sharedTime ? (
                                      <span className="font-normal text-gray-300">
                                        {group.sharedTiming.sharedTime}
                                      </span>
                                    ) : null}
                                  </span>
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
                                    getAxisHighlightClassName(occurrence.occurrenceId, undefined, {
                                      surface: "header",
                                    }),
                                  )}
                                >
                                  <ScheduleOccurrenceDateButton
                                    label={formatOccurrenceRowLabel(occurrence, group.sharedTiming)}
                                    ariaLabel={`View and copy assignments for ${group.serviceName} on ${formatOccurrenceRowLabel(occurrence, group.sharedTiming)}`}
                                    className={cn(
                                      detailOccurrenceId === occurrence.occurrenceId &&
                                      "border-cyan-300 bg-cyan-500/20 text-white",
                                    )}
                                    onClick={() => openAttendanceForOccurrence(occurrence.occurrenceId)}
                                  />
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {scheduleColumns.map((column, columnIndex) => {
                              const PositionIcon = resolvePositionLucideIcon(column.position.icon);
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
                                      scheduleCellPaddingClassName,
                                      stickyTone,
                                      getAxisHighlightClassName(undefined, column.columnKey, {
                                        rowIndex: columnIndex,
                                        surface: "sticky",
                                      }),
                                    )}
                                  >
                                    <span className="inline-flex items-center gap-2">
                                      {PositionIcon ? (
                                        <PositionIcon className="h-4 w-4 shrink-0 text-cyan-200" />
                                      ) : null}
                                      <span className="font-medium text-white">{column.label}</span>
                                      {column.position.archivedAt ? (
                                        <span className="text-xs text-gray-500">(archived)</span>
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
                    ) : (
                      <div className={cn("overflow-auto rounded-lg border border-gray-800")}>
                        <table className="w-max max-w-full border-collapse text-left text-sm table-auto">
                          <colgroup>
                            <col style={{ minWidth: `${scheduleDateColumnMinCh}ch` }} />
                            {scheduleColumns.map((column) => (
                              <col
                                key={column.columnKey}
                                style={{
                                  width: `${scheduleColumnMinCh.get(column.columnKey)}ch`,
                                  minWidth: `${scheduleColumnMinCh.get(column.columnKey)}ch`,
                                }}
                              />
                            ))}
                          </colgroup>
                          <thead>
                            <tr>
                              <th className={cn("sticky left-0 top-0 z-20 border-b bg-gray-950 text-gray-200", scheduleGridBottomBorderClassName, scheduleDateColumnClassName, scheduleCellPaddingClassName)}>
                                Date &amp; time
                              </th>
                              {scheduleColumns.map((column) => {
                                const PositionIcon = resolvePositionLucideIcon(column.position.icon);
                                return (
                                  <th key={column.columnKey} className={cn("sticky top-0 z-10 border-b bg-gray-950 text-gray-200", scheduleGridBottomBorderClassName, scheduleGridLeftBorderClassName, schedulePositionColumnClassName, scheduleCellPaddingClassName, getAxisHighlightClassName(undefined, column.columnKey, { surface: "header" }))}>
                                    <span className="inline-flex items-center gap-2">
                                      {PositionIcon ? <PositionIcon className="h-4 w-4 shrink-0 text-cyan-200" /> : null}
                                      <span>{column.label}</span>
                                      {column.position.archivedAt ? <span className="text-xs text-gray-500">(archived)</span> : null}
                                    </span>
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {occurrencesByService.map((group, groupIndex) => {
                              const service = data.services.find((item) => item.serviceId === group.serviceId);
                              return (
                                <Fragment key={group.serviceId}>
                                  <tr className={cn("border-t", scheduleServiceHeaderTopBorderClassName, serviceHeaderRowTone)}>
                                    <th colSpan={scheduleColumns.length + 1} className={cn("p-0 text-left align-top", serviceHeaderRowTone)}>
                                      <div
                                        className={cn(
                                          "sticky left-0 z-10 inline-flex w-max max-w-full flex-nowrap items-center gap-x-2 p-2 font-semibold text-white",
                                        )}
                                      >
                                        <span className="shrink-0">{group.serviceName}</span>
                                        {group.sharedTiming.sharedWeekday ? (
                                          <span className="shrink-0 font-normal text-gray-300">
                                            {group.sharedTiming.sharedWeekday}
                                          </span>
                                        ) : null}
                                        {group.sharedTiming.sharedTime ? (
                                          <span className="shrink-0 font-normal text-gray-300">
                                            {group.sharedTiming.sharedTime}
                                          </span>
                                        ) : null}
                                        {service?.archivedAt ? (
                                          <span className="shrink-0 text-xs font-normal text-gray-500">Archived</span>
                                        ) : null}
                                      </div>
                                    </th>
                                  </tr>
                                  {group.occurrences.map((occurrence, occurrenceIndex) => {
                                    const rowIndex = occurrenceRowOffsets[groupIndex] + occurrenceIndex;
                                    const rowTone = scheduleRowTone(rowIndex);
                                    const stickyTone = scheduleStickyRowTone(rowIndex);
                                    return (
                                      <tr key={occurrence.occurrenceId} className={cn("border-t", scheduleGridTopBorderClassName, rowTone)}>
                                        <th className={cn("sticky left-0 z-10 align-middle", scheduleGridRightBorderClassName, scheduleDateColumnClassName, scheduleCellPaddingClassName, stickyTone, getAxisHighlightClassName(occurrence.occurrenceId, undefined, { rowIndex, surface: "sticky" }))}>
                                          <ScheduleOccurrenceDateButton
                                            label={formatOccurrenceRowLabel(occurrence, group.sharedTiming)}
                                            ariaLabel={`View and copy assignments for ${group.serviceName} on ${formatOccurrenceRowLabel(occurrence, group.sharedTiming)}`}
                                            className={cn(
                                              detailOccurrenceId === occurrence.occurrenceId &&
                                              "border-cyan-300 bg-cyan-500/20 text-white",
                                            )}
                                            onClick={() => openAttendanceForOccurrence(occurrence.occurrenceId)}
                                          />
                                        </th>
                                        {scheduleColumns.map((column) => (
                                          <ScheduleGridCell
                                            key={scheduleGridCellKey(occurrence.occurrenceId, column.columnKey)}
                                            {...buildGridCellProps(occurrence, column, rowTone)}
                                          />
                                        ))}
                                      </tr>
                                    );
                                  })}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </TabsContent>
                  <TabsContent value="attendance" className="outline-none">
                    {attendanceWorkspacePanel}
                  </TabsContent>
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
                  duplicateFirstNames={duplicateScheduleFirstNames}
                  getIssue={activeSlotGetIssue}
                  getAssignmentActionIssues={
                    slotPickerMode === "replace"
                      ? undefined
                      : activeSlotGetAssignmentActionIssues
                  }
                  onSelectMember={handleActiveSlotMemberSelect}
                  onAssignmentAction={handleActiveSlotAssignmentAction}
                  onCreateMember={
                    slotPickerMode === "replace"
                      ? undefined
                      : handleActiveSlotCreateMember
                  }
                  onClearAssignment={
                    slotPickerMode === "replace"
                      ? undefined
                      : handleActiveSlotClearAssignment
                  }
                  pendingSubmenu={pendingPickerSubmenu}
                  inputRef={pickerInputRef}
                />
                <ScheduleMembersPanel
                  panelRef={membersPanelRef}
                  open={membersPanelOpen}
                  onOpenChange={setMembersPanelOpen}
                  mode={canEdit && activeSlot ? "assign" : "browse"}
                  activeTeamMembers={activeTeamMembers}
                  schedulePositions={schedulePositions}
                  scheduleAssignmentCounts={scheduleAssignmentCounts}
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
                  onSelectMember={canEdit ? handleActiveSlotMemberSelect : () => undefined}
                  getIssue={activeSlotGetIssue}
                  getAssignmentActionIssues={activeSlotGetAssignmentActionIssues}
                />
              </div>
            </ScheduleAssignmentProvider>
          </section>
        </Tabs>
      ) : (
        <section className={panelClassName}>
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Icon svg={CalendarDays} size="md" className="text-cyan-200" />
              Team schedule
            </h2>
            <p className="mt-1 text-sm text-gray-400">
              Schedule members first, then switch to attendance when you are tracking one service.
            </p>
          </div>
          <div className="mt-4">
            {!selectedSchedule || !selectedTeam ? (
              <p className="rounded-md border border-gray-700 bg-gray-950/50 p-4 text-sm text-gray-300">
                Create a team, services, and a schedule to start assigning members.
              </p>
            ) : (
              <p className="rounded-md border border-gray-700 bg-gray-950/50 p-4 text-sm text-gray-300">
                This schedule needs at least one service occurrence and one required
                position. Set position requirements on a service, or add positions to the team.
              </p>
            )}
          </div>
        </section>
      )}

    </div>
  );
};

export default ScheduleTab;
