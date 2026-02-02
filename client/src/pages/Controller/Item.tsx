import { useParams } from "react-router-dom";
import SlideEditor from "../../containers/ItemEditor/SlideEditor";
import ItemSlides from "../../containers/ItemSlides/ItemSlides";
import { useContext, useEffect, useMemo, useState } from "react";
import { DBItem } from "../../types";
import { useDispatch, useSelector } from "../../hooks";
import { setActiveItem, setItemIsLoading } from "../../store/itemSlice";
import { RootState } from "../../store/store";
import LoadingOverlay from "../../components/LoadingOverlay/LoadingOverlay";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { setActiveItemInList } from "../../store/itemListSlice";
import { GlobalInfoContext } from "../../context/globalInfo";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";

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
  const { isLoading, isSectionLoading } = useSelector(
    (state: RootState) => state.undoable.present.item
  );
  const showLoadingOverlay = isLoading || isSectionLoading;

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
    <ErrorBoundary>
      <div className="flex-1 min-h-0 flex flex-col">
        <SlideEditor access={access} />
        <LoadingOverlay isLoading={!!showLoadingOverlay} className="flex-1 min-h-0">
          <ItemSlides />
        </LoadingOverlay>
      </div>
    </ErrorBoundary>
  );
};

export default Item;
