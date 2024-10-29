import { useEffect, useState } from "react";
import Select from "../../components/Select/Select";
import { ReactComponent as SendSVG } from "../../assets/icons/send.svg";

import './Bible.scss';
import BibleSection from "./BibleSection";
import { bibleType, bookType, chapterType, verseType } from "../../types";
import Button from "../../components/Button/Button";
import { useDispatch, useSelector } from "../../hooks";
import { selectBible, setBook, setBooks, setChapter, setChapters, setEndVerse, setStartVerse, setVerses, setVersion } from "../../store/bibleSlice";

const versions = [
  { value: 'amp', label: 'Amplified Bible' },
  { value: 'asv', label: 'American Standard Version' },
  { value: 'bbe', label: 'Basic English Bible' },
  { value: 'esv', label: 'English Standard Version' },
  { value: 'kjv', label: 'King James Version' },
  { value: 'msg', label: 'Message Bible' },
  { value: 'nab', label: 'New American Bible' },
  { value: 'niv', label: 'New International Version' },
  { value: 'nkjv', label: 'New King James Version' },
  { value: 'nlt', label: 'New Living Translation' },
  { value: 'nsb', label: 'New Standard Bible' },
]

const Bible = () => {
  const [isLoading, setIsLoading] = useState(false);
  const dispatch = useDispatch();

  const { version, selectedBible, books, book, chapters, chapter, verses, startVerse, endVerse } = useSelector(state => state.bible);

  useEffect(() => {
    const getBibles = async () => {
      setIsLoading(true);
      const response = await fetch(`http://localhost:3000/bibles/${version}.json`);
      const data : bibleType = await response.json();
      setIsLoading(false);
      dispatch(selectBible(data));
      dispatch(setBooks(data.books));
      dispatch(setChapters(data.books[book]?.chapters || data.books[0]?.chapters));
      dispatch(setVerses(data.books[book]?.chapters[chapter]?.verses || data.books[0]?.chapters[0]?.verses));
    }
    getBibles()
  // we only want this to update on version change, not book or chapter change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  useEffect(() => {
    if (selectedBible && !isLoading) {
      dispatch(setBooks(selectedBible.books))
    }
  }, [selectedBible, isLoading, dispatch])

  useEffect(() => {
    if (books && !isLoading) {
      dispatch(setChapters(books[book]?.chapters || books[0]?.chapters || []))
    }
  }, [book, books, isLoading, dispatch])

  useEffect(() => {
    if (chapters && !isLoading) {
      dispatch(setVerses(chapters[chapter]?.verses || chapters[0]?.verses || []))
    }
  }, [chapter, chapters, isLoading, dispatch])

  const versionOptions = versions.map(({value, label}) => {
    return { value, label };
  });

  return (
    <div className="text-base px-2 py-4 h-full flex flex-col gap-2">
      <Select
        value={version}
        onChange={(val) => dispatch(setVersion(val))}
        label="Version"
        options={versionOptions}
      />
      <div className="flex h-full w-fit gap-4">
        <BibleSection initialList={books as bookType[]} setValue={(val) => dispatch(setBook(val))} value={book} type="book"/>
        <BibleSection initialList={chapters as chapterType[]} setValue={(val) => dispatch(setChapter(val))} value={chapter} type="chapter" />
        <BibleSection initialList={verses as verseType[]} setValue={(val) => dispatch(setStartVerse(val))} value={startVerse} type="verse"/>
        <BibleSection initialList={verses as verseType[]} setValue={(val) => dispatch(setEndVerse(val))} value={endVerse} type="verse" min={startVerse}/>

        {books && chapters && verses && (
        <div className="flex-1 flex flex-col gap-2 items-center h-full">
          <section className="flex gap-2 items-center w-full">
            <h3 className="text-base pl-6 font-semibold">{books[book]?.name} {chapters[chapter]?.name}: {verses[startVerse]?.name} - {verses[endVerse]?.name} {version.toUpperCase()}</h3>
            <Button padding="px-4 py-1" className="h-6 ml-auto">Add Verses</Button>
          </section>
          <ul className="bible-verses-list">
            {verses.filter(({index}) => index >= startVerse && index <= endVerse).map((ele, index) => {
              const bg = index % 2 === 0 ? 'bg-slate-600' : 'bg-slate-800';
              return (
                ele.text.trim() ? (
                  <li key={ele.index} className={`${bg} flex gap-2 px-2`}>
                  <span className="text-lg text-yellow-300">{ele.name}</span>
                  <span className="text-base mr-auto">{ele.text}</span>
                  <Button padding="px-1" variant="tertiary" className="text-sm" svg={SendSVG}>Send</Button>
                </li>
                ) : null
              )
            })}
          </ul>
        </div>
      )}
      </div>

    </div>
  )
  
}

export default Bible;