import { useCallback, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { songV2DocumentsChanged } from "../../store/store";
import { useLayoutEffect } from "react";
import { useStore } from "react-redux";
import { useDispatch, useSelector } from "../../hooks";
import _ from "lodash";
import {
  DBItemListDetails,
  DBOverlay,
  DBOverlayTemplates,
  isControllerMediaRouteFoldersDocId,
  getControllerMediaRouteFoldersDocId,
  MONITOR_SETTINGS_POUCH_ID,
  PREFERENCES_POUCH_ID,
  PreferencesClusterRemoteDoc,
  QUICK_LINKS_POUCH_ID,
  TemplatesByType,
} from "../../types";
import {
  initiateItemList,
  forceUpdate as forceItemListUpdate,
  setItemListLoadError,
  setIsInitialized as setItemListIsInitialized,
  setItemListIsLoading,
  updateItemListFromRemote,
  setItemListIsRetrying,
} from "../../store/itemListSlice";
import {
  initiateOverlayList,
  mergeOverlayHistoryFromDb,
  updateOverlayListFromRemote,
  updateOverlaysByIdFromRemote,
} from "../../store/overlaysSlice";
import { formatItemList } from "../../utils/formatItemList";
import { setMediaCacheMap } from "../../store/mediaCacheMapSlice";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  getAllOverlayHistory,
  getOverlaysByIds,
} from "../../utils/dbUtils";
import {
  loadOrCreatePreferencesBundle,
} from "../../utils/controllerBootstrapDocs";
import {
  mergeRemoteOverlayListWithLocalBuffer,
  shouldKeepLocalListRowForRemoteOverlay,
  syncSelectedOverlayFromRemote,
  type OverlaySyncRootSlice,
} from "../../utils/overlayRemoteSync";
import { normalizeOverlayForSync } from "../../utils/overlayUtils";
import { getMediaUrlsFromMediaDoc } from "../../utils/mediaCacheUtils";
import {
  initiateMonitorSettings,
  initiatePreferences,
  initiateQuickLinks,
  initiateMediaRouteFolders,
  updateControllerMediaRouteFoldersFromRemote,
  preferencesClusterLoadFallback,
  setIsLoading,
  updatePreferencesFromRemote,
  setIsInitialized as setPreferencesIsInitialized,
} from "../../store/preferencesSlice";
import {
  initiateTemplates,
  setIsInitialized as setOverlayTemplatesIsInitialized,
} from "../../store/overlayTemplatesSlice";
import {
  initiateMediaList,
  initiateMediaFromDoc,
  removeMediaItemFromRemote,
  updateMediaFoldersFromRemote,
  upsertMediaItemFromRemote,
  isMediaLoadSettled,
  setLoadStatus as setMediaLoadStatus,
} from "../../store/mediaSlice";
import {
  loadMediaLibrary as readMediaLibrary,
  parseMediaReplicationDoc,
  requireMediaLibraryV2,
} from "../../utils/mediaDocUtils";
import { setIsInitialized as setOverlaysIsInitialized } from "../../store/overlaysSlice";
import { forceUpdate as forceOverlaysUpdate } from "../../store/overlaysSlice";
import { setIsInitialized as setItemListsIsInitialized } from "../../store/itemListsSlice";
import { initiateServices } from "../../store/serviceTimesSlice";
import { ServiceTime } from "../../types";
import { onValue, ref } from "firebase/database";
import { getChurchDataPath } from "../../utils/firebasePaths";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import { useSyncOnReconnect } from "../../hooks";
import { CONTROLLER_PAGE_READY, RootState } from "../../store/store";
import {
  setServicePlanningOutlinePlanBinding,
} from "../../store/servicePlanningImportSlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useToast } from "../../context/toastContext";
import {
  useActiveControllerId,
  useActiveControllerProfile,
} from "../../context/activeController";
import { ActionCreators } from "redux-undo";
import { loadOrCreateControllerMediaRouteFolders } from "../../utils/controllerMediaRouteFolders";
import { beginOutlineContentLifecycle, getOutlineDatabaseKey, getOutlineOwnerKey, setOutlineContentDatabase } from "../../store/outlineContent";
import type { ItemContentOwner } from "../../types";
import { getActiveContentDatabaseOwner, getContentDatabaseForOwner } from "../../store/deferredItemMutations";
import {
  getContentDatabaseSessionToken,
  subscribeToContentActivity,
} from "../../utils/contentReplicationActivity";
import { reconcileConcurrentOutlineMoves } from "../../utils/persistServiceListField";

/**
 * Shared DB sync, preferences, overlays, media cache, and teardown for controller-like pages.
 * Remote timer sync from Firebase is handled globally by TimerManager in App (not here).
 */
