import { useContext, useState } from "react";
import { useSelector, useDispatch } from "../../hooks";
import SlideEditor from "../../containers/ItemEditor/SlideEditor";
import SongV2ConflictReviewDialog from "../../containers/ItemEditor/SongV2ConflictReviewDialog";
import ItemSlides from "../../containers/ItemSlides/ItemSlides";
import LoadingOverlay from "../../components/LoadingOverlay/LoadingOverlay";
import Button from "../../components/Button/Button";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { usePresentationControllerMode } from "../../context/presentationControllerMode";
import { bufferSongV2RevisionConflict, setActiveItem } from "../../store/itemSlice";

const Item = () => {
  const dispatch = useDispatch();
  const { db } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};
  const item = useSelector((state) => state.undoable.present.item);
  const { type, listId, isLoading, isSectionLoading, _id, pendingSongV2Conflicts } = item;
  const [isConflictReviewOpen, setIsConflictReviewOpen] = useState(false);
  const { mode } = usePresentationControllerMode();

  if (!type && (!isLoading || !listId)) {
    return <h2 className="text-2xl text-center mt-4 font-bold">{listId ? "Item Not Found" : "No Item Selected"}</h2>;
  }

  const conflictCount = pendingSongV2Conflicts?.length ?? 0;

  return (
    <ErrorBoundary>
      <div className="flex-1 min-h-0 flex flex-col">
        {conflictCount > 0 ? (
          <div role="status" className="mx-2 mb-2 flex flex-wrap items-center justify-between gap-3 rounded border border-amber-500/50 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
            <p>This song has {conflictCount} conflicting saved version{conflictCount === 1 ? "" : "s"}. Editing is paused until you review and save a resolution.</p>
            <Button variant="cta" onClick={() => setIsConflictReviewOpen(true)}>
              Review saved versions
            </Button>
          </div>
        ) : null}
        <SlideEditor access={access} presentationMode={mode} />
        <LoadingOverlay isLoading={Boolean(isSectionLoading && !isLoading)} className="flex-1 min-h-0">
          <ItemSlides />
        </LoadingOverlay>
        {db && _id ? (
          <SongV2ConflictReviewDialog
            db={db}
            songId={_id}
            isOpen={isConflictReviewOpen}
            onClose={() => setIsConflictReviewOpen(false)}
            onResolved={(song) => {
              setIsConflictReviewOpen(false);
              dispatch(setActiveItem({ ...song, listId }));
            }}
            onConflictChanged={(snapshot) => {
              const conflictedItem = { ...snapshot.hydrated, listId };
              dispatch(bufferSongV2RevisionConflict({ item: conflictedItem, conflicts: snapshot.conflicts ?? [] }));
            }}
          />
        ) : null}
      </div>
    </ErrorBoundary>
  );
};

export default Item;
