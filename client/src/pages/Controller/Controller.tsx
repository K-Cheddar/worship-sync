import { Resizable } from "re-resizable";
import EditorButtons from "../../containers/PanelButtons/PanelButtons";
import Media from "../../containers/Media/Media";
import ServiceItems from "../../containers/ServiceItems/ServiceItems";
import Toolbar from "../../containers/Toolbar/Toolbar";
import TransmitHandler from "../../containers/TransmitHandler/TransmitHandler";

import "./Controller.scss";
import LyricsEditor from "../../containers/ItemEditor/LyricsEditor";
import { useEffect } from "react";
import Participants from "../../containers/Participants/Participants";
import Bible from "../../containers/Bible/Bible";
import { useDispatch } from "../../hooks";
import { updateAllItemsList } from "../../store/allItems";
import Songs from "../../containers/Songs/Songs";
import { Route, Routes } from "react-router-dom";
import BibleDbProvider from "../../context/bibleDb";
import Item from "./Item";
import CreateItem from "../../containers/CreateItem/CreateItem";

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

  useEffect(() => {
    const getAllItems = async () => {
      const response = await fetch(
        "http://localhost:3000/dummyDB/allItems.json"
      );
      const data = await response.json();
      dispatch(updateAllItemsList(data));
    };

    getAllItems();
  }, [dispatch]);

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
            <Route path="participants" element={<Participants />} />
            <Route
              path="bible"
              element={
                <BibleDbProvider>
                  <Bible />
                </BibleDbProvider>
              }
            />
            <Route path="songs" element={<Songs />} />
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
