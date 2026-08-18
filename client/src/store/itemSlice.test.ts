import { configureStore } from "@reduxjs/toolkit";
import { itemSlice, updateSlideVideoBackgroundSendMode } from "./itemSlice";
import type {
  ItemSlideType,
  ItemState,
  VideoBackgroundSendMode,
} from "../types";

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

    it("setActiveItem copies incoming song metadata", () => {
      const store = createStore();

      store.dispatch(
        itemSlice.actions.setActiveItem({
          name: "New Song",
          _id: "item-123",
          type: "song",
          songMetadata: {
            source: "lrclib",
            lrclibId: 8,
            trackName: "New Song",
            artistName: "Artist",
            plainLyrics: "Words",
            syncedLyrics: null,
            importedAt: "2026-03-30T12:00:00.000Z",
          },
        }),
      );

      expect(store.getState().item.songMetadata).toEqual(
        expect.objectContaining({
          source: "lrclib",
          lrclibId: 8,
        }),
      );
    });

    it("setActiveItem loads song links and attached audio", () => {
      const store = createStore();

      store.dispatch(
        itemSlice.actions.setActiveItem({
          name: "New Song",
          _id: "item-123",
          type: "song",
          songLinks: [
            { id: "link-1", label: "Chart", url: "https://example.com/chart" },
          ],
          songAudio: {
            id: "audio-1",
            key: "churches/church/songs/item-123/audio-1.mp3",
            fileName: "reference.mp3",
            contentType: "audio/mpeg",
            sizeBytes: 1234,
            uploadedAt: "2026-08-06T12:00:00.000Z",
          },
        }),
      );

      const state = store.getState().item;
      expect(state.songLinks).toEqual([
        { id: "link-1", label: "Chart", url: "https://example.com/chart" },
      ]);
      expect(state.songAudio).toEqual(
        expect.objectContaining({ id: "audio-1", fileName: "reference.mp3" }),
      );
    });

    it("setActiveItem clears background target UI state", () => {
      const store = createStore({
        item: {
          ...itemSlice.getInitialState(),
          _id: "prev",
          type: "song",
          backgroundTargetSlideIds: ["a", "b"],
          backgroundTargetRangeAnchorId: "a",
          mobileBackgroundTargetSelectMode: true,
        },
      });

      store.dispatch(
        itemSlice.actions.setActiveItem({
          name: "Next",
          _id: "next",
          type: "song",
        }),
      );

      const state = store.getState().item;
      expect(state.backgroundTargetSlideIds).toEqual([]);
      expect(state.backgroundTargetRangeAnchorId).toBeNull();
      expect(state.mobileBackgroundTargetSelectMode).toBe(false);
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

    it("setSongMetadata updates songMetadata and marks the item dirty", () => {
      const store = createStore();

      store.dispatch(
        itemSlice.actions.setSongMetadata({
          source: "lrclib",
          lrclibId: 12,
          trackName: "Song",
          artistName: "Artist",
          plainLyrics: "Words",
          syncedLyrics: null,
          importedAt: "2026-03-30T12:00:00.000Z",
        }),
      );

      expect(store.getState().item.songMetadata).toEqual(
        expect.objectContaining({ lrclibId: 12 }),
      );
      expect(store.getState().item.hasPendingUpdate).toBe(true);
    });

    it("song resource updates mark the item dirty", () => {
      const store = createStore();

      store.dispatch(
        itemSlice.actions.setSongLinks([
          { id: "link-1", label: "Chart", url: "https://example.com/chart" },
        ]),
      );
      store.dispatch(
        itemSlice.actions.setSongAudio({
          id: "audio-1",
          key: "churches/church/songs/song/audio-1.mp3",
          fileName: "reference.mp3",
          contentType: "audio/mpeg",
          sizeBytes: 1234,
          uploadedAt: "2026-08-06T12:00:00.000Z",
        }),
      );

      expect(store.getState().item.songLinks).toHaveLength(1);
      expect(store.getState().item.songAudio?.id).toBe("audio-1");
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

  describe("updateSlideVideoBackgroundSendMode", () => {
    const slide = (id: string): ItemSlideType => ({
      id,
      type: "Section",
      name: id,
      boxes: [],
    });

    const runThunk = async (
      item: ItemState,
      mode: VideoBackgroundSendMode,
    ): Promise<ItemSlideType[][]> => {
      const dispatch = jest.fn();
      const getState = () => ({ undoable: { present: { item } } });
      await updateSlideVideoBackgroundSendMode({ mode })(
        dispatch,
        getState as never,
        undefined,
      );
      return dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action?.type === "item/_updateSlides")
        .map((action) => action.payload as ItemSlideType[]);
    };

    it("writes the mode onto the selected slide only", async () => {
      const [slides] = await runThunk(
        {
          ...itemSlice.getInitialState(),
          slides: [slide("a"), slide("b"), slide("c")],
          selectedSlide: 1,
        },
        "restart",
      );

      expect(slides.map((s) => s.videoBackgroundSendMode)).toEqual([
        undefined,
        "restart",
        undefined,
      ]);
    });

    it("mirrors the change onto the selected arrangement's slides", async () => {
      const dispatch = jest.fn();
      const item: ItemState = {
        ...itemSlice.getInitialState(),
        slides: [slide("a"), slide("b")],
        selectedSlide: 1,
        selectedArrangement: 0,
        arrangements: [
          {
            id: "arr-1",
            name: "Default",
            formattedLyrics: [],
            songOrder: [],
            slides: [slide("a"), slide("b")],
          },
        ],
      };
      await updateSlideVideoBackgroundSendMode({ mode: "restart" })(
        dispatch,
        (() => ({ undoable: { present: { item } } })) as never,
        undefined,
      );

      const arrangements = dispatch.mock.calls
        .map(([action]) => action)
        .find((action) => action?.type === "item/_updateArrangements")?.payload;

      expect(arrangements[0].slides[1].videoBackgroundSendMode).toBe("restart");
      expect(arrangements[0].slides[0].videoBackgroundSendMode).toBeUndefined();
    });

    it("leaves the slide object untouched when the mode already matches", async () => {
      const existing = {
        ...slide("a"),
        videoBackgroundSendMode: "restart" as const,
      };
      const [slides] = await runThunk(
        {
          ...itemSlice.getInitialState(),
          slides: [existing],
          selectedSlide: 0,
        },
        "restart",
      );

      // Same reference: no needless autosave or undo entry for a no-op click.
      expect(slides[0]).toBe(existing);
    });
  });
});
