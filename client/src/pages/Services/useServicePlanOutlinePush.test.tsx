import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import type { ServiceItem } from "../../types";
import type { ServicePlan } from "../../types/servicePlan";
import { plainTextToRichText } from "../../types/richText";
import { upsertItemInAllItemsList } from "../../store/allItemsSlice";
import { updateItemList } from "../../store/itemListSlice";
import { useServicePlanOutlinePush } from "./useServicePlanOutlinePush";
import { buildServicePlanOutlineItem, planServicePlanOutlineItems } from "./servicePlanOutlineBridge";

const mockDispatch = jest.fn();
const worshipHeading: ServiceItem = {
  _id: "heading-worship",
  name: "Worship",
  type: "heading",
  listId: "heading-worship-list",
};
const mockState = {
  allItems: { list: [] as ServiceItem[], isAllItemsLoading: false },
  allDocs: {
    allSongDocs: [],
    allFreeFormDocs: [{ _id: "custom-doc-1", name: "Welcome Slides", type: "free" }],
  },
  undoable: {
    present: {
      itemList: { list: [worshipHeading] },
      itemLists: { selectedList: { _id: "outline-1", name: "Sunday" } },
    },
  },
};

mockDispatch.mockImplementation((action: { type: string; payload?: unknown }) => {
  if (action.type === updateItemList.type && Array.isArray(action.payload)) {
    mockState.undoable.present.itemList.list = action.payload as ServiceItem[];
  }
});

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
  insertServicePlanOutlineItem: (...args: Parameters<typeof import("./servicePlanOutlineBridge").insertServicePlanOutlineItem>) =>
    jest.requireActual<typeof import("./servicePlanOutlineBridge")>("./servicePlanOutlineBridge").insertServicePlanOutlineItem(...args),
}));

const mockBuildItem = jest.mocked(buildServicePlanOutlineItem);
const mockPlanOutline = jest.mocked(planServicePlanOutlineItems);

const setPlannedItems = (items: ServiceItem[], skippedTitles: string[] = []) => {
  mockPlanOutline.mockReturnValue({
    steps: items.map((item) => ({
      planned: { listId: item.listId, kind: "song", songId: item._id, songName: item.name },
      element: { element: { id: item.listId, title: { blocks: [] }, type: "song" }, title: item.name, planned: [], hasUnresolvedAttachment: false },
      sectionName: "Worship",
      destination: { kind: "heading", listId: worshipHeading.listId, name: worshipHeading.name },
    }) as never),
    skippedTitles,
    placementIssues: [],
  });
  mockBuildItem.mockImplementation(async ({ step }) => items.find((item) => item.listId === step.planned.listId)!);
};

