import { useContext, useMemo, useState } from "react";
import { useSelector, useDispatch } from "../../hooks";
import { useStore } from "react-redux";
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
import {
  getActiveContentDatabaseOwner,
  getContentDatabaseForOwner,
  getItemMutationOwner,
  sameItemMutationOwner,
} from "../../store/deferredItemMutations";
import { getContentDatabaseSessionToken } from "../../utils/contentReplicationActivity";
import type { ItemContentOwner, ItemState } from "../../types";
import type { RootState } from "../../store/store";
import type { SongV2ConflictReviewOwner } from "../../containers/ItemEditor/SongV2ConflictReviewDialog";
import { canEditSongContent } from "../../utils/accessTiers";

type ConflictReviewOwner = SongV2ConflictReviewOwner & {
  database: PouchDB.Database;
  contentOwner: ItemContentOwner;
  sessionToken: symbol | null;
  songId: string;
  itemType: ItemState["type"];
  listId?: string;
  outlineScope: string;
  selectedOutlineId?: string;
  baseItem: ItemState["baseItem"];
  activeItem: ItemState;
};

const Item = () => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const { db } = useContext(ControllerInfoContext) || {};
  const { access } = useContext(GlobalInfoContext) || {};
  const item = useSelector((state) => state.undoable.present.item);
  const { type, listId, isLoading, isSectionLoading, _id, pendingSongV2Conflicts } = item;
  const [isConflictReviewOpen, setIsConflictReviewOpen] = useState(false);
  const [conflictReviewOwner, setConflictReviewOwner] = useState<ConflictReviewOwner | null>(null);
  const activeContentOwner = getActiveContentDatabaseOwner();
  const contentOwner = item.contentOwner ?? activeContentOwner ?? null;
  const outlineScope = useSelector((state) => state.undoable.present.itemLists?.scope ?? "presentation");
  const selectedOutlineId = useSelector((state) => state.undoable.present.itemLists?.selectedList?._id);
  const sessionToken = db ? getContentDatabaseSessionToken(db.name) : null;
  const resolutionOwner = useMemo<ConflictReviewOwner | null>(() => {
    if (!db || !contentOwner || !_id) return null;
    return {
      database: db,
      contentOwner,
      sessionToken,
      songId: _id,
      itemType: type,
      listId,
      outlineScope,
      selectedOutlineId,
      baseItem: item.baseItem,
      activeItem: item,
    };
  }, [contentOwner, db, item, listId, outlineScope, selectedOutlineId, sessionToken, type, _id]);
  const { mode } = usePresentationControllerMode();

  const closeConflictReview = () => {
    setIsConflictReviewOpen(false);
    setConflictReviewOwner(null);
  };

  const isCurrentConflictReviewOwner = (candidate: ConflictReviewOwner) => {
    const state = store.getState();
    const currentItem = state.undoable.present.item;
    const currentItemLists = state.undoable.present.itemLists;
    const currentContentOwner = getActiveContentDatabaseOwner();
    const expectedItemOwner = {
      ...candidate.contentOwner,
      itemId: candidate.songId,
      itemType: candidate.itemType,
    };
    return currentContentOwner?.scopeId === candidate.contentOwner.scopeId &&
      currentContentOwner.databaseKey === candidate.contentOwner.databaseKey &&
      currentContentOwner.churchId === candidate.contentOwner.churchId &&
      getContentDatabaseForOwner(currentContentOwner) === candidate.database &&
      (!candidate.sessionToken || getContentDatabaseSessionToken(candidate.database.name) === candidate.sessionToken) &&
      currentItem === candidate.activeItem &&
      sameItemMutationOwner(expectedItemOwner, getItemMutationOwner(currentItem)) &&
      currentItem._id === candidate.songId && currentItem.type === candidate.itemType &&
      currentItem.listId === candidate.listId && currentItem.baseItem === candidate.baseItem &&
      currentItemLists?.scope === candidate.outlineScope &&
      currentItemLists?.selectedList?._id === candidate.selectedOutlineId;
  };

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
            <Button variant="cta" onClick={() => {
              if (!resolutionOwner) return;
              setConflictReviewOwner(resolutionOwner);
              setIsConflictReviewOpen(true);
            }}>
              Review saved versions
            </Button>
          </div>
        ) : null}
        <SlideEditor access={access} presentationMode={mode} />
        <LoadingOverlay isLoading={Boolean(isSectionLoading && !isLoading)} className="flex-1 min-h-0">
          <ItemSlides />
        </LoadingOverlay>
        {db && _id && resolutionOwner ? (
          <SongV2ConflictReviewDialog
            db={db}
            songId={_id}
            resolutionOwner={resolutionOwner}
            canSave={canEditSongContent(access)}
            isOpen={Boolean(isConflictReviewOpen && conflictReviewOwner === resolutionOwner)}
            onClose={closeConflictReview}
            onResolved={(song, owner) => {
              const initiatingOwner = owner as ConflictReviewOwner;
              if (!isCurrentConflictReviewOwner(initiatingOwner)) return;
              closeConflictReview();
              dispatch(setActiveItem({
                ...song,
                listId: initiatingOwner.listId,
                contentOwner: initiatingOwner.contentOwner,
              }));
            }}
            onConflictChanged={(snapshot, owner) => {
              const initiatingOwner = owner as ConflictReviewOwner;
              if (!isCurrentConflictReviewOwner(initiatingOwner)) return;
              const conflictedItem = { ...snapshot.hydrated, listId: initiatingOwner.listId };
              dispatch(bufferSongV2RevisionConflict({ item: conflictedItem, conflicts: snapshot.conflicts ?? [] }));
            }}
          />
        ) : null}
      </div>
    </ErrorBoundary>
  );
};

export default Item;
