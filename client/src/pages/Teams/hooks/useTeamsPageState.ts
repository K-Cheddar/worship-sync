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
  const toolbarLogoUrl = useMemo(
    () => resolveChurchToolbarLogoUrl(context?.churchBranding),
    [context?.churchBranding],
  );
  const churchName = context?.churchName?.trim() || "";

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

  const refresh = useCallback(async (isCancelled = () => false) => {
    if (!churchId) {
      if (!isCancelled()) setLoading(false);
      return;
    }
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      const response = await getTeamsBootstrap(churchId);
      if (isCancelled()) return;
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
    } catch (error) {
      if (!isCancelled()) {
        showApiErrorToast(showToast, error, "Could not load teams.");
      }
    } finally {
      refreshInFlightRef.current = false;
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
