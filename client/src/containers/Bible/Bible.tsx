import { useRef, useContext, useEffect, useMemo, useState, useCallback } from "react";
import Select from "../../components/Select/Select";
import BibleSection from "./BibleSection";
import { bookType, chapterType, DBBibleChapter, verseType } from "../../types";
import { Button, ButtonGroup, ButtonGroupItem } from "../../components/Button";
import { useDispatch, useSelector } from "../../hooks";
import {
  setBook,
  setChapter,
  setEndVerse,
  setStartVerse,
  setVerses,
  setVersion,
  setSearchValue,
  setChapters,
  setSearch,
  setLoadingChapter,
  openBibleAtLocation,
} from "../../store/bibleSlice";
import { bibleVersions } from "../../utils/bibleVersions";
import {
  BulkBibleImportReview,
  ExtractedBibleReference,
  extractBibleReferencesFromText,
  parseBibleSearchReference,
} from "../../utils/bibleReferenceParser";
import {
  createBibleItemFromParsedReference,
  loadBibleChapterVerses,
  selectBibleVersesFromRange,
} from "../../utils/servicePlanningBibleImport";
import { getVerses as getVersesApi } from "../../api/getVerses";
import BibleVersesList from "./BibleVersesList";
import { hasRenderableVersesInRange } from "./bibleVerseRange";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatBible } from "../../utils/overflow";
import { setActiveItem } from "../../store/itemSlice";
import { addItemToItemList } from "../../store/itemListSlice";
import { ArrowLeft, Check, FileInput, Plus, X } from "lucide-react";
import {
  updateBibleDisplayInfo,
  updatePresentation,
} from "../../store/presentationSlice";
import { createItemFromProps, createNewBible } from "../../utils/itemUtil";
import generateRandomId from "../../utils/generateRandomId";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { addItemToAllItemsList } from "../../store/allItemsSlice";
import { resetCreateItem } from "../../store/createItemSlice";
import { useStore } from "react-redux";
import { RootState } from "../../store/store";
import useDebouncedEffect from "../../hooks/useDebouncedEffect";
import Spinner from "../../components/Spinner/Spinner";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import Input from "../../components/Input/Input";
import TextArea from "../../components/TextArea/TextArea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/Popover";
import cn from "classnames";

const BULK_BIBLE_IMPORT_STORAGE_PREFIX = "worshipSync_bibleBulkImport_";
const BULK_BIBLE_IMPORT_ACTIVE_ID_KEY = "worshipSync_bibleBulkImport_activeId";

const getBulkBibleImportStorageKey = (id: string) =>
  `${BULK_BIBLE_IMPORT_STORAGE_PREFIX}${id}`;

const clearActiveBulkBibleImport = () => {
  window.sessionStorage.removeItem(BULK_BIBLE_IMPORT_ACTIVE_ID_KEY);
};

