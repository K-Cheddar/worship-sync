import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import type { ServiceItem } from "../../types";
import type { ServicePlan } from "../../types/servicePlan";
import { plainTextToRichText } from "../../types/richText";
import { upsertItemInAllItemsList } from "../../store/allItemsSlice";
import { updateItemList } from "../../store/itemListSlice";
import { selectSongLibrary } from "../../store/songLibrarySelectors";
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
  placeServicePlanOutlineItem: (...args: Parameters<typeof import("./servicePlanOutlineBridge").placeServicePlanOutlineItem>) =>
    jest.requireActual<typeof import("./servicePlanOutlineBridge")>("./servicePlanOutlineBridge").placeServicePlanOutlineItem(...args),
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

  it("continues multiple scripture steps when indexing refreshes the library during a run", async () => {
    const first: ServiceItem = { _id: "psalm", name: "Psalms 105 NIV", type: "bible", listId: "psalm-link" };
    const second: ServiceItem = { _id: "john", name: "John 3:16-18 NKJV", type: "bible", listId: "john-link" };
    setPlannedItems([first, second]);
    const db = {} as PouchDB.Database;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ControllerInfoContext.Provider value={{ db } as never}>{children}</ControllerInfoContext.Provider>
    );
    const { result, rerender } = renderHook(() => useServicePlanOutlinePush(), { wrapper });
    let resume!: () => void;
    const indexed = new Promise<void>((resolve) => { resume = resolve; });
    const onAdded = jest.fn((item: ServiceItem) => item.listId === first.listId ? indexed : undefined);
    let pending!: ReturnType<typeof result.current.pushPlanToOutline>;
    await act(async () => {
      pending = result.current.pushPlanToOutline({} as ServicePlan, () => true, onAdded);
    });
    expect(mockDispatch).toHaveBeenCalledWith(upsertItemInAllItemsList({ ...first, listId: "" }));
    // Reproduce the allItems update from Bible indexing and its selector refresh.
    mockState.allItems.list = [{ ...first, listId: "" }];
    // This test harness mutates one state object; real Redux supplies a new
    // root, so invalidate the argument cache to reproduce its recomputation.
    selectSongLibrary.clearCache();
    rerender();
    await act(async () => {
      resume();
      expect((await pending).insertedCount).toBe(2);
    });
    expect(mockState.undoable.present.itemList.list).toEqual([worshipHeading, first, second]);
    expect(onAdded).toHaveBeenCalledTimes(2);
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

  it("rejects outline insertion when the saved plan becomes untrusted before the item is committed", async () => {
    const song: ServiceItem = { _id: "song-1", name: "Song", type: "song", listId: "song-link" };
    setPlannedItems([song]);
    let planIsTrusted = true;
    mockBuildItem.mockImplementationOnce(async () => {
      planIsTrusted = false;
      return song;
    });
    const { result } = renderHook(() => useServicePlanOutlinePush());

    await expect(
      result.current.pushPlanToOutline({} as ServicePlan, () => planIsTrusted),
    ).rejects.toThrow(
      "The selected service plan changed or could not be verified. Refresh it before syncing.",
    );

    expect(mockBuildItem).toHaveBeenCalledTimes(1);
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: updateItemList.type }),
    );
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

  it("appends and reports a heading removed while an item is being built", async () => {
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

    expect(mockDispatch).toHaveBeenCalledWith(updateItemList([song]));
    expect(response?.insertedCount).toBe(1);
    expect(response?.placementFallbacks).toEqual([{
      sectionName: "Worship",
      headingName: "Worship",
      reason: "heading-removed",
      listId: song.listId,
      title: song.name,
    }]);
  });

  it("appends missing mapped headings in order, reports committed fallbacks, and does not duplicate on retry", async () => {
    const song: ServiceItem = { _id: "song", listId: "library", name: "Song", type: "song" };
    const bridge = jest.requireActual<typeof import("./servicePlanOutlineBridge")>("./servicePlanOutlineBridge");
    mockPlanOutline.mockImplementation((args) => bridge.planServicePlanOutlineItems({ ...args, songs: [song] }));
    mockBuildItem.mockImplementation(bridge.buildServicePlanOutlineItem);
    const sectionRules = ["Praise & Prayer", "Praise & Worship"].map((name, index) => ({ id: `rule-${index}`, matchSectionName: name, matchMode: "exact" as const, headingName: ["Call to Prayer", "Praise and Worship"][index] }));
    const plan = { sections: sectionRules.map((rule, index) => ({ id: rule.id, name: rule.matchSectionName, elements: [{
      id: `element-${index}`, type: "song", title: plainTextToRichText(song.name),
      songRef: { kind: "library", songId: song._id, songName: song.name },
    }] })) } as ServicePlan;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalInfoContext.Provider value={{ churchIntegrations: { servicePlanning: { sectionRules } } } as never}>{children}</GlobalInfoContext.Provider>
    );
    const { result } = renderHook(() => useServicePlanOutlinePush(), { wrapper });
    const committed = jest.fn((_item, fallback) => {
      expect(mockState.undoable.present.itemList.list.some((item) => item.listId === fallback.listId)).toBe(true);
    });
    await act(async () => {
      const first = await result.current.pushPlanToOutline(plan, () => true, committed);
      expect(first.insertedCount).toBe(2);
      expect(first.skippedTitles).toEqual([]);
      expect(first.placementFallbacks.map((fallback) => fallback.headingName)).toEqual(["Call to Prayer", "Praise and Worship"]);
      const repeated = await result.current.pushPlanToOutline(plan);
      expect(repeated.insertedCount).toBe(0);
      expect(repeated.placementFallbacks).toEqual([]);
    });
    expect(committed).toHaveBeenCalledTimes(2);
    expect(mockState.undoable.present.itemList.list.map((item) => item.listId)).toEqual([
      worshipHeading.listId, "element-0::attachment:legacy-song-0-library", "element-1::attachment:legacy-song-0-library",
    ]);
  });

  it.each(["outline", "database", "unmount"])("does not append or report a pending fallback after a %s context change", async (change) => {
    const song: ServiceItem = { _id: "song", name: "Song", type: "song", listId: "song-link" };
    setPlannedItems([song]);
    let finish!: (item: ServiceItem) => void;
    mockBuildItem.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    let db = {} as PouchDB.Database;
    const wrapper = ({ children }: { children: ReactNode }) => <ControllerInfoContext.Provider value={{ db } as never}>{children}</ControllerInfoContext.Provider>;
    const { result, rerender, unmount } = renderHook(() => useServicePlanOutlinePush(), { wrapper });
    const onAdded = jest.fn();
    let pending!: ReturnType<typeof result.current.pushPlanToOutline>;
    await act(async () => { pending = result.current.pushPlanToOutline({} as ServicePlan, () => true, onAdded); });
    // The destination disappears during the build; a new owner must never receive its fallback.
    mockState.undoable.present.itemList.list = [];
    if (change === "outline") mockState.undoable.present.itemLists.selectedList = { _id: "outline-2", name: "Other" };
    else if (change === "database") db = {} as PouchDB.Database; // Same outline ID under a different database.
    if (change === "unmount") unmount();
    else rerender();
    await act(async () => {
      finish(song);
      await expect(pending).rejects.toThrow("The selected outline changed");
    });
    expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: updateItemList.type }));
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("finishes the active fallback on stop, leaves later items untouched, and retries without duplication", async () => {
    const song: ServiceItem = { _id: "song", name: "Song", type: "song", listId: "song-link" };
    const next = { ...song, listId: "next-link" };
    setPlannedItems([song, next]);
    mockState.undoable.present.itemList.list = [];
    let finish!: (item: ServiceItem) => void;
    mockBuildItem.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useServicePlanOutlinePush());
    const onAdded = jest.fn();
    let shouldContinue = true;
    let pending!: ReturnType<typeof result.current.pushPlanToOutline>;
    await act(async () => { pending = result.current.pushPlanToOutline({} as ServicePlan, () => true, onAdded, () => shouldContinue); });
    shouldContinue = false;
    await act(async () => {
      finish(song);
      const response = await pending;
      expect(response.insertedCount).toBe(1);
      expect(response.placementFallbacks).toHaveLength(1);
    });
    expect(mockBuildItem).toHaveBeenCalledTimes(1);
    await act(async () => {
      const retry = await result.current.pushPlanToOutline({} as ServicePlan);
      expect(retry.insertedCount).toBe(1);
    });
    expect(mockState.undoable.present.itemList.list).toEqual([song, next]);
  });

  it("does not report a fallback when another insertion wins during the build", async () => {
    const song: ServiceItem = { _id: "song", name: "Song", type: "song", listId: "song-link" };
    setPlannedItems([song]);
    mockBuildItem.mockImplementation(async () => {
      mockState.undoable.present.itemList.list = [song];
      return song;
    });
    const onAdded = jest.fn();
    const { result } = renderHook(() => useServicePlanOutlinePush());
    await act(async () => {
      const response = await result.current.pushPlanToOutline({} as ServicePlan, () => true, onAdded);
      expect(response.insertedCount).toBe(0);
      expect(response.placementFallbacks).toEqual([]);
    });
    expect(onAdded).not.toHaveBeenCalled();
    expect(mockState.undoable.present.itemList.list).toEqual([song]);
  });
});
