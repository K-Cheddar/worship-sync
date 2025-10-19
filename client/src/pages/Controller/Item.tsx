import { useParams } from "react-router-dom";
import SlideEditor from "../../containers/ItemEditor/SlideEditor";
import ItemSlides from "../../containers/ItemSlides/ItemSlides";
import { useContext, useEffect, useMemo, useState } from "react";
import { DBItem } from "../../types";
import { useDispatch } from "../../hooks";
import { setActiveItem, setItemIsLoading } from "../../store/itemSlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { setActiveItemInList } from "../../store/itemListSlice";
import { GlobalInfoContext } from "../../context/globalInfo";

const Item = () => {
  const { itemId, listId } = useParams();
  const { db, cloud } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};

  const decodedItemId = useMemo(() => {
    try {
      return decodeURI(window.atob(itemId || ""));
    } catch {
      return "";
    }
  }, [itemId]);

  const decodedListId = useMemo(() => {
    try {
      return decodeURI(window.atob(listId || ""));
    } catch {
      return "";
    }
  }, [listId]);

  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading"
  );
  const dispatch = useDispatch();

  useEffect(() => {
    const selectItem = async () => {
      if (!db || !cloud) return;
      try {
        dispatch(setItemIsLoading(true));
        const response: DBItem | undefined = await db?.get(decodedItemId);
        const item = response;
        if (!item) return setStatus("error");
        dispatch(setActiveItem({ ...item, listId: decodedListId }));
        dispatch(setActiveItemInList(decodedListId));
        setStatus("success");
        dispatch(setItemIsLoading(false));
      } catch (e) {
        console.error(e);
        setStatus("error");
      }
    };
    selectItem();
  }, [decodedItemId, dispatch, db, decodedListId, cloud]);

  if (status === "error")
    return (
      <h2 className="text-2xl text-center mt-4 font-bold">Item Not Found</h2>
    );

  return (
    <>
      <SlideEditor access={access} />
      <ItemSlides />
    </>
  );
};

export default Item;
