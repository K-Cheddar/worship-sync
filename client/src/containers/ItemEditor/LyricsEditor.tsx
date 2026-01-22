import { useSelector, useDispatch } from "../../hooks";
import { X } from "lucide-react";
import { ZoomIn } from "lucide-react";
import { ZoomOut } from "lucide-react";

import Button from "../../components/Button/Button";
import { useContext, useEffect, useMemo, useState, useCallback, useDeferredValue } from "react";
import { setIsEditMode, updateArrangements } from "../../store/itemSlice";

import {
  increaseFormattedLyrics,
  decreaseFormattedLyrics,
} from "../../store/preferencesSlice";

import TextArea from "../../components/TextArea/TextArea";
import LyricBoxes from "./LyricBoxes";
import SongSections from "./SongSections";
import SectionPreview from "./SectionPreview";
import { FormattedLyrics as FormattedLyricsType, SongOrder } from "../../types";
import { sectionTypes } from "../../utils/slideColorMap";
import Arrangement from "./Arrangement";
import { updateFormattedSections } from "../../utils/itemUtil";
import { sortList } from "../../utils/sort";
import { formatSong, formatSection } from "../../utils/overflow";
import { createSections as createSectionsUtil } from "../../utils/itemUtil";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { RootState } from "../../store/store";
import { ButtonGroup, ButtonGroupItem } from "../../components/Button";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import Modal from "../../components/Modal/Modal";
import { createNewSlide, createBox } from "../../utils/slideCreation";
import cn from "classnames";

