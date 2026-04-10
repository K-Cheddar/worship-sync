import Button from "../../components/Button/Button";
import cn from "classnames";
import { ChevronsUpDown } from "lucide-react";
import { ChevronsDownUp } from "lucide-react";
import { Check } from "lucide-react";
import { FileQuestion } from "lucide-react";
import { Pencil } from "lucide-react";
import { PencilLine } from "lucide-react";
import { X } from "lucide-react";

import Input from "../../components/Input/Input";
import {
  CSSProperties,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  borderColorMap,
  getItemTypeLabel,
  iconColorMap,
  svgMap,
} from "../../utils/itemTypeMaps";
import {
  INLINE_EDIT_CONFIRM_ICON_COLOR,
  handleInlineTextInputKeyDown,
} from "../../utils/inlineEdit";
import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import { useDispatch, useSelector } from "../../hooks";
import {
  applyPendingRemoteItem,
  discardPendingRemoteItem,
  setSelectedBox,
  setSelectedSlide,
  setIsEditMode,
  setSongMetadata,
  updateArrangements,
  updateSlides,
  setRestoreFocusToBox,
} from "../../store/itemSlice";
import BibleItemActions from "./BibleItemActions";
import { setName, updateBoxes } from "../../store/itemSlice";
import { formatBible, formatFree, formatSong } from "../../utils/overflow";
import {
  getIndexFromSelectionHint,
  getSelectionHint,
} from "../../utils/selectionHint";
import { resolveFormattedCursorPosition } from "../../utils/cursorPosition";
import { ItemSlideType, SongMetadata } from "../../types";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { setShouldShowItemEditor } from "../../store/preferencesSlice";
import { RootState } from "../../store/store";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { AccessType } from "../../context/globalInfo";
import { ToastContext } from "../../context/toastContext";
import SectionTextEditor from "../../components/SectionTextEditor/SectionTextEditor";
import SlideBoxes from "../../components/SlideBoxes/SlideBoxes";
import Icon from "../../components/Icon/Icon";
import TimerControls from "../../components/TimerControls/TimerControls";
import SlideEditorSkeleton from "./SlideEditorSkeleton";
import type { DisplayEditorChangeInfo } from "../../components/DisplayWindow/DisplayEditor";
import { SongItemMetadataModal } from "../../components/SongItemMetadataModal/SongItemMetadataModal";

/** Match slide name to lyric name so "Bridge 11" does not match lyric "Bridge 1". */
const slideNameMatchesLyric = (slideName: string, lyricName: string) =>
  slideName.startsWith(lyricName) && !/^\d/.test(slideName.slice(lyricName.length));

const BOX_EDIT_DEBOUNCE_MS = 200;

const resolveFormattedSlideIndex = ({
  oldSlides,
  newSlides,
  selectedSlide,
  maxSlideIndex,
}: {
  oldSlides: ItemSlideType[];
  newSlides: ItemSlideType[];
  selectedSlide: number;
  maxSlideIndex: number;
}) => {
  const hint = getSelectionHint(oldSlides, selectedSlide);
  const fromHint = hint ? getIndexFromSelectionHint(newSlides, hint) : null;
  return hint
    ? fromHint !== null
      ? Math.min(fromHint, maxSlideIndex)
      : Math.min(selectedSlide, maxSlideIndex)
    : Math.min(selectedSlide, maxSlideIndex);
};

