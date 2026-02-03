import { configureStore } from "@reduxjs/toolkit";
import { itemSlice } from "./itemSlice";
import type { ItemState } from "../types";

type ItemSliceState = { item: ItemState };

const createStore = (preloadedState?: Partial<ItemSliceState>) =>
  configureStore({
    reducer: { item: itemSlice.reducer },
    ...(preloadedState != null &&
      Object.keys(preloadedState).length > 0 && {
        preloadedState: preloadedState as ItemSliceState,
      }),
  });

describe("itemSlice", () => {
  describe("reducer only", () => {
    it("setActiveItem merges partial state", () => {
      const store = createStore();
      store.dispatch(
        itemSlice.actions.setActiveItem({
          name: "New Song",
          _id: "item-123",
          type: "song",
        }),
      );
      const state = store.getState().item;
      expect(state.name).toBe("New Song");
      expect(state._id).toBe("item-123");
      expect(state.type).toBe("song");
    });

    it("setSelectedSlide updates selectedSlide", () => {
      const store = createStore();
      store.dispatch(itemSlice.actions.setSelectedSlide(3));
      expect(store.getState().item.selectedSlide).toBe(3);
    });

    it("setIsEditMode updates isEditMode", () => {
      const store = createStore();
      store.dispatch(itemSlice.actions.setIsEditMode(true));
      expect(store.getState().item.isEditMode).toBe(true);
    });

    it("setItemIsLoading and setSectionLoading update flags", () => {
      const store = createStore();
      store.dispatch(itemSlice.actions.setItemIsLoading(false));
      store.dispatch(itemSlice.actions.setSectionLoading(true));
      expect(store.getState().item.isLoading).toBe(false);
      expect(store.getState().item.isSectionLoading).toBe(true);
    });

    it("setHasPendingUpdate updates hasPendingUpdate", () => {
      const store = createStore();
      store.dispatch(itemSlice.actions.setHasPendingUpdate(true));
      expect(store.getState().item.hasPendingUpdate).toBe(true);
    });

    it("_updateSlides replaces slides", () => {
      const store = createStore();
      const slides = [
        {
          type: "Verse" as const,
          name: "V1",
          id: "s1",
          boxes: [],
        },
      ];
      store.dispatch(itemSlice.actions._updateSlides(slides));
      expect(store.getState().item.slides).toHaveLength(1);
      expect(store.getState().item.slides[0].name).toBe("V1");
    });
  });
});