const LyricsEditor = () => {
  const item = useSelector((state: RootState) => state.undoable.present.item);
  const { isEditMode, arrangements, selectedArrangement } = item;
  const [unformattedLyrics, setUnformattedLyrics] = useState("");
  const [localArrangements, setLocalArrangements] = useState([...arrangements]);
  const [localSelectedArrangement, setLocalSelectedArrangement] =
    useState(selectedArrangement);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const dispatch = useDispatch();

  const localFormattedLyrics = useMemo(
    () => localArrangements[localSelectedArrangement]?.formattedLyrics || [],
    [localArrangements, localSelectedArrangement]
  );
  const songOrder = useMemo(
    () => localArrangements[localSelectedArrangement]?.songOrder || [],
    [localArrangements, localSelectedArrangement]
  );
  const arrangementName = useMemo(
    () => localArrangements[localSelectedArrangement]?.name || "Master",
    [localArrangements, localSelectedArrangement]
  );

  const { isMobile = false } = useContext(ControllerInfoContext) || {};

  const [showLeftSection, setShowLeftSection] = useState(!isMobile);
  const [selectedSectionIndex, setSelectedSectionIndex] = useState<number | null>(null);
  const [isPreviewMinimized, setIsPreviewMinimized] = useState(false);

  useEffect(() => {
    if (item.type !== "song") {
      dispatch(setIsEditMode(false));
    }
  }, [item.type, dispatch]);

  useEffect(() => {
    setShowLeftSection(!isMobile);
  }, [isMobile]);

  useEffect(() => {
    setLocalArrangements(arrangements);
    setLocalSelectedArrangement(selectedArrangement);
    // Reset selection when arrangement changes to allow auto-selection of first section
    if (selectedArrangement !== localSelectedArrangement) {
      setSelectedSectionIndex(null);
    }
  }, [arrangements, selectedArrangement, localSelectedArrangement]);

  useEffect(() => {
    if (!localArrangements[localSelectedArrangement]) {
      setLocalSelectedArrangement(0);
    }
  }, [localArrangements, localSelectedArrangement]);

  // Auto-select first section when formatted lyrics are available
  useEffect(() => {
    if (localFormattedLyrics.length > 0 && selectedSectionIndex === null && !isMobile) {
      setSelectedSectionIndex(0);
    } else if (localFormattedLyrics.length === 0) {
      setSelectedSectionIndex(null);
    } else if (selectedSectionIndex !== null && selectedSectionIndex >= localFormattedLyrics.length) {
      // If selected section was deleted, select the first one or null
      setSelectedSectionIndex(localFormattedLyrics.length > 0 ? 0 : null);
    }
  }, [localFormattedLyrics.length, isMobile, selectedSectionIndex]);

  // Reset preview minimized state when section changes
  useEffect(() => {
    setIsPreviewMinimized(false);
  }, [selectedSectionIndex]);

  // Detect changes by comparing current state with original
  useEffect(() => {
    const hasChanges =
      JSON.stringify(localArrangements) !== JSON.stringify(arrangements) ||
      localSelectedArrangement !== selectedArrangement ||
      unformattedLyrics.trim() !== "";
    setHasUnsavedChanges(hasChanges);
  }, [
    localArrangements,
    arrangements,
    localSelectedArrangement,
    selectedArrangement,
    unformattedLyrics,
  ]);

  // Handle beforeunload event for page navigation/reload
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue =
          "You have unsaved changes. Are you sure you want to leave?";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const updateSongOrder = (_songOrder: SongOrder[]) => {
    setLocalArrangements((_lArrangements) => {
      return _lArrangements.map((el, index) => {
        if (index === localSelectedArrangement) {
          return { ...el, songOrder: _songOrder };
        }
        return el;
      });
    });
  };

  const updateFormattedLyrics = (_formattedLyrics: FormattedLyricsType[]) => {
    setLocalArrangements((_lArrangements) => {
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
    setLocalArrangements(updatedLocalArrangements);
  };

  // Use deferred value for preview to prevent blocking text input
  const deferredSelectedSectionIndex = useDeferredValue(selectedSectionIndex);
  const deferredLocalFormattedLyrics = useDeferredValue(localFormattedLyrics);
  const deferredLocalArrangements = useDeferredValue(localArrangements);
  const deferredLocalSelectedArrangement = useDeferredValue(localSelectedArrangement);

  // Generate preview slides for the selected section (using deferred values for smooth editing)
  const previewSlides = useMemo(() => {
    if (deferredSelectedSectionIndex === null || isMobile) return [];
    
    const selectedSection = deferredLocalFormattedLyrics[deferredSelectedSectionIndex];
    if (!selectedSection || !selectedSection.words.trim()) return [];

    // Get slide template from existing arrangement slides or create defaults
    const arrangement = deferredLocalArrangements[deferredLocalSelectedArrangement];
    let templateSlides = arrangement?.slides || [];
    let templateSlide = templateSlides[1] || templateSlides[0];
    
    // If no template slides exist, create a default one
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
            fontSize: 2.5,
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
    const fontSize = templateSlide.boxes[1]?.fontSize || 2.5;

    try {
      return formatSection({
        text: selectedSection.words,
        type: sectionType,
        name: sectionName,
        slides: templateSlides,
        newSlides: [],
        fontSize,
        selectedSlide: templateSlide,
        selectedBox: 1,
        isMobile,
      });
    } catch (error) {
      console.error("Error generating preview slides:", error);
      return [];
    }
  }, [deferredSelectedSectionIndex, deferredLocalFormattedLyrics, deferredLocalArrangements, deferredLocalSelectedArrangement, isMobile]);

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
    if (hasUnsavedChanges) {
      setPendingAction(() => () => {
        setLocalArrangements(arrangements);
        dispatch(setIsEditMode(false));
      });
      setShowConfirmModal(true);
    } else {
      setLocalArrangements(arrangements);
      dispatch(setIsEditMode(false));
    }
  }, [hasUnsavedChanges, arrangements, dispatch]);

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

    const _item = formatSong(
      {
        ...item,
        arrangements: _arrangements,
        selectedArrangement: localSelectedArrangement,
      },
      isMobile
    );

    dispatch(
      updateArrangements({
        arrangements: _item.arrangements,
        selectedArrangement: localSelectedArrangement,
      })
    );

    setHasUnsavedChanges(false);
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
              <h3 className="text-base mt-4 mb-2 font-semibold">
                Arrangements
              </h3>
              <ul className="scrollbar-variable rounded-md flex-1 overflow-y-auto bg-gray-800">
                {localArrangements.map((arrangement, index) => (
                  <Arrangement
                    key={arrangement.name}
                    index={index}
                    setSelectedArrangement={() =>
                      setLocalSelectedArrangement(index)
                    }
                    arrangement={arrangement}
                    setLocalArrangements={setLocalArrangements}
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
                !isMobile && selectedSectionIndex !== null && !isPreviewMinimized && "max-h-[75%] overflow-hidden"
              )}>
                <LyricBoxes
                  formattedLyrics={localFormattedLyrics}
                  reformatLyrics={updateFormattedLyricsAndSongOrder}
                  setFormattedLyrics={updateFormattedLyrics}
                  availableSections={availableSections}
                  onFormattedLyricsDelete={onFormattedLyricsDelete}
                  isMobile={isMobile || false}
                  selectedSectionIndex={selectedSectionIndex}
                  onSectionSelect={setSelectedSectionIndex}
                />
              </div>
              {!isMobile && selectedSectionIndex !== null && (
                <SectionPreview
                  selectedSection={localFormattedLyrics[selectedSectionIndex] || null}
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
                <div className="flex justify-end gap-4 mt-4 pt-4 border-t border-gray-600">
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
