import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getTeamScheduleDetail,
  getTeamsBootstrap,
  reorderTeamPositions,
  type TeamSchedulePayload,
} from "../../../api/auth";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import { useDispatch, useSelector } from "../../../hooks";
import type { RootState } from "../../../store/store";
import {
  AUTOSAVE_DEBOUNCE_KEYS,
  autosaveIndicatorSlice,
} from "../../../store/autosaveIndicatorSlice";
import { resolveChurchToolbarLogoUrl } from "../../../utils/churchBranding";
import { teamsDataKeys } from "../teamsConstants";
import type { TeamsData, TeamsDataKey, TeamsScheduleDrafts } from "../types";
import {
  buildTeamsDataFromBootstrap,
  emptyData,
  applyTeamEntityDeletionLocally,
  isActive,
  scheduleDraftsMatch,
  sortPositionsByOrder,
  sortTeamsDataKey,
  toTeamService,
  upsertListItem,
} from "../teamsUtils";
import {
  readScheduleDrafts,
  readSelectedScheduleId,
  writeScheduleDrafts,
  writeSelectedScheduleId,
} from "../teamsLocalStore";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import { SCHEDULE_DRAFT_PERSIST_DELAY_MS } from "../schedule/scheduleDraftUtils";
import { normalizeTeamsForSelectors } from "../teamsSelectors";
import { useTeamsLiveSync, type TeamsStreamEvent } from "./useTeamsLiveSync";
import {
  isHydratedSchedule,
  type TeamSchedule,
  type TeamScheduleSummary,
} from "../../../api/authTypes";
import { scheduleDateRangesOverlap } from "../schedule/scheduleConflicts";

// After a local optimistic edit, ignore inbound polls/pushes for this long so a
// slightly-stale server snapshot (or an echo of our own change) can't revert it.
const LOCAL_EDIT_COOLDOWN_MS = 3000;
// Keep the "Syncing…" toolbar chip visible at least this long after the last
// teams save settles, so a fast REST round-trip still registers visually.
const TEAMS_AUTOSAVE_LINGER_MS = 800;

// Structural equality for a teams collection, used to decide whether a polled
// snapshot actually changed before applying it. Preferred over `JSON.stringify`
// comparison: it short-circuits on the first difference (cheaper than
// serializing whole collections on every 15s poll), is insensitive to object
// key order (no false "changed" from server vs. locally-built objects), and —
// unlike an updatedAt/length signature — can never miss a real change. Arrays
// stay order-sensitive, which is correct: collection ordering is meaningful and
// server-stable.
const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    if (arrA.length !== arrB.length) return false;
    for (let i = 0; i < arrA.length; i += 1) {
      if (!deepEqual(arrA[i], arrB[i])) return false;
    }
    return true;
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  if (keysA.length !== Object.keys(objB).length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
    if (!deepEqual(objA[key], objB[key])) return false;
  }
  return true;
};

const teamsDataKeyEquals = (a: unknown, b: unknown) => deepEqual(a, b);

