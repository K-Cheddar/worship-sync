import { useSelector, useDispatch } from "../../hooks";
import { Save, X, ZoomIn, ZoomOut } from "lucide-react";

import Button from "../../components/Button/Button";
import {
  SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  startTransition,
} from "react";
import {
  applyPendingRemoteItem,
  discardPendingRemoteItem,
  setIsEditMode,
  setSongMetadata,
  updateArrangements,
} from "../../store/itemSlice";

import { setFormattedLyrics } from "../../store/preferencesSlice";

import LyricBoxes from "./LyricBoxes";
import LyricSectionTools from "./LyricSectionTools";
import SongSections from "./SongSections";
import SectionPreview from "./SectionPreview";
import AddSongSectionsDrawer from "./AddSongSectionsDrawer";
import {
  Arrangment,
  FormattedLyrics as FormattedLyricsType,
  ItemSlideType,
  SongOrder,
  SongMetadata,
} from "../../types";
import { itemSectionBgColorMap, sectionTypes } from "../../utils/slideColorMap";
import Arrangement from "./Arrangement";
import { updateFormattedSections } from "../../utils/itemUtil";
import { sortList } from "../../utils/sort";
import {
  formatSong,
  formatSection,
  getNewSlidesOffsetForSectionPreview,
} from "../../utils/overflow";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { RootState } from "../../store/store";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Slider } from "../../components/ui/Slider";
import Modal from "../../components/Modal/Modal";
import { ToastContext } from "../../context/toastContext";
import { createNewSlide, createBox } from "../../utils/slideCreation";
import cn from "classnames";
import { DEFAULT_FONT_PX } from "../../constants";
import { getItemTypeLabel } from "../../utils/itemTypeMaps";
import generateRandomId from "../../utils/generateRandomId";

const ensureArrangementIds = (nextArrangements: Arrangment[]): Arrangment[] =>
  nextArrangements.map((arrangement) =>
    arrangement.id
      ? arrangement
      : {
        ...arrangement,
        id: generateRandomId(),
      },
  );

type MobileLyricsEditorTab = "arrangements" | "song-order";

/** Matches line-tab triggers in `SectionTabs` (Account, import drawer). */
const mobileLyricsEditorLineTabTriggerClassName = cn(
  "relative inline-flex h-full min-h-0 min-w-0 shrink-0 flex-1 items-center justify-center self-stretch rounded-none border-r border-white/25 px-4 py-2.5 text-sm font-semibold shadow-none transition-colors duration-150 first:rounded-l-xl last:rounded-r-xl last:border-r-0",
  "after:hidden group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-0",
  "group-data-[variant=line]/tabs-list:data-[state=active]:border-b-2 group-data-[variant=line]/tabs-list:data-[state=active]:border-b-cyan-500 group-data-[variant=line]/tabs-list:data-[state=active]:bg-gray-950 group-data-[variant=line]/tabs-list:data-[state=active]:text-white group-data-[variant=line]/tabs-list:data-[state=active]:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]",
  "group-data-[variant=line]/tabs-list:data-[state=inactive]:border-b-2 group-data-[variant=line]/tabs-list:data-[state=inactive]:border-b-transparent group-data-[variant=line]/tabs-list:data-[state=inactive]:bg-white/6 group-data-[variant=line]/tabs-list:data-[state=inactive]:text-gray-200 group-data-[variant=line]/tabs-list:data-[state=inactive]:hover:bg-gray-600/45 group-data-[variant=line]/tabs-list:data-[state=inactive]:hover:text-white",
  "focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900",
);

type UpdateFormattedLyricsOptions = {
  songOrder?: SongOrder[];
  appendSectionIdsToSongOrder?: string[];
  preserveEmptySongOrder?: boolean;
};

