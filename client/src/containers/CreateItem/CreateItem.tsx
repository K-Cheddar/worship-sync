import { useContext, useEffect, useMemo, useState } from "react";
import RadioButton, { RadioGroup } from "../../components/RadioButton/RadioButton";
import { FileQuestion, Import, Plus, Check, X } from "lucide-react";
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
import {
  LyricsImportQuerySummary,
  buildLyricsImportQueryEntries,
} from "../../components/LyricsImportQuerySummary/LyricsImportQuerySummary";
import { LyricsImportLyricsPreview } from "../../components/LyricsImportLyricsPreview/LyricsImportLyricsPreview";
import { resolveLrclibImport } from "../../api/lrclib";
import {
  createSongMetadataFromLrclib,
  getImportableLyricsFromTrack,
  type NormalizedLrclibTrack,
} from "../../utils/lrclib";
import { cn } from "@/utils/cnHelper";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Line-tab triggers — matches `LyricsEditorPanel` / `SectionTabs` (Account, import drawer). */
const createItemMobileSongTabTriggerClassName = cn(
  "relative inline-flex h-full min-h-0 min-w-0 shrink-0 flex-1 items-center justify-center self-stretch rounded-none border-r border-white/25 px-4 py-2.5 text-sm font-semibold shadow-none transition-colors duration-150 first:rounded-l-xl last:rounded-r-xl last:border-r-0",
  "after:hidden group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-0",
  "group-data-[variant=line]/tabs-list:data-[state=active]:border-b-2 group-data-[variant=line]/tabs-list:data-[state=active]:border-b-cyan-500 group-data-[variant=line]/tabs-list:data-[state=active]:bg-gray-950 group-data-[variant=line]/tabs-list:data-[state=active]:text-white group-data-[variant=line]/tabs-list:data-[state=active]:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]",
  "group-data-[variant=line]/tabs-list:data-[state=inactive]:border-b-2 group-data-[variant=line]/tabs-list:data-[state=inactive]:border-b-transparent group-data-[variant=line]/tabs-list:data-[state=inactive]:bg-white/6 group-data-[variant=line]/tabs-list:data-[state=inactive]:text-gray-200 group-data-[variant=line]/tabs-list:data-[state=inactive]:hover:bg-gray-600/45 group-data-[variant=line]/tabs-list:data-[state=inactive]:hover:text-white",
  "focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900",
);

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