export const useTeamsPageState = () => {
  const context = useContext(GlobalInfoContext);
  const { showToast } = useToast();
  const dispatch = useDispatch();
  const churchId = context?.churchId || "";
  const canEditTeams = Boolean(context?.canEditTeams);
  const canEditTeam = useCallback(
    (teamId: string) => Boolean(context?.canEditTeam?.(teamId)),
    [context],
  );
  const canEditAnyTeam = useMemo(
    () =>
      canEditTeams ||
      Object.values(context?.permissions?.teamScopes || {}).some(
        (permission) => permission === "edit",
      ),
    [canEditTeams, context?.permissions?.teamScopes],
  );
  const sharedServices = useSelector(
    (state: RootState) => state.undoable.present.serviceTimes.list,
  );
  const [data, setData] = useState<TeamsData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  /** Bumped when another admin changes a service plan, so the Plans page can
   * refetch its summary list instead of showing stale "has plan" badges. */
  const [servicePlansRevision, setServicePlansRevision] = useState(0);
  const [scheduleDrafts, setScheduleDrafts] = useState<TeamsScheduleDrafts>({});
  const dataRef = useRef(data);
  const selectedScheduleIdRef = useRef(selectedScheduleId);
  const scheduleDraftsRef = useRef(scheduleDrafts);
  const draftPersistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Latest churchId, read inside async loads to skip stale-church writes after
  // the active church changes mid-request.
  const churchIdRef = useRef(churchId);
  // Timestamp of the last local optimistic edit, used to gate inbound sync.
  const lastLocalEditAtRef = useRef(0);
  // Number of teams saves still in flight (schedule grid, position reorder, …).
  // Schedule assignment saves in particular are serialized and can take longer
  // than the fixed edit cooldown to drain; inbound sync stays gated while any
  // remain so a poll/SSE can't apply a server snapshot missing not-yet-saved
  // edits.
  const pendingTeamsSavesRef = useRef(0);
  // Set while an inbound (poll/SSE) change is being applied so it isn't mistaken
  // for a local edit — applying a remote update must not start the local-edit
  // cooldown (which would needlessly defer further inbound syncs).
  const applyingRemoteRef = useRef(false);
  // Separate in-flight gate for background polling so a silent poll never trips
  // `refresh`'s own dedupe (which keys off refreshInFlightRef + bootstrapLoadRef).
  const backgroundRefreshInFlightRef = useRef(false);
  // Cleared on unmount so a background poll that resolves after the page is gone
  // doesn't apply state (mirrors refresh's isCancelled guard).
  const isMountedRef = useRef(true);
  const deferredRefreshTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  // Drives the global "Synced ⇄ Syncing…" toolbar chip for teams edits. Counts
  // real saves in flight (not cache writes — there is no cache); a single
  // begin/end pair is dispatched per active burst, with a short linger so a fast
  // round-trip is still visible.
  const teamsAutosaveDepthRef = useRef(0);
  const teamsAutosaveActiveRef = useRef(false);
  const teamsAutosaveEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const toolbarLogoUrl = useMemo(
    () => resolveChurchToolbarLogoUrl(context?.churchBranding),
    [context?.churchBranding],
  );
  const churchName = context?.churchName?.trim() || "";

  useEffect(() => {
    churchIdRef.current = churchId;
  }, [churchId]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    selectedScheduleIdRef.current = selectedScheduleId;
  }, [selectedScheduleId]);

  useEffect(() => {
    scheduleDraftsRef.current = scheduleDrafts;
  }, [scheduleDrafts]);

  // Restore per-church local UI state (in-progress drafts + last-selected
  // schedule) from localStorage. This is local-only and synchronous, so it
  // seeds the refs before the REST bootstrap resolves — letting `refresh`
  // preserve the user's last selection. Server data is never read from here.
  useEffect(() => {
    if (!churchId) return;
    const storedDrafts = readScheduleDrafts(churchId);
    scheduleDraftsRef.current = storedDrafts;
    setScheduleDrafts(storedDrafts);
    const storedSelected = readSelectedScheduleId(churchId);
    if (storedSelected) {
      selectedScheduleIdRef.current = storedSelected;
      setSelectedScheduleId(storedSelected);
    }
  }, [churchId]);

  // Show the toolbar autosave chip while teams edits are saving. begin is
  // dispatched once per burst (depth 0→1); end is deferred by a short linger so
  // a fast save still flips the chip visibly, and is cancelled if another save
  // starts during the linger. Driven by real saves (there is no cache to write).
  const beginTeamsAutosave = useCallback(() => {
    teamsAutosaveDepthRef.current += 1;
    if (teamsAutosaveEndTimerRef.current) {
      clearTimeout(teamsAutosaveEndTimerRef.current);
      teamsAutosaveEndTimerRef.current = null;
    }
    if (!teamsAutosaveActiveRef.current) {
      teamsAutosaveActiveRef.current = true;
      dispatch(
        autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
          AUTOSAVE_DEBOUNCE_KEYS.teams,
        ),
      );
    }
  }, [dispatch]);

  const endTeamsAutosave = useCallback(() => {
    teamsAutosaveDepthRef.current = Math.max(
      0,
      teamsAutosaveDepthRef.current - 1,
    );
    if (teamsAutosaveDepthRef.current > 0 || teamsAutosaveEndTimerRef.current) {
      return;
    }
    teamsAutosaveEndTimerRef.current = setTimeout(() => {
      teamsAutosaveEndTimerRef.current = null;
      if (teamsAutosaveActiveRef.current) {
        teamsAutosaveActiveRef.current = false;
        dispatch(
          autosaveIndicatorSlice.actions.endKeyedDebouncedSave(
            AUTOSAVE_DEBOUNCE_KEYS.teams,
          ),
        );
      }
    }, TEAMS_AUTOSAVE_LINGER_MS);
  }, [dispatch]);

  // Balance the indicator on unmount so the global chip can't get stuck on
  // "Syncing…" if the page leaves while a save (or linger) is outstanding.
  useEffect(
    () => () => {
      if (teamsAutosaveEndTimerRef.current) {
        clearTimeout(teamsAutosaveEndTimerRef.current);
        teamsAutosaveEndTimerRef.current = null;
      }
      if (teamsAutosaveActiveRef.current) {
        teamsAutosaveActiveRef.current = false;
        dispatch(
          autosaveIndicatorSlice.actions.endKeyedDebouncedSave(
            AUTOSAVE_DEBOUNCE_KEYS.teams,
          ),
        );
      }
    },
    [dispatch],
  );

  const updateDataLocal = useCallback(
    (updater: (current: TeamsData) => TeamsData) => {
      // Start the inbound-sync cooldown for genuine local edits (not remote
      // applies). The autosave chip is driven by the real save via
      // `trackTeamsSave`, not by this optimistic apply — so "Syncing…" reflects
      // an actual in-flight save rather than flashing after one has completed.
      if (!applyingRemoteRef.current) {
        lastLocalEditAtRef.current = Date.now();
      }
      setData(updater);
    },
    [],
  );

  // Wrap an in-flight teams save (schedule assignments from the grid,
  // position reorders, …) so inbound sync stays gated until it settles: the
  // cooldown stays "hot" for the full drain of the serialized save queue, plus a
  // short tail after the last save lands. Also drives the toolbar autosave chip
  // off the real save lifecycle, so "Syncing…" means a save is actually pending.
  const trackTeamsSave = useCallback(
    <T,>(run: Promise<T>): Promise<T> => {
      pendingTeamsSavesRef.current += 1;
      lastLocalEditAtRef.current = Date.now();
      beginTeamsAutosave();
      run
        .catch(() => undefined)
        .finally(() => {
          pendingTeamsSavesRef.current = Math.max(
            0,
            pendingTeamsSavesRef.current - 1,
          );
          lastLocalEditAtRef.current = Date.now();
          endTeamsAutosave();
        });
      return run;
    },
    [beginTeamsAutosave, endTeamsAutosave],
  );

  const updateSelectedScheduleId = useCallback(
    (scheduleId: string) => {
      // Note: changing which schedule is in view is not a data edit, so it must
      // NOT start the local-edit cooldown — doing so would needlessly block
      // inbound SSE/poll grid updates for a few seconds after every dropdown
      // switch. Only edits to schedule data set lastLocalEditAtRef.
      setSelectedScheduleId(scheduleId);
      selectedScheduleIdRef.current = scheduleId;
      writeSelectedScheduleId(churchId, scheduleId);
    },
    [churchId],
  );

  const persistScheduleDrafts = useCallback(() => {
    if (!canEditAnyTeam) return;
    writeScheduleDrafts(churchId, scheduleDraftsRef.current);
  }, [canEditAnyTeam, churchId]);

  const updateScheduleDraft = useCallback(
    (draftKey: string, draft: TeamSchedulePayload) => {
      if (!canEditAnyTeam) return;
      if (scheduleDraftsMatch(scheduleDraftsRef.current[draftKey], draft)) {
        return;
      }
      scheduleDraftsRef.current = {
        ...scheduleDraftsRef.current,
        [draftKey]: draft,
      };
      // Reflect the write in React state right away so consumers like the
      // schedule form (which seeds from persistedDraft the moment it opens, as
      // happens on "Copy schedule") see it immediately. The localStorage write
      // is debounced below to avoid serializing on every keystroke.
      setScheduleDrafts(scheduleDraftsRef.current);
      if (draftPersistTimeoutRef.current) {
        clearTimeout(draftPersistTimeoutRef.current);
      }
      draftPersistTimeoutRef.current = setTimeout(() => {
        draftPersistTimeoutRef.current = null;
        persistScheduleDrafts();
      }, SCHEDULE_DRAFT_PERSIST_DELAY_MS);
    },
    [canEditAnyTeam, persistScheduleDrafts],
  );

  const flushScheduleDraft = useCallback(
    (draftKey: string, draft: TeamSchedulePayload) => {
      if (!canEditAnyTeam) return;
      if (scheduleDraftsMatch(scheduleDraftsRef.current[draftKey], draft)) {
        if (draftPersistTimeoutRef.current) {
          clearTimeout(draftPersistTimeoutRef.current);
          draftPersistTimeoutRef.current = null;
        }
        return;
      }
      scheduleDraftsRef.current = {
        ...scheduleDraftsRef.current,
        [draftKey]: draft,
      };
      setScheduleDrafts(scheduleDraftsRef.current);
      if (draftPersistTimeoutRef.current) {
        clearTimeout(draftPersistTimeoutRef.current);
        draftPersistTimeoutRef.current = null;
      }
      persistScheduleDrafts();
    },
    [canEditAnyTeam, persistScheduleDrafts],
  );

  // Schedules hydrated on demand this session, kept so a bootstrap refetch (which
  // returns out-of-window schedules as summaries) doesn't blank the open grid.
  const hydratedSchedulesRef = useRef(new Map<string, TeamSchedule>());

  /**
   * Re-applies retained hydration over a freshly fetched schedule list. Fresh
   * summary fields win — only the assignment maps, which the summary omits, are
   * carried over.
   */
  const withRetainedHydration = useCallback(
    (schedules: (TeamSchedule | TeamScheduleSummary)[]) => {
      if (hydratedSchedulesRef.current.size === 0) return schedules;
      return schedules.map((schedule) => {
        if (isHydratedSchedule(schedule)) return schedule;
        const retained = hydratedSchedulesRef.current.get(schedule.scheduleId);
        if (!retained) return schedule;
        const { assignmentsOmitted: _omitted, ...freshSummary } = schedule;
        return { ...retained, ...freshSummary };
      });
    },
    [],
  );

  const refreshInFlightRef = useRef(false);
  // Holds the in-flight bootstrap load so a concurrent/superseding refresh can
  // await it (and resolve `loading` off its result) instead of firing a
  // duplicate request.
  const bootstrapLoadRef = useRef<Promise<void> | null>(null);
  // Warn at most once per session if the server reports a truncated (capped) view.
  const truncationWarnedRef = useRef(false);

  const refresh = useCallback(async (isCancelled: () => boolean = () => false) => {
    if (!churchId) {
      if (!isCancelled()) setLoading(false);
      return;
    }
    // If a bootstrap load is already running, don't fire a second one. Wait for
    // it and then resolve our own loading state off its result. This keeps
    // `loading` from getting stranded when an in-flight refresh is superseded by
    // a re-run — e.g. StrictMode's mount/cleanup/mount, or a dependency settling
    // mid-load — where the original (now "cancelled") call would otherwise never
    // clear loading and the re-run would bail without doing anything.
    if (refreshInFlightRef.current) {
      const pending = bootstrapLoadRef.current;
      try {
        if (pending) await pending;
      } catch {
        // The owning refresh surfaces its own error toast; we only mirror the
        // loading state here.
      } finally {
        if (!isCancelled()) setLoading(false);
      }
      return;
    }

    refreshInFlightRef.current = true;
    // The fetch + state application runs to completion independently of any
    // single caller's cancellation, so the data still lands when a superseding
    // re-run is waiting on it. Stale writes after a real church switch are
    // guarded by comparing against the latest churchId instead.
    const load = (async () => {
      const response = await getTeamsBootstrap(churchId);
      if (churchIdRef.current !== churchId) return;
      const nextData = buildTeamsDataFromBootstrap(response);
      nextData.schedules = withRetainedHydration(nextData.schedules);
      const nextSelectedScheduleId =
        selectedScheduleIdRef.current &&
        nextData.schedules.some(
          (schedule) => schedule.scheduleId === selectedScheduleIdRef.current,
        )
          ? selectedScheduleIdRef.current
          : nextData.schedules.find(isActive)?.scheduleId ||
            nextData.schedules[0]?.scheduleId ||
            "";
      setData(nextData);
      setSelectedScheduleId(nextSelectedScheduleId);
      selectedScheduleIdRef.current = nextSelectedScheduleId;
      // Keep localStorage in step when the bootstrap falls back to a different
      // schedule (e.g. the persisted one no longer exists), so a reload doesn't
      // briefly restore a stale id.
      writeSelectedScheduleId(churchId, nextSelectedScheduleId);
      if (response.truncated && !truncationWarnedRef.current) {
        truncationWarnedRef.current = true;
        showToast(
          "This church has more teams data than we can load at once, so some rows may be missing. Please contact support.",
          "neutral",
        );
      }
    })();
    bootstrapLoadRef.current = load;

    try {
      await load;
    } catch (error) {
      if (!isCancelled()) {
        showApiErrorToast(showToast, error, "Could not load teams.");
      }
    } finally {
      refreshInFlightRef.current = false;
      bootstrapLoadRef.current = null;
      if (!isCancelled()) setLoading(false);
    }
  }, [churchId, showToast, withRetainedHydration]);

  useEffect(() => {
    let cancelled = false;
    void refresh(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const upsertData = useCallback(
    <K extends keyof TeamsData>(
      key: K,
      idField: string,
      item: TeamsData[K][number],
      replaceId?: string,
    ) => {
      updateDataLocal((current) => {
        const list = current[key];
        return {
          ...current,
          [key]: sortTeamsDataKey(
            key,
            upsertListItem(
              list as Record<string, unknown>[],
              idField,
              item as Record<string, unknown>,
              replaceId,
            ) as TeamsData[K],
          ),
        };
      });
    },
    [updateDataLocal],
  );

  const removeData = useCallback(
    <K extends keyof TeamsData>(key: K, _idField: string, id: string) => {
      updateDataLocal((current) =>
        applyTeamEntityDeletionLocally(current, key as TeamsDataKey, id),
      );
    },
    [updateDataLocal],
  );

  // Persist a new position order for one team. Optimistically renumbers the
  // affected positions (and re-sorts the list so schedule columns follow), then
  // calls the API and reverts on failure.
  const reorderPositions = useCallback(
    async (teamId: string, orderedPositionIds: string[]) => {
      if (!canEditAnyTeam || !canEditTeam(teamId)) return;
      const previousPositions = dataRef.current.positions;
      const orderById = new Map(
        orderedPositionIds.map((positionId, index) => [positionId, index]),
      );
      updateDataLocal((current) => ({
        ...current,
        positions: sortPositionsByOrder(
          current.positions.map((position) =>
            orderById.has(position.positionId)
              ? { ...position, order: orderById.get(position.positionId) }
              : position,
          ),
        ),
      }));
      try {
        // Gate inbound sync on the real save (same as schedule edits) so a slow
        // reorder can't be reverted by a poll landing mid-request.
        await trackTeamsSave(
          reorderTeamPositions(churchId, {
            teamId,
            positionIds: orderedPositionIds,
          }),
        );
      } catch (error) {
        updateDataLocal((current) => ({ ...current, positions: previousPositions }));
        showApiErrorToast(showToast, error, "Could not reorder positions.");
      }
    },
    [
      canEditAnyTeam,
      canEditTeam,
      churchId,
      showToast,
      trackTeamsSave,
      updateDataLocal,
    ],
  );

  // True while a local optimistic edit is still settling, or while any teams
  // save is still in flight. Inbound syncs are held off in this window so they
  // can't revert the edit (or an echo of it), or apply a server snapshot that
  // predates a still-pending save.
  const isLocalEditCoolingDown = useCallback(
    () =>
      pendingTeamsSavesRef.current > 0 ||
      Date.now() - lastLocalEditAtRef.current < LOCAL_EDIT_COOLDOWN_MS,
    [],
  );

  // Silent background re-fetch used by polling and (as a fallback) by the live
  // channel. Unlike `refresh`, it never toggles `loading`, diff-gates so it
  // stays a no-op when nothing changed, and bails out while a local edit is
  // settling so it can't clobber optimistic state.
  const backgroundRefresh = useCallback(async () => {
    if (!churchId) return;
    // Don't pile onto a full (loading) refresh, and don't run two polls at once.
    // A poll uses its own in-flight gate so it never trips `refresh`'s dedupe
    // (which keys off refreshInFlightRef + bootstrapLoadRef): otherwise a poll
    // in flight during a church switch would make refresh skip the real load.
    if (refreshInFlightRef.current || backgroundRefreshInFlightRef.current) return;
    if (isLocalEditCoolingDown()) return;
    backgroundRefreshInFlightRef.current = true;
    try {
      const response = await getTeamsBootstrap(churchId);
      // Bail on stale writes: the page may have unmounted, the active church may
      // have switched, or a local edit may have landed while the request was in
      // flight.
      if (!isMountedRef.current) return;
      if (churchIdRef.current !== churchId) return;
      if (isLocalEditCoolingDown()) return;
      const nextData = buildTeamsDataFromBootstrap(response);
      nextData.schedules = withRetainedHydration(nextData.schedules);
      const changedKeys = teamsDataKeys.filter(
        (key) => !teamsDataKeyEquals(dataRef.current[key], nextData[key]),
      );
      if (changedKeys.length === 0) return;
      setData((current) => {
        let merged = current;
        changedKeys.forEach((key) => {
          merged = { ...merged, [key]: nextData[key] };
        });
        return merged;
      });
      if (changedKeys.includes("schedules")) {
        const current = selectedScheduleIdRef.current;
        const nextSelectedScheduleId =
          current &&
          nextData.schedules.some((schedule) => schedule.scheduleId === current)
            ? current
            : nextData.schedules.find(isActive)?.scheduleId ||
              nextData.schedules[0]?.scheduleId ||
              "";
        setSelectedScheduleId(nextSelectedScheduleId);
        selectedScheduleIdRef.current = nextSelectedScheduleId;
        writeSelectedScheduleId(churchId, nextSelectedScheduleId);
      }
    } catch (error) {
      // Background sync failures are non-fatal: the next poll, focus, or manual
      // refresh recovers. Stay silent so we don't toast on a repeating timer.
      console.error("Could not background-sync teams.", error);
    } finally {
      backgroundRefreshInFlightRef.current = false;
    }
  }, [churchId, isLocalEditCoolingDown, withRetainedHydration]);

  // Merge server-hydrated schedules over their summaries in place, keeping list
  // order stable so the picker and grid don't reshuffle when hydration lands.
  const mergeHydratedSchedules = useCallback(
    (hydrated: TeamSchedule[]) => {
      if (hydrated.length === 0) return;
      const byId = new Map(
        hydrated.map((schedule) => [schedule.scheduleId, schedule]),
      );
      hydrated.forEach((schedule) => {
        hydratedSchedulesRef.current.set(schedule.scheduleId, schedule);
      });
      // A hydration response is remote data, not a local edit: applying it must
      // not start the inbound-sync cooldown.
      applyingRemoteRef.current = true;
      try {
        updateDataLocal((current) => {
          let changed = false;
          const schedules = current.schedules.map((schedule) => {
            const next = byId.get(schedule.scheduleId);
            if (!next) return schedule;
            changed = true;
            return next;
          });
          return changed ? { ...current, schedules } : current;
        });
      } finally {
        applyingRemoteRef.current = false;
      }
    },
    [updateDataLocal],
  );

  // Schedules whose hydration is already done or in flight, so re-selecting one
  // (or a re-render) doesn't refetch. Cleared on church switch.
  const hydratedScheduleIdsRef = useRef(new Set<string>());
  const [hydratingScheduleId, setHydratingScheduleId] = useState("");
  /** Ids `hydrateSchedules` is currently fetching, so a surface reading their
   * cells can say "loading" instead of rendering an empty roster. */
  const [hydratingScheduleIds, setHydratingScheduleIds] = useState<string[]>([]);

  useEffect(() => {
    hydratedScheduleIdsRef.current = new Set<string>();
  }, [churchId]);

  /**
   * Fetch assignment maps for schedules the bootstrap only summarized.
   *
   * The grid hydrates whatever schedule is open (below); this is for the
   * surfaces that read one date's cells without opening a grid at all — the
   * plan's "Who's serving" panel and its microphone rows. The hydration window
   * is roughly a month back and two forward, so a plan outside it would
   * otherwise render an empty roster that looks exactly like nobody being
   * scheduled.
   *
   * Deduped through the same ref the grid uses, so opening a plan and then its
   * schedule doesn't fetch twice. A failed id is released for a later retry.
   */
  const hydrateSchedules = useCallback(
    async (scheduleIds: string[]) => {
      const churchIdAtStart = churchIdRef.current;
      const pending = scheduleIds.filter(
        (scheduleId) =>
          scheduleId && !hydratedScheduleIdsRef.current.has(scheduleId),
      );
      if (!pending.length || !churchIdAtStart) return;
      pending.forEach((scheduleId) =>
        hydratedScheduleIdsRef.current.add(scheduleId));
      setHydratingScheduleIds((current) => [...current, ...pending]);
      try {
        const results = await Promise.allSettled(
          pending.map((scheduleId) =>
            getTeamScheduleDetail(churchIdAtStart, scheduleId)),
        );
        if (!isMountedRef.current || churchIdRef.current !== churchIdAtStart) {
          return;
        }
        // One schedule failing must not discard the ones that arrived — a
        // partly-loaded roster still beats a blank one.
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            hydratedScheduleIdsRef.current.delete(pending[index]);
          }
        });
        mergeHydratedSchedules(
          results.flatMap((result) =>
            result.status === "fulfilled"
              ? [result.value.schedule, ...(result.value.relatedSchedules || [])]
              : []),
        );
        if (results.some((result) => result.status === "rejected")) {
          showToast("Could not load this date's assignments.", "error");
        }
      } finally {
        if (isMountedRef.current) {
          setHydratingScheduleIds((current) =>
            current.filter((scheduleId) => !pending.includes(scheduleId)));
        }
      }
    },
    [mergeHydratedSchedules, showToast],
  );

  // Hydrate the open schedule on demand. The bootstrap only ships assignment
  // maps for schedules near today, so opening an older or further-out one
  // fetches its cells — plus the overlapping other-team schedules the grid needs
  // for cross-team conflict warnings. Even when the open schedule was included
  // in full, fetch its detail if an overlapping other-team schedule is only a
  // summary: Auto-fill must not plan with incomplete conflict data.
  useEffect(() => {
    if (!churchId || !selectedScheduleId) return undefined;
    if (hydratedScheduleIdsRef.current.has(selectedScheduleId)) return undefined;
    const selected = data.schedules.find(
      (schedule) => schedule.scheduleId === selectedScheduleId,
    );
    if (!selected) return undefined;
    const hasUnhydratedOverlappingTeamSchedule = data.schedules.some(
      (schedule) =>
        schedule.scheduleId !== selected.scheduleId &&
        schedule.teamId !== selected.teamId &&
        !schedule.archivedAt &&
        !isHydratedSchedule(schedule) &&
        scheduleDateRangesOverlap(selected, schedule),
    );
    if (
      isHydratedSchedule(selected) &&
      !hasUnhydratedOverlappingTeamSchedule
    ) {
      return undefined;
    }

    let cancelled = false;
    hydratedScheduleIdsRef.current.add(selectedScheduleId);
    setHydratingScheduleId(selectedScheduleId);
    (async () => {
      try {
        const response = await getTeamScheduleDetail(churchId, selectedScheduleId);
        if (cancelled || !isMountedRef.current) return;
        if (churchIdRef.current !== churchId) return;
        mergeHydratedSchedules([
          response.schedule,
          ...(response.relatedSchedules || []),
        ]);
      } catch (error) {
        // Allow a retry on the next selection rather than stranding the grid on
        // a summary forever.
        hydratedScheduleIdsRef.current.delete(selectedScheduleId);
        if (cancelled || !isMountedRef.current) return;
        showApiErrorToast(showToast, error, "Could not load this schedule.");
      } finally {
        if (!cancelled && isMountedRef.current) setHydratingScheduleId("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    churchId,
    data.schedules,
    mergeHydratedSchedules,
    selectedScheduleId,
    showToast,
  ]);

  // Run a guarded background refresh once the local-edit cooldown clears. Used
  // when a live event arrives mid-edit and we defer applying it.
  const scheduleDeferredBackgroundRefresh = useCallback(() => {
    if (deferredRefreshTimeoutRef.current) return;
    deferredRefreshTimeoutRef.current = setTimeout(() => {
      deferredRefreshTimeoutRef.current = null;
      void backgroundRefresh();
    }, LOCAL_EDIT_COOLDOWN_MS);
  }, [backgroundRefresh]);

  // Apply a pushed scheduling-grid change from another admin. The event carries
  // the full schedule doc, so we merge it straight into state via the same
  // upsert/remove paths a local save uses — no refetch needed.
  const applyTeamsStreamEvent = useCallback(
    (event: TeamsStreamEvent) => {
      if (event.type === "schedule-updated" && "schedule" in event && event.schedule) {
        if (isLocalEditCoolingDown()) {
          scheduleDeferredBackgroundRefresh();
          return;
        }
        applyingRemoteRef.current = true;
        try {
          upsertData("schedules", "scheduleId", event.schedule as TeamSchedule);
        } finally {
          applyingRemoteRef.current = false;
        }
        return;
      }
      if (event.type === "schedule-removed" && "scheduleId" in event && event.scheduleId) {
        if (isLocalEditCoolingDown()) {
          scheduleDeferredBackgroundRefresh();
          return;
        }
        const removedId = event.scheduleId as string;
        applyingRemoteRef.current = true;
        try {
          removeData("schedules", "scheduleId", removedId);
        } finally {
          applyingRemoteRef.current = false;
        }
        // Another admin removed/archived this schedule. If it was the one we had
        // open, move to another active one so the grid doesn't strand on a
        // now-missing id (mirrors backgroundRefresh's reselection).
        if (selectedScheduleIdRef.current === removedId) {
          const remaining = dataRef.current.schedules.filter(
            (schedule) => schedule.scheduleId !== removedId,
          );
          const nextSelectedScheduleId =
            remaining.find(isActive)?.scheduleId ||
            remaining[0]?.scheduleId ||
            "";
          setSelectedScheduleId(nextSelectedScheduleId);
          selectedScheduleIdRef.current = nextSelectedScheduleId;
          writeSelectedScheduleId(churchIdRef.current, nextSelectedScheduleId);
        }
        return;
      }
      // Service plans aren't part of TeamsData — the Plans page keeps its own
      // summary list — so just bump a revision the page can watch to refetch,
      // rather than trying to merge the plan into this dataset.
      if (
        event.type === "service-plan-updated" ||
        event.type === "service-plan-removed"
      ) {
        setServicePlansRevision((current) => current + 1);
      }
    },
    [
      isLocalEditCoolingDown,
      removeData,
      scheduleDeferredBackgroundRefresh,
      upsertData,
    ],
  );

  useTeamsLiveSync(churchId, applyTeamsStreamEvent);

  // Refresh when the Teams tab regains focus/visibility so changes that occurred
  // while it was inactive are recovered without repeatedly reloading the full
  // bootstrap while the tab remains open. Schedule changes still arrive through
  // the Teams SSE channel.
  useEffect(() => {
    if (!churchId) return undefined;
    const handleVisible = () => {
      if (document.visibilityState === "visible") void backgroundRefresh();
    };
    window.addEventListener("focus", handleVisible);
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      window.removeEventListener("focus", handleVisible);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [backgroundRefresh, churchId]);

  useEffect(() => {
    // Set in the effect body (not just init) so a StrictMode/remount re-run
    // restores it after the prior cleanup flipped it false.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (deferredRefreshTimeoutRef.current) {
        clearTimeout(deferredRefreshTimeoutRef.current);
      }
    };
  }, []);

  const pageData = useMemo(
    () => ({
      ...data,
      services: sharedServices.map(toTeamService),
    }),
    [data, sharedServices],
  );
  const normalizedPageData = useMemo(
    () => normalizeTeamsForSelectors(pageData),
    [pageData],
  );

  return {
    loading,
    canEditTeams,
    canEditAnyTeam,
    canEditTeam,
    pageData,
    normalizedPageData,
    servicePlansRevision,
    selectedScheduleId,
    /** Non-empty while the open schedule's assignments are being fetched. */
    hydratingScheduleId,
    hydrateSchedules,
    /** Ids `hydrateSchedules` is fetching right now. */
    hydratingScheduleIds,
    scheduleDrafts,
    upsertData,
    removeData,
    reorderPositions,
    trackTeamsSave,
    refresh,
    updateSelectedScheduleId,
    updateScheduleDraft,
    flushScheduleDraft,
    toolbarLogoUrl,
    churchName,
  };
};
