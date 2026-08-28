import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { getChurchDataPath } from "../../utils/firebasePaths";
import useNextServiceCountdownText from "../../hooks/useNextServiceCountdownText";
import useDisplayedUpcomingService from "../../hooks/useDisplayedUpcomingService";
import { NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS } from "../../constants/nextServiceTimer";
import {
  formatOccurrenceLabel,
  resolveLiveSlideProgress,
  type LiveSlideProgress,
} from "./currentServiceWorkspaceUtils";
import { useCurrentServiceOccurrence } from "./useCurrentServiceOccurrence";
import { hydrateOccurrenceSchedules } from "../../utils/hydrateOccurrenceSchedules";
import { onlyHydratedSchedules } from "../../api/authTypes";
import CurrentServiceRestreamPanel from "./CurrentServiceRestreamPanel";

type WorkspaceTab = "plan" | "serving" | "displays" | "credits" | "chat";
/**
 * Whether this date's schedule cells are actually on the client. The bootstrap
 * hydrates a window around today, and the operator can page beyond it.
 */
type AssignmentsStatus = "ready" | "loading" | "unavailable";
type PreviewTab = "serving" | "displays" | "credits" | "chat";

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
  serviceTimeText?: string | null;
};

const ServiceHeading = ({ service, serviceTimeText }: ServiceHeadingProps) => {
  if (!service || !serviceTimeText) return null;
  const name = service.name || "Service";

  if (serviceTimeText === "0") {
    return (
      <p className="min-w-0 flex-1 truncate text-lg font-semibold">
        {`${name} is live`}
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <p className="min-w-0 truncate text-lg font-semibold">{name}:</p>
      <div
        className="shrink-0 rounded-md border border-white/20 bg-gray-950 px-2.5 py-1 text-lg font-semibold tabular-nums tracking-tight"
        style={{ color: service.color || "#ffffff" }}
        aria-label={`Begins in ${serviceTimeText}`}
      >
        {serviceTimeText}
      </div>
    </div>
  );
};

const WorkspacePage = ({
  children,
  service,
  serviceTimeText,
}: ServiceHeadingProps & {
  children: ReactNode;
}) => (
  <main className="flex h-dvh flex-col overflow-hidden bg-homepage-canvas p-3 text-white lg:p-4">
    <header className="mb-3 flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-gray-700 bg-gray-900/60 px-3 py-2">
      <HomeToolbarMenu />
      <ServiceHeading service={service} serviceTimeText={serviceTimeText} />
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
}: {
  columns?: 1 | 2;
  progress?: LiveSlideProgress | null;
  activeItemId?: string | null;
  activeListId?: string | null;
}) => (
  <div className="flex h-full min-h-0 flex-col gap-2">
    <LiveSlideProgressChrome progress={progress} />
    <div className="min-h-0">
      <TransmitHandler readOnly columns={columns} fillWidth />
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

const PreviewPanel = ({
  credits,
  value,
  onValueChange,
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
}: {
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
}) => (
  <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/60">
    <Tabs
      value={value}
      onValueChange={(next) => onValueChange(next as PreviewTab)}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="shrink-0 border-b border-gray-700 p-2">
        <div className="flex flex-col gap-2">
          <TabsList
            variant="line"
            className={lineTabsListShellClassName}
            aria-label="Workspace preview"
          >
            <TabsTrigger value="displays" className={lineTabsTriggerSmClassName}>
              Displays
            </TabsTrigger>
            <TabsTrigger value="credits" className={lineTabsTriggerSmClassName}>
              Credits
            </TabsTrigger>
            <TabsTrigger value="serving" className={lineTabsTriggerSmClassName}>
              Team
            </TabsTrigger>
            <TabsTrigger value="chat" className={lineTabsTriggerSmClassName}>
              Chat
              {value !== "chat" ? (
                <ChatUnreadBadge count={chatUnreadCount} />
              ) : null}
            </TabsTrigger>
          </TabsList>
          {value === "displays" ? (
            <LiveSlideProgressChrome progress={progress} />
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-2">
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
          />
        </div>
        <div
          className={value === "credits" ? "h-full min-h-0" : "hidden"}
          aria-hidden={value !== "credits"}
        >
          <CreditsPanel credits={credits} />
        </div>
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
        <div
          className={value === "chat" ? "h-full min-h-0" : "hidden"}
          aria-hidden={value !== "chat"}
        >
          <CurrentServiceRestreamPanel
            churchId={churchId}
            youtubeConnected={youtubeConnected}
            youtubeAccountLabel={youtubeAccountLabel}
            isVisible={value === "chat"}
            onUnreadCountChange={onChatUnreadCountChange}
            showToast={showToast}
          />
        </div>
      </div>
    </Tabs>
  </section>
);

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
    firebaseDb,
    loginState,
    sharedDataReady,
  } = useContext(GlobalInfoContext) || {};
  const { setIsMobile } = useContext(ControllerInfoContext) || {};
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const serviceTimes = useSelector((state) => state.undoable.present.serviceTimes.list);
  const liveCredits = useSelector((state) => state.undoable.present.credits.liveCredits);
  const projectorInfo = useSelector((state) => state.presentation.projectorInfo);
  const monitorInfo = useSelector((state) => state.presentation.monitorInfo);
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
  const [assignmentsIncomplete, setAssignmentsIncomplete] = useState(false);
  const [microphones, setMicrophones] = useState<ServicePlanMicrophone[]>([]);
  const [savingMicrophoneSlot, setSavingMicrophoneSlot] = useState<string | null>(
    null,
  );

  const liveSlideProgress = useMemo(
    () => resolveLiveSlideProgress(projectorInfo, monitorInfo),
    [monitorInfo, projectorInfo],
  );

  useSyncMonitorSettings(firebaseDb, churchId, !!sharedDataReady);

  useEffect(() => {
    setIsMobile?.(!isDesktop);
  }, [isDesktop, setIsMobile]);

  useEffect(() => {
    setChatUnreadCount(0);
  }, [churchId]);

  useEffect(() => {
    if (!churchId || !canViewTeams || loginState === "guest") {
      setRolePositions([]);
      setRoleTeams([]);
      setRoleMembers([]);
      setRoleScheduleSource([]);
      return;
    }
    let cancelled = false;
    getTeamsBootstrap(churchId)
      .then((bootstrap) => {
        if (cancelled) return;
        setRolePositions(bootstrap.positions || []);
        setRoleTeams(bootstrap.teams || []);
        setRoleMembers(bootstrap.members || []);
        setRoleScheduleSource(bootstrap.schedules || []);
      })
      .catch(() => {
        if (!cancelled) {
          setRolePositions([]);
          setRoleTeams([]);
          setRoleMembers([]);
          setRoleScheduleSource([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canViewTeams, churchId, loginState]);

  useEffect(() => {
    if (!churchId || !canViewTeams || loginState === "guest") {
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
  }, [canViewTeams, churchId, loginState]);

  useEffect(() => {
    if (!firebaseDb || loginState === "guest") return;
    return onValue(
      ref(firebaseDb, getChurchDataPath(churchId || "", "credits", "publishedList")),
      (snapshot) => {
        const data = snapshot.val();
        dispatch(initiateLiveCredits(Array.isArray(data) ? data : []));
      },
    );
  }, [churchId, dispatch, firebaseDb, loginState]);

  const services = useMemo(() => serviceTimes.map(toTeamService), [serviceTimes]);
  const { occurrences, occurrence, selectOccurrence } =
    useCurrentServiceOccurrence(services);
  const service = useMemo(
    () => services.find((candidate) => candidate.serviceId === occurrence?.serviceId) || null,
    [occurrence?.serviceId, services],
  );
  /**
   * The header timer is the same "next service" countdown every other surface
   * shows (stream info, service times, display timers): it honours a service's
   * override time, holds at zero through the grace window, then rolls to the
   * next service. Deliberately independent of which occurrence the plan panel
   * is on — the operator can page back through plans without the clock moving.
   */
  const upcomingService = useDisplayedUpcomingService(
    serviceTimes,
    NEXT_SERVICE_UPCOMING_REFRESH_GRACE_MS,
    { keepRecentlyElapsedDuringGrace: true },
  );
  const upcomingTargetIso = useMemo(
    () => upcomingService?.nextAt.toISOString() ?? null,
    [upcomingService],
  );
  const serviceTimeText = useNextServiceCountdownText(upcomingTargetIso);
  const headerService = upcomingService?.service ?? null;

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
  }, [churchId, occurrence, roleScheduleSource]);

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
    if (!occurrence) return [];
    return getOccurrenceAssignmentSummary({
      occurrence,
      schedules: roleSchedules,
      positions: rolePositions,
      members: roleMembers,
      teams: roleTeams,
      services,
    });
  }, [
    occurrence,
    roleMembers,
    rolePositions,
    roleSchedules,
    roleTeams,
    services,
  ]);

  const assignmentTeams = useMemo(
    () => groupAssignmentSummaryByTeam(assignmentRows, roleSchedules),
    [assignmentRows, roleSchedules],
  );

  const scheduledMicrophoneHolders = useMemo(
    () => getScheduledMicrophoneHolders(assignmentRows, roleTeams),
    [assignmentRows, roleTeams],
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
        showApiErrorToast(showToast, error, "Could not update team microphones.");
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
    tab === "credits" || tab === "serving" || tab === "chat"
      ? tab
      : "displays";

  if (!canViewTeams) {
    return (
      <WorkspacePage service={headerService} serviceTimeText={serviceTimeText}>
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
      <WorkspacePage service={headerService} serviceTimeText={serviceTimeText}>
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
      members={roleMembers}
      positions={rolePositions}
      teams={roleTeams}
      scheduledMicrophoneHolders={scheduledMicrophoneHolders}
      teamMicrophones={{
        rows: assignmentRows,
        assignmentsStatus,
        savingSlot: savingMicrophoneSlot,
        onChange: (row, microphoneIds) => {
          void saveScheduledMicrophones(row, microphoneIds);
        },
      }}
      canEdit={Boolean(canEditServices ?? canEditTeams)}
      showSummary={false}
      occurrenceSwitcher={occurrenceSwitcher}
    />
  );

  if (!isDesktop) {
    return (
      <WorkspacePage service={headerService} serviceTimeText={serviceTimeText}>
        <SectionTabs<WorkspaceTab>
          value={tab}
          onValueChange={setTab}
          keepMounted
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          tabBarClassName="shrink-0 rounded-xl bg-transparent"
          tabsListClassName="shrink-0"
          triggerClassName="text-xs px-2.5 py-1.5"
          tabsContentClassName="mt-3 flex min-h-0 flex-1 flex-col space-y-0 overflow-hidden"
          items={[
            {
              value: "plan",
              label: "Service plan",
              content: planEditor,
              contentClassName: "flex min-h-0 flex-1 flex-col overflow-hidden",
            },
            {
              value: "displays",
              label: "Displays",
              content: (
                <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/60 p-2">
                  <DisplaysPreview
                    columns={2}
                    progress={liveSlideProgress}
                    activeItemId={monitorInfo.itemId ?? null}
                    activeListId={monitorInfo.listId ?? null}
                  />
                </section>
              ),
              contentClassName: "flex min-h-0 flex-1 flex-col overflow-hidden",
            },
            {
              value: "credits",
              label: "Credits",
              content: (
                <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/60 p-2">
                  <CreditsPanel credits={liveCredits} />
                </section>
              ),
              contentClassName: "flex min-h-0 flex-1 flex-col overflow-hidden",
            },
            {
              value: "serving",
              label: "Team",
              content: (
                <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/60 p-3">
                  {servingContent}
                </section>
              ),
              contentClassName: "flex min-h-0 flex-1 flex-col overflow-hidden",
            },
            {
              value: "chat",
              label: "Chat",
              badge:
                tab !== "chat" ? (
                  <ChatUnreadBadge count={chatUnreadCount} />
                ) : null,
              content: (
                <CurrentServiceRestreamPanel
                  churchId={churchId || ""}
                  youtubeConnected={Boolean(
                    loginState === "success" &&
                      churchIntegrations?.youtube?.connected,
                  )}
                  youtubeAccountLabel={
                    churchIntegrations?.youtube?.accountLabel || ""
                  }
                  isVisible={tab === "chat"}
                  onUnreadCountChange={setChatUnreadCount}
                  showToast={showToast}
                />
              ),
              contentClassName: "flex min-h-0 flex-1 flex-col overflow-hidden",
            },
          ]}
        />
      </WorkspacePage>
    );
  }

  return (
    <WorkspacePage service={headerService} serviceTimeText={serviceTimeText}>
      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {planEditor}
        </section>

        <aside
          className={`relative flex min-h-0 shrink-0 flex-col self-stretch rounded-xl border border-gray-700 bg-gray-900/60 transition-[width] duration-300 ease-in-out ${
            isPreviewPanelOpen ? "w-[clamp(18rem,32vw,28rem)]" : "w-10"
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
              isPreviewPanelOpen ? "Hide workspace preview" : "Show workspace preview"
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
                loginState === "success" && churchIntegrations?.youtube?.connected,
              )}
              youtubeAccountLabel={
                churchIntegrations?.youtube?.accountLabel || ""
              }
              chatUnreadCount={chatUnreadCount}
              onChatUnreadCountChange={setChatUnreadCount}
              showToast={showToast}
            />
          ) : null}
        </aside>
      </div>
    </WorkspacePage>
  );
};

export default CurrentServiceWorkspace;
