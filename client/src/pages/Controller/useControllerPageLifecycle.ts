import { useCallback, useContext, useEffect, useRef } from "react";
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
  setIsInitialized as setItemListIsInitialized,
  setItemListIsLoading,
  updateItemListFromRemote,
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
  const {
    access,
    refreshPresentationListeners,
    churchId,
    firebaseDb,
    loginState,
  } = useContext(GlobalInfoContext) || {};

  const selectedList = useSelector(
    (state) => state.undoable.present.itemLists.selectedList,
  );
  const databaseRef = useRef(db);
  databaseRef.current = db;
  const selectedOutlineIdentityRef = useRef({
    listId: selectedList?._id,
    controllerId: activeControllerId,
    generation: 0,
  });
  if (
    selectedOutlineIdentityRef.current.listId !== selectedList?._id ||
    selectedOutlineIdentityRef.current.controllerId !== activeControllerId
  ) {
    selectedOutlineIdentityRef.current = {
      listId: selectedList?._id,
      controllerId: activeControllerId,
      generation: selectedOutlineIdentityRef.current.generation + 1,
    };
  }
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
        const updates = event.detail;
        if (!Array.isArray(updates)) return;
        let refetchOverlayHistory = false;
        for (const _update of updates) {
          const currentState = store.getState() as RootState;
          const currentSelectedList =
            currentState.undoable.present.itemLists.selectedList;
          if (currentSelectedList?._id && _update._id === currentSelectedList._id) {
            const update = _update as DBItemListDetails;
            const selectionIdentity = selectedOutlineIdentityRef.current;
            const syncGeneration = ++serviceListSyncGenerationRef.current;
            dispatch(
              setServicePlanningOutlinePlanBinding(
                update.servicePlanBinding ?? null,
              ),
            );
            if (cloud) {
              const remoteItems = formatItemList(update.items || [], cloud);
              if (
                !currentState.undoable.present.itemList.hasPendingUpdate &&
                !_.isEqual(currentState.undoable.present.itemList.list, remoteItems)
              ) {
                dispatch(updateItemListFromRemote(remoteItems));
              }
            }

            const remoteOverlayIds = update.overlays || [];
            const currentOverlayState = currentState.undoable.present.overlays;
            const overlayIdsAtRead = currentOverlayState.list.map((o) => o.id);
            if (
              !currentOverlayState.hasPendingUpdate &&
              !_.isEqual(overlayIdsAtRead, remoteOverlayIds)
            ) {
              const dbAtRead = databaseRef.current;
              if (!dbAtRead) continue;
              const overlaysAtRead = currentOverlayState.list;
              const formattedOverlays = await getOverlaysByIds(
                dbAtRead,
                remoteOverlayIds,
              );
              const latestState = store.getState() as RootState;
              const latestOverlays = latestState.undoable.present.overlays;
              const latestSelectionIdentity = selectedOutlineIdentityRef.current;
              if (
                databaseRef.current !== dbAtRead ||
                latestSelectionIdentity.generation !== selectionIdentity.generation ||
                latestState.undoable.present.itemLists.selectedList?._id !== update._id ||
                syncGeneration !== serviceListSyncGenerationRef.current ||
                latestOverlays.hasPendingUpdate ||
                !_.isEqual(
                  latestOverlays.list.map((o) => o.id),
                  overlayIdsAtRead,
                )
              ) {
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
              dispatch(updateOverlayListFromRemote(mergedList));
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
    [dispatch, cloud, store],
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

    const getItemList = async () => {
      if (!db || !cloud) return;
      // No selected outline (empty registry): leave empty state, never keep skeletons.
      if (!selectedList?._id) {
        if (cancelled) return;
        dispatch(initiateItemList([]));
        dispatch(setServicePlanningOutlinePlanBinding(null));
        dispatch(setItemListIsLoading(false));
        return;
      }
      dispatch(setItemListIsLoading(true));
      try {
        const response: DBItemListDetails | undefined = await db.get(
          selectedList._id,
        );
        if (cancelled) return;
        const itemList = response?.items || [];
        const overlayIds = response?.overlays || [];
        dispatch(
          setServicePlanningOutlinePlanBinding(
            response?.servicePlanBinding ?? null,
          ),
        );
        if (!(store.getState() as RootState).undoable.present.itemList.hasPendingUpdate) {
          dispatch(initiateItemList(formatItemList(itemList, cloud)));
        }
        const formattedOverlays = await getOverlaysByIds(db, overlayIds);
        if (cancelled) return;
        if (!(store.getState() as RootState).undoable.present.overlays.hasPendingUpdate) {
          dispatch(initiateOverlayList(formattedOverlays));
        }
        const overlayHistory = await getAllOverlayHistory(db);
        if (cancelled) return;
        dispatch(mergeOverlayHistoryFromDb(overlayHistory));
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        dispatch(setServicePlanningOutlinePlanBinding(null));
      }
      if (!cancelled) {
        dispatch(setItemListIsLoading(false));
      }
    };
    void getItemList();

    return () => {
      cancelled = true;
    };
  }, [dispatch, db, selectedList, cloud, bootstrapReady, store]);

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
