import { useContext, useEffect, useState } from "react";
import Select from "../../components/Select/Select";
import { ReactComponent as SendSVG } from "../../assets/icons/send.svg";

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
import { BibleDbContext } from "../../context/bibleDb";
import { getVerses as getVersesApi } from "../../api/getVerses";
import { bibleStructure } from "../../utils/bibleStructure";
import BibleVersesList from "./BibleVersesList";
import { setCreateItem } from "../../store/createItemSlice";
import { useSearchParams } from "react-router-dom";

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
  } = useSelector((state) => state.bible);

  const createItemName = decodeURI(searchParams.get("name") || "");

  const { db } = useContext(BibleDbContext) || {};

  useEffect(() => {
    const getBibles = async () => {
      if (internalBibleVersions.some((el) => el.value === version)) {
        setIsLoading(true);
        setBibleType("internal");
        let bible: bibleType | undefined;
        try {
          bible = await db?.get(version);
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
    };
    getBibles();
    // we only want this to update on version change, not book or chapter change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version]);

  const getVersesFromGateway = async () => {
    try {
      setIsLoading(true);
      const data = await getVersesApi({
        book: books[book].name,
        chapter,
        version,
      });
      setIsLoading(false);
      setHasExternalVerses(!!data);
      dispatch(setVerses(data.verses));
    } catch (error) {
      setIsLoading(false);
      console.error(error);
    }
  };

  useEffect(() => {
    if (chapters) {
      dispatch(
        setVerses(chapters[chapter]?.verses || chapters[0]?.verses || [])
      );
      setHasExternalVerses(false);
    }
  }, [chapter, chapters, dispatch]);

  useEffect(() => {
    if (books) {
      dispatch(setChapters(books[book]?.chapters || books[0]?.chapters || []));
    }
  }, [book, books, isLoading, dispatch]);

  const versionOptions = bibleVersions.map(({ value, label }) => {
    return { value, label };
  });

  const submitVerses = () => {};

  return (
    <div className="text-base px-2 py-4 h-full flex flex-col gap-2">
      <div className="flex gap-2">
        <Select
          value={version}
          onChange={(val) => dispatch(setVersion(val))}
          label="Version"
          options={versionOptions}
        />
        <Button onClick={getVersesFromGateway}>
          Get chapter from Bible Gateway
        </Button>
      </div>
      {!books.length && (
        <div className="text-2xl w-full text-center semi-bold mt-10">
          Loading Bibles...
        </div>
      )}
      {!!books.length && (
        <div className="flex h-full w-full gap-4">
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
          />
          {books && chapters && verses && (
            <div
              className="flex-1 flex flex-col gap-2 items-center h-full mt-4"
              data-has-title={!!createItemName}
            >
              {createItemName && (
                <div className="flex gap-2 items-center text-lg">
                  <p className="font-semibold">Name:</p>
                  <h4>{createItemName}</h4>
                </div>
              )}
              <section className="flex gap-2 items-center w-full">
                <h3 className="text-xl pl-6 font-semibold">
                  {books[book]?.name} {chapters[chapter]?.name}:{" "}
                  {verses[startVerse]?.name} - {verses[endVerse]?.name}{" "}
                  {version.toUpperCase()}
                </h3>
                <Button
                  variant="cta"
                  padding="px-4 py-1"
                  className="h-6 ml-auto"
                  onClick={submitVerses}
                >
                  Create Item
                </Button>
              </section>
              <BibleVersesList
                isLoading={isLoading}
                bibleType={bibleType}
                hasExternalVerses={hasExternalVerses}
                verses={verses}
                startVerse={startVerse}
                endVerse={endVerse}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Bible;