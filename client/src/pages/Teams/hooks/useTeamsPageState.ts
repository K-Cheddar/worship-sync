import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getTeamsBootstrap,
  reorderTeamPositions,
  type TeamSchedulePayload,
} from "../../../api/auth";
import {
  ControllerInfoContext,
  globalDb,
} from "../../../context/controllerInfo";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useToast } from "../../../context/toastContext";
import { useGlobalBroadcast } from "../../../hooks/useGlobalBroadcast";
import { useDispatch, useSelector } from "../../../hooks";
import type { RootState } from "../../../store/store";
import {
  AUTOSAVE_DEBOUNCE_KEYS,
  autosaveIndicatorSlice,
} from "../../../store/autosaveIndicatorSlice";
import { resolveChurchToolbarLogoUrl } from "../../../utils/churchBranding";
import { teamsDataKeys } from "../teamsConstants";
import {
  isNewerTeamsDoc,
  isPouchNotFoundError,
  isTeamsPouchDoc,
  loadTeamsPouchDocs,
  persistTeamsDataDoc,
  persistTeamsDraftsDoc,
  persistTeamsMetaDoc,
} from "../teamsPouch";
import type {
  TeamsData,
  TeamsDataKey,
  TeamsPouchDoc,
  TeamsScheduleDrafts,
} from "../types";
import {
  buildTeamsDataFromBootstrap,
  emptyData,
  applyTeamEntityDeletionLocally,
  isActive,
  normalizeTeamsData,
  normalizeTeamsDataKey,
  scheduleDraftsMatch,
  sortPositionsByOrder,
  toTeamService,
  upsertListItem,
} from "../teamsUtils";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import { SCHEDULE_DRAFT_PERSIST_DELAY_MS } from "../schedule/scheduleDraftUtils";
import { normalizeTeamsForSelectors } from "../teamsSelectors";
import { useTeamsLiveSync, type TeamsStreamEvent } from "./useTeamsLiveSync";
import type { TeamSchedule } from "../../../api/authTypes";

// How often to re-fetch the full teams bootstrap to catch other admins' changes
// to the slower-moving collections (members, positions, teams, services, …).
// The scheduling grid gets near-instant updates via the SSE channel instead.
const BACKGROUND_POLL_INTERVAL_MS = 15000;
// After a local optimistic edit, ignore inbound polls/pushes for this long so a
// slightly-stale server snapshot (or an echo of our own change) can't revert it.
const LOCAL_EDIT_COOLDOWN_MS = 3000;

