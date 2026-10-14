/**
 * Owns "which service is the Controller on" for every current-service surface.
 *
 * The pick is made once per server calendar-day context (or as soon as the
 * services list arrives), and then held. Re-picking on a timer meant a service
 * could swap the operator onto next week's plan mid-service — exactly the kind
 * of surprise a live surface can't afford. Time still passes, but the answer
 * doesn't change under the operator's hands; they switch services themselves.
 *
 * The pin is dropped only when it stops being real: if the chosen occurrence
 * disappears from the schedule (service deleted, time changed), the next-best
 * service is picked so the surface never sits on a service that no longer runs.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useSyncOnReconnect } from "../../hooks/useSyncOnReconnect";
import {
  getServerTimeOffset,
  serverDate,
  subscribeServerTimeOffset,
} from "../../utils/serverTime";
import {
  listCurrentServiceOccurrences,
  pickCurrentServiceOccurrence,
} from "./currentServiceWorkspaceUtils";
import type { TeamScheduleOccurrence, TeamService } from "../../api/authTypes";
import { useChurchServiceTimeZone } from "../../context/churchServiceTimeZone";
import { calendarDateInTimeZone, serviceDateTimeInTimeZone } from "../../utils/teamScheduleOccurrences";
import { formatPlainDate, parsePlainDate } from "../../utils/plainDate";

export type CurrentServiceOccurrence = {
  /** Occurrences the operator can switch between, earliest first. */
  occurrences: TeamScheduleOccurrence[];
  /** The occurrence driving the plan: the operator's pick, else the auto one. */
  occurrence: TeamScheduleOccurrence | null;
  /** Set only once the operator has overridden the automatic pick. */
  selectedOccurrenceId: string | null;
  selectOccurrence: (occurrenceId: string) => void;
  returnToCurrent: () => void;
};

const sessionDayKey = (nowMs: number, timeZone: string): string =>
  calendarDateInTimeZone(new Date(nowMs), timeZone);

const useAuthoritativeServerNowMs = (timeZone: string): number => {
  const serverOffsetMs = useSyncExternalStore(
    subscribeServerTimeOffset,
    getServerTimeOffset,
    getServerTimeOffset,
  );
  const [dayBoundaryTick, setDayBoundaryTick] = useState(0);

  useEffect(() => {
    const nowMs = serverDate().getTime();
    const nextDate = parsePlainDate(calendarDateInTimeZone(new Date(nowMs), timeZone));
    nextDate?.setDate(nextDate.getDate() + 1);
    const nextBoundary = nextDate
      ? serviceDateTimeInTimeZone(formatPlainDate(nextDate), "00:00", timeZone)?.getTime() ?? Number.POSITIVE_INFINITY
      : Number.POSITIVE_INFINITY;
    const delayMs = Math.max(1, nextBoundary - nowMs);
    const timeoutId = window.setTimeout(
      () => setDayBoundaryTick((tick) => tick + 1),
      delayMs,
    );
    return () => window.clearTimeout(timeoutId);
  }, [dayBoundaryTick, serverOffsetMs, timeZone]);

  return serverDate().getTime();
};

export const useCurrentServiceOccurrence = (
  services: TeamService[],
): CurrentServiceOccurrence => {
  const churchTimeZone = useChurchServiceTimeZone();
  const serviceTimeZone = churchTimeZone.timeZone || "UTC";
  const authoritativeNowMs = useAuthoritativeServerNowMs(serviceTimeZone);
  /** Anchored for the current server calendar-day context: the candidate
   * window shouldn't drift under a session that stays open through a service. */
  const [loadedAtMs, setLoadedAtMs] = useState(() => authoritativeNowMs);
  const loadedDayKeyRef = useRef(sessionDayKey(loadedAtMs, serviceTimeZone));
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<
    string | null
  >(null);

  const occurrences = useMemo(
    () => churchTimeZone.status === "ready" && serviceTimeZone
      ? listCurrentServiceOccurrences(services, loadedAtMs, { timeZone: serviceTimeZone })
      : [],
    [churchTimeZone.status, loadedAtMs, serviceTimeZone, services],
  );

  /**
   * The automatic pick, held as state rather than a ref. Render has to be a
   * pure function of it: a ref read inside the memo below makes the pick depend
   * on *when* React happens to evaluate it, and under StrictMode or a
   * concurrent re-render that can resolve to a different service than the one
   * the operator is looking at.
   */
  const [pinnedOccurrenceId, setPinnedOccurrenceId] = useState<string | null>(
    null,
  );

  const resetStaleSession = useCallback((nowMs = serverDate().getTime()) => {
    const nextDayKey = sessionDayKey(nowMs, serviceTimeZone);
    if (nextDayKey === loadedDayKeyRef.current) return;
    loadedDayKeyRef.current = nextDayKey;
    setLoadedAtMs(nowMs);
    // A new calendar day gets a new automatic context. Explicit selections are
    // retained below when their occurrence is still present in the new window.
    setPinnedOccurrenceId(null);
  }, [serviceTimeZone]);

  useEffect(() => {
    resetStaleSession(authoritativeNowMs);
  }, [authoritativeNowMs, resetStaleSession]);

  useSyncOnReconnect(resetStaleSession);

  const autoOccurrence = useMemo(
    () =>
      occurrences.find(
        (candidate) => candidate.occurrenceId === pinnedOccurrenceId,
      ) || pickCurrentServiceOccurrence(occurrences, authoritativeNowMs),
    [authoritativeNowMs, occurrences, pinnedOccurrenceId],
  );
  // Drops the pin only when it stops being real: the memo above re-picks, and
  // this records that new choice. Setting the id we already hold is a no-op, so
  // this settles after one pass rather than looping.
  useEffect(() => {
    setPinnedOccurrenceId(autoOccurrence?.occurrenceId ?? null);
  }, [autoOccurrence]);

  useEffect(() => {
    if (
      selectedOccurrenceId &&
      !occurrences.some(
        (candidate) => candidate.occurrenceId === selectedOccurrenceId,
      )
    ) {
      setSelectedOccurrenceId(null);
    }
  }, [occurrences, selectedOccurrenceId]);

  const occurrence = useMemo(
    () =>
      occurrences.find(
        (candidate) => candidate.occurrenceId === selectedOccurrenceId,
      ) ||
      autoOccurrence ||
      null,
    [autoOccurrence, occurrences, selectedOccurrenceId],
  );

  const returnToCurrent = useCallback(() => {
    setSelectedOccurrenceId(null);
  }, []);

  return {
    occurrences,
    occurrence,
    selectedOccurrenceId,
    selectOccurrence: setSelectedOccurrenceId,
    returnToCurrent,
  };
};

export default useCurrentServiceOccurrence;
