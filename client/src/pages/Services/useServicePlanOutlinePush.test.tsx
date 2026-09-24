import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import type { ServiceItem } from "../../types";
import type { ServicePlan } from "../../types/servicePlan";
import { upsertItemInAllItemsList } from "../../store/allItemsSlice";
import { updateItemList } from "../../store/itemListSlice";
import { useServicePlanOutlinePush } from "./useServicePlanOutlinePush";
import { buildServicePlanOutlineItems } from "./servicePlanOutlineBridge";

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

jest.mock("./servicePlanOutlineBridge", () => ({
  buildServicePlanOutlineItems: jest.fn(),
}));

const mockBuildOutline = jest.mocked(buildServicePlanOutlineItems);

describe("useServicePlanOutlinePush", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("registers newly created outline custom items in the Custom library", async () => {
    const customItem: ServiceItem = {
      _id: "Welcome Slides",
      name: "Welcome Slides",
      type: "free",
      listId: "outline-entry-1",
      background: "welcome-background",
    };
    mockBuildOutline.mockResolvedValue({
      items: [customItem],
      updatedSections: [],
      insertedCount: 1,
      skippedTitles: [],
    });
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

    expect(mockBuildOutline).toHaveBeenCalledWith(
      expect.objectContaining({ customDocuments: mockState.allDocs.allFreeFormDocs }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(updateItemList([customItem]));
    expect(mockDispatch).toHaveBeenCalledWith(
      upsertItemInAllItemsList({ ...customItem, listId: "" }),
    );
  });

  it("keeps generated scripture items in the Bible library", async () => {
    const bibleItem: ServiceItem = {
      _id: "John 3:16 NKJV",
      name: "John 3:16 NKJV",
      type: "bible",
      listId: "outline-scripture-1",
    };
    mockBuildOutline.mockResolvedValue({
      items: [bibleItem],
      updatedSections: [],
      insertedCount: 1,
      skippedTitles: [],
    });
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
    mockBuildOutline.mockResolvedValue({
      items: [customDocumentReference],
      updatedSections: [],
      insertedCount: 1,
      skippedTitles: [],
    });
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
    mockBuildOutline.mockResolvedValue({
      items: [customItem],
      updatedSections: [],
      insertedCount: 1,
      skippedTitles: [],
    });
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
});
