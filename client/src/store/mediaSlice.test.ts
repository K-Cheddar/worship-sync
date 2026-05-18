import { configureStore } from "@reduxjs/toolkit";
import mediaReducer, {
  updateMediaList,
  setMediaListAndFolders,
  setIsInitialized,
  initiateMediaList,
  initiateMediaFromDoc,
  syncMediaFromRemote,
  updateMediaListFromRemote,
  removeItemFromMediaList,
  addItemToMediaList,
  updateMediaItemFields,
} from "./mediaSlice";
import type { MediaType, MediaFolder } from "../types";

const createStore = () =>
  configureStore({ reducer: { media: mediaReducer } });

const makeMedia = (id: string): MediaType =>
  ({ id, name: id, background: "", type: "image" } as MediaType);

const makeFolder = (id: string): MediaFolder =>
  ({ id, name: id, parentId: null } as MediaFolder);

describe("mediaSlice", () => {
  describe("initial state", () => {
    it("starts with empty list, no folders, not initialized", () => {
      const store = createStore();
      const state = store.getState().media;
      expect(state.list).toEqual([]);
      expect(state.folders).toEqual([]);
      expect(state.isInitialized).toBe(false);
    });
  });

  describe("updateMediaList", () => {
    it("replaces the list", () => {
      const store = createStore();
      store.dispatch(updateMediaList([makeMedia("m1"), makeMedia("m2")]));
      expect(store.getState().media.list).toHaveLength(2);
    });
  });

  describe("setMediaListAndFolders", () => {
    it("sets both list and folders", () => {
      const store = createStore();
      store.dispatch(
        setMediaListAndFolders({
          list: [makeMedia("m1")],
          folders: [makeFolder("f1")],
        }),
      );
      const state = store.getState().media;
      expect(state.list).toHaveLength(1);
      expect(state.folders).toHaveLength(1);
    });
  });

  describe("setIsInitialized", () => {
    it("sets the flag", () => {
      const store = createStore();
      store.dispatch(setIsInitialized(true));
      expect(store.getState().media.isInitialized).toBe(true);
    });
  });

  describe("initiateMediaList", () => {
    it("sets list, clears folders, marks initialized", () => {
      const store = createStore();
      store.dispatch(
        setMediaListAndFolders({ list: [], folders: [makeFolder("f1")] }),
      );
      store.dispatch(initiateMediaList([makeMedia("m1")]));
      const state = store.getState().media;
      expect(state.list).toHaveLength(1);
      expect(state.folders).toHaveLength(0);
      expect(state.isInitialized).toBe(true);
    });
  });

  describe("initiateMediaFromDoc", () => {
    it("sets list, folders, and marks initialized", () => {
      const store = createStore();
      store.dispatch(
        initiateMediaFromDoc({
          list: [makeMedia("m1"), makeMedia("m2")],
          folders: [makeFolder("f1")],
        }),
      );
      const state = store.getState().media;
      expect(state.list).toHaveLength(2);
      expect(state.folders).toHaveLength(1);
      expect(state.isInitialized).toBe(true);
    });
  });

  describe("syncMediaFromRemote", () => {
    it("replaces list and folders", () => {
      const store = createStore();
      store.dispatch(
        syncMediaFromRemote({
          list: [makeMedia("r1")],
          folders: [makeFolder("rf1")],
        }),
      );
      expect(store.getState().media.list[0].id).toBe("r1");
      expect(store.getState().media.folders[0].id).toBe("rf1");
    });
  });

  describe("updateMediaListFromRemote", () => {
    it("normalizes and sets the list", () => {
      const store = createStore();
      store.dispatch(updateMediaListFromRemote([makeMedia("m1")]));
      expect(store.getState().media.list).toHaveLength(1);
    });
  });

  describe("removeItemFromMediaList", () => {
    it("removes item by id", () => {
      const store = createStore();
      store.dispatch(updateMediaList([makeMedia("m1"), makeMedia("m2")]));
      store.dispatch(removeItemFromMediaList("m1"));
      expect(store.getState().media.list).toHaveLength(1);
      expect(store.getState().media.list[0].id).toBe("m2");
    });

    it("is a no-op when id not found", () => {
      const store = createStore();
      store.dispatch(updateMediaList([makeMedia("m1")]));
      store.dispatch(removeItemFromMediaList("missing"));
      expect(store.getState().media.list).toHaveLength(1);
    });
  });

  describe("addItemToMediaList", () => {
    it("appends an item", () => {
      const store = createStore();
      store.dispatch(addItemToMediaList(makeMedia("m1")));
      expect(store.getState().media.list).toHaveLength(1);
    });
  });

  describe("updateMediaItemFields", () => {
    it("patches an existing item by id", () => {
      const store = createStore();
      store.dispatch(updateMediaList([makeMedia("m1")]));
      store.dispatch(
        updateMediaItemFields({ id: "m1", patch: { name: "Updated" } }),
      );
      expect(store.getState().media.list[0].name).toBe("Updated");
      expect(store.getState().media.list[0].id).toBe("m1");
    });

    it("is a no-op when id is not found", () => {
      const store = createStore();
      store.dispatch(updateMediaList([makeMedia("m1")]));
      store.dispatch(
        updateMediaItemFields({ id: "missing", patch: { name: "Updated" } }),
      );
      expect(store.getState().media.list[0].name).toBe("m1");
    });
  });
});
