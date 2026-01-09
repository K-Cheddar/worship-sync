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
  DBOverlay,
  DBPreferences,
  DBOverlayTemplates,
  TemplatesByType,
  OverlayInfo,
} from "../../types";
import {
  initiateItemList,
  setItemListIsLoading,
  updateItemListFromRemote,
} from "../../store/itemListSlice";
import {
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
  deleteUnusedOverlays,
  // formatAllSongs,
  // formatAllDocs,
  // formatAllItems,
  updateAllDocs,
} from "../../utils/dbUtils";
import Timers from "../../containers/Timers/Timers";
import Preferences from "./Preferences";
import QuickLinks from "./QuickLinks";
import MonitorSettings from "./MonitorSettings";
import {
  initiateMonitorSettings,
  initiatePreferences,
  initiateQuickLinks,
  setIsLoading,
  updatePreferencesFromRemote,
} from "../../store/preferencesSlice";
import { initiateTemplates } from "../../store/overlayTemplatesSlice";
import { setIsEditMode } from "../../store/itemSlice";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import cn from "classnames";
import { RootState } from "../../store/store";
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
  const { selectedList } = useSelector(
    (state) => state.undoable.present.itemLists
  );

  const { scrollbarWidth } = useSelector(
    (state) => state.undoable.present.preferences
  );

  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);

  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);

  const { db, cloud, updater, setIsMobile, setIsPhone, dbProgress } =
    useContext(ControllerInfoContext) || {};

  const { user, access, firebaseDb, hostId, refreshPresentationListeners } =
    useContext(GlobalInfoContext) || {};

  useEffect(() => {
    return () => {
      dispatch({ type: "RESET" });
      dispatch({ type: "RESET_INITIALIZATION" });
      refreshPresentationListeners?.();
    };
  }, [dispatch, refreshPresentationListeners]);

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

      // delete unused overlays
      deleteUnusedOverlays(db);
    };
    getAllItems();
  }, [dispatch, db]);

  // Leaving this in case we need to reformat all songs in the db
  // useEffect(() => {
  //   if (!db || !cloud) return;
  //   // formatAllSongs(db, cloud);
  // }, [db, cloud]);

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

        const formattedOverlays: OverlayInfo[] = [];

        for (const overlayId of overlayIds) {
          const overlayDetails: DBOverlay | undefined = await db.get(
            `overlay-${overlayId}`
          );
          if (overlayDetails && !overlayDetails.isHidden) {
            formattedOverlays.push(overlayDetails);
          }
        }

        dispatch(initiateOverlayList(formattedOverlays));
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
        const updates = event.detail;
        for (const _update of updates) {
          // check if the list we have selected was updated
          if (selectedList && _update._id === selectedList._id) {
            console.log("updating selected item list from remote", event);
            const update = _update as DBItemListDetails;
            const itemList = update.items;
            const overlaysIds = update.overlays;
            if (cloud) {
              dispatch(
                updateItemListFromRemote(formatItemList(itemList, cloud))
              );
            }

            const formattedOverlays: OverlayInfo[] = [];

            for (const overlayId of overlaysIds) {
              const overlayDetails: DBOverlay | undefined = await db?.get(
                `overlay-${overlayId}`
              );
              if (overlayDetails && !overlayDetails.isHidden) {
                formattedOverlays.push(overlayDetails);
              }
            }
            dispatch(updateOverlayListFromRemote(formattedOverlays));
          }
          if (_update._id === "allItems") {
            console.log("updating all items from remote", event);
            const update = _update as DBAllItems;
            dispatch(updateAllItemsListFromRemote(update.items));
          }
        }

        // keep all docs up to date
        updateAllDocs(dispatch);
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

  useSyncRemoteTimers(firebaseDb, user, hostId);

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
          <p>
            Setting up <span className="font-bold">Worship</span>
            <span className="text-orange-500 font-semibold">Sync</span> for{" "}
            <span className="font-semibold">{user}</span>
          </p>
          <Spinner />
          {dbProgress !== 0 && (
            <p>
              Progress: <span className="text-orange-500">{dbProgress}%</span>
            </p>
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
            className={`flex flex-col border-r-2 border-gray-500 bg-gray-700 h-full lg:w-[15%] max-lg:absolute max-lg:left-0 transition-all ${
              isLeftPanelOpen ? "w-[60%] max-lg:z-10" : "w-0 max-lg:z-[-1]"
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
          <div className="flex flex-col flex-1 relative w-[55%] h-full">
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
                className={`flex flex-col h-full lg:w-[30%] bg-gray-700 border-gray-500 transition-all border-l-2 max-lg:right-0 max-lg:absolute ${
                  isRightPanelOpen ? "w-[65%] max-lg:z-10" : "w-0 max-lg:z-[-1]"
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
