import * as songPersistence from "../utils/songPersistence";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useOutlineItemDocs } from "./useOutlineItemDocs";
import { ControllerInfoContext } from "../context/controllerInfo";
import { upsertItemsInAllDocs } from "../store/allDocsSlice";
import type { DBItem } from "../types";
import { createMockControllerContext, createMockPouchDB } from "../test/mocks";

const mockDispatch = jest.fn();
let mockState: {
  allDocs: {
    allSongDocs: DBItem[];
    allFreeFormDocs: DBItem[];
    allTimerDocs: DBItem[];
    allBibleDocs: DBItem[];
  };
};

jest.mock("./reduxHooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

const songDoc = (id: string, rev: string): DBItem =>
  ({
    _id: id,
    _rev: rev,
    name: id,
    type: "song",
    selectedArrangement: 0,
    arrangements: [],
    slides: [],
    shouldSendTo: { projector: true, monitor: true, stream: true },
  }) as DBItem;

describe("useOutlineItemDocs", () => {
  afterEach(() => jest.restoreAllMocks());
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      allDocs: {
        allSongDocs: [songDoc("song-1", "1-a")],
        allFreeFormDocs: [],
        allTimerDocs: [],
        allBibleDocs: [],
      },
    };
  });

  it("returns cached allDocs entries without fetching", () => {
    const allDocs = jest.fn();
    const { result } = renderHook(() => useOutlineItemDocs(["song-1"]), {
      wrapper: ({ children }) => (
        <ControllerInfoContext.Provider
          value={
            createMockControllerContext({
              db: createMockPouchDB({ allDocs }),
            }) as never
          }
        >
          {children}
        </ControllerInfoContext.Provider>
      ),
    });

    expect(result.current.get("song-1")?._rev).toBe("1-a");
    expect(allDocs).not.toHaveBeenCalled();
  });

  it("batch-fetches missing ids and upserts them", async () => {
    const fetched = songDoc("song-2", "2-b");
    jest.spyOn(songPersistence, "loadSong").mockResolvedValue(fetched);
    const allDocs = jest.fn().mockResolvedValue({
      rows: [{ id: "song-2", doc: fetched }],
    });
    renderHook(() => useOutlineItemDocs(["song-1", "song-2"]), {
      wrapper: ({ children }) => (
        <ControllerInfoContext.Provider
          value={
            createMockControllerContext({
              db: createMockPouchDB({ allDocs }),
            }) as never
          }
        >
          {children}
        </ControllerInfoContext.Provider>
      ),
    });

    await waitFor(() => {
      expect(allDocs).toHaveBeenCalledWith({
        keys: ["song-2"],
        include_docs: true,
      });
    });
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith(upsertItemsInAllDocs([fetched])));
  });
  it("exact-loads v2 outline previews locally without putting slides into the library", async () => {
    const projection = { ...songDoc("song-1", "1-root"), docType: "song-v2-root" as const };
    mockState.allDocs.allSongDocs = [projection];
    const full: DBItem = { ...projection, arrangements: [{ id: "a", name: "Master", formattedLyrics: [], songOrder: [], slides: [{ id: "s", name: "Verse", type: "Verse", boxes: [] }] }] };
    const load = jest.spyOn(songPersistence, "loadSong").mockResolvedValue(full);
    const db = createMockPouchDB();
    const { result } = renderHook(() => useOutlineItemDocs(["song-1"]), {
      wrapper: ({ children }) => <ControllerInfoContext.Provider value={createMockControllerContext({ db }) as never}>{children}</ControllerInfoContext.Provider>,
    });
    await waitFor(() => expect(result.current.get("song-1")?.arrangements[0].slides).toHaveLength(1));
    expect(load).toHaveBeenCalledWith(db, "song-1");
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockState.allDocs.allSongDocs[0]).toBe(projection);
  });

  it("discards a pending exact read when the database changes with the same song ID", async () => {
    const projection: DBItem = { ...songDoc("song-1", "1-root"), docType: "song-v2-root" };
    mockState.allDocs.allSongDocs = [projection];
    const oldDb = createMockPouchDB();
    const newDb = createMockPouchDB();
    let activeDb = oldDb;
    let resolveOld!: (song: DBItem) => void;
    const pending = new Promise<DBItem>((resolve) => { resolveOld = resolve; });
    const load = jest.spyOn(songPersistence, "loadSong").mockImplementation(async (db) =>
      db === oldDb ? pending : { ...projection, name: "New database" },
    );
    const { result, rerender } = renderHook(() => useOutlineItemDocs(["song-1"]), {
      wrapper: ({ children }) => <ControllerInfoContext.Provider value={createMockControllerContext({ db: activeDb }) as never}>{children}</ControllerInfoContext.Provider>,
    });
    await waitFor(() => expect(load).toHaveBeenCalledWith(oldDb, "song-1"));
    activeDb = newDb;
    rerender();
    await waitFor(() => expect(result.current.get("song-1")?.name).toBe("New database"));
    await act(async () => { resolveOld({ ...projection, name: "Stale database" }); });
    expect(result.current.get("song-1")?.name).toBe("New database");
    expect(mockDispatch).not.toHaveBeenCalled();
  });

});
