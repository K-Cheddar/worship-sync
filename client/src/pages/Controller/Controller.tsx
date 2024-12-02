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
import { useCallback, useContext, useEffect, useState } from "react";
import Overlays from "../../containers/Overlays/Overlays";
import Bible from "../../containers/Bible/Bible";
import { useDispatch, useSelector } from "../../hooks";
import { initiateAllItemsList } from "../../store/allItemsSlice";
import Songs from "../../containers/Songs/Songs";
import { Route, Routes } from "react-router-dom";
import { ControllerInfoContext } from "../../context/controllerInfo";
import Item from "./Item";
import CreateItem from "../../containers/CreateItem/CreateItem";
import FreeForms from "../../containers/FreeForms/FreeForms";
import {
  DBAllItems,
  DBItemListDetails,
  DBItemLists,
  ServiceItem,
} from "../../types";
import {
  initiateItemList,
  setItemListIsLoading,
} from "../../store/itemListSlice";
import { initiateOverlayList } from "../../store/overlaysSlice";
import { formatItemList } from "../../utils/formatItemList";
import Button from "../../components/Button/Button";

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

  const { selectedList } = useSelector(
    (state) => state.undoable.present.itemLists
  );

  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);

  const { db, cloud, updater, setIsMobile } =
    useContext(ControllerInfoContext) || {};

  useEffect(() => {
    const getAllItems = async () => {
      if (!db) return;
      const allItems: DBAllItems | undefined = await db.get("allItems");
      const items = allItems?.items || [];
      dispatch(initiateAllItemsList(items));

      // delete unneeded bible items

      let bibleItems = items.filter((item) => item.type === "bible");

      const allItemLists: DBItemLists | undefined = await db.get("ItemLists");
      const itemLists = allItemLists?.itemLists || [];
      const bibleItemsInLists: ServiceItem[] = [];

      for (const itemList of itemLists) {
        const listDetails: DBItemListDetails = await db.get(itemList.id);
        const listItems = listDetails?.items || [];
        bibleItemsInLists.push(
          ...listItems.filter((item) => item.type === "bible")
        );
      }

      const bibleItemsToBeDeleted = bibleItems.filter(
        (bibleItem) =>
          !bibleItemsInLists.some(
            (bibleItemInList) => bibleItemInList._id === bibleItem._id
          )
      );

      if (bibleItemsToBeDeleted.length === 0) return; // nothing to delete

      const updatedItems = items.filter(
        (item) => !bibleItemsToBeDeleted.includes(item)
      );

      // Remove bible items from all items and delete them individually
      await db.put({ ...allItems, items: updatedItems });
      for (const item of bibleItemsToBeDeleted) {
        try {
          const doc = await db.get(item._id);
          db.remove(doc);
        } catch (error) {
          console.error(error);
        }
      }
    };
    getAllItems();

    // updater?.addEventListener("update", () => {
    //   console.log("updating all items from update event");
    //   getAllItems();
    // });

    // return () => {
    //   updater?.removeEventListener("update", getAllItems);
    // };
  }, [dispatch, db]);

  useEffect(() => {
    const getItemList = async () => {
      if (!selectedList || !db || !cloud) return;
      dispatch(setItemListIsLoading(true));
      try {
        const response: DBItemListDetails | undefined = await db?.get(
          selectedList.id
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

    // updater?.addEventListener("update", () => {
    //   console.log("updating itemList from update event");
    //   getItemList();
    // });

    // return () => {
    //   updater?.removeEventListener("update", getItemList);
    // };
  }, [dispatch, db, selectedList, cloud]);

  const controllerRef = useCallback(
    (node: HTMLDivElement) => {
      if (node) {
        const resizeObserver = new ResizeObserver((entries) => {
          const width = entries[0].borderBoxSize[0].inlineSize;
          if (width < 768) {
            setIsLeftPanelOpen(false);
            setIsRightPanelOpen(false);
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

  return (
    <div className="bg-slate-700 w-screen h-screen flex flex-col text-white overflow-hidden list-none">
      <Toolbar className="flex border-b-2 border-slate-500 h-10 text-sm min-h-fit" />
      <div className="controller-main" ref={controllerRef}>
        <LyricsEditor />
        <Button
          className="md:hidden mr-2"
          svg={isLeftPanelOpen ? CollapseSVG : ExpandSVG}
          onClick={() => setIsLeftPanelOpen(!isLeftPanelOpen)}
        />
        <div
          className={`flex flex-col border-r-2 border-slate-500 bg-slate-700 h-full md:w-[15%] max-md:absolute max-md:left-0 ${
            isLeftPanelOpen ? "w-fit max-md:z-10" : "w-0 max-md:z-[-1]"
          }`}
        >
          <Button
            className="md:hidden text-sm mb-2 justify-center"
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
            <Route path="create" element={<CreateItem />} />
          </Routes>
        </div>

        <Button
          className="md:hidden text-sm ml-2 justify-center"
          svg={isRightPanelOpen ? ExpandSVG : CollapseSVG}
          onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
        />
        <div
          className={`flex flex-col md:w-[30%] max-md:w-[65%] bg-slate-700 border-slate-500 max-md:absolute h-full border-l-2 max-md:right-0 ${
            isRightPanelOpen ? "w-fit max-md:z-10" : "w-0 max-md:z-[-1]"
          }`}
        >
          <Button
            className="md:hidden text-sm mb-2 justify-center"
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
  );
};

export default Controller;