const LyricsEditorPanel = () => {
  const item = useSelector((state: RootState) => state.undoable.present.item);
  const { allSongDocs } = useSelector((state: RootState) => state.allDocs);
  const { isAllItemsLoading } = useSelector((state: RootState) => state.allItems);
  const formattedLyricsPerRow = useSelector(
    (state: RootState) =>
      state.undoable.present.preferences.formattedLyricsPerRow ?? 3,
  );
  const lyricsDensityMin = 1;
  const lyricsDensityMax = 6;
  /** Right = fewer sections per row (larger); left = more per row (smaller). */
  const lyricsDensitySliderValue =
    lyricsDensityMax + lyricsDensityMin - formattedLyricsPerRow;
  const {
    isEditMode,
    type,
    arrangements,
    selectedArrangement,
    hasRemoteUpdate,
    pendingRemoteItem,
    songMetadata,
  } = item;
  const initialLocalArrangementsRef = useRef<Arrangment[] | null>(null);
  if (initialLocalArrangementsRef.current === null) {
    initialLocalArrangementsRef.current = ensureArrangementIds([...arrangements]);
  }
  const [localArrangements, setLocalArrangements] = useState(
    () => initialLocalArrangementsRef.current || [],
  );
  const [localSelectedArrangementId, setLocalSelectedArrangementId] = useState<
    string | null
  >(() => {
    const initialArrangements = initialLocalArrangementsRef.current || [];
    const initialIndex = Math.min(
      Math.max(selectedArrangement, 0),
      Math.max(0, initialArrangements.length - 1),
    );
    return initialArrangements[initialIndex]?.id || null;
  });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showImportDrawer, setShowImportDrawer] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [previewTick, setPreviewTick] = useState(0);
  const [previewSlides, setPreviewSlides] = useState<ItemSlideType[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [recentlyMovedSectionId, setRecentlyMovedSectionId] = useState<string | null>(null);
  const [pendingFocusSectionId, setPendingFocusSectionId] = useState<string | null>(null);
  const [addNewSectionsToSongOrder, setAddNewSectionsToSongOrder] = useState(true);
  const dispatch = useDispatch();
  const setLyricsDensity = useCallback(
    (next: number) => {
      const clamped = Math.min(lyricsDensityMax, Math.max(lyricsDensityMin, next));
      dispatch(setFormattedLyrics(clamped));
    },
    [dispatch, lyricsDensityMax, lyricsDensityMin],
  );
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
  const wasEditModeRef = useRef(false);
  const baselineSelectedArrangementIdRef = useRef(localSelectedArrangementId);
  const selectedSectionPositionRef = useRef({
    id: null as string | null,
    index: null as number | null,
  });
  const [hasArrangementChanges, setHasArrangementChanges] = useState(false);
  const [localSongMetadata, setLocalSongMetadata] = useState<
    SongMetadata | undefined
  >(songMetadata);

  const localSelectedArrangement = useMemo(() => {
    const index = localArrangements.findIndex(
      ({ id }) => id === localSelectedArrangementId,
    );
    if (index !== -1) return index;
    return localArrangements.length > 0 ? 0 : -1;
  }, [localArrangements, localSelectedArrangementId]);
  const activeArrangementId =
    localSelectedArrangement >= 0
      ? localArrangements[localSelectedArrangement]?.id || null
      : null;

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

  const [mobilePanelTab, setMobilePanelTab] = useState<MobileLyricsEditorTab>(
    () => (isMobile ? "song-order" : "arrangements"),
  );
  const showLeftSection =
    !isMobile || mobilePanelTab === "arrangements";
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
    localSelectedArrangementId !== baselineSelectedArrangementIdRef.current;

  const resetLocalEditorState = useCallback(
    (
      nextArrangements: Arrangment[],
      nextSelectedArrangement: number,
      nextSongMetadata?: SongMetadata,
    ) => {
      const normalizedArrangements = ensureArrangementIds(nextArrangements);
      const boundedSelectedArrangement = Math.min(
        Math.max(nextSelectedArrangement, 0),
        Math.max(0, normalizedArrangements.length - 1),
      );
      setLocalArrangements(normalizedArrangements);
      const nextSelectedArrangementId =
        normalizedArrangements[boundedSelectedArrangement]?.id || null;
      setLocalSelectedArrangementId(nextSelectedArrangementId);
      setLocalSongMetadata(nextSongMetadata);
      setSelectedSectionId(null);
      setRecentlyMovedSectionId(null);
      setHasArrangementChanges(false);
      baselineSelectedArrangementIdRef.current = nextSelectedArrangementId;
    },
    []
  );

  const updateLocalArrangements = useCallback(
    (value: SetStateAction<Arrangment[]>) => {
      setHasArrangementChanges(true);
      setLocalArrangements((currentArrangements) => {
        const nextArrangements =
          typeof value === "function" ? value(currentArrangements) : value;
        const normalizedArrangements = ensureArrangementIds(nextArrangements);

        setLocalSelectedArrangementId((currentId) => {
          if (
            currentId &&
            normalizedArrangements.some(({ id }) => id === currentId)
          ) {
            return currentId;
          }

          const fallbackIndex = Math.min(
            Math.max(localSelectedArrangement, 0),
            Math.max(0, normalizedArrangements.length - 1),
          );
          return normalizedArrangements[fallbackIndex]?.id || null;
        });

        return normalizedArrangements;
      });
    },
    [localSelectedArrangement]
  );

  useEffect(() => {
    currentItemIdRef.current = item._id;
  }, [item._id]);

  useEffect(() => {
    pendingRemoteItemRef.current = pendingRemoteItem;
  }, [pendingRemoteItem]);

  useEffect(() => {
    setMobilePanelTab(isMobile ? "song-order" : "arrangements");
  }, [isMobile]);

  useEffect(() => {
    const itemChanged = syncedItemIdRef.current !== item._id;
    const openedEditor = Boolean(isEditMode) && !wasEditModeRef.current;
    const shouldForceSync = itemChanged || openedEditor;

    if (!shouldForceSync && hasPendingChanges) {
      wasEditModeRef.current = Boolean(isEditMode);
      return;
    }

    resetLocalEditorState(arrangements, selectedArrangement, songMetadata);
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
    if (
      localArrangements.length > 0 &&
      !localArrangements.some(({ id }) => id === localSelectedArrangementId)
    ) {
      setLocalSelectedArrangementId(localArrangements[0].id || null);
    }
  }, [localArrangements, localSelectedArrangementId]);

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

  useEffect(() => {
    if (!pendingFocusSectionId) {
      return;
    }
    const id = window.setTimeout(() => {
      setPendingFocusSectionId(null);
    }, 0);
    return () => window.clearTimeout(id);
  }, [pendingFocusSectionId]);

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
        if (
          activeArrangementId
            ? el.id === activeArrangementId
            : index === localSelectedArrangement
        ) {
          return { ...el, songOrder: _songOrder };
        }
        return el;
      });
    });
  };

  const updateFormattedLyrics = (_formattedLyrics: FormattedLyricsType[]) => {
    updateLocalArrangements((_lArrangements) => {
      return _lArrangements.map((el, index) => {
        if (
          activeArrangementId
            ? el.id === activeArrangementId
            : index === localSelectedArrangement
        ) {
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
    const sectionOptionClassName = (name: string) =>
      cn(
        itemSectionBgColorMap.get(name.split(/\s+/)[0]) ?? "bg-gray-700",
        "text-white rounded px-2 py-0.5 block w-full text-left"
      );
    return {
      availableSections: Array.from(
        new Set([...sortList(sectionTypes), ...sections])
      ).map((section) => ({
        label: section,
        value: section,
        className: sectionOptionClassName(section),
      })),
      currentSections: sections.map((section) => ({
        label: section,
        value: section,
        className: sectionOptionClassName(section),
      })),
    };
  }, [localFormattedLyrics]);

  const updateFormattedLyricsAndSongOrder = useCallback(
    (
      _lyrics: FormattedLyricsType[],
      options?: SongOrder[] | UpdateFormattedLyricsOptions,
    ) => {
      const songOrderParam = Array.isArray(options) ? options : options?.songOrder;
      const appendSectionIdsToSongOrder = Array.isArray(options)
        ? []
        : options?.appendSectionIdsToSongOrder || [];
      const preserveEmptySongOrder =
        !Array.isArray(options) && Boolean(options?.preserveEmptySongOrder);
      const sourceSongOrder = songOrderParam || songOrder;
      const { formattedLyrics: _formattedLyrics, songOrder: _songOrder } =
        updateFormattedSections({
          formattedLyrics: _lyrics,
          songOrder: sourceSongOrder,
        });

      const sectionsById = new Map(
        _formattedLyrics.map((section) => [section.id, section]),
      );
      const songOrderEntriesForSectionIds = (sectionIds: string[]) =>
        sectionIds
          .map((sectionId) => sectionsById.get(sectionId)?.name)
          .filter((name): name is string => Boolean(name))
          .map((name) => ({
            name,
            id: generateRandomId(),
          }));

      let nextSongOrder: SongOrder[];

      if (preserveEmptySongOrder && sourceSongOrder.length === 0) {
        nextSongOrder = [];
      } else if (
        appendSectionIdsToSongOrder.length > 0 &&
        sourceSongOrder.length === 0 &&
        !preserveEmptySongOrder
      ) {
        // `updateFormattedSections` fills song order from all lyrics when empty.
        // When we only intend to append new sections, keep the order to those entries.
        nextSongOrder = songOrderEntriesForSectionIds(
          appendSectionIdsToSongOrder,
        );
      } else {
        nextSongOrder = [..._songOrder];
        if (
          appendSectionIdsToSongOrder.length > 0 &&
          sourceSongOrder.length > 0
        ) {
          nextSongOrder = [
            ...nextSongOrder,
            ...songOrderEntriesForSectionIds(appendSectionIdsToSongOrder),
          ];
        }
      }

      updateLocalArrangements((currentArrangements) => {
        return currentArrangements.map((el, index) => {
          if (
            activeArrangementId
              ? el.id === activeArrangementId
              : index === localSelectedArrangement
          ) {
            return {
              ...el,
              formattedLyrics: [..._formattedLyrics],
              songOrder: nextSongOrder,
            };
          }
          return el;
        });
      });
    },
    [
      activeArrangementId,
      localSelectedArrangement,
      songOrder,
      updateLocalArrangements,
    ],
  );

  const handleAddEmptySection = useCallback(
    (sectionType: string) => {
      if (!sectionType) return;

      const newId = generateRandomId();
      updateFormattedLyricsAndSongOrder(
        [
          ...localFormattedLyrics,
          {
            type: sectionType,
            name: "",
            words: "",
            slideSpan: 1,
            id: newId,
          },
        ],
        addNewSectionsToSongOrder
          ? { appendSectionIdsToSongOrder: [newId] }
          : { preserveEmptySongOrder: true },
      );
      setSelectedSectionId(newId);
      setPendingFocusSectionId(newId);
      setRecentlyMovedSectionId(null);
    },
    [
      addNewSectionsToSongOrder,
      localFormattedLyrics,
      updateFormattedLyricsAndSongOrder,
    ],
  );

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
        resetLocalEditorState(arrangements, selectedArrangement, songMetadata);
        dispatch(setIsEditMode(false));
      });
      setShowConfirmModal(true);
    } else {
      resetLocalEditorState(arrangements, selectedArrangement, songMetadata);
      dispatch(setIsEditMode(false));
    }
  }, [
    hasPendingChanges,
    arrangements,
    dispatch,
    resetLocalEditorState,
    selectedArrangement,
    songMetadata,
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

  const handleImportSections = useCallback(
    (sections: FormattedLyricsType[]) => {
      if (sections.length === 0) return;

      const importedSections = sections.map((section) => ({
        type: section.type,
        name: "",
        words: section.words,
        slideSpan: 1,
        id: generateRandomId(),
      }));
      const importedSectionIds = importedSections.map(({ id }) => id);

      updateFormattedLyricsAndSongOrder(
        [
          ...localFormattedLyrics,
          ...importedSections,
        ],
        addNewSectionsToSongOrder
          ? { appendSectionIdsToSongOrder: importedSectionIds }
          : { preserveEmptySongOrder: true },
      );
      setSelectedSectionId(importedSections[0].id);
      setPendingFocusSectionId(importedSections[0].id);
      setRecentlyMovedSectionId(null);
      setShowImportDrawer(false);
    },
    [
      addNewSectionsToSongOrder,
      localFormattedLyrics,
      updateFormattedLyricsAndSongOrder,
    ],
  );

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

  return (
    <ErrorBoundary>
      <div className="absolute left-0 z-30 bg-homepage-canvas lg:border-r-2 border-gray-500 flex flex-col gap-2 h-full w-full max-lg:pb-6 pb-2">
        <div className="flex h-fit shrink-0 items-center border-b border-white/20 bg-black/60 px-2 gap-2">
          <div className="max-lg:hidden flex shrink-0 items-center gap-1">
            <Button
              variant="tertiary"
              className="min-h-0 h-7 w-7 justify-center p-0"
              svg={ZoomOut}
              title="Zoom out"
              aria-label="Zoom out lyrics density"
              disabled={formattedLyricsPerRow >= lyricsDensityMax}
              onClick={() => setLyricsDensity(formattedLyricsPerRow + 1)}
            />
            <div className="w-36 shrink-0">
              <Slider
                className="w-full"
                value={[lyricsDensitySliderValue]}
                min={lyricsDensityMin}
                max={lyricsDensityMax}
                step={1}
                onValueChange={(v: number[]) => {
                  const raw = v[0];
                  if (raw == null) return;
                  setLyricsDensity(lyricsDensityMax + lyricsDensityMin - raw);
                }}
                aria-label="Lyrics section density"
              />
            </div>
            <Button
              variant="tertiary"
              className="min-h-0 h-7 w-7 justify-center p-0"
              svg={ZoomIn}
              title="Zoom in"
              aria-label="Zoom in lyrics density"
              disabled={formattedLyricsPerRow <= lyricsDensityMin}
              onClick={() => setLyricsDensity(formattedLyricsPerRow - 1)}
            />
          </div>
          <p className="mx-auto font-semibold text-lg">{item.name}</p>
          <Button variant="tertiary" svg={X} onClick={() => onClose()} />
        </div>
        <div className="lg:hidden my-2 mx-4">
          <Tabs
            value={mobilePanelTab}
            onValueChange={(next) =>
              setMobilePanelTab(next as MobileLyricsEditorTab)
            }
            className="w-full gap-0"
          >
            <div className="z-10 overflow-hidden rounded-xl border border-gray-700/80 bg-gray-950/45 px-0 pb-0">
              <TabsList
                variant="line"
                className="scrollbar-thin group-data-[orientation=horizontal]/tabs:h-auto h-auto min-h-0 min-w-0 w-full flex-nowrap items-stretch justify-start gap-0 overflow-x-auto overflow-y-hidden rounded-xl border border-white/35 bg-transparent p-0!"
              >
                <TabsTrigger
                  value="arrangements"
                  className={mobileLyricsEditorLineTabTriggerClassName}
                >
                  Show Arrangements
                </TabsTrigger>
                <TabsTrigger
                  value="song-order"
                  className={mobileLyricsEditorLineTabTriggerClassName}
                >
                  Show Song Order
                </TabsTrigger>
              </TabsList>
            </div>
          </Tabs>
        </div>

        <div className="flex flex-1 gap-4 min-h-0">
          {showLeftSection && (
            <div className="flex h-full min-h-0 min-w-0 max-w-64 flex-col gap-3 overflow-hidden pl-4 pt-4">
              {!isMobile && (
                <div className="shrink-0">
                  <LyricSectionTools
                    addNewSectionsToSongOrder={addNewSectionsToSongOrder}
                    onAddNewSectionsToSongOrderChange={setAddNewSectionsToSongOrder}
                    onAddEmptySection={handleAddEmptySection}
                    onOpenImportDrawer={() => setShowImportDrawer(true)}
                  />
                </div>
              )}
              <h3 className="shrink-0 text-base font-semibold text-gray-100">
                Arrangements
              </h3>
              <ul className="scrollbar-variable flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                {localArrangements.map((arrangement, index) => (
                  <Arrangement
                    key={arrangement.id || `arrangement-${index}`}
                    index={index}
                    isSelected={arrangement.id === localSelectedArrangementId}
                    setSelectedArrangement={(arrangementId) => {
                      startTransition(() => {
                        setLocalSelectedArrangementId(
                          (arrangementId ?? arrangement.id) || null
                        );
                      });
                    }}
                    arrangement={arrangement}
                    setLocalArrangements={updateLocalArrangements}
                    localArrangements={localArrangements}
                  />
                ))}
              </ul>
            </div>
          )}
          <section
            className={cn(
              "flex flex-1 flex-col min-h-0 min-w-0",
              isMobile && "px-4",
              !isMobile && !showLeftSection && "pl-4",
              !isMobile && showLeftSection && "pr-4",
            )}
          >
            {isMobile ? (
              <div className="mb-2 shrink-0 pt-2">
                <LyricSectionTools
                  collapsible
                  addNewSectionsToSongOrder={addNewSectionsToSongOrder}
                  onAddNewSectionsToSongOrderChange={setAddNewSectionsToSongOrder}
                  onAddEmptySection={handleAddEmptySection}
                  onOpenImportDrawer={() => setShowImportDrawer(true)}
                />
              </div>
            ) : null}
            <h2 className="text-2xl mb-2 text-center font-semibold shrink-0">
              {arrangementName}
            </h2>
            <div className="flex-1 flex flex-col min-h-0 min-w-0">
              <div
                className={cn(
                  "min-h-0 flex-1 overflow-hidden",
                  !isMobile &&
                  selectedSectionIndex !== null &&
                  "min-h-56",
                  !isMobile &&
                  selectedSectionIndex !== null &&
                  !isPreviewMinimized &&
                  "max-h-[75%]",
                )}
              >
                <LyricBoxes
                  formattedLyrics={localFormattedLyrics}
                  reformatLyrics={updateFormattedLyricsAndSongOrder}
                  setFormattedLyrics={updateFormattedLyrics}
                  availableSections={availableSections}
                  onFormattedLyricsDelete={onFormattedLyricsDelete}
                  isMobile={isMobile || false}
                  selectedSectionId={selectedSectionId}
                  recentlyMovedSectionId={recentlyMovedSectionId}
                  focusSectionId={pendingFocusSectionId}
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
            <section className="mr-4 flex min-h-0 max-w-64 shrink-0 flex-col gap-3 pt-4">
              <SongSections
                songOrder={songOrder}
                setSongOrder={updateSongOrder}
                currentSections={currentSections}
              />
              {!isMobile && (
                <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-600">
                  <Button
                    variant="secondary"
                    className="flex-1 justify-center gap-2"
                    svg={X}
                    iconSize="sm"
                    onClick={() => onClose()}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="cta"
                    className="flex-1 justify-center gap-2"
                    svg={Save}
                    iconSize="sm"
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
          <div className="flex justify-end h-8 mr-4 my-4 gap-4">
            <Button
              variant="secondary"
              className="text-base gap-2"
              svg={X}
              iconSize="sm"
              onClick={() => onClose()}
            >
              Cancel
            </Button>
            <Button
              variant="cta"
              className="text-base gap-2"
              svg={Save}
              iconSize="sm"
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
        <AddSongSectionsDrawer
          songs={allSongDocs}
          isOpen={showImportDrawer}
          isMobile={isMobile || false}
          isLoading={isAllItemsLoading}
          currentSongId={item._id}
          onImport={handleImportSections}
          onClose={() => setShowImportDrawer(false)}
        />
      </div>
    </ErrorBoundary>
  );
};

export default LyricsEditorPanel;
