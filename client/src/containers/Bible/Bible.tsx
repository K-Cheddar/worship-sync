import { useRef, useContext, useEffect, useMemo, useState } from "react";
import Select from "../../components/Select/Select";
import "./Bible.scss";
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
} from "../../store/bibleSlice";
import { bibleVersions } from "../../utils/bibleVersions";
import { getVerses as getVersesApi } from "../../api/getVerses";
import BibleVersesList from "./BibleVersesList";
import { useSearchParams } from "react-router-dom";
import { formatBible } from "../../utils/overflow";
import { setActiveItem } from "../../store/itemSlice";
import { addItemToItemList } from "../../store/itemListSlice";
import { ReactComponent as CheckSVG } from "../../assets/icons/check.svg";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import { ReactComponent as CloseSVG } from "../../assets/icons/close.svg";
import {
  updateBibleDisplayInfo,
  updatePresentation,
} from "../../store/presentationSlice";
import { createItemFromProps, createNewBible } from "../../utils/itemUtil";
import generateRandomId from "../../utils/generateRandomId";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { addItemToAllItemsList } from "../../store/allItemsSlice";
import { setCreateItem } from "../../store/createItemSlice";
import { RootState } from "../../store/store";
import useDebouncedEffect from "../../hooks/useDebouncedEffect";
import Spinner from "../../components/Spinner/Spinner";
import ErrorBoundary from "../../components/ErrorBoundary/ErrorBoundary";
import Input from "../../components/Input/Input";
import cn from "classnames";

const Bible = () => {
  const dispatch = useDispatch();
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
  const [isLoadingChapter, setIsLoadingChapter] = useState(false);
  const [fetchedChapters, setFetchedChapters] = useState<Set<string>>(
    new Set()
  );

  const createItemName = decodeURI(searchParams.get("name") || "");

  const {
    db,
    bibleDb,
    bibleDbProgress,
    isMobile = false,
  } = useContext(ControllerInfoContext) || {};

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

  useDebouncedEffect(
    () => {
      const getChapter = async () => {
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
            setIsLoadingChapter(true);

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
          if (!searchValues.endVerse) {
            dispatch(setEndVerse(newVerses.length - 1) || 0);
          }

          if (!searchValues.startVerse) {
            dispatch(setStartVerse(0));
          }
          setIsLoadingChapter(false);
        }
      };
      getChapter();
    },
    [chapter, dispatch, bibleDb, version, books, book],
    500,
    true
  );

  const versionOptions = bibleVersions.map(({ value, label }) => {
    return { value, label };
  });

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
      background: defaultBibleBackground,
      brightness: defaultBibleBackgroundBrightness,
      isMobile,
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
    dispatch(setCreateItem({ name: "", type: "", text: "" }));
    setJustAdded(true);

    setTimeout(() => setJustAdded(false), 2000);
  };

  const sendVerse = async (verse: verseType) => {
    const verseToUse = verse;

    const bookName = books[book]?.name || "";
    const chapterName = chapters[chapter]?.name || "";
    const sendItemName = `${bookName} ${chapterName}:${
      verseToUse.name
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
      background: defaultBibleBackground,
      brightness: defaultBibleBackgroundBrightness,
      isMobile,
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

  const handleSearch = (val: string) => {
    dispatch(setSearch(val));
    if (!val) {
      dispatch(setSearchValue({ type: "book", value: "" }));
      dispatch(setSearchValue({ type: "chapter", value: "" }));
      dispatch(setSearchValue({ type: "startVerse", value: "" }));
      dispatch(setSearchValue({ type: "endVerse", value: "" }));
      return;
    }

    const normalized = val.trim().replace(/[–—]/g, "-");

    // Matches:
    // "Genesis"
    // "John 3"
    // "Gen 3:16"
    // "Gen 3 16"
    // "Gen 3:16-20"
    // "Gen 3:16 20"
    // "1 John 2 3-5"
    const pattern = new RegExp(
      [
        "^\\s*",
        "([1-3]?\\s*[A-Za-z]+(?:\\s+[A-Za-z]+)*)", // book (with optional leading number & multiple words)

        // Optional chapter
        "(?:\\s*(\\d+)",

        // Optional verseStart: either ":" + spaces OR just spaces
        "(?:(?::\\s*|\\s+)(\\d+)",

        // Optional verseEnd: either "-" + spaces OR just spaces
        "(?:(?:-\\s*|\\s+)(\\d+))?",
        ")?",

        ")?\\s*$",
      ].join("")
    );
    const match = normalized.match(pattern);
    if (!match) return;

    const [, bookStr, chapterStr, verseStartStr, verseEndStr] = match;

    dispatch(setSearchValue({ type: "book", value: bookStr || "" }));
    dispatch(setSearchValue({ type: "chapter", value: chapterStr || "" }));
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
  };

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
      <Button
        variant="cta"
        padding="px-4 py-1"
        className="ml-auto mt-auto mb-2"
        onClick={submitVerses}
        isLoading={isLoadingChapter}
        disabled={isLoadingChapter}
        color={justAdded ? "#67e8f9" : undefined}
        svg={justAdded ? CheckSVG : AddSVG}
      >
        {justAdded ? "Added!" : "Add to outline"}
      </Button>
    </div>
  );

  return (
    <ErrorBoundary>
      {bibleDbProgress !== 100 && (
        <div
          data-testid="loading-overlay"
          className="absolute top-0 left-0 z-[5] bg-gray-800/85 w-full h-full flex justify-center items-center flex-col text-white text-2xl gap-8"
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
        <div className="flex gap-4 items-end flex-wrap">
          <Select
            value={version}
            onChange={(val) => dispatch(setVersion(val))}
            label="Version"
            className="max-lg:w-full flex justify-center"
            hideLabel
            options={versionOptions}
          />
          <Input
            svg={search ? CloseSVG : undefined}
            svgAction={() => handleSearch("")}
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
      </div>
    </ErrorBoundary>
  );
};

export default Bible;
