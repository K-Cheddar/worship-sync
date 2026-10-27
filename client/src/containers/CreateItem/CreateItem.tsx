import { selectControllerItem } from "../../store/controllerItemSelection";
import { selectItemEntries } from "../../store/itemLibrarySelectors";
import Spinner from "@/components/Spinner/Spinner";
import SongTxtImport from "./SongTxtImport";
import { findSongDuplicates } from "../../utils/songTxtImport";
import { useStore } from "react-redux";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import RadioButton, { RadioGroup } from "../../components/RadioButton/RadioButton";
import {
  FileQuestion,
  Import,
  LayoutList,
  Plus,
  Check,
  X,
} from "lucide-react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import { useNavigate, useSearchParams } from "react-router-dom";
import Icon from "../../components/Icon/Icon";
import { iconColorMap, svgMap } from "../../utils/itemTypeMaps";
import TextArea from "../../components/TextArea/TextArea";
import {
  CreateItemState,
  initialCreateItemState,
  patchCreateItemDraft,
  resetCreateItem,
  setCreateItem,
} from "../../store/createItemSlice";
import { useDispatch, useSelector } from "../../hooks";
import {
  createNewFreeForm,
  createNewSong,
  createNewTimer,
  createSections,
  removeParentheticalPhrases,
  updateFormattedSections,
} from "../../utils/itemUtil";
import { setActiveItem } from "../../store/itemSlice";
import { addItemToItemList } from "../../store/itemListSlice";
import { selectSongLibrary } from "../../store/songLibrarySelectors";
import { ItemState, ItemType, ServiceItem, ShouldSendTo } from "../../types";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { addTimer } from "../../store/timersSlice";
import { GlobalInfoContext } from "../../context/globalInfo";
import RemoveParentheticalsToggle from "../../components/RemoveParentheticalsToggle/RemoveParentheticalsToggle";
import SendTargets from "../../components/SendTargets/SendTargets";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import {
  useActiveControllerProfile,
  useControllerBasePath,
} from "../../context/activeController";
import { buildShouldSendToForController } from "../../utils/sendTargets";
import { RootState } from "../../store/store";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import {
  LyricsImportQuerySummary,
  buildLyricsImportQueryEntries,
} from "../../components/LyricsImportQuerySummary/LyricsImportQuerySummary";
import { LyricsImportLyricsPreview } from "../../components/LyricsImportLyricsPreview/LyricsImportLyricsPreview";
import ViewExternalLyricsDrawer from "../../components/FilteredItems/ViewExternalLyricsDrawer";
import {
  fetchGeniusLyricsLocally,
  resolveLrclibImport,
} from "../../api/lrclib";
import {
  createSongMetadataFromLrclib,
  getImportableLyricsFromTrack,
  getLyricsImportSourceBadgeClass,
  getLyricsImportSourceLabel,
  type NormalizedLrclibTrack,
} from "../../utils/lrclib";
import { cn } from "@/utils/cnHelper";
import CollapsibleSectionTrigger from "../../components/CollapsibleSectionTrigger/CollapsibleSectionTrigger";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  lineTabsListShellClassName,
  lineTabsTriggerClassName,
} from "@/components/ui/tabs";
import {
  getCreateItemTypeOptions,
  getDefaultCreateItemType,
  isContentBlankCreateItemDraft,
} from "./createItemTypeDefaults";

const buildCreateItemOverrideState = (
  name: string,
  type: ItemType
): CreateItemState => ({
  ...initialCreateItemState,
  name,
  type,
  hasUserSelectedType: true,
});

type MobileSongTab = "create" | "import";

const getLyricsImportCandidateKey = (candidate: NormalizedLrclibTrack): string =>
  `${candidate.source}:${candidate.geniusId ?? candidate.lrclibId ?? candidate.lyricsOvhKey ?? candidate.trackName}-${candidate.artistName}`;

