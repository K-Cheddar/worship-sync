import {
  CSSProperties,
  useRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import Select from "../../components/Select/Select";
import "./Bible.scss";
import BibleSection from "./BibleSection";
import { bibleType, bookType, chapterType, verseType } from "../../types";
import Button from "../../components/Button/Button";
import { useDispatch, useSelector } from "../../hooks";
import {
  setBook,
  setBooks,
  setChapter,
  setChapters,
  setEndVerse,
  setStartVerse,
  setVerses,
  setVersion,
  setSearchValue,
} from "../../store/bibleSlice";
import { bibleVersions, internalBibleVersions } from "../../utils/getBibles";
import { getVerses as getVersesApi } from "../../api/getVerses";
import { bibleStructure } from "../../utils/bibleStructure";
import BibleVersesList from "./BibleVersesList";
import { useSearchParams } from "react-router-dom";
import { formatBible } from "../../utils/overflow";
import { setActiveItem } from "../../store/itemSlice";
import { addItemToItemList } from "../../store/itemListSlice";
import { ReactComponent as CheckSVG } from "../../assets/icons/check.svg";
import { ReactComponent as AddSVG } from "../../assets/icons/add.svg";
import { ReactComponent as DownloadSVG } from "../../assets/icons/download.svg";
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

const Bible = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [bibleType, setBibleType] = useState<"internal" | "external">(
    "internal"
  );
  const [hasExternalVerses, setHasExternalVerses] = useState(false);
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

  const [versionSelectorHeight, setVersionSelectorHeight] = useState(0);
  const [justAdded, setJustAdded] = useState(false);
  const [justGotChapter, setJustGotChapter] = useState(false);
  const [isLoadingChapter, setIsLoadingChapter] = useState(false);

  const createItemName = decodeURI(searchParams.get("name") || "");

  const { db, bibleDb, isMobile } = useContext(ControllerInfoContext) || {};

  const bibleItemName = useMemo(() => {
    const bookName = books[book]?.name || "";
    const chapterName = chapters[chapter]?.name || "";
    const startVerseName = verses[startVerse]?.name || "";
    const endVerseName = verses[endVerse]?.name || "";

    const verseName =
      startVerse === endVerse
        ? startVerseName
        : `${startVerseName} - ${endVerseName}`;

    return `${bookName} ${chapterName}:${verseName} ${version.toUpperCase()}`;
  }, [books, book, chapters, chapter, verses, endVerse, startVerse, version]);

  useEffect(() => {
    const getBibles = async () => {
      if (internalBibleVersions.some((el) => el.value === version)) {
        setIsLoading(true);
        setBibleType("internal");
        let bible: bibleType | undefined;
        try {
          bible = await bibleDb?.get(version);
        } catch (error) {
          console.error(error);
        }

        setIsLoading(false);

        if (!bible) return;

        dispatch(setBooks(bible.books));
        dispatch(
          setChapters(bible.books[book]?.chapters || bible.books[0]?.chapters)
        );
        dispatch(
          setVerses(
            bible.books[book]?.chapters[chapter]?.verses ||
              bible.books[0]?.chapters[0]?.verses
          )
        );
      } else {
        setBibleType("external");
        setHasExternalVerses(false);
        dispatch(setBooks(bibleStructure.books));
        dispatch(setChapters(bibleStructure.books[book].chapters));
        dispatch(
          setVerses(bibleStructure.books[book].chapters[chapter].verses)
        );
      }
      setJustGotChapter(false);
    };
    getBibles();
    // we only want this to update on version change, not book or chapter change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bibleDb, version]);

  const getVersesFromGateway = async () => {
    setIsLoadingChapter(true);
    try {
      setIsLoading(true);
      const data = await getVersesApi({
        book: books[book].name,
        chapter,
        version,
      });
      const dataHasVerses = !!data?.verses?.length;
      setIsLoading(false);
      setHasExternalVerses(dataHasVerses);
      if (dataHasVerses) {
        dispatch(setVerses(data.verses));
        setJustGotChapter(true);
        setShowVersesDisplaySection(true);
      }
    } catch (error) {
      setIsLoading(false);
      console.error(error);
    }
    setIsLoadingChapter(false);
  };

  useEffect(() => {
    if (chapters) {
      dispatch(
        setVerses(chapters[chapter]?.verses || chapters[0]?.verses || [])
      );
      setHasExternalVerses(false);
      setJustGotChapter(false);
    }
  }, [chapter, chapters, dispatch]);

  useEffect(() => {
    if (chapters?.[chapter]) {
      if (!searchValues.endVerse) {
        dispatch(setEndVerse(chapters[chapter]?.verses?.length - 1 || 0));
      }
    }
  }, [chapter, chapters, dispatch, searchValues.endVerse]);

  useEffect(() => {
    if (chapters?.[chapter]) {
      if (!searchValues.startVerse) {
        dispatch(setStartVerse(0));
      }
    }
  }, [chapter, chapters, dispatch, searchValues.startVerse]);

  useEffect(() => {
    if (books) {
      dispatch(setChapters(books[book]?.chapters || books[0]?.chapters || []));
    }
  }, [book, books, isLoading, dispatch]);

  const versionOptions = bibleVersions.map(({ value, label }) => {
    return { value, label };
  });

  const submitVerses = async () => {
    const item = await createNewBible({
      fontMode: defaultBibleFontMode,
      name: createItemName || bibleItemName,
      book: books[book].name,
      chapter: chapters[chapter].name,
      version,
      verses: verses.filter(
        ({ index }) => index >= startVerse && index <= endVerse
      ),
      db,
      list,
      background: defaultBibleBackground,
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
    dispatch(setCreateItem({ name: "", type: "", text: "" }));
    setJustAdded(true);

    setTimeout(() => setJustAdded(false), 2000);
  };

  const sendVerse = (verse: verseType) => {
    const bookName = books[book]?.name || "";
    const chapterName = chapters[chapter]?.name || "";
    const sendItemName = `${bookName} ${chapterName}:${
      verse.name
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
      verses: [verse],
      background: defaultBibleBackground,
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

  const versionSelectorRef = useCallback((node: HTMLDivElement) => {
    if (node) {
      const resizeObserver = new ResizeObserver((entries) => {
        setVersionSelectorHeight(entries[0].borderBoxSize[0].blockSize);
      });

      resizeObserver.observe(node);
    }
  }, []);

  const versesDisplaySection = books && chapters && verses && (
    <div
      className="bible-verses-display-section"
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
        isLoading={isLoading}
        bibleType={bibleType}
        hasExternalVerses={hasExternalVerses}
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
        disabled={(bibleType === "external" && !hasExternalVerses) || justAdded}
        color={justAdded ? "#67e8f9" : undefined}
        svg={justAdded ? CheckSVG : AddSVG}
      >
        {justAdded ? "Added!" : "Add to outline"}
      </Button>
    </div>
  );

  return (
    <div
      className="text-base px-2 py-4 h-full flex flex-col gap-2"
      style={
        {
          "--bible-version-selector-height": `${versionSelectorHeight}px`,
        } as CSSProperties
      }
    >
      <div ref={versionSelectorRef} className="flex gap-4 items-end flex-wrap">
        <Select
          value={version}
          onChange={(val) => dispatch(setVersion(val))}
          label="Version"
          className="max-lg:w-full flex justify-center"
          hideLabel
          options={versionOptions}
        />
        <Button
          className="lg:h-fit max-lg:flex-1 max-lg:justify-center"
          onClick={getVersesFromGateway}
          isLoading={isLoadingChapter}
          disabled={isLoadingChapter || justGotChapter}
          color={justGotChapter ? "#84cc16" : "#22d3ee"}
          svg={justGotChapter ? CheckSVG : DownloadSVG}
        >
          {justGotChapter
            ? "Got chapter from Bible Gateway!"
            : "Get chapter from Bible Gateway"}
        </Button>
        <div className="flex w-full lg:hidden border border-gray-400 my-4 rounded-l-md rounded-r-md">
          <Button
            onClick={() => setShowVersesDisplaySection(false)}
            className="justify-center rounded-r-none flex-1"
            variant={!showVersesDisplaySection ? "secondary" : "tertiary"}
          >
            Verse Selector
          </Button>
          <Button
            onClick={() => setShowVersesDisplaySection(true)}
            className="justify-center rounded-l-none flex-1"
            variant={showVersesDisplaySection ? "secondary" : "tertiary"}
          >
            Selected Verses
          </Button>
        </div>
      </div>
      {!books.length && (
        <div className="text-2xl w-full text-center semi-bold mt-10">
          Loading Bibles...
        </div>
      )}

      {isMobile && showVersesDisplaySection && versesDisplaySection}
      {((isMobile && !showVersesDisplaySection) || !isMobile) &&
        !!books.length && (
          <div className="bible-section-container">
            <BibleSection
              initialList={books as bookType[]}
              setValue={(val) => dispatch(setBook(val))}
              searchValue={searchValues.book}
              setSearchValue={(val) =>
                dispatch(setSearchValue({ type: "book", value: val }))
              }
              value={book}
              type="book"
            />
            <BibleSection
              initialList={chapters as chapterType[]}
              setValue={(val) => dispatch(setChapter(val))}
              searchValue={searchValues.chapter}
              setSearchValue={(val) =>
                dispatch(setSearchValue({ type: "chapter", value: val }))
              }
              value={chapter}
              type="chapter"
            />
            <BibleSection
              initialList={verses as verseType[]}
              setValue={(val) => dispatch(setStartVerse(val))}
              searchValue={searchValues.startVerse}
              setSearchValue={(val) =>
                dispatch(setSearchValue({ type: "startVerse", value: val }))
              }
              value={startVerse}
              type="verse"
              label="Start"
            />
            <BibleSection
              initialList={verses as verseType[]}
              setValue={(val) => dispatch(setEndVerse(val))}
              searchValue={searchValues.endVerse}
              setSearchValue={(val) =>
                dispatch(setSearchValue({ type: "endVerse", value: val }))
              }
              value={endVerse}
              type="verse"
              min={startVerse}
              label="End"
            />
            {!isMobile && versesDisplaySection}
          </div>
        )}
    </div>
  );
};

export default Bible;
