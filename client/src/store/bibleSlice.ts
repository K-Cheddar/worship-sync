import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { bookType, chapterType, verseType } from "../types";

type BibleState = {
  version: string;
  books: bookType[];
  book: number;
  chapters: chapterType[];
  chapter: number;
  verses: verseType[];
  startVerse: number;
  endVerse: number;
  retrievedVerses: string[];
  searchValues: {
    book: string;
    chapter: string;
    startVerse: string;
    endVerse: string;
  };
};

const initialState: BibleState = {
  version: "nkjv",
  books: [],
  book: 0,
  chapters: [],
  chapter: 0,
  verses: [],
  startVerse: 0,
  endVerse: 0,
  retrievedVerses: [],
  searchValues: { book: "", chapter: "", startVerse: "", endVerse: "" },
};

export const bibleSlice = createSlice({
  name: "bible",
  initialState,
  reducers: {
    setVersion: (state, action: PayloadAction<string>) => {
      state.version = action.payload;
    },
    setBooks: (state, action: PayloadAction<bookType[]>) => {
      state.books = action.payload;
    },
    setBook: (state, action: PayloadAction<number>) => {
      state.book = action.payload;
    },
    setChapters: (state, action: PayloadAction<chapterType[]>) => {
      state.chapters = action.payload;
    },
    setChapter: (state, action: PayloadAction<number>) => {
      state.chapter = action.payload;
    },
    setVerses: (state, action: PayloadAction<verseType[]>) => {
      state.verses = action.payload;
    },
    setRetrievedVerses: (state, action: PayloadAction<string[]>) => {
      state.retrievedVerses = action.payload;
    },
    setStartVerse: (state, action: PayloadAction<number>) => {
      state.startVerse = action.payload;
    },
    setEndVerse: (state, action: PayloadAction<number>) => {
      state.endVerse = action.payload;
    },
    setSearchValue: (
      state,
      action: PayloadAction<{
        type: "book" | "chapter" | "startVerse" | "endVerse";
        value: string;
      }>
    ) => {
      const { type } = action.payload;
      state.searchValues[type] = action.payload.value;

      if (type === "book") {
        state.searchValues.chapter = "";
        state.searchValues.startVerse = "";
        state.searchValues.endVerse = "";
      }

      if (type === "chapter") {
        state.searchValues.startVerse = "";
        state.searchValues.endVerse = "";
      }

      if (type === "startVerse") {
        state.searchValues.endVerse = "";
      }
    },
  },
});

export const {
  setVersion,
  setBooks,
  setBook,
  setChapters,
  setChapter,
  setVerses,
  setStartVerse,
  setEndVerse,
  setRetrievedVerses,
  setSearchValue,
} = bibleSlice.actions;

export default bibleSlice.reducer;
