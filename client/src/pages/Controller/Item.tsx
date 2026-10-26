import { useStore } from "react-redux";
import { selectItemDocuments } from "../../store/itemLibrarySelectors";
import { useParams } from "react-router-dom";
import SlideEditor from "../../containers/ItemEditor/SlideEditor";
import ItemSlides from "../../containers/ItemSlides/ItemSlides";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { DBItem } from "../../types";
import { useDispatch, useSelector } from "../../hooks";
import { setActiveItem, setItemIsLoading } from "../../store/itemSlice";
import { RootState } from "../../store/store";
import LoadingOverlay from "../../components/LoadingOverlay/LoadingOverlay";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { setActiveItemInList } from "../../store/itemListSlice";
import { GlobalInfoContext } from "../../context/globalInfo";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { SERVICE_TIME_COUNTDOWN_ID } from "../../constants/nextServiceTimer";
import { buildServiceTimeItem } from "../../utils/itemUtil";
import { applyPouchAudit } from "../../utils/pouchAudit";
import { getFormattedSections } from "../../utils/overflow";
import { usePresentationControllerMode } from "../../context/presentationControllerMode";

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
  const store = useStore<RootState>();
  const { isLoading, isSectionLoading, _id: activeItemId, listId: activeListId } =
    useSelector((state: RootState) => state.undoable.present.item);
  const cacheSession = useSelector((state) => state.allDocs.session);
  const showSlidesLoadingOverlay = isSectionLoading && !isLoading;
  const { mode } = usePresentationControllerMode();
  const activeItemRef = useRef({ id: activeItemId, listId: activeListId });
  activeItemRef.current = { id: activeItemId, listId: activeListId };
  const loadSequenceRef = useRef(0);

  useEffect(() => {
    const loadSequence = ++loadSequenceRef.current;
    const sessionAtStart = store.getState().allDocs.session;
    let cancelled = false;
    const isCurrentLoad = () =>
      !cancelled && loadSequence === loadSequenceRef.current &&
      store.getState().allDocs.session === sessionAtStart;

    const selectItem = async () => {
      if (!db || !cloud) return;
      // Outline continuous scroll already applied this item via Redux before
      // navigating. Re-fetching would flip isLoading and unmount the scroller,
      // snapping scroll back to the top on every settle.
      if (
        activeItemRef.current.id === decodedItemId &&
        activeItemRef.current.listId === decodedListId &&
        decodedItemId
      ) {
        if (!isCurrentLoad()) return;
        dispatch(setActiveItemInList(decodedListId));
        setStatus("success");
        dispatch(setItemIsLoading(false));
        return;
      }
      try {
        setStatus("loading");
        dispatch(setItemIsLoading(true));
        let response: DBItem | undefined;
        while (isCurrentLoad()) {
          const cacheAtRead = store.getState().allDocs;
          const cached = selectItemDocuments(store.getState()).find((doc) => doc._id === decodedItemId);
          if (cached) {
            response = cached as DBItem;
            break;
          }
          const sequenceBeforeRead = (await db.info()).update_seq;
          if (!isCurrentLoad()) return;
          const fetched = await db.get(decodedItemId) as DBItem;
          if (!isCurrentLoad()) return;
          const sequenceAfterRead = (await db.info()).update_seq;
          if (!isCurrentLoad()) return;
          if (store.getState().allDocs === cacheAtRead && sequenceBeforeRead === sequenceAfterRead) {
            response = fetched;
            break;
          }
          // A live update or tombstone raced the fallback read. Resolve from
          // the current cache, or re-read the missing doc at its latest revision.
        }
        if (!isCurrentLoad()) return;
        if (!response) return setStatus("error");
        const itemWithSections: DBItem =
          response.type === "free" &&
            (!response.formattedSections || response.formattedSections.length === 0)
            ? { ...response, formattedSections: getFormattedSections(response.slides ?? [], 1) }
            : response;
        dispatch(setActiveItem({ ...itemWithSections, listId: decodedListId }));
        dispatch(setActiveItemInList(decodedListId));
        setStatus("success");
      } catch (e: unknown) {
        if (!isCurrentLoad()) return;
        // First access of the service-time item: no DB record yet — create it.
        // Matches the pattern in createNewItemInDb: catch any error, fire-and-forget
        // the put, and immediately use the in-memory item. No await, no status check.
        if (decodedItemId === SERVICE_TIME_COUNTDOWN_ID) {
          const newItem = buildServiceTimeItem();
          const now = new Date().toISOString();
          const doc = applyPouchAudit(
            null,
            { ...newItem, createdAt: now, updatedAt: now },
            { isNew: true },
          );
          try {
            await db.put(doc);
          } catch (putErr: unknown) {
            // 409 = another window already created it; the document exists, carry on.
            if ((putErr as { status?: number })?.status !== 409) {
              console.error(putErr);
            }
          }
          if (!isCurrentLoad()) return;
          dispatch(setActiveItem({ ...newItem, listId: decodedListId }));
          dispatch(setActiveItemInList(decodedListId));
          setStatus("success");
          return;
        }

        console.error(e);
        setStatus("error");
      } finally {
        if (isCurrentLoad()) {
          dispatch(setItemIsLoading(false));
        }
      }
    };
    selectItem();

    return () => {
      cancelled = true;
    };
  }, [cloud, db, decodedItemId, decodedListId, dispatch, store, cacheSession]);

  if (status === "error")
    return (
      <h2 className="text-2xl text-center mt-4 font-bold">Item Not Found</h2>
    );

  return (
    <ErrorBoundary>
      <div className="flex-1 min-h-0 flex flex-col">
        <SlideEditor access={access} presentationMode={mode} />
        <LoadingOverlay
          isLoading={Boolean(showSlidesLoadingOverlay)}
          className="flex-1 min-h-0"
        >
          <ItemSlides />
        </LoadingOverlay>
      </div>
    </ErrorBoundary>
  );
};

export default Item;
