import { configureStore } from "@reduxjs/toolkit";
import { createItemSlice, initialCreateItemState } from "./createItemSlice";

type CreateItemSliceState = {
  createItem: ReturnType<typeof createItemSlice.reducer>;
};

const createStore = (preloadedState?: Partial<CreateItemSliceState>) =>
  configureStore({
    reducer: { createItem: createItemSlice.reducer },
    ...(preloadedState != null &&
      Object.keys(preloadedState).length > 0 && {
        preloadedState: preloadedState as CreateItemSliceState,
      }),
  });

describe("createItemSlice", () => {
  it("setCreateItem stores the full draft shape", () => {
    const store = createStore();

    store.dispatch(
      createItemSlice.actions.setCreateItem({
        name: "Grace",
        type: "timer",
        hasUserSelectedType: true,
        text: "Amazing grace",
        songArtist: "",
        songAlbum: "",
        songMetadata: null,
        hours: 1,
        minutes: 2,
        seconds: 3,
        time: "09:30",
        timerType: "countdown",
        lyricsImportCandidates: [],
        lyricsImportError: "",
      }),
    );

    expect(store.getState().createItem).toEqual(expect.objectContaining({
      name: "Grace",
      type: "timer",
      hasUserSelectedType: true,
      text: "Amazing grace",
      songArtist: "",
      songAlbum: "",
      songMetadata: null,
      hours: 1,
      minutes: 2,
      seconds: 3,
      time: "09:30",
      timerType: "countdown",
      lyricsImportCandidates: [],
      lyricsImportError: "",
    }));
    expect(store.getState().createItem.draftId).toBeGreaterThan(0);
  });

  it("resetCreateItem restores the default draft", () => {
    const store = createStore({
      createItem: {
        ...initialCreateItemState,
        name: "Grace",
        type: "timer",
        hasUserSelectedType: true,
        text: "Amazing grace",
        songArtist: "",
        songAlbum: "",
        songMetadata: null,
        hours: 1,
        minutes: 2,
        seconds: 3,
        time: "09:30",
        timerType: "countdown",
        lyricsImportCandidates: [],
        lyricsImportError: "",
      },
    });

    store.dispatch(createItemSlice.actions.resetCreateItem());

    expect(store.getState().createItem).toEqual({
      ...initialCreateItemState,
      draftId: expect.any(Number),
    });
    expect(store.getState().createItem.draftId).not.toBe(0);
  });
});