export type CreateItemProps = {
  /**
   * `embedded`: single-type form for modals (no type picker, no navigation after create).
   * Defaults to the Controller create page.
   */
  variant?: "page" | "embedded";
  /** Type locked into an embedded create form. Defaults to song. */
  embeddedType?: "song" | "free";
  /** Heading shown above the form. */
  title?: string;
  /** Embedded: back to the previous surface without creating. */
  onCancel?: () => void;
  /**
   * Embedded: called after a successful create instead of opening the item editor.
   * The item is still written to the library (PouchDB item document).
   */
  onCreated?: (item: ItemState) => void;
  /** Embedded: select a library duplicate in the caller's context. Never creates a song. */
  onSelectExistingSong?: (song: ServiceItem) => void;
  /** Embedded: reports the lifetime of a durable free-form create operation. */
  onCreatingChange?: (isCreating: boolean) => void;
  /** Parent dialog surface for lyrics drawers opened from the embedded form. */
  drawerPortalContainer?: HTMLElement | null;
};

const CreateItem = ({
  variant = "page",
  embeddedType = "song",
  title,
  onCancel,
  onCreated,
  onSelectExistingSong,
  onCreatingChange,
  drawerPortalContainer,
}: CreateItemProps = {}) => {
  const isEmbedded = variant === "embedded";
  const createItemDraft = useSelector((state: RootState) => state.createItem);
  const reduxStore = useStore<RootState>();
  const list = useSelector(selectItemEntries);
  const isItemCacheInitialized = useSelector((state) => state.allDocs.isInitialized);
  const { songs: songLibrary, documents: songDocuments } = useSelector(selectSongLibrary);
  const [duplicateReview, setDuplicateReview] = useState(false);

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
  const [createError, setCreateError] = useState("");
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const isCreatingItemRef = useRef(false);
  const [isImportingLyrics, setIsImportingLyrics] = useState(false);
  const [mobileSongTab, setMobileSongTab] =
    useState<MobileSongTab>("create");
  // Seeded from the controller in front of the operator, so a new item lands on
  // that controller's screens rather than the presentation controller's.
  const displayOutputsForCreate = useSelector(selectDisplayOutputs);
  const createControllerProfile = useActiveControllerProfile();
  const [shouldSendTo, setShouldSendTo] = useState<ShouldSendTo>(() =>
    buildShouldSendToForController(
      displayOutputsForCreate,
      createControllerProfile,
    ),
  );
  const [isAdvancedExpanded, setIsAdvancedExpanded] = useState(false);
  const [removeParentheticals, setRemoveParentheticals] = useState(false);
  const [viewLyricsCandidate, setViewLyricsCandidate] =
    useState<NormalizedLrclibTrack | null>(null);
  const [geniusHydrationFailures, setGeniusHydrationFailures] = useState<
    Set<string>
  >(() => new Set());
  const lyricsImportRequestRef = useRef(0);
  const lyricsImportMountedRef = useRef(false);
  const lyricsCandidatesOwnerRef = useRef<{
    requestId: number;
    draftId: number;
    name: string;
    songArtist: string;
    songAlbum: string;
    text: string;
  } | null>(null);
  const createItemDraftRef = useRef(createItemDraft);
  createItemDraftRef.current = createItemDraft;

  useEffect(() => {
    lyricsImportMountedRef.current = true;
    return () => {
      lyricsImportMountedRef.current = false;
      lyricsImportRequestRef.current += 1;
      lyricsCandidatesOwnerRef.current = null;
    };
  }, []);

  const { db, isMobile = false } = useContext(ControllerInfoContext) || {};
  const currentDatabaseRef = useRef(db);
  currentDatabaseRef.current = db;
  const canCreateEmbeddedItem = Boolean(db && isItemCacheInitialized);

  const navigate = useNavigate();
  const controllerBasePath = useControllerBasePath();
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

  const hideFreeFormPasteText =
    createControllerProfile.type === "aux-presentation" &&
    selectedType === "free";

  const itemTypes = useMemo(
    () =>
      getCreateItemTypeOptions(createControllerProfile.type).filter(
        (itemType) => access && itemType.access?.includes(access),
      ),
    [access, createControllerProfile.type],
  );

  const selectedTypeLabel = isEmbedded
    ? embeddedType === "free" ? "Custom Document" : "Song"
    : itemTypes.find((itemType) => itemType.type === selectedType)?.label ||
    "Item";

  const heading =
    title !== undefined
      ? title
      : isEmbedded
        ? embeddedType === "free" ? "Create custom document" : "Create song"
        : "Create Item";

  const isLyricsImportOwnerCurrent = (owner: {
    requestId: number;
    draftId: number;
    name: string;
    songArtist: string;
    songAlbum: string;
    text: string;
  }) => {
    const draft = reduxStore.getState().createItem ?? createItemDraftRef.current;
    return lyricsImportMountedRef.current
      && lyricsImportRequestRef.current === owner.requestId
      && draft.draftId === owner.draftId
      && draft.type === "song"
      && draft.name === owner.name
      && draft.songArtist === owner.songArtist
      && draft.songAlbum === owner.songAlbum
      && draft.text === owner.text;
  };

  const updateCreateItemDraft = (
    updates: Partial<CreateItemState>,
    options: { fromLyricsImport?: boolean } = {},
  ) => {
    const previousDraft = createItemDraftRef.current;
    const importIdentityFields: Array<keyof CreateItemState> = [
      "name",
      "type",
      "songArtist",
      "songAlbum",
      "text",
    ];
    const changedImportIdentity = importIdentityFields.some(
      (field) =>
        field in updates &&
        !Object.is(previousDraft[field], updates[field]),
    );
    if (!options.fromLyricsImport && changedImportIdentity) {
      lyricsImportRequestRef.current += 1;
      lyricsCandidatesOwnerRef.current = null;
      setIsImportingLyrics(false);
      updates = {
        ...updates,
        lyricsImportCandidates: [],
        lyricsImportError: "",
      };
    }
    const nextDraft = {
      ...previousDraft,
      ...updates,
    };
    createItemDraftRef.current = nextDraft;
    dispatch(patchCreateItemDraft(updates));
  };

  const showLyricsImportPanel =
    selectedType === "song" &&
    (lyricsImportCandidates.length > 0 || isImportingLyrics);

  const dismissLyricsImportPanel = () => {
    updateCreateItemDraft({
      lyricsImportCandidates: [],
      lyricsImportError: "",
    });
    setViewLyricsCandidate(null);
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
    if (!isEmbedded) return;
    if (selectedType === embeddedType) return;
    updateCreateItemDraft({ type: embeddedType });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lock embedded create to its requested type
  }, [embeddedType, isEmbedded, selectedType]);

  useEffect(() => {
    if (isEmbedded) return;
    const overrideType = searchParams.get("type");
    const overrideName = searchParams.get("name");

    if (!overrideType || !overrideName) return;

    const isValidType = getCreateItemTypeOptions(
      createControllerProfile.type,
    ).some((itemType) => itemType.type === overrideType);
    if (!isValidType) return;

    dispatch(
      setCreateItem(
        buildCreateItemOverrideState(overrideName, overrideType as ItemType)
      )
    );
    setSearchParams({}, { replace: true });
  }, [
    createControllerProfile.type,
    dispatch,
    isEmbedded,
    searchParams,
    setSearchParams,
  ]);

  // Blank drafts adopt the active controller's default type. An explicit type
  // choice (radio, ?type= override, or import) sets hasUserSelectedType and is
  // kept across remounts even when the form fields are still empty.
  useEffect(() => {
    if (isEmbedded) return;
    if (searchParams.get("type") && searchParams.get("name")) return;
    if (createItemDraft.hasUserSelectedType) return;
    if (!isContentBlankCreateItemDraft(createItemDraft)) return;

    const preferredType = getDefaultCreateItemType(
      createControllerProfile.type,
    );
    if (preferredType === selectedType) return;

    dispatch(
      setCreateItem({
        ...createItemDraft,
        type: preferredType,
      }),
    );
  }, [
    createControllerProfile.type,
    createItemDraft,
    dispatch,
    isEmbedded,
    searchParams,
    selectedType,
  ]);

  const applyLrclibImport = async (
    candidate: NormalizedLrclibTrack,
    importOwner: {
      requestId: number;
      draftId: number;
      name: string;
      songArtist: string;
      songAlbum: string;
      text: string;
    },
  ) => {
    if (!isLyricsImportOwnerCurrent(importOwner)) return;
    let resolvedCandidate = candidate;
    if (!getImportableLyricsFromTrack(candidate)) {
      try {
        resolvedCandidate = await fetchGeniusLyricsLocally(candidate);
      } catch {
        if (!isLyricsImportOwnerCurrent(importOwner)) return;
        updateCreateItemDraft({
          lyricsImportError:
            "Genius did not return lyrics. Try another result or paste the lyrics manually.",
        });
        return;
      }
    }

    if (!isLyricsImportOwnerCurrent(importOwner)) return;

    const lyricsText = getImportableLyricsFromTrack(resolvedCandidate);

    if (!lyricsText) {
      updateCreateItemDraft({
        lyricsImportError:
          "Lyrics were found, but there was no importable text.",
      }, { fromLyricsImport: true });
      return;
    }

    updateCreateItemDraft({
      text: lyricsText,
      songArtist: resolvedCandidate.artistName,
      songAlbum: resolvedCandidate.albumName || "",
      songMetadata: createSongMetadataFromLrclib(resolvedCandidate),
      lyricsImportCandidates: [],
      lyricsImportError: "",
    }, { fromLyricsImport: true });
    lyricsImportRequestRef.current += 1;
    lyricsCandidatesOwnerRef.current = null;
    setIsImportingLyrics(false);
    setViewLyricsCandidate(null);
    setRemoveParentheticals(true);
    setMobileSongTab("create");
  };

  const importLyricsFromLrclib = async () => {
    if (!itemName.trim()) {
      updateCreateItemDraft({
        lyricsImportError: "Enter a song title before importing lyrics.",
      });
      return;
    }

    const requestId = lyricsImportRequestRef.current + 1;
    lyricsImportRequestRef.current = requestId;
    const draftAtStart = createItemDraftRef.current;
    const importOwner = {
      requestId,
      draftId: draftAtStart.draftId,
      name: draftAtStart.name,
      songArtist: draftAtStart.songArtist,
      songAlbum: draftAtStart.songAlbum,
      text: draftAtStart.text,
    };
    lyricsCandidatesOwnerRef.current = null;
    setIsImportingLyrics(true);
    updateCreateItemDraft({ lyricsImportError: "" });
    setMobileSongTab("import");

    try {
      const result = await resolveLrclibImport({
        trackName: itemName.trim(),
        artistName: songArtist.trim() || undefined,
        albumName: songAlbum.trim() || undefined,
      });

      if (!isLyricsImportOwnerCurrent(importOwner)) return;

      if (result.match) {
        await applyLrclibImport(result.match, importOwner);
        return;
      }

      if (result.candidates.length === 0) {
        updateCreateItemDraft({
          lyricsImportError:
            "No songs matched the name you entered above, and artist and album when you added them.",
        });
        return;
      }

      lyricsCandidatesOwnerRef.current = importOwner;
      updateCreateItemDraft({ lyricsImportCandidates: result.candidates });
      setIsImportingLyrics(false);
      setGeniusHydrationFailures((failures) => {
        const nextFailures = new Set(failures);
        result.candidates.forEach((candidate) => {
          nextFailures.delete(getLyricsImportCandidateKey(candidate));
        });
        return nextFailures;
      });

      // Keep client-side Genius scraping, but do not make the operator wait for
      // every hidden Genius page before showing the search matches.
      result.candidates.forEach((candidate) => {
        if (
          candidate.source !== "genius" ||
          getImportableLyricsFromTrack(candidate)
        ) {
          return;
        }

        void fetchGeniusLyricsLocally(candidate)
          .then((hydratedCandidate) => {
            if (!isLyricsImportOwnerCurrent(importOwner)) return;

            setGeniusHydrationFailures((failures) => {
              const nextFailures = new Set(failures);
              nextFailures.delete(getLyricsImportCandidateKey(candidate));
              return nextFailures;
            });

            const currentCandidates = createItemDraftRef.current.lyricsImportCandidates;
            const candidateIndex = currentCandidates.findIndex(
              (currentCandidate) =>
                getLyricsImportCandidateKey(currentCandidate) ===
                getLyricsImportCandidateKey(candidate),
            );
            if (candidateIndex < 0) return;

            const nextCandidates = [...currentCandidates];
            nextCandidates[candidateIndex] = hydratedCandidate;
            updateCreateItemDraft({ lyricsImportCandidates: nextCandidates });
          })
          .catch(() => {
            if (!isLyricsImportOwnerCurrent(importOwner)) return;
            setGeniusHydrationFailures((failures) => {
              const nextFailures = new Set(failures);
              nextFailures.add(getLyricsImportCandidateKey(candidate));
              return nextFailures;
            });
          });
      });
    } catch (error) {
      if (!isLyricsImportOwnerCurrent(importOwner)) return;
      console.error("LRCLIB import failed:", error);
      updateCreateItemDraft({
        lyricsImportError: "Could not import lyrics right now. Try again.",
      });
    } finally {
      if (isLyricsImportOwnerCurrent(importOwner)) {
        setIsImportingLyrics(false);
      }
    }
  };

  const existingItem: ServiceItem | undefined = useMemo(() => {
    if (selectedType !== "bible") {
      const libraryItems =
        selectedType === "song"
          ? songLibrary
          : (list as ServiceItem[]);

      return libraryItems.find(
        (item) =>
          item.name.toLowerCase().trim() === itemName.toLowerCase().trim() &&
          item.type === selectedType
      );
    }
    return undefined;
  }, [itemName, list, selectedType, songLibrary]);

  const duplicateSongs = selectedType === "song"
    ? findSongDuplicates(itemName, songMetadata?.ccliSongNumber, songLibrary, songDocuments)
    : [];

  const goToItem = (itemId: string, listId: string) => {
    void dispatch(selectControllerItem({ _id: itemId, listId }, db));
    navigate(controllerBasePath);
  };

  const dispatchNewItem = (item: ItemState) => {
    const listItem = {
      name: item.name,
      type: item.type,
      background: item.background,
      _id: item._id,
      listId: "",
    };

    if (isEmbedded) {
      onCreated?.(item);
      return;
    }

    const addedAction = dispatch(addItemToItemList(listItem));
    dispatch(setActiveItem({ ...item, listId: addedAction.payload.listId }));
    navigate(controllerBasePath);
  };

  const createItem = async (allowSeparateSong = false) => {
    // A Service Plan must not point at a song that exists only in this tab's
    // Redux state. The regular Controller creator can still build its local
    // draft before Pouch is ready, but the embedded "Create and attach" path
    // promises a durable library item, so wait for the library connection.
    if (isEmbedded && !canCreateEmbeddedItem) {
      setCreateError(
        `${embeddedType === "free" ? "Custom document" : "Song"} library is still connecting. Wait a moment, then try again.`,
      );
      return;
    }
    setCreateError("");
    const draftText = removeParentheticals ? removeParentheticalPhrases(text) : text;

    if (selectedType === "song") {
      if (isCreatingItemRef.current) return;
      if (duplicateSongs.length && !allowSeparateSong) {
        setDuplicateReview(true);
        return;
      }
      setDuplicateReview(false);
      isCreatingItemRef.current = true;
      setIsCreatingItem(true);
      const draftAtStart = reduxStore.getState().createItem;
      const isCurrentSongCreate = () => lyricsImportMountedRef.current
        && currentDatabaseRef.current === db
        && reduxStore.getState().createItem === draftAtStart;
      const { formattedLyrics: _formattedLyrics, songOrder: _songOrder } =
        createSections({
          unformattedLyrics: draftText,
        });

      const { formattedLyrics, songOrder } = updateFormattedSections({
        formattedLyrics: _formattedLyrics,
        songOrder: _songOrder,
      });

      try {
        const newItem = await createNewSong({
          name: itemName,
          formattedLyrics,
          songOrder,
          list,
          db,
          background: defaultSongBackground.background,
          mediaInfo: defaultSongBackground.mediaInfo,
          brightness: defaultSongBackgroundBrightness,
          songMetadata: songMetadata?.importFilename ? {
            ...songMetadata, trackName: itemName, artistName: songArtist, albumName: songAlbum,
          } : songMetadata,
          shouldSendTo,
        });

        // The write belongs to its original database. A closed picker or a newer
        // draft must not be reset, navigated away from, or attached on completion.
        if (!isCurrentSongCreate()) return;
        setJustCreated(true);
        dispatch(resetCreateItem());
        dispatchNewItem(newItem);
      } catch {
        if (isCurrentSongCreate()) {
          setCreateError("Could not create the song. Check your connection and try again.");
        }
      } finally {
        isCreatingItemRef.current = false;
        setIsCreatingItem(false);
      }
      return;
    }

    if (selectedType === "free") {
      if (isCreatingItemRef.current) return;
      isCreatingItemRef.current = true;
      setIsCreatingItem(true);
      onCreatingChange?.(true);
      try {
        let newItem: ItemState;
        try {
          newItem = await createNewFreeForm({
            name: itemName,
            list,
            db,
            background: defaultFreeFormBackground.background,
            mediaInfo: defaultFreeFormBackground.mediaInfo,
            brightness: defaultFreeFormBackgroundBrightness,
            text: draftText,
            overflow: defaultFreeFormFontMode,
            shouldSendTo,
          });
        } catch {
          setCreateError("Could not create the custom document. Check your connection and try again.");
          return;
        }

        setJustCreated(true);
        dispatch(resetCreateItem());
        dispatchNewItem(newItem);
      } finally {
        isCreatingItemRef.current = false;
        setIsCreatingItem(false);
        onCreatingChange?.(false);
      }
      return;
    }

    if (selectedType === "bible") {
      dispatch(patchCreateItemDraft(createItemDraft));
      navigate(`${controllerBasePath}/bible?name=${encodeURI(itemName)}`);
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
        shouldSendTo,
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

  let createButtonLabel = `Create ${selectedTypeLabel}`;
  if (justCreated) {
    createButtonLabel = "Created.";
  } else if (isEmbedded) {
    createButtonLabel = "Create and attach";
  }

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
      {isImportingLyrics ? (
        <div
          className="flex min-h-0 flex-1 items-center justify-center text-sm text-neutral-300"
          role="status"
          aria-label="Loading lyrics results"
        >
          <Spinner size="sm" width="20px" className="mr-2 shrink-0" />
          Searching for lyrics...
        </div>
      ) : (
        <ul className="scrollbar-variable flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
          {lyricsImportCandidates.map((candidate) => {
            const lyricsText = getImportableLyricsFromTrack(candidate);
            let lyricsStatus: ReactNode = null;
            if (candidate.source === "genius") {
              const candidateKey = getLyricsImportCandidateKey(candidate);
              lyricsStatus = (
                <p className="text-sm text-neutral-400" role="status">
                  {geniusHydrationFailures.has(candidateKey)
                    ? "Genius lyrics are unavailable for this result."
                    : "Lyrics loading from Genius..."}
                </p>
              );
            }

            return (
              <li
                key={getLyricsImportCandidateKey(candidate)}
                className="rounded-md bg-neutral-950/30 p-3 backdrop-blur-md"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <p className="min-w-0 wrap-break-word font-semibold text-neutral-100">
                      {candidate.trackName}
                    </p>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getLyricsImportSourceBadgeClass(
                        candidate.source,
                      )}`}
                    >
                      {getLyricsImportSourceLabel(candidate.source)}
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
                  {lyricsText.trim() ? (
                    <LyricsImportLyricsPreview lyricsText={lyricsText} />
                  ) : lyricsStatus}
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    {lyricsText.trim() ? (
                      <Button
                        type="button"
                        variant="tertiary"
                        svg={LayoutList}
                        color="#22d3ee"
                        aria-label="View lyrics"
                        onClick={() => setViewLyricsCandidate(candidate)}
                      >
                        View lyrics
                      </Button>
                    ) : null}
                    <Button
                      variant="cta"
                      className="min-w-0 flex-1 justify-center"
                      svg={Import}
                      onClick={() => {
                        const importOwner = lyricsCandidatesOwnerRef.current;
                        if (importOwner) {
                          void applyLrclibImport(candidate, importOwner);
                        }
                      }}
                    >
                      Use Lyrics
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <ErrorBoundary>
      <ViewExternalLyricsDrawer
        candidate={viewLyricsCandidate}
        isOpen={Boolean(viewLyricsCandidate)}
        isMobile={isMobile}
        onClose={() => setViewLyricsCandidate(null)}
        portalContainer={drawerPortalContainer}
      />
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        {isEmbedded && onCancel ? (
          <div className="shrink-0 px-4 pt-1">
            <Button
              type="button"
              variant="tertiary"
              className="justify-start"
              disabled={justCreated || isCreatingItem}
              onClick={() => {
                dispatch(resetCreateItem());
                onCancel();
              }}
            >
              Back to {embeddedType === "free" ? "custom document" : "song"} search
            </Button>
          </div>
        ) : null}
        {heading ? (
          <h2 className="mt-2 shrink-0 px-4 text-center text-2xl font-semibold">
            {heading}
          </h2>
        ) : null}
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
              <TabsList variant="line" className={lineTabsListShellClassName}>
                <TabsTrigger
                  value="create"
                  className={lineTabsTriggerClassName}
                >
                  Create
                </TabsTrigger>
                <TabsTrigger
                  value="import"
                  className={lineTabsTriggerClassName}
                >
                  Import lyrics
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <div
            className={cn(
              "flex min-h-0 w-full flex-col overflow-x-hidden overflow-y-auto rounded-md border border-white/10 bg-neutral-900/35 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-xl [scrollbar-gutter:stable] lg:min-w-0 lg:max-w-2xl",
              showLyricsImportPanel ? "lg:flex-1 lg:basis-0" : "lg:w-1/2",
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
              {existingItem && !isEmbedded && (
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
              {existingItem && isEmbedded && (
                <p className="rounded-md bg-neutral-700/90 p-2 text-sm text-cyan-300">
                  A {embeddedType === "free" ? "custom document" : "song"} named
                  &ldquo;{existingItem.name}&rdquo; already exists.
                  {embeddedType === "free"
                    ? " Go back to attach the existing one."
                    : " You can still create another, or go back and attach the existing one."}
                </p>
              )}
              {!isEmbedded && (
                <RadioGroup
                  value={selectedType}
                  onValueChange={(v) =>
                    updateCreateItemDraft({
                      type: v as ItemType,
                      hasUserSelectedType: true,
                    })
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
              )}
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
                  <SongTxtImport
                    key={`${createItemDraft.draftId}:${db?.name ?? "local"}`}
                    hasDraft={Boolean(itemName.trim() || text.trim() || songArtist.trim() || songAlbum.trim() || songMetadata)}
                    onApply={imported => {
                      updateCreateItemDraft({
                        name: imported.title, text: imported.lyrics,
                        songArtist: imported.metadata.artistName, songAlbum: "",
                        songMetadata: imported.metadata,
                        lyricsImportCandidates: [], lyricsImportError: "",
                      });
                      setDuplicateReview(false);
                    }}
                  />
                  <Button
                    variant="primary"
                    className="w-full justify-center"
                    svg={Import}
                    color="#22d3ee"
                    onClick={importLyricsFromLrclib}
                    disabled={!itemName.trim() || isImportingLyrics}
                  >
                    {isImportingLyrics ? "Searching..." : "Import Lyrics"}
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

            {!hideFreeFormPasteText && (selectedType === "song" || selectedType === "free") && (
              <TextArea
                textareaClassName="min-h-56 rounded-md"
                className={cn(
                  "min-h-auto w-full flex-1",
                  selectedType === "song" ? "mt-3" : "mt-2",
                )}
                label={selectedType === "song" ? "Lyrics" : "Text"}
                description={
                  selectedType === "song"
                    ? "Paste lyrics here."
                    : "Paste text here."
                }
                value={text}
                onChange={(val) => updateCreateItemDraft({ text: val as string })}
                data-ignore-undo="true"
              />
            )}

            {(selectedType === "song" || selectedType === "free") && (
              <RemoveParentheticalsToggle
                value={removeParentheticals}
                onChange={setRemoveParentheticals}
                className="mt-2 shrink-0 px-1"
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

            {!isEmbedded && (
              <div className="mt-4 shrink-0 rounded-lg border border-white/10 bg-gray-950/70 px-3 py-2">
                <CollapsibleSectionTrigger
                  label="Advanced"
                  expanded={isAdvancedExpanded}
                  onExpandedChange={setIsAdvancedExpanded}
                  className="-mx-1 px-1"
                />
                {isAdvancedExpanded && (
                  <div className="mt-1 flex flex-col items-center gap-2 border-t border-white/10 pt-2">
                    <p className="text-sm font-medium text-gray-200">Sends to:</p>
                    <SendTargets
                      shouldSendTo={shouldSendTo}
                      layout="wrap"
                      onChange={(patch) =>
                        setShouldSendTo((prev) => ({ ...prev, ...patch }))
                      }
                    />
                  </div>
                )}
              </div>
            )}
            <div className="mt-3 flex shrink-0 flex-col gap-2">
              {duplicateReview && duplicateSongs.length > 0 && <section aria-label="Possible duplicate songs" className="space-y-2 rounded-md border border-amber-300/30 p-3">
                <p className="text-sm text-amber-200">These songs may already be in your library. You can return to editing or create a separate song.</p>
                {duplicateSongs.map(song => isEmbedded && !onSelectExistingSong
                  ? <p key={song._id} className="text-sm">{song.name}</p>
                  : <Button key={song._id} variant="tertiary" onClick={() => {
                    if (isEmbedded) onSelectExistingSong?.(song);
                    else goToItem(song._id, song.listId || song._id);
                  }}>{isEmbedded ? "Attach" : "Open"} {song.name}</Button>)}
                <Button variant="tertiary" onClick={() => setDuplicateReview(false)}>Return to editing</Button>
                <Button variant="primary" disabled={isCreatingItem} onClick={() => void createItem(true)}>Create separate song</Button>
              </section>}
              {isEmbedded && !canCreateEmbeddedItem ? (
                <p className="text-sm text-amber-200" role="status">
                  {embeddedType === "free" ? "Custom document" : "Song"} library is still connecting.
                </p>
              ) : null}
              {createError ? (
                <p className="text-sm text-red-200" role="alert">
                  {createError}
                </p>
              ) : null}
              <Button
                disabled={
                  !itemName ||
                  (selectedType !== "song" && !!existingItem) ||
                  justCreated ||
                  isCreatingItem ||
                  (isEmbedded && !canCreateEmbeddedItem)
                }
                variant="cta"
                className="w-full justify-center text-base"
                onClick={() => void createItem()}
                svg={justCreated ? Check : Plus}
                color={justCreated ? "#84cc16" : undefined}
              >
                {isCreatingItem ? "Creating..." : createButtonLabel}
              </Button>
            </div>
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
