import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, ListChecks } from "lucide-react";
import { onValue, ref } from "firebase/database";
import Button from "../../components/Button/Button";
import HomeToolbarMenu from "../../components/HomeToolbarMenu/HomeToolbarMenu";
import { SectionTabs } from "../../components/SectionTabs/SectionTabs";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  lineTabsListShellClassName,
  lineTabsTriggerSmClassName,
} from "../../components/ui/tabs";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import CreditsPreview from "../../containers/Credits/Credits";
import UserSection from "../../containers/Toolbar/ToolbarElements/UserSection";
import TransmitHandler from "../../containers/TransmitHandler/TransmitHandler";
import { useDispatch, useSelector, useSyncMonitorSettings } from "../../hooks";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { CreditsInfo, ServiceTime } from "../../types";
import {
  getServicePlanMicrophones,
  getTeamsBootstrap,
  updateTeamScheduleAssignmentMicrophones,
} from "../../api/auth";
import type {
  TeamPosition,
  TeamRecord,
  TeamRosterMember,
  TeamSchedule,
  TeamScheduleOccurrence,
  TeamScheduleSummary,
} from "../../api/authTypes";
import type { ServicePlanMicrophone } from "../../types/servicePlan";
import { showApiErrorToast } from "../../utils/apiErrorToast";
import { useToast } from "../../context/toastContext";
import {
  AUTOSAVE_DEBOUNCE_KEYS,
  autosaveIndicatorSlice,
} from "../../store/autosaveIndicatorSlice";
import ServicePlanEditor from "../Services/ServicePlanEditor";
import CurrentServiceItemList from "./CurrentServiceItemList";
import {
  getOccurrenceAssignmentSummary,
  getScheduledMicrophoneHolders,
  groupAssignmentSummaryByTeam,
  teamMicrophoneSlotKey,
  type TeamsAssignmentSummaryRow,
} from "../Teams/pages/teamsAssignmentsSummary";
import WhosServingPanel from "../Teams/pages/WhosServingPanel";
import {
  buildPlanToScheduleNavigationState,
  persistTeamsReturnTo,
  TEAMS_SECTION_PATHS,
  type TeamsReturnTo,
} from "../Teams/teamsReturnNavigation";
import { toTeamService } from "../Teams/teamsUtils";
import { initiateLiveCredits } from "../../store/creditsSlice";
import { selectOutputSlot } from "../../store/presentationSlice";
import { formatTime } from "../../components/DisplayWindow/TimerDisplay";
import { getChurchDataPath } from "../../utils/firebasePaths";
import {
  subscribeCountdownTicker,
} from "../../hooks/useNextServiceCountdownText";
import {
  formatCurrentServiceOvertime,
  resolveCurrentServiceTimingState,
} from "./currentServiceTiming";
import {
  formatOccurrenceLabel,
  getOccurrenceServices,
  resolveLiveSlideProgress,
  type LiveSlideProgress,
} from "./currentServiceWorkspaceUtils";
import {
  resolveCurrentServiceWorkspaceSections,
  resolveCurrentServiceWorkspaceTab,
  type CurrentServiceWorkspacePreviewSection,
  type CurrentServiceWorkspacePreviewTab,
} from "../../utils/currentServiceWorkspace";
import { useCurrentServiceOccurrence } from "./useCurrentServiceOccurrence";
import { hydrateOccurrenceSchedules } from "../../utils/hydrateOccurrenceSchedules";
import { onlyHydratedSchedules } from "../../api/authTypes";
import CurrentServiceRestreamPanel from "./CurrentServiceRestreamPanel";
import {
  useTeamsLiveSync,
  type TeamsStreamEvent,
} from "../Teams/hooks/useTeamsLiveSync";
import { useSyncOnReconnect } from "../../hooks/useSyncOnReconnect";
import {
  getServerTimeOffset,
  serverDate,
  subscribeServerTimeOffset,
} from "../../utils/serverTime";
import {
  getServicePlanKey,
} from "../../utils/servicePlanKeys";
import type { ServicePlanTimingSource } from "../Services/servicePlanTimingUtils";

type WorkspaceTab = "plan" | CurrentServiceWorkspacePreviewTab;
/**
 * Whether this date's schedule cells are actually on the client. The bootstrap
 * hydrates a window around today, and the operator can page beyond it.
 */
type AssignmentsStatus = "ready" | "loading" | "unavailable";
type PreviewTab = CurrentServiceWorkspacePreviewTab;

export const mergeCurrentServiceSchedules = (
  schedules: (TeamSchedule | TeamScheduleSummary)[],
  overrides: ReadonlyMap<string, TeamSchedule | null>,
): (TeamSchedule | TeamScheduleSummary)[] => {
  const merged = schedules.flatMap((schedule) => {
    if (!overrides.has(schedule.scheduleId)) return [schedule];
    const override = overrides.get(schedule.scheduleId);
    return override ? [override] : [];
  });
  const knownIds = new Set(merged.map((schedule) => schedule.scheduleId));
  overrides.forEach((override, scheduleId) => {
    if (override && !knownIds.has(scheduleId)) merged.push(override);
  });
  return merged;
};

