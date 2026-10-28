import { useCallback, useContext, useEffect, useRef } from "react";
import { songV2DocumentsChanged } from "../../store/store";
import { useStore } from "react-redux";
import { useDispatch, useSelector } from "../../hooks";
import _ from "lodash";
import {
  DBItemListDetails,
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
  syncSelectedOverlayFromRemote,
  type OverlaySyncRootSlice,
} from "../../utils/overlayRemoteSync";
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
  const { db, cloud, updater, setIsMobile, setIsPhone, pullFromRemote } =
    useContext(ControllerInfoContext) || {};
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

  const selectedListId = useSelector(
    (state) => state.undoable.present.itemLists.selectedList?._id,
  );
  const outlineScope = useSelector(
    (state) => state.undoable.present.itemLists.scope,
  );
  const databaseRef = useRef(db);
  databaseRef.current = db;
  const selectedOutlineIdentityRef = useRef({
    listId: selectedListId,
    controllerId: activeControllerId,
    generation: 0,
  });
  if (
    selectedOutlineIdentityRef.current.listId !== selectedListId ||
    selectedOutlineIdentityRef.current.controllerId !== activeControllerId
  ) {
    selectedOutlineIdentityRef.current = {
      listId: selectedListId,
      controllerId: activeControllerId,
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
              const itemListState = currentState.undoable.present.itemList;
              if (
                itemListState.loadedOutlineId === update._id &&
                (!_.isEqual(itemListState.list, remoteItems) ||
                  !_.isEqual(itemListState.syncBaseline, remoteItems) ||
                  Boolean(itemListState.remoteConflicts?.[update._id]))
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
          dispatch(songV2DocumentsChanged([...songs].map(([songId, libraryChanged]) => ({ songId, libraryChanged }))));
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
    const getPreferences = async () => {
      try {
        const bundle = await loadOrCreatePreferencesBundle(db);
        dispatch(initiatePreferences({ preferences: bundle.preferences, isMusic: access === "music" }));
        dispatch(initiateQuickLinks(bundle.quickLinks));
        dispatch(initiateMonitorSettings(bundle.monitorSettings));
      } catch (e) {
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
        dispatch(setIsLoading(false));
        dispatch(setPreferencesIsInitialized(true));
      }
    };
    void getPreferences();
  }, [dispatch, db, access, showToast]);

  useEffect(() => {
    if (!db || !activeControllerId) return;
    let isCurrent = true;
    const controllerProfileId = activeControllerId;
    dispatch(initiateMediaRouteFolders({ controllerProfileId, mediaRouteFolders: {} }));
    void loadOrCreateControllerMediaRouteFolders(db, controllerProfileId).then(
      (doc) => {
        if (isCurrent) dispatch(initiateMediaRouteFolders({
          controllerProfileId,
          mediaRouteFolders: doc.mediaRouteFolders,
        }));
      },
    ).catch((error) => {
      console.error("Could not load controller media folder preferences", error);
    });
    return () => { isCurrent = false; };
  }, [dispatch, db, activeControllerId]);

  useEffect(() => {
    if (!db) return;
    const getTemplates = async () => {
      try {
        const templates: DBOverlayTemplates | undefined =
          await db.get("overlay-templates");
        const templatesByType: TemplatesByType | undefined =
          templates?.templatesByType;
        dispatch(
          initiateTemplates({
            templatesByType,
            defaultTemplateIdsByType: templates?.defaultTemplateIdsByType,
          }),
        );
      } catch (e) {
        dispatch(initiateTemplates(undefined));
      }
    };
    getTemplates();
  }, [dispatch, db]);

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
      if (!db || !cloudRef.current) return;
      const cloudAtLoad = cloudRef.current;
      // No selected outline (empty registry): leave empty state, never keep skeletons.
      if (!selectedListId) {
        if (cancelled) return;
        dispatch(initiateItemList({ items: [], outlineId: null }));
        lastLoadedOutlineContextRef.current = null;
        dispatch(setServicePlanningOutlinePlanBinding(null));
        dispatch(setItemListIsLoading(false));
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
      const hasUsableContent = reduxHasCurrentOutline && contextMatches;
      const shouldLoadOutlineOverlays =
        !hasUsableContent || !currentState.undoable.present.overlays.isInitialized;
      if (!hasUsableContent) dispatch(setItemListIsLoading(true));
      try {
        let response: DBItemListDetails | undefined;
        let contentSyncGeneration = serviceListSyncGenerationRef.current;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          contentSyncGeneration = serviceListSyncGenerationRef.current;
          response = await db.get(selectedListId);
          if (cancelled) return;
          if (serviceListSyncGenerationRef.current === contentSyncGeneration) break;
        }
        if (serviceListSyncGenerationRef.current !== contentSyncGeneration) {
          if (!hasUsableContent) {
            dispatch(initiateItemList({ items: [], outlineId: selectedListId }));
          }
          dispatch(setItemListIsLoading(false));
          return;
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
        lastLoadedOutlineContextRef.current = {
          db,
          controllerId: activeControllerId,
          scope: outlineScope,
          outlineId: selectedListId,
        };

        if (shouldLoadOutlineOverlays) {
          const formattedOverlays = await getOverlaysByIds(db, overlayIds);
          if (cancelled) return;
          if (serviceListSyncGenerationRef.current === contentSyncGeneration) {
            dispatch(initiateOverlayList(formattedOverlays));
            const overlayHistory = await getAllOverlayHistory(db);
            if (cancelled) return;
            if (serviceListSyncGenerationRef.current === contentSyncGeneration) {
              dispatch(mergeOverlayHistoryFromDb(overlayHistory));
            }
          }
        }
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        if (!hasUsableContent) {
          dispatch(initiateItemList({
            items: [],
            outlineId: selectedListId,
          }));
        }
        if (!hasUsableContent) {
          dispatch(setServicePlanningOutlinePlanBinding(null));
        }
      }
      if (!cancelled) {
        dispatch(setItemListIsLoading(false));
      }
    };
    void getItemList();

    return () => {
      cancelled = true;
    };
  }, [dispatch, db, selectedListId, hasCloud, activeControllerId, outlineScope, store]);

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
