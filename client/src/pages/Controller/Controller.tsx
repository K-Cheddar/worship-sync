// import { Resizable } from "re-resizable";
import { ReactComponent as ExpandSVG } from "../../assets/icons/left-panel-open.svg";
import { ReactComponent as CollapseSVG } from "../../assets/icons/left-panel-close.svg";
import EditorButtons from "../../containers/PanelButtons/PanelButtons";
import Media from "../../containers/Media/Media";
import ServiceItems from "../../containers/ServiceItems/ServiceItems";
import Toolbar from "../../containers/Toolbar/Toolbar";
import TransmitHandler from "../../containers/TransmitHandler/TransmitHandler";

import "./Controller.scss";
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
import { DBAllItems, DBItemListDetails, DBPreferences } from "../../types";
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
import { deleteUnusedBibleItems, updateAllDocs } from "../../utils/dbUtils";
import Timers from "../../containers/Timers/Timers";
import Preferences from "./Preferences";
import {
  initiatePreferences,
  initiateQuickLinks,
  setIsLoading,
} from "../../store/preferencesSlice";

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

  const { selectedList } = useSelector(
    (state) => state.undoable.present.itemLists
  );

  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(0);

  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);

  const { db, cloud, updater, setIsMobile, dbProgress } =
    useContext(ControllerInfoContext) || {};

  const { user } = useContext(GlobalInfoContext) || {};

  useEffect(() => {
    if (location.pathname === "/controller") {
      setIsLeftPanelOpen(true);
    }
  }, [location.pathname]);

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
    };
    getAllItems();
  }, [dispatch, db]);

  useEffect(() => {
    if (!db) return;
    const getPreferences = async () => {
      try {
        const preferences: DBPreferences | undefined = await db.get(
          "preferences"
        );
        dispatch(initiatePreferences(preferences.preferences));
        dispatch(initiateQuickLinks(preferences.quickLinks));
      } catch (e) {
        console.error(e);
      } finally {
        dispatch(setIsLoading(false));
      }
    };
    getPreferences();
  }, [dispatch, db]);

  useEffect(() => {
    const getItemList = async () => {
      if (!selectedList || !db || !cloud) return;
      dispatch(setItemListIsLoading(true));
      try {
        const response: DBItemListDetails | undefined = await db?.get(
          selectedList._id
        );
        const itemList = response?.items || [];
        const overlays = response?.overlays || [];
        if (cloud) {
          dispatch(initiateItemList(formatItemList(itemList, cloud)));
        }
        dispatch(initiateOverlayList(overlays));
      } catch (e) {
        console.error(e);
      }
      dispatch(setItemListIsLoading(false));
    };

    getItemList();
  }, [dispatch, db, selectedList, cloud]);

  useEffect(() => {
    if (!updater || !selectedList) return;
    const updateAllItemsAndList = async (event: CustomEventInit) => {
      try {
        const updates = event.detail;
        for (const _update of updates) {
          // check if the list we have selected was updated
          if (_update._id === selectedList._id) {
            console.log("updating selected item list from remote", event);
            const update = _update as DBItemListDetails;
            const itemList = update.items;
            const overlays = update.overlays;
            if (cloud) {
              dispatch(
                updateItemListFromRemote(formatItemList(itemList, cloud))
              );
            }
            dispatch(updateOverlayListFromRemote(overlays));
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
    };

    updater.addEventListener("update", updateAllItemsAndList);

    return () => updater.removeEventListener("update", updateAllItemsAndList);
  }, [updater, dispatch, cloud, selectedList]);

  const controllerRef = useCallback(
    (node: HTMLDivElement) => {
      if (node) {
        const resizeObserver = new ResizeObserver((entries) => {
          const width = entries[0].borderBoxSize[0].inlineSize;
          if (width < 1024) {
            setIsMobile?.(true);
          } else {
            setIsMobile?.(false);
          }
        });

        resizeObserver.observe(node);
      }
    },
    [setIsMobile]
  );

  const toolbarRef = useCallback((node: HTMLDivElement) => {
    if (node) {
      const resizeObserver = new ResizeObserver((entries) => {
        setToolbarHeight(entries[0].borderBoxSize[0].blockSize);
      });

      resizeObserver.observe(node);
    }
  }, []);

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
          <p>
            Progress: <span className="text-orange-500">{dbProgress}%</span>
          </p>
        </div>
      )}
      <div
        onClick={(e) => handleElementClick(e)}
        className="bg-gray-700 w-screen h-screen flex flex-col text-white overflow-hidden list-none"
        style={
          {
            "--toolbar-height": `${toolbarHeight}px`,
          } as CSSProperties
        }
      >
        <Toolbar
          ref={toolbarRef}
          className="flex border-b-2 border-gray-500 text-sm min-h-fit"
        />
        <div className="controller-main" ref={controllerRef}>
          <LyricsEditor />
          <Button
            className="lg:hidden mr-2 h-1/4 z-10"
            svg={isLeftPanelOpen ? CollapseSVG : ExpandSVG}
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
              svg={isLeftPanelOpen ? CollapseSVG : ExpandSVG}
              onClick={() => setIsLeftPanelOpen(!isLeftPanelOpen)}
            >
              Close Panel
            </Button>
            <EditorButtons />
            <ServiceItems />
          </div>
          <div className="flex flex-col flex-1 relative w-[55%]">
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
            </Routes>
          </div>

          <Button
            className="lg:hidden text-sm ml-2 justify-center h-1/4 z-10"
            svg={isRightPanelOpen ? ExpandSVG : CollapseSVG}
            onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
          />
          <div
            className={`flex flex-col lg:w-[30%] bg-gray-700 border-gray-500 max-lg:absolute h-full transition-all border-l-2 max-lg:right-0 ${
              isRightPanelOpen ? "w-[65%] max-lg:z-10" : "w-0 max-lg:z-[-1]"
            }`}
            ref={rightPanelRef}
          >
            <Button
              className="lg:hidden text-sm mb-2 justify-center"
              svg={isRightPanelOpen ? ExpandSVG : CollapseSVG}
              onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
            >
              Close Panel
            </Button>
            <TransmitHandler />
            <Media />
          </div>
        </div>
      </div>
    </>
  );
};

export default Controller;
