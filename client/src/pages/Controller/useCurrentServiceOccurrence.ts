/**
 * Owns "which service is the Controller on" for every current-service surface.
 *
 * The pick is made once, when the page loads (or as soon as the services list
 * arrives), and then held. Re-picking on a timer meant a service that ran long
 * could swap the operator onto next week's plan mid-service — exactly the kind
 * of surprise a live surface can't afford. Time still passes, but the answer
 * doesn't change under the operator's hands; they switch services themselves.
 *
 * The pin is dropped only when it stops being real: if the chosen occurrence
 * disappears from the schedule (service deleted, time changed), the next-best
 * service is picked so the surface never sits on a service that no longer runs.
 */
import { useEffect, useMemo, useState } from "react";
import {
  listCurrentServiceOccurrences,
  pickCurrentServiceOccurrence,
} from "./currentServiceWorkspaceUtils";
import type { TeamScheduleOccurrence, TeamService } from "../../api/authTypes";

export type CurrentServiceOccurrence = {
  /** Occurrences the operator can switch between, earliest first. */
  occurrences: TeamScheduleOccurrence[];
  /** The occurrence driving the plan: the operator's pick, else the auto one. */
  occurrence: TeamScheduleOccurrence | null;
  /** Set only once the operator has overridden the automatic pick. */
  selectedOccurrenceId: string | null;
  selectOccurrence: (occurrenceId: string) => void;
};

export const useCurrentServiceOccurrence = (
  services: TeamService[],
): CurrentServiceOccurrence => {
  /** Anchored at mount on purpose: the candidate window shouldn't drift under
   * a session that stays open through a service. */
  const [loadedAtMs] = useState(() => Date.now());
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<
    string | null
  >(null);

  const occurrences = useMemo(
    () => listCurrentServiceOccurrences(services, loadedAtMs),
    [loadedAtMs, services],
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
  const autoOccurrence = useMemo(
    () =>
      occurrences.find(
        (candidate) => candidate.occurrenceId === pinnedOccurrenceId,
      ) || pickCurrentServiceOccurrence(occurrences, loadedAtMs),
    [loadedAtMs, occurrences, pinnedOccurrenceId],
  );
  // Drops the pin only when it stops being real: the memo above re-picks, and
  // this records that new choice. Setting the id we already hold is a no-op, so
  // this settles after one pass rather than looping.
  useEffect(() => {
    setPinnedOccurrenceId(autoOccurrence?.occurrenceId ?? null);
  }, [autoOccurrence]);

  const occurrence = useMemo(
    () =>
      occurrences.find(
        (candidate) => candidate.occurrenceId === selectedOccurrenceId,
      ) ||
      autoOccurrence ||
      null,
    [autoOccurrence, occurrences, selectedOccurrenceId],
  );

  return {
    occurrences,
    occurrence,
    selectedOccurrenceId,
    selectOccurrence: setSelectedOccurrenceId,
  };
};

export default useCurrentServiceOccurrence;
