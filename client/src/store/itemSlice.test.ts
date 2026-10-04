import { configureStore } from "@reduxjs/toolkit";
import { itemDocMatchesEditorState, itemSlice, updateArrangements } from "./itemSlice";
import { getMonitorLayoutForSlides } from "../utils/monitorSlideFormatter";
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
  it("preserves optional presentation text in snapshots without false remote conflicts", () => {
    const textDocument = {
      blocks: [
        { spans: [{ text: "Structured", bold: true }, { text: " lyrics" }] },
      ],
    };
    const item = {
      ...itemSlice.getInitialState(),
      _id: "structured-item",
      name: "Structured item",
      type: "song" as const,
      slides: [
        {
          id: "slide-1",
          type: "Verse" as const,
          name: "Verse 1",
          boxes: [
            { words: "Structured lyrics", textDocument, width: 100, height: 50 },
          ],
        },
      ],
      formattedSections: [
        {
          sectionNum: 1,
          name: "Verse 1",
          words: "Structured lyrics",
          slideSpan: 1,
          id: "section-1",
          textDocument,
        },
      ],
      arrangements: [
        {
          id: "arrangement-1",
          name: "Default",
          songOrder: [],
          slides: [],
          formattedLyrics: [
            {
              type: "Verse",
              name: "Verse 1",
              words: "Structured lyrics",
              slideSpan: 1,
              id: "lyric-1",
              textDocument,
            },
          ],
        },
      ],
    };
    const store = createStore();

    store.dispatch(itemSlice.actions.setActiveItem(item));

    const state = store.getState().item;
    expect(state.slides).toEqual([]);
    expect(state.baseItem?.slides).toEqual([]);
    expect(state.baseItem?.arrangements[0].slides[0].boxes[0].textDocument).toEqual(textDocument);
    expect(state.baseItem?.formattedSections?.[0].textDocument).toEqual(
      textDocument,
    );
    expect(
      state.baseItem?.arrangements?.[0].formattedLyrics[0].textDocument,
    ).toEqual(textDocument);
    expect(itemDocMatchesEditorState(state.baseItem!, state)).toBe(true);
  });

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

    it("setIsLyricsEditorOpen updates isLyricsEditorOpen", () => {
      const store = createStore();
      store.dispatch(itemSlice.actions.setIsLyricsEditorOpen(true));
      expect(store.getState().item.isLyricsEditorOpen).toBe(true);
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

    it("songs read and edit only the selected arrangement slides", async () => {
      const store = createStore();
      const firstSlide = {
        type: "Verse" as const, name: "Master Verse", id: "master-1", boxes: [{ words: "Master", width: 100, height: 100 }],
      };
      const secondSlide = {
        type: "Verse" as const, name: "Acoustic Verse", id: "acoustic-1", boxes: [{ words: "Acoustic", width: 100, height: 100 }],
      };
      store.dispatch(itemSlice.actions.setActiveItem({
        _id: "song-active", name: "Song", type: "song", selectedArrangement: 0,
        slides: [{ ...firstSlide, name: "legacy duplicate" }],
        arrangements: [
          { id: "master", name: "Master", songOrder: [], formattedLyrics: [], slides: [firstSlide] },
          { id: "acoustic", name: "Acoustic", songOrder: [], formattedLyrics: [], slides: [secondSlide] },
        ],
      } as any));

      expect(store.getState().item.slides).toEqual([]);
      expect(store.getState().item.arrangements[0].slides[0].name).toBe("Master Verse");
      store.dispatch(itemSlice.actions._setSelectedArrangement(1));
      store.dispatch(itemSlice.actions._updateSlides([{ ...secondSlide, name: "Edited Acoustic" }]));

      const state = store.getState().item;
      expect(state.slides).toEqual([]);
      expect(state.arrangements[0].slides).toEqual([firstSlide]);
      expect(state.arrangements[1].slides[0].name).toBe("Edited Acoustic");
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

    it("recalculates compact monitor layout when updateArrangements replaces sizing inputs", async () => {
      const originalSlides = [{
        id: "slide-1",
        type: "Verse" as const,
        name: "Verse 1",
        boxes: [
          { id: "bg", width: 100, height: 100 },
          { id: "text", width: 80, height: 50, words: "Short", fontSize: 40 },
        ],
      }];
      const nextSlides = [{
        ...originalSlides[0],
        boxes: [
          ...originalSlides[0].boxes.slice(0, 1),
          { ...originalSlides[0].boxes[1], height: 35 },
        ],
      }];
      const item = {
        ...itemSlice.getInitialState(),
        _id: "song-monitor-layout",
        type: "song",
        selectedArrangement: 0,
        selectedSlide: 0,
        arrangements: [{
          id: "arr-1",
          name: "Master",
          formattedLyrics: [],
          songOrder: [],
          slides: originalSlides,
          monitorLayout: { currentFontSizePx: 999, nextFontSizePx: 999 },
        }],
      } as ItemState;
      const dispatch = jest.fn();
      const getState = () => ({ undoable: { present: { item } } });

      await updateArrangements({
        arrangements: [{ ...item.arrangements[0], slides: nextSlides }],
      })(dispatch as any, getState as any, undefined);

      const action = dispatch.mock.calls.find(([entry]) =>
        entry.type === "item/_updateArrangements",
      )?.[0];
      expect(action.payload[0].monitorLayout).toEqual(getMonitorLayoutForSlides(nextSlides));
      expect(action.payload[0].monitorLayout.currentFontSizePx).not.toBe(999);
    });

    it("applies an already-persisted Canva replacement without marking the item dirty", () => {
      const store = createStore();
      store.dispatch(
        itemSlice.actions.setActiveItem({
          _id: "item-canva",
          name: "Welcome",
          type: "song",
          background: "https://cdn.example/old.png",
          slides: [],
          arrangements: [],
        }),
      );

      store.dispatch(
        itemSlice.actions.replaceMediaReferencesInActiveItem({
          oldMedia: {
            id: "media-1",
            background: "https://cdn.example/old.png",
          } as any,
          newMedia: {
            id: "media-1",
            background: "https://cdn.example/new.png",
          } as any,
        }),
      );

      const state = store.getState().item;
      expect(state.background).toBe("https://cdn.example/new.png");
      expect(state.baseItem?.background).toBe("https://cdn.example/new.png");
      expect(state.hasPendingUpdate).toBe(false);
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
