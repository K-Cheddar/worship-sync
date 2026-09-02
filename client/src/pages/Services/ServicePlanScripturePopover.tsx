import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BookOpen, Check, Plus } from "lucide-react";
import BibleSection from "../../containers/Bible/BibleSection";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import Select from "../../components/Select/Select";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { bibleVersions } from "../../utils/bibleVersions";
import { bibleStructure } from "../../utils/bibleStructure";
import { parseBibleReference } from "../../integrations/servicePlanning/parseBibleReference";
import { parseBibleSearchReference } from "../../utils/bibleReferenceParser";
import { getBibleImportDisplayName } from "../../utils/servicePlanningBibleImport";
import type { ServicePlanScriptureReference } from "../../types/servicePlan";

const DEFAULT_VERSION = "niv";
const FIELD_LABEL_CLASS = "text-neutral-100";

const getReferenceText = (book: string, chapter: string, startVerse: string, endVerse: string) => {
  if (!book || !chapter) return "";
  const verseRange = startVerse
    ? `:${startVerse}${endVerse && endVerse !== startVerse ? `-${endVerse}` : ""}`
    : "";
  return `${book} ${chapter}${verseRange}`;
};

export const SERVICE_PLAN_SCRIPTURE_ICON_CLASS = "text-violet-300";

type ServicePlanScripturePopoverProps = {
  disabled?: boolean;
  initialScriptureRef?: ServicePlanScriptureReference;
  onSelect: (scriptureRef: ServicePlanScriptureReference) => void;
  /** Controlled open. When set, pair with `onOpenChange` and optionally `anchor`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Use the anchor as a clickable trigger instead of a passive anchor. */
  trigger?: boolean;
  /**
   * When provided (controlled mode), the built-in "Add scripture" trigger is
   * omitted and this node is used as the popover anchor — typically the row's
   * Add menu button.
   */
  anchor?: ReactNode;
  /** Render inside a parent workspace instead of as a floating card. */
  inline?: boolean;
};

/**
 * Compact popover to attach a scripture reference to a plan element.
 * Kept separate from the song library modal — scripture only needs a
 * reference + version, not a full library browser.
 *
 * Supports a standalone trigger (tests / legacy) or a controlled open state
 * anchored to a parent control (the element-row Add menu).
 */
