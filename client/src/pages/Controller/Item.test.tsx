import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import Item from "./Item";
import { itemSlice } from "../../store/itemSlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  createMockControllerContext,
  createMockGlobalContext,
  createMockPouchDB,
} from "../../test/mocks";
import type { DBItem } from "../../types";
import * as songPersistence from "../../utils/songPersistence";
import { SongV2ReplicationConflictError } from "../../utils/songV2ReplicationConflicts";
import * as songV2ReplicationConflicts from "../../utils/songV2ReplicationConflicts";

jest.mock("../../containers/ItemEditor/SlideEditor", () => () => (
  <div data-testid="slide-editor" />
));

jest.mock("../../containers/ItemSlides/ItemSlides", () => () => (
  <div data-testid="item-slides" />
));

const itemRoute = (itemId: string, listId: string) =>
  `/controller/item/${window.btoa(encodeURI(itemId))}/${window.btoa(
    encodeURI(listId),
  )}`;

const RouteDriver = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(itemRoute("item-c", "list-c"))}>
      Go to C
    </button>
  );
};

const createTestStore = () => {
  const initialUndoableState = {
    past: [],
    present: {
      item: itemSlice.getInitialState(),
    },
    future: [],
  };

  const undoableReducer = (state = initialUndoableState, action: any) => ({
    ...state,
    present: {
      ...state.present,
      item: itemSlice.reducer(state.present.item, action),
    },
  });

  return configureStore({
    reducer: {
      undoable: undoableReducer,
    },
    preloadedState: {
      undoable: initialUndoableState,
    },
  });
};

