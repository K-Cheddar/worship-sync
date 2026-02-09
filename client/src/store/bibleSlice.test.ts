import { configureStore } from "@reduxjs/toolkit";
import bibleReducer, {
  setBook,
  setChapters,
  setChapter,
  setVersion,
  setStartVerse,
  setEndVerse,
  setLoadingChapter,
  setSearchValue,
  openBibleAtLocation,
  type OpenBibleAtLocationPayload,
} from "./bibleSlice";
import { bibleStructure } from "../utils/bibleStructure";

type BibleSliceState = { bible: ReturnType<typeof bibleReducer> };

const createStore = (preloadedState?: Partial<BibleSliceState>) =>
  configureStore({
    reducer: { bible: bibleReducer },
    ...(preloadedState != null &&
      Object.keys(preloadedState).length > 0 && {
        preloadedState: preloadedState as BibleSliceState,
      }),
  });

describe("bibleSlice", () => {
  describe("reducers", () => {
    it("setLoadingChapter updates isLoadingChapter", () => {
      const store = createStore();
      expect(store.getState().bible.isLoadingChapter).toBe(false);
      store.dispatch(setLoadingChapter(true));
      expect(store.getState().bible.isLoadingChapter).toBe(true);
      store.dispatch(setLoadingChapter(false));
      expect(store.getState().bible.isLoadingChapter).toBe(false);
    });

    it("setBook updates book index and setChapters updates chapters", () => {
      const store = createStore();
      const exodus = bibleStructure.books[1];
      expect(store.getState().bible.book).toBe(0);
      store.dispatch(setBook(1));
      expect(store.getState().bible.book).toBe(1);
      store.dispatch(setChapters(exodus.chapters));
      expect(store.getState().bible.chapters).toBe(exodus.chapters);
    });

    it("setChapter updates chapter index", () => {
      const store = createStore();
      expect(store.getState().bible.chapter).toBe(0);
      store.dispatch(setChapter(2));
      expect(store.getState().bible.chapter).toBe(2);
    });

    it("setVersion updates version", () => {
      const store = createStore();
      expect(store.getState().bible.version).toBe("nkjv");
      store.dispatch(setVersion("esv"));
      expect(store.getState().bible.version).toBe("esv");
    });

    it("setStartVerse and setEndVerse update verse indices", () => {
      const store = createStore();
      store.dispatch(setStartVerse(2));
      store.dispatch(setEndVerse(5));
      expect(store.getState().bible.startVerse).toBe(2);
      expect(store.getState().bible.endVerse).toBe(5);
    });

    it("setSearchValue clears chapter/verse search when book changes", () => {
      const store = createStore();
      store.dispatch(
        setSearchValue({ type: "chapter", value: "3" }),
      );
      store.dispatch(
        setSearchValue({ type: "startVerse", value: "16" }),
      );
      store.dispatch(setSearchValue({ type: "book", value: "Genesis" }));
      expect(store.getState().bible.searchValues.book).toBe("Genesis");
      expect(store.getState().bible.searchValues.chapter).toBe("");
      expect(store.getState().bible.searchValues.startVerse).toBe("");
      expect(store.getState().bible.searchValues.endVerse).toBe("");
    });

    it("setSearchValue clears verse search when chapter changes", () => {
      const store = createStore();
      store.dispatch(
        setSearchValue({ type: "startVerse", value: "16" }),
      );
      store.dispatch(
        setSearchValue({ type: "endVerse", value: "20" }),
      );
      store.dispatch(setSearchValue({ type: "chapter", value: "4" }));
      expect(store.getState().bible.searchValues.chapter).toBe("4");
      expect(store.getState().bible.searchValues.startVerse).toBe("");
      expect(store.getState().bible.searchValues.endVerse).toBe("");
    });
  });

  describe("openBibleAtLocation thunk", () => {
    it("sets book, chapter, version and isLoadingChapter true for valid location", async () => {
      const store = createStore();
      const payload: OpenBibleAtLocationPayload = {
        book: "Genesis",
        chapter: "1",
        version: "esv",
      };
      await store.dispatch(openBibleAtLocation(payload) as never);
      const state = store.getState().bible;
      expect(state.book).toBe(0);
      expect(state.chapters).toEqual(bibleStructure.books[0].chapters);
      expect(state.chapter).toBe(0);
      expect(state.version).toBe("esv");
      expect(state.isLoadingChapter).toBe(true);
    });

    it("navigates to later chapter in same book", async () => {
      const store = createStore();
      const payload: OpenBibleAtLocationPayload = {
        book: "Genesis",
        chapter: "3",
        version: "nkjv",
      };
      await store.dispatch(openBibleAtLocation(payload) as never);
      const state = store.getState().bible;
      expect(state.book).toBe(0);
      expect(state.chapter).toBe(2);
      expect(state.version).toBe("nkjv");
      expect(state.isLoadingChapter).toBe(true);
    });

    it("navigates to different book and chapter", async () => {
      const store = createStore();
      const payload: OpenBibleAtLocationPayload = {
        book: "Exodus",
        chapter: "2",
        version: "nkjv",
      };
      await store.dispatch(openBibleAtLocation(payload) as never);
      const state = store.getState().bible;
      const exodusIndex = bibleStructure.books.findIndex(
        (b) => b.name === "Exodus",
      );
      expect(state.book).toBe(exodusIndex);
      expect(state.chapter).toBe(1);
      expect(state.chapters).toEqual(
        bibleStructure.books[exodusIndex].chapters,
      );
      expect(state.isLoadingChapter).toBe(true);
    });

    it("does not update state when book name is unknown", async () => {
      const store = createStore();
      const before = store.getState().bible;
      const payload: OpenBibleAtLocationPayload = {
        book: "UnknownBook",
        chapter: "1",
        version: "nkjv",
      };
      await store.dispatch(openBibleAtLocation(payload) as never);
      const after = store.getState().bible;
      expect(after.book).toBe(before.book);
      expect(after.chapter).toBe(before.chapter);
      expect(after.version).toBe(before.version);
      expect(after.isLoadingChapter).toBe(before.isLoadingChapter);
    });

    it("does not update state when chapter name is unknown for book", async () => {
      const store = createStore();
      const before = store.getState().bible;
      const payload: OpenBibleAtLocationPayload = {
        book: "Genesis",
        chapter: "999",
        version: "nkjv",
      };
      await store.dispatch(openBibleAtLocation(payload) as never);
      const after = store.getState().bible;
      expect(after.book).toBe(before.book);
      expect(after.chapter).toBe(before.chapter);
      expect(after.version).toBe(before.version);
      expect(after.isLoadingChapter).toBe(before.isLoadingChapter);
    });
  });
});
