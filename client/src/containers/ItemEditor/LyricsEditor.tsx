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
import { itemSectionBgColorMap, sectionTypes } from "../../utils/slideColorMap";
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
    ) => {
      setLocalArrangements(nextArrangements);
      setLocalSelectedArrangement(nextSelectedArrangement);
      setLocalSongMetadata(nextSongMetadata);
      setUnformattedLyrics("");
      setSelectedSectionId(null);
      setRecentlyMovedSectionId(null);
      setHasArrangementChanges(false);
      baselineSelectedArrangementRef.current = nextSelectedArrangement;
    },
    []
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
      <div className="absolute left-0 bg-homepage-canvas z-15 lg:border-r-2 border-gray-500 flex flex-col gap-2 h-full w-full max-lg:z-2 max-lg:pb-6 pb-2">
        <div className="flex h-fit shrink-0 items-center border-b border-white/20 bg-black/60 px-2">
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
              <h3 className="text-base mt-4 mb-2 font-semibold">
                Arrangements
              </h3>
              <ul className="scrollbar-variable flex-1 overflow-y-auto flex flex-col gap-2">
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
          <section
            className={`flex-1 flex flex-col min-h-0 min-w-0 ${!showLeftSection ? "pl-4" : "pr-4"}`}
          >
            <h2 className="text-2xl mb-2 text-center font-semibold shrink-0">
              {arrangementName}
            </h2>
            <div className="flex-1 flex flex-col min-h-0 min-w-0">
              <div
                className={cn(
                  "min-h-0",
                  !isMobile &&
                  selectedSectionIndex !== null &&
                  "flex-1 overflow-hidden",
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
      </div>
    </ErrorBoundary>
  );
};

export default LyricsEditor;
