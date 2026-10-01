import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import type { ServiceItem } from "../../types";
import type { ServicePlan } from "../../types/servicePlan";
import { upsertItemInAllItemsList } from "../../store/allItemsSlice";
import { updateItemList } from "../../store/itemListSlice";
import { useServicePlanOutlinePush } from "./useServicePlanOutlinePush";
import { buildServicePlanOutlineItem, planServicePlanOutlineItems } from "./servicePlanOutlineBridge";

const mockDispatch = jest.fn();
const mockState = {
  allItems: { list: [], isAllItemsLoading: false },
  allDocs: {
    allSongDocs: [],
    allFreeFormDocs: [{ _id: "custom-doc-1", name: "Welcome Slides", type: "free" }],
  },
  undoable: {
    present: {
      itemList: { list: [] },
      itemLists: { selectedList: { _id: "outline-1", name: "Sunday" } },
    },
  },
};

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));

jest.mock("react-redux", () => ({
  ...jest.requireActual("react-redux"),
  useStore: () => ({ getState: () => mockState }),
}));

jest.mock("./servicePlanOutlineBridge", () => ({
  buildServicePlanOutlineItem: jest.fn(),
  planServicePlanOutlineItems: jest.fn(),
}));

const mockBuildItem = jest.mocked(buildServicePlanOutlineItem);
const mockPlanOutline = jest.mocked(planServicePlanOutlineItems);

const setPlannedItems = (items: ServiceItem[], skippedTitles: string[] = []) => {
  mockPlanOutline.mockReturnValue({
    steps: items.map((item) => ({
      planned: { listId: item.listId, kind: "song", songId: item._id, songName: item.name },
      element: { element: { id: item.listId, title: { blocks: [] }, type: "song" }, title: item.name, planned: [], hasUnresolvedAttachment: false },
    }) as never),
    skippedTitles,
  });
  mockBuildItem.mockImplementation(async ({ step }) => items.find((item) => item.listId === step.planned.listId)!);
};

describe("useServicePlanOutlinePush", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.undoable.present.itemList.list = [];
  });

  it("does not send title-only Service Plan rows to allItems", async () => {
    setPlannedItems([]);
    const db = {} as PouchDB.Database;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ControllerInfoContext.Provider value={{ db } as never}>
        {children}
      </ControllerInfoContext.Provider>
    );
    const { result } = renderHook(() => useServicePlanOutlinePush(), { wrapper });

    await act(async () => {
      await result.current.pushPlanToOutline({} as ServicePlan);
    });

    expect(mockPlanOutline).toHaveBeenCalledWith(
      expect.objectContaining({ customDocuments: mockState.allDocs.allFreeFormDocs }),
    );
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: upsertItemInAllItemsList.type }),
    );
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: updateItemList.type }),
    );
  });

  it("keeps generated scripture items in the Bible library", async () => {
    const bibleItem: ServiceItem = {
      _id: "John 3:16 NKJV",
      name: "John 3:16 NKJV",
      type: "bible",
      listId: "outline-scripture-1",
    };
    setPlannedItems([bibleItem]);
    const db = {} as PouchDB.Database;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ControllerInfoContext.Provider value={{ db } as never}>
        {children}
      </ControllerInfoContext.Provider>
    );
    const { result } = renderHook(() => useServicePlanOutlinePush(), { wrapper });

    await act(async () => {
      await result.current.pushPlanToOutline({} as ServicePlan);
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      upsertItemInAllItemsList({ ...bibleItem, listId: "" }),
    );
  });

  it("does not overwrite an existing custom document with its outline reference", async () => {
    const customDocumentReference: ServiceItem = {
      _id: "custom-doc-1",
      name: "Welcome Slides",
      type: "free",
      listId: "outline-entry-1",
    };
    setPlannedItems([customDocumentReference]);
    const db = {} as PouchDB.Database;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ControllerInfoContext.Provider value={{ db } as never}>
        {children}
      </ControllerInfoContext.Provider>
    );
    const { result } = renderHook(() => useServicePlanOutlinePush(), { wrapper });

    await act(async () => {
      await result.current.pushPlanToOutline({} as ServicePlan);
    });

    expect(mockDispatch).toHaveBeenCalledWith(updateItemList([customDocumentReference]));
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: upsertItemInAllItemsList.type }),
    );
  });

  it("does not index outline-only custom items when no durable database exists", async () => {
    const customItem: ServiceItem = {
      _id: "temporary",
      name: "Temporary",
      type: "free",
      listId: "outline-entry-1",
    };
    setPlannedItems([customItem]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ControllerInfoContext.Provider value={{ db: undefined } as never}>
        {children}
      </ControllerInfoContext.Provider>
    );
    const { result } = renderHook(() => useServicePlanOutlinePush(), { wrapper });

    await act(async () => {
      await result.current.pushPlanToOutline({} as ServicePlan);
    });

    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: upsertItemInAllItemsList.type }),
    );
  });

  it("dispatches multiple actionable items one at a time in Service Plan order", async () => {
    const song: ServiceItem = { _id: "song-1", name: "Song", type: "song", listId: "song-link" };
    const scripture: ServiceItem = { _id: "bible-1", name: "Psalm 95 NIV", type: "bible", listId: "scripture-link" };
    setPlannedItems([song, scripture]);
    const { result } = renderHook(() => useServicePlanOutlinePush());
    const followed: string[] = [];

    await act(async () => {
      await result.current.pushPlanToOutline(
        {} as ServicePlan,
        () => true,
        (item) => { followed.push(item.name); },
      );
    });

    const insertedLists = mockDispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === updateItemList.type);
    expect(insertedLists).toHaveLength(2);
    expect(insertedLists.map((action) => action.payload[0].name)).toEqual(["Song", "Psalm 95 NIV"]);
    expect(followed).toEqual(["Song", "Psalm 95 NIV"]);
  });

  it("stops after the active outline item and does not build later Bible steps", async () => {
    const song: ServiceItem = { _id: "song-1", name: "Song", type: "song", listId: "song-link" };
    const scripture: ServiceItem = { _id: "bible-1", name: "Psalm 95 NIV", type: "bible", listId: "scripture-link" };
    setPlannedItems([song, scripture]);
    const { result } = renderHook(() => useServicePlanOutlinePush());
    let shouldContinue = true;

    await act(async () => {
      await result.current.pushPlanToOutline(
        {} as ServicePlan,
        () => true,
        () => { shouldContinue = false; },
        () => shouldContinue,
      );
    });

    expect(mockBuildItem).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(updateItemList([song]));
  });
});