describe("useServicePlanOutlinePush", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.undoable.present.itemList.list = [worshipHeading];
    mockState.undoable.present.itemLists.selectedList = { _id: "outline-1", name: "Sunday" };
    mockState.allItems.list = [];
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

    expect(mockDispatch).toHaveBeenCalledWith(updateItemList([worshipHeading, customDocumentReference]));
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
    expect(insertedLists.map((action) => action.payload[action.payload.length - 1].name)).toEqual(["Song", "Psalm 95 NIV"]);
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
    expect(mockDispatch).toHaveBeenCalledWith(updateItemList([worshipHeading, song]));
  });

  it("passes a run-level snapshot of configured section rules into the planner", async () => {
    setPlannedItems([]);
    const sectionRules = [{
      id: "rule-worship",
      matchSectionName: "Worship",
      matchMode: "exact" as const,
      headingName: "Praise & Worship",
    }];
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={{
        churchIntegrations: { servicePlanning: { sectionRules } },
      } as never}>
        {children}
      </GlobalInfoContext.Provider>
    );
    const { result } = renderHook(() => useServicePlanOutlinePush(), { wrapper });

    await act(async () => {
      await result.current.pushPlanToOutline({} as ServicePlan);
    });

    expect(mockPlanOutline).toHaveBeenCalledWith(expect.objectContaining({
      sectionRules,
    }));
  });

  it("inserts at the end of the resolved section before the next heading", async () => {
    const song: ServiceItem = { _id: "song-1", name: "Song", type: "song", listId: "song-link" };
    setPlannedItems([song]);
    const nextHeading: ServiceItem = { _id: "message", name: "Message", type: "heading", listId: "heading-message" };
    const existing: ServiceItem = { _id: "existing", name: "Existing", type: "song", listId: "existing" };
    mockState.undoable.present.itemList.list = [worshipHeading, existing, nextHeading];
    const { result } = renderHook(() => useServicePlanOutlinePush());

    await act(async () => {
      await result.current.pushPlanToOutline({} as ServicePlan);
    });

    expect(mockDispatch).toHaveBeenCalledWith(updateItemList([worshipHeading, existing, song, nextHeading]));
  });

  it("plans the first sync from the current Redux outline when the rendered list is stale", async () => {
    const song: ServiceItem = { _id: "song-1", name: "Welcome song", type: "song", listId: "library-song-1" };
    mockState.allItems.list = [song];
    const welcomeHeading: ServiceItem = { _id: "heading-welcome", name: "Welcome", type: "heading", listId: "heading-welcome" };
    const nextHeading: ServiceItem = { _id: "praise", name: "Praise & Worship", type: "heading", listId: "heading-praise" };
    const existing: ServiceItem = { _id: "existing", name: "Existing", type: "song", listId: "existing" };
    const latestList = [welcomeHeading, existing, nextHeading];
    const { result } = renderHook(() => useServicePlanOutlinePush());
    // Redux advances before React renders again; the hook's captured selector value is stale.
    mockState.undoable.present.itemList.list = latestList;
    const bridge = jest.requireActual<typeof import("./servicePlanOutlineBridge")>("./servicePlanOutlineBridge");
    mockPlanOutline.mockImplementation((args) => bridge.planServicePlanOutlineItems({ ...args, songs: [song] }));
    mockBuildItem.mockImplementation((args) => bridge.buildServicePlanOutlineItem(args));
    const plan = {
      sections: [{
        id: "section-welcome",
        name: "Welcome",
        elements: [{
          id: "el-welcome",
          type: "song",
          title: plainTextToRichText("Welcome song"),
          songRef: { kind: "library", songId: song._id, songName: song.name },
        }],
      }],
    } as ServicePlan;

    await act(async () => {
      await result.current.pushPlanToOutline(plan);
    });

    expect(mockPlanOutline).toHaveBeenCalledWith(expect.objectContaining({ currentList: latestList }));
    expect(mockDispatch).toHaveBeenCalledWith(updateItemList([welcomeHeading, existing, expect.objectContaining({ listId: "el-welcome::attachment:legacy-song-0-library" }), nextHeading]));
  });

  it("rejects a captured push when Redux switches outlines before React rerenders", async () => {
    const song: ServiceItem = { _id: "song-1", name: "Song", type: "song", listId: "song-link" };
    setPlannedItems([song]);
    const { result } = renderHook(() => useServicePlanOutlinePush());
    const previouslyCapturedPush = result.current.pushPlanToOutline;
    mockState.undoable.present.itemLists.selectedList = { _id: "outline-2", name: "Other outline" };
    mockState.undoable.present.itemList.list = [
      { _id: "other-heading", name: "Other", type: "heading", listId: "other-heading" },
    ];

    await expect(previouslyCapturedPush({} as ServicePlan)).rejects.toThrow(
      "The selected outline changed before the service plan could be imported.",
    );

    expect(mockPlanOutline).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: updateItemList.type }));
  });

  it("appends unmatched sections at the absolute outline end in plan order", async () => {
    const firstSong: ServiceItem = { _id: "song-first", name: "Video intro", type: "song", listId: "library-first" };
    const secondSong: ServiceItem = { _id: "song-second", name: "Feature song", type: "song", listId: "library-second" };
    mockState.allItems.list = [firstSong, secondSong];
    const trailingItem: ServiceItem = { _id: "existing", name: "Existing tail", type: "song", listId: "existing" };
    mockState.undoable.present.itemList.list = [worshipHeading, trailingItem];
    const { result } = renderHook(() => useServicePlanOutlinePush());
    const bridge = jest.requireActual<typeof import("./servicePlanOutlineBridge")>("./servicePlanOutlineBridge");
    mockPlanOutline.mockImplementation((args) => bridge.planServicePlanOutlineItems({ ...args, songs: [firstSong, secondSong] }));
    mockBuildItem.mockImplementation((args) => bridge.buildServicePlanOutlineItem(args));
    const plan = {
      sections: [
        {
          id: "section-special-feature",
          name: "Special Feature",
          elements: [{
            id: "el-video-intro",
            type: "song",
            title: plainTextToRichText(firstSong.name),
            songRef: { kind: "library", songId: firstSong._id, songName: firstSong.name },
          }],
        },
        {
          id: "section-feature-song",
          name: "Feature Song",
          elements: [{
            id: "el-feature-song",
            type: "song",
            title: plainTextToRichText(secondSong.name),
            songRef: { kind: "library", songId: secondSong._id, songName: secondSong.name },
          }],
        },
      ],
    } as ServicePlan;

    await act(async () => {
      await result.current.pushPlanToOutline(plan);
    });

    expect(mockDispatch).toHaveBeenCalledWith(updateItemList([
      worshipHeading,
      trailingItem,
      expect.objectContaining({ _id: firstSong._id }),
    ]));
    expect(mockDispatch).toHaveBeenCalledWith(updateItemList([
      worshipHeading,
      trailingItem,
      expect.objectContaining({ _id: firstSong._id }),
      expect.objectContaining({ _id: secondSong._id }),
    ]));
    expect(mockState.undoable.present.itemList.list.map((item) => item.name)).toEqual([
      "Worship",
      "Existing tail",
      "Video intro",
      "Feature song",
    ]);
  });

  it("places scripture and custom-document references under the same heading", async () => {
    const scripture: ServiceItem = { _id: "bible-1", name: "John 3:16 NIV", type: "bible", listId: "scripture-link" };
    const document: ServiceItem = { _id: "document-1", name: "Welcome Slides", type: "free", listId: "document-link" };
    setPlannedItems([scripture, document]);
    const nextHeading: ServiceItem = { _id: "message", name: "Message", type: "heading", listId: "heading-message" };
    const existing: ServiceItem = { _id: "existing", name: "Existing", type: "song", listId: "existing" };
    mockState.undoable.present.itemList.list = [worshipHeading, existing, nextHeading];
    const { result } = renderHook(() => useServicePlanOutlinePush());

    await act(async () => {
      await result.current.pushPlanToOutline({} as ServicePlan);
    });

    expect(mockDispatch).toHaveBeenCalledWith(updateItemList([
      worshipHeading,
      existing,
      scripture,
      nextHeading,
    ]));
    expect(mockDispatch).toHaveBeenCalledWith(updateItemList([
      worshipHeading,
      existing,
      scripture,
      document,
      nextHeading,
    ]));
  });

  it("skips and reports a heading removed while an item is being built", async () => {
    const song: ServiceItem = { _id: "song-1", name: "Song", type: "song", listId: "song-link" };
    setPlannedItems([song]);
    mockBuildItem.mockImplementation(async () => {
      mockState.undoable.present.itemList.list = [];
      return song;
    });
    const { result } = renderHook(() => useServicePlanOutlinePush());
    let response: Awaited<ReturnType<typeof result.current.pushPlanToOutline>> | undefined;

    await act(async () => {
      response = await result.current.pushPlanToOutline({} as ServicePlan);
    });

    expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: updateItemList.type }));
    expect(response?.placementIssues).toEqual([{
      sectionName: "Worship",
      headingName: "Worship",
      reason: "heading-removed",
    }]);
  });
});
