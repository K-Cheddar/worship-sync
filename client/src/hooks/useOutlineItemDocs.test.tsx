import { renderHook, waitFor } from "@testing-library/react";
import { useOutlineItemDocs } from "./useOutlineItemDocs";
import { ControllerInfoContext } from "../context/controllerInfo";
import { upsertItemInAllDocs } from "../store/allDocsSlice";
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
    expect(mockDispatch).toHaveBeenCalledWith(upsertItemInAllDocs(fetched));
  });
});
