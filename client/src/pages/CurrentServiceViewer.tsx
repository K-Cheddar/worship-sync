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
import {
  ArrowLeft,
  MessageCircle,
  RotateCcw,
} from "lucide-react";
import Button from "../components/Button/Button";
import Select from "../components/Select/Select";
import { useChat } from "../chat/ChatContext";
import { GlobalInfoContext } from "../context/globalInfo";
import { useSelector } from "../hooks";
import {
  getServicePlanViewer,
} from "../api/auth";
import type { TeamScheduleOccurrence } from "../api/authTypes";
import type { ServiceTime } from "../types";
import type { ServicePlan } from "../types/servicePlan";
import { useSyncOnReconnect } from "../hooks/useSyncOnReconnect";
import {
  isServicePlanUpdatedEvent,
  useTeamsLiveSync,
  type TeamsStreamEvent,
} from "./Teams/hooks/useTeamsLiveSync";
import {
  getCurrentServiceResolutionRecheckAtMs,
  listCurrentServiceOccurrences,
  resolveCurrentServiceOccurrence,
  type CurrentServiceResolutionReason,
} from "../utils/currentServiceResolution";
import {
  getServerTimeOffset,
  serverDate,
  subscribeServerTimeOffset,
} from "../utils/serverTime";
import { getServicePlanKey } from "../utils/servicePlanKeys";
import ServicePublicView from "./ServicePublicView";
import { buildServicePlanFlowSnapshot } from "./buildServicePlanFlowSnapshot";
import type { Option } from "../types";
import type { PublicServiceFlowSnapshot } from "../services/serviceFlowTypes";

const VIEWER_STALE_AFTER_MS = 10 * 60 * 1000;
const VIEWER_OCCURRENCE_LOOKAHEAD_DAYS = 366;
const VIEWER_MANUAL_LOOKAHEAD_DAYS = 42;

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message : fallback;

const formatOccurrenceOptionDate = (startsAt: string): string => {
  const timestamp = Date.parse(startsAt);
  if (!Number.isFinite(timestamp)) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
};

export const getCurrentServiceViewerStatusLabel = (
  reason: CurrentServiceResolutionReason,
): string => {
  switch (reason) {
    case "in-progress":
      return "Current service";
    case "upcoming-today":
      return "Next service today";
    case "recently-ended":
      return "Recently ended";
    case "upcoming":
      return "Next service";
    default:
      return "Current service";
  }
};

