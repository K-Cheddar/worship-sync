// import { Resizable } from "re-resizable";
import { ArrowRightFromLine, ArrowLeftFromLine } from "lucide-react";
import EditorButtons from "../../containers/PanelButtons/PanelButtons";
import Media from "../../containers/Media/Media";
import ServiceItems from "../../containers/ServiceItems/ServiceItems";
import Toolbar from "../../containers/Toolbar/Toolbar";
import TransmitHandler from "../../containers/TransmitHandler/TransmitHandler";

import LyricsEditor from "../../containers/ItemEditor/LyricsEditor";

import {
  CSSProperties,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Overlays from "../../containers/Overlays/Overlays";
import Bible from "../../containers/Bible/Bible";
import { useDispatch, useSelector } from "../../hooks";
import {
  initiateAllItemsList,
  updateAllItemsListFromRemote,
} from "../../store/allItemsSlice";
import Songs from "../../containers/Songs/Songs";
import { Route, Routes, useLocation } from "react-router-dom";
import { ControllerInfoContext } from "../../context/controllerInfo";
import Item from "./Item";
import CreateItem from "../../containers/CreateItem/CreateItem";
import FreeForms from "../../containers/FreeForms/FreeForms";
import {
  DBAllItems,
  DBItemListDetails,
  DBPreferences,
  DBOverlayTemplates,
  OVERLAY_HISTORY_ID_PREFIX,
  TemplatesByType,
} from "../../types";
import {
  initiateItemList,
  setIsInitialized as setItemListIsInitialized,
  setItemListIsLoading,
  updateItemListFromRemote,
} from "../../store/itemListSlice";
import {
  initiateOverlayHistory,
  initiateOverlayList,
  updateOverlayListFromRemote,
} from "../../store/overlaysSlice";
import { formatItemList } from "../../utils/formatItemList";
import Button from "../../components/Button/Button";
import Spinner from "../../components/Spinner/Spinner";
import { GlobalInfoContext } from "../../context/globalInfo";
import { sortNamesInList } from "../../utils/sort";
import {
  deleteUnusedBibleItems,
  deleteUnusedHeadings,
  getAllOverlayHistory,
  getOverlaysByIds,
  // formatAllSongs,
  // formatAllDocs,
  // formatAllItems,
  updateAllDocs,
} from "../../utils/dbUtils";
import Timers from "../../containers/Timers/Timers";
import Preferences from "./Preferences";
import QuickLinks from "./QuickLinks";
import MonitorSettings from "./MonitorSettings";
import MonitorControls from "./MonitorControls";
import { useVideoCache } from "../../hooks/useVideoCache";
import { extractVideoUrlsFromItem, extractAllVideoUrlsFromOutlines } from "../../utils/videoCacheUtils";
import {
  initiateMonitorSettings,
  initiatePreferences,
  initiateQuickLinks,
  setIsLoading,
  updatePreferencesFromRemote,
  setIsInitialized as setPreferencesIsInitialized,
} from "../../store/preferencesSlice";
import { initiateTemplates, setIsInitialized as setOverlayTemplatesIsInitialized } from "../../store/overlayTemplatesSlice";
import { initiateMediaList, setIsInitialized as setMediaIsInitialized } from "../../store/mediaSlice";
import { setIsInitialized as setAllItemsIsInitialized } from "../../store/allItemsSlice";
import { setIsInitialized as setOverlaysIsInitialized } from "../../store/overlaysSlice";
import { setIsInitialized as setItemListsIsInitialized } from "../../store/itemListsSlice";
import { setIsEditMode } from "../../store/itemSlice";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import { useSyncOnReconnect } from "../../hooks";
import cn from "classnames";
import { CONTROLLER_PAGE_READY, RootState } from "../../store/store";
import { useSyncRemoteTimers } from "../../hooks";

// Here for future to implement resizable

/* <Resizable
defaultSize={{ width: "30%" }}
className="flex flex-col"
enable={{ ...resizableDirections }}
>
<TransmitHandler />
<Media />
</Resizable> */

// const resizableDirections = {
//   top: false,
//   right: false,
//   bottom: false,
//   left: false,
//   topRight: false,
//   bottomRight: false,
//   bottomLeft: false,
//   topLeft: false,
// };

const Controller = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const { isEditMode } = useSelector(
    (state: RootState) => state.undoable.present.item
  );
  const { selectedList, activeList } = useSelector(
    (state) => state.undoable.present.itemLists
  );

  const { scrollbarWidth } = useSelector(
    (state) => state.undoable.present.preferences
  );

  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);

  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);

  const { db, cloud, updater, setIsMobile, setIsPhone, dbProgress, connectionStatus, pullFromRemote } =
    useContext(ControllerInfoContext) || {};

  const { user, database, access, firebaseDb, hostId, refreshPresentationListeners } =
    useContext(GlobalInfoContext) || {};

  const allControllerSlicesInitialized = useSelector((state: RootState) =>
    state.allItems.isInitialized &&
    state.undoable.present.preferences.isInitialized &&
    state.undoable.present.itemList.isInitialized &&
    state.undoable.present.overlays.isInitialized &&
    state.undoable.present.itemLists.isInitialized &&
    state.media.isInitialized &&
    (state.undoable.present.overlayTemplates as { isInitialized: boolean }).isInitialized
  );
  const hasDispatchedControllerPageReady = useRef(false);

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
  }, [
    dispatch,
    refreshPresentationListeners,
  ]);

  useEffect(() => {
    if (
      location.pathname === "/controller" ||
      location.pathname === "/controller/"
    ) {
      setIsLeftPanelOpen(true);
    }
    if (!location.pathname.includes("/controller/item")) {
      dispatch(setIsEditMode(false));
    }
  }, [location.pathname, dispatch]);

  useEffect(() => {
    // delete unused bible items
    const getAllItems = async () => {
      if (!db) return;
      const allItems: DBAllItems | undefined = await db.get("allItems");
      const items = allItems?.items || [];
      const sortedItems = sortNamesInList(items);
      dispatch(initiateAllItemsList(sortedItems));

      // Get all docs for searching
      updateAllDocs(dispatch);

      // delete unneeded bible items
      deleteUnusedBibleItems({ db, allItems });

      // delete unused headings
      deleteUnusedHeadings({ db, allItems });
    };
    getAllItems();
  }, [dispatch, db]);

  // Leaving this in case we need to reformat all songs in the db
  // useEffect(() => {
  // if (!db || !cloud) return;
  // formatAllSongs(db, cloud);
  // }, [db, cloud]);

  useEffect(() => {
    if (!db) return;
    console.log("getting preferences", { access });
    const getPreferences = async () => {
      try {
        const preferences: DBPreferences | undefined =
          await db.get("preferences");
        console.log("preferences", preferences);
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

  // Media panel only mounts when access === "full". Initialize media slice with
  // empty list when not full access so undo/redo init can complete.
  useEffect(() => {
    if (db && access !== "full") {
      dispatch(initiateMediaList([]));
    }
  }, [dispatch, db, access]);

  useEffect(() => {
    if (allControllerSlicesInitialized && !hasDispatchedControllerPageReady.current) {
      hasDispatchedControllerPageReady.current = true;
      dispatch({ type: CONTROLLER_PAGE_READY });
    }
  }, [allControllerSlicesInitialized, dispatch]);

  // Get item state to watch for changes
  const item = useSelector((state: RootState) => state.undoable.present.item);
  const { syncVideoCache, preloadOutlineVideos } = useVideoCache();
  const itemSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousVideoUrlsRef = useRef<Set<string>>(new Set());

  // Extract video URLs from current item (memoized to avoid recalculation)
  const currentVideoUrls = useMemo(() => {
    if (!item._id) return new Set<string>();
    const urls = extractVideoUrlsFromItem(item);
    return new Set(urls);
  }, [item]);

  // Preload videos from active outline when it changes (Strategy A: Proactive Outline Preloading)
  useEffect(() => {
    if (!db || !window.electronAPI || !activeList?._id) return;

    // Preload videos from the active outline in the background
    preloadOutlineVideos(activeList._id).catch((error) => {
      console.warn("Error preloading active outline videos:", error);
    });
  }, [activeList?._id, db, preloadOutlineVideos]);

  // Sync video cache when database is ready (only in Electron)
  useEffect(() => {
    if (!db || !window.electronAPI) return;

    const syncVideos = async () => {
      try {
        const videoUrls = await extractAllVideoUrlsFromOutlines(db);
        const urlArray = Array.from(videoUrls);

        const electronAPI = window.electronAPI as unknown as {
          syncVideoCache: (urls: string[]) => Promise<{ downloaded: number; cleaned: number }>
        };

        if (urlArray.length > 0) {
          const result = await electronAPI.syncVideoCache(urlArray);
          console.log(
            `Video cache sync: ${result.downloaded} downloaded, ${result.cleaned} cleaned`
          );
        } else {
          // No videos, just cleanup
          await electronAPI.syncVideoCache([]);
        }
      } catch (error) {
        console.error("Error syncing video cache:", error);
      }
    };

    // Delay sync slightly to ensure database is fully loaded
    const timeoutId = setTimeout(syncVideos, 2000);
    return () => clearTimeout(timeoutId);
  }, [db]);

  // Sync video cache when item video URLs change (debounced, only in Electron)
  useEffect(() => {
    if (!db || !window.electronAPI || !item._id) return;

    // Check if video URLs actually changed
    const urlsChanged =
      currentVideoUrls.size !== previousVideoUrlsRef.current.size ||
      Array.from(currentVideoUrls).some((url) => !previousVideoUrlsRef.current.has(url)) ||
      Array.from(previousVideoUrlsRef.current).some((url) => !currentVideoUrls.has(url));

    if (urlsChanged) {
      // Update ref for next comparison
      previousVideoUrlsRef.current = new Set(currentVideoUrls);

      // Clear existing timeout
      if (itemSyncTimeoutRef.current) {
        clearTimeout(itemSyncTimeoutRef.current);
      }

      // Debounce sync - wait 2 seconds after last change (longer than media list since items save with delay)
      itemSyncTimeoutRef.current = setTimeout(() => {
        syncVideoCache().catch((error: unknown) => {
          console.warn("Error syncing video cache after item change:", error);
        });
      }, 2000);
    }

    // Cleanup timeout on unmount
    return () => {
      if (itemSyncTimeoutRef.current) {
        clearTimeout(itemSyncTimeoutRef.current);
      }
    };
  }, [currentVideoUrls, item._id, db, syncVideoCache]);

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
        dispatch(initiateOverlayHistory(overlayHistory));
      } catch (e) {
        console.error(e);
      }
      dispatch(setItemListIsLoading(false));
    };

    getItemList();
  }, [dispatch, db, selectedList, cloud]);

  const updateAllItemsAndListFromExternal = useCallback(
    async (event: CustomEventInit) => {
      try {
        const updates = event.detail as { _id?: string; docType?: string }[] | undefined;
        if (!Array.isArray(updates)) return;
        let refetchOverlayHistory = false;
        for (const _update of updates) {
          if (selectedList && _update._id === selectedList._id) {
            console.log("updating selected item list from remote", event);
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
            console.log("updating all items from remote", event);
            const update = _update as DBAllItems;
            dispatch(updateAllItemsListFromRemote(update.items));
          }
          if (
            _update.docType === "overlay-history" ||
            (typeof _update._id === "string" && _update._id.startsWith(OVERLAY_HISTORY_ID_PREFIX))
          ) {
            refetchOverlayHistory = true;
          }
        }

        updateAllDocs(dispatch);

        if (refetchOverlayHistory && db) {
          const overlayHistory = await getAllOverlayHistory(db);
          dispatch(initiateOverlayHistory(overlayHistory));
        }
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch, cloud, selectedList, db]
  );

  useEffect(() => {
    if (!updater) return;

    updater.addEventListener("update", updateAllItemsAndListFromExternal);

    return () =>
      updater.removeEventListener("update", updateAllItemsAndListFromExternal);
  }, [updater, updateAllItemsAndListFromExternal]);

  useGlobalBroadcast(updateAllItemsAndListFromExternal);

  const updatePreferencesFromExternal = useCallback(
    async (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        for (const _update of updates) {
          if (_update._id === "preferences") {
            console.log("updating preferences from remote");
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

  useEffect(() => {
    if (!updater) return;

    updater.addEventListener("update", updatePreferencesFromExternal);

    return () =>
      updater.removeEventListener("update", updatePreferencesFromExternal);
  }, [updater, updatePreferencesFromExternal]);

  useGlobalBroadcast(updatePreferencesFromExternal);

  useSyncRemoteTimers(firebaseDb, database, user, hostId);
  useSyncOnReconnect(pullFromRemote);

  const controllerRef = useCallback(
    (node: HTMLDivElement) => {
      if (node) {
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
      }
    },
    [setIsMobile, setIsPhone]
  );

  const handleElementClick = (element: any) => {
    if (!leftPanelRef.current?.contains(element.target) && isLeftPanelOpen) {
      setIsLeftPanelOpen(false);
    }

    if (!rightPanelRef.current?.contains(element.target) && isRightPanelOpen) {
      setIsRightPanelOpen(false);
    }
  };

  return (
    <>
      {dbProgress !== 100 && (
        <div className="fixed top-0 left-0 z-50 bg-gray-800/85 w-full h-full flex justify-center items-center flex-col text-white text-2xl gap-8">
          {connectionStatus?.status === "failed" ? (
            <>
              <p className="text-center">
                Unable to connect to the server
              </p>
              <p className="text-lg text-gray-300 text-center max-w-md">
                Oh no! We encountered an unexpected error.
                Please try again later.
              </p>
              <Button
                onClick={() => window.location.reload()}
                variant="cta"
                padding="px-4 py-2"
              >
                Try Again
              </Button>
            </>
          ) : (
            <>
              <p>
                Setting up <span className="font-bold">Worship</span>
                <span className="text-orange-500 font-semibold">Sync</span> for{" "}
                <span className="font-semibold">{user}</span>
              </p>
              {connectionStatus?.status === "retrying" && (
                <p className="text-lg text-yellow-400">
                  Connection failed. Retrying...
                </p>
              )}
              <Spinner />
              {dbProgress !== 0 && (
                <p>
                  Progress: <span className="text-orange-500">{dbProgress}%</span>
                </p>
              )}
            </>
          )}
        </div>
      )}
      <div
        onClick={(e) => handleElementClick(e)}
        className="bg-gray-700 w-dvw h-dvh flex flex-col text-white overflow-hidden list-none"
        style={
          {
            "--scrollbar-width": scrollbarWidth,
          } as CSSProperties
        }
      >
        <Toolbar className="flex border-b-2 border-gray-500 text-sm min-h-fit bg-gray-700" />
        <div
          id="controller-main"
          className="flex flex-1 relative min-h-0 bg-gray-700"
          ref={controllerRef}
        >
          <LyricsEditor />
          <Button
            className={cn("lg:hidden mr-2 h-1/4 z-10", isEditMode && "hidden")}
            svg={isLeftPanelOpen ? ArrowLeftFromLine : ArrowRightFromLine}
            onClick={() => setIsLeftPanelOpen(!isLeftPanelOpen)}
          />
          <div
            className={`flex flex-col border-r-2 border-gray-500 bg-gray-700 h-full lg:w-[15%] max-lg:absolute max-lg:left-0 transition-all ${isLeftPanelOpen ? "w-[60%] max-lg:z-10" : "w-0 max-lg:z-[-1]"
              }`}
            ref={leftPanelRef}
          >
            <Button
              className="lg:hidden text-sm mb-2 justify-center"
              svg={isLeftPanelOpen ? ArrowLeftFromLine : ArrowRightFromLine}
              onClick={() => setIsLeftPanelOpen(!isLeftPanelOpen)}
            >
              Close Panel
            </Button>
            <EditorButtons access={access} />
            <ServiceItems />
          </div>
          <div className="flex flex-col flex-1 relative w-[60%] h-full">
            <Routes>
              <Route
                path="/"
                element={
                  <h2 className="text-2xl text-center mt-4 font-bold">
                    No Item Selected
                  </h2>
                }
              />
              <Route path="/item/:itemId/:listId" element={<Item />} />
              <Route path="overlays" element={<Overlays />} />
              <Route path="bible" element={<Bible />} />
              <Route path="songs" element={<Songs />} />
              <Route path="free" element={<FreeForms />} />
              <Route path="timers" element={<Timers />} />
              <Route path="create" element={<CreateItem />} />
              <Route path="preferences" element={<Preferences />} />
              <Route path="quick-links" element={<QuickLinks />} />
              <Route path="monitor-settings" element={<MonitorSettings />} />
              <Route path="monitor-controls" element={<MonitorControls />} />
            </Routes>
          </div>

          {access === "full" && (
            <>
              <Button
                className={cn(
                  "lg:hidden text-sm ml-2 justify-center h-1/4 z-10",
                  isEditMode && "hidden"
                )}
                svg={isRightPanelOpen ? ArrowRightFromLine : ArrowLeftFromLine}
                onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
              />
              <div
                className={`flex flex-col h-full lg:w-[25%] bg-gray-700 border-gray-500 transition-all border-l-2 max-lg:right-0 max-lg:absolute ${isRightPanelOpen ? "w-[65%] max-lg:z-10" : "w-0 max-lg:z-[-1]"
                  }`}
                ref={rightPanelRef}
              >
                <Button
                  className="lg:hidden text-sm mb-2 justify-center"
                  svg={
                    isRightPanelOpen ? ArrowRightFromLine : ArrowLeftFromLine
                  }
                  onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
                >
                  Close Panel
                </Button>
                <TransmitHandler />
                <Media />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default Controller;
