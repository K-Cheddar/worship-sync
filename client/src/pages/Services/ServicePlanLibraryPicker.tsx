import { useContext, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import Button from "../../components/Button/Button";
import FilteredItems from "../../components/FilteredItems/FilteredItems";
import Input from "../../components/Input/Input";
import Modal from "../../components/Modal/Modal";
import TextArea from "../../components/TextArea/TextArea";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useDispatch, useSelector } from "../../hooks";
import { addItemToAllItemsList } from "../../store/allItemsSlice";
import {
  createNewSong,
  createSections,
  updateFormattedSections,
} from "../../utils/itemUtil";
import type { ServiceItem } from "../../types";
import type { ServicePlanSongReference } from "../../types/servicePlan";

/** Modal surface is dark; Input/Select labels inherit document text color unless set. */
const FIELD_LABEL_CLASS = "text-neutral-100";

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
 * Create/delete/external-lyrics chrome stays Controllers-only; new songs are
 * still created in-modal via the same createSections/createNewSong pipeline.
 */
const ServicePlanLibraryPicker = ({
  isOpen,
  onClose,
  onSelectSong,
}: ServicePlanLibraryPickerProps) => {
  const { db } = useContext(ControllerInfoContext) || {};
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
  const [newSongName, setNewSongName] = useState("");
  const [newSongLyrics, setNewSongLyrics] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const resetAndClose = () => {
    setSongQuery("");
    setShowCreateSong(false);
    setNewSongName("");
    setNewSongLyrics("");
    setCreateError("");
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

  const handleCreateSong = async () => {
    const name = newSongName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError("");
    try {
      const sectioned = createSections({ unformattedLyrics: newSongLyrics });
      const { formattedLyrics, songOrder } = updateFormattedSections({
        formattedLyrics: sectioned.formattedLyrics,
        songOrder: sectioned.songOrder,
      });
      const created = await createNewSong({
        name,
        formattedLyrics,
        songOrder,
        list: allItems,
        db,
        background: "",
        brightness: 100,
      });
      dispatch(
        addItemToAllItemsList({
          _id: created._id,
          name: created.name,
          type: "song",
          background: created.background,
          listId: created._id,
        }),
      );
      onSelectSong({ kind: "library", songId: created._id, songName: created.name });
      resetAndClose();
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Could not create this song.",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      title="Add song"
      size="2xl"
      contentPadding="p-4 pt-0"
    >
      <div className="flex h-[calc(90vh-9rem)] min-h-[28rem] max-h-[52rem] flex-col gap-3">
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
            showCreateAndExternal={false}
            hideHeading
            className="h-full min-h-0 py-2"
          />
        </div>

        {showCreateSong ? (
          <div className="shrink-0 space-y-2 rounded-md border border-gray-700 bg-gray-950/60 p-3">
            <Input
              label="Song title"
              labelClassName={FIELD_LABEL_CLASS}
              value={newSongName}
              disabled={creating}
              onChange={(value) => setNewSongName(String(value))}
            />
            <TextArea
              label="Lyrics"
              labelClassName={FIELD_LABEL_CLASS}
              description="Blank lines separate sections, the same as creating a song in the Controller."
              value={newSongLyrics}
              disabled={creating}
              onChange={setNewSongLyrics}
            />
            {createError ? (
              <p className="text-sm text-red-300" role="alert">{createError}</p>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={creating || !newSongName.trim()}
                onClick={handleCreateSong}
              >
                {creating ? "Creating…" : "Create and attach"}
              </Button>
              <Button
                type="button"
                variant="tertiary"
                disabled={creating}
                onClick={() => setShowCreateSong(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="secondary"
            svg={Plus}
            iconSize="sm"
            className="shrink-0 self-start"
            onClick={() => {
              setShowCreateSong(true);
              setNewSongName(songQuery.trim());
            }}
          >
            Create a new song
          </Button>
        )}
      </div>
    </Modal>
  );
};

export default ServicePlanLibraryPicker;
