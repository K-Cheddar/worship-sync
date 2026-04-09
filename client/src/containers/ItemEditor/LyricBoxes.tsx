import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import Button from "../../components/Button/Button";
import Select from "../../components/Select/Select";
import { useSelector } from "../../hooks";
import { sectionTypes, itemSectionBgColorMap } from "../../utils/slideColorMap";
import { FormattedLyrics as FormattedLyricsType } from "../../types";
import generateRandomId from "../../utils/generateRandomId";
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
  recentlyMovedSectionId?: string | null;
  onMovedSectionTracked?: (sectionId: string) => void;
  onSectionSelect?: (sectionId: string | null) => void;
};

const LyricBoxes = ({
  formattedLyrics,
  setFormattedLyrics,
  reformatLyrics,
  availableSections,
  onFormattedLyricsDelete,
  isMobile,
  selectedSectionId,
  recentlyMovedSectionId,
  onMovedSectionTracked,
  onSectionSelect,
}: FormattedLyricsProps) => {
  const { formattedLyricsPerRow } = useSelector(
    (state: RootState) => state.undoable.present.preferences
  );

  const [newSectionType, setNewSectionType] = useState("Verse");
  const [glowingSectionId, setGlowingSectionId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const glowTimeoutRef = useRef<number | null>(null);
  const glowRestartTimeoutRef = useRef<number | null>(null);
  const scrollEndTimeoutRef = useRef<number | null>(null);
  const availableSectionsKey = useMemo(
    () => availableSections.map(({ value }) => value).join("|"),
    [availableSections]
  );
  const sectionOrderKey = useMemo(
    () => formattedLyrics.map(({ id, name }) => id || name).join("|"),
    [formattedLyrics]
  );

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
      if (scrollEndTimeoutRef.current !== null) {
        window.clearTimeout(scrollEndTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedSectionId || !listRef.current) {
      return;
    }

    const parentElement = listRef.current;
    const itemElement = document.getElementById(`lyric-box-${selectedSectionId}`);
    if (!itemElement) {
      return;
    }

    const didScroll = keepElementInView({
      child: itemElement,
      parent: parentElement,
      shouldScrollToCenter: true,
    });

    if (recentlyMovedSectionId !== selectedSectionId) {
      return;
    }

    let isActive = true;

    const finishTracking = () => {
      if (!isActive) {
        return;
      }

      triggerGlow(selectedSectionId);
      onMovedSectionTracked?.(selectedSectionId);
    };

    if (!didScroll) {
      finishTracking();
      return;
    }

    const handleScroll = () => {
      if (scrollEndTimeoutRef.current !== null) {
        window.clearTimeout(scrollEndTimeoutRef.current);
      }

      scrollEndTimeoutRef.current = window.setTimeout(() => {
        parentElement.removeEventListener("scroll", handleScroll);
        finishTracking();
      }, 120);
    };

    parentElement.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      isActive = false;
      parentElement.removeEventListener("scroll", handleScroll);
      if (scrollEndTimeoutRef.current !== null) {
        window.clearTimeout(scrollEndTimeoutRef.current);
      }
    };
  }, [
    onMovedSectionTracked,
    recentlyMovedSectionId,
    sectionOrderKey,
    selectedSectionId,
    triggerGlow,
  ]);

  const addSection = () => {
    reformatLyrics([
      ...formattedLyrics,
      {
        type: newSectionType,
        name: "",
        words: "",
        slideSpan: 1,
        id: generateRandomId(),
      },
    ]);
  };

  const handleChangeSectionType = useCallback((name: string, index: number) => {
    const copiedFormattedLyrics = [...formattedLyrics];
    const lyric = { ...copiedFormattedLyrics[index] };
    const previousType = lyric.type;

    const type = name.replace(/\s\d+$/, "");
    lyric.type = type;
    const targetIndex =
      name === type
        ? formattedLyrics.length - 1
        : formattedLyrics.findIndex((item) => item.name === name);
    const newIndex =
      previousType === type || targetIndex <= index
        ? targetIndex
        : targetIndex - 1;

    copiedFormattedLyrics.splice(index, 1);
    copiedFormattedLyrics.splice(newIndex, 0, lyric);

    reformatLyrics(copiedFormattedLyrics);
  }, [formattedLyrics, reformatLyrics]);

  const handleWordsChange = useCallback((index: number, value: string) => {
    const copiedFormattedLyrics = [...formattedLyrics];
    const lyric = { ...copiedFormattedLyrics[index] };
    lyric.words = value;
    copiedFormattedLyrics[index] = lyric;
    setFormattedLyrics(copiedFormattedLyrics);
  }, [formattedLyrics, setFormattedLyrics]);

  return (
    <ul
      id="lyrics-boxes-list"
      data-testid="lyrics-boxes-list"
      ref={listRef}
      className={cn(
        "scrollbar-variable grid gap-2 overflow-y-auto",
        isMobile ? "grid-cols-1" : sizeMap.get(formattedLyricsPerRow),
        "max-h-[calc(100%-clamp(2.5rem,2.5vw,3.5rem))]"
      )}
    >
      {formattedLyrics.map((lyric, index) => (
        <LyrcisBox
          key={lyric.id}
          lyric={lyric}
          index={index}
          selected={selectedSectionId === lyric.id}
          justMoved={glowingSectionId === lyric.id}
          availableSections={availableSections}
          availableSectionsKey={availableSectionsKey}
          isMobile={isMobile}
          onChangeSectionType={handleChangeSectionType}
          onDelete={onFormattedLyricsDelete}
          onSelect={onSectionSelect || undefined}
          onWordsChange={handleWordsChange}
        />
      ))}
      <li className="flex flex-col px-2">
        <Select
          onChange={(val) => {
            setNewSectionType(val);
          }}
          value={newSectionType}
          options={sectionTypes.map((type) => ({
            value: type,
            label: type,
            className: cn(
              itemSectionBgColorMap.get(type) ?? "bg-gray-700",
              "text-white rounded px-2 py-0.5 block w-full text-left"
            ),
          }))}
          className="flex font-semibold text-sm rounded-t-md bg-gray-900/80"
          backgroundColor="bg-black/40"
          textColor="text-white"
          chevronColor="text-white"
          contentBackgroundColor="bg-gray-800"
          contentTextColor="text-white"
        />
        <Button
          key="lyrics-box-add-section"
          onClick={() => addSection()}
          variant="tertiary"
          svg={Plus}
          iconSize={64}
          className="w-full flex-1 justify-center border border-gray-500 rounded-md"
        />
      </li>
    </ul>
  );
};

export default LyricBoxes;