describe("Controller Item page", () => {
  it("opens a read-only song and lets a third editor review and explicitly choose a saved version", async () => {
    const rawSong = {
      _id: "better",
      type: "song",
      name: "Better",
      selectedArrangement: 0,
      slides: [],
      arrangements: [{
        id: "arr-1",
        name: "Master",
        songOrder: [],
        formattedLyrics: [{ id: "lyrics-1", name: "Verse 1", type: "Verse", words: "winning lyrics", slideSpan: 1 }],
        slides: [{
          id: "slide-1",
          type: "Verse",
          name: "Verse 1",
          boxes: [
            { id: "box-0", words: "", width: 1920, height: 1080 },
            { id: "box-1", words: "winning lyrics", width: 1920, height: 1080 },
          ],
        }],
      }],
    } as unknown as DBItem;
    const documents = songPersistence.serializeSongToV2Documents(rawSong);
    const winningArrangement = { ...documents.arrangements[0], _rev: "2-winning" };
    const competingArrangement = {
      ...winningArrangement,
      _rev: "2-competing",
      formattedLyrics: winningArrangement.formattedLyrics.map(lyric => ({ ...lyric, words: "competing lyrics" })),
    };
    const winningRoot = { ...documents.root, _rev: "1-root" };
    const winningSlide = { ...documents.slides[0], _rev: "2-slide" };
    const winningSong = songPersistence.hydrateSongFromV2Documents(
      winningRoot, [winningArrangement], [winningSlide], true,
    );
    const competingSong = {
      ...winningSong,
      arrangements: winningSong.arrangements.map(arrangement => ({
        ...arrangement,
        formattedLyrics: arrangement.formattedLyrics.map(lyric => ({ ...lyric, words: "competing lyrics" })),
        slides: arrangement.slides.map(slide => ({
          ...slide,
          boxes: slide.boxes.map(box => box.id === "box-1" ? { ...box, words: "competing lyrics" } : box),
        })),
      })),
    };
    const conflict = {
      documentId: winningArrangement._id,
      winningRevision: winningArrangement._rev,
      revisions: [competingArrangement._rev],
    };
    const snapshot: songPersistence.SongV2Snapshot = {
      root: winningRoot,
      arrangements: [winningArrangement],
      slides: [winningSlide],
      hydrated: winningSong,
      conflicts: [conflict],
    };
    const versions = [{
      conflict,
      options: [
        { revision: winningArrangement._rev, document: winningArrangement },
        { revision: competingArrangement._rev, document: competingArrangement },
      ],
    }];
    const optionsSpy = jest.spyOn(songV2ReplicationConflicts, "loadSongV2ConflictRevisionOptions")
      .mockResolvedValue(versions);
    const buildSpy = jest.spyOn(songV2ReplicationConflicts, "buildSongV2RevisionSelection")
      .mockImplementation(async (_db, _snapshot, _options, selected) => ({
        song: selected[winningArrangement._id] === competingArrangement._rev ? competingSong : winningSong,
        sourceRevisions: { [winningArrangement._id]: selected[winningArrangement._id] },
      }));
    const resolveSpy = jest.spyOn(songV2ReplicationConflicts, "resolveSongV2ConflictReview")
      .mockResolvedValue({ song: competingSong, conflictsRetired: true });
    const load = jest.spyOn(songPersistence, "loadItemWithSongHydration")
      .mockRejectedValueOnce(new SongV2ReplicationConflictError(snapshot));
    const db = createMockPouchDB();
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={createMockControllerContext({ db }) as any}>
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <MemoryRouter initialEntries={[itemRoute("better", "list")] }>
              <Routes><Route path="/controller/item/:itemId/:listId" element={<Item />} /></Routes>
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );
    expect(await screen.findByText(/editing is paused until you review and save a resolution/i)).toBeInTheDocument();
    expect(screen.getByTestId("slide-editor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review saved versions" }));
    expect((await screen.findAllByText(/winning lyrics/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/competing lyrics/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /revision 2-competing/ }));
    await waitFor(() => expect(screen.queryByText("Loading selected version…")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save resolution" }));
    await waitFor(() => expect(resolveSpy).toHaveBeenCalledWith(
      db, snapshot, competingSong, [conflict], { [winningArrangement._id]: competingArrangement._rev },
    ));
    await waitFor(() => expect(screen.queryByText(/editing is paused/i)).not.toBeInTheDocument());
    expect(screen.getByTestId("slide-editor")).toBeInTheDocument();
    expect(db.put).not.toHaveBeenCalled();
    expect(store.getState().undoable.present.item.isLoading).toBe(false);
    expect(optionsSpy).toHaveBeenCalledTimes(1);
    expect(buildSpy).toHaveBeenCalledTimes(2);
    load.mockRestore();
  });
  it("clears loading when fetching the item fails", async () => {
    const dbGet = jest.fn().mockRejectedValue(new Error("load failed"));
    const controllerContext = createMockControllerContext({
      db: createMockPouchDB({ get: dbGet }),
    });
    const globalContext = createMockGlobalContext();
    const store = createTestStore();
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => { });

    const itemId = window.btoa(encodeURI("item-123"));
    const listId = window.btoa(encodeURI("list-456"));

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={controllerContext as any}>
          <GlobalInfoContext.Provider value={globalContext as any}>
            <MemoryRouter initialEntries={[`/controller/item/${itemId}/${listId}`]}>
              <Routes>
                <Route
                  path="/controller/item/:itemId/:listId"
                  element={<Item />}
                />
              </Routes>
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    expect(await screen.findByText("Item Not Found")).toBeInTheDocument();

    expect(dbGet).toHaveBeenCalledWith("item-123");
    expect(store.getState().undoable.present.item.isLoading).toBe(false);

    consoleErrorSpy.mockRestore();
  });

  it("hydrates exact song reads into arrangement slides", async () => {
    const legacySong = {
      _id: "song-123",
      name: "Recovered Song",
      type: "song",
      selectedArrangement: 1,
      slides: [{
        id: "legacy-slide",
        type: "Verse",
        name: "Verse 1",
        boxes: [],
        monitorCurrentBandBoxes: [{ id: "current", fontSize: 30 }],
        monitorNextBandBoxes: [{ id: "next", fontSize: 28 }],
      }],
      arrangements: [
        {
          id: "populated",
          name: "Other",
          formattedLyrics: [],
          songOrder: [],
          slides: [{ id: "other-slide", type: "Verse", name: "Verse", boxes: [] }],
        },
        {
          id: "selected",
          name: "Selected",
          formattedLyrics: [],
          songOrder: [],
          slides: [],
        },
      ],
    } as unknown as DBItem;
    const dbGet = jest.fn(async (id: string) => {
      if (id !== legacySong._id) throw Object.assign(new Error("Not found"), { status: 404 });
      return legacySong;
    });
    const store = createTestStore();
    const controllerContext = createMockControllerContext({
      db: createMockPouchDB({ get: dbGet }),
    });
    const itemId = window.btoa(encodeURI("song-123"));
    const listId = window.btoa(encodeURI("list-1"));

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={controllerContext as any}>
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <MemoryRouter initialEntries={[`/controller/item/${itemId}/${listId}`]}>
              <Routes>
                <Route path="/controller/item/:itemId/:listId" element={<Item />} />
              </Routes>
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await screen.findByTestId("slide-editor");
    const loaded = store.getState().undoable.present.item;
    expect(dbGet).toHaveBeenCalledWith("song-123");
    expect(loaded.slides).toEqual([]);
    expect(loaded.arrangements[0].slides[0].id).toBe("other-slide");
    expect(loaded.arrangements[1].slides[0].id).toBe("legacy-slide");
    expect(loaded.arrangements[1].slides[0]).not.toHaveProperty("monitorCurrentBandBoxes");
    expect(loaded.arrangements[1].monitorLayout).toEqual({
      currentFontSizePx: 30,
      nextFontSizePx: 28,
    });
  });

  it("backfills formatted sections for free items missing them", async () => {
    const dbGet = jest.fn().mockResolvedValue({
      _id: "item-123",
      name: "Free item",
      type: "free",
      slides: [
        {
          name: "Section 1",
          boxes: [
            { words: "ignored" },
            { words: "Line one" },
          ],
        },
        {
          name: "Section 1",
          boxes: [
            { words: "ignored" },
            { words: "Line two" },
          ],
        },
      ],
      formattedSections: [],
    } as unknown as DBItem);
    const controllerContext = createMockControllerContext({
      db: createMockPouchDB({ get: dbGet }),
    });
    const globalContext = createMockGlobalContext();
    const store = createTestStore();
    const itemId = window.btoa(encodeURI("item-123"));
    const listId = window.btoa(encodeURI("list-456"));

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={controllerContext as any}>
          <GlobalInfoContext.Provider value={globalContext as any}>
            <MemoryRouter initialEntries={[`/controller/item/${itemId}/${listId}`]}>
              <Routes>
                <Route
                  path="/controller/item/:itemId/:listId"
                  element={<Item />}
                />
              </Routes>
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => {
      expect(store.getState().undoable.present.item.isLoading).toBe(false);
    });

    const { formattedSections } = store.getState().undoable.present.item;
    expect(formattedSections).toHaveLength(1);
    expect(formattedSections?.[0]).toEqual(
      expect.objectContaining({
        sectionNum: 1,
        words: "Line one\nLine two",
        slideSpan: 2,
      }),
    );
  });

  it("skips re-fetch when Redux already has the route item loaded", async () => {
    const dbGet = jest.fn().mockResolvedValue({
      _id: "item-123",
      name: "Should not load",
      type: "song",
      slides: [],
      arrangements: [],
      selectedArrangement: 0,
    } as unknown as DBItem);
    const controllerContext = createMockControllerContext({
      db: createMockPouchDB({ get: dbGet }),
    });
    const globalContext = createMockGlobalContext();
    const store = createTestStore();
    store.dispatch(
      itemSlice.actions.setActiveItem({
        _id: "item-123",
        listId: "list-456",
        name: "Already loaded",
        type: "song",
        slides: [],
        arrangements: [],
        selectedArrangement: 0,
      } as any),
    );

    const itemId = window.btoa(encodeURI("item-123"));
    const listId = window.btoa(encodeURI("list-456"));

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={controllerContext as any}>
          <GlobalInfoContext.Provider value={globalContext as any}>
            <MemoryRouter initialEntries={[`/controller/item/${itemId}/${listId}`]}>
              <Routes>
                <Route
                  path="/controller/item/:itemId/:listId"
                  element={<Item />}
                />
              </Routes>
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    expect(await screen.findByTestId("item-slides")).toBeInTheDocument();
    expect(dbGet).not.toHaveBeenCalled();
    expect(store.getState().undoable.present.item.isLoading).toBe(false);
    expect(store.getState().undoable.present.item.name).toBe("Already loaded");
  });

  it("does not commit an older item load after navigation moves to a newer item", async () => {
    let resolveB: ((item: DBItem) => void) | undefined;
    let resolveC: ((item: DBItem) => void) | undefined;
    const pendingB = new Promise<DBItem>((resolve) => { resolveB = resolve; });
    const pendingC = new Promise<DBItem>((resolve) => { resolveC = resolve; });
    const dbGet = jest.fn((id: string) => {
      if (id === "item-b") return pendingB;
      if (id === "item-c") return pendingC;
      return Promise.reject(Object.assign(new Error(`unexpected item ${id}`), { status: 404 }));
    });
    const controllerContext = createMockControllerContext({
      db: createMockPouchDB({ get: dbGet }),
    });
    const globalContext = createMockGlobalContext();
    const store = createTestStore();
    const itemB = {
      _id: "item-b",
      name: "Item B",
      type: "song",
      slides: [],
      arrangements: [],
      selectedArrangement: 0,
    } as unknown as DBItem;
    const itemC = {
      _id: "item-c",
      name: "Item C",
      type: "song",
      slides: [],
      arrangements: [],
      selectedArrangement: 0,
    } as unknown as DBItem;

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={controllerContext as any}>
          <GlobalInfoContext.Provider value={globalContext as any}>
            <MemoryRouter initialEntries={[itemRoute("item-b", "list-b")]}>
              <Routes>
                <Route
                  path="/controller/item/:itemId/:listId"
                  element={
                    <>
                      <RouteDriver />
                      <Item />
                    </>
                  }
                />
              </Routes>
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => expect(dbGet).toHaveBeenCalledWith("item-b"));
    fireEvent.click(screen.getByRole("button", { name: "Go to C" }));
    await waitFor(() => expect(dbGet).toHaveBeenCalledWith("item-c"));

    await act(async () => {
      resolveB?.(itemB);
      await Promise.resolve();
    });
    expect(store.getState().undoable.present.item._id).not.toBe("item-b");

    await act(async () => {
      resolveC?.(itemC);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(store.getState().undoable.present.item._id).toBe("item-c"),
    );
    expect(store.getState().undoable.present.item.listId).toBe("list-c");
  });
});