const SlideEditor = ({ access }: { access?: AccessType }) => {
  const dispatch = useDispatch();

  const item = useSelector((state: RootState) => state.undoable.present.item);
  const {
    _id,
    name,
    type,
    arrangements,
    selectedArrangement,
    selectedSlide,
    selectedBox,
    slides: __slides,
    isEditMode,
    isLoading,
    isSectionLoading,
    restoreFocusToBox,
    hasRemoteUpdate,
    songMetadata,
  } = item;
  const showEditorSkeleton = isLoading || isSectionLoading;

  const arrangement = arrangements[selectedArrangement];

  const slides = useMemo(() => {
    const _slides = arrangement?.slides || __slides || [];
    return isLoading ? [] : _slides;
  }, [isLoading, __slides, arrangement?.slides]);

  const canEdit = access === "full" || (access === "music" && type === "song");

  const { shouldShowItemEditor, toolbarSection = "settings" } = useSelector(
    (state: RootState) => state.undoable.present.preferences
  );

  const [isEditingName, setIsEditingName] = useState(false);
  const [isSongMetadataModalOpen, setIsSongMetadataModalOpen] = useState(false);
  const [isOpeningLyricsEditor, setIsOpeningLyricsEditor] = useState(false);

  const [isBoxLocked, setIsBoxLocked] = useState<boolean[]>([]);

  const numBoxes = useMemo(() => {
    return slides?.[selectedSlide]?.boxes?.length || 0;
  }, [slides, selectedSlide]);

  useEffect(() => {
    setIsBoxLocked(Array(numBoxes).fill(true));
  }, [numBoxes]);

  const [localName, setLocalName] = useState(name || "");

  const { db, isMobile = false } = useContext(ControllerInfoContext) || {};
  const toastContext = useContext(ToastContext);
  const showToast = toastContext?.showToast;
  const removeToast = toastContext?.removeToast;

  const [editorHeight, setEditorHeight] = useState(
    isMobile ? "calc(47.25vw + 60px)" : "23.625vw"
  );

  const [emptySlideHeight, setEmptySlideHeight] = useState(
    isMobile ? "calc(47.25vw + 60px)" : "23.625vw"
  );

  const reformatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const boxEditTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingBoxEditRef = useRef<DisplayEditorChangeInfo | null>(null);
  const cursorPositionsRef = useRef<Record<number, number>>({});
  const remoteUpdateToastIdRef = useRef<string | null>(null);
  const [isReformatting, setIsReformatting] = useState(false);
  const itemTypeLabel = useMemo(() => getItemTypeLabel(type), [type]);

  useEffect(() => {
    if (!slides?.[selectedSlide] && selectedSlide !== 0) {
      dispatch(setSelectedSlide(Math.max(slides.length - 2, 0)));
    }
  }, [selectedSlide, slides, dispatch]);

  const editorRef = useCallback((node: HTMLDivElement) => {
    if (node) {
      const resizeObserver = new ResizeObserver((entries) => {
        setEditorHeight(`${entries[0].borderBoxSize[0].blockSize}px`);
      });

      resizeObserver.observe(node);
    }
  }, []);

  const emptySlideRef = useCallback((node: HTMLDivElement) => {
    if (node) {
      const resizeObserver = new ResizeObserver((entries) => {
        setEmptySlideHeight(`${entries[0].borderBoxSize[0].blockSize}px`);
      });

      resizeObserver.observe(node);
    }
  }, []);

  useEffect(() => {
    setLocalName(name || "");
  }, [name]);

  useEffect(() => {
    if (isEditMode) {
      setIsOpeningLyricsEditor(false);
    }
  }, [isEditMode]);

  const handleKeepLocalEdits = useCallback(() => {
    dispatch(discardPendingRemoteItem());
  }, [dispatch]);

  const handleReloadRemote = useCallback(() => {
    dispatch(applyPendingRemoteItem());
  }, [dispatch]);

  useEffect(() => {
    if (!hasRemoteUpdate || isEditMode) {
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

  useEffect(() => {
    if (restoreFocusToBox != null) {
      const boxIdx = restoreFocusToBox;
      dispatch(setRestoreFocusToBox(null));
      requestAnimationFrame(() => {
        const el = document.getElementById(
          `display-editor-box-${boxIdx}`
        ) as HTMLTextAreaElement | null;
        if (el) {
          el.focus();
          const pos = cursorPositionsRef.current[boxIdx];
          if (typeof pos === "number") {
            el.selectionStart = pos;
            el.selectionEnd = pos;
          }
          requestAnimationFrame(() => {
            el.scrollTop = 0;
          });
        }
      });
    }
  }, [selectedSlide, restoreFocusToBox, dispatch]);

  useEffect(() => {
    return () => {
      if (reformatTimeoutRef.current) {
        clearTimeout(reformatTimeoutRef.current);
      }
      if (boxEditTimeoutRef.current) {
        clearTimeout(boxEditTimeoutRef.current);
      }
    };
  }, []);

  const _boxes = useMemo(() => {
    // For songs, always use arrangement slides
    if (type === "song" && arrangement?.slides) {
      return arrangement.slides[selectedSlide]?.boxes || [];
    }
    // For other types, use item slides
    return slides?.[selectedSlide]?.boxes || [];
  }, [type, slides, selectedSlide, arrangement]);

  const boxes = useMemo(
    () => (isLoading ? [] : _boxes),
    [isLoading, _boxes]
  );

  const discardNameEdit = () => {
    setLocalName(name || "");
    setIsEditingName(false);
  };

  const saveName = () => {
    setIsEditingName(false);
    if (db) {
      dispatch(setName({ name: localName }));
    }
  };

  const saveSongDetails = ({
    name: nextName,
    songMetadataPatch,
  }: {
    name: string;
    songMetadataPatch?: SongMetadata | null;
  }) => {
    if (!db) return;
    dispatch(setName({ name: nextName }));
    if (songMetadataPatch !== undefined) {
      dispatch(setSongMetadata(songMetadataPatch));
    }
  };

  const onNameEditButtonClick = () => {
    if (type === "song") {
      setIsSongMetadataModalOpen(true);
      return;
    }
    if (isEditingName) {
      saveName();
      return;
    }
    setIsEditingName(true);
  };

  const nameEditButtonAriaLabel = (() => {
    if (type === "song") return "Song details";
    if (isEditingName) return "Save item name";
    return "Edit item name";
  })();

  const applyBoxChange = useCallback(({
    index,
    value,
    box,
    cursorPosition,
    lastKeyPressed,
  }: DisplayEditorChangeInfo) => {
    if (!canEdit) {
      return;
    }

    let shouldDeleteCurrentSlide = false;

    if (
      (lastKeyPressed === "Backspace" || lastKeyPressed === "Delete") &&
      !value
    ) {
      shouldDeleteCurrentSlide = true;
    }

    if (typeof cursorPosition === "number") {
      cursorPositionsRef.current[index] = cursorPosition;
    }

    const newBoxes = boxes.map((b, i) =>
      i === index
        ? {
          ...b,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          words: type === "bible" ? box.words : value,
        }
        : b
    );

    if (type === "timer") {
      dispatch(updateBoxes({ boxes: newBoxes }));
    }

    const updatedSlides = item.slides.map((slide, slideIndex) => {
      if (slideIndex === selectedSlide) {
        return { ...slide, boxes: newBoxes };
      }
      return slide;
    });

    if (shouldDeleteCurrentSlide) {
      updatedSlides.splice(selectedSlide, 1);
    }

    const updatedItem = {
      ...item,
      slides: updatedSlides,
    };

    if (type === "bible") {
      const formattedItem = formatBible({
        item: updatedItem,
        mode: item.bibleInfo?.fontMode || "separate",
      });
      dispatch(updateSlides({ slides: formattedItem.slides }));
    }

    if (type === "free") {
      if (shouldDeleteCurrentSlide) {
        dispatch(updateSlides({ slides: updatedSlides }));
      } else {
        const currentSlide = updatedSlides[selectedSlide];
        const currentSectionMatch = currentSlide?.name?.match(/Section (\d+)/);
        const currentSectionNum = currentSectionMatch
          ? parseInt(currentSectionMatch[1])
          : 1;

        const currentSectionSlidesWithIndices = updatedSlides
          .map((slide, idx) => ({ slide, idx }))
          .filter(({ slide }) => slide.name?.includes(`Section ${currentSectionNum}`))
          .sort((a, b) => a.idx - b.idx);

        const currentSlideIndexInSection = currentSectionSlidesWithIndices.findIndex(
          ({ idx }) => idx === selectedSlide
        );

        if (currentSlideIndexInSection === -1) {
          const formattedItem = formatFree({
            ...updatedItem,
          });
          if (typeof cursorPosition === "number") {
            const newSlides = formattedItem.slides;
            const newSelectedIndex = resolveFormattedSlideIndex({
              oldSlides: item.slides,
              newSlides,
              selectedSlide,
              maxSlideIndex: Math.max(0, newSlides.length - 1),
            });
            const nextWords =
              newSlides[newSelectedIndex]?.boxes[index]?.words || "";
            cursorPositionsRef.current[index] = resolveFormattedCursorPosition(
              value,
              nextWords,
              cursorPosition,
            );
          }
          dispatch(updateSlides({ slides: formattedItem.slides }));
          return;
        }

        let newWords = "";
        for (let i = 0; i < currentSectionSlidesWithIndices.length; ++i) {
          const { slide } = currentSectionSlidesWithIndices[i];
          const slideBox = slide?.boxes[index];
          const slideWords =
            i === currentSlideIndexInSection ? value : slideBox?.words || "";

          if (slideWords.trim().length > 0) {
            if (newWords) {
              const alreadyHasNewline = newWords.endsWith("\n");
              const shouldAddNewline = !alreadyHasNewline;
              newWords += shouldAddNewline ? "\n" + slideWords : slideWords;
            } else {
              newWords = slideWords;
            }
          }
        }

        const formattedSections = item.formattedSections || [];
        const updatedFormattedSections = formattedSections.map((section) => {
          if (section.sectionNum === currentSectionNum) {
            return {
              ...section,
              words: newWords,
            };
          }
          return section;
        });

        if (!updatedFormattedSections.find((section) => section.sectionNum === currentSectionNum)) {
          updatedFormattedSections.push({
            sectionNum: currentSectionNum,
            words: newWords,
            slideSpan: currentSectionSlidesWithIndices.length,
          });
        }

        const formattedItem = formatFree({
          ...updatedItem,
          formattedSections: updatedFormattedSections,
        });
        if (typeof cursorPosition === "number") {
          const newSlides = formattedItem.slides;
          const newSelectedIndex = resolveFormattedSlideIndex({
            oldSlides: item.slides,
            newSlides,
            selectedSlide,
            maxSlideIndex: Math.max(0, newSlides.length - 1),
          });
          const nextWords =
            newSlides[newSelectedIndex]?.boxes[index]?.words || "";
          cursorPositionsRef.current[index] = resolveFormattedCursorPosition(
            value,
            nextWords,
            cursorPosition,
          );
        }
        dispatch(updateSlides({
          slides: formattedItem.slides,
          formattedSections: formattedItem.formattedSections,
        }));
      }
    }

    if (type === "song") {
      const currentArrangement = arrangements[selectedArrangement];
      if (!currentArrangement?.slides) return;

      if (selectedSlide === currentArrangement.slides.length - 1) {
        return;
      }

      if (box.excludeFromOverflow || selectedSlide === 0) {
        dispatch(updateBoxes({ boxes: newBoxes }));
        return;
      }

      const formattedLyrics = currentArrangement.formattedLyrics || [];
      const arrangementSlides = currentArrangement.slides;
      const currentSlide = arrangementSlides[selectedSlide];

      if (!currentSlide) return;

      const lyricIndex = formattedLyrics.findIndex((lyric) =>
        slideNameMatchesLyric(currentSlide.name, lyric.name)
      );

      if (lyricIndex === -1) {
        dispatch(updateBoxes({ boxes: newBoxes }));
        return;
      }

      const formattedLyric = formattedLyrics[lyricIndex];
      const slideIndex = currentSlide.boxes[index]?.slideIndex || 0;
      const start = selectedSlide - slideIndex;
      const end = start + formattedLyric.slideSpan - 1;

      let newWords = "";
      for (let i = start; i <= end && i < arrangementSlides.length; ++i) {
        if (i === selectedSlide) {
          const alreadyHasNewline = value.endsWith("\n");
          const shouldAddNewline =
            i < end && !alreadyHasNewline && value.trim().length > 0;
          newWords += shouldAddNewline ? value + "\n" : value;
        } else {
          const slideBox = arrangementSlides[i]?.boxes[index];
          if (slideBox?.words) {
            newWords += slideBox.words;
          }
        }
      }

      if (shouldDeleteCurrentSlide) {
        newWords = newWords.trim();
      }

      if (newWords === "" && !shouldDeleteCurrentSlide) return;

      const updatedArrangements = item.arrangements.map((arr, arrIdx) => {
        if (arrIdx === selectedArrangement) {
          return {
            ...arr,
            formattedLyrics: formattedLyrics.map((lyric, lyricIdx) =>
              lyricIdx === lyricIndex ? { ...lyric, words: newWords } : lyric
            ),
          };
        }
        return arr;
      });

      const formattedItem = formatSong({
        ...item,
        arrangements: updatedArrangements,
        selectedArrangement,
      });

      if (shouldDeleteCurrentSlide) {
        dispatch(updateArrangements({ arrangements: formattedItem.arrangements }));
        return;
      }

      const newSlides = formattedItem.arrangements[selectedArrangement]?.slides ?? [];
      const hint = getSelectionHint(arrangementSlides, selectedSlide);
      const maxSlideIndex = Math.max(0, newSlides.length - 2);
      const fromHint = hint ? getIndexFromSelectionHint(newSlides, hint) : null;
      const newSelectedIndex =
        fromHint !== null
          ? Math.min(fromHint, maxSlideIndex)
          : Math.min(selectedSlide, maxSlideIndex);

      const arrangementsWithBox = formattedItem.arrangements.map((arr, arrIdx) => {
        if (arrIdx !== selectedArrangement) return arr;
        return {
          ...arr,
          slides: arr.slides.map((slide, slideIdx) => {
            if (slideIdx !== newSelectedIndex) return slide;
            return {
              ...slide,
              boxes: slide.boxes.map((b, boxIdx) =>
                boxIdx === index
                  ? { ...b, x: box.x, y: box.y, width: box.width, height: box.height }
                  : b
              ),
            };
          }),
        };
      });

      if (typeof cursorPosition === "number") {
        const nextWords =
          arrangementsWithBox[selectedArrangement]?.slides?.[newSelectedIndex]
            ?.boxes[index]?.words || "";
        cursorPositionsRef.current[index] = resolveFormattedCursorPosition(
          value,
          nextWords,
          cursorPosition,
        );
      }

      dispatch(updateArrangements({ arrangements: arrangementsWithBox }));
    }
  }, [
    canEdit,
    boxes,
    type,
    dispatch,
    item,
    selectedSlide,
    arrangements,
    selectedArrangement,
  ]);

  const clearPendingBoxEdit = useCallback(() => {
    if (boxEditTimeoutRef.current) {
      clearTimeout(boxEditTimeoutRef.current);
      boxEditTimeoutRef.current = null;
    }
    pendingBoxEditRef.current = null;
  }, []);

  useEffect(() => {
    clearPendingBoxEdit();
    setIsReformatting(false);
  }, [_id, selectedSlide, selectedArrangement, clearPendingBoxEdit]);

  const flushPendingBoxEdit = useCallback(
    (override?: DisplayEditorChangeInfo) => {
      const pending = override ?? pendingBoxEditRef.current;
      clearPendingBoxEdit();

      if (!pending) return;

      setIsReformatting(false);
      applyBoxChange({ ...pending, commitMode: "immediate" });
    },
    [applyBoxChange, clearPendingBoxEdit]
  );

  const scheduleBoxEdit = useCallback(
    (changeInfo: DisplayEditorChangeInfo) => {
      clearPendingBoxEdit();
      pendingBoxEditRef.current = changeInfo;
      setIsReformatting(true);
      boxEditTimeoutRef.current = setTimeout(() => {
        const pending = pendingBoxEditRef.current;
        pendingBoxEditRef.current = null;
        boxEditTimeoutRef.current = null;

        if (!pending) {
          setIsReformatting(false);
          return;
        }

        startTransition(() => {
          applyBoxChange({ ...pending, commitMode: "immediate" });
        });
        setIsReformatting(false);
      }, BOX_EDIT_DEBOUNCE_MS);
    },
    [applyBoxChange, clearPendingBoxEdit]
  );

  const onChange = useCallback((changeInfo: DisplayEditorChangeInfo) => {
    if (!canEdit) {
      return;
    }

    const {
      value,
      box,
      lastKeyPressed,
      commitMode = "typing",
    } = changeInfo;

    if (typeof changeInfo.cursorPosition === "number") {
      cursorPositionsRef.current[changeInfo.index] = changeInfo.cursorPosition;
    }

    const shouldDeleteCurrentSlide =
      (lastKeyPressed === "Backspace" || lastKeyPressed === "Delete") &&
      !value;
    const shouldCommitImmediatelyForLineShift = lastKeyPressed === "Enter";

    const currentArrangement = arrangements[selectedArrangement];
    const isSongOverflowEdit =
      type === "song" &&
      !!currentArrangement?.slides &&
      selectedSlide !== currentArrangement.slides.length - 1 &&
      !box.excludeFromOverflow &&
      selectedSlide !== 0 &&
      (() => {
        const currentSlide = currentArrangement.slides[selectedSlide];
        if (!currentSlide) return false;
        return (
          (currentArrangement.formattedLyrics || []).findIndex((lyric) =>
            slideNameMatchesLyric(currentSlide.name, lyric.name)
          ) !== -1
        );
      })();

    const shouldDebounceTextEdit =
      commitMode === "typing" &&
      !shouldDeleteCurrentSlide &&
      !shouldCommitImmediatelyForLineShift &&
      (type === "free" || isSongOverflowEdit);

    if (commitMode === "flush") {
      flushPendingBoxEdit(changeInfo);
      return;
    }

    if (commitMode === "immediate") {
      clearPendingBoxEdit();
      setIsReformatting(false);
      applyBoxChange(changeInfo);
      return;
    }

    if (shouldDebounceTextEdit) {
      scheduleBoxEdit(changeInfo);
      return;
    }

    clearPendingBoxEdit();
    setIsReformatting(false);
    applyBoxChange(changeInfo);
  }, [
    applyBoxChange,
    arrangements,
    canEdit,
    clearPendingBoxEdit,
    flushPendingBoxEdit,
    scheduleBoxEdit,
    selectedArrangement,
    selectedSlide,
    type,
  ]);

  const canDeleteBox = useCallback(
    (index: number) => {
      if (type === "bible") {
        return selectedSlide > 0 ? index > 2 : index > 1;
      }

      if (type === "song") {
        return index > 1;
      }

      if (type === "free" || type === "timer") {
        return index > 0;
      }

      return false;
    },
    [type, selectedSlide]
  );

  const isEmpty = _boxes.length === 0;

  // Helper function to get all section text
  const getSectionText = useCallback(
    (slide: ItemSlideType | undefined, boxIndex: number): string => {
      if (!slide) return "";

      if (type === "song") {
        const formattedLyrics =
          item.arrangements[item.selectedArrangement]?.formattedLyrics || [];
        const _index = formattedLyrics.findIndex((e) =>
          slideNameMatchesLyric(slide.name, e.name)
        );

        if (_index === -1) return slide.boxes[boxIndex]?.words || "";

        // Use the stored words from formattedLyrics
        return formattedLyrics[_index].words || "";
      }

      if (type === "free") {
        const currentSectionMatch = slide.name?.match(/Section (\d+)/);
        const currentSectionNum = currentSectionMatch
          ? parseInt(currentSectionMatch[1])
          : 1;

        const formattedSections = item.formattedSections || [];
        const section = formattedSections.find((s) => s.sectionNum === currentSectionNum);

        return section?.words || "";
      }

      // For other types, just return current slide text
      return slide.boxes[boxIndex]?.words || "";
    },
    [type, item]
  );

  // Get current section text for unified editor
  const sectionText = useMemo(() => {
    // For songs, use arrangement slides; for others, use item slides
    const currentSlides = type === "song" && arrangement?.slides ? arrangement.slides : slides;
    const currentSlide = currentSlides?.[selectedSlide];
    return getSectionText(currentSlide, selectedBox);
  }, [type, slides, selectedSlide, selectedBox, getSectionText, arrangement]);

  // Get current section name and color for display
  const { sectionName, sectionColor } = useMemo(() => {
    // For songs, use arrangement slides; for others, use item slides
    const currentSlides = type === "song" && arrangement?.slides ? arrangement.slides : slides;
    const currentSlide = currentSlides?.[selectedSlide];
    if (!currentSlide) {
      return { sectionName: "Editing section text", sectionColor: "bg-gray-500" };
    }

    if (type === "song") {
      // For songs, get the base section name (remove letter suffix like "A", "B", etc.)
      const formattedLyrics =
        item.arrangements[item.selectedArrangement]?.formattedLyrics || [];
      const lyricIndex = formattedLyrics.findIndex((lyric) =>
        slideNameMatchesLyric(currentSlide.name, lyric.name)
      );
      let name = "Editing section text";
      if (lyricIndex !== -1) {
        name = formattedLyrics[lyricIndex].name;
      } else {
        // Fallback to slide name without letter suffix
        name = currentSlide.name.replace(/[A-Z]$/, "") || currentSlide.name;
      }

      // Extract section type (e.g., "Verse", "Chorus") from name like "Verse 1"
      const sectionType = name.split(" ")[0];
      const bgColor = itemSectionBgColorMap.get(sectionType) || "bg-stone-500";

      return { sectionName: name, sectionColor: bgColor };
    }

    if (type === "free") {
      // For free types, show "Section X"
      const sectionMatch = currentSlide.name?.match(/Section (\d+)/);
      const name = sectionMatch ? `Section ${sectionMatch[1]}` : currentSlide.name;
      const bgColor = itemSectionBgColorMap.get("Section") || "bg-stone-500";
      return { sectionName: name, sectionColor: bgColor };
    }

    // For other types, show the slide name with item type color
    const name = currentSlide.name || "Editing section text";
    const itemColor = borderColorMap.get(type) || "border-gray-500";
    // Convert border color to background color (e.g., "border-cyan-500" -> "bg-cyan-500")
    const bgColor = itemColor.replace("border-", "bg-");
    return { sectionName: name, sectionColor: bgColor };
  }, [type, slides, selectedSlide, arrangement, item]);

  // Handle unified section text changes
  const handleSectionTextChange = useCallback(
    (newText: string, cursorPosition?: number) => {
      if (!canEdit) return;

      // Cursor position is tracked in SectionTextEditor component

      // Optimistic update: Update formattedSections immediately for instant feedback
      // For songs, use arrangement slides; for others, use item slides
      const currentSlides = type === "song" && arrangement?.slides ? arrangement.slides : slides;
      const currentSlide = currentSlides?.[selectedSlide];
      if (!currentSlide) return;

      if (type === "free") {
        const currentSectionMatch = currentSlide.name?.match(/Section (\d+)/);
        const currentSectionNum = currentSectionMatch
          ? parseInt(currentSectionMatch[1])
          : 1;

        const formattedSections = item.formattedSections || [];
        const updatedFormattedSections = formattedSections.map((section) => {
          if (section.sectionNum === currentSectionNum) {
            return {
              ...section,
              words: newText,
            };
          }
          return section;
        });

        if (!updatedFormattedSections.find((s) => s.sectionNum === currentSectionNum)) {
          updatedFormattedSections.push({
            sectionNum: currentSectionNum,
            words: newText,
            slideSpan: 1,
          });
        }

        // Optimistic update - update state immediately
        dispatch(
          updateSlides({
            slides: item.slides, // Keep current slides for now
            formattedSections: updatedFormattedSections,
          })
        );
      }

      // Clear any pending reformatting
      if (reformatTimeoutRef.current) {
        clearTimeout(reformatTimeoutRef.current);
      }

      // Debounce the actual reformatting
      setIsReformatting(true);
      reformatTimeoutRef.current = setTimeout(() => {
        try {
          if (type === "song") {
            const formattedLyrics =
              item.arrangements[item.selectedArrangement]?.formattedLyrics || [];
            const _index = formattedLyrics.findIndex((e) =>
              slideNameMatchesLyric(currentSlide.name, e.name)
            );

            if (_index === -1) {
              setIsReformatting(false);
              return;
            }

            const updatedArrangements = item.arrangements.map((arr, idx) => {
              if (idx === item.selectedArrangement) {
                return {
                  ...arr,
                  formattedLyrics: formattedLyrics.map((lyric, i) => {
                    if (i === _index) {
                      return {
                        ...lyric,
                        words: newText,
                      };
                    }
                    return lyric;
                  }),
                };
              }
              return arr;
            });

            const _item = formatSong(
              {
                ...item,
                arrangements: updatedArrangements,
                selectedArrangement,
              },
            );

            dispatch(updateArrangements({ arrangements: _item.arrangements }));
          }

          if (type === "free") {
            const currentSectionMatch = currentSlide.name?.match(/Section (\d+)/);
            const currentSectionNum = currentSectionMatch
              ? parseInt(currentSectionMatch[1])
              : 1;

            const formattedSections = item.formattedSections || [];
            const updatedFormattedSections = formattedSections.map((section) => {
              if (section.sectionNum === currentSectionNum) {
                return {
                  ...section,
                  words: newText,
                };
              }
              return section;
            });

            if (!updatedFormattedSections.find((s) => s.sectionNum === currentSectionNum)) {
              updatedFormattedSections.push({
                sectionNum: currentSectionNum,
                words: newText,
                slideSpan: 1,
              });
            }

            const updatedItem = {
              ...item,
              formattedSections: updatedFormattedSections,
            };

            const _item = formatFree(updatedItem);
            dispatch(
              updateSlides({
                slides: _item.slides,
                formattedSections: _item.formattedSections,
              })
            );
          } else {
            // For other types (bible, timer, etc.), update the box words directly
            const updatedSlides = item.slides.map((slide, index) => {
              if (index === selectedSlide) {
                const updatedBoxes = slide.boxes.map((box, boxIndex) => {
                  if (boxIndex === selectedBox) {
                    return {
                      ...box,
                      words: newText,
                    };
                  }
                  return box;
                });
                return {
                  ...slide,
                  boxes: updatedBoxes,
                };
              }
              return slide;
            });
            dispatch(updateSlides({ slides: updatedSlides }));
          }
        } catch (error) {
          console.error("Error reformatting section:", error);
          // Show error toast if available
          // Could use toast context here if needed
        } finally {
          setIsReformatting(false);
        }
      }, 300); // 300ms debounce
    },
    [
      canEdit,
      slides,
      selectedSlide,
      selectedBox,
      type,
      item,
      selectedArrangement,
      arrangement,
      dispatch,
    ]
  );

  const leftColumnContent = useMemo(() => {
    if (toolbarSection === "box-tools") {
      return (
        <SlideBoxes
          canEdit={canEdit}
          canDeleteBox={canDeleteBox}
          isBoxLocked={isBoxLocked}
          setIsBoxLocked={setIsBoxLocked}
        />
      );
    }
    if (type === "bible" && item.bibleInfo) {
      return <BibleItemActions item={item} />;
    }
    if (type === "timer") {
      return <TimerControls className="lg:flex-[0_0_30%] w-full" />;
    }
    return (
      <SectionTextEditor
        value={sectionText}
        onChange={handleSectionTextChange}
        disabled={
          !canEdit ||
          (type !== "song" && type !== "free") ||
          ((type === "song" && arrangement?.slides ? arrangement.slides : slides)?.[selectedSlide]?.type === "Blank")
        }
        sectionName={sectionName}
        sectionColor={sectionColor}
        isReformatting={isReformatting}
      />
    );
  }, [
    toolbarSection,
    type,
    item,
    canEdit,
    canDeleteBox,
    isBoxLocked,
    setIsBoxLocked,
    sectionText,
    handleSectionTextChange,
    sectionName,
    sectionColor,
    isReformatting,
    arrangement?.slides,
    slides,
    selectedSlide,
  ]);

  const editorWrapperStyle = {
    "--slide-editor-height": isMobile
      ? "fit-content"
      : `${isEmpty ? emptySlideHeight : editorHeight}`,
  } as CSSProperties;

  const mainEditorContent = (
    <>
      {showEditorSkeleton ? (
        <SlideEditorSkeleton />
      ) : !isEmpty ? (
        <div className="flex flex-col lg:flex-row gap-2 w-full px-2">
          <div className="lg:flex-[0_0_30%] w-full min-h-0">
            {leftColumnContent}
          </div>

          <div className="lg:max-h-[42vh] max-lg:max-h-[30vh] flex-1 min-w-0 min-h-0">
            <DisplayWindow
              className="lg:max-h-[42vh] max-lg:max-h-[30vh] h-full w-full"
              showBorder
              boxes={boxes}
              boxCursorPositions={cursorPositionsRef.current}
              selectBox={(val) => dispatch(setSelectedBox(val))}
              ref={editorRef}
              onChange={(onChangeInfo) => {
                onChange(onChangeInfo);
              }}
              displayType="editor"
              selectedBox={selectedBox}
              isBoxLocked={isBoxLocked}
              disabled={!canEdit}
              shouldPlayVideo
            />
          </div>
        </div>
      ) : (
        <p
          id="slide-editor-empty"
          ref={emptySlideRef}
          className="flex items-center justify-center text-gray-300 w-full h-[calc(42vw/(16/9))] max-lg:h-[calc(84vw/(16/9))]"
        >
          No slide selected
        </p>
      )}
    </>
  );

  return (
    <ErrorBoundary>
      <div>
        <section className="mb-1 flex w-full justify-end gap-1 overflow-hidden border-b border-white/20 bg-black/60 pr-2">
          <span
            className={cn(
              "flex mr-auto px-2 items-center gap-2 border-l-4 flex-1 max-w-[calc(100%-6rem)] max-lg:max-w-[calc(100%-4rem)]",
              borderColorMap.get(type)
            )}
          >
            <span className="hidden shrink-0 lg:flex" aria-hidden>
              <Icon
                svg={svgMap.get(type) ?? FileQuestion}
                color={iconColorMap.get(type)}
                size="md"
                overrideSmallMobile
              />
            </span>
            {type !== "song" && isEditingName && (
              <Button
                variant="tertiary"
                svg={X}
                onClick={discardNameEdit}
              />
            )}
            <Button
              variant="tertiary"
              disabled={isLoading || !canEdit}
              svg={type === "song" ? Pencil : isEditingName ? Check : Pencil}
              color={
                type !== "song" && isEditingName
                  ? INLINE_EDIT_CONFIRM_ICON_COLOR
                  : undefined
              }
              onClick={onNameEditButtonClick}
              aria-label={nameEditButtonAriaLabel}
            />
            {!isEditingName && (
              <span className="text-base font-semibold flex-1 truncate flex items-center gap-2 max-w-[calc(100%-2rem)]">
                <h2>{isLoading ? "" : name}</h2>
                {arrangement && (
                  <p className="text-sm">
                    {isLoading ? "" : `(${arrangement?.name})`}
                  </p>
                )}
              </span>
            )}
            {type !== "song" && isEditingName && (
              <Input
                hideLabel
                className="text-base font-semibold flex-1 truncate flex items-center gap-2 max-w-[calc(100%-2rem)]"
                value={localName || ""}
                onChange={(val) => setLocalName(val as string)}
                data-ignore-undo="true"
                onKeyDown={(e) =>
                  handleInlineTextInputKeyDown(e, {
                    onSave: saveName,
                    onCancel: discardNameEdit,
                  })
                }
              />
            )}
          </span>
          {type === "song" && (
            <Button
              variant="primary"
              color="#22d3ee"
              className="text-sm"
              disabled={
                isLoading || !canEdit || (isOpeningLyricsEditor && !isEditMode)
              }
              isLoading={isOpeningLyricsEditor && !isEditMode}
              onClick={() => {
                setIsOpeningLyricsEditor(true);
                // Defer so React can paint the button loading state before Redux + lyrics panel work.
                window.setTimeout(() => {
                  dispatch(setIsEditMode(true));
                }, 0);
              }}
              svg={PencilLine}
            >
              {isMobile ? "" : "Edit Lyrics"}
            </Button>
          )}
          <Button
            variant="tertiary"
            padding="p-1"
            svg={shouldShowItemEditor ? ChevronsUpDown : ChevronsDownUp}
            onClick={() =>
              dispatch(setShouldShowItemEditor(!shouldShowItemEditor))
            }
            className="text-xs"
          />
        </section>
        {shouldShowItemEditor ? (
          <div
            className={cn(
              "flex transition-all relative max-lg:flex-col gap-2 max-lg:items-center",
              "mb-2 z-1"
            )}
            data-show={true}
            style={editorWrapperStyle}
          >
            {mainEditorContent}
          </div>
        ) : type === "timer" ? (
          <div
            className="mb-2 z-1 flex w-full justify-center px-2 pb-2"
            data-show={false}
            data-testid="timer-item-editor-collapsed-controls"
          >
            <TimerControls
              variant="controlsOnly"
              className="w-full max-w-md"
            />
          </div>
        ) : (
          <div
            className={cn(
              "flex transition-all relative max-lg:flex-col gap-2 max-lg:items-center",
              "h-0 -z-1"
            )}
            data-show={false}
            style={editorWrapperStyle}
          >
            {mainEditorContent}
          </div>
        )}
      </div>
      <SongItemMetadataModal
        isOpen={isSongMetadataModalOpen}
        onClose={() => setIsSongMetadataModalOpen(false)}
        itemName={name}
        songMetadata={songMetadata}
        onSave={saveSongDetails}
      />
    </ErrorBoundary>
  );
};

export default SlideEditor;
