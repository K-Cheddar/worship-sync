import { useContext, useEffect, useMemo, useState } from "react";
import RadioButton, { RadioGroup } from "../../components/RadioButton/RadioButton";
import { FileQuestion, Import, Plus, Check } from "lucide-react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import { useNavigate, useSearchParams } from "react-router-dom";
import Icon from "../../components/Icon/Icon";
import { iconColorMap, svgMap } from "../../utils/itemTypeMaps";
import TextArea from "../../components/TextArea/TextArea";
import {
  CreateItemState,
  initialCreateItemState,
  resetCreateItem,
  setCreateItem,
} from "../../store/createItemSlice";
import { useDispatch, useSelector } from "../../hooks";
import {
  createNewFreeForm,
  createNewSong,
  createNewTimer,
  createSections,
  updateFormattedSections,
} from "../../utils/itemUtil";
import { setActiveItem } from "../../store/itemSlice";
import { addItemToItemList } from "../../store/itemListSlice";
import { addItemToAllItemsList } from "../../store/allItemsSlice";
import { ItemState, ItemType, ServiceItem } from "../../types";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { addTimer } from "../../store/timersSlice";
import { AccessType, GlobalInfoContext } from "../../context/globalInfo";
import { RootState } from "../../store/store";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import Modal from "../../components/Modal/Modal";
import {
  LyricsImportQuerySummary,
  buildLyricsImportQueryEntries,
} from "../../components/LyricsImportQuerySummary/LyricsImportQuerySummary";
import { LyricsImportLyricsPreview } from "../../components/LyricsImportLyricsPreview/LyricsImportLyricsPreview";
import {
  resolveLrclibImport,
  type LrclibImportResolution,
} from "../../api/lrclib";
import {
  createSongMetadataFromLrclib,
  getImportableLyricsFromTrack,
} from "../../utils/lrclib";

type ItemTypesType = {
  type: ItemType;
  label: string;
  access?: AccessType[];
};

const types: ItemTypesType[] = [
  {
    type: "song",
    label: "Song",
    access: ["full", "music"],
  },
  {
    type: "bible",
    label: "Bible",
    access: ["full"],
  },
  {
    type: "free",
    label: "Custom Item",
    access: ["full"],
  },
  {
    type: "timer",
    label: "Timer",
    access: ["full"],
  },
];

const buildCreateItemOverrideState = (
  name: string,
  type: ItemType
): CreateItemState => ({
  ...initialCreateItemState,
  name,
  type,
});