const Bible = () => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const {
    version,
    books,
    book,
    chapters,
    chapter,
    verses,
    startVerse,
    endVerse,
    isLoadingChapter,
    searchValues,
    search,
  } = useSelector((state: RootState) => state.bible);

  const {
    isMonitorTransmitting,
    isProjectorTransmitting,
    isStreamTransmitting,
  } = useSelector((state: RootState) => state.presentation);

  const {
    preferences: {
      defaultBibleBackground,
      defaultBibleBackgroundBrightness,
      defaultBibleFontMode,
    },
  } = useSelector((state: RootState) => state.undoable.present.preferences);

  const { list } = useSelector((state: RootState) => state.allItems);

  const [showVersesDisplaySection, setShowVersesDisplaySection] =
    useState(false);

  const currentVerses = useRef<verseType[]>(verses);
  const currentEndVerse = useRef<number>(endVerse);
  const currentStartVerse = useRef<number>(startVerse);

  useEffect(() => {
    currentVerses.current = verses;
    currentEndVerse.current = endVerse;
    currentStartVerse.current = startVerse;
  }, [verses, endVerse, startVerse]);

  const [justAdded, setJustAdded] = useState(false);
  const [fetchedChapters, setFetchedChapters] = useState<Set<string>>(
    new Set()
  );
  const [bulkImportText, setBulkImportText] = useState("");
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [bulkReview, setBulkReview] = useState<BulkBibleImportReview | null>(
    null
  );
  const [selectedBulkRowIds, setSelectedBulkRowIds] = useState<Set<string>>(
    new Set()
  );
  const [addedBulkRowIds, setAddedBulkRowIds] = useState<Set<string>>(
    new Set()
  );
  const [bulkRowMessages, setBulkRowMessages] = useState<Record<string, string>>(
    {}
  );
  const [isAddingBulkRows, setIsAddingBulkRows] = useState(false);

  const createItemName = decodeURI(searchParams.get("name") || "");
  const hasNavigatedFromUrl = useRef(false);
  const bulkImportMode = searchParams.get("bulkImport");
  const bulkImportId = searchParams.get("id");
  const isBulkReviewMode = bulkImportMode === "review" && Boolean(bulkImportId);

  const {
    db,
    bibleDb,
    bibleDbProgress,
    isMobile = false,
  } = useContext(ControllerInfoContext) || {};
  const { access, loginState } = useContext(GlobalInfoContext) || {};
  const canAddBibleToOutline = access !== "view";
  const isOfflineGuest = loginState === "guest";

  const loadBulkReviewFromStorage = useCallback((id: string) => {
    try {
      const raw = window.sessionStorage.getItem(getBulkBibleImportStorageKey(id));
      if (!raw) {
        setBulkReview(null);
        setSelectedBulkRowIds(new Set());
        setAddedBulkRowIds(new Set());
        setBulkRowMessages({});
        return;
      }

      const review = JSON.parse(raw) as BulkBibleImportReview;
      setBulkReview(review);
      setSelectedBulkRowIds(
        new Set(
          review.rows
            .filter((row) => row.status === "ready")
            .map((row) => row.id)
        )
      );
      setAddedBulkRowIds(new Set());
      setBulkRowMessages({});
    } catch {
      setBulkReview(null);
      setSelectedBulkRowIds(new Set());
      setAddedBulkRowIds(new Set());
      setBulkRowMessages({});
    }
  }, []);

  useEffect(() => {
    if (bulkImportMode === "review" && bulkImportId) {
      window.sessionStorage.setItem(
        BULK_BIBLE_IMPORT_ACTIVE_ID_KEY,
        bulkImportId
      );
      loadBulkReviewFromStorage(bulkImportId);
    } else if (!searchParams.toString()) {
      const activeId = window.sessionStorage.getItem(
        BULK_BIBLE_IMPORT_ACTIVE_ID_KEY
      );
      if (activeId) {
        navigate(
          `/controller/bible?bulkImport=review&id=${encodeURIComponent(activeId)}`,
          { replace: true }
        );
      } else {
        setBulkReview(null);
      }
    } else {
      setBulkReview(null);
    }
  }, [
    bulkImportId,
    bulkImportMode,
    loadBulkReviewFromStorage,
    navigate,
    searchParams,
  ]);

  const bibleItemName = useMemo(() => {
    const bookName = books?.[book]?.name || "";
    const chapterName = chapters?.[chapter]?.name || "";
    const startVerseName = verses?.[startVerse]?.name || "";
    const endVerseName = verses?.[endVerse]?.name || "";

    const verseName =
      startVerse === endVerse
        ? startVerseName
        : `${startVerseName} - ${endVerseName}`;

    return `${bookName} ${chapterName}:${verseName} ${version.toUpperCase()}`;
  }, [books, book, chapters, chapter, verses, endVerse, startVerse, version]);

  const hasRenderableVerses = useMemo(
    () => hasRenderableVersesInRange(verses, startVerse, endVerse),
    [verses, startVerse, endVerse]
  );

  useDebouncedEffect(
    () => {
      if (isOfflineGuest) {
        dispatch(setVerses([]));
        dispatch(setLoadingChapter(false));
        return;
      }

      const getChapter = async () => {
        try {
          const bookName = books[book]?.name || "";
          const chapterName = books[book]?.chapters?.[chapter]?.name || "";
          if (bibleDb && bookName && chapterName) {
            const key = `${version}-${bookName}-${chapterName}`;
            let chapterDoc: DBBibleChapter | null = null;

            let newVerses: verseType[] = [];

            try {
              chapterDoc = (await bibleDb.get(key)) as DBBibleChapter;
            } catch (error) {
              await bibleDb.put({
                _id: key,
                verses: [],
                book: bookName,
                chapter: chapterName,
                version,
                lastUpdated: new Date().toISOString(),
                isFromBibleGateway: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
              console.error(error);
            }

            if (chapterDoc) {
              const lastUpdated = new Date(chapterDoc.lastUpdated);
              const oneYearAgo = new Date();
              oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
              if (lastUpdated > oneYearAgo && chapterDoc.isFromBibleGateway) {
                newVerses = chapterDoc.verses;
              }
            }

            if (!newVerses.length) {
              dispatch(setLoadingChapter(true));

              let data: chapterType | null = null;

              try {
                const chapterKey = `${bookName}-${chapterName}-${version}`;
                if (!fetchedChapters.has(chapterKey)) {
                  setFetchedChapters((prev) => new Set(prev).add(chapterKey));
                  // Fetch from Bible Gateway if we don't have an updated version
                  data = await getVersesApi({
                    book: bookName,
                    chapter,
                    version,
                  });
                  if (data?.verses?.length) {
                    newVerses = data.verses;

                    try {
                      chapterDoc = (await bibleDb.get(key)) as DBBibleChapter;
                      chapterDoc.verses = data.verses;
                      chapterDoc.lastUpdated = new Date().toISOString();
                      chapterDoc.isFromBibleGateway = true;
                      chapterDoc.updatedAt = new Date().toISOString();
                      await bibleDb.put(chapterDoc);
                    } catch (error) {
                      console.error(error);
                    }
                  } else {
                    if (chapterDoc?.verses.length) {
                      newVerses = chapterDoc.verses;
                    } else {
                      newVerses = [];
                    }
                  }
                } else {
                  newVerses = chapterDoc?.verses || [];
                }
              } catch (error) {
                newVerses = [];
                console.error(error);
              }
            }
            dispatch(setVerses(newVerses));
            const latestSearchValues = store.getState().bible.searchValues;
            if (!latestSearchValues.endVerse) {
              dispatch(setEndVerse(newVerses.length - 1) || 0);
            }

            if (!latestSearchValues.startVerse) {
              dispatch(setStartVerse(0));
            }
          }
        } finally {
          dispatch(setLoadingChapter(false));
        }
      };
      getChapter();
    },
    [chapter, dispatch, bibleDb, version, books, book, isOfflineGuest, store],
    500,
    true
  );


  const submitVerses = async () => {
    const versesToUse = verses.filter(
      ({ index }) => index >= startVerse && index <= endVerse
    );

    const item = await createNewBible({
      fontMode: defaultBibleFontMode,
      name: createItemName || bibleItemName,
      book: books[book].name,
      chapter: chapters[chapter].name,
      version,
      verses: versesToUse,
      db,
      list,
      background: defaultBibleBackground.background,
      mediaInfo: defaultBibleBackground.mediaInfo,
      brightness: defaultBibleBackgroundBrightness,
    });

    const itemForList = {
      _id: item._id,
      name: item.name,
      type: "bible",
      background: item.background,
      listId: generateRandomId(),
    };

    dispatch(addItemToItemList(itemForList));
    dispatch(addItemToAllItemsList(itemForList));
    dispatch(setActiveItem(item));
    dispatch(resetCreateItem());
    setJustAdded(true);

    setTimeout(() => setJustAdded(false), 2000);
  };

  const fetchBulkImportRows = useCallback(
    async (rows: ExtractedBibleReference[]) => {
      const resolvedRows: ExtractedBibleReference[] = [];

      for (const row of rows) {
        if (row.status === "duplicate") {
          resolvedRows.push(row);
          continue;
        }

        try {
          const chapterVerses = await loadBibleChapterVerses({
            book: row.book,
            chapter: row.chapter,
            version: row.version,
            bibleDb,
          });
          const selectedVerses = selectBibleVersesFromRange(
            chapterVerses,
            row.verseRange
          );

          if (!selectedVerses.length) {
            resolvedRows.push({
              ...row,
              status: "not_found",
              statusMessage: "Could not find these verses.",
            });
            continue;
          }

          resolvedRows.push({
            ...row,
            status: "ready",
            textPreview: selectedVerses
              .map((verse) => verse.text || "")
              .filter(Boolean)
              .join(" ")
              .slice(0, 240),
          });
        } catch {
          resolvedRows.push({
            ...row,
            status: "error",
            statusMessage: "Could not load this passage.",
          });
        }
      }

      return resolvedRows;
    },
    [bibleDb]
  );

  const handleBulkImport = async () => {
    const trimmed = bulkImportText.trim();
    if (!trimmed || isOfflineGuest) return;

    setIsBulkImporting(true);
    try {
      const extractedRows = extractBibleReferencesFromText(trimmed, version);
      const rows = await fetchBulkImportRows(extractedRows);
      const id = generateRandomId();
      const review: BulkBibleImportReview = {
        id,
        createdAt: new Date().toISOString(),
        inputVersion: version,
        rows,
      };

      window.sessionStorage.setItem(
        getBulkBibleImportStorageKey(id),
        JSON.stringify(review)
      );
      window.sessionStorage.setItem(BULK_BIBLE_IMPORT_ACTIVE_ID_KEY, id);
      setBulkReview(review);
      setSelectedBulkRowIds(
        new Set(
          rows.filter((row) => row.status === "ready").map((row) => row.id)
        )
      );
      setAddedBulkRowIds(new Set());
      setBulkRowMessages({});
      setBulkImportOpen(false);
      navigate(`/controller/bible?bulkImport=review&id=${encodeURIComponent(id)}`);
    } finally {
      setIsBulkImporting(false);
    }
  };

  const handleBackFromBulkReview = () => {
    clearActiveBulkBibleImport();
    navigate("/controller/bible");
  };

  const toggleBulkRowSelection = (rowId: string) => {
    setSelectedBulkRowIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  const addBulkRowToOutline = async (row: ExtractedBibleReference) => {
    const item = await createBibleItemFromParsedReference({
      parsedRef: {
        book: row.book,
        chapter: row.chapter,
        verseRange: row.verseRange,
        version: row.version,
      },
      db,
      bibleDb,
      allItems: list,
      background: defaultBibleBackground.background,
      mediaInfo: defaultBibleBackground.mediaInfo,
      brightness: defaultBibleBackgroundBrightness,
      fontMode: defaultBibleFontMode,
      defaultVersion: version,
    });

    const itemForList = {
      _id: item._id,
      name: item.name,
      type: "bible",
      background: item.background,
      listId: generateRandomId(),
    };

    dispatch(addItemToItemList(itemForList));
    dispatch(addItemToAllItemsList(itemForList));
    dispatch(setActiveItem(item));
  };

  const handleAddSelectedBulkRows = async () => {
    if (!bulkReview || isAddingBulkRows) return;

    const rowsToAdd = bulkReview.rows.filter(
      (row) =>
        row.status === "ready" &&
        selectedBulkRowIds.has(row.id) &&
        !addedBulkRowIds.has(row.id)
    );
    if (!rowsToAdd.length) return;

    setIsAddingBulkRows(true);
    try {
      for (const row of rowsToAdd) {
        try {
          await addBulkRowToOutline(row);
          setAddedBulkRowIds((current) => new Set(current).add(row.id));
          setBulkRowMessages((current) => ({
            ...current,
            [row.id]: "Added.",
          }));
        } catch {
          setBulkRowMessages((current) => ({
            ...current,
            [row.id]: "Could not add this passage.",
          }));
        }
      }
    } finally {
      dispatch(resetCreateItem());
      setIsAddingBulkRows(false);
      clearActiveBulkBibleImport();
      navigate("/controller/bible");
    }
  };

  const sendVerse = async (verse: verseType) => {
    const verseToUse = verse;

    const bookName = books[book]?.name || "";
    const chapterName = chapters[chapter]?.name || "";
    const sendItemName = `${bookName} ${chapterName}:${verseToUse.name
      } ${version.toUpperCase()}`;
    const _item = createItemFromProps({
      name: sendItemName,
      type: "bible",
    });
    const item = formatBible({
      item: _item,
      mode: "fit",
      isNew: true,
      book: books[book].name,
      chapter: chapters[chapter].name,
      version,
      verses: [verseToUse],
      background: defaultBibleBackground.background,
      mediaInfo: defaultBibleBackground.mediaInfo,
      brightness: defaultBibleBackgroundBrightness,
    });

    const slides = item.slides || [];
    const title = slides[1]?.boxes[2]?.words || "";
    const text = slides[1].boxes[1]?.words || "";

    dispatch(
      updateBibleDisplayInfo({
        title,
        text,
      })
    );
    dispatch(
      updatePresentation({
        slide: slides[1],
        type: "bible",
        name: createItemName || bibleItemName,
      })
    );
  };

  useEffect(() => {
    if (books[book]?.chapters) {
      dispatch(setChapters(books[book].chapters));
    }
  }, [book, books, dispatch]);

  const handleSearch = useCallback((val: string) => {
    dispatch(setSearch(val));
    if (!val) {
      dispatch(setSearchValue({ type: "book", value: "" }));
      dispatch(setSearchValue({ type: "chapter", value: "" }));
      dispatch(setSearchValue({ type: "startVerse", value: "" }));
      dispatch(setSearchValue({ type: "endVerse", value: "" }));
      return;
    }

    // Matches:
    // "Genesis"
    // "John 3"
    // "Gen 3:16"
    // "Gen 3 16"
    // "Gen 3:16-20"
    // "Gen 3:16 20"
    // "1 John 2 3-5"
    // "Psalm 78 40-64 NKJV"
    const parsedReference = parseBibleSearchReference(val);
    if (!parsedReference) return;

    const {
      book: bookStr,
      chapter: chapterStr,
      startVerse: verseStartStr,
      endVerse: verseEndStr,
      version: parsedVersion,
    } = parsedReference;

    dispatch(setSearchValue({ type: "book", value: bookStr || "" }));
    dispatch(setSearchValue({ type: "chapter", value: chapterStr || "" }));
    if (parsedVersion) {
      dispatch(setVersion(parsedVersion));
    }
    if (chapterStr) {
      dispatch(setSearchValue({ type: "chapter", value: chapterStr }));
      dispatch(setChapter(parseInt(chapterStr)));
    }
    if (verseStartStr) {
      dispatch(setSearchValue({ type: "startVerse", value: verseStartStr }));
      dispatch(setStartVerse(parseInt(verseStartStr)));
    }
    if (verseEndStr) {
      dispatch(setSearchValue({ type: "endVerse", value: verseEndStr }));
      dispatch(setEndVerse(parseInt(verseEndStr)));
    }
  }, [dispatch]);

  useEffect(() => {
    if (hasNavigatedFromUrl.current || !books.length) return;

    const searchParam = searchParams.get("search");
    const bookParam = searchParams.get("book");
    const chapterParam = searchParams.get("chapter");
    const versionParam = searchParams.get("version");
    const versesParam = searchParams.get("verses");

    if (searchParam) {
      hasNavigatedFromUrl.current = true;
      if (versionParam) {
        dispatch(setVersion(versionParam.toLowerCase()));
      }
      handleSearch(searchParam);
      return;
    }

    if (bookParam && chapterParam) {
      hasNavigatedFromUrl.current = true;
      dispatch(
        openBibleAtLocation({
          book: bookParam,
          chapter: chapterParam,
          version: versionParam ?? version,
          verseRange: versesParam?.trim() ? versesParam : undefined,
        })
      );
    }
  }, [books, dispatch, handleSearch, searchParams, version]);

  const versesDisplaySection = books && chapters && verses && (
    <div
      className="flex-1 flex flex-col gap-4 items-center mt-2 pb-2 relative min-h-0"
      data-has-title={!!createItemName}
    >
      {createItemName && (
        <div className="flex gap-2 items-center text-lg">
          <p className="font-semibold">Name:</p>
          <h4>{createItemName}</h4>
        </div>
      )}
      <h3 className="text-xl font-semibold">{bibleItemName}</h3>
      <BibleVersesList
        isLoading={isLoadingChapter}
        verses={verses}
        startVerse={startVerse}
        endVerse={endVerse}
        sendVerse={sendVerse}
        canTransmit={
          isMonitorTransmitting ||
          isProjectorTransmitting ||
          isStreamTransmitting
        }
      />
      {canAddBibleToOutline && (
        <Button
          variant="cta"
          padding="px-4 py-1"
          className="ml-auto mt-auto mb-2"
          onClick={submitVerses}
          isLoading={isLoadingChapter}
          disabled={
            isLoadingChapter || justAdded || !hasRenderableVerses
          }
          color={justAdded ? "#67e8f9" : undefined}
          svg={justAdded ? Check : Plus}
        >
          {justAdded ? "Added." : "Add to outline"}
        </Button>
      )}
    </div>
  );

  const readyBulkRows =
    bulkReview?.rows.filter((row) => row.status === "ready") || [];
  const selectedReadyBulkRows = readyBulkRows.filter(
    (row) => selectedBulkRowIds.has(row.id) && !addedBulkRowIds.has(row.id)
  );

  const bulkReviewSection = (
    <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-hidden pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-700 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            svg={ArrowLeft}
            padding="px-3 py-1"
            onClick={handleBackFromBulkReview}
          >
            Back
          </Button>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-white">
              Bible import review
            </h3>
            <p className="text-sm text-gray-400">
              {bulkReview?.rows.length || 0} passage
              {bulkReview?.rows.length === 1 ? "" : "s"} found
            </p>
          </div>
        </div>
        {canAddBibleToOutline && (
          <Button
            type="button"
            variant="cta"
            svg={Check}
            isLoading={isAddingBulkRows}
            disabled={isAddingBulkRows || selectedReadyBulkRows.length === 0}
            onClick={() => void handleAddSelectedBulkRows()}
          >
            Add selected
          </Button>
        )}
      </div>

      {!bulkReview ? (
        <div className="rounded-lg border border-yellow-400/40 bg-yellow-500/10 p-3 text-sm text-yellow-50">
          Import review data is no longer available. Paste the list again to
          rebuild it.
        </div>
      ) : bulkReview.rows.length === 0 ? (
        <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-4 text-sm text-gray-300">
          No Bible references were recognized.
        </div>
      ) : (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900/40">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-700 px-3 py-3">
            <div>
              <h4 className="text-sm font-semibold text-white">
                Found passages
              </h4>
              <p className="mt-1 text-xs text-gray-400">
                Review the parsed references before adding them to the outline.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-green-900/40 px-2 py-1 text-green-300">
                {readyBulkRows.length} ready
              </span>
              <span className="rounded-full bg-gray-800 px-2 py-1 text-gray-300">
                {bulkReview.rows.length - readyBulkRows.length} needs review
              </span>
            </div>
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-gray-800 overflow-y-auto">
            {bulkReview.rows.map((row) => {
              const isReady = row.status === "ready";
              const isAdded = addedBulkRowIds.has(row.id);
              const statusLabel = isAdded
                ? "Added"
                : row.status === "ready"
                  ? "Ready"
                  : row.status === "duplicate"
                    ? "Duplicate"
                    : row.status === "not_found"
                      ? "Not found"
                      : "Error";
              const statusTone = isAdded
                ? "bg-cyan-900/40 text-cyan-300"
                : row.status === "ready"
                  ? "bg-green-900/40 text-green-300"
                  : row.status === "duplicate"
                    ? "bg-gray-800 text-gray-300"
                    : "bg-red-900/30 text-red-300";

              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-start gap-3 px-3 py-3"
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.book} ${row.chapter}:${row.verseRange}`}
                    className="mt-1 h-4 w-4 shrink-0 accent-cyan-400"
                    checked={selectedBulkRowIds.has(row.id)}
                    disabled={!isReady || isAdded || isAddingBulkRows}
                    onChange={() => toggleBulkRowSelection(row.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-white">
                        {row.book} {row.chapter}:{row.verseRange}{" "}
                        {row.version.toUpperCase()}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          statusTone
                        )}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    {row.note ? (
                      <p className="mt-1 text-xs text-gray-400">{row.note}</p>
                    ) : null}
                    {row.textPreview ? (
                      <p className="mt-2 line-clamp-2 text-sm text-gray-300">
                        {row.textPreview}
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-gray-500">
                        {row.statusMessage || "No preview available."}
                      </p>
                    )}
                    {bulkRowMessages[row.id] ? (
                      <p className="mt-1 text-xs text-cyan-300">
                        {bulkRowMessages[row.id]}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );

  return (
    <ErrorBoundary>
      {bibleDbProgress !== 100 && (
        <div
          data-testid="loading-overlay"
          className="absolute top-0 left-0 z-5 w-full h-full bg-homepage-canvas/90 flex justify-center items-center flex-col text-white text-2xl gap-8"
        >
          <p>
            Setting up <span className="font-bold">Bible</span>
          </p>
          <Spinner />
          {bibleDbProgress !== 0 && (
            <p>
              Progress:{" "}
              <span className="text-orange-500">{bibleDbProgress}%</span>
            </p>
          )}
        </div>
      )}
      <div className="text-base px-2 pt-2 h-full flex flex-col gap-2">
        {isOfflineGuest && (
          <div className="rounded-lg border border-yellow-400/40 bg-yellow-500/10 p-3 text-sm text-yellow-50">
            <p className="font-semibold">
              Bible lookup is not available in the offline demo.
            </p>
            <p className="mt-1 text-yellow-100/90">
              Use songs, custom items, and timers to explore the controller.
            </p>
          </div>
        )}
        <div className="flex gap-4 items-end flex-wrap">
          <Select
            value={version}
            onChange={(val) => dispatch(setVersion(val))}
            label="Version"
            className="max-lg:w-full flex justify-center"
            hideLabel
            options={bibleVersions}
          />
          <Input
            svg={search ? X : undefined}
            svgAction={() => handleSearch("")}
            svgActionAriaLabel="Clear search"
            value={search}
            onChange={(val) => handleSearch(val as string)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLElement).blur();
              }
            }}
            label="Search"
            className="max-lg:w-full flex justify-center gap-2 items-center"
            placeholder="Gen 3:15"
            svgPadding="max-lg:p-1 lg:p-0"
          />
          <Popover open={bulkImportOpen} onOpenChange={setBulkImportOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                svg={FileInput}
                disabled={isOfflineGuest}
              >
                Import
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[min(28rem,calc(100vw-2rem))] border-gray-700 bg-gray-900 text-white"
            >
              <div className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Import Bible texts</h3>
                  <p className="mt-1 text-xs text-gray-400">
                    Paste a list of references to review before adding.
                  </p>
                </div>
                <TextArea
                  label="Bible references"
                  hideLabel
                  value={bulkImportText}
                  onChange={setBulkImportText}
                  placeholder="John 14:16-18&#10;Acts 1:4-8&#10;All NKJV"
                  className="min-h-40"
                  textareaClassName="min-h-40 rounded-md border border-gray-700 bg-gray-950 p-2 text-sm text-white placeholder:text-gray-500"
                />
                <Button
                  type="button"
                  variant="cta"
                  svg={FileInput}
                  isLoading={isBulkImporting}
                  disabled={isBulkImporting || !bulkImportText.trim()}
                  onClick={() => void handleBulkImport()}
                >
                  Import multiple
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <ButtonGroup className="w-full lg:hidden my-4">
            <ButtonGroupItem
              onClick={() => setShowVersesDisplaySection(false)}
              isActive={!showVersesDisplaySection}
            >
              Verse Selector
            </ButtonGroupItem>
            <ButtonGroupItem
              onClick={() => setShowVersesDisplaySection(true)}
              isActive={showVersesDisplaySection}
            >
              Selected Verses
            </ButtonGroupItem>
          </ButtonGroup>
        </div>
        {!books.length && (
          <div className="text-2xl w-full text-center semi-bold mt-10">
            Loading Bibles...
          </div>
        )}

        {isBulkReviewMode ? (
          bulkReviewSection
        ) : (
          <>
        {isMobile && showVersesDisplaySection && versesDisplaySection}
        {!!books.length && (
          <div
            className={cn(
              "flex flex-1 w-full gap-2 max-lg:justify-center min-h-0",
              isMobile && showVersesDisplaySection && "hidden"
            )}
          >
            <BibleSection
              initialList={books as bookType[]}
              setValue={(val) => dispatch(setBook(val))}
              searchValue={searchValues.book}
              value={book}
              type="book"
            />
            <BibleSection
              initialList={chapters as chapterType[]}
              setValue={(val) => dispatch(setChapter(val))}
              searchValue={searchValues.chapter}
              value={chapter}
              type="chapter"
            />
            <BibleSection
              initialList={verses as verseType[]}
              setValue={(val) => dispatch(setStartVerse(val))}
              searchValue={searchValues.startVerse}
              value={startVerse}
              type="verse"
              label="Start"
            />
            <BibleSection
              initialList={verses as verseType[]}
              setValue={(val) => dispatch(setEndVerse(val))}
              searchValue={searchValues.endVerse}
              value={endVerse}
              type="verse"
              min={startVerse}
              label="End"
            />
            {!isMobile && versesDisplaySection}
          </div>
        )}
          </>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default Bible;
