import { useSelector, useDispatch } from "../../hooks";
import { X } from "lucide-react";
import { ZoomIn } from "lucide-react";
import { ZoomOut } from "lucide-react";

import Button from "../../components/Button/Button";
import {
  SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  applyPendingRemoteItem,
  discardPendingRemoteItem,
  setIsEditMode,
  setSongMetadata,
  updateArrangements,
} from "../../store/itemSlice";

import {
  increaseFormattedLyrics,
  decreaseFormattedLyrics,
} from "../../store/preferencesSlice";

import TextArea from "../../components/TextArea/TextArea";
import Input from "../../components/Input/Input";
import LyricBoxes from "./LyricBoxes";
import SongSections from "./SongSections";
import SectionPreview from "./SectionPreview";
import {
  Arrangment,
  FormattedLyrics as FormattedLyricsType,
  ItemSlideType,
  SongOrder,
  SongMetadata,
} from "../../types";
import { sectionTypes } from "../../utils/slideColorMap";
import Arrangement from "./Arrangement";
import { updateFormattedSections } from "../../utils/itemUtil";
import { sortList } from "../../utils/sort";
import {
  formatSong,
  formatSection,
  getNewSlidesOffsetForSectionPreview,
} from "../../utils/overflow";
import { createSections as createSectionsUtil } from "../../utils/itemUtil";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { RootState } from "../../store/store";
import { ButtonGroup, ButtonGroupItem } from "../../components/Button";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import Modal from "../../components/Modal/Modal";
import { ToastContext } from "../../context/toastContext";
import { createNewSlide, createBox } from "../../utils/slideCreation";
import cn from "classnames";
import { DEFAULT_FONT_PX } from "../../constants";
import { getItemTypeLabel } from "../../utils/itemTypeMaps";
import { resolveLrclibImport, type LrclibImportResolution } from "../../api/lrclib";
import {
  createSongMetadataFromLrclib,
  getImportableLyricsFromTrack,
  makeUniqueArrangementName,
} from "../../utils/lrclib";
import generateRandomId from "../../utils/generateRandomId";