const CreateItem = () => {
  const createItemDraft = useSelector((state: RootState) => state.createItem);
  const { list } = useSelector((state: RootState) => state.allItems);

  const {
    preferences: {
      defaultSongBackground,
      defaultTimerBackground,
      defaultFreeFormBackground,
      defaultSongBackgroundBrightness,
      defaultTimerBackgroundBrightness,
      defaultFreeFormBackgroundBrightness,
      defaultFreeFormFontMode,
    },
  } = useSelector((state: RootState) => state.undoable.present.preferences);
  const { hostId, access } = useContext(GlobalInfoContext) || {};

  const [searchParams, setSearchParams] = useSearchParams();
  const [justAdded, setJustAdded] = useState(false);
  const [justCreated, setJustCreated] = useState(false);
  const [isImportingLyrics, setIsImportingLyrics] = useState(false);
  const [lrclibError, setLrclibError] = useState("");
  const [lrclibCandidates, setLrclibCandidates] =
    useState<LrclibImportResolution["candidates"]>([]);
  const [isCandidateModalOpen, setIsCandidateModalOpen] = useState(false);

  const { db } = useContext(ControllerInfoContext) || {};

  const navigate = useNavigate();
  const dispatch = useDispatch();

  const {
    name: itemName,
    type: selectedType,
    text,
    songArtist = "",
    songAlbum = "",
    songMetadata = null,
    hours,
    minutes,
    seconds,
    time,
    timerType,
  } = createItemDraft;

  const itemTypes = useMemo(
    () =>
      types.filter((itemType) => access && itemType.access?.includes(access)),
    [access]
  );

  const selectedTypeLabel =
    itemTypes.find((itemType) => itemType.type === selectedType)?.label ||
    "Item";

  useEffect(() => {
    const overrideType = searchParams.get("type");
    const overrideName = searchParams.get("name");

    if (!overrideType || !overrideName) return;

    const isValidType = types.some((itemType) => itemType.type === overrideType);
    if (!isValidType) return;

    dispatch(
      setCreateItem(
        buildCreateItemOverrideState(overrideName, overrideType as ItemType)
      )
    );
    setSearchParams({}, { replace: true });
  }, [dispatch, searchParams, setSearchParams]);

  const updateCreateItemDraft = (updates: Partial<CreateItemState>) => {
    dispatch(
      setCreateItem({
        ...createItemDraft,
        ...updates,
      })
    );
  };

  const applyLrclibImport = (candidate: LrclibImportResolution["candidates"][0]) => {
    const lyricsText = getImportableLyricsFromTrack(candidate);

    if (!lyricsText) {
      setLrclibError("Lyrics were found, but there was no importable text.");
      return;
    }

    updateCreateItemDraft({
      text: lyricsText,
      songArtist: candidate.artistName,
      songAlbum: candidate.albumName || "",
      songMetadata: createSongMetadataFromLrclib(candidate),
    });
    setLrclibError("");
    setIsCandidateModalOpen(false);
    setLrclibCandidates([]);
  };

  const importLyricsFromLrclib = async () => {
    if (!itemName.trim()) {
      setLrclibError("Enter a song title before importing lyrics.");
      return;
    }

    setIsImportingLyrics(true);
    setLrclibError("");

    try {
      const result = await resolveLrclibImport({
        trackName: itemName.trim(),
        artistName: songArtist.trim() || undefined,
        albumName: songAlbum.trim() || undefined,
      });

      if (result.match) {
        applyLrclibImport(result.match);
        return;
      }

      if (result.candidates.length === 0) {
        setLrclibError(
          "No songs matched the name you entered above, and artist and album when you added them.",
        );
        return;
      }

      setLrclibCandidates(result.candidates);
      setIsCandidateModalOpen(true);
    } catch (error) {
      console.error("LRCLIB import failed:", error);
      setLrclibError("Could not import lyrics right now. Try again.");
    } finally {
      setIsImportingLyrics(false);
    }
  };

  const existingItem: ServiceItem | undefined = useMemo(() => {
    if (selectedType !== "bible") {
      return (list as ServiceItem[]).find(
        (item) =>
          item.name.toLowerCase().trim() === itemName.toLowerCase().trim() &&
          item.type === selectedType
      );
    }
    return undefined;
  }, [itemName, list, selectedType]);

  const goToItem = (itemId: string, listId: string) => {
    navigate(
      `/controller/item/${window.btoa(encodeURI(itemId))}/${window.btoa(
        encodeURI(listId)
      )}`
    );
  };

  const dispatchNewItem = (item: ItemState) => {
    const listItem = {
      name: item.name,
      type: item.type,
      background: item.background,
      _id: item._id,
      listId: "",
    };
    dispatch(setActiveItem(item));
    const addedAction = dispatch(addItemToItemList(listItem));
    dispatch(addItemToAllItemsList(listItem));
    goToItem(item._id, addedAction.payload.listId);
  };

  const createItem = async () => {
    if (selectedType === "song") {
      const { formattedLyrics: _formattedLyrics, songOrder: _songOrder } =
        createSections({
          unformattedLyrics: text,
        });

      const { formattedLyrics, songOrder } = updateFormattedSections({
        formattedLyrics: _formattedLyrics,
        songOrder: _songOrder,
      });

      const newItem = await createNewSong({
        name: itemName,
        formattedLyrics,
        songOrder,
        list,
        db,
        background: defaultSongBackground.background,
        mediaInfo: defaultSongBackground.mediaInfo,
        brightness: defaultSongBackgroundBrightness,
        songMetadata,
      });

      setJustCreated(true);
      dispatch(resetCreateItem());
      dispatchNewItem(newItem);
      return;
    }

    if (selectedType === "free") {
      const newItem = await createNewFreeForm({
        name: itemName,
        list,
        db,
        background: defaultFreeFormBackground.background,
        mediaInfo: defaultFreeFormBackground.mediaInfo,
        brightness: defaultFreeFormBackgroundBrightness,
        text,
        overflow: defaultFreeFormFontMode,
      });

      setJustCreated(true);
      dispatch(resetCreateItem());
      dispatchNewItem(newItem);
      return;
    }

    if (selectedType === "bible") {
      dispatch(setCreateItem(createItemDraft));
      navigate(`/controller/bible?name=${encodeURI(itemName)}`);
      return;
    }

    if (selectedType === "timer") {
      const duration = hours * 3600 + minutes * 60 + seconds;
      const newItem = await createNewTimer({
        name: itemName,
        list,
        db,
        hostId: hostId || "",
        duration,
        countdownTime: time,
        timerType,
        background: defaultTimerBackground.background,
        mediaInfo: defaultTimerBackground.mediaInfo,
        brightness: defaultTimerBackgroundBrightness,
      });

      setJustCreated(true);
      dispatch(resetCreateItem());
      dispatchNewItem(newItem);
      if (newItem.timerInfo) {
        dispatch(addTimer(newItem.timerInfo));
      }
      return;
    }
  };

  const addItem = () => {
    if (!existingItem) return;
    dispatch(addItemToItemList(existingItem));
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 2000);
  };

  return (
    <ErrorBoundary>
      <h2 className="text-2xl text-center font-semibold mt-2">Create Item</h2>
      <div className="my-2 mx-4 rounded-md p-4 bg-gray-800 w-1/2 max-lg:w-[95%]">
        <Modal
          isOpen={isCandidateModalOpen}
          onClose={() => setIsCandidateModalOpen(false)}
          title="Choose song"
          size="lg"
        >
          <div className="flex flex-col gap-3">
            <LyricsImportQuerySummary
              entries={buildLyricsImportQueryEntries({
                primaryLabel: "Name",
                primaryValue: itemName,
                artist: songArtist,
                album: songAlbum,
              })}
            />
            <p className="text-sm text-gray-200">
              Select a result below to import into this draft.
            </p>
            <ul className="flex flex-col gap-2">
              {lrclibCandidates.map((candidate) => (
                <li
                  key={`${candidate.geniusId ?? candidate.lrclibId ?? candidate.trackName
                    }-${candidate.artistName}`}
                  className="rounded-md border border-slate-500/90 bg-slate-800/95 p-3"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold text-gray-50">
                        {candidate.trackName}
                      </p>
                      <span className="shrink-0 rounded-full border border-cyan-400/60 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
                        {candidate.source === "genius" ? "Genius" : "LRCLIB"}
                      </span>
                    </div>
                    <p className="text-sm text-gray-200">
                      {candidate.artistName}
                      {candidate.albumName ? ` • ${candidate.albumName}` : ""}
                    </p>
                    {candidate.durationMs ? (
                      <p className="text-xs text-gray-300">
                        {(candidate.durationMs / 1000).toFixed(0)} seconds
                      </p>
                    ) : null}
                    <LyricsImportLyricsPreview
                      lyricsText={getImportableLyricsFromTrack(candidate)}
                    />
                    <div className="pt-2">
                      <Button
                        variant="cta"
                        className="justify-center"
                        svg={Import}
                        onClick={() => applyLrclibImport(candidate)}
                      >
                        Use Lyrics
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Modal>
        <div className="flex flex-col gap-2">
          <Input
            value={itemName}
            onChange={(val) => updateCreateItemDraft({ name: val as string })}
            label={selectedType === "song" ? "Song name" : "Item Name"}
            className="text-base"
            data-ignore-undo="true"
          />
          {existingItem && (
            <p className="text-cyan-400 bg-gray-600 text-sm rounded-md p-1 w-full flex items-center">
              <span className="italic font-semibold mr-2">"{existingItem.name}"</span>
              <span> already exists.</span>
              <Button
                variant="tertiary"
                onClick={addItem}
                svg={justAdded ? Check : Plus}
                color={justAdded ? "#84cc16" : "#22d3ee"}
                disabled={justAdded}
              >
                {justAdded ? "Added." : "Add to outline"}
              </Button>
            </p>
          )}
          <RadioGroup
            value={selectedType}
            onValueChange={(v) =>
              updateCreateItemDraft({ type: v as ItemType })
            }
            className="flex flex-col gap-2"
          >
            {itemTypes.map((itemType) => (
              <div
                key={itemType.type}
                className="flex w-full min-w-0 items-center gap-3"
              >
                <Icon
                  className="size-6 shrink-0 self-center"
                  svg={svgMap.get(itemType.type) || FileQuestion}
                  color={iconColorMap.get(itemType.type)}
                />
                <RadioButton
                  optionValue={itemType.type}
                  label={itemType.label}
                  textSize="text-base"
                  className="min-w-0 flex-1"
                  data-ignore-undo="true"
                />
              </div>
            ))}
          </RadioGroup>
        </div>

        {selectedType === "song" && (
          <div className="mt-3 rounded-md border border-gray-600 bg-gray-900 p-3 space-y-3">
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                value={songArtist}
                onChange={(val) =>
                  updateCreateItemDraft({ songArtist: val as string })
                }
                label="Artist"
                className="text-base"
                data-ignore-undo="true"
              />
              <Input
                value={songAlbum}
                onChange={(val) =>
                  updateCreateItemDraft({ songAlbum: val as string })
                }
                label="Album"
                className="text-base"
                data-ignore-undo="true"
              />
            </div>
            <div className="border-t border-gray-600 pt-3 space-y-2">
              <p className="text-xs text-gray-400">
                Lookup uses your song name, artist, and album. Or paste lyrics below.
              </p>
              <Button
                variant="secondary"
                className="w-full justify-center"
                svg={Import}
                onClick={importLyricsFromLrclib}
                disabled={!itemName.trim() || isImportingLyrics}
              >
                {isImportingLyrics ? "Importing..." : "Import Lyrics"}
              </Button>
              {songMetadata && (
                <p className="text-sm text-cyan-300">
                  Imported: {songMetadata.artistName} - {songMetadata.trackName}
                </p>
              )}
              {lrclibError && (
                <p className="text-sm text-red-300">{lrclibError}</p>
              )}
            </div>
          </div>
        )}

        {(selectedType === "song" || selectedType === "free") && (
          <TextArea
            className={`w-full h-72 flex flex-col ${selectedType === "song" ? "mt-3" : "mt-2"
              }`}
            label={
              selectedType === "song" ? "Paste Lyrics Here" : "Paste Text Here"
            }
            value={text}
            onChange={(val) => updateCreateItemDraft({ text: val as string })}
            data-ignore-undo="true"
          />
        )}

        {selectedType === "timer" && (
          <div className="flex flex-col gap-2 mt-2">
            <RadioGroup
              value={timerType}
              onValueChange={(v) =>
                updateCreateItemDraft({
                  timerType: v as "timer" | "countdown",
                })
              }
              className="flex gap-4"
            >
              <RadioButton
                optionValue="timer"
                label="Timer"
                textSize="text-base"
                data-ignore-undo="true"
              />
              <RadioButton
                optionValue="countdown"
                label="Countdown"
                textSize="text-base"
                data-ignore-undo="true"
              />
            </RadioGroup>
            {timerType === "countdown" && (
              <div className="flex gap-2">
                <Input
                  type="time"
                  label="Countdown To"
                  value={time}
                  onChange={(val) =>
                    updateCreateItemDraft({ time: val as string })
                  }
                  data-ignore-undo="true"
                />
              </div>
            )}
            {timerType === "timer" && (
              <div className="flex gap-2">
                <Input
                  label="Hours"
                  type="number"
                  min={0}
                  value={hours}
                  onChange={(val) =>
                    updateCreateItemDraft({ hours: Number(val) || 0 })
                  }
                  data-ignore-undo="true"
                />
                <Input
                  label="Minutes"
                  type="number"
                  min={0}
                  max={59}
                  value={minutes}
                  onChange={(val) =>
                    updateCreateItemDraft({ minutes: Number(val) || 0 })
                  }
                  data-ignore-undo="true"
                />
                <Input
                  label="Seconds"
                  type="number"
                  min={0}
                  max={59}
                  value={seconds}
                  onChange={(val) =>
                    updateCreateItemDraft({ seconds: Number(val) || 0 })
                  }
                  data-ignore-undo="true"
                />
              </div>
            )}
          </div>
        )}

        <Button
          disabled={!itemName || !!existingItem || justCreated}
          variant="cta"
          className="text-base w-full justify-center mt-4"
          onClick={createItem}
          svg={justCreated ? Check : Plus}
          color={justCreated ? "#84cc16" : undefined}
        >
          {justCreated
            ? "Created."
            : `Create ${selectedTypeLabel}`}
        </Button>
      </div>
    </ErrorBoundary>
  );
};

export default CreateItem;