export const useControllerPageLifecycle = () => {
  const dispatch = useDispatch();
  const store = useStore();
  const activeControllerId = useActiveControllerId();
  const activeControllerProfile = useActiveControllerProfile();
  const { showToast } = useToast();
  const { db, cloud, updater, setIsMobile, setIsPhone, pullFromRemote, bootstrapReady, canCreateBootstrapDocuments } =
    useContext(ControllerInfoContext) || {};
  const contentDatabaseSessionToken = useSyncExternalStore(
    subscribeToContentActivity,
    () => db ? getContentDatabaseSessionToken(db.name) : null,
    () => null,
  );
  const cloudRef = useRef(cloud);
  cloudRef.current = cloud;
  const hasCloud = Boolean(cloud);
  const {
    access,
    refreshPresentationListeners,
    churchId,
    firebaseDb,
    loginState,
  } = useContext(GlobalInfoContext) || {};
  const accessRef = useRef(access);
  accessRef.current = access;
  const canReconcileOutlineMoves = useCallback((movedRows: DBItemListDetails["items"]) => {
    const currentAccess = accessRef.current;
    return currentAccess === "full" || (currentAccess === "music" && movedRows.every(row =>
      row.type === "song" || row.type === "free",
    ));
  }, []);

  const selectedListId = useSelector(
    (state) => state.undoable.present.itemLists.selectedList?._id,
  );
  const outlineScope = useSelector(
    (state) => state.undoable.present.itemLists.scope,
  );
  const outlineLoadAttempt = useSelector((state) => state.undoable.present.itemList.loadAttempt);
  const outlineEventsRef = useRef(new Set<string>());
  const outlineLoadGeneration = useSelector((state) => state.undoable.present.itemList.outlineLoadGeneration);
  useLayoutEffect(() => {
    dispatch(setOutlineContentDatabase(db ? getOutlineDatabaseKey(db) : ""));
  }, [db, dispatch]);
  const lifecycleOwnerKey = getOutlineOwnerKey(db ? getOutlineDatabaseKey(db) : "", selectedListId);
  useLayoutEffect(
    () => beginOutlineContentLifecycle(lifecycleOwnerKey),
    [lifecycleOwnerKey],
  );
  const databaseRef = useRef(db);
  databaseRef.current = db;
  const selectedOutlineIdentityRef = useRef({
    listId: selectedListId,
    controllerId: activeControllerId,
    scope: outlineScope,
    database: db,
    generation: 0,
  });
  if (
    selectedOutlineIdentityRef.current.listId !== selectedListId ||
    selectedOutlineIdentityRef.current.controllerId !== activeControllerId ||
    selectedOutlineIdentityRef.current.scope !== outlineScope ||
    selectedOutlineIdentityRef.current.database !== db
  ) {
    selectedOutlineIdentityRef.current = {
      listId: selectedListId,
      controllerId: activeControllerId,
      scope: outlineScope,
      database: db,
      generation: selectedOutlineIdentityRef.current.generation + 1,
    };
  }
  const lastLoadedOutlineContextRef = useRef<{
    db: typeof db;
    controllerId: string;
    scope: string;
    outlineId: string;
  } | null>(null);
  const serviceListSyncGenerationRef = useRef(0);
  const loadedPreferencesRef = useRef<{
    db: PouchDB.Database;
    baseline: RootState["undoable"]["present"]["preferences"];
  } | null>(null);
  const allControllerSlicesInitialized = useSelector((state: RootState) =>
    Boolean(
      state.allDocs.isInitialized &&
      state.undoable.present.preferences.isInitialized &&
      state.undoable.present.itemList.isInitialized &&
      state.undoable.present.itemLists.isInitialized &&
      isMediaLoadSettled(state.media) &&
      (activeControllerProfile.type === "aux-presentation" ||
        state.undoable.present.overlays.isInitialized) &&
      (activeControllerProfile.type === "aux-presentation" ||
        (state.undoable.present.overlayTemplates as { isInitialized: boolean })
          .isInitialized),
    ),
  );

  const hasDispatchedControllerPageReady = useRef(false);
  const mediaReplicationRevisionRef = useRef(0);
  const mediaReplicationDbRef = useRef<PouchDB.Database | undefined>(db);
  const mediaReplicationFingerprintsRef = useRef(new Map<string, string>());
  if (mediaReplicationDbRef.current !== db) {
    mediaReplicationDbRef.current = db;
    mediaReplicationFingerprintsRef.current.clear();
  }

  // A profile change is a new editing session even when React keeps this hook
  // mounted. Re-arm readiness without reloading already hydrated slices; the
  // readiness effect below will dispatch page-ready on the next render.
  useEffect(() => {
    hasDispatchedControllerPageReady.current = false;
    dispatch({ type: "RESET_INITIALIZATION" });
    dispatch(ActionCreators.clearHistory());
  }, [activeControllerId, dispatch]);

  const teardownRefs = useRef({
    refreshPresentationListeners,
    setIsMobile,
    setIsPhone,
  });

  useEffect(() => {
    teardownRefs.current = {
      refreshPresentationListeners,
      setIsMobile,
      setIsPhone,
    };
  }, [refreshPresentationListeners, setIsMobile, setIsPhone]);

  const updateOutlineFromExternal = useCallback(
    async (event: CustomEventInit) => {
      try {
        if (databaseRef.current !== db || (store.getState() as RootState).undoable.present.itemLists.contentDatabaseKey !== (db ? getOutlineDatabaseKey(db) : "")) return;
        const updates = event.detail;
        if (!Array.isArray(updates)) return;
        const songs = new Map<string, boolean>();
        let refetchOverlayHistory = false;
        for (const _update of updates) {
          if (typeof _update._id === "string" && _update._id.startsWith("song-v2:")) {
            const match = /^song-v2:(root|arrangement|slide):([^:]+)/.exec(_update._id);
            if (match) {
              const songId = decodeURIComponent(match[2]);
              songs.set(songId, (songs.get(songId) ?? false) || match[1] !== "slide");
            }
            continue;
          }
          if (_update.docType === "song-v2-root" && _update.type === "song") {
            songs.set(_update._id, true);
            continue;
          }
          const currentState = store.getState() as RootState;
          const currentSelectedList =
            currentState.undoable.present.itemLists.selectedList;
          if (currentSelectedList?._id && _update._id === currentSelectedList._id) {
            const dbAtRead = databaseRef.current;
            if (!dbAtRead) continue;
            const databaseSessionToken = getContentDatabaseSessionToken(dbAtRead.name);
            const selectionIdentity = selectedOutlineIdentityRef.current;
            const eventKey = _update._rev ? `${selectionIdentity.generation}:${_update._id}:${_update._rev}` : undefined;
            const events = outlineEventsRef.current;
            if (eventKey && events.has(eventKey)) continue;
            if (eventKey) events.add(eventKey);
            const clearPendingEvent = () => {
              if (eventKey) events.delete(eventKey);
            };
            if (events.size > 200) events.delete(events.values().next().value!);
            const outlineGeneration = currentState.undoable.present.itemList.outlineLoadGeneration;
            const syncGeneration = ++serviceListSyncGenerationRef.current;
            const isCurrentUpdate = () => {
              const current = (store.getState() as RootState).undoable.present;
              return databaseRef.current === dbAtRead &&
                getContentDatabaseSessionToken(dbAtRead.name) === databaseSessionToken &&
                selectedOutlineIdentityRef.current.generation === selectionIdentity.generation &&
                serviceListSyncGenerationRef.current === syncGeneration &&
                current.itemLists.selectedList?._id === _update._id &&
                current.itemList.outlineLoadGeneration === outlineGeneration;
            };
            let update: DBItemListDetails;
            try {
              const head = await dbAtRead.get(_update._id, { conflicts: true }) as DBItemListDetails;
              if (!isCurrentUpdate()) {
                clearPendingEvent();
                continue;
              }
              if (!head) throw new Error("The selected outline document was not returned by the database");
              update = head;
              if (accessRef.current === "full" || accessRef.current === "music") {
                const reconciled = await reconcileConcurrentOutlineMoves(
                  dbAtRead,
                  _update._id,
                  isCurrentUpdate,
                  canReconcileOutlineMoves,
                  update,
                );
                if (!isCurrentUpdate()) {
                  clearPendingEvent();
                  continue;
                }
                if (reconciled) update = reconciled;
              }
            } catch (error) {
              if (eventKey) events.delete(eventKey);
              if (isCurrentUpdate()) {
                dispatch(setItemListLoadError("Could not check this outline for updates. Check the connection and try again."));
              }
              throw error;
            }
            if (!isCurrentUpdate()) {
              clearPendingEvent();
              continue;
            }
            dispatch(
              setServicePlanningOutlinePlanBinding(
                update.servicePlanBinding ?? null,
              ),
            );
            if (cloud) {
              const remoteItems = formatItemList(update.items || [], cloud);
              const itemListState = (store.getState() as RootState).undoable.present.itemList;
              if (
                itemListState.isInitialized && itemListState.loadedOutlineId === update._id &&
                !_.isEqual(itemListState.syncBaseline, remoteItems)
              ) {
                dispatch(updateItemListFromRemote({
                  outlineId: update._id,
                  items: remoteItems,
                }));
                if (itemListState.isLoading) {
                  dispatch(setItemListIsLoading(false));
                }
              }
            }

            const remoteOverlayIds = update.overlays || [];
            const currentOverlayState = currentState.undoable.present.overlays;
            const overlayIdsAtRead = currentOverlayState.list.map((o) => o.id);
            if (
              !currentOverlayState.hasPendingUpdate &&
              (!currentOverlayState.isInitialized ||
                !_.isEqual(overlayIdsAtRead, remoteOverlayIds))
            ) {
              if (!currentOverlayState.isInitialized) {
                refetchOverlayHistory = true;
              }
              const dbAtRead = databaseRef.current;
              if (!dbAtRead) {
                clearPendingEvent();
                continue;
              }
              const overlaysAtRead = currentOverlayState.list;
              const formattedOverlays = await getOverlaysByIds(
                dbAtRead,
                remoteOverlayIds,
              );
              const latestState = store.getState() as RootState;
              const latestOverlays = latestState.undoable.present.overlays;
              const latestSelectionIdentity = selectedOutlineIdentityRef.current;
              if (
                !isCurrentUpdate() ||
                databaseRef.current !== dbAtRead ||
                latestSelectionIdentity.generation !== selectionIdentity.generation ||
                latestState.undoable.present.itemLists.selectedList?._id !== update._id ||
                latestState.undoable.present.itemList.outlineLoadGeneration !== outlineGeneration ||
                syncGeneration !== serviceListSyncGenerationRef.current ||
                latestOverlays.hasPendingUpdate ||
                !_.isEqual(
                  latestOverlays.list.map((o) => o.id),
                  overlayIdsAtRead,
                )
              ) {
                clearPendingEvent();
                continue;
              }

              const overlaysAtReadById = new Map(
                overlaysAtRead.map((overlay) => [overlay.id, overlay]),
              );
              const latestOverlaysById = new Map(
                latestOverlays.list.map((overlay) => [overlay.id, overlay]),
              );
              const changedWhileReading = new Set(
                latestOverlays.list
                  .filter((overlay) => {
                    const previous = overlaysAtReadById.get(overlay.id);
                    return previous && !_.isEqual(previous, overlay);
                  })
                  .map((overlay) => overlay.id),
              );
              const freshList = formattedOverlays.map((overlay) =>
                changedWhileReading.has(overlay.id)
                  ? latestOverlaysById.get(overlay.id) || overlay
                  : overlay,
              );
              const mergedList = mergeRemoteOverlayListWithLocalBuffer(
                freshList,
                store.getState as () => OverlaySyncRootSlice,
              );
              if (!latestOverlays.isInitialized) {
                dispatch(initiateOverlayList(mergedList));
              } else {
                dispatch(updateOverlayListFromRemote(mergedList));
              }
              const selectedOverlayId = (store.getState() as OverlaySyncRootSlice)
                .undoable.present.overlay.selectedOverlay?.id;
              if (selectedOverlayId) {
                const match = freshList.find((o) => o.id === selectedOverlayId);
                if (match) {
                  syncSelectedOverlayFromRemote(
                    dispatch,
                    store.getState as () => OverlaySyncRootSlice,
                    match,
                  );
                }
              }
            }
          }
          if (_update.docType === "overlay-history") {
            refetchOverlayHistory = true;
          }
        }
        if (songs.size) {
          const databaseAtChange = db;
          const ownerAtChange = getActiveContentDatabaseOwner();
          if (databaseAtChange && (!ownerAtChange || getContentDatabaseForOwner(ownerAtChange) === databaseAtChange)) {
            const sessionToken = getContentDatabaseSessionToken(databaseAtChange.name);
            dispatch(songV2DocumentsChanged([...songs].map(([songId, libraryChanged]) => ({
              songId,
              libraryChanged,
              database: databaseAtChange,
              owner: ownerAtChange as ItemContentOwner | null,
              sessionToken,
            }))));
          }
        }
        const dbForHistory = databaseRef.current;
        if (refetchOverlayHistory && dbForHistory) {
          const overlayHistory = await getAllOverlayHistory(dbForHistory);
          if (databaseRef.current === dbForHistory) {
            dispatch(mergeOverlayHistoryFromDb(overlayHistory));
        }
        }
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch, cloud, db, store, canReconcileOutlineMoves],
  );

  const updateMediaFromExternal = useCallback(
    (event: CustomEventInit) => {
      const updates = event.detail;
      if (!Array.isArray(updates)) return;
      for (const update of updates) {
        if (typeof update?._id === "string") {
          const fingerprint = JSON.stringify(
            Object.fromEntries(
              Object.entries(update).filter(([key]) => key !== "_rev"),
            ),
          );
          if (mediaReplicationFingerprintsRef.current.get(update._id) === fingerprint) {
            continue;
          }
          mediaReplicationFingerprintsRef.current.set(update._id, fingerprint);
          if (mediaReplicationFingerprintsRef.current.size > 500) {
            const oldestId = mediaReplicationFingerprintsRef.current.keys().next().value;
            if (oldestId) mediaReplicationFingerprintsRef.current.delete(oldestId);
          }
        }
        const change = parseMediaReplicationDoc(update);
        if (!change) continue;
        mediaReplicationRevisionRef.current += 1;
        if (change.kind === "folders") {
          dispatch(updateMediaFoldersFromRemote(change.folders));
        } else if (change.kind === "item-delete") {
          dispatch(removeMediaItemFromRemote(change.id));
        } else {
          dispatch(upsertMediaItemFromRemote(change.item));
        }
      }
    },
    [dispatch],
  );

  useGlobalBroadcast(updateOutlineFromExternal);
  useGlobalBroadcast(updateMediaFromExternal);

  const updatePreferencesFromExternal = useCallback(
    async (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        for (const _update of updates) {
          if (
            _update._id === PREFERENCES_POUCH_ID ||
            _update._id === QUICK_LINKS_POUCH_ID ||
            _update._id === MONITOR_SETTINGS_POUCH_ID ||
            isControllerMediaRouteFoldersDocId(_update._id)
          ) {
            if (isControllerMediaRouteFoldersDocId(_update._id) && "controllerProfileId" in _update) {
              if (_update._id !== getControllerMediaRouteFoldersDocId(_update.controllerProfileId)) continue;
              dispatch(updateControllerMediaRouteFoldersFromRemote({
                controllerProfileId: _update.controllerProfileId,
                mediaRouteFolders: _update.mediaRouteFolders ?? {},
              }));
            } else {
              dispatch(updatePreferencesFromRemote(_update as PreferencesClusterRemoteDoc));
            }
          }
        }
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch],
  );

  useGlobalBroadcast(updatePreferencesFromExternal);

  const updateOverlayFromExternal = useCallback(
    (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        if (!Array.isArray(updates)) return;
        const remoteOverlays = updates
          .filter(
            (_update): _update is DBOverlay =>
              typeof _update?._id === "string" &&
              _update._id.startsWith("overlay-"),
          )
          .map(normalizeOverlayForSync);
        const getState = store.getState as () => OverlaySyncRootSlice;
        const rowsToApply = remoteOverlays.filter(
          (overlay) =>
            !shouldKeepLocalListRowForRemoteOverlay(getState, overlay),
        );

        if (rowsToApply.length > 0) {
          dispatch(updateOverlaysByIdFromRemote(rowsToApply));
        }
        for (const overlay of remoteOverlays) {
          syncSelectedOverlayFromRemote(dispatch, getState, overlay);
        }
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch, store],
  );

  useEffect(() => {
    if (!updater) return;

    updater.addEventListener("update", updateOverlayFromExternal);

    return () =>
      updater.removeEventListener("update", updateOverlayFromExternal);
  }, [updater, updateOverlayFromExternal]);

  useGlobalBroadcast(updateOverlayFromExternal);

  useSyncOnReconnect(pullFromRemote);

  const layoutRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const resizeObserver = new ResizeObserver((entries) => {
        const width = entries[0].borderBoxSize[0].inlineSize;
        if (width < 576) {
          setIsPhone?.(true);
        } else {
          setIsPhone?.(false);
        }
        if (width < 1024) {
          setIsMobile?.(true);
        } else {
          setIsMobile?.(false);
        }
      });
      resizeObserver.observe(node);
      return () => resizeObserver.disconnect();
    },
    [setIsMobile, setIsPhone],
  );

  useEffect(() => {
    return () => {
      const {
        refreshPresentationListeners,
        setIsMobile,
        setIsPhone,
      } = teardownRefs.current;

      // Button (and others) read sticky isMobile from context; leaving it true
      // after leaving the controller makes Account/settings icons jump to xl
      // until a full refresh resets the provider.
      setIsMobile?.(false);
      setIsPhone?.(false);
      // Soft reset: clears presentation/session slices but keeps church
      // registries so Home does not flash built-in controller names.
      dispatch({ type: "RESET_CONTROLLER_SESSION" });
      dispatch(setPreferencesIsInitialized(false));
      dispatch(setItemListIsInitialized(false));
      dispatch(setOverlaysIsInitialized(false));
      dispatch(setItemListsIsInitialized(false));
      dispatch(setMediaLoadStatus("idle"));
      dispatch(setOverlayTemplatesIsInitialized(false));
      dispatch({ type: "RESET_INITIALIZATION" });
      refreshPresentationListeners?.();
    };
  }, [dispatch]);

  // Firebase gives real-time service time updates (same mechanism as StreamInfo.tsx).
  // Falls back to a one-time DB load for guest / offline sessions.
  useEffect(() => {
    if (!firebaseDb || loginState === "guest" || !churchId) return;
    const servicesRef = ref(
      firebaseDb,
      getChurchDataPath(churchId, "services"),
    );
    const unsubscribe = onValue(servicesRef, (snapshot) => {
      const data = snapshot.val() as ServiceTime[] | null;
      dispatch(initiateServices(data ?? []));
    });
    return unsubscribe;
  }, [firebaseDb, loginState, churchId, dispatch]);

  useEffect(() => {
    if (!db || loginState !== "guest") return;
    const load = async () => {
      try {
        const doc: { list?: ServiceTime[] } | undefined =
          await db.get("services");
        dispatch(initiateServices(doc?.list ?? []));
      } catch {
        dispatch(initiateServices([]));
      }
    };
    load();
  }, [db, loginState, dispatch]);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    if (loadedPreferencesRef.current?.db !== db) {
      loadedPreferencesRef.current = { db, baseline: (store.getState() as RootState).undoable.present.preferences };
    }
    const baseline = loadedPreferencesRef.current.baseline;
    const getPreferences = async () => {
      try {
        const bundle = await loadOrCreatePreferencesBundle(db, canCreateBootstrapDocuments);
        if (cancelled || !bundle) return;
        // Reverification refreshes saved data, while edits made since the last
        // hydration still belong to the operator's current draft.
        const current = (store.getState() as RootState).undoable.present.preferences;
        const preferences = {
          ...bundle.preferences,
          ..._.pickBy(current.preferences, (value, key) => !_.isEqual(value, _.get(baseline.preferences, key))),
        };
        const monitorSettings = {
          ...bundle.monitorSettings,
          ..._.pickBy(current.monitorSettings, (value, key) => !_.isEqual(value, _.get(baseline.monitorSettings, key))),
        };
        dispatch(initiatePreferences({ preferences, isMusic: access === "music" }));
        dispatch(initiateQuickLinks(_.isEqual(current.quickLinks, baseline.quickLinks) ? bundle.quickLinks : current.quickLinks));
        dispatch(initiateMonitorSettings(monitorSettings));
        loadedPreferencesRef.current = { db, baseline: (store.getState() as RootState).undoable.present.preferences };
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        const fb = preferencesClusterLoadFallback;
        dispatch(
          initiatePreferences({
            preferences: fb.preferences,
            isMusic: access === "music",
          }),
        );
        dispatch(initiateQuickLinks(fb.quickLinks));
        dispatch(initiateMonitorSettings(fb.monitorSettings));
        showToast(
          "Could not load saved preferences. Default settings are in use for this session. Try reloading the page if this continues.",
          "error",
        );
      } finally {
        if (!cancelled) {
          dispatch(setIsLoading(false));
          dispatch(setPreferencesIsInitialized(true));
        }
      }
    };
    void getPreferences();
    return () => { cancelled = true; };
  }, [dispatch, db, bootstrapReady, canCreateBootstrapDocuments, access, showToast, store]);

  useEffect(() => {
    if (!db || !activeControllerId) return;
    let isCurrent = true;
    const controllerProfileId = activeControllerId;
    dispatch(initiateMediaRouteFolders({ controllerProfileId, mediaRouteFolders: {} }));
    void loadOrCreateControllerMediaRouteFolders(db, controllerProfileId, canCreateBootstrapDocuments).then(
      (doc) => {
        if (isCurrent) dispatch(updateControllerMediaRouteFoldersFromRemote({
          controllerProfileId,
          mediaRouteFolders: doc.mediaRouteFolders,
        }));
      },
    ).catch((error) => {
      console.error("Could not load controller media folder preferences", error);
    });
    return () => { isCurrent = false; };
  }, [dispatch, db, bootstrapReady, canCreateBootstrapDocuments, activeControllerId]);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    const getTemplates = async () => {
      try {
        const templates: DBOverlayTemplates | undefined =
          await db.get("overlay-templates");
        if (cancelled || (store.getState() as RootState).undoable.present.overlayTemplates.hasPendingUpdate) return;
        const templatesByType: TemplatesByType | undefined =
          templates?.templatesByType;
        dispatch(
          initiateTemplates({
            templatesByType,
            defaultTemplateIdsByType: templates?.defaultTemplateIdsByType,
          }),
        );
      } catch (e) {
        if (cancelled || (store.getState() as RootState).undoable.present.overlayTemplates.hasPendingUpdate) return;
        dispatch(initiateTemplates(undefined));
      }
    };
    getTemplates();
    return () => { cancelled = true; };
  }, [dispatch, db, bootstrapReady, store]);

  useEffect(() => {
    if (db && access !== "full") {
      dispatch(initiateMediaList([]));
    }
  }, [dispatch, db, access]);

  useEffect(() => {
    if (!db || access !== "full") return;
    let cancelled = false;
    dispatch(setMediaLoadStatus("loading"));
    const initializeMediaLibrary = async () => {
      try {
        await requireMediaLibraryV2(db);
        if (cancelled) return;
        const replicationRevisionAtStart = mediaReplicationRevisionRef.current;
        let loaded = await readMediaLibrary(db);
        if (cancelled) return;
        // Item or folder documents can replicate during a same-schema read too.
        // Re-read until no media change arrived while the read was in flight.
        let readRevision = mediaReplicationRevisionRef.current;
        while (readRevision !== replicationRevisionAtStart) {
          const revisionBeforeRead = mediaReplicationRevisionRef.current;
          loaded = await readMediaLibrary(db);
          if (cancelled) return;
          readRevision = mediaReplicationRevisionRef.current;
          if (readRevision === revisionBeforeRead) break;
        }
        dispatch(initiateMediaFromDoc(loaded));
      } catch (error) {
        if (cancelled) return;
        dispatch(setMediaLoadStatus("error"));
        console.error("Failed to load media library from PouchDB:", error);
        showToast(
          "Could not load the media library. Reload the page before making media changes.",
          "error",
        );
      }
    };

    void initializeMediaLibrary();
    return () => {
      cancelled = true;
    };
  }, [dispatch, db, access, showToast]);

  useEffect(() => {
    if (
      allControllerSlicesInitialized &&
      !hasDispatchedControllerPageReady.current
    ) {
      hasDispatchedControllerPageReady.current = true;
      dispatch({ type: CONTROLLER_PAGE_READY });
    }
  }, [allControllerSlicesInitialized, dispatch]);

  useEffect(() => {
    if (!db || !window.electronAPI) return;
    const syncMedia = async () => {
      try {
        const mediaUrls = await getMediaUrlsFromMediaDoc(db);
        if (mediaUrls.status === "unavailable") return;
        const urlArray = Array.from(mediaUrls.urls);
        const electronAPI = window.electronAPI as unknown as {
          syncMediaCache: (urls: string[]) => Promise<{
            downloaded: number;
            cleaned: number;
          }>;
          getMediaCacheMap: () => Promise<Record<string, string>>;
        };
        if (urlArray.length > 0) {
          await electronAPI.syncMediaCache(urlArray);
        } else {
          await electronAPI.syncMediaCache([]);
        }
        const map = await electronAPI.getMediaCacheMap();
        dispatch(setMediaCacheMap(map));
      } catch (error) {
        console.error("Error syncing media cache:", error);
      }
    };
    const timeoutId = setTimeout(syncMedia, 2000);
    return () => clearTimeout(timeoutId);
  }, [db, dispatch]);

  useEffect(() => {
    let cancelled = false;
    const ownerState = (store.getState() as RootState).undoable.present;
    const ownerKey = getOutlineOwnerKey(db ? getOutlineDatabaseKey(db) : "", selectedListId);
    const databaseSessionTokenAtStart = contentDatabaseSessionToken;
    const generation = ownerState.itemList.outlineLoadGeneration;
    const isCurrent = () => {
      const current = (store.getState() as RootState).undoable.present;
      return !cancelled && databaseRef.current === db &&
        (!db || getContentDatabaseSessionToken(db.name) === databaseSessionTokenAtStart) &&
        current.itemList.outlineOwnerKey === ownerKey && current.itemList.outlineLoadGeneration === generation;
    };

    const getItemList = async () => {
      if (!db || !cloudRef.current) return;
      const cloudAtLoad = cloudRef.current;
      const selectionAtLoad = selectedOutlineIdentityRef.current;
      const isCurrentLoad = () =>
        isCurrent() &&
        databaseRef.current === db &&
        selectedOutlineIdentityRef.current.generation === selectionAtLoad.generation &&
        selectedOutlineIdentityRef.current.listId === selectedListId &&
        selectedOutlineIdentityRef.current.scope === outlineScope;
      // No selected outline (empty registry): leave empty state, never keep skeletons.
      if (!selectedListId) {
        if (!isCurrentLoad()) return;
        dispatch(initiateItemList({ items: [], outlineId: null }));
        dispatch(initiateOverlayList([]));
        lastLoadedOutlineContextRef.current = null;
        dispatch(setServicePlanningOutlinePlanBinding(null));
        dispatch(setItemListIsLoading(false));
        dispatch(setItemListIsRetrying(false));
        return;
      }
      const currentState = store.getState() as RootState;
      const currentItemList = currentState.undoable.present.itemList;
      const lastLoadedContext = lastLoadedOutlineContextRef.current;
      const reduxHasCurrentOutline =
        currentItemList.isInitialized &&
        currentItemList.loadedOutlineId === selectedListId;
      const contextMatches = lastLoadedContext
        ? lastLoadedContext.db === db &&
          lastLoadedContext.controllerId === activeControllerId &&
          lastLoadedContext.scope === outlineScope &&
          lastLoadedContext.outlineId === selectedListId
        : reduxHasCurrentOutline;
      let hasUsableContent = reduxHasCurrentOutline && contextMatches;
      const shouldLoadOutlineOverlays =
        !hasUsableContent || !currentState.undoable.present.overlays.isInitialized;
      const retained = currentItemList.remoteConflicts?.[selectedListId];
      if (!hasUsableContent && retained) {
        dispatch(initiateItemList({ outlineId: selectedListId, items: retained.remoteItems }));
        dispatch(setItemListIsLoading(false));
        hasUsableContent = true;
      }
      if (!hasUsableContent) dispatch(setItemListIsLoading(true));
      dispatch(setItemListLoadError(null));
      try {
        let response: DBItemListDetails | undefined;
        let contentSyncGeneration = serviceListSyncGenerationRef.current;
        let readWasStable = false;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          contentSyncGeneration = serviceListSyncGenerationRef.current;
          const head = await db.get(selectedListId, { conflicts: true }) as DBItemListDetails;
          if (!isCurrentLoad()) return;
          if (!head || typeof head !== "object") throw new Error("The selected outline document was not returned by the database");
          response = head;
          if (!isCurrentLoad()) return;
          if (serviceListSyncGenerationRef.current === contentSyncGeneration) {
            readWasStable = true;
            break;
          }
        }
        if (!readWasStable || serviceListSyncGenerationRef.current !== contentSyncGeneration) {
          dispatch(setItemListLoadError(
            "This outline kept changing while it loaded. Wait for updates to finish, then try again.",
          ));
          dispatch(setItemListIsLoading(false));
          dispatch(setItemListIsRetrying(false));
          return;
        }
        if ((accessRef.current === "full" || accessRef.current === "music") && isCurrentLoad()) {
          try {
            const reconciled = await reconcileConcurrentOutlineMoves(
              db,
              selectedListId,
              () => isCurrentLoad() && serviceListSyncGenerationRef.current === contentSyncGeneration,
              canReconcileOutlineMoves,
              response,
            );
            if (reconciled) response = reconciled;
          } catch (error) {
            // Reconciliation is opportunistic. A failed read or write leaves
            // the winning saved outline available through the normal load.
            console.error("Could not reconcile concurrent outline moves", error);
          }
          if (!isCurrentLoad()) return;
        }
        if (!response || typeof response !== "object") {
          throw new Error("The selected outline document was not returned by the database");
        }
        const itemList = response?.items || [];
        const overlayIds = response?.overlays || [];
        const currentBinding = (store.getState() as RootState)
          .servicePlanningImport.outlinePlanBinding;
        const nextBinding = response?.servicePlanBinding ?? null;
        if (!_.isEqual(currentBinding, nextBinding)) {
          dispatch(setServicePlanningOutlinePlanBinding(nextBinding));
        }

        const formattedItems = formatItemList(itemList, cloudAtLoad);
        if (!isCurrentLoad()) return;
        if (hasUsableContent) {
          dispatch(updateItemListFromRemote({
            outlineId: selectedListId,
            items: formattedItems,
          }));
        } else {
          dispatch(initiateItemList({
            items: formattedItems,
            outlineId: selectedListId,
          }));
        }
        const hydratedItemList = (store.getState() as RootState).undoable.present.itemList;
        if (
          hydratedItemList.outlineOwnerKey === ownerKey &&
          hydratedItemList.hasPendingUpdate &&
          hydratedItemList.pendingByOutline?.[ownerKey]
        ) {
          dispatch(forceItemListUpdate());
        }
        lastLoadedOutlineContextRef.current = {
          db,
          controllerId: activeControllerId,
          scope: outlineScope,
          outlineId: selectedListId,
        };

        if (shouldLoadOutlineOverlays) {
          const formattedOverlays = await getOverlaysByIds(db, overlayIds);
          if (!isCurrentLoad()) return;
          if (serviceListSyncGenerationRef.current === contentSyncGeneration) {
            dispatch(initiateOverlayList(formattedOverlays));
            const hydratedOverlays = (store.getState() as RootState).undoable.present.overlays;
            if (
              hydratedOverlays.outlineOwnerKey === ownerKey &&
              hydratedOverlays.hasPendingUpdate &&
              hydratedOverlays.pendingByOutline?.[ownerKey]
            ) {
              dispatch(forceOverlaysUpdate());
            }
            const overlayHistory = await getAllOverlayHistory(db);
            if (!isCurrentLoad()) return;
            if (serviceListSyncGenerationRef.current === contentSyncGeneration) {
              dispatch(mergeOverlayHistoryFromDb(overlayHistory));
            }
          }
        }
      } catch (e) {
        if (!isCurrentLoad()) return;
        console.error(e);
        dispatch(setItemListLoadError(
          "Could not load this outline. Check the connection and try again.",
        ));
      }
      if (isCurrentLoad()) {
        dispatch(setItemListIsLoading(false));
        dispatch(setItemListIsRetrying(false));
      }
    };
    void getItemList();

    return () => {
      cancelled = true;
    };
  }, [dispatch, db, selectedListId, hasCloud, cloud, bootstrapReady, activeControllerId, outlineScope, outlineLoadAttempt, outlineLoadGeneration, store, canReconcileOutlineMoves, contentDatabaseSessionToken]);

  useEffect(() => {
    if (!updater) return;
    updater.addEventListener("update", updateOutlineFromExternal);
    return () =>
      updater.removeEventListener("update", updateOutlineFromExternal);
  }, [updater, updateOutlineFromExternal]);

  useEffect(() => {
    if (!updater) return;
    updater.addEventListener("update", updateMediaFromExternal);
    return () => updater.removeEventListener("update", updateMediaFromExternal);
  }, [updater, updateMediaFromExternal]);

  useEffect(() => {
    if (!updater) return;
    updater.addEventListener("update", updatePreferencesFromExternal);
    return () =>
      updater.removeEventListener("update", updatePreferencesFromExternal);
  }, [updater, updatePreferencesFromExternal]);

  return { layoutRef };
};
