import { useMemo, useState } from "react";
import FilteredItems from "../../components/FilteredItems/FilteredItems";
import Modal from "../../components/Modal/Modal";
import CreateItem from "../../containers/CreateItem/CreateItem";
import { useDispatch, useSelector } from "../../hooks";
import {
  initialCreateItemState,
  resetCreateItem,
  setCreateItem,
} from "../../store/createItemSlice";
import type { ItemState, ServiceItem } from "../../types";
import type { ServicePlanSongReference } from "../../types/servicePlan";

/** Modal surface is dark and often portaled outside Teams `text-white` wrappers. */
const FIELD_LABEL_CLASS = "text-neutral-100";
const FIELD_INPUT_CLASS = "text-neutral-100";

type ServicePlanLibraryPickerProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelectSong: (songRef: ServicePlanSongReference) => void;
};

/**
 * Large modal for attaching a library song to a plan element.
 *
 * Reuses FilteredItems (lyrics preview + View lyrics) in attach mode: primary
 * action attaches a plan reference instead of adding to the live outline.
 * "Create a new song" swaps this search UI for the Controller CreateItem song
 * form (import lyrics, artist/album, etc.) in-place.
 */
const ServicePlanLibraryPicker = ({
  isOpen,
  onClose,
  onSelectSong,
}: ServicePlanLibraryPickerProps) => {
  const dispatch = useDispatch();
  const allSongDocs = useSelector((state) => state.allDocs.allSongDocs);
  const allItems = useSelector((state) => state.allItems.list);
  const isAllItemsLoading = useSelector(
    (state) => state.allItems.isAllItemsLoading,
  );

  /**
   * FilteredItems expects a ServiceItem list (Controller allItems). Teams/Services
   * sessions often never run Controller lifecycle, so allItems stays "loading"
   * forever with an empty list — derive song rows from allSongDocs instead
   * (already refreshed by ServicePlanEditor via updateAllDocs).
   */
  const songList = useMemo((): ServiceItem[] => {
    const fromAllItems = allItems.filter((item) => item.type === "song");
    if (fromAllItems.length > 0) return fromAllItems;
    return allSongDocs.map((doc) => ({
      _id: doc._id,
      name: doc.name,
      type: "song",
      listId: doc._id,
      background: typeof doc.background === "string" ? doc.background : "",
    }));
  }, [allItems, allSongDocs]);

  const songsLoading =
    isAllItemsLoading && songList.length === 0 && allSongDocs.length === 0;

  const [songQuery, setSongQuery] = useState("");
  const [showCreateSong, setShowCreateSong] = useState(false);

  const resetAndClose = () => {
    setSongQuery("");
    setShowCreateSong(false);
    dispatch(resetCreateItem());
    onClose();
  };

  const handleAttachSong = (item: ServiceItem) => {
    onSelectSong({
      kind: "library",
      songId: item._id,
      songName: item.name,
    });
    resetAndClose();
  };

  const openCreateSong = () => {
    dispatch(
      setCreateItem({
        ...initialCreateItemState,
        name: songQuery.trim(),
        type: "song",
      }),
    );
    setShowCreateSong(true);
  };

  const openCreateFromExternal = () => {
    // FilteredItems already seeded createItem with lyrics + metadata.
    setShowCreateSong(true);
  };

  const handleCreated = (item: ItemState) => {
    onSelectSong({
      kind: "library",
      songId: item._id,
      songName: item.name,
    });
    resetAndClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      title={showCreateSong ? "Create song" : "Add song"}
      size="2xl"
      contentPadding="p-4 pt-0"
    >
      <div className="flex h-[calc(90vh-9rem)] min-h-[28rem] max-h-[52rem] flex-col gap-3 text-neutral-100">
        {showCreateSong ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <CreateItem
              variant="embedded"
              title=""
              onCancel={() => setShowCreateSong(false)}
              onCreated={handleCreated}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-gray-700 bg-gray-950/40">
            <FilteredItems
              list={songList}
              type="song"
              heading="Songs"
              label="song"
              isLoading={songsLoading}
              allDocs={allSongDocs}
              searchValue={songQuery}
              setSearchValue={setSongQuery}
              onAddItem={handleAttachSong}
              addButtonLabel="Attach"
              showDelete={false}
              showCreateAndExternal
              onCreateNew={openCreateSong}
              onCreateFromExternal={openCreateFromExternal}
              searchLabelClassName={FIELD_LABEL_CLASS}
              searchInputClassName={FIELD_INPUT_CLASS}
              hideHeading
              className="h-full min-h-0 py-2"
            />
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ServicePlanLibraryPicker;
