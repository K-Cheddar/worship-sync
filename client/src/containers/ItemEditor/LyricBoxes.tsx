import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSelector } from "../../hooks";
import { FormattedLyrics as FormattedLyricsType } from "../../types";
import { RootState } from "../../store/store";
import cn from "classnames";
import LyrcisBox from "./LyrcisBox";
import { keepElementInView } from "../../utils/generalUtils";

const sizeMap: Map<number, string> = new Map([
  [7, "grid-cols-7"],
  [6, "grid-cols-6"],
  [5, "grid-cols-5"],
  [4, "grid-cols-4"],
  [3, "grid-cols-3"],
  [2, "grid-cols-2"],
  [1, "grid-cols-1"],
]);

type FormattedLyricsProps = {
  formattedLyrics: FormattedLyricsType[];
  setFormattedLyrics: (formattedLyrics: FormattedLyricsType[]) => void;
  reformatLyrics: (formattedLyrics: FormattedLyricsType[]) => void;
  availableSections: { value: string; label: string }[];
  onFormattedLyricsDelete: (index: number) => void;
  isMobile: boolean;
  selectedSectionId?: string | null;
  linkedSongOrderName?: string | null;
  recentlyMovedSectionId?: string | null;
  focusSectionId?: string | null;
  onMovedSectionTracked?: (sectionId: string) => void;
  onSectionSelect?: (sectionId: string | null) => void;
  /**
   * Increment when the parent adds or imports sections so the new selection scrolls into view.
   * (Renames / reorder via the section dropdown scroll in `handleChangeSectionType`.)
   */
  scrollSelectedIntoViewToken?: number;
};