const ChatUnreadBadge = ({ count }: { count: number }) => {
  if (count <= 0) return null;
  return (
    <span
      className="min-w-5 rounded-full bg-cyan-400 px-1.5 py-0.5 text-center text-[10px] font-bold leading-none tabular-nums text-gray-950"
      aria-label={`${count} unread chat ${count === 1 ? "message" : "messages"}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
};

type ServiceHeadingProps = {
  service?: ServiceTime | null;
  occurrence?: TeamScheduleOccurrence | null;
  occurrenceServices?: ServiceTime[];
  timingPlan?: ServicePlanTimingSource | null;
};

const useCurrentServiceClockMs = (): number => {
  // An offset change rerenders immediately; the shared ticker keeps the leaf
  // moving once per second. Both paths derive the value from serverDate rather
  // than incrementing a local countdown.
  useSyncExternalStore(
    subscribeServerTimeOffset,
    getServerTimeOffset,
    getServerTimeOffset,
  );
  const [, setTick] = useState(0);

  useEffect(
    () => subscribeCountdownTicker(() => setTick((value) => value + 1)),
    [],
  );

  return serverDate().getTime();
};

const getTimingLabel = (
  timingState: ReturnType<typeof resolveCurrentServiceTimingState>,
): string => {
  if (timingState.type === "overtime") return "Over by";
  if (timingState.type === "service-ending") return "Ends in";
  return "Starts in";
};

const ServiceHeading = ({
  service,
  occurrence,
  occurrenceServices = [],
  timingPlan,
}: ServiceHeadingProps) => {
  const nowMs = useCurrentServiceClockMs();
  if (!service || !occurrence) return null;

  const timingState = resolveCurrentServiceTimingState({
    occurrence,
    occurrenceServices,
    plan: timingPlan,
    nowMs,
  });
  const displayService =
    timingState.type === "upcoming-service" ? timingState.service : service;
  const name =
    (occurrence.groupId && timingState.type !== "upcoming-service"
      ? occurrence.name
      : displayService.name) || "Service";

  if (timingState.type === "live") {
    return (
      <p className="min-w-0 flex-1 truncate text-lg font-semibold">
        {`${name} · Live`}
      </p>
    );
  }

  const isOvertime = timingState.type === "overtime";
  const totalSeconds = Math.max(
    0,
    Math.floor(
      (isOvertime ? nowMs - timingState.targetMs : timingState.targetMs - nowMs) /
        1000,
    ),
  );
  const timeText = isOvertime
    ? formatCurrentServiceOvertime(timingState.targetMs, nowMs)
    : formatTime(totalSeconds, false);
  const label = getTimingLabel(timingState);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <p className="min-w-0 truncate text-base font-semibold">{label}</p>
      <div
        className="shrink-0 rounded-md border border-white/20 bg-gray-950 px-2.5 py-1 text-lg font-semibold tabular-nums tracking-tight"
        style={{ color: isOvertime ? "#fbbf24" : displayService.color || "#ffffff" }}
        aria-label={`${label} ${timeText}`}
      >
        {timeText}
      </div>
    </div>
  );
};

const WorkspacePage = ({
  children,
  service,
  occurrence,
  occurrenceServices,
  timingPlan,
}: ServiceHeadingProps & {
  children: ReactNode;
}) => (
  <main className="flex h-dvh flex-col overflow-hidden bg-homepage-canvas p-3 text-white lg:p-4">
    <header className="mb-3 flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-gray-700 bg-gray-900/60 px-3 py-2">
      <HomeToolbarMenu />
      <ServiceHeading
        service={service}
        occurrence={occurrence}
        occurrenceServices={occurrenceServices}
        timingPlan={timingPlan}
      />
      <div className="ml-auto shrink-0">
        <UserSection />
      </div>
    </header>
    {children}
  </main>
);

const LiveSlideProgressChrome = ({
  progress,
}: {
  progress: LiveSlideProgress | null;
}) => {
  if (!progress) return null;
  return (
    <div
      className="w-full min-w-0 rounded-lg border border-gray-600 bg-gray-950/70 px-3 py-2 text-center"
      aria-label={`Live: ${progress.name}, slide ${progress.slideLabel}`}
    >
      <p className="truncate text-sm font-semibold leading-tight text-white">
        {progress.name}
      </p>
      <p className="mt-0.5 text-xs font-medium tabular-nums tracking-wide text-gray-300">
        Slide {progress.slideLabel}
      </p>
    </div>
  );
};

const DisplaysPreview = ({
  columns = 1,
  progress = null,
  activeItemId = null,
  activeListId = null,
  isVisible = true,
}: {
  columns?: 1 | 2;
  progress?: LiveSlideProgress | null;
  activeItemId?: string | null;
  activeListId?: string | null;
  /** When false, pause mounted preview video and animation work. */
  isVisible?: boolean;
}) => (
  <div className="flex h-full min-h-0 flex-col gap-2">
    <LiveSlideProgressChrome progress={progress} />
    <div className="min-h-0">
      <TransmitHandler
        readOnly
        columns={columns}
        fillWidth
        isPreviewActive={isVisible}
      />
    </div>
    <CurrentServiceItemList
      activeItemId={activeItemId}
      activeListId={activeListId}
    />
  </div>
);

const CreditsPanel = ({ credits }: { credits: CreditsInfo[] }) => (
  <div className="h-full min-h-0">
    <CreditsPreview credits={credits} isPreview compact />
  </div>
);

const ServingPanel = ({
  assignmentTeams,
  microphones,
  assignmentsStatus,
  onOpenSchedule,
}: {
  assignmentTeams: ReturnType<typeof groupAssignmentSummaryByTeam>;
  microphones: ServicePlanMicrophone[];
  assignmentsStatus: AssignmentsStatus;
  onOpenSchedule: (args: {
    scheduleId: string;
    slot?: { occurrenceId: string; columnKey: string };
  }) => void;
}) => (
  <div className="scrollbar-variable flex h-full min-h-0 flex-col gap-2 overflow-y-auto">
    <WhosServingPanel
      assignmentTeams={assignmentTeams}
      onOpenSchedule={onOpenSchedule}
      microphones={microphones}
      assignmentsStatus={assignmentsStatus}
      showHeading={false}
    />
  </div>
);

type PreviewPanelProps = {
  credits: CreditsInfo[];
  value: PreviewTab;
  onValueChange: (value: PreviewTab) => void;
  progress: LiveSlideProgress | null;
  activeItemId: string | null;
  activeListId: string | null;
  assignmentTeams: ReturnType<typeof groupAssignmentSummaryByTeam>;
  microphones: ServicePlanMicrophone[];
  assignmentsStatus: AssignmentsStatus;
  onOpenSchedule: (args: {
    scheduleId: string;
    slot?: { occurrenceId: string; columnKey: string };
  }) => void;
  churchId: string;
  youtubeConnected: boolean;
  youtubeAccountLabel: string;
  chatUnreadCount: number;
  onChatUnreadCountChange: (count: number) => void;
  showToast: (message: string, variant: "success" | "error") => void;
  sections: readonly CurrentServiceWorkspacePreviewSection[];
};

const PreviewPanelContent = ({
  credits,
  value,
  progress,
  activeItemId,
  activeListId,
  assignmentTeams,
  microphones,
  assignmentsStatus,
  onOpenSchedule,
  churchId,
  youtubeConnected,
  youtubeAccountLabel,
  chatUnreadCount,
  onChatUnreadCountChange,
  showToast,
  sections,
}: Omit<PreviewPanelProps, "onValueChange" | "sections" | "value"> & {
  value: PreviewTab;
  sections: readonly CurrentServiceWorkspacePreviewSection[];
}) => (
  <div className="min-h-0 flex-1 overflow-hidden p-2">
    {sections.some((section) => section.key === "displays") ? (
      <div
        className={
          value === "displays" ? "flex h-full min-h-0 flex-col" : "hidden"
        }
        aria-hidden={value !== "displays"}
      >
        <DisplaysPreview
          columns={2}
          activeItemId={activeItemId}
          activeListId={activeListId}
          isVisible={value === "displays"}
        />
      </div>
    ) : null}
    {sections.some((section) => section.key === "credits") ? (
      <div
        className={value === "credits" ? "h-full min-h-0" : "hidden"}
        aria-hidden={value !== "credits"}
      >
        <CreditsPanel credits={credits} />
      </div>
    ) : null}
    {sections.some((section) => section.key === "team") ? (
      <div
        className={value === "serving" ? "h-full min-h-0" : "hidden"}
        aria-hidden={value !== "serving"}
      >
        <ServingPanel
          assignmentTeams={assignmentTeams}
          microphones={microphones}
          assignmentsStatus={assignmentsStatus}
          onOpenSchedule={onOpenSchedule}
        />
      </div>
    ) : null}
    {sections.some((section) => section.key === "chat") ? (
      <div
        className={value === "chat" ? "h-full min-h-0" : "hidden"}
        aria-hidden={value !== "chat"}
      >
        <CurrentServiceRestreamPanel
          churchId={churchId}
          firebaseYoutubeConnected={youtubeConnected}
          firebaseYoutubeAccountLabel={youtubeAccountLabel}
          isVisible={value === "chat"}
          onUnreadCountChange={onChatUnreadCountChange}
          showToast={showToast}
        />
      </div>
    ) : null}
  </div>
);

const PreviewPanel = ({
  sections,
  value,
  ...props
}: PreviewPanelProps) => {
  if (sections.length === 1) {
    const section = sections[0];
    return (
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/60">
        {section.tab === "displays" ? (
          <div className="shrink-0 border-b border-gray-700 p-2">
            <LiveSlideProgressChrome progress={props.progress} />
          </div>
        ) : null}
        <PreviewPanelContent {...props} sections={sections} value={section.tab} />
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/60">
      <Tabs
        value={value}
        onValueChange={(next) => props.onValueChange(next as PreviewTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="shrink-0 border-b border-gray-700 p-2">
          <div className="flex flex-col gap-2">
            <TabsList
              variant="line"
              className={lineTabsListShellClassName}
              aria-label="Workspace preview"
            >
              {sections.map((section) => (
                <TabsTrigger
                  key={section.key}
                  value={section.tab}
                  className={lineTabsTriggerSmClassName}
                >
                  {section.label}
                  {section.key === "chat" && value !== "chat" ? (
                    <ChatUnreadBadge count={props.chatUnreadCount} />
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
            {value === "displays" ? (
              <LiveSlideProgressChrome progress={props.progress} />
            ) : null}
          </div>
        </div>
        <PreviewPanelContent {...props} sections={sections} value={value} />
      </Tabs>
    </section>
  );
};

/**
 * A read-only-at-the-controller live workspace around the current scheduled
 * service. Editing the plan follows the user's Services edit permission.
 */
const CurrentServiceWorkspace = () => {
  const {
    canViewTeams,
    canEditServices,
    canEditTeams,
    churchId,
    churchIntegrations,
    currentServiceWorkspace,
    firebaseDb,
    loginState,
    sharedDataReady,
  } = useContext(GlobalInfoContext) || {};
  const { setIsMobile } = useContext(ControllerInfoContext) || {};
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const serviceTimes = useSelector(
    (state) => state.undoable.present.serviceTimes.list,
  );
  const liveCredits = useSelector(
    (state) => state.undoable.present.credits.liveCredits,
  );
  const projectorInfo = useSelector(
    (state) => selectOutputSlot(state, "projector", "projector").info,
  );
  const monitorInfo = useSelector(
    (state) => selectOutputSlot(state, "monitor", "monitor").info,
  );
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [tab, setTab] = useState<WorkspaceTab>("plan");
  const [isPreviewPanelOpen, setIsPreviewPanelOpen] = useState(true);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [rolePositions, setRolePositions] = useState<TeamPosition[]>([]);
  const [roleTeams, setRoleTeams] = useState<TeamRecord[]>([]);
  const [roleMembers, setRoleMembers] = useState<TeamRosterMember[]>([]);
  /**
   * Schedules exactly as the bootstrap sent them, summaries included. The
   * hydration effect below fills in the ones covering the open occurrence;
   * keeping the rest as summaries is what lets a switch to another date tell
   * that *its* cells are missing rather than silently show an empty roster.
   */
  const [roleScheduleSource, setRoleScheduleSource] = useState<
    (TeamSchedule | TeamScheduleSummary)[]
  >([]);
  const roleScheduleOverridesRef = useRef(
    new Map<string, TeamSchedule | null>(),
  );
  const roleDataRequestIdRef = useRef(0);
  const roleDataInFlightRef = useRef<Promise<void> | null>(null);
  const roleDataInFlightChurchIdRef = useRef<string | undefined>(undefined);
  const roleDataChurchIdRef = useRef<string | undefined>(churchId);
  const roleDataEnabledRef = useRef(false);
  const roleDataMountedRef = useRef(false);
  const hasReceivedLiveConnectionRef = useRef(false);
  const [assignmentsIncomplete, setAssignmentsIncomplete] = useState(false);
  const [microphones, setMicrophones] = useState<ServicePlanMicrophone[]>([]);
  const [savingMicrophoneSlot, setSavingMicrophoneSlot] = useState<
    string | null
  >(null);
  const [timingPlan, setTimingPlan] =
    useState<ServicePlanTimingSource | null>(null);

  const availableSections = useMemo(
    () =>
      resolveCurrentServiceWorkspaceSections(currentServiceWorkspace, {
        team: Boolean(canViewTeams),
      }),
    [canViewTeams, currentServiceWorkspace],
  );
  const availableSectionKeys = useMemo(
    () => new Set(availableSections.map((section) => section.key)),
    [availableSections],
  );
  const displaysAvailable = availableSectionKeys.has("displays");
  const creditsAvailable = availableSectionKeys.has("credits");
  const teamAvailable = availableSectionKeys.has("team");
  const chatAvailable = availableSectionKeys.has("chat");
  const resolvedTab = resolveCurrentServiceWorkspaceTab(
    tab,
    availableSections,
  );

  const canLoadRoleData = Boolean(
    churchId && teamAvailable && loginState !== "guest",
  );
  roleDataChurchIdRef.current = churchId;
  roleDataEnabledRef.current = canLoadRoleData;

  useEffect(() => {
    roleDataMountedRef.current = true;
    return () => {
      roleDataMountedRef.current = false;
      roleDataRequestIdRef.current += 1;
      roleDataInFlightRef.current = null;
      roleDataInFlightChurchIdRef.current = undefined;
    };
  }, []);

  const liveSlideProgress = useMemo(
    () => resolveLiveSlideProgress(projectorInfo, monitorInfo),
    [monitorInfo, projectorInfo],
  );

  useSyncMonitorSettings(
    firebaseDb,
    churchId,
    !!sharedDataReady,
    displaysAvailable,
  );

  useEffect(() => {
    setIsMobile?.(!isDesktop);
    return () => setIsMobile?.(false);
  }, [isDesktop, setIsMobile]);

  useEffect(() => {
    setChatUnreadCount(0);
  }, [chatAvailable, churchId]);

  useEffect(() => {
    if (tab !== resolvedTab) {
      setTab(resolvedTab);
    }
  }, [resolvedTab, tab]);

  const loadRoleData = useCallback(
    async ({ preserveOnFailure = true }: { preserveOnFailure?: boolean } = {}) => {
      const churchIdAtStart = churchId;
      if (!canLoadRoleData || !churchIdAtStart) {
        if (!preserveOnFailure) {
          setRolePositions([]);
          setRoleTeams([]);
          setRoleMembers([]);
          setRoleScheduleSource([]);
        }
        return;
      }

      const existing = roleDataInFlightRef.current;
      if (
        existing &&
        roleDataInFlightChurchIdRef.current === churchIdAtStart
      ) {
        return existing;
      }
      roleDataInFlightRef.current = null;

      const requestId = ++roleDataRequestIdRef.current;
      roleDataChurchIdRef.current = churchIdAtStart;
      roleDataInFlightChurchIdRef.current = churchIdAtStart;
      roleScheduleOverridesRef.current.clear();
      const isCurrentRequest = () =>
        requestId === roleDataRequestIdRef.current &&
        roleDataChurchIdRef.current === churchIdAtStart &&
        roleDataEnabledRef.current &&
        roleDataMountedRef.current;

      let request!: Promise<void>;
      request = (async () => {
        try {
          const bootstrap = await getTeamsBootstrap(churchIdAtStart);
          if (!isCurrentRequest()) return;
          setRolePositions(bootstrap.positions || []);
          setRoleTeams(bootstrap.teams || []);
          setRoleMembers(bootstrap.members || []);
          setRoleScheduleSource(
            mergeCurrentServiceSchedules(
              bootstrap.schedules || [],
              roleScheduleOverridesRef.current,
            ),
          );
        } catch (error) {
          if (!isCurrentRequest()) return;
          console.error("Could not reconcile Current Service teams:", error);
          if (!preserveOnFailure) {
            setRolePositions([]);
            setRoleTeams([]);
            setRoleMembers([]);
            setRoleScheduleSource([]);
          }
        }
      })().finally(() => {
        if (roleDataInFlightRef.current === request) {
          roleDataInFlightRef.current = null;
          roleDataInFlightChurchIdRef.current = undefined;
        }
      });
      roleDataInFlightRef.current = request;
      return request;
    },
    [canLoadRoleData, churchId],
  );

  useEffect(() => {
    if (!canLoadRoleData) {
      roleDataRequestIdRef.current += 1;
      roleDataInFlightRef.current = null;
      roleDataInFlightChurchIdRef.current = undefined;
      roleScheduleOverridesRef.current.clear();
      setRolePositions([]);
      setRoleTeams([]);
      setRoleMembers([]);
      setRoleScheduleSource([]);
      return;
    }
    void loadRoleData({ preserveOnFailure: false });
  }, [canLoadRoleData, loadRoleData]);

  const applyTeamsStreamEvent = useCallback(
    (event: TeamsStreamEvent) => {
      if (event.type === "connected") {
        if (hasReceivedLiveConnectionRef.current) {
          void loadRoleData({ preserveOnFailure: true });
        } else {
          hasReceivedLiveConnectionRef.current = true;
        }
        return;
      }

      if (
        event.type === "schedule-updated" &&
        "schedule" in event &&
        event.schedule
      ) {
        const schedule = event.schedule as TeamSchedule;
        if (!schedule.scheduleId) return;
        roleScheduleOverridesRef.current.set(schedule.scheduleId, schedule);
        setRoleScheduleSource((current) =>
          mergeCurrentServiceSchedules(
            current,
            new Map([[schedule.scheduleId, schedule]]),
          ),
        );
        return;
      }

      if (
        event.type === "schedule-removed" &&
        "scheduleId" in event &&
        typeof event.scheduleId === "string"
      ) {
        const removedScheduleId = event.scheduleId;
        roleScheduleOverridesRef.current.set(removedScheduleId, null);
        setRoleScheduleSource((current) =>
          mergeCurrentServiceSchedules(
            current,
            new Map([[removedScheduleId, null]]),
          ),
        );
      }
    },
    [loadRoleData],
  );

  useEffect(() => {
    hasReceivedLiveConnectionRef.current = false;
  }, [canLoadRoleData, churchId]);

  const liveChurchId = canLoadRoleData ? churchId : null;
  useTeamsLiveSync(liveChurchId, applyTeamsStreamEvent);
  useSyncOnReconnect(canLoadRoleData ? loadRoleData : undefined);

  useEffect(() => {
    if (!canLoadRoleData || !churchId) {
      setMicrophones([]);
      return;
    }
    let cancelled = false;
    getServicePlanMicrophones(churchId)
      .then((result) => {
        if (!cancelled) setMicrophones(result.microphones);
      })
      .catch(() => {
        // Microphone allocation is optional operational metadata — the plan and
        // the roster still work without the catalog.
      });
    return () => {
      cancelled = true;
    };
  }, [canLoadRoleData, churchId]);

  useEffect(() => {
    if (
      !firebaseDb ||
      loginState === "guest" ||
      !creditsAvailable
    ) {
      return;
    }
    return onValue(
      ref(
        firebaseDb,
        getChurchDataPath(churchId || "", "credits", "publishedList"),
      ),
      (snapshot) => {
        const data = snapshot.val();
        dispatch(initiateLiveCredits(Array.isArray(data) ? data : []));
      },
    );
  }, [churchId, creditsAvailable, dispatch, firebaseDb, loginState]);

  const services = useMemo(
    () => serviceTimes.map(toTeamService),
    [serviceTimes],
  );
  const { occurrences, occurrence, selectOccurrence } =
    useCurrentServiceOccurrence(services);
  const service = useMemo(
    () =>
      services.find(
        (candidate) => candidate.serviceId === occurrence?.serviceId,
      ) || null,
    [occurrence?.serviceId, services],
  );
  const occurrenceServices = useMemo(
    () => getOccurrenceServices(serviceTimes, occurrence),
    [occurrence, serviceTimes],
  );
  const timingPlanForOccurrence = useMemo(
    () =>
      occurrence &&
      timingPlan?.planKey === getServicePlanKey(occurrence) &&
      timingPlan.startsAt === occurrence.startsAt
        ? timingPlan
        : null,
    [occurrence, timingPlan],
  );

  /** Lives in the plan's own actions menu rather than the page toolbar: it
   * corrects which service the plan panel is on, so it belongs with the plan. */
  const occurrenceSwitcher = useMemo(
    () => ({
      options: occurrences.map((candidate) => ({
        occurrenceId: candidate.occurrenceId,
        label: `${candidate.name} · ${formatOccurrenceLabel(candidate.startsAt)}`,
      })),
      onSelect: selectOccurrence,
    }),
    [occurrences, selectOccurrence],
  );

  /**
   * The operator can page back and forward through a week of services, and the
   * bootstrap does not carry assignments for every one of them, so the open
   * occurrence's schedules are fetched on demand. Converges: a fetched schedule
   * replaces its summary in the source, leaving nothing missing next time.
   */
  const [hydratingAssignments, setHydratingAssignments] = useState(false);
  useEffect(() => {
    if (!canLoadRoleData) {
      setHydratingAssignments(false);
      setAssignmentsIncomplete(false);
      return;
    }
    let cancelled = false;
    setHydratingAssignments(true);
    void hydrateOccurrenceSchedules({
      churchId,
      occurrence,
      schedules: roleScheduleSource,
    })
      .then((result) => {
        if (cancelled) return;
        setAssignmentsIncomplete(result.incomplete);
        if (result.schedules !== roleScheduleSource) {
          setRoleScheduleSource(result.schedules);
        }
      })
      .finally(() => {
        if (!cancelled) setHydratingAssignments(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canLoadRoleData, churchId, occurrence, roleScheduleSource]);

  const roleSchedules = useMemo(
    () => onlyHydratedSchedules(roleScheduleSource),
    [roleScheduleSource],
  );

  const assignmentsStatus = !assignmentsIncomplete
    ? "ready"
    : hydratingAssignments
      ? "loading"
      : "unavailable";

  const assignmentRows = useMemo(() => {
    if (!canLoadRoleData || !occurrence) return [];
    return getOccurrenceAssignmentSummary({
      occurrence,
      schedules: roleSchedules,
      positions: rolePositions,
      members: roleMembers,
      teams: roleTeams,
      services,
    });
  }, [
    canLoadRoleData,
    occurrence,
    roleMembers,
    rolePositions,
    roleSchedules,
    roleTeams,
    services,
  ]);

  const assignmentTeams = useMemo(
    () =>
      canLoadRoleData
        ? groupAssignmentSummaryByTeam(assignmentRows, roleSchedules)
        : [],
    [assignmentRows, canLoadRoleData, roleSchedules],
  );

  const scheduledMicrophoneHolders = useMemo(
    () =>
      canLoadRoleData
        ? getScheduledMicrophoneHolders(assignmentRows, roleTeams)
        : new Map(),
    [assignmentRows, canLoadRoleData, roleTeams],
  );

  /**
   * Day-level microphone allocation, saved straight to the owning schedule.
   * The response carries the updated schedule, so the roster and the plan's
   * conflict warnings both refresh from one write.
   */
  const saveScheduledMicrophones = useCallback(
    async (row: TeamsAssignmentSummaryRow, microphoneIds: string[]) => {
      if (!churchId || !row.scheduleId) return;
      setSavingMicrophoneSlot(teamMicrophoneSlotKey(row));
      // Success feedback is the toolbar Syncing → Synced chip (no toast).
      dispatch(
        autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
          AUTOSAVE_DEBOUNCE_KEYS.teams,
        ),
      );
      try {
        const result = await updateTeamScheduleAssignmentMicrophones(
          churchId,
          row.scheduleId,
          {
            serviceId: row.occurrenceId,
            positionSlotKey: row.columnKey,
            microphoneIds,
          },
        );
        setRoleScheduleSource((current) =>
          current.map((schedule) =>
            schedule.scheduleId === result.schedule.scheduleId
              ? result.schedule
              : schedule,
          ),
        );
      } catch (error) {
        showApiErrorToast(
          showToast,
          error,
          "Could not update team microphones.",
        );
      } finally {
        setSavingMicrophoneSlot(null);
        dispatch(
          autosaveIndicatorSlice.actions.endKeyedDebouncedSave(
            AUTOSAVE_DEBOUNCE_KEYS.teams,
          ),
        );
      }
    },
    [churchId, dispatch, showToast],
  );

  /**
   * Open the schedule behind this service, focused on one slot when given.
   * Return lands back on Current service (no plans restore needed).
   */
  const openSchedule = useCallback(
    ({
      scheduleId,
      slot,
    }: {
      scheduleId: string;
      slot?: { occurrenceId: string; columnKey: string };
    }) => {
      const returnTo: TeamsReturnTo = {
        label: "Current service",
        pathname: "/current-service",
      };
      persistTeamsReturnTo(returnTo, TEAMS_SECTION_PATHS.schedules);
      navigate(TEAMS_SECTION_PATHS.schedules, {
        state: buildPlanToScheduleNavigationState({
          returnTo,
          restore: {
            kind: "schedule",
            scheduleId,
            ...(slot
              ? { activeSlot: slot, slotPickerMode: "assign" as const }
              : {}),
          },
        }),
      });
    },
    [navigate],
  );

  const desktopPreviewTab: PreviewTab =
    resolvedTab === "plan"
      ? (availableSections[0]?.tab ?? "displays")
      : resolvedTab;

  if (!canViewTeams) {
    return (
      <WorkspacePage
        service={service}
        occurrence={occurrence}
        occurrenceServices={occurrenceServices}
        timingPlan={timingPlanForOccurrence}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
          <section className="max-w-md rounded-xl border border-gray-700 bg-gray-900/80 p-6 text-center">
            <h2 className="text-lg font-semibold">Teams access required</h2>
            <p className="mt-2 text-sm text-gray-300">
              Ask a church admin for view or edit access to Teams and Services.
            </p>
          </section>
        </div>
      </WorkspacePage>
    );
  }

  if (!occurrence || !service) {
    return (
      <WorkspacePage
        service={service}
        occurrence={occurrence}
        occurrenceServices={occurrenceServices}
        timingPlan={timingPlanForOccurrence}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
          <section className="max-w-md rounded-xl border border-gray-700 bg-gray-900/80 p-6 text-center">
            <ListChecks
              className="mx-auto size-8 text-cyan-300"
              aria-hidden="true"
            />
            <h2 className="mt-3 text-lg font-semibold">
              No current service scheduled
            </h2>
            <p className="mt-2 text-sm text-gray-300">
              Add a service time to open its plan here.
            </p>
          </section>
        </div>
      </WorkspacePage>
    );
  }

  const servingContent = (
    <ServingPanel
      assignmentTeams={assignmentTeams}
      microphones={microphones}
      assignmentsStatus={assignmentsStatus}
      onOpenSchedule={openSchedule}
    />
  );

  const planEditor = (
    <ServicePlanEditor
      service={service}
      occurrence={occurrence}
      onPlanTimingChange={setTimingPlan}
      members={roleMembers}
      positions={rolePositions}
      teams={roleTeams}
      scheduledMicrophoneHolders={
        canLoadRoleData ? scheduledMicrophoneHolders : undefined
      }
      teamMicrophones={
        canLoadRoleData
          ? {
              rows: assignmentRows,
              assignmentsStatus,
              savingSlot: savingMicrophoneSlot,
              onChange: (row, microphoneIds) => {
                void saveScheduledMicrophones(row, microphoneIds);
              },
            }
          : undefined
      }
      canEdit={Boolean(canEditServices ?? canEditTeams)}
      showSummary={false}
      occurrenceSwitcher={occurrenceSwitcher}
    />
  );

  return (
    <WorkspacePage
      service={service}
      occurrence={occurrence}
      occurrenceServices={occurrenceServices}
      timingPlan={timingPlanForOccurrence}
    >
      <div
        className={
          availableSections.length > 0
            ? "flex min-h-0 flex-1 gap-4 overflow-hidden"
            : "flex min-h-0 flex-1 overflow-hidden"
        }
      >
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div
            className={
              isDesktop || resolvedTab === "plan"
                ? "order-2 flex min-h-0 flex-1 flex-col overflow-hidden"
                : "hidden"
            }
          >
            {planEditor}
          </div>
          {!isDesktop ? (
            <SectionTabs<WorkspaceTab>
              value={resolvedTab}
              onValueChange={setTab}
              keepMounted
              className={
                resolvedTab === "plan"
                  ? "order-1 shrink-0"
                  : "order-1 flex min-h-0 flex-1 flex-col overflow-hidden"
              }
              tabBarClassName="shrink-0 rounded-xl bg-transparent"
              tabsListClassName="shrink-0"
              triggerClassName="!h-[2rem] !min-h-[2rem] !max-h-[2rem] text-xs px-2.5 py-1.5"
              tabsContentClassName={
                resolvedTab === "plan"
                  ? "hidden"
                  : "mt-3 flex min-h-0 flex-1 flex-col space-y-0 overflow-hidden"
              }
              items={[
                {
                  value: "plan",
                  label: "Service plan",
                  content: null,
                },
                ...(displaysAvailable
                  ? [
                      {
                        value: "displays" as const,
                        label: "Displays",
                        content: (
                          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/60 p-2">
                            <DisplaysPreview
                              columns={2}
                              progress={liveSlideProgress}
                              activeItemId={monitorInfo.itemId ?? null}
                              activeListId={monitorInfo.listId ?? null}
                              isVisible={resolvedTab === "displays"}
                            />
                          </section>
                        ),
                        contentClassName:
                          "flex min-h-0 flex-1 flex-col overflow-hidden",
                      },
                    ]
                  : []),
                ...(creditsAvailable
                  ? [
                      {
                        value: "credits" as const,
                        label: "Credits",
                        content: (
                          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/60 p-2">
                            <CreditsPanel credits={liveCredits} />
                          </section>
                        ),
                        contentClassName:
                          "flex min-h-0 flex-1 flex-col overflow-hidden",
                      },
                    ]
                  : []),
                ...(teamAvailable
                  ? [
                      {
                        value: "serving" as const,
                        label: "Team",
                        content: (
                          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/60 p-3">
                            {servingContent}
                          </section>
                        ),
                        contentClassName:
                          "flex min-h-0 flex-1 flex-col overflow-hidden",
                      },
                    ]
                  : []),
                ...(chatAvailable
                  ? [
                      {
                        value: "chat" as const,
                        label: "Chat",
                        badge:
                          resolvedTab !== "chat" ? (
                            <ChatUnreadBadge count={chatUnreadCount} />
                          ) : null,
                        content: (
                          <CurrentServiceRestreamPanel
                            churchId={churchId || ""}
                            firebaseYoutubeConnected={Boolean(
                              loginState === "success" &&
                              churchIntegrations?.youtube?.connected,
                            )}
                            firebaseYoutubeAccountLabel={
                              churchIntegrations?.youtube?.accountLabel || ""
                            }
                            isVisible={resolvedTab === "chat"}
                            onUnreadCountChange={setChatUnreadCount}
                            showToast={showToast}
                          />
                        ),
                        contentClassName:
                          "flex min-h-0 flex-1 flex-col overflow-hidden",
                      },
                    ]
                  : []),
              ]}
            />
          ) : null}
        </section>

        {isDesktop && availableSections.length > 0 ? (
          <aside
            className={`relative flex min-h-0 shrink-0 flex-col self-stretch rounded-xl border border-gray-700 bg-gray-900/60 transition-[width] duration-300 ease-in-out ${isPreviewPanelOpen ? "w-[clamp(18rem,32vw,28rem)]" : "w-10"
              }`}
            aria-label="Workspace preview"
          >
            <Button
              type="button"
              variant="tertiary"
              padding="p-0"
              className="absolute left-0 top-1/2 z-20 flex size-8 min-h-0 shrink-0 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-gray-700 bg-gray-950 shadow-sm"
              aria-expanded={isPreviewPanelOpen}
              aria-label={
                isPreviewPanelOpen
                  ? "Hide workspace preview"
                  : "Show workspace preview"
              }
              onClick={() => setIsPreviewPanelOpen((open) => !open)}
            >
              {isPreviewPanelOpen ? (
                <ChevronRight className="size-4 shrink-0" aria-hidden />
              ) : (
                <ChevronLeft className="size-4 shrink-0" aria-hidden />
              )}
            </Button>
            {isPreviewPanelOpen ? (
              <PreviewPanel
                credits={liveCredits}
                value={desktopPreviewTab}
                onValueChange={setTab}
                progress={liveSlideProgress}
                activeItemId={monitorInfo.itemId ?? null}
                activeListId={monitorInfo.listId ?? null}
                assignmentTeams={assignmentTeams}
                microphones={microphones}
                assignmentsStatus={assignmentsStatus}
                onOpenSchedule={openSchedule}
                churchId={churchId || ""}
                youtubeConnected={Boolean(
                  loginState === "success" &&
                  churchIntegrations?.youtube?.connected,
                )}
                youtubeAccountLabel={
                  churchIntegrations?.youtube?.accountLabel || ""
                }
                chatUnreadCount={chatUnreadCount}
                onChatUnreadCountChange={setChatUnreadCount}
                showToast={showToast}
                sections={availableSections}
              />
            ) : null}
          </aside>
        ) : null}
      </div>
    </WorkspacePage>
  );
};

export default CurrentServiceWorkspace;
