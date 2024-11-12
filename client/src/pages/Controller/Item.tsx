import { useParams } from "react-router-dom";
import SlideEditor from "../../containers/ItemEditor/SlideEditor";
import ItemSlides from "../../containers/ItemSlides/ItemSlides";
import { useContext, useEffect, useMemo, useState } from "react";
import { DBItem } from "../../types";
import { formatItemInfo } from "../../utils/formatItemInfo";
import { useDispatch } from "../../hooks";
import { setActiveItem } from "../../store/itemSlice";
import { RemoteDbContext } from "../../context/remoteDb";

const Item = () => {
  const { itemId } = useParams();
  const { db } = useContext(RemoteDbContext) || {};

  const decodedItemId = useMemo(() => {
    try {
      return decodeURI(window.atob(itemId || ""));
    } catch {
      return "";
    }
  }, [itemId]);

  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading"
  );
  const dispatch = useDispatch();

  useEffect(() => {
    const selectItem = async () => {
      try {
        console.log(decodedItemId);
        const response: DBItem | undefined = await db?.get(decodedItemId);
        const item = response;
        if (!item) return setStatus("error");
        const formattedItem = await formatItemInfo(item);
        dispatch(setActiveItem({ ...formattedItem }));
        setStatus("success");
      } catch (e) {
        console.error(e);
        setStatus("error");
      }
    };
    selectItem();
  }, [decodedItemId, dispatch, db]);

  if (status === "error")
    return (
      <h2 className="text-2xl text-center mt-4 font-bold">Item Not Found</h2>
    );

  return (
    <>
      <SlideEditor />
      <ItemSlides />
    </>
  );
};

export default Item;
