import Button from "../../components/Button/Button";
import cn from "classnames";
import { ChevronsUpDown } from "lucide-react";
import { ChevronsDownUp } from "lucide-react";
import { FileQuestion } from "lucide-react";
import { Pencil } from "lucide-react";
import { PencilLine } from "lucide-react";
import { Headphones, Type, Layers } from "lucide-react";

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
import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import LocalVideoInputSlideBadge from "../../components/LocalVideoInputSlideBadge/LocalVideoInputSlideBadge";
import { useDispatch, useSelector } from "../../hooks";
import {
  applyPendingRemoteItem,
  keepLocalItemChanges,
  setSelectedBox,
  setSelectedSlide,
  setIsLyricsEditorOpen,
  setSongMetadata,
  applyPersistedSongAudio,
  setSongLinks,
  updateArrangements,
  updateSlides,
  applyOwnedContentMutation,
  setRestoreFocusToBox,
} from "../../store/itemSlice";
import {
  flushPendingItemMutations,
  getItemMutationOwner,
  scheduleOwnedItemMutation,
  type PendingItemMutationHandle,
  type ItemMutationOwner,
} from "../../store/deferredItemMutations";
import BibleItemActions from "./BibleItemActions";
import { setName, updateBoxes } from "../../store/itemSlice";
import { formatBible, formatFree, formatSong } from "../../utils/overflow";
import {
  getIndexFromSelectionHint,
  getSelectionHint,
} from "../../utils/selectionHint";
import { resolveFormattedCursorPosition } from "../../utils/cursorPosition";
import { DBItem, ItemSlideType, LocalVideoInputMediaSource, SongMetadata } from "../../types";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { setShouldShowItemEditor } from "../../store/preferencesSlice";
import {
  deleteSongAudioWithRetry,
  getSongAudioUrl,
  uploadSongAudio,
} from "../../api/auth";
import { broadcastItemUpdate, RootState } from "../../store/store";
import {
  deleteSongAudioBeforeClearingMetadata,
  persistSongAudioAttachment,
} from "../../utils/persistSongAudioAttachment";
import { getSlideVideoBackgroundLoop, resolveEditorPreviewVideoPlayback } from "../../utils/videoBackgroundPlayback";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import { AccessType } from "../../context/globalInfo";
import { ToastContext } from "../../context/toastContext";
import SectionTextEditor from "../../components/SectionTextEditor/SectionTextEditor";
import SlideBoxes from "../../components/SlideBoxes/SlideBoxes";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl";
import LocalVideoInputDetails from "../../components/LocalVideoInputDetails/LocalVideoInputDetails";
import LocalVideoInputPicker, {
  type LocalVideoCaptureMode,
} from "../../components/LocalVideoInputPicker/LocalVideoInputPicker";
import Icon from "../../components/Icon/Icon";
import TimerControls from "../../components/TimerControls/TimerControls";
import SlideEditorSkeleton from "./SlideEditorSkeleton";
import type { DisplayEditorChangeInfo } from "../../components/DisplayWindow/DisplayEditor";
import {
  ItemDetailsModal,
} from "../../components/ItemDetailsModal/ItemDetailsModal";
import ViewSongSectionsDrawer from "../../components/SongSections/ViewSongSectionsDrawer";
import { LastUpdatedByline } from "../../components/LastUpdatedByline/LastUpdatedByline";
import { useActiveControllerProfile } from "../../context/activeController";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/Popover";
import SongAudioPlayer from "../../components/SongAudioPlayer/SongAudioPlayer";
import {
  addItemToMediaList,
  updateMediaItemFields,
} from "../../store/mediaSlice";
import { getOrCreateDeviceId } from "../../utils/authStorage";
import { getTrustedDeviceLabel } from "../../utils/deviceInfo";
import {
  buildLocalVideoInputPresentation,
} from "../../utils/localVideoInput";
import type { PresentationControllerMode } from "../../context/presentationControllerMode";
import { resolveOutlineForScope } from "../../utils/outlineScope";
import type { PreparedMediaContext } from "../../utils/preparedMediaContext";
import { getFreeSectionNumber } from "../../utils/freeSectionNames";
import type { OwnedItemContentMutation } from "../../utils/ownedItemContentMutation";

/** Match slide name to lyric name so "Bridge 11" does not match lyric "Bridge 1". */
const slideNameMatchesLyric = (slideName: string, lyricName: string) =>
  slideName.startsWith(lyricName) && !/^\d/.test(slideName.slice(lyricName.length));