const LyricsEditor = () => {
  const item = useSelector((state: RootState) => state.undoable.present.item);
  const {
    isEditMode,
    type,
    arrangements,
    selectedArrangement,
    hasRemoteUpdate,
    pendingRemoteItem,
    songMetadata,
  } = item;
  const [unformattedLyrics, setUnformattedLyrics] = useState("");
  const [localArrangements, setLocalArrangements] = useState([...arrangements]);
  const [localSelectedArrangement, setLocalSelectedArrangement] =
    useState(selectedArrangement);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [previewTick, setPreviewTick] = useState(0);
  const [previewSlides, setPreviewSlides] = useState<ItemSlideType[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [recentlyMovedSectionId, setRecentlyMovedSectionId] = useState<string | null>(null);
  const dispatch = useDispatch();
  const toastContext = useContext(ToastContext);
  const showToast = toastContext?.showToast;
  const removeToast = toastContext?.removeToast;
  const previewInputRef = useRef({
    selectedSectionId: null as string | null,
    localFormattedLyrics: [] as FormattedLyricsType[],
    localArrangements: [] as typeof localArrangements,
    localSelectedArrangement: 0,
  });
  const currentItemIdRef = useRef(item._id);
  const pendingRemoteItemRef = useRef(pendingRemoteItem);
  const remoteUpdateToastIdRef = useRef<string | null>(null);
  const syncedItemIdRef = useRef(item._id);
  const wasEditModeRef = useRef(Boolean(isEditMode));
  const baselineSelectedArrangementRef = useRef(selectedArrangement);
  const selectedSectionPositionRef = useRef({
    id: null as string | null,
    index: null as number | null,
  });
  const [hasArrangementChanges, setHasArrangementChanges] = useState(false);
  const [localSongMetadata, setLocalSongMetadata] = useState<
    SongMetadata | undefined
  >(songMetadata);
  const [lrclibTrackName, setLrclibTrackName] = useState(
    songMetadata?.trackName ?? item.name,
  );
  const [lrclibArtistName, setLrclibArtistName] = useState(
    songMetadata?.artistName ?? "",
  );
  const [lrclibAlbumName, setLrclibAlbumName] = useState(
    songMetadata?.albumName ?? "",
  );
  const [isImportingLyrics, setIsImportingLyrics] = useState(false);
  const [lrclibError, setLrclibError] = useState("");
  const [lrclibCandidates, setLrclibCandidates] =
    useState<LrclibImportResolution["candidates"]>([]);
  const [isCandidateModalOpen, setIsCandidateModalOpen] = useState(false);

  const localFormattedLyrics = useMemo(
    () => localArrangements[localSelectedArrangement]?.formattedLyrics || [],
    [localArrangements, localSelectedArrangement]
  );
  const songOrder = useMemo(
    () => localArrangements[localSelectedArrangement]?.songOrder || [],
    [localArrangements, localSelectedArrangement]
  );
  const itemTypeLabel = useMemo(
    () => getItemTypeLabel(pendingRemoteItem?.type ?? type),
    [pendingRemoteItem?.type, type]
  );
  const arrangementName = useMemo(
    () => localArrangements[localSelectedArrangement]?.name || "Master",
    [localArrangements, localSelectedArrangement]
  );

  const { isMobile = false } = useContext(ControllerInfoContext) || {};

  const [showLeftSection, setShowLeftSection] = useState(!isMobile);
  const [isPreviewMinimized, setIsPreviewMinimized] = useState(false);
  const selectedSectionIndex = useMemo(() => {
    if (!selectedSectionId) {
      return null;
    }

    const index = localFormattedLyrics.findIndex(({ id }) => id === selectedSectionId);
    return index === -1 ? null : index;
  }, [localFormattedLyrics, selectedSectionId]);
  const selectedSection = useMemo(() => {
    if (selectedSectionIndex === null) {
      return null;
    }

    return localFormattedLyrics[selectedSectionIndex] || null;
  }, [localFormattedLyrics, selectedSectionIndex]);

  const hasSongMetadataChanges =
    JSON.stringify(localSongMetadata ?? null) !==
    JSON.stringify(songMetadata ?? null);
  const hasPendingChanges =
    hasArrangementChanges ||
    hasSongMetadataChanges ||
    localSelectedArrangement !== baselineSelectedArrangementRef.current ||
    unformattedLyrics.trim() !== "";

  const resetLocalEditorState = useCallback(
    (
      nextArrangements: Arrangment[],
      nextSelectedArrangement: number,
      nextSongMetadata?: SongMetadata,
      nextItemName?: string,
    ) => {
      setLocalArrangements(nextArrangements);
      setLocalSelectedArrangement(nextSelectedArrangement);
      setLocalSongMetadata(nextSongMetadata);
      setLrclibTrackName(nextSongMetadata?.trackName ?? nextItemName ?? item.name);
      setLrclibArtistName(nextSongMetadata?.artistName ?? "");
      setLrclibAlbumName(nextSongMetadata?.albumName ?? "");
      setLrclibError("");
      setLrclibCandidates([]);
      setIsCandidateModalOpen(false);
      setUnformattedLyrics("");
      setSelectedSectionId(null);
      setRecentlyMovedSectionId(null);
      setHasArrangementChanges(false);
      baselineSelectedArrangementRef.current = nextSelectedArrangement;
    },
    [item.name]
  );

  const updateLocalArrangements = useCallback(
    (value: SetStateAction<Arrangment[]>) => {
      setHasArrangementChanges(true);
      setLocalArrangements(value);
    },
    []
  );

  useEffect(() => {
    currentItemIdRef.current = item._id;
  }, [item._id]);

  useEffect(() => {
    pendingRemoteItemRef.current = pendingRemoteItem;
  }, [pendingRemoteItem]);

  useEffect(() => {
    if (item.type !== "song") {
      dispatch(setIsEditMode(false));
    }
  }, [item.type, dispatch]);

  useEffect(() => {
    setShowLeftSection(!isMobile);
  }, [isMobile]);

  useEffect(() => {
    const itemChanged = syncedItemIdRef.current !== item._id;
    const openedEditor = Boolean(isEditMode) && !wasEditModeRef.current;
    const shouldForceSync = itemChanged || openedEditor;

    if (!shouldForceSync && hasPendingChanges) {
      wasEditModeRef.current = Boolean(isEditMode);
      return;
    }

    resetLocalEditorState(
      arrangements,
      selectedArrangement,
      songMetadata,
      item.name,
    );
    syncedItemIdRef.current = item._id;
    wasEditModeRef.current = Boolean(isEditMode);
  }, [
    arrangements,
    selectedArrangement,
    songMetadata,
    hasPendingChanges,
    item._id,
    item.name,
    isEditMode,
    resetLocalEditorState,
  ]);

  useEffect(() => {
    if (!localArrangements[localSelectedArrangement]) {
      setLocalSelectedArrangement(0);
    }
  }, [localArrangements, localSelectedArrangement]);

  // Auto-select first section when formatted lyrics are available
  useEffect(() => {
    if (localFormattedLyrics.length === 0) {
      setSelectedSectionId(null);
    } else if (selectedSectionId && selectedSectionIndex === null) {
      // If selected section was deleted, select the first one or null
      setSelectedSectionId(localFormattedLyrics[0].id || null);
    } else if (selectedSectionId === null && !isMobile) {
      setSelectedSectionId(localFormattedLyrics[0].id || null);
    }
  }, [localFormattedLyrics, isMobile, selectedSectionId, selectedSectionIndex]);

  // Reset preview minimized state when section changes
  useEffect(() => {
    setIsPreviewMinimized(false);
  }, [selectedSectionId]);

  useEffect(() => {
    const previousSelection = selectedSectionPositionRef.current;

    if (
      selectedSectionId &&
      previousSelection.id === selectedSectionId &&
      previousSelection.index !== null &&
      selectedSectionIndex !== null &&
      previousSelection.index !== selectedSectionIndex
    ) {
      setRecentlyMovedSectionId(selectedSectionId);
    }

    selectedSectionPositionRef.current = {
      id: selectedSectionId,
      index: selectedSectionIndex,
    };
  }, [selectedSectionId, selectedSectionIndex]);

  useEffect(() => {
    if (recentlyMovedSectionId && recentlyMovedSectionId !== selectedSectionId) {
      setRecentlyMovedSectionId(null);
    }
  }, [recentlyMovedSectionId, selectedSectionId]);

  // Handle beforeunload event for page navigation/reload
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasPendingChanges) {
        e.preventDefault();
        e.returnValue =
          "You have unsaved changes. Are you sure you want to leave?";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasPendingChanges]);

  const updateSongOrder = (_songOrder: SongOrder[]) => {
    updateLocalArrangements((_lArrangements) => {
      return _lArrangements.map((el, index) => {
        if (index === localSelectedArrangement) {
          return { ...el, songOrder: _songOrder };
        }
        return el;
      });
    });
  };

  const updateFormattedLyrics = (_formattedLyrics: FormattedLyricsType[]) => {
    updateLocalArrangements((_lArrangements) => {
      return _lArrangements.map((el, index) => {
        if (index === localSelectedArrangement) {
          return { ...el, formattedLyrics: _formattedLyrics };
        }
        return el;
      });
    });
  };

  const onFormattedLyricsDelete = (index: number) => {
    const updatedFormattedLyrics = [...localFormattedLyrics];
    updatedFormattedLyrics.splice(index, 1);

    const updatedSongOrder = songOrder.filter((section) => {
      return updatedFormattedLyrics
        .map(({ name }) => name)
        .includes(section.name);
    });

    updateFormattedLyricsAndSongOrder(updatedFormattedLyrics, updatedSongOrder);
  };

  const { availableSections, currentSections } = useMemo(() => {
    const sections = sortList(localFormattedLyrics.map(({ name }) => name));
    return {
      availableSections: Array.from(
        new Set([...sortList(sectionTypes), ...sections])
      ).map((section) => ({ label: section, value: section })),
      currentSections: sections.map((section) => ({
        label: section,
        value: section,
      })),
    };
  }, [localFormattedLyrics]);

  const updateFormattedLyricsAndSongOrder = (
    _lyrics: FormattedLyricsType[],
    songOrderParam?: SongOrder[]
  ) => {
    const { formattedLyrics: _formattedLyrics, songOrder: _songOrder } =
      updateFormattedSections({
        formattedLyrics: _lyrics,
        songOrder: songOrderParam || songOrder,
      });

    const updatedLocalArrangements = localArrangements.map((el, index) => {
      if (index === localSelectedArrangement) {
        return {
          ...el,
          formattedLyrics: [..._formattedLyrics],
          songOrder: [..._songOrder],
        };
      }
      return el;
    });
    updateLocalArrangements(updatedLocalArrangements);
  };

  const applyLrclibImport = (
    candidate: LrclibImportResolution["candidates"][0],
  ) => {
    const lyricsText = getImportableLyricsFromTrack(candidate);

    if (!lyricsText) {
      setLrclibError("Lyrics were found, but there was no importable text.");
      return;
    }

    const { formattedLyrics: createdLyrics, songOrder: createdSongOrder } =
      createSectionsUtil({
        unformattedLyrics: lyricsText,
      });
    const { formattedLyrics, songOrder } = updateFormattedSections({
      formattedLyrics: createdLyrics,
      songOrder: createdSongOrder,
    });

    const arrangementName = makeUniqueArrangementName(
      "LRCLIB Import",
      localArrangements.map((arrangement) => arrangement.name),
    );
    const nextArrangementIndex = localArrangements.length;
    const templateSlides =
      localArrangements[localSelectedArrangement]?.slides ||
      localArrangements[0]?.slides ||
      [];
    const importedArrangement: Arrangment = {
      id: generateRandomId(),
      name: arrangementName,
      formattedLyrics,
      songOrder,
      slides: templateSlides,
    };
    const nextSongMetadata = createSongMetadataFromLrclib(candidate);
    const formattedItem = formatSong({
      ...item,
      arrangements: [...localArrangements, importedArrangement],
      selectedArrangement: nextArrangementIndex,
      songMetadata: nextSongMetadata,
    });

    updateLocalArrangements(formattedItem.arrangements);
    setLocalSelectedArrangement(nextArrangementIndex);
    setLocalSongMetadata(nextSongMetadata);
    setLrclibTrackName(candidate.trackName);
    setLrclibArtistName(candidate.artistName);
    setLrclibAlbumName(candidate.albumName || "");
    setSelectedSectionId(
      formattedItem.arrangements[nextArrangementIndex]?.formattedLyrics?.[0]?.id ||
        null,
    );
    setRecentlyMovedSectionId(null);
    setLrclibError("");
    setLrclibCandidates([]);
    setIsCandidateModalOpen(false);
  };

  const importLyricsFromLrclib = async () => {
    if (!lrclibTrackName.trim()) {
      setLrclibError("Enter a song title before importing lyrics.");
      return;
    }

    setIsImportingLyrics(true);
    setLrclibError("");

    try {
      const result = await resolveLrclibImport({
        trackName: lrclibTrackName.trim(),
        artistName: lrclibArtistName.trim() || undefined,
        albumName: lrclibAlbumName.trim() || undefined,
      });

      if (result.match) {
        applyLrclibImport(result.match);
        return;
      }

      if (result.candidates.length === 0) {
        setLrclibError("No LRCLIB matches were found for that song.");
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

  // Debounce preview regeneration to avoid expensive formatting on every keystroke
  useEffect(() => {
    const timeout = setTimeout(() => {
      setPreviewTick((value) => value + 1);
    }, 350);
    return () => clearTimeout(timeout);
  }, [
    selectedSectionId,
    localFormattedLyrics,
    localArrangements,
    localSelectedArrangement,
  ]);

  useEffect(() => {
    previewInputRef.current = {
      selectedSectionId,
      localFormattedLyrics,
      localArrangements,
      localSelectedArrangement,
    };
  }, [selectedSectionId, localFormattedLyrics, localArrangements, localSelectedArrangement]);

  // Regenerate preview only on debounced ticks
  useEffect(() => {
    if (isMobile) {
      setPreviewSlides([]);
      return;
    }

    const {
      selectedSectionId: activeSectionId,
      localFormattedLyrics: activeFormattedLyrics,
      localArrangements: activeArrangements,
      localSelectedArrangement: activeArrangementIndex,
    } = previewInputRef.current;

    if (activeSectionId === null) {
      setPreviewSlides([]);
      return;
    }

    const selectedSection = activeFormattedLyrics.find(
      ({ id }) => id === activeSectionId
    );
    if (!selectedSection || !selectedSection.words.trim()) {
      setPreviewSlides([]);
      return;
    }

    const arrangement = activeArrangements[activeArrangementIndex];
    let templateSlides = arrangement?.slides || [];
    let templateSlide = templateSlides[1] || templateSlides[0];

    if (!templateSlide) {
      templateSlide = createNewSlide({
        type: "Verse",
        name: "Template",
        boxes: [
          createBox({
            words: "",
            height: 100,
            width: 100,
            background: "",
            brightness: 100,
          }),
          createBox({
            words: "",
            height: 100,
            width: 100,
            fontSize: DEFAULT_FONT_PX,
            fontColor: "rgba(255, 255, 255, 1)",
            transparent: true,
            topMargin: 3,
            sideMargin: 4,
          }),
        ],
      });
      templateSlides = [templateSlide];
    }

    const sectionType = selectedSection.type as any;
    const sectionName = selectedSection.name;
    const fontSizePx = templateSlide.boxes[1]?.fontSize || DEFAULT_FONT_PX;
    const songOrder = arrangement?.songOrder || [];
    const newSlidesOffset = getNewSlidesOffsetForSectionPreview({
      songOrder,
      formattedLyrics: activeFormattedLyrics,
      slides: templateSlides,
      targetSectionName: sectionName,
      fontSizePx,
      selectedSlide: templateSlide,
    });

    try {
      const nextPreviewSlides = formatSection({
        text: selectedSection.words,
        type: sectionType,
        name: sectionName,
        slides: templateSlides,
        newSlides: Array.from(
          { length: newSlidesOffset },
          () => ({}) as ItemSlideType
        ),
        fontSizePx,
        selectedSlide: templateSlide,
        selectedBox: 1,
      });
      setPreviewSlides(nextPreviewSlides);
    } catch (error) {
      console.error("Error generating preview slides:", error);
      setPreviewSlides([]);
    }
  }, [previewTick, isMobile]);

  // Handle confirmation modal actions
  const handleConfirmAction = useCallback(() => {
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
    setShowConfirmModal(false);
  }, [pendingAction]);

  const handleCancelAction = useCallback(() => {
    setPendingAction(null);
    setShowConfirmModal(false);
  }, []);

  const handleCloseWithConfirmation = useCallback(() => {
    if (hasPendingChanges) {
      setPendingAction(() => () => {
        resetLocalEditorState(
          arrangements,
          selectedArrangement,
          songMetadata,
          item.name,
        );
        dispatch(setIsEditMode(false));
      });
      setShowConfirmModal(true);
    } else {
      resetLocalEditorState(
        arrangements,
        selectedArrangement,
        songMetadata,
        item.name,
      );
      dispatch(setIsEditMode(false));
    }
  }, [
    hasPendingChanges,
    arrangements,
    dispatch,
    resetLocalEditorState,
    selectedArrangement,
    songMetadata,
    item.name,
  ]);

  const handleKeepLocalEdits = useCallback(() => {
    dispatch(discardPendingRemoteItem());
  }, [dispatch]);

  const handleReloadRemote = useCallback(() => {
    const remoteItem = pendingRemoteItemRef.current;
    const activeItemId = currentItemIdRef.current;
    if (!remoteItem || remoteItem._id !== activeItemId) return;

    const nextArrangementIndex = Math.min(
      localSelectedArrangement,
      Math.max(0, (remoteItem.arrangements?.length ?? 1) - 1)
    );

    resetLocalEditorState(
      remoteItem.arrangements || [],
      nextArrangementIndex,
      remoteItem.songMetadata,
      remoteItem.name,
    );
    dispatch(applyPendingRemoteItem());
  }, [dispatch, localSelectedArrangement, resetLocalEditorState]);

  useEffect(() => {
    if (!isEditMode || !hasRemoteUpdate) {
      if (remoteUpdateToastIdRef.current && removeToast) {
        removeToast(remoteUpdateToastIdRef.current);
        remoteUpdateToastIdRef.current = null;
      }
      return;
    }

    if (remoteUpdateToastIdRef.current || !showToast || !removeToast) return;

    remoteUpdateToastIdRef.current = showToast({
      message: `Someone else updated this ${itemTypeLabel}.`,
      variant: "info",
      persist: true,
      showCloseButton: false,
      children: (toastId) => (
        <div className="mt-2 flex gap-2">
          <Button
            variant="primary"
            className="text-sm"
            onClick={() => {
              handleKeepLocalEdits();
              removeToast(toastId);
              remoteUpdateToastIdRef.current = null;
            }}
          >
            Keep Editing Mine
          </Button>
          <Button
            variant="cta"
            className="text-sm"
            onClick={() => {
              handleReloadRemote();
              removeToast(toastId);
              remoteUpdateToastIdRef.current = null;
            }}
          >
            Use Their Changes
          </Button>
        </div>
      ),
    });
  }, [
    handleKeepLocalEdits,
    handleReloadRemote,
    hasRemoteUpdate,
    itemTypeLabel,
    isEditMode,
    removeToast,
    showToast,
  ]);

  useEffect(() => {
    return () => {
      if (remoteUpdateToastIdRef.current && removeToast) {
        removeToast(remoteUpdateToastIdRef.current);
        remoteUpdateToastIdRef.current = null;
      }
    };
  }, [removeToast]);

  if (!isEditMode) {
    return null;
  }

  const onClose = handleCloseWithConfirmation;

  const save = () => {
    dispatch(setIsEditMode(false));
    const _arrangements = [...localArrangements];

    _arrangements[localSelectedArrangement] = {
      ..._arrangements[localSelectedArrangement],
      formattedLyrics: [...localFormattedLyrics],
    };

    const _item = formatSong({
      ...item,
      arrangements: _arrangements,
      selectedArrangement: localSelectedArrangement,
    });

    dispatch(
      updateArrangements({
        arrangements: _item.arrangements,
        selectedArrangement: localSelectedArrangement,
      })
    );
    dispatch(setSongMetadata(localSongMetadata));

  };

  const createSections = () => {
    if (!unformattedLyrics.trim()) return;

    const { formattedLyrics: _formattedLyrics, songOrder: _songOrder } =
      createSectionsUtil({
        formattedLyrics: localFormattedLyrics,
        songOrder,
        unformattedLyrics,
      });

    updateFormattedLyricsAndSongOrder(_formattedLyrics, _songOrder);
  };

  return (
    <ErrorBoundary>
      <div className="absolute left-0 bg-gray-700 z-15 lg:border-r-2 border-gray-500 flex flex-col gap-2 h-full w-full max-lg:z-2 max-lg:pb-6 pb-2">
        <Modal
          isOpen={isCandidateModalOpen}
          onClose={() => setIsCandidateModalOpen(false)}
          title="Choose LRCLIB Match"
          size="lg"
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-gray-300">
              Select the song entry to import as a new arrangement.
            </p>
            <ul className="flex flex-col gap-2">
              {lrclibCandidates.map((candidate) => (
                <li
                  key={`${candidate.lrclibId}-${candidate.trackName}-${candidate.artistName}`}
                  className="rounded-md border border-gray-600 bg-gray-900 p-3"
                >
                  <div className="flex flex-col gap-1">
                    <p className="font-semibold text-white">
                      {candidate.trackName}
                    </p>
                    <p className="text-sm text-gray-300">
                      {candidate.artistName}
                      {candidate.albumName ? ` • ${candidate.albumName}` : ""}
                    </p>
                    <div className="mt-2 rounded-md bg-gray-800 p-2">
                      <p className="mb-1 text-xs font-semibold text-gray-300">
                        Lyrics Preview
                      </p>
                      <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-gray-200 scrollbar-variable">
                        {getImportableLyricsFromTrack(candidate) || "No lyrics preview available."}
                      </div>
                    </div>
                    <div className="pt-2">
                      <Button
                        variant="cta"
                        className="justify-center"
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
        <div className="flex bg-gray-900 px-2 h-fit items-center">
          <Button
            variant="tertiary"
            className="max-lg:hidden"
            svg={ZoomOut}
            onClick={() => dispatch(increaseFormattedLyrics())}
          />
          <Button
            variant="tertiary"
            className="max-lg:hidden"
            svg={ZoomIn}
            onClick={() => dispatch(decreaseFormattedLyrics())}
          />
          <p className="mx-auto font-semibold text-lg">{item.name}</p>
          <Button variant="tertiary" svg={X} onClick={() => onClose()} />
        </div>
        <ButtonGroup className="lg:hidden my-2 mx-4">
          <ButtonGroupItem
            isActive={showLeftSection}
            onClick={() => setShowLeftSection(true)}
          >
            Show Arrangements
          </ButtonGroupItem>
          <ButtonGroupItem
            isActive={!showLeftSection}
            onClick={() => setShowLeftSection(false)}
          >
            Show Song Order
          </ButtonGroupItem>
        </ButtonGroup>

        <div className="flex flex-1 gap-4 min-h-0">
          {showLeftSection && (
            <div className="pl-4 pt-4 w-44 flex flex-col">
              <TextArea
                className="w-40 h-72 flex flex-col"
                label="Paste Lyrics Here"
                value={unformattedLyrics}
                onChange={(val) => setUnformattedLyrics(val as string)}
              />
              <Button className="text-sm mt-1 mx-auto" onClick={createSections}>
                Format Lyrics
              </Button>
              <div className="mt-4 rounded-md border border-gray-600 bg-gray-900 p-2">
                <h3 className="text-sm font-semibold text-center">LRCLIB Import</h3>
                <Input
                  value={lrclibTrackName}
                  onChange={(value) => setLrclibTrackName(value as string)}
                  label="Title"
                  className="mt-2"
                  inputTextSize="text-xs"
                  data-ignore-undo="true"
                />
                <Input
                  value={lrclibArtistName}
                  onChange={(value) => setLrclibArtistName(value as string)}
                  label="Artist"
                  className="mt-2"
                  inputTextSize="text-xs"
                  data-ignore-undo="true"
                />
                <Input
                  value={lrclibAlbumName}
                  onChange={(value) => setLrclibAlbumName(value as string)}
                  label="Album"
                  className="mt-2"
                  inputTextSize="text-xs"
                  data-ignore-undo="true"
                />
                <Button
                  className="text-xs mt-2 w-full justify-center"
                  onClick={importLyricsFromLrclib}
                  disabled={!lrclibTrackName.trim() || isImportingLyrics}
                >
                  {isImportingLyrics ? "Importing..." : "Import Lyrics"}
                </Button>
                {localSongMetadata && (
                  <p className="mt-2 text-xs text-cyan-300">
                    Imported: {localSongMetadata.artistName}
                  </p>
                )}
                {lrclibError && (
                  <p className="mt-2 text-xs text-red-300">{lrclibError}</p>
                )}
              </div>
              <h3 className="text-base mt-4 mb-2 font-semibold">
                Arrangements
              </h3>
              <ul className="scrollbar-variable rounded-md flex-1 overflow-y-auto bg-gray-800 flex flex-col gap-2">
                {localArrangements.map((arrangement, index) => (
                  <Arrangement
                    key={arrangement.name}
                    index={index}
                    setSelectedArrangement={() => setLocalSelectedArrangement(index)}
                    arrangement={arrangement}
                    setLocalArrangements={updateLocalArrangements}
                    localArrangements={localArrangements}
                  />
                ))}
              </ul>
            </div>
          )}
          <section className={`flex-1 flex flex-col min-w-0 ${!showLeftSection ? "pl-4" : "pr-4"}`}>
            <h2 className="text-2xl mb-2 text-center font-semibold shrink-0">
              {arrangementName}
            </h2>
            <div className="flex-1 flex flex-col min-h-0 min-w-0">
              <div className={cn(
                "shrink min-h-0",
                !isMobile && selectedSectionIndex !== null && !isPreviewMinimized && "max-h-[75%] overflow-hidden flex-1"
              )}>
                <LyricBoxes
                  formattedLyrics={localFormattedLyrics}
                  reformatLyrics={updateFormattedLyricsAndSongOrder}
                  setFormattedLyrics={updateFormattedLyrics}
                  availableSections={availableSections}
                  onFormattedLyricsDelete={onFormattedLyricsDelete}
                  isMobile={isMobile || false}
                  selectedSectionId={selectedSectionId}
                  recentlyMovedSectionId={recentlyMovedSectionId}
                  onMovedSectionTracked={(sectionId) =>
                    setRecentlyMovedSectionId((currentId) =>
                      currentId === sectionId ? null : currentId
                    )
                  }
                  onSectionSelect={setSelectedSectionId}
                />
              </div>
              {!isMobile && selectedSectionIndex !== null && (
                <SectionPreview
                  selectedSection={selectedSection}
                  previewSlides={previewSlides}
                  isMinimized={isPreviewMinimized}
                  onMinimizeToggle={setIsPreviewMinimized}
                />
              )}
            </div>
          </section>
          {(!showLeftSection || !isMobile) && (
            <section className="mr-4 flex flex-col">
              <SongSections
                songOrder={songOrder}
                setSongOrder={updateSongOrder}
                currentSections={currentSections}
              />
              {!isMobile && (
                <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-600">
                  <Button
                    variant="secondary"
                    className="flex-1 justify-center"
                    onClick={() => onClose()}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="cta"
                    className="flex-1 justify-center"
                    onClick={() => save()}
                  >
                    Save
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
        {isMobile && (
          <div className="flex justify-end h-8 mr-4 my-4">
            <Button
              variant="secondary"
              className="text-base"
              onClick={() => onClose()}
            >
              Cancel
            </Button>
            <Button
              variant="cta"
              className="text-base ml-4"
              onClick={() => save()}
            >
              Save
            </Button>
          </div>
        )}

        {/* Confirmation Modal */}
        <Modal
          isOpen={showConfirmModal}
          onClose={handleCancelAction}
          title="Unsaved Changes"
          size="sm"
          contentPadding="pt-0 pb-4 px-4"
          showCloseButton={false}
        >
          <p className="mb-6">
            You have unsaved changes. Are you sure you want to leave without
            saving?
          </p>
          <div className="flex justify-center gap-4">
            <Button
              variant="secondary"
              onClick={handleCancelAction}
              className="text-base"
            >
              Stay
            </Button>
            <Button
              variant="cta"
              onClick={handleConfirmAction}
              className="text-base"
            >
              Leave Without Saving
            </Button>
          </div>
        </Modal>
      </div>
    </ErrorBoundary>
  );
};

export default LyricsEditor;
