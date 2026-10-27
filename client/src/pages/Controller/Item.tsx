import { useParams } from "react-router-dom";
import SlideEditor from "../../containers/ItemEditor/SlideEditor";
import ItemSlides from "../../containers/ItemSlides/ItemSlides";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { DBItem } from "../../types";
import { useDispatch, useSelector } from "../../hooks";
import { bufferSongV2RevisionConflict, setActiveItem, setItemIsLoading } from "../../store/itemSlice";
import { RootState } from "../../store/store";
import LoadingOverlay from "../../components/LoadingOverlay/LoadingOverlay";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { setActiveItemInList } from "../../store/itemListSlice";
import { GlobalInfoContext } from "../../context/globalInfo";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import Button from "../../components/Button/Button";
import { SERVICE_TIME_COUNTDOWN_ID } from "../../constants/nextServiceTimer";
import { buildServiceTimeItem } from "../../utils/itemUtil";
import { applyPouchAudit } from "../../utils/pouchAudit";
import { getFormattedSections } from "../../utils/overflow";
import { loadItemWithSongHydration } from "../../utils/songPersistence";
import { SongV2ReplicationConflictError } from "../../utils/songV2ReplicationConflicts";
import type { SongV2Snapshot } from "../../utils/songPersistence";
import SongV2ConflictReviewDialog from "../../containers/ItemEditor/SongV2ConflictReviewDialog";
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
  const [conflictSnapshot, setConflictSnapshot] = useState<SongV2Snapshot | null>(null);
  const [isConflictReviewOpen, setIsConflictReviewOpen] = useState(false);
  const dispatch = useDispatch();
  const { isLoading, isSectionLoading, _id: activeItemId, listId: activeListId, pendingSongV2Conflicts } =
    useSelector((state: RootState) => state.undoable.present.item);
  const showSlidesLoadingOverlay = isSectionLoading && !isLoading;
  const { mode } = usePresentationControllerMode();
  const activeItemRef = useRef({ id: activeItemId, listId: activeListId });
  activeItemRef.current = { id: activeItemId, listId: activeListId };
  const loadSequenceRef = useRef(0);

  useEffect(() => {
    const loadSequence = ++loadSequenceRef.current;
    let cancelled = false;
    const isCurrentLoad = () =>
      !cancelled && loadSequence === loadSequenceRef.current;

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
        setConflictSnapshot(null);
        dispatch(setItemIsLoading(true));
        const response: DBItem | undefined = await loadItemWithSongHydration(
          db,
          decodedItemId,
        );
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
        if (e instanceof SongV2ReplicationConflictError) {
          const item = { ...e.snapshot.hydrated, listId: decodedListId };
          setConflictSnapshot(e.snapshot);
          dispatch(setActiveItem(item));
          dispatch(bufferSongV2RevisionConflict({ item, conflicts: e.snapshot.conflicts ?? [] }));
          dispatch(setActiveItemInList(decodedListId));
          setStatus("success");
          return;
        }
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
  }, [cloud, db, decodedItemId, decodedListId, dispatch]);

  if (status === "error")
    return (
      <h2 className="text-2xl text-center mt-4 font-bold">
        Item Not Found
      </h2>
    );

  const conflictCount = pendingSongV2Conflicts?.length ?? conflictSnapshot?.conflicts?.length ?? 0;

  return (
    <ErrorBoundary>
      <div className="flex-1 min-h-0 flex flex-col">
        {conflictCount > 0 ? (
          <div role="status" className="mx-2 mb-2 flex flex-wrap items-center justify-between gap-3 rounded border border-amber-500/50 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
            <p>This song has {conflictCount} conflicting saved version{conflictCount === 1 ? "" : "s"}. Editing is paused until you review and save a resolution.</p>
            <Button
              variant="cta"
              onClick={() => setIsConflictReviewOpen(true)}
            >
              Review saved versions
            </Button>
          </div>
        ) : null}
        <SlideEditor access={access} presentationMode={mode} />
        <LoadingOverlay
          isLoading={Boolean(showSlidesLoadingOverlay)}
          className="flex-1 min-h-0"
        >
          <ItemSlides />
        </LoadingOverlay>
        {db ? (
          <SongV2ConflictReviewDialog
            db={db}
            songId={decodedItemId}
            snapshot={conflictSnapshot}
            isOpen={isConflictReviewOpen}
            onClose={() => setIsConflictReviewOpen(false)}
            onResolved={song => {
              setConflictSnapshot(null);
              dispatch(setActiveItem({ ...song, listId: decodedListId }));
            }}
            onConflictChanged={snapshot => {
              setConflictSnapshot(snapshot);
              const item = { ...snapshot.hydrated, listId: decodedListId };
              dispatch(bufferSongV2RevisionConflict({ item, conflicts: snapshot.conflicts ?? [] }));
            }}
          />
        ) : null}
      </div>
    </ErrorBoundary>
  );
};

export default Item;