export const buildCurrentServiceViewerOptions = (
  occurrences: TeamScheduleOccurrence[],
  nowMs: number,
): Option[] => {
  const today = new Date(nowMs);
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(today.getDate()).padStart(2, "0")}`;
  const groups = new Map<string, Option[]>();

  const nextFutureOccurrence = occurrences.find(
    (occurrence) => Date.parse(occurrence.startsAt) > nowMs,
  );
  const manualCutoff = nowMs + VIEWER_MANUAL_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;
  const boundedOccurrences = occurrences.filter((occurrence) => {
    const startsAt = Date.parse(occurrence.startsAt);
    return (
      Number.isFinite(startsAt) &&
      (startsAt <= nowMs || startsAt <= manualCutoff || occurrence === nextFutureOccurrence)
    );
  });

  boundedOccurrences.forEach((occurrence) => {
    const startsAt = Date.parse(occurrence.startsAt);
    const startsDate = new Date(startsAt);
    const startsKey = `${startsDate.getFullYear()}-${String(
      startsDate.getMonth() + 1,
    ).padStart(2, "0")}-${String(startsDate.getDate()).padStart(2, "0")}`;
    let group = "Upcoming";
    if (startsAt <= nowMs) {
      group = "Recent";
    } else if (startsKey === todayKey) {
      group = "Today";
    }
    const options = groups.get(group) ?? [];
    options.push({
      label: `${occurrence.name} · ${formatOccurrenceOptionDate(
        occurrence.startsAt,
      )}`,
      value: occurrence.occurrenceId,
      group,
    });
    groups.set(group, options);
  });

  return ["Recent", "Today", "Upcoming"].flatMap(
    (group) => groups.get(group) ?? [],
  );
};

export const useCurrentServiceViewerSelection = (services: ServiceTime[]) => {
  const serverTimeOffset = useSyncExternalStore(
    subscribeServerTimeOffset,
    getServerTimeOffset,
    getServerTimeOffset,
  );
  const [clockTick, setClockTick] = useState(0);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<
    string | null
  >(null);
  const nowMs = serverDate().getTime();
  const occurrences = useMemo(
    () =>
      listCurrentServiceOccurrences(services, nowMs, {
        lookaheadDays: VIEWER_OCCURRENCE_LOOKAHEAD_DAYS,
      }),
    [nowMs, services],
  );
  const automaticResolution = useMemo(
    () => resolveCurrentServiceOccurrence(occurrences, nowMs),
    [occurrences, nowMs],
  );

  useEffect(() => {
    const boundary = new Date(nowMs);
    boundary.setHours(24, 0, 0, 0);
    const recheckAt = getCurrentServiceResolutionRecheckAtMs(
      occurrences,
      nowMs,
    );
    const nextAt = Math.min(recheckAt ?? Number.POSITIVE_INFINITY, boundary.getTime());
    if (!Number.isFinite(nextAt)) return;
    const timeoutId = window.setTimeout(
      () => setClockTick((tick) => tick + 1),
      Math.max(1_000, nextAt - serverDate().getTime()),
    );
    return () => window.clearTimeout(timeoutId);
  }, [nowMs, occurrences, serverTimeOffset, clockTick]);

  useEffect(() => {
    if (
      selectedOccurrenceId &&
      !occurrences.some(
        (occurrence) => occurrence.occurrenceId === selectedOccurrenceId,
      )
    ) {
      setSelectedOccurrenceId(null);
    }
  }, [occurrences, selectedOccurrenceId]);

  const selectedOccurrence = occurrences.find(
    (occurrence) => occurrence.occurrenceId === selectedOccurrenceId,
  );
  const occurrence = selectedOccurrence ?? automaticResolution.occurrence;

  const selectOccurrence = useCallback((occurrenceId: string) => {
    setSelectedOccurrenceId(occurrenceId);
  }, []);
  const returnToCurrent = useCallback(() => {
    setSelectedOccurrenceId(null);
  }, []);

  return {
    automaticResolution,
    occurrences,
    occurrence: occurrence ?? null,
    selectedOccurrenceId,
    selectOccurrence,
    returnToCurrent,
    nowMs,
  };
};

type ViewerData = {
  plan: ServicePlan | null;
  publicSnapshot: PublicServiceFlowSnapshot | null;
  isLoadingPlan: boolean;
  planError: string | null;
  refresh: () => Promise<void>;
};

type ViewerPlanState =
  | { kind: "idle" }
  | { kind: "loading"; planKey: string }
  | {
      kind: "loaded";
      planKey: string;
      plan: ServicePlan | null;
      publicSnapshot: PublicServiceFlowSnapshot | null;
    }
  | {
      kind: "error";
      planKey: string;
      plan: ServicePlan | null;
      publicSnapshot: PublicServiceFlowSnapshot | null;
      message: string;
    };

const useCurrentServiceViewerData = (
  churchId: string,
  canViewServices: boolean,
  canViewTeams: boolean,
  occurrence: TeamScheduleOccurrence | null,
): ViewerData => {
  const [planState, setPlanState] = useState<ViewerPlanState>({ kind: "idle" });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const planCacheRef = useRef(new Map<string, ServicePlan | null>());
  const activePlanKeyRef = useRef<string | null>(null);
  const detailRequestIdRef = useRef(0);
  const refreshInFlightRef = useRef<{
    churchId: string;
    planKey: string;
    promise: Promise<void>;
  } | null>(null);
  const lastRefreshAtRef = useRef(0);
  const hasConnectedRef = useRef(false);
  const lastChurchIdRef = useRef(churchId);

  const activePlanKey = occurrence ? getServicePlanKey(occurrence) : null;
  activePlanKeyRef.current = activePlanKey;
  useEffect(() => {
    if (lastChurchIdRef.current === churchId) return;
    lastChurchIdRef.current = churchId;
    detailRequestIdRef.current += 1;
    planCacheRef.current.clear();
    setPlanState({ kind: "idle" });
    hasConnectedRef.current = false;
    lastRefreshAtRef.current = 0;
    refreshInFlightRef.current = null;
  }, [churchId]);

  const refresh = useCallback(async (options?: {
    force?: boolean;
    preserveLoadedPlan?: boolean;
  }) => {
    if (!churchId || !canViewServices || !activePlanKey) return;
    const inFlight = refreshInFlightRef.current;
    if (
      !options?.force &&
      inFlight?.churchId === churchId &&
      inFlight.planKey === activePlanKey
    ) {
      return inFlight.promise;
    }

    const requestId = ++detailRequestIdRef.current;
    lastRefreshAtRef.current = Date.now();
    setRefreshVersion((version) => version + 1);
    if (!options?.preserveLoadedPlan) {
      const cachedPlan = planCacheRef.current.get(activePlanKey);
      if (cachedPlan !== undefined && !canViewTeams) {
        setPlanState({
          kind: "loaded",
          planKey: activePlanKey,
          plan: cachedPlan,
          publicSnapshot: null,
        });
      } else {
        setPlanState({ kind: "loading", planKey: activePlanKey });
      }
    }
    const request = getServicePlanViewer(churchId, activePlanKey)
      .then((response) => {
        if (requestId !== detailRequestIdRef.current) return;
        planCacheRef.current.set(activePlanKey, response.plan);
        setPlanState({
          kind: "loaded",
          planKey: activePlanKey,
          plan: response.plan,
          publicSnapshot: response.snapshot,
        });
      })
      .catch((error: unknown) => {
        if (requestId !== detailRequestIdRef.current) return;
        setPlanState((current) => {
          const hasCurrentPlan =
            current.kind !== "idle" && current.planKey === activePlanKey;
          return {
            kind: "error",
            planKey: activePlanKey,
            plan:
              hasCurrentPlan &&
              (current.kind === "loaded" || current.kind === "error")
                ? current.plan
                : null,
            publicSnapshot:
              hasCurrentPlan && current.kind === "loaded"
                ? current.publicSnapshot
                : null,
            message: getErrorMessage(error, "Could not load this service plan."),
          };
        });
      })
      .finally(() => {
        if (requestId === detailRequestIdRef.current) {
          refreshInFlightRef.current = null;
        }
      });
    refreshInFlightRef.current = {
      churchId,
      planKey: activePlanKey,
      promise: request,
    };
    return request;
  }, [activePlanKey, canViewServices, canViewTeams, churchId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshOnReconnect = useCallback(() => {
    void refresh();
  }, [refresh]);

  useSyncOnReconnect(refreshOnReconnect);

  useEffect(() => {
    const refreshIfStale = () => {
      if (Date.now() - lastRefreshAtRef.current >= VIEWER_STALE_AFTER_MS) {
        void refresh();
      }
    };
    window.addEventListener("focus", refreshIfStale);
    return () => window.removeEventListener("focus", refreshIfStale);
  }, [refresh]);

  useEffect(() => {
    if (!refreshVersion || !activePlanKey) return;
    const delay = Math.max(
      1_000,
      VIEWER_STALE_AFTER_MS - (Date.now() - lastRefreshAtRef.current),
    );
    const timeoutId = window.setTimeout(() => {
      void refresh();
    }, delay);
    return () => window.clearTimeout(timeoutId);
  }, [activePlanKey, refresh, refreshVersion]);

  const handleStreamEvent = useCallback(
    (event: TeamsStreamEvent) => {
      if (event.type === "connected") {
        if (hasConnectedRef.current) void refresh();
        hasConnectedRef.current = true;
        return;
      }
      if (isServicePlanUpdatedEvent(event)) {
        const nextPlan = event.servicePlan;
        planCacheRef.current.set(nextPlan.planKey, nextPlan);
        if (nextPlan.planKey === activePlanKeyRef.current) {
          detailRequestIdRef.current += 1;
          setPlanState({
            kind: "loaded",
            planKey: nextPlan.planKey,
            plan: nextPlan,
            publicSnapshot: null,
          });
          void refresh({ force: true, preserveLoadedPlan: true });
        }
        return;
      }
      if (
        event.type === "service-plan-removed" &&
        typeof event.planKey === "string"
      ) {
        planCacheRef.current.delete(event.planKey);
        if (event.planKey === activePlanKeyRef.current) {
          detailRequestIdRef.current += 1;
          refreshInFlightRef.current = null;
          setPlanState({
            kind: "loaded",
            planKey: event.planKey,
            plan: null,
            publicSnapshot: null,
          });
        }
      }
    },
    [refresh],
  );

  useTeamsLiveSync(canViewTeams ? churchId : null, handleStreamEvent);

  const currentPlanState: ViewerPlanState = !activePlanKey
    ? { kind: "idle" }
    : planState.kind !== "idle" && planState.planKey === activePlanKey
      ? planState
      : { kind: "loading", planKey: activePlanKey };

  return {
    plan:
      currentPlanState.kind === "loaded" || currentPlanState.kind === "error"
        ? currentPlanState.plan
        : null,
    publicSnapshot:
      currentPlanState.kind === "loaded" || currentPlanState.kind === "error"
        ? currentPlanState.publicSnapshot
        : null,
    isLoadingPlan: currentPlanState.kind === "loading",
    planError:
      currentPlanState.kind === "error" ? currentPlanState.message : null,
    refresh: () => refresh({ force: true }),
  };
};

const CurrentServiceViewerTeamChatAction = () => {
  const chat = useChat();
  if (!chat?.available) return null;

  const unreadLabel = chat.unreadCount > 99 ? "99+" : String(chat.unreadCount);
  const ariaLabel = chat.unreadCount
    ? `Open Team Chat. ${chat.unreadCount} unread ${chat.unreadCount === 1 ? "message" : "messages"}.`
    : "Open Team Chat";

  return (
    <Button
      type="button"
      variant="tertiary"
      svg={MessageCircle}
      iconSize="sm"
      className="relative cursor-pointer border border-cyan-500/30 bg-cyan-950/30 text-neutral-100"
      aria-label={ariaLabel}
      onClick={() => {
        chat.openChat();
      }}
    >
      Team Chat
      {chat.unreadCount > 0 ? (
        <span
          className="min-w-5 rounded-full bg-cyan-400 px-1.5 py-0.5 text-center text-[10px] font-bold leading-none tabular-nums text-gray-950"
          aria-hidden="true"
        >
          {unreadLabel}
        </span>
      ) : null}
    </Button>
  );
};

const CurrentServiceViewerToolbar = ({
  options,
  selectedOccurrenceId,
  selectedValue,
  onSelect,
  onReturnToCurrent,
}: {
  options: Option[];
  selectedOccurrenceId: string | null;
  selectedValue: string;
  onSelect: (value: string) => void;
  onReturnToCurrent: () => void;
}) => (
  <div
    role="toolbar"
    aria-label="Current service toolbar"
    className="relative left-1/2 order-0 -mt-4 flex w-dvw max-w-none -translate-x-1/2 flex-wrap items-center gap-2 border border-neutral-700 bg-neutral-900/95 p-3 shadow-lg sm:-mt-6 sm:gap-3"
  >
    <div className="order-1 shrink-0">
      <Button
        component="link"
        to="/home"
        variant="textLink"
        svg={ArrowLeft}
        className="shrink-0 cursor-pointer text-neutral-200"
      >
        Home
      </Button>
    </div>
    <div className="order-3 flex w-full min-w-0 flex-wrap items-center justify-center gap-2 md:absolute md:left-1/2 md:order-2 md:w-auto md:-translate-x-1/2 md:flex-none md:flex-nowrap md:gap-3">
      {options.length > 0 ? (
        <Select
          label="Choose a service"
          labelLayout="inline"
          options={options}
          value={selectedValue}
          onChange={onSelect}
          className="w-full min-w-0 max-w-full max-md:flex-col max-md:items-stretch md:w-auto"
          labelClassName="max-md:w-full"
          selectClassName="w-full min-w-0 md:w-auto md:min-w-64"
          contentClassName="max-h-80"
        />
      ) : null}
      {selectedOccurrenceId ? (
        <Button
          variant="textLink"
          svg={RotateCcw}
          onClick={onReturnToCurrent}
          className="cursor-pointer text-neutral-200"
        >
          Return to current service
        </Button>
      ) : null}
    </div>
    <div className="order-2 ml-auto shrink-0 md:order-3">
      <CurrentServiceViewerTeamChatAction />
    </div>
  </div>
);

const CurrentServiceViewerFrame = ({
  topBar,
  children,
}: {
  topBar: ReactNode;
  children: ReactNode;
}) => (
  <main className="min-h-dvh overflow-x-hidden overflow-y-auto bg-neutral-950 text-neutral-100">
    <div className="mx-auto max-w-3xl px-3 pb-24 pt-4 sm:px-5 sm:pb-28 sm:pt-6">
      <div className="mb-4">{topBar}</div>
      {children}
    </div>
  </main>
);

const CurrentServiceViewerSkeleton = () => (
  <div
    role="status"
    aria-label="Loading service"
    className="animate-pulse space-y-4"
  >
    <div className="rounded-xl border border-neutral-700 bg-neutral-900/95 p-4 shadow-lg">
      <div className="h-5 w-2/5 rounded bg-neutral-700" />
      <div className="mt-3 h-3 w-1/3 rounded bg-neutral-800" />
      <div className="mt-5 h-9 w-full rounded bg-neutral-800" />
    </div>
    {["w-1/4", "w-2/5", "w-1/3"].map((width, index) => (
      <section key={index}>
        <div className={`mb-2 h-3 ${width} rounded bg-neutral-700`} />
        <div className="overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900">
          <div className="h-14 border-b border-neutral-800" />
          <div className="h-14 border-b border-neutral-800" />
          <div className="h-14" />
        </div>
      </section>
    ))}
  </div>
);

const CurrentServiceViewer = () => {
  const {
    canViewServices = false,
    canViewTeams = false,
    churchId = "",
    churchName = "",
  } = useContext(GlobalInfoContext) || {};
  const serviceTimes = useSelector(
    (state) => state.undoable.present.serviceTimes.list,
  );
  const selection = useCurrentServiceViewerSelection(serviceTimes);
  const data = useCurrentServiceViewerData(
    churchId,
    canViewServices,
    canViewTeams,
    selection.occurrence,
  );
  const options = useMemo(
    () => buildCurrentServiceViewerOptions(selection.occurrences, selection.nowMs),
    [selection.nowMs, selection.occurrences],
  );
  const isOffline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  const activePlanKey = selection.occurrence
    ? getServicePlanKey(selection.occurrence)
    : null;
  const hasPlanContent = Boolean(
    data.plan && data.plan.planKey === activePlanKey,
  );
  const hasPlanError = Boolean(data.planError);
  const topBar = (
    <CurrentServiceViewerToolbar
      options={options}
      selectedOccurrenceId={selection.selectedOccurrenceId}
      selectedValue={selection.occurrence?.occurrenceId ?? ""}
      onSelect={selection.selectOccurrence}
      onReturnToCurrent={selection.returnToCurrent}
    />
  );
  if (!canViewServices) {
    return (
      <CurrentServiceViewerFrame topBar={topBar}>
        <section className="rounded-xl border border-neutral-700 bg-neutral-900/95 p-6 text-neutral-200 shadow-lg">
          <h1 className="text-xl font-semibold">Service viewer unavailable</h1>
          <p className="mt-2 text-sm text-neutral-300">
            This account does not have access to saved service plans. Ask a church
            administrator for service-plan viewing access.
          </p>
        </section>
      </CurrentServiceViewerFrame>
    );
  }

  if (selection.occurrence && data.isLoadingPlan) {
    return (
      <CurrentServiceViewerFrame topBar={topBar}>
        <CurrentServiceViewerSkeleton />
      </CurrentServiceViewerFrame>
    );
  }

  if (hasPlanContent) {
    return (
      <ServicePublicView
        snapshot={
          data.publicSnapshot ??
          buildServicePlanFlowSnapshot({
            plan: data.plan!,
            startsAt: selection.occurrence!.startsAt,
            churchName,
            serverNowMs: selection.nowMs,
          })
        }
        error={data.planError || (isOffline ? "You are offline." : "")}
        onRefresh={() => void data.refresh()}
        topContent={topBar}
      />
    );
  }

  return (
    <CurrentServiceViewerFrame topBar={topBar}>
      {!selection.occurrence ? (
        <section className="rounded-xl border border-neutral-700 bg-neutral-900/95 p-5 text-neutral-300 shadow-lg">
          <p className="font-medium text-white">No current or upcoming services</p>
          <p className="mt-1 text-sm">
            There is no current or upcoming service in the available schedule window.
          </p>
        </section>
      ) : hasPlanError ? (
        <section role="alert" className="rounded-xl border border-red-400/40 bg-neutral-900/95 p-5 text-neutral-200 shadow-lg">
          <p>{data.planError}</p>
          <Button
            variant="secondary"
            onClick={() => void data.refresh()}
            className="mt-4 cursor-pointer"
          >
            Try again
          </Button>
        </section>
      ) : (
        <section className="rounded-xl border border-neutral-700 bg-neutral-900/95 p-5 text-neutral-300 shadow-lg">
          <p className="font-medium text-white">No Service Plan yet</p>
          <p className="mt-1 text-sm">
            No saved Service Plan has been created for this service.
          </p>
        </section>
      )}
    </CurrentServiceViewerFrame>
  );
};

export default CurrentServiceViewer;
