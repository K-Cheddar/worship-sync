import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import { bookType, chapterType, verseType } from "../types";
import { bibleStructure } from "../utils/bibleStructure";
import type { RootState } from "./store";

export type OpenBibleAtLocationPayload = {
  book: string;
  chapter: string;
  version: string;
};

type BibleState = {
  version: string;
  books: bookType[];
  book: number;
  chapters: chapterType[];
  chapter: number;
  verses: verseType[];
  startVerse: number;
  endVerse: number;
  isLoadingChapter: boolean;
  searchValues: {
    book: string;
    chapter: string;
    startVerse: string;
    endVerse: string;
  };
  search: string;
};

const initialState: BibleState = {
  version: "nkjv",
  books: bibleStructure.books,
  book: 0,
  chapters: bibleStructure.books[0].chapters,
  chapter: 0,
  verses: bibleStructure.books[0].chapters[0].verses,
  startVerse: 0,
  endVerse: 0,
  isLoadingChapter: false,
  searchValues: { book: "", chapter: "", startVerse: "", endVerse: "" },
  search: "",
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
    setStartVerse: (state, action: PayloadAction<number>) => {
      state.startVerse = action.payload;
    },
    setEndVerse: (state, action: PayloadAction<number>) => {
      state.endVerse = action.payload;
    },
    setLoadingChapter: (state, action: PayloadAction<boolean>) => {
      state.isLoadingChapter = action.payload;
    },
    setSearch: (state, action: PayloadAction<string>) => {
      state.search = action.payload;
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

        if (action.payload.value > state.searchValues.endVerse) {
          state.searchValues.endVerse = "";
        }
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
  setLoadingChapter,
  setSearchValue,
  setSearch,
} = bibleSlice.actions;

export const openBibleAtLocation = createAsyncThunk<
  void,
  OpenBibleAtLocationPayload,
  { state: RootState }
>(
  "bible/openBibleAtLocation",
  (payload, { getState, dispatch }) => {
    const { book: bookName, chapter: chapterName, version: versionVal } =
      payload;
    const { books } = getState().bible;
    const bookIndex = books.findIndex((b) => b.name === bookName);
    if (bookIndex === -1) return;
    const bookChapters = books[bookIndex]?.chapters;
    const chapterIndex =
      bookChapters?.findIndex((c) => c.name === chapterName) ?? -1;
    if (chapterIndex === -1) return;
    dispatch(bibleSlice.actions.setLoadingChapter(true));
    dispatch(bibleSlice.actions.setBook(bookIndex));
    dispatch(bibleSlice.actions.setChapters(bookChapters || []));
    dispatch(bibleSlice.actions.setChapter(chapterIndex));
    dispatch(bibleSlice.actions.setVersion(versionVal));
  },
);

export default bibleSlice.reducer;
