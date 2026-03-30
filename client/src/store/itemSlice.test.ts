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

    it("setActiveItem copies the incoming background", () => {
      const store = createStore({
        item: {
          ...itemSlice.getInitialState(),
          _id: "previous-item",
          type: "song",
          background: "previous-background.jpg",
        },
      });

      store.dispatch(
        itemSlice.actions.setActiveItem({
          name: "New Song",
          _id: "item-123",
          type: "song",
          background: "new-background.jpg",
        }),
      );

      expect(store.getState().item.background).toBe("new-background.jpg");
    });

    it("setActiveItem resets transient item flags", () => {
      const store = createStore({
        item: {
          ...itemSlice.getInitialState(),
          name: "Previous Item",
          _id: "previous-item",
          isLoading: true,
          isSectionLoading: true,
          isItemFormatting: true,
          hasPendingUpdate: true,
          restoreFocusToBox: 3,
        },
      });

      store.dispatch(
        itemSlice.actions.setActiveItem({
          name: "New Song",
          _id: "item-123",
          type: "song",
        }),
      );

      const state = store.getState().item;
      expect(state.isLoading).toBe(false);
      expect(state.isSectionLoading).toBe(false);
      expect(state.isItemFormatting).toBe(false);
      expect(state.hasPendingUpdate).toBe(false);
      expect(state.restoreFocusToBox).toBeNull();
    });

    it("preserves free slides as provided when loading the active item", () => {
      const store = createStore();
      store.dispatch(
        itemSlice.actions.setActiveItem({
          name: "Legacy Custom",
          _id: "free-1",
          type: "free",
          slides: [
            {
              type: "Section",
              name: "Section 1",
              id: "slide-1",
              boxes: [{ id: "bg" }, { id: "text" }],
            },
          ] as any,
        }),
      );

      const state = store.getState().item;
      expect(state.slides).toEqual([
        expect.objectContaining({
          id: "slide-1",
          name: "Section 1",
          boxes: [{ id: "bg" }, { id: "text" }],
        }),
      ]);
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

    it("_updateArrangements replaces arrangements (editing lyrics)", () => {
      const store = createStore({
        item: {
          name: "Test Song",
          _id: "test-1",
          type: "song",
          selectedArrangement: 0,
          selectedSlide: 0,
          selectedBox: 1,
          slides: [],
          shouldSendTo: {
            projector: true,
            monitor: true,
            stream: true,
          },
          arrangements: [
            {
              name: "Master",
              id: "arr-1",
              formattedLyrics: [
                {
                  id: "fl-orig",
                  type: "Verse",
                  name: "Verse 1",
                  words: "Original line",
                  slideSpan: 1,
                },
              ],
              songOrder: [{ name: "Verse 1", id: "o1" }],
              slides: [],
            },
          ],
        } as ItemState,
      });
      const editedArrangements = [
        {
          name: "Master",
          id: "arr-1",
          formattedLyrics: [
            {
              id: "fl-edit",
              type: "Verse",
              name: "Verse 1",
              words: "Edited line",
              slideSpan: 1,
            },
          ],
          songOrder: [{ name: "Verse 1", id: "o1" }],
          slides: [],
        },
      ];
      store.dispatch(itemSlice.actions._updateArrangements(editedArrangements));
      const state = store.getState().item;
      expect(state.arrangements).toHaveLength(1);
      expect(state.arrangements[0].formattedLyrics[0].words).toBe(
        "Edited line",
      );
      expect(state.hasPendingUpdate).toBe(true);
    });

    it("markItemPersisted clears buffered remote state for the active item", () => {
      const pendingRemoteItem = {
        _id: "test-1",
        name: "Remote Song",
        type: "song",
        selectedArrangement: 0,
        background: "remote-background.jpg",
        arrangements: [],
        slides: [],
        shouldSendTo: {
          projector: true,
          monitor: true,
          stream: true,
        },
      } as any;

      const persistedItem = {
        _id: "test-1",
        name: "Saved Song",
        type: "song",
        selectedArrangement: 0,
        background: "saved-background.jpg",
        arrangements: [],
        slides: [],
        shouldSendTo: {
          projector: true,
          monitor: true,
          stream: true,
        },
      } as any;

      const store = createStore({
        item: {
          ...itemSlice.getInitialState(),
          _id: "test-1",
          type: "song",
          hasRemoteUpdate: true,
          pendingRemoteItem,
        },
      });

      store.dispatch(itemSlice.actions.markItemPersisted(persistedItem));

      const state = store.getState().item;
      expect(state.hasRemoteUpdate).toBe(false);
      expect(state.pendingRemoteItem).toBeNull();
      expect(state.baseItem).toEqual(
        expect.objectContaining({
          _id: "test-1",
          background: "saved-background.jpg",
        }),
      );
    });
  });
});
