import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { bibleType, bookType, chapterType, verseType } from '../types';

type BibleState = {
  version: string
  selectedBible: bibleType
  books: bookType[]
  book: number
  chapters: chapterType[]
  chapter: number
  verses: verseType[]
  startVerse: number
  endVerse: number
}

const initialState: BibleState = {
  version: 'nkjv',
  selectedBible: { books: [],},
  books: [],
  book: 0,
  chapters: [],
  chapter: 0,
  verses: [],
  startVerse: 0,
  endVerse: 0
}

export const bibleSlice = createSlice({
  name: 'bible',
  initialState,
  reducers: {
    setVersion: (state, action: PayloadAction<string>) => {
      state.version = action.payload;
    },
    selectBible: (state, action: PayloadAction<bibleType>) => {
      state.selectedBible = action.payload;
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
    setVerses: (state, action : PayloadAction<verseType[]>) => {
      state.verses = action.payload;
    },
    setStartVerse: (state, action: PayloadAction<number>) => {
      state.startVerse = action.payload;
    },
    setEndVerse: (state, action: PayloadAction<number>) => {
      state.endVerse = action.payload;
    }
  }
});

export const { 
  setVersion, 
  selectBible, 
  setBooks, 
  setBook,
  setChapters,
  setChapter,
  setVerses,
  setStartVerse,
  setEndVerse
 } = bibleSlice.actions;

export default bibleSlice.reducer;