const LyricBoxes = ({
  formattedLyrics,
  setFormattedLyrics,
  reformatLyrics,
  availableSections,
  onFormattedLyricsDelete,
  isMobile,
  selectedSectionId,
  linkedSongOrderName,
  recentlyMovedSectionId,
  focusSectionId,
  onMovedSectionTracked,
  onSectionSelect,
  scrollSelectedIntoViewToken = 0,
}: FormattedLyricsProps) => {
  const { formattedLyricsPerRow } = useSelector(
    (state: RootState) => state.undoable.present.preferences
  );

  const [glowingSectionId, setGlowingSectionId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const glowTimeoutRef = useRef<number | null>(null);
  const glowRestartTimeoutRef = useRef<number | null>(null);
  const prevScrollTokenRef = useRef<number | undefined>(undefined);
  const availableSectionsKey = useMemo(
    () => availableSections.map(({ value }) => value).join("|"),
    [availableSections]
  );

  const formattedLyricsRef = useRef(formattedLyrics);
  const reformatLyricsRef = useRef(reformatLyrics);
  const onFormattedLyricsDeleteRef = useRef(onFormattedLyricsDelete);
  formattedLyricsRef.current = formattedLyrics;
  reformatLyricsRef.current = reformatLyrics;
  onFormattedLyricsDeleteRef.current = onFormattedLyricsDelete;

  const scrollSectionBoxIntoView = useCallback((sectionId: string) => {
    const parent = listRef.current;
    const itemElement = document.getElementById(`lyric-box-${sectionId}`);
    if (!parent || !itemElement) {
      return;
    }
    keepElementInView({
      child: itemElement,
      parent,
      shouldScrollToCenter: true,
    });
  }, []);

  const triggerGlow = useCallback((sectionId: string) => {
    if (glowTimeoutRef.current !== null) {
      window.clearTimeout(glowTimeoutRef.current);
    }
    if (glowRestartTimeoutRef.current !== null) {
      window.clearTimeout(glowRestartTimeoutRef.current);
    }

    // Clear and reapply the class on the next tick so repeated moves on the
    // same section reliably restart the CSS glow animation.
    setGlowingSectionId(null);
    glowRestartTimeoutRef.current = window.setTimeout(() => {
      setGlowingSectionId(sectionId);
      glowTimeoutRef.current = window.setTimeout(() => {
        setGlowingSectionId((currentId) =>
          currentId === sectionId ? null : currentId
        );
      }, 1000);
    }, 0);
  }, []);

  useEffect(() => {
    return () => {
      if (glowTimeoutRef.current !== null) {
        window.clearTimeout(glowTimeoutRef.current);
      }
      if (glowRestartTimeoutRef.current !== null) {
        window.clearTimeout(glowRestartTimeoutRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    const prev = prevScrollTokenRef.current;
    prevScrollTokenRef.current = scrollSelectedIntoViewToken;
    if (prev === undefined || scrollSelectedIntoViewToken <= prev) {
      return;
    }
    if (!selectedSectionId) {
      return;
    }
    scrollSectionBoxIntoView(selectedSectionId);
  }, [scrollSelectedIntoViewToken, scrollSectionBoxIntoView, selectedSectionId]);

  useEffect(() => {
    if (!recentlyMovedSectionId || recentlyMovedSectionId !== selectedSectionId) {
      return;
    }

    let cancelled = false;
    const frameId = requestAnimationFrame(() => {
      if (cancelled) {
        return;
      }
      triggerGlow(selectedSectionId);
      onMovedSectionTracked?.(selectedSectionId);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [
    onMovedSectionTracked,
    recentlyMovedSectionId,
    selectedSectionId,
    triggerGlow,
  ]);

  const handleChangeSectionType = useCallback((name: string, index: number) => {
    const currentLyrics = formattedLyricsRef.current;
    const copiedFormattedLyrics = [...currentLyrics];
    const lyric = { ...copiedFormattedLyrics[index] };
    const previousType = lyric.type;

    const type = name.replace(/\s\d+$/, "");
    lyric.type = type;
    const targetIndex =
      name === type
        ? currentLyrics.length - 1
        : currentLyrics.findIndex((item) => item.name === name);
    const newIndex =
      previousType === type || targetIndex <= index
        ? targetIndex
        : targetIndex - 1;

    copiedFormattedLyrics.splice(index, 1);
    copiedFormattedLyrics.splice(newIndex, 0, lyric);

    const sectionIdToScroll = lyric.id;
    reformatLyricsRef.current(copiedFormattedLyrics);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollSectionBoxIntoView(sectionIdToScroll);
      });
    });
  }, [scrollSectionBoxIntoView]);

  const handleWordsChange = useCallback((index: number, value: string) => {
    const copiedFormattedLyrics = [...formattedLyricsRef.current];
    const lyric = { ...copiedFormattedLyrics[index] };
    lyric.words = value;
    copiedFormattedLyrics[index] = lyric;
    setFormattedLyrics(copiedFormattedLyrics);
  }, [setFormattedLyrics]);

  const handleDelete = useCallback((index: number) => {
    onFormattedLyricsDeleteRef.current(index);
  }, []);

  return (
    <ul
      id="lyrics-boxes-list"
      data-testid="lyrics-boxes-list"
      ref={listRef}
      className={cn(
        // items-start: avoid stretching every card to the row’s tallest cell (border looked huge vs lyrics).
        "scrollbar-variable grid h-full items-start gap-2 overflow-y-auto",
        isMobile ? "grid-cols-1" : sizeMap.get(formattedLyricsPerRow),
      )}
    >
      {formattedLyrics.map((lyric, index) => (
        <LyrcisBox
          key={lyric.id}
          lyric={lyric}
          index={index}
          selected={selectedSectionId === lyric.id}
          linked={!!(linkedSongOrderName && selectedSectionId !== lyric.id && lyric.name === linkedSongOrderName)}
          justMoved={glowingSectionId === lyric.id}
          availableSections={availableSections}
          availableSectionsKey={availableSectionsKey}
          isMobile={isMobile}
          onChangeSectionType={handleChangeSectionType}
          onDelete={handleDelete}
          onSelect={onSectionSelect || undefined}
          onWordsChange={handleWordsChange}
          focusWordsOnMount={
            Boolean(focusSectionId && lyric.id === focusSectionId)
          }
        />
      ))}
    </ul>
  );
};

export default LyricBoxes;
