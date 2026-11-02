import { useContext, useEffect, useRef } from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useDispatch, useSelector } from "../../hooks";
import { selectControllerItem } from "../../store/controllerItemSelection";

/** Restore the session's established occurrence, never a later selection-only action. */
const ControllerItemInitialization = () => {
  const { db } = useContext(ControllerInfoContext) || {};
  const dispatch = useDispatch();
  const type = useSelector((state) => state.undoable.present.item.type);
  const listId = useSelector((state) => state.undoable.present.item.listId);
  const { list, selectedItemListId, isInitialized } = useSelector((state) => state.undoable.present.itemList);
  const session = useSelector((state) => state.allDocs.session);
  const cacheInitialized = useSelector((state) => state.allDocs.isInitialized);
  const initial = useRef<{ session: number; listId?: string }>({ session });

  useEffect(() => {
    if (initial.current.session !== session) initial.current = { session };
    if (!isInitialized) return;
    initial.current.listId ??= selectedItemListId;
    const establishedListId = initial.current.listId;
    if (type || listId || !cacheInitialized || !establishedListId || selectedItemListId !== establishedListId) return;
    const selected = list.find((item) => item.listId === establishedListId);
    if (selected && selected.type !== "heading") void dispatch(selectControllerItem(selected, db));
  }, [type, listId, isInitialized, cacheInitialized, session, list, selectedItemListId, db, dispatch]);
  return null;
};

export default ControllerItemInitialization;
