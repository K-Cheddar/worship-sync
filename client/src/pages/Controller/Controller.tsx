import { Resizable } from "re-resizable";
import EditorButtons from "../../containers/PanelButtons/PanelButtons";
import Media from "../../containers/Media/Media";
import ServiceItems from "../../containers/ServiceItems/ServiceItems";
import Toolbar from "../../containers/Toolbar/Toolbar";
import TransmitHandler from "../../containers/TransmitHandler/TransmitHandler";

import "./Controller.scss";
import LyricsEditor from "../../containers/ItemEditor/LyricsEditor";
import { useContext, useEffect } from "react";
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
import { DBAllItems, DBItemListDetails } from "../../types";
import {
  initiateItemList,
  setItemListIsLoading,
} from "../../store/itemListSlice";
import { initiateOverlayList } from "../../store/overlaysSlice";
import { formatItemList } from "../../utils/formatItemList";

const resizableDirections = {
  top: false,
  right: false,
  bottom: false,
  left: false,
  topRight: false,
  bottomRight: false,
  bottomLeft: false,
  topLeft: false,
};

const Controller = () => {
  const dispatch = useDispatch();

  const { selectedList } = useSelector(
    (state) => state.undoable.present.itemLists
  );

  const { db, cloud, updater } = useContext(ControllerInfoContext) || {};

  useEffect(() => {
    const getAllItems = async () => {
      const response: DBAllItems | undefined = await db?.get("allItems");
      const items = response?.items || [];
      dispatch(initiateAllItemsList(items));
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

  useEffect(() => {}, []);

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

  return (
    <div className="bg-slate-700 w-screen h-screen flex flex-col text-white overflow-hidden list-none">
      <Toolbar className="flex border-b-2 border-slate-500 h-10 text-sm" />
      <div className="controller-main ">
        <LyricsEditor />
        <Resizable
          defaultSize={{ width: "15%" }}
          className="flex flex-col border-r-2 border-slate-500"
          enable={resizableDirections}
        >
          <EditorButtons />
          <ServiceItems />
        </Resizable>
        <Resizable
          defaultSize={{ width: "55%" }}
          className="flex flex-col flex-1 border-r-2 border-slate-500 relative"
          enable={resizableDirections}
        >
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
        </Resizable>
        <Resizable
          defaultSize={{ width: "30%" }}
          className="flex flex-col"
          enable={{ ...resizableDirections }}
        >
          <TransmitHandler className="flex flex-col mt-2 gap-4 w-fit items-center h-fit bg-slate-800 p-4 rounded-lg mx-auto" />
          <Media />
        </Resizable>
      </div>
    </div>
  );
};

export default Controller;