type MobileSongTab = "create" | "import";

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
  const [mobileSongTab, setMobileSongTab] =
    useState<MobileSongTab>("create");

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
    lyricsImportCandidates = [],
    lyricsImportError = "",
  } = createItemDraft;

  const itemTypes = useMemo(
    () =>
      types.filter((itemType) => access && itemType.access?.includes(access)),
    [access]
  );

  const selectedTypeLabel =
    itemTypes.find((itemType) => itemType.type === selectedType)?.label ||
    "Item";

  const updateCreateItemDraft = (updates: Partial<CreateItemState>) => {
    dispatch(
      setCreateItem({
        ...createItemDraft,
        ...updates,
      })
    );
  };

  const showLyricsImportPanel =
    selectedType === "song" && lyricsImportCandidates.length > 0;

  const dismissLyricsImportPanel = () => {
    updateCreateItemDraft({
      lyricsImportCandidates: [],
      lyricsImportError: "",
    });
    setMobileSongTab("create");
  };

  useEffect(() => {
    if (lyricsImportCandidates.length > 0) {
      setMobileSongTab("import");
    }
  }, [lyricsImportCandidates.length]);

  useEffect(() => {
    if (selectedType !== "song") {
      updateCreateItemDraft({
        lyricsImportCandidates: [],
        lyricsImportError: "",
      });
      setMobileSongTab("create");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when selectedType leaves "song"
  }, [selectedType]);

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

  const applyLrclibImport = (candidate: NormalizedLrclibTrack) => {
    const lyricsText = getImportableLyricsFromTrack(candidate);

    if (!lyricsText) {
      updateCreateItemDraft({
        lyricsImportError:
          "Lyrics were found, but there was no importable text.",
      });
      return;
    }

    updateCreateItemDraft({
      text: lyricsText,
      songArtist: candidate.artistName,
      songAlbum: candidate.albumName || "",
      songMetadata: createSongMetadataFromLrclib(candidate),
      lyricsImportCandidates: [],
      lyricsImportError: "",
    });
    setMobileSongTab("create");
  };

  const importLyricsFromLrclib = async () => {
    if (!itemName.trim()) {
      updateCreateItemDraft({
        lyricsImportError: "Enter a song title before importing lyrics.",
      });
      return;
    }

    setIsImportingLyrics(true);
    updateCreateItemDraft({ lyricsImportError: "" });

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
        updateCreateItemDraft({
          lyricsImportError:
            "No songs matched the name you entered above, and artist and album when you added them.",
        });
        return;
      }

      updateCreateItemDraft({ lyricsImportCandidates: result.candidates });
    } catch (error) {
      console.error("LRCLIB import failed:", error);
      updateCreateItemDraft({
        lyricsImportError: "Could not import lyrics right now. Try again.",
      });
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

  const lyricsImportPanel = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-x-hidden">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-lg font-semibold text-neutral-100">Choose song</h3>
        <Button
          type="button"
          variant="tertiary"
          className="shrink-0 px-2"
          onClick={dismissLyricsImportPanel}
          svg={X}
          color="#94a3b8"
          aria-label="Close import lyrics"
        />
      </div>
      <LyricsImportQuerySummary
        entries={buildLyricsImportQueryEntries({
          primaryLabel: "Name",
          primaryValue: itemName,
          artist: songArtist,
          album: songAlbum,
        })}
      />
      <p className="text-sm text-neutral-300">
        Select a result below to import into this draft.
      </p>
      <ul className="scrollbar-variable flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        {lyricsImportCandidates.map((candidate) => (
          <li
            key={`${candidate.geniusId ?? candidate.lrclibId ?? candidate.trackName
              }-${candidate.artistName}`}
            className="rounded-md bg-neutral-950/30 p-3 backdrop-blur-md"
          >
            <div className="flex flex-col gap-1">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <p className="min-w-0 wrap-break-word font-semibold text-neutral-100">
                  {candidate.trackName}
                </p>
                <span className="shrink-0 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200/95">
                  {candidate.source === "genius" ? "Genius" : "LRCLIB"}
                </span>
              </div>
              <p className="text-sm text-neutral-300">
                {candidate.artistName}
                {candidate.albumName ? ` • ${candidate.albumName}` : ""}
              </p>
              {candidate.durationMs ? (
                <p className="text-xs text-neutral-400">
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
  );

  return (
    <ErrorBoundary>
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <h2 className="mt-2 shrink-0 px-4 text-center text-2xl font-semibold">
          Create Item
        </h2>
        <div
          className={cn(
            "flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3 overflow-x-hidden px-4 pb-2 pt-2",
            showLyricsImportPanel &&
            "lg:flex-row lg:items-stretch lg:justify-start lg:gap-4 lg:overflow-y-hidden",
          )}
        >
          {showLyricsImportPanel && (
            <Tabs
              value={mobileSongTab}
              onValueChange={(v) => setMobileSongTab(v as MobileSongTab)}
              className="w-full shrink-0 gap-0 lg:hidden"
            >
              <TabsList
                variant="line"
                className="scrollbar-thin group-data-[orientation=horizontal]/tabs:h-auto h-auto min-h-0 min-w-0 w-full flex-nowrap items-stretch justify-start gap-0 overflow-x-auto overflow-y-hidden rounded-xl border border-white/35 bg-transparent p-0!"
              >
                <TabsTrigger
                  value="create"
                  className={createItemMobileSongTabTriggerClassName}
                >
                  Create
                </TabsTrigger>
                <TabsTrigger
                  value="import"
                  className={createItemMobileSongTabTriggerClassName}
                >
                  Import lyrics
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <div
            className={cn(
              "flex min-h-0 w-full flex-col rounded-md border border-white/10 bg-neutral-900/35 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-xl lg:min-w-0 lg:max-w-2xl",
              showLyricsImportPanel
                ? "lg:flex-1 lg:basis-0 lg:overflow-x-hidden lg:overflow-y-auto [scrollbar-gutter:stable]"
                : "lg:w-1/2",
              (selectedType === "song" || selectedType === "free") &&
              "flex min-h-0 flex-1 flex-col",
              showLyricsImportPanel &&
              mobileSongTab === "import" &&
              "max-lg:hidden",
            )}
          >
            <div className="flex shrink-0 flex-col gap-2">
              <Input
                value={itemName}
                onChange={(val) => updateCreateItemDraft({ name: val as string })}
                label={selectedType === "song" ? "Song name" : "Item Name"}
                className="text-base"
                data-ignore-undo="true"
              />
              {existingItem && (
                <p className="flex w-full items-center rounded-md bg-neutral-700/90 p-1 text-sm text-cyan-400">
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
              <div className="mt-2 flex shrink-0 flex-col">
                <div className="rounded-md p-3">
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
                </div>
                <div className="space-y-2 rounded-md p-3">
                  <Button
                    variant="primary"
                    className="w-full justify-center"
                    svg={Import}
                    color="#22d3ee"
                    onClick={importLyricsFromLrclib}
                    disabled={!itemName.trim() || isImportingLyrics}
                  >
                    {isImportingLyrics ? "Importing..." : "Import Lyrics"}
                  </Button>
                  <p className="text-xs text-gray-400">
                    Lookup uses your song name, artist, and album. Or paste lyrics below.
                  </p>
                  {songMetadata && (
                    <p className="text-sm text-cyan-300">
                      Imported: {songMetadata.artistName} -{" "}
                      {songMetadata.trackName}
                    </p>
                  )}
                  {lyricsImportError && (
                    <p className="text-sm text-red-300">{lyricsImportError}</p>
                  )}
                </div>
              </div>
            )}

            {(selectedType === "song" || selectedType === "free") && (
              <TextArea
                textareaClassName="min-h-72 rounded-md"
                className={cn(
                  "min-h-0 w-full flex-1",
                  selectedType === "song" ? "mt-3" : "mt-2",
                )}
                label={
                  selectedType === "song" ? "Paste Lyrics Here" : "Paste Text Here"
                }
                value={text}
                onChange={(val) => updateCreateItemDraft({ text: val as string })}
                data-ignore-undo="true"
              />
            )}

            {selectedType === "timer" && (
              <div className="mt-2 flex shrink-0 flex-col gap-2">
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
              className="mt-4 w-full shrink-0 justify-center text-base"
              onClick={createItem}
              svg={justCreated ? Check : Plus}
              color={justCreated ? "#84cc16" : undefined}
            >
              {justCreated
                ? "Created."
                : `Create ${selectedTypeLabel}`}
            </Button>
          </div>
          {showLyricsImportPanel && (
            <div
              className={cn(
                "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-white/10 bg-neutral-900/35 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-xl lg:max-h-full lg:max-w-2xl lg:flex-1 lg:basis-0",
                mobileSongTab === "create" && "max-lg:hidden",
              )}
            >
              {lyricsImportPanel}
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default CreateItem;