const ServicePlanScripturePopover = ({
  disabled = false,
  initialScriptureRef,
  onSelect,
  open: openProp,
  onOpenChange,
  anchor,
  inline = false,
  trigger = false,
}: ServicePlanScripturePopoverProps) => {
  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? openProp : uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [reference, setReference] = useState("");
  const [version, setVersion] = useState(DEFAULT_VERSION);
  const [bookIndex, setBookIndex] = useState(0);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [startVerseIndex, setStartVerseIndex] = useState(0);
  const [endVerseIndex, setEndVerseIndex] = useState(0);
  const isEditing = Boolean(initialScriptureRef);

  useEffect(() => {
    if (!open) return;
    if (!initialScriptureRef) {
      setReference("");
      setVersion(DEFAULT_VERSION);
      setBookIndex(0);
      setChapterIndex(0);
      setStartVerseIndex(0);
      setEndVerseIndex(0);
      return;
    }
    const verseSuffix = initialScriptureRef.verseRange
      ? `:${initialScriptureRef.verseRange}`
      : "";
    setReference(`${initialScriptureRef.book} ${initialScriptureRef.chapter}${verseSuffix}`);
    setVersion(initialScriptureRef.version.toLowerCase());
    const [start = "", end = start] = initialScriptureRef.verseRange.split("-");
    const nextBookIndex = bibleStructure.books.findIndex((item) => item.name === initialScriptureRef.book);
    const nextChapterIndex = bibleStructure.books[nextBookIndex]?.chapters.findIndex((item) => item.name === initialScriptureRef.chapter) ?? 0;
    setBookIndex(Math.max(0, nextBookIndex));
    setChapterIndex(Math.max(0, nextChapterIndex));
    setStartVerseIndex(Math.max(0, Number(start) - 1));
    setEndVerseIndex(Math.max(0, Number(end) - 1));
  }, [initialScriptureRef, open]);

  const parsedReference = useMemo(
    () => (reference.trim() ? parseBibleReference(reference.trim()) : null),
    [reference],
  );

  const syncPickerFromReference = (nextReference: string) => {
    const nextParsedReference = nextReference.trim()
      ? parseBibleReference(nextReference.trim())
      : null;
    if (!nextParsedReference) return;

    const [start = "", end = start] = nextParsedReference.verseRange.split("-");
    const nextBookIndex = bibleStructure.books.findIndex((item) => item.name === nextParsedReference.book);
    const nextChapterIndex = bibleStructure.books[nextBookIndex]?.chapters.findIndex((item) => item.name === nextParsedReference.chapter) ?? -1;
    if (nextBookIndex === -1 || nextChapterIndex === -1) return;
    setBookIndex(nextBookIndex);
    setChapterIndex(nextChapterIndex);
    setStartVerseIndex(Math.max(0, Number(start) - 1));
    setEndVerseIndex(Math.max(0, Number(end) - 1));
    if (nextParsedReference.version) {
      setVersion(nextParsedReference.version.toLowerCase());
    }
  };

  // Pasting the whole reference is the fast path — "Psalms 90 (NLT)" should
  // set the version too rather than silently attaching it as the default. The
  // picker stays authoritative afterwards, since this only fires when the
  // typed version itself changes.
  const typedVersion = parsedReference?.version.toLowerCase() || "";
  useEffect(() => {
    if (typedVersion) setVersion(typedVersion);
  }, [typedVersion]);

  const selectedBook = bibleStructure.books[bookIndex];
  const selectedChapter = selectedBook?.chapters[chapterIndex];
  const selectedVerses = selectedChapter?.verses || [];
  const searchValues = useMemo(
    () => (reference.trim() ? parseBibleSearchReference(reference.trim()) : null),
    [reference],
  );

  const reset = () => {
    setReference("");
    setVersion(DEFAULT_VERSION);
    setBookIndex(0);
    setChapterIndex(0);
    setStartVerseIndex(0);
    setEndVerseIndex(0);
  };

  const updatePickerReference = (
    nextBookIndex: number,
    nextChapterIndex: number,
    nextStartVerseIndex: number,
    nextEndVerseIndex: number,
  ) => {
    const nextBook = bibleStructure.books[nextBookIndex];
    const nextChapter = nextBook?.chapters[nextChapterIndex];
    const nextVerses = nextChapter?.verses || [];
    setReference(getReferenceText(
      nextBook?.name || "",
      nextChapter?.name || "",
      nextVerses[nextStartVerseIndex]?.name || "",
      nextVerses[nextEndVerseIndex]?.name || "",
    ));
  };

  const handleAttach = () => {
    if (!parsedReference) return;
    const upperVersion = version.toUpperCase();
    onSelect({
      label: getBibleImportDisplayName(parsedReference, upperVersion),
      book: parsedReference.book,
      chapter: parsedReference.chapter,
      verseRange: parsedReference.verseRange,
      version: upperVersion,
    });
    reset();
    setOpen(false);
  };

  const showBuiltInTrigger = !isControlled && !anchor;

  return (
    <Popover
      // Modal on purpose. This usually opens from the row's Add menu, and a
      // non-modal popover treats that menu's focus handling as it closes as an
      // interaction outside itself — dismissing the form before the operator
      // can type a reference. Modal traps focus (landing in the reference
      // field, which is where they want it) while still closing on Escape or a
      // click outside.
      modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      {showBuiltInTrigger ? (
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="tertiary"
            svg={Plus}
            iconSize="sm"
            disabled={disabled}
            isSelected={open}
            aria-expanded={open}
            aria-haspopup="dialog"
          >
            Add scripture
          </Button>
        </PopoverTrigger>
      ) : null}
      {anchor ? (
        trigger ? <PopoverTrigger asChild>{anchor}</PopoverTrigger> : <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      ) : null}
      <PopoverContent
        align="start"
        sideOffset={8}
        portal={!inline}
        staticContent={inline}
        className={inline
          ? "flex h-full min-h-0 w-full flex-1 border-0 bg-transparent p-0 text-white shadow-none"
          : "w-[min(22rem,calc(100vw-2rem))] border border-gray-700 bg-gray-900 p-3 text-white shadow-xl"}
      >
        <div className="flex h-full min-h-0 flex-1 flex-col gap-3 text-left">
          <Select
            label="Version"
            labelClassName={FIELD_LABEL_CLASS}
            value={version}
            onChange={setVersion}
            options={bibleVersions.map((item) => ({ value: item.value, label: item.label }))}
          />
          <Input
            label="Scripture reference"
            labelClassName={FIELD_LABEL_CLASS}
            placeholder="e.g. John 3:16-18"
            value={reference}
            autoFocus
            onChange={(value) => {
              const nextReference = String(value);
              setReference(nextReference);
              syncPickerFromReference(nextReference);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && parsedReference) {
                event.preventDefault();
                handleAttach();
              }
            }}
          />
          <div
            className="grid h-72 min-h-0 flex-1 grid-cols-[minmax(0,1.8fr)_repeat(3,minmax(0,1fr))] gap-2 overflow-hidden"
            aria-label="Browse scripture passage"
          >
            <BibleSection
              initialList={bibleStructure.books}
              setValue={setBookIndex}
              onSelect={(nextBookIndex) => {
                setChapterIndex(0);
                setStartVerseIndex(0);
                setEndVerseIndex(0);
                updatePickerReference(nextBookIndex, 0, 0, 0);
              }}
              value={bookIndex}
              type="book"
              searchValue={searchValues?.book || ""}
            />
            <BibleSection
              initialList={selectedBook?.chapters || []}
              setValue={setChapterIndex}
              onSelect={(nextChapterIndex) => {
                setStartVerseIndex(0);
                setEndVerseIndex(0);
                updatePickerReference(bookIndex, nextChapterIndex, 0, 0);
              }}
              value={chapterIndex}
              type="chapter"
              searchValue={searchValues?.chapter || ""}
            />
            <BibleSection
              initialList={selectedVerses}
              setValue={setStartVerseIndex}
              onSelect={(nextStartVerseIndex) => {
                const nextEndVerseIndex = Math.max(endVerseIndex, nextStartVerseIndex);
                setEndVerseIndex(nextEndVerseIndex);
                updatePickerReference(bookIndex, chapterIndex, nextStartVerseIndex, nextEndVerseIndex);
              }}
              value={startVerseIndex}
              type="verse"
              label="Start"
              searchValue={searchValues?.startVerse || ""}
            />
            <BibleSection
              initialList={selectedVerses}
              setValue={setEndVerseIndex}
              onSelect={(nextEndVerseIndex) =>
                updatePickerReference(bookIndex, chapterIndex, startVerseIndex, nextEndVerseIndex)
              }
              value={endVerseIndex}
              type="verse"
              label="End"
              min={startVerseIndex}
              searchValue={searchValues?.endVerse || ""}
            />
          </div>
          {reference.trim() && !parsedReference ? (
            <p className="text-sm text-amber-200" role="status">
              That doesn&apos;t look like a scripture reference yet — try
              something like &ldquo;John 3:16-18&rdquo;.
            </p>
          ) : null}
          {parsedReference ? (
            <p className="flex items-center gap-2 text-sm text-gray-300">
              <BookOpen
                className={`size-4 shrink-0 ${SERVICE_PLAN_SCRIPTURE_ICON_CLASS}`}
                aria-hidden
              />
              {getBibleImportDisplayName(parsedReference, version.toUpperCase())}
            </p>
          ) : null}
          <Button
            type="button"
            svg={isEditing ? Check : undefined}
            color={isEditing ? "#22d3ee" : undefined}
            className={isEditing ? "w-full justify-center" : undefined}
            disabled={!parsedReference}
            onClick={handleAttach}
          >
            {isEditing ? "Update scripture" : "Attach scripture"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ServicePlanScripturePopover;