const shouldAdoptVideoInputSlideName = (
  slideName: string,
  previousLabel?: string,
) => {
  const trimmed = slideName.trim();
  if (!trimmed) return true;
  if (/^Section \d+$/i.test(trimmed)) return true;
  if (previousLabel && trimmed === previousLabel.trim()) return true;
  return false;
};

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

const SlideEditor = ({ access, presentationMode = "edit" }: { access?: AccessType; presentationMode?: PresentationControllerMode }) => {
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
    isLyricsEditorOpen,
    isLoading,
    isSectionLoading,
    restoreFocusToBox,
    hasRemoteUpdate,
    hasPendingUpdate,
    songMetadata,
    songLinks,
    songAudio,
    baseItem,
  } = item;
  const itemRef = useRef(item);
  itemRef.current = item;
  const itemOwner = getItemMutationOwner(item);
  const itemOwnerRef = useRef(itemOwner);
  itemOwnerRef.current = itemOwner;
  const showEditorSkeleton = isLoading || isSectionLoading;

  const arrangement = arrangements[selectedArrangement];

  const slides = useMemo(() => {
    const _slides = arrangement?.slides || __slides || [];
    return isLoading ? [] : _slides;
  }, [isLoading, __slides, arrangement?.slides]);

  const outputSlots = useSelector(
    (state: RootState) => state.presentation.outputs,
  );
  const editorVideoPlayback = useMemo(
    () => resolveEditorPreviewVideoPlayback(outputSlots, slides[selectedSlide]),
    [outputSlots, slides, selectedSlide],
  );

  const canEdit =
    access === "full" ||
    (access === "music" && (type === "song" || type === "free"));

  const { shouldShowItemEditor } = useSelector(
    (state: RootState) => state.undoable.present.preferences
  );
  const isPresentMode = presentationMode === "present";
  const activeControllerProfile = useActiveControllerProfile();
  const itemLists = useSelector(
    (state: RootState) => state.undoable.present.itemLists,
  );
  const editorPreparedMediaContext = useMemo<PreparedMediaContext>(() => {
    const outline = resolveOutlineForScope(
      itemLists.currentLists,
      activeControllerProfile.outlineScope,
      itemLists.selectedIdByScope[activeControllerProfile.outlineScope],
    );
    return {
      controllerProfileId: activeControllerProfile.id,
      controllerProfileName: activeControllerProfile.name,
      outlineScope: activeControllerProfile.outlineScope,
      outlineId: outline?._id ?? null,
      outlineName: outline?.name,
      contextSource: "persisted ItemLists fallback",
    };
  }, [
    itemLists,
    activeControllerProfile.id,
    activeControllerProfile.name,
    activeControllerProfile.outlineScope,
  ]);
  const canRelinkVideoInputInPresentMode =
    canEdit &&
    (activeControllerProfile.type === "aux-presentation" ||
      activeControllerProfile.type === "presentation");

  const [isItemDetailsModalOpen, setIsItemDetailsModalOpen] = useState(false);
  const [isSongDetailsDrawerOpen, setIsSongDetailsDrawerOpen] = useState(false);
  const [isOpeningLyricsEditor, setIsOpeningLyricsEditor] = useState(false);
  const [isVideoInputRelinkOpen, setIsVideoInputRelinkOpen] = useState(false);

  const [isBoxLocked, setIsBoxLocked] = useState<boolean[]>([]);

  const numBoxes = useMemo(() => {
    return slides?.[selectedSlide]?.boxes?.length || 0;
  }, [slides, selectedSlide]);

  useEffect(() => {
    setIsBoxLocked(Array(numBoxes).fill(true));
  }, [numBoxes]);

  const { db, isMobile = false } = useContext(ControllerInfoContext) || {};
  const globalInfo = useContext(GlobalInfoContext);
  const churchId = globalInfo?.churchId || "";
  const audioScopeRef = useRef({ churchId, db, itemId: _id });
  audioScopeRef.current = { churchId, db, itemId: _id };
  const toastContext = useContext(ToastContext);
  const showToast = toastContext?.showToast;
  const removeToast = toastContext?.removeToast;

  const [editorHeight, setEditorHeight] = useState(
    isMobile ? "calc(47.25vw + 60px)" : "23.625vw"
  );

  const [emptySlideHeight, setEmptySlideHeight] = useState(
    isMobile ? "calc(47.25vw + 60px)" : "23.625vw"
  );

  const reformatTimeoutRef = useRef<PendingItemMutationHandle | null>(null);
  const boxEditTimeoutRef = useRef<PendingItemMutationHandle | null>(null);
  const pendingBoxEditRef = useRef<{
    changeInfo: DisplayEditorChangeInfo;
    owner: ItemMutationOwner;
  } | null>(null);
  const cursorPositionsRef = useRef<Record<number, number>>({});
  const remoteUpdateToastIdRef = useRef<string | null>(null);
  const isEditorMountedRef = useRef(true);
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
    if (isLyricsEditorOpen) {
      setIsOpeningLyricsEditor(false);
    }
  }, [isLyricsEditorOpen]);

  const handleKeepLocalEdits = useCallback(() => {
    dispatch(keepLocalItemChanges());
  }, [dispatch]);

  const handleReloadRemote = useCallback(() => {
    dispatch(applyPendingRemoteItem());
  }, [dispatch]);

  useEffect(() => {
    if (hasRemoteUpdate && !isLyricsEditorOpen && !hasPendingUpdate) {
      handleReloadRemote();
      return;
    }

    if (!hasRemoteUpdate || isLyricsEditorOpen) {
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
    hasPendingUpdate,
    itemTypeLabel,
    isLyricsEditorOpen,
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
    isEditorMountedRef.current = true;
    return () => {
      isEditorMountedRef.current = false;
      flushPendingItemMutations(itemOwnerRef.current);
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

  const saveSongDetails = ({
    name: nextName,
    songMetadataPatch,
    songLinksPatch,
  }: {
    name: string;
    songMetadataPatch?: SongMetadata | null;
    songLinksPatch?: typeof songLinks;
  }) => {
    if (!db) {
      throw new Error("The song library is not available. Try again.");
    }
    dispatch(setName({ name: nextName }));
    if (songMetadataPatch !== undefined) {
      dispatch(setSongMetadata(songMetadataPatch));
    }
    if (songLinksPatch !== undefined) {
      dispatch(setSongLinks(songLinksPatch));
    }
  };

  const attachSongAudio = useCallback(
    async (file: File) => {
      if (!churchId || !db) {
        throw new Error("Sign in to attach an MP3.");
      }
      const previousAudio = songAudio;
      const owner = itemOwnerRef.current;
      const audio = await uploadSongAudio({
        churchId,
        songId: _id,
        file,
        previousAudio,
      });
      let saved;
      try {
        saved = await persistSongAudioAttachment({
          db,
          songId: _id,
          audio,
        });
      } catch (error) {
        // A replacement overwrites the existing final key. Deleting it here
        // would leave the still-old PouchDB metadata pointing at no object.
        if (!previousAudio || previousAudio.key !== audio.key) {
          try {
            await deleteSongAudioWithRetry({ churchId, songId: _id, audio });
          } catch (cleanupError) {
            console.error("Error cleaning unpersisted song audio:", cleanupError);
          }
        }
        throw error;
      }

      const currentScope = audioScopeRef.current;
      const isCurrentScope = isEditorMountedRef.current &&
        currentScope.churchId === churchId && currentScope.db === db;
      if (isCurrentScope) {
        if (currentScope.itemId === _id) {
          dispatch(applyPersistedSongAudio({ songAudio: audio, persistedDoc: saved, owner }));
        }
        broadcastItemUpdate(saved);
      }

      if (previousAudio && previousAudio.key !== audio.key) {
        try {
          await deleteSongAudioWithRetry({
            churchId,
            songId: _id,
            audio: previousAudio,
          });
        } catch (error) {
          console.error("Error cleaning replaced song audio:", error);
        }
      }
      if (isEditorMountedRef.current && audioScopeRef.current.churchId === churchId &&
        audioScopeRef.current.db === db && audioScopeRef.current.itemId === _id) {
        showToast?.({ message: "MP3 attached.", variant: "success" });
      }
    },
    [_id, churchId, db, dispatch, showToast, songAudio],
  );

  const resolveSongAudioUrl = useCallback(
    async (disposition: "inline" | "attachment") => {
      if (!churchId || !songAudio) {
        throw new Error("This song does not have an MP3 attached.");
      }
      const result = await getSongAudioUrl({
        churchId,
        songId: _id,
        audio: songAudio,
        disposition,
      });
      return result.url;
    },
    [_id, churchId, songAudio],
  );

  const removeSongAudio = useCallback(async () => {
    if (!churchId || !db || !songAudio) return;
    const owner = itemOwnerRef.current;
    const saved = await deleteSongAudioBeforeClearingMetadata({
      deleteAudio: () =>
        deleteSongAudioWithRetry({ churchId, songId: _id, audio: songAudio }),
      clearMetadata: () =>
        persistSongAudioAttachment({
          db,
          songId: _id,
          audio: null,
        }),
    });
    const currentScope = audioScopeRef.current;
    if (!isEditorMountedRef.current || currentScope.churchId !== churchId || currentScope.db !== db) return;
    if (currentScope.itemId === _id) {
      dispatch(applyPersistedSongAudio({ songAudio: undefined, persistedDoc: saved, owner }));
    }
    broadcastItemUpdate(saved);
    if (currentScope.itemId === _id) {
      showToast?.({ message: "MP3 removed.", variant: "success" });
    }
  }, [_id, churchId, db, dispatch, showToast, songAudio]);

  const onNameEditButtonClick = () => {
    if (!canEdit) return;
    if (type === "song") return;
    setIsItemDetailsModalOpen(true);
  };

  const nameEditButtonAriaLabel =
    type === "song" ? "Song details" : "Item details";

  const controllerSong = useMemo(
    () => ({
      ...(baseItem ?? {}),
      _id,
      name,
      type: "song" as const,
      arrangements,
      slides: __slides,
      selectedArrangement,
      songMetadata,
      songLinks,
      songAudio,
    }) as DBItem,
    [
      _id,
      __slides,
      arrangements,
      baseItem,
      name,
      selectedArrangement,
      songAudio,
      songLinks,
      songMetadata,
    ],
  );

  const applyBoxChange = useCallback(({
    index,
    value,
    box,
    cursorPosition,
    lastKeyPressed,
    expectedOwner: expectedOwnerOverride,
  }: DisplayEditorChangeInfo & { expectedOwner?: ItemMutationOwner }) => {
    if (!canEdit) {
      return;
    }

    // Songs/bible still allow Backspace/Delete on an empty box to remove the
    // slide. Free (custom) items keep an empty slide so clearing text never
    // removes the operator's slide structure.
    let shouldDeleteCurrentSlide = false;

    if (
      (type === "song" || type === "bible") &&
      (lastKeyPressed === "Backspace" || lastKeyPressed === "Delete") &&
      !value
    ) {
      shouldDeleteCurrentSlide = true;
    }

    if (typeof cursorPosition === "number") {
      cursorPositionsRef.current[index] = cursorPosition;
    }

    const currentItem = itemRef.current;
    const expectedOwner =
      expectedOwnerOverride ?? getItemMutationOwner(currentItem) ?? undefined;
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

    if (type === "timer" || type === "service-time") {
      dispatch(updateBoxes({ boxes: newBoxes, expectedOwner }));
    }

    const updatedSlides = currentItem.slides.map((slide, slideIndex) => {
      if (slideIndex === selectedSlide) {
        return { ...slide, boxes: newBoxes };
      }
      return slide;
    });

    if (shouldDeleteCurrentSlide) {
      updatedSlides.splice(selectedSlide, 1);
    }

    const updatedItem = {
      ...currentItem,
      slides: updatedSlides,
    };

    if (type === "bible") {
      const formattedItem = formatBible({
        item: updatedItem,
        mode: currentItem.bibleInfo?.fontMode || "separate",
      });
      dispatch(updateSlides({ slides: formattedItem.slides, expectedOwner }));
    }

    if (type === "free") {
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
          ...currentItem,
          slides: updatedSlides,
        });
        if (typeof cursorPosition === "number") {
          const newSlides = formattedItem.slides;
          const newSelectedIndex = resolveFormattedSlideIndex({
            oldSlides: currentItem.slides,
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
        dispatch(updateSlides({ slides: formattedItem.slides, expectedOwner }));
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

      const formattedSections = currentItem.formattedSections || [];
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
        ...currentItem,
        slides: updatedSlides,
        formattedSections: updatedFormattedSections,
      });
      if (typeof cursorPosition === "number") {
        const newSlides = formattedItem.slides;
        const newSelectedIndex = resolveFormattedSlideIndex({
          oldSlides: currentItem.slides,
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
        expectedOwner,
      }));
    }

    if (type === "song") {
      const currentArrangement = arrangements[selectedArrangement];
      if (!currentArrangement?.slides) return;

      if (selectedSlide === currentArrangement.slides.length - 1) {
        return;
      }

      if (box.excludeFromOverflow || selectedSlide === 0) {
        dispatch(updateBoxes({ boxes: newBoxes, expectedOwner }));
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
        dispatch(updateBoxes({ boxes: newBoxes, expectedOwner }));
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
        dispatch(updateArrangements({
          arrangements: formattedItem.arrangements,
          expectedOwner,
        }));
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

      dispatch(updateArrangements({
        arrangements: arrangementsWithBox,
        expectedOwner,
      }));
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
    boxEditTimeoutRef.current?.cancel();
    boxEditTimeoutRef.current = null;
    pendingBoxEditRef.current = null;
  }, []);

  useEffect(() => {
    clearPendingBoxEdit();
    setIsReformatting(false);
  }, [_id, selectedSlide, selectedArrangement, clearPendingBoxEdit]);

  const flushPendingBoxEdit = useCallback(
    (override?: DisplayEditorChangeInfo) => {
      const pending = override
        ? { changeInfo: override, owner: itemOwnerRef.current }
        : pendingBoxEditRef.current;
      clearPendingBoxEdit();

      if (!pending) return;

      setIsReformatting(false);
      applyBoxChange({
        ...pending.changeInfo,
        commitMode: "immediate",
        expectedOwner: pending.owner ?? undefined,
      });
    },
    [applyBoxChange, clearPendingBoxEdit]
  );

  const scheduleBoxEdit = useCallback(
    (changeInfo: DisplayEditorChangeInfo) => {
      clearPendingBoxEdit();
      const owner = itemOwnerRef.current;
      if (!owner) return;
      pendingBoxEditRef.current = { changeInfo, owner };
      setIsReformatting(true);
      boxEditTimeoutRef.current = scheduleOwnedItemMutation(owner, BOX_EDIT_DEBOUNCE_MS, () => {
        const pending = pendingBoxEditRef.current;
        pendingBoxEditRef.current = null;
        boxEditTimeoutRef.current = null;

        if (!pending) {
          setIsReformatting(false);
          return;
        }

        startTransition(() => {
          applyBoxChange({
            ...pending.changeInfo,
            commitMode: "immediate",
            expectedOwner: pending.owner,
          });
        });
        setIsReformatting(false);
      });
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
      (type === "song" || type === "bible") &&
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
      const sectionNum = getFreeSectionNumber(currentSlide);
      let name = currentSlide.name;
      if (sectionNum !== null) {
        const customName = item.formattedSections?.find(
          (section) => section.sectionNum === sectionNum,
        )?.name;
        name = customName?.trim() || `Section ${sectionNum}`;
      }
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
      const owner = itemOwner;
      if (!owner) return;

      const currentSlides = type === "song" && arrangement?.slides ? arrangement.slides : slides;
      const currentSlide = currentSlides?.[selectedSlide];
      if (!currentSlide?.id) return;

      let mutation: OwnedItemContentMutation;

      if (type === "free") {
        const currentSectionMatch = currentSlide.name?.match(/Section (\d+)/);
        const currentSectionNum = currentSectionMatch
          ? parseInt(currentSectionMatch[1])
          : 1;
        dispatch(applyOwnedContentMutation({
          owner,
          mutation: {
            kind: "sectionTextDraft",
            sectionNum: currentSectionNum,
            value: newText,
          },
        }));
        mutation = {
          kind: "sectionText",
          sectionNum: currentSectionNum,
          value: newText,
        };
      } else if (type === "song") {
        const targetArrangement = item.arrangements[selectedArrangement];
        const targetLyric = targetArrangement?.formattedLyrics.find((lyric) =>
          slideNameMatchesLyric(currentSlide.name, lyric.name),
        );
        if (!targetArrangement || !targetLyric) return;
        mutation = {
          kind: "sectionText",
          arrangementId: targetArrangement.id,
          sectionId: targetLyric.id,
          sectionName: targetLyric.name,
          value: newText,
        };
      } else {
        mutation = {
          kind: "boxWords",
          slideId: currentSlide.id,
          targetBoxId: currentSlide.boxes?.[selectedBox]?.id,
          boxIndex: selectedBox,
          value: newText,
        };
      }

      reformatTimeoutRef.current?.cancel();

      setIsReformatting(true);
      reformatTimeoutRef.current = scheduleOwnedItemMutation(owner, 300, () => {
        void dispatch(applyOwnedContentMutation({ owner, mutation }))
          .unwrap()
          .catch((error) => {
            console.error("Error reformatting section:", error);
          })
          .finally(() => {
            if (isEditorMountedRef.current) setIsReformatting(false);
          });
      });
    },
    [
      canEdit,
      slides,
      selectedSlide,
      selectedBox,
      type,
      item,
      itemOwner,
      selectedArrangement,
      arrangement,
      dispatch,
    ]
  );

  const selectedSlideMediaSource =
    slides[selectedSlide]?.mediaSource?.kind === "local-video-input"
      ? slides[selectedSlide].mediaSource
      : undefined;
  const editorLocalVideoInput = useMemo(() => {
    if (!selectedSlideMediaSource) return undefined;
    return buildLocalVideoInputPresentation(
      selectedSlideMediaSource,
      getOrCreateDeviceId(),
      getTrustedDeviceLabel(),
    );
  }, [selectedSlideMediaSource]);
  const videoInputCaptureMode: LocalVideoCaptureMode =
    selectedSlideMediaSource?.captureKind === "screen" ||
      selectedSlideMediaSource?.captureKind === "window"
      ? "desktop"
      : "device";
  const mediaList = useSelector((state: RootState) => state.media.list);

  const handleVideoInputRelinked = useCallback(
    (source: LocalVideoInputMediaSource) => {
      const previous = selectedSlideMediaSource;
      const ownedSource: LocalVideoInputMediaSource = {
        ...source,
        ownerDeviceId: getOrCreateDeviceId(),
        ownerLabel: getTrustedDeviceLabel(),
      };
      const now = new Date().toISOString();
      const mediaId = `local_input_${ownedSource.sourceId}`;
      const mediaPatch = {
        path: "",
        createdAt: now,
        updatedAt: now,
        format: "live",
        height: 1080,
        width: 1920,
        name: ownedSource.label,
        publicId: mediaId,
        type: "video" as const,
        id: mediaId,
        background: `local-video-input://${encodeURIComponent(ownedSource.sourceId)}`,
        thumbnail: "",
        placeholderImage: "",
        source: "local" as const,
        localVideoInput: ownedSource,
      };
      const existing = mediaList.find((m) => m.id === mediaId);
      if (existing) {
        dispatch(updateMediaItemFields({ id: mediaId, patch: mediaPatch }));
      } else {
        dispatch(addItemToMediaList(mediaPatch));
      }

      const applySource = (slide: ItemSlideType): ItemSlideType => {
        const nextName = shouldAdoptVideoInputSlideName(
          slide.name,
          previous?.label,
        )
          ? ownedSource.label.trim() || slide.name
          : slide.name;
        return {
          ...slide,
          name: nextName,
          mediaSource: ownedSource,
          boxes: slide.boxes.map((box, index) =>
            index === 0
              ? { ...box, background: "", mediaInfo: undefined }
              : box,
          ),
        };
      };

      if (type === "song" && arrangement?.slides) {
        const updatedArrangements = item.arrangements.map((arr, idx) => {
          if (idx !== item.selectedArrangement) return arr;
          return {
            ...arr,
            slides: arr.slides.map((slide, slideIndex) =>
              slideIndex === selectedSlide ? applySource(slide) : slide,
            ),
          };
        });
        dispatch(updateArrangements({ arrangements: updatedArrangements }));
      } else {
        dispatch(
          updateSlides({
            slides: slides.map((slide, slideIndex) =>
              slideIndex === selectedSlide ? applySource(slide) : slide,
            ),
          }),
        );
      }
      setIsVideoInputRelinkOpen(false);
    },
    [
      arrangement?.slides,
      dispatch,
      item.arrangements,
      item.selectedArrangement,
      mediaList,
      selectedSlide,
      selectedSlideMediaSource,
      slides,
      type,
    ],
  );

  const [editorView, setEditorView] = useState<{ itemId: string; view: "text" | "boxes" }>({ itemId: _id, view: "text" });
  if (editorView.itemId !== _id) {
    setEditorView({ itemId: _id, view: "text" });
  }
  const activeEditorView = editorView.itemId === _id ? editorView.view : "text";

  const leftColumnContent = useMemo(() => {
    if (isPresentMode) {
      if (selectedSlideMediaSource) {
        return (
          <LocalVideoInputDetails
            className="w-full"
            source={selectedSlideMediaSource}
            canEdit={canRelinkVideoInputInPresentMode}
            onEdit={() => setIsVideoInputRelinkOpen(true)}
          />
        );
      }
      if (type === "timer") {
        return (
          <TimerControls
            variant="controlsOnly"
            showTimeInput
            timeInputLayout="stacked"
            className="w-full"
          />
        );
      }
      return null;
    }
    if (selectedSlideMediaSource) {
      return (
        <LocalVideoInputDetails
          className="lg:flex-[0_0_30%] w-full"
          source={selectedSlideMediaSource}
          canEdit={canEdit}
          onEdit={() => setIsVideoInputRelinkOpen(true)}
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
        sectionName={isMobile && (type === "song" || type === "free") ? undefined : sectionName}
        sectionColor={sectionColor}
        isReformatting={isReformatting}
      />
    );
  }, [
    type,
    item,
    canEdit,
    sectionText,
    handleSectionTextChange,
    sectionName,
    sectionColor,
    isReformatting,
    arrangement?.slides,
    slides,
    selectedSlide,
    selectedSlideMediaSource,
    isPresentMode,
    canRelinkVideoInputInPresentMode,
    isMobile,
  ]);

  const editorWrapperStyle = {
    "--slide-editor-height": isMobile
      ? "fit-content"
      : `${isEmpty ? emptySlideHeight : editorHeight}`,
  } as CSSProperties;

  const mainEditorContent = (
    <>
      {showEditorSkeleton ? (
        <SlideEditorSkeleton mode={presentationMode} />
      ) : !isEmpty ? (
        <div className="flex flex-col lg:flex-row gap-2 w-full px-2">
          {(leftColumnContent || !isPresentMode) ? <div className="lg:flex-[0_0_30%] w-full min-h-0 min-w-0">
            <div className="flex h-full min-h-0 w-full flex-col gap-1">
              <LastUpdatedByline
                updatedBy={baseItem?.updatedBy}
                updatedAt={baseItem?.updatedAt}
                className="px-1"
              />
              {!isPresentMode && (
                <SegmentedControl
                  ariaLabel="Slide editor view"
                  variant="compact"
                  fullWidth
                  className="[&_button]:justify-center [&>button:first-of-type]:flex-[2] lg:[&>button]:py-0"
                  value={activeEditorView}
                  onChange={(view) => setEditorView({ itemId: _id, view })}
                  options={[
                    { value: "text", label: isMobile && (type === "song" || type === "free") && !selectedSlideMediaSource ? <span className="block min-w-0 max-w-full truncate">{sectionName}</span> : <><Type size={16} aria-hidden="true" />Text</> },
                    { value: "boxes", label: <><Layers size={16} aria-hidden="true" />Boxes</> },
                  ]}
                />
              )}
              <div className="min-h-0 flex-1" hidden={!isPresentMode && activeEditorView !== "text"}>{leftColumnContent}</div>
              {!isPresentMode && activeEditorView === "boxes" && (
                <div className="min-h-0 flex-1">
                  <SlideBoxes canEdit={canEdit} canDeleteBox={canDeleteBox} isBoxLocked={isBoxLocked} setIsBoxLocked={setIsBoxLocked} />
                </div>
              )}
            </div>
          </div> : null}

          <div className="relative lg:max-h-[42vh] max-lg:max-h-[30vh] flex-1 min-w-0 min-h-0">
            <DisplayWindow
              className={cn(
                isPresentMode
                  ? "lg:max-h-[36vh] max-lg:max-h-[30vh]"
                  : "lg:max-h-[42vh] max-lg:max-h-[30vh]",
                "h-full w-full",
              )}
              boxes={boxes}
              boxCursorPositions={cursorPositionsRef.current}
              selectBox={(val) => dispatch(setSelectedBox(val))}
              ref={editorRef}
              onChange={(onChangeInfo) => {
                onChange(onChangeInfo);
              }}
              displayType="editor"
              showLocalSourceStatus
              editorTransportOwner
              preparedMediaContext={editorPreparedMediaContext}
              currentItemId={_id}
              selectedBox={selectedBox}
              isBoxLocked={isBoxLocked}
              showEditorBoxBorder={!isPresentMode}
              disabled={!canEdit || isPresentMode}
              shouldPlayVideo
              videoPlayback={editorVideoPlayback}
              videoBackgroundLoop={getSlideVideoBackgroundLoop(slides[selectedSlide], type)}
              localVideoInput={editorLocalVideoInput}
              canCaptureLocalVideo={Boolean(editorLocalVideoInput)}
            />
            {slides[selectedSlide]?.mediaSource?.kind === "local-video-input" ? (
              <LocalVideoInputSlideBadge
                label={slides[selectedSlide].mediaSource.label}
                captureKind={slides[selectedSlide].mediaSource.captureKind}
                variant="banner"
                size="md"
              />
            ) : null}
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
            {!isPresentMode && type === "song" ? (
              <Button
                variant="tertiary"
                disabled={isLoading || !canEdit}
                svg={Pencil}
                onClick={() => setIsSongDetailsDrawerOpen(true)}
                aria-label={nameEditButtonAriaLabel}
              />
            ) : !isPresentMode ? (
              <Button
                variant="tertiary"
                disabled={isLoading || !canEdit}
                svg={Pencil}
                onClick={onNameEditButtonClick}
                aria-label={nameEditButtonAriaLabel}
              />
            ) : null}
            <span className="text-base font-semibold flex-1 truncate flex items-center gap-2 max-w-[calc(100%-2rem)]">
              <h2>{isLoading ? "" : name}</h2>
              {arrangement && (
                <p className="text-sm">
                  {isLoading ? "" : `(${arrangement?.name})`}
                </p>
              )}
            </span>
            {type === "song" && songAudio ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="tertiary"
                    svg={Headphones}
                    aria-label={`Listen to ${name}`}
                    disabled={isLoading}
                  />
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-80 border border-gray-600 bg-gray-900 p-3 text-white"
                >
                  <p className="mb-2 text-sm font-semibold">Reference MP3</p>
                  <SongAudioPlayer
                    audio={songAudio}
                    onGetUrl={resolveSongAudioUrl}
                  />
                </PopoverContent>
              </Popover>
            ) : null}
          </span>
          {type === "song" && (
            <Button
              variant="primary"
              color="#22d3ee"
              className="text-sm"
              disabled={
                isLoading || !canEdit || (isOpeningLyricsEditor && !isLyricsEditorOpen)
              }
              isLoading={isOpeningLyricsEditor && !isLyricsEditorOpen}
              onClick={() => {
                setIsOpeningLyricsEditor(true);
                // Defer so React can paint the button loading state before Redux + lyrics panel work.
                window.setTimeout(() => {
                  dispatch(setIsLyricsEditorOpen(true));
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
            aria-label={shouldShowItemEditor ? "Collapse item editor" : "Expand item editor"}
            onClick={() =>
              dispatch(setShouldShowItemEditor(!shouldShowItemEditor))
            }
            className="text-xs"
          />
        </section>
        {shouldShowItemEditor ? (
          <div
            className={cn(
              isPresentMode
                ? "mb-2 flex min-h-0 w-full justify-center"
                : "flex transition-all relative max-lg:flex-col gap-2 max-lg:items-center mb-2 z-1"
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
              showTimeInput
              className="w-full max-w-md"
            />
          </div>
        ) : type === "bible" && item.bibleInfo ? (
          <div
            className="mb-2 z-1 flex w-full justify-center px-2 pb-2"
            data-show={false}
            data-testid="bible-item-editor-collapsed-controls"
          >
            <BibleItemActions
              item={item}
              className="flex-row items-center gap-8"
              inlineVersionLabel
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
      {type !== "song" && (
        <ItemDetailsModal
          isOpen={isItemDetailsModalOpen}
          onClose={() => setIsItemDetailsModalOpen(false)}
          itemType={type}
          itemName={name}
          songMetadata={songMetadata}
          onSaveSuccess={() => setIsItemDetailsModalOpen(false)}
          onSave={saveSongDetails}
        />
      )}
      {type === "song" && (
        <ViewSongSectionsDrawer
          song={controllerSong}
          isOpen={isSongDetailsDrawerOpen}
          initialMode="edit"
          onClose={() => setIsSongDetailsDrawerOpen(false)}
          onSave={saveSongDetails}
          onSaveSuccess={() => setIsSongDetailsDrawerOpen(false)}
          onUploadSongAudio={attachSongAudio}
          onGetSongAudioUrl={resolveSongAudioUrl}
          onRemoveSongAudio={removeSongAudio}
        />
      )}
      {isVideoInputRelinkOpen && selectedSlideMediaSource ? (
        <LocalVideoInputPicker
          hideTrigger
          open
          captureMode={videoInputCaptureMode}
          source={selectedSlideMediaSource}
          onOpenChange={(open) => {
            if (!open) setIsVideoInputRelinkOpen(false);
          }}
          onLinked={handleVideoInputRelinked}
        />
      ) : null}
    </ErrorBoundary>
  );
};

export default SlideEditor;