// Structural equality for a teams collection, used to decide whether a polled
// snapshot actually changed before applying/persisting it. Preferred over
// `JSON.stringify` comparison: it short-circuits on the first difference (cheaper
// than serializing whole collections on every 15s poll), is insensitive to
// object key order (no false "changed" from server vs. locally-built objects),
// and — unlike an updatedAt/length signature — can never miss a real change.
// Arrays stay order-sensitive, which is correct: collection ordering is
// meaningful and server-stable.
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
  const controllerContext = useContext(ControllerInfoContext);
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
  const teamsDb = controllerContext?.db || globalDb;
  const sharedServices = useSelector(
    (state: RootState) => state.undoable.present.serviceTimes.list,
  );
  const [data, setData] = useState<TeamsData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [lastRemoteSyncAt, setLastRemoteSyncAt] = useState<
    string | undefined
  >();
  const [scheduleDrafts, setScheduleDrafts] = useState<TeamsScheduleDrafts>({});
  const dataRef = useRef(data);
  const selectedScheduleIdRef = useRef(selectedScheduleId);
  const lastRemoteSyncAtRef = useRef(lastRemoteSyncAt);
  const scheduleDraftsRef = useRef(scheduleDrafts);
  const dataDocUpdatedAtRef = useRef<Partial<Record<TeamsDataKey, string>>>({});
  const metaDocUpdatedAtRef = useRef<string | undefined>(undefined);
  const draftsDocUpdatedAtRef = useRef<string | undefined>(undefined);
  const dataPersistPromiseRef = useRef<Promise<unknown>>(Promise.resolve());
  const draftPersistPromiseRef = useRef<Promise<unknown>>(Promise.resolve());
  const draftPersistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Latest churchId, read inside async loads to skip stale-church writes after
  // the active church changes mid-request.
  const churchIdRef = useRef(churchId);
  // Timestamp of the last local optimistic edit, used to gate inbound sync.
  const lastLocalEditAtRef = useRef(0);
  // Set while an inbound (poll/SSE) change is being applied so it isn't mistaken
  // for a local edit — applying a remote update must not start the local-edit
  // cooldown (which would needlessly defer further inbound syncs).
  const applyingRemoteRef = useRef(false);
  // Separate in-flight gate for background polling so a silent poll never trips
  // `refresh`'s own dedupe (which keys off refreshInFlightRef + bootstrapLoadRef).
  const backgroundRefreshInFlightRef = useRef(false);
  const deferredRefreshTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
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
    lastRemoteSyncAtRef.current = lastRemoteSyncAt;
  }, [lastRemoteSyncAt]);

  useEffect(() => {
    scheduleDraftsRef.current = scheduleDrafts;
  }, [scheduleDrafts]);

  const applyTeamsDoc = useCallback(
    (doc: TeamsPouchDoc) => {
      if (doc.churchId !== churchId) return;
      if (doc.docType === "teams-cache") {
        if (!isNewerTeamsDoc(metaDocUpdatedAtRef.current, doc.updatedAt))
          return;
        metaDocUpdatedAtRef.current = doc.updatedAt;
        teamsDataKeys.forEach((key) => {
          dataDocUpdatedAtRef.current[key] = doc.updatedAt;
        });
        draftsDocUpdatedAtRef.current = doc.updatedAt;
        const nextData = normalizeTeamsData(doc.data);
        setData(nextData);
        scheduleDraftsRef.current = doc.scheduleDrafts || {};
        setScheduleDrafts(doc.scheduleDrafts || {});
        setLastRemoteSyncAt(doc.lastRemoteSyncAt);
        setSelectedScheduleId((current) =>
          current &&
          nextData.schedules.some((schedule) => schedule.scheduleId === current)
            ? current
            : doc.selectedScheduleId ||
              nextData.schedules.find(isActive)?.scheduleId ||
              nextData.schedules[0]?.scheduleId ||
              "",
        );
        return;
      }

      if (doc.docType === "teams-data") {
        if (
          !isNewerTeamsDoc(dataDocUpdatedAtRef.current[doc.key], doc.updatedAt)
        )
          return;
        dataDocUpdatedAtRef.current[doc.key] = doc.updatedAt;
        setData((current) => ({
          ...current,
          [doc.key]: normalizeTeamsDataKey(doc.key, doc.items),
        }));
        return;
      }

      if (doc.docType === "teams-meta") {
        if (!isNewerTeamsDoc(metaDocUpdatedAtRef.current, doc.updatedAt))
          return;
        metaDocUpdatedAtRef.current = doc.updatedAt;
        setLastRemoteSyncAt(doc.lastRemoteSyncAt);
        setSelectedScheduleId(
          (current) => current || doc.selectedScheduleId || "",
        );
        return;
      }

      if (doc.docType === "teams-drafts") {
        if (!isNewerTeamsDoc(draftsDocUpdatedAtRef.current, doc.updatedAt))
          return;
        draftsDocUpdatedAtRef.current = doc.updatedAt;
        scheduleDraftsRef.current = doc.scheduleDrafts || {};
        setScheduleDrafts(doc.scheduleDrafts || {});
        return;
      }
    },
    [churchId],
  );

  // Persist the cache to Pouch in the background. Only the keys that actually
  // changed are written, so a single edit touches one doc (and broadcasts once)
  // instead of rewriting all nine collections on every change. The UI itself
  // updates synchronously via setData, so this never gates the optimistic render.
  const persistTeamsDataSnapshot = useCallback(
    (nextData: TeamsData, keys: TeamsDataKey[] = teamsDataKeys) => {
      if (!teamsDb || !churchId || !canEditAnyTeam || keys.length === 0) return;
      dispatch(
        autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
          AUTOSAVE_DEBOUNCE_KEYS.teams,
        ),
      );
      dataPersistPromiseRef.current = dataPersistPromiseRef.current
        .catch(() => undefined)
        .then(() =>
          Promise.all(
            keys.map((key) =>
              persistTeamsDataDoc(teamsDb, churchId, key, nextData[key]),
            ),
          ),
        )
        .catch((error) => {
          console.error("Could not persist teams cache.", error);
        })
        .finally(() => {
          dispatch(
            autosaveIndicatorSlice.actions.endKeyedDebouncedSave(
              AUTOSAVE_DEBOUNCE_KEYS.teams,
            ),
          );
        });
    },
    [canEditAnyTeam, churchId, dispatch, teamsDb],
  );

  const updateDataLocal = useCallback(
    (updater: (current: TeamsData) => TeamsData) => {
      if (!applyingRemoteRef.current) {
        lastLocalEditAtRef.current = Date.now();
      }
      setData((current) => {
        const nextData = updater(current);
        const changedKeys = teamsDataKeys.filter(
          (key) => current[key] !== nextData[key],
        );
        persistTeamsDataSnapshot(nextData, changedKeys);
        return nextData;
      });
    },
    [persistTeamsDataSnapshot],
  );

  const updateSelectedScheduleId = useCallback(
    (scheduleId: string) => {
      // Note: changing which schedule is in view is not a data edit, so it must
      // NOT start the local-edit cooldown — doing so would needlessly block
      // inbound SSE/poll grid updates for a few seconds after every dropdown
      // switch. Only edits to schedule data set lastLocalEditAtRef.
      setSelectedScheduleId(scheduleId);
      if (teamsDb && churchId && canEditAnyTeam) {
        dispatch(
          autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
            AUTOSAVE_DEBOUNCE_KEYS.teams,
          ),
        );
        void persistTeamsMetaDoc(teamsDb, {
          churchId,
          selectedScheduleId: scheduleId,
          lastRemoteSyncAt: lastRemoteSyncAtRef.current,
        })
          .catch((error) => {
            console.error("Could not persist teams selection.", error);
          })
          .finally(() => {
            dispatch(
              autosaveIndicatorSlice.actions.endKeyedDebouncedSave(
                AUTOSAVE_DEBOUNCE_KEYS.teams,
              ),
            );
          });
      }
    },
    [canEditAnyTeam, churchId, dispatch, teamsDb],
  );

  const persistScheduleDraftsToPouch = useCallback(() => {
    if (!teamsDb || !churchId || !canEditAnyTeam) return;
    dispatch(
      autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
        AUTOSAVE_DEBOUNCE_KEYS.teams,
      ),
    );
    draftPersistPromiseRef.current = draftPersistPromiseRef.current
      .catch(() => undefined)
      .then(() =>
        persistTeamsDraftsDoc(teamsDb, churchId, scheduleDraftsRef.current),
      )
      .catch((error) => {
        console.error("Could not persist schedule draft.", error);
      })
      .finally(() => {
        dispatch(
          autosaveIndicatorSlice.actions.endKeyedDebouncedSave(
            AUTOSAVE_DEBOUNCE_KEYS.teams,
          ),
        );
      });
  }, [canEditAnyTeam, churchId, dispatch, teamsDb]);

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
      // Reflect the write in React state right away. The Pouch change feed is the
      // only other path that updates this state, and it's async — consumers like
      // the schedule form (which seeds from persistedDraft the moment it opens, as
      // happens on "Copy schedule") must not have to wait for that round-trip.
      setScheduleDrafts(scheduleDraftsRef.current);
      if (draftPersistTimeoutRef.current) {
        clearTimeout(draftPersistTimeoutRef.current);
      }
      draftPersistTimeoutRef.current = setTimeout(() => {
        draftPersistTimeoutRef.current = null;
        persistScheduleDraftsToPouch();
      }, SCHEDULE_DRAFT_PERSIST_DELAY_MS);
    },
    [canEditAnyTeam, persistScheduleDraftsToPouch],
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
      persistScheduleDraftsToPouch();
    },
    [canEditAnyTeam, persistScheduleDraftsToPouch],
  );

  const refreshInFlightRef = useRef(false);
  // Holds the in-flight bootstrap load so a concurrent/superseding refresh can
  // await it (and resolve `loading` off its result) instead of firing a
  // duplicate request.
  const bootstrapLoadRef = useRef<Promise<void> | null>(null);
  // Warn at most once per session if the server reports a truncated (capped) view.
  const truncationWarnedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const loadLocalTeamsDoc = async () => {
      if (!teamsDb || !churchId) {
        setLoading(false);
        return;
      }
      try {
        const docs = await loadTeamsPouchDocs(teamsDb);
        if (!cancelled) {
          docs.forEach((doc) => {
            if (doc && isTeamsPouchDoc(doc)) applyTeamsDoc(doc);
          });
        }
      } catch (error) {
        if (!isPouchNotFoundError(error)) {
          console.error("Could not load teams cache.", error);
        }
      }
    };

    setLoading(true);
    void loadLocalTeamsDoc();
    return () => {
      cancelled = true;
    };
  }, [applyTeamsDoc, churchId, teamsDb]);

  useGlobalBroadcast((event) => {
    const docs = (event.detail || []) as unknown[];
    const doc = docs.find(isTeamsPouchDoc);
    if (doc) applyTeamsDoc(doc);
  }, 100);

  useEffect(() => {
    const updater = controllerContext?.updater;
    if (!updater) return undefined;
    const handleUpdate = (event: Event) => {
      const docs = ((event as CustomEvent).detail || []) as unknown[];
      const doc = docs.find(isTeamsPouchDoc);
      if (doc) applyTeamsDoc(doc);
    };
    updater.addEventListener("update", handleUpdate);
    return () => updater.removeEventListener("update", handleUpdate);
  }, [applyTeamsDoc, controllerContext?.updater]);

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
      const nextSelectedScheduleId =
        selectedScheduleIdRef.current &&
        nextData.schedules.some(
          (schedule) => schedule.scheduleId === selectedScheduleIdRef.current,
        )
          ? selectedScheduleIdRef.current
          : nextData.schedules.find(isActive)?.scheduleId ||
            nextData.schedules[0]?.scheduleId ||
            "";
      const syncedAt = new Date().toISOString();
      teamsDataKeys.forEach((key) => {
        dataDocUpdatedAtRef.current[key] = syncedAt;
      });
      metaDocUpdatedAtRef.current = syncedAt;
      setData(nextData);
      setLastRemoteSyncAt(syncedAt);
      setSelectedScheduleId(nextSelectedScheduleId);
      if (response.truncated && !truncationWarnedRef.current) {
        truncationWarnedRef.current = true;
        showToast(
          "This church has more teams data than we can load at once, so some rows may be missing. Please contact support.",
          "neutral",
        );
      }
      persistTeamsDataSnapshot(nextData);
      if (teamsDb && canEditAnyTeam) {
        dispatch(
          autosaveIndicatorSlice.actions.beginKeyedDebouncedSave(
            AUTOSAVE_DEBOUNCE_KEYS.teams,
          ),
        );
        void persistTeamsMetaDoc(teamsDb, {
          churchId,
          selectedScheduleId: nextSelectedScheduleId,
          lastRemoteSyncAt: syncedAt,
        })
          .catch((error) => {
            console.error("Could not persist teams metadata.", error);
          })
          .finally(() => {
            dispatch(
              autosaveIndicatorSlice.actions.endKeyedDebouncedSave(
                AUTOSAVE_DEBOUNCE_KEYS.teams,
              ),
            );
          });
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
  }, [canEditAnyTeam, churchId, dispatch, persistTeamsDataSnapshot, showToast, teamsDb]);

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
          [key]: upsertListItem(
            list as Record<string, unknown>[],
            idField,
            item as Record<string, unknown>,
            replaceId,
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
        await reorderTeamPositions(churchId, {
          teamId,
          positionIds: orderedPositionIds,
        });
      } catch (error) {
        updateDataLocal((current) => ({ ...current, positions: previousPositions }));
        showApiErrorToast(showToast, error, "Could not reorder positions.");
      }
    },
    [canEditAnyTeam, canEditTeam, churchId, showToast, updateDataLocal],
  );

  // True while a local optimistic edit is still settling. Inbound syncs are
  // held off during this window so they can't revert the edit (or an echo of it).
  const isLocalEditCoolingDown = useCallback(
    () => Date.now() - lastLocalEditAtRef.current < LOCAL_EDIT_COOLDOWN_MS,
    [],
  );

  // Silent background re-fetch used by polling and (as a fallback) by the live
  // channel. Unlike `refresh`, it never toggles `loading`, diff-gates so the
  // "Syncing…" indicator stays quiet when nothing changed, and bails out while a
  // local edit is settling so it can't clobber optimistic state.
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
      // Bail on stale writes: the active church may have switched, or a local
      // edit may have landed, while the request was in flight.
      if (churchIdRef.current !== churchId) return;
      if (isLocalEditCoolingDown()) return;
      const nextData = buildTeamsDataFromBootstrap(response);
      const changedKeys = teamsDataKeys.filter(
        (key) => !teamsDataKeyEquals(dataRef.current[key], nextData[key]),
      );
      if (changedKeys.length === 0) return;
      const syncedAt = new Date().toISOString();
      changedKeys.forEach((key) => {
        dataDocUpdatedAtRef.current[key] = syncedAt;
      });
      setData((current) => {
        let merged = current;
        changedKeys.forEach((key) => {
          merged = { ...merged, [key]: nextData[key] };
        });
        return merged;
      });
      if (changedKeys.includes("schedules")) {
        setSelectedScheduleId((current) =>
          current &&
          nextData.schedules.some((schedule) => schedule.scheduleId === current)
            ? current
            : nextData.schedules.find(isActive)?.scheduleId ||
              nextData.schedules[0]?.scheduleId ||
              "",
        );
      }
      persistTeamsDataSnapshot(nextData, changedKeys);
    } catch (error) {
      // Background sync failures are non-fatal: the next poll, focus, or manual
      // refresh recovers. Stay silent so we don't toast on a repeating timer.
      console.error("Could not background-sync teams.", error);
    } finally {
      backgroundRefreshInFlightRef.current = false;
    }
  }, [churchId, isLocalEditCoolingDown, persistTeamsDataSnapshot]);

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
          setSelectedScheduleId(
            remaining.find(isActive)?.scheduleId ||
              remaining[0]?.scheduleId ||
              "",
          );
        }
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

  // Poll the bootstrap on an interval (only while the tab is visible) and
  // immediately whenever the tab regains focus/visibility.
  useEffect(() => {
    if (!churchId) return undefined;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void backgroundRefresh();
    }, BACKGROUND_POLL_INTERVAL_MS);
    const handleVisible = () => {
      if (document.visibilityState === "visible") void backgroundRefresh();
    };
    window.addEventListener("focus", handleVisible);
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleVisible);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [backgroundRefresh, churchId]);

  useEffect(
    () => () => {
      if (deferredRefreshTimeoutRef.current) {
        clearTimeout(deferredRefreshTimeoutRef.current);
      }
    },
    [],
  );

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
    selectedScheduleId,
    scheduleDrafts,
    upsertData,
    removeData,
    reorderPositions,
    refresh,
    updateSelectedScheduleId,
    updateScheduleDraft,
    flushScheduleDraft,
    toolbarLogoUrl,
    churchName,
  };
};
