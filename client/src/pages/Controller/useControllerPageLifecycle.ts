import { useCallback, useContext, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "../../hooks";
import {
  initiateAllItemsList,
  updateAllItemsListFromRemote,
} from "../../store/allItemsSlice";
import {
  DBAllItems,
  DBItemListDetails,
  DBPreferences,
  DBOverlayTemplates,
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
import { sortNamesInList } from "../../utils/sort";
import {
  deleteUnusedBibleItems,
  deleteUnusedHeadings,
  getAllOverlayHistory,
  getOverlaysByIds,
  updateAllDocs,
} from "../../utils/dbUtils";
import { useMediaCache } from "../../hooks/useMediaCache";
import { getMediaUrlsFromMediaDoc } from "../../utils/mediaCacheUtils";
import {
  initiateMonitorSettings,
  initiatePreferences,
  initiateQuickLinks,
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
  setIsInitialized as setMediaIsInitialized,
} from "../../store/mediaSlice";
import { setIsInitialized as setAllItemsIsInitialized } from "../../store/allItemsSlice";
import { setIsInitialized as setOverlaysIsInitialized } from "../../store/overlaysSlice";
import { setIsInitialized as setItemListsIsInitialized } from "../../store/itemListsSlice";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import { useSyncOnReconnect } from "../../hooks";
import { CONTROLLER_PAGE_READY, RootState } from "../../store/store";
import { ControllerInfoContext } from "../../context/controllerInfo";

/**
 * Shared DB sync, preferences, overlays, media cache, and teardown for controller-like pages.
 * Remote timer sync from Firebase is handled globally by TimerManager in App (not here).
 */
export const useControllerPageLifecycle = () => {
  const dispatch = useDispatch();
  const { db, cloud, updater, setIsMobile, setIsPhone, pullFromRemote } =
    useContext(ControllerInfoContext) || {};
  const { access, refreshPresentationListeners } =
    useContext(GlobalInfoContext) || {};

  const selectedList = useSelector(
    (state) => state.undoable.present.itemLists.selectedList
  );
  const activeList = useSelector(
    (state) => state.undoable.present.itemLists.activeList
  );
  const allControllerSlicesInitialized = useSelector((state: RootState) =>
    Boolean(
      state.allItems.isInitialized &&
        state.undoable.present.preferences.isInitialized &&
        state.undoable.present.itemList.isInitialized &&
        state.undoable.present.overlays.isInitialized &&
        state.undoable.present.itemLists.isInitialized &&
        state.media.isInitialized &&
        (state.undoable.present.overlayTemplates as { isInitialized: boolean })
          .isInitialized
    )
  );

  const hasDispatchedControllerPageReady = useRef(false);
  const { preloadOutlineMedia } = useMediaCache();

  const updateAllItemsAndListFromExternal = useCallback(
    async (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        if (!Array.isArray(updates)) return;
        let refetchOverlayHistory = false;
        for (const _update of updates) {
          if (selectedList && _update._id === selectedList._id) {
            const update = _update as DBItemListDetails;
            const itemList = update.items;
            const overlaysIds = update.overlays || [];
            if (cloud) {
              dispatch(
                updateItemListFromRemote(formatItemList(itemList, cloud))
              );
            }
            const formattedOverlays = await getOverlaysByIds(db!, overlaysIds);
            dispatch(updateOverlayListFromRemote(formattedOverlays));
          }
          if (_update._id === "allItems") {
            const update = _update as DBAllItems;
            dispatch(updateAllItemsListFromRemote(update.items));
          }
          if (_update.docType === "overlay-history") {
            refetchOverlayHistory = true;
          }
        }
        updateAllDocs(dispatch);
        if (refetchOverlayHistory && db) {
          const overlayHistory = await getAllOverlayHistory(db);
          dispatch(mergeOverlayHistoryFromDb(overlayHistory));
        }
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch, cloud, selectedList, db]
  );

  useGlobalBroadcast(updateAllItemsAndListFromExternal);

  const updatePreferencesFromExternal = useCallback(
    async (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        for (const _update of updates) {
          if (_update._id === "preferences") {
            const update = _update as DBPreferences;
            dispatch(updatePreferencesFromRemote(update));
          }
        }
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch]
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
    },
    [setIsMobile, setIsPhone]
  );

  useEffect(() => {
    return () => {
      dispatch({ type: "RESET" });
      dispatch(setAllItemsIsInitialized(false));
      dispatch(setPreferencesIsInitialized(false));
      dispatch(setItemListIsInitialized(false));
      dispatch(setOverlaysIsInitialized(false));
      dispatch(setItemListsIsInitialized(false));
      dispatch(setMediaIsInitialized(false));
      dispatch(setOverlayTemplatesIsInitialized(false));
      dispatch({ type: "RESET_INITIALIZATION" });
      refreshPresentationListeners?.();
    };
  }, [dispatch, refreshPresentationListeners]);

  useEffect(() => {
    const getAllItems = async () => {
      if (!db) return;
      const allItems: DBAllItems | undefined = await db.get("allItems");
      const items = allItems?.items || [];
      const sortedItems = sortNamesInList(items);
      dispatch(initiateAllItemsList(sortedItems));
      updateAllDocs(dispatch);
      deleteUnusedBibleItems({ db, allItems });
      deleteUnusedHeadings({ db, allItems });
    };
    getAllItems();
  }, [dispatch, db]);

  useEffect(() => {
    if (!db) return;
    const getPreferences = async () => {
      try {
        const preferences: DBPreferences | undefined =
          await db.get("preferences");
        dispatch(
          initiatePreferences({
            preferences: preferences.preferences,
            isMusic: access === "music",
          })
        );
        dispatch(initiateQuickLinks(preferences.quickLinks));
        dispatch(initiateMonitorSettings(preferences.monitorSettings));
        dispatch(setPreferencesIsInitialized(true));
      } catch (e) {
        console.error(e);
      } finally {
        dispatch(setIsLoading(false));
      }
    };
    getPreferences();
  }, [dispatch, db, access]);

  useEffect(() => {
    if (!db) return;
    const getTemplates = async () => {
      try {
        const templates: DBOverlayTemplates | undefined =
          await db.get("overlay-templates");
        const templatesByType: TemplatesByType = templates?.templatesByType;
        dispatch(initiateTemplates(templatesByType));
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
    if (
      allControllerSlicesInitialized &&
      !hasDispatchedControllerPageReady.current
    ) {
      hasDispatchedControllerPageReady.current = true;
      dispatch({ type: CONTROLLER_PAGE_READY });
    }
  }, [allControllerSlicesInitialized, dispatch]);

  useEffect(() => {
    if (!db || !window.electronAPI || !activeList?._id) return;
    preloadOutlineMedia(activeList._id).catch((error) => {
      console.warn("Error preloading active outline media:", error);
    });
  }, [activeList?._id, db, preloadOutlineMedia]);

  useEffect(() => {
    if (!db || !window.electronAPI) return;
    const syncMedia = async () => {
      try {
        const mediaUrls = await getMediaUrlsFromMediaDoc(db);
        const urlArray = Array.from(mediaUrls);
        const electronAPI = window.electronAPI as unknown as {
          syncMediaCache: (urls: string[]) => Promise<{
            downloaded: number;
            cleaned: number;
          }>;
          getMediaCacheMap: () => Promise<Record<string, string>>;
        };
        if (urlArray.length > 0) {
          const result = await electronAPI.syncMediaCache(urlArray);
          console.log(
            `Media cache sync: ${result.downloaded} downloaded, ${result.cleaned} cleaned`
          );
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
    const getItemList = async () => {
      if (!selectedList || !db || !cloud) return;
      dispatch(setItemListIsLoading(true));
      try {
        const response: DBItemListDetails | undefined = await db.get(
          selectedList._id
        );
        const itemList = response?.items || [];
        const overlayIds = response?.overlays || [];
        if (cloud) {
          dispatch(initiateItemList(formatItemList(itemList, cloud)));
        }
        const formattedOverlays = await getOverlaysByIds(db, overlayIds);
        dispatch(initiateOverlayList(formattedOverlays));
        const overlayHistory = await getAllOverlayHistory(db);
        dispatch(mergeOverlayHistoryFromDb(overlayHistory));
      } catch (e) {
        console.error(e);
      }
      dispatch(setItemListIsLoading(false));
    };
    getItemList();
  }, [dispatch, db, selectedList, cloud]);

  useEffect(() => {
    if (!updater) return;
    updater.addEventListener("update", updateAllItemsAndListFromExternal);
    return () =>
      updater.removeEventListener("update", updateAllItemsAndListFromExternal);
  }, [updater, updateAllItemsAndListFromExternal]);

  useEffect(() => {
    if (!updater) return;
    updater.addEventListener("update", updatePreferencesFromExternal);
    return () =>
      updater.removeEventListener("update", updatePreferencesFromExternal);
  }, [updater, updatePreferencesFromExternal]);

  return { layoutRef };
};
