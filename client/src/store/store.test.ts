const flushListenerEffects = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const waitForListenerDelay = async (ms = 30) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await flushListenerEffects();
};

const createScreenSlide = (id: string, words: string) => ({
  id,
  name: id,
  type: "Verse",
  boxes: [{ words }],
});

const createScreenPresentation = (
  displayType: "projector" | "monitor" | "stream",
  time: number,
  overrides: Record<string, unknown> = {},
) => ({
  displayType,
  name: `${displayType}-presentation`,
  type: "slide",
  slide: createScreenSlide(
    `${displayType}-slide-${time}`,
    `${displayType}-${time}`,
  ),
  time,
  ...overrides,
});

const loadStoreWithPresentationSync = () => {
  let storeModule: any;
  let presentationSliceModule: any;
  const setMock = jest.fn();
  const refMock = jest.fn((_db: unknown, path: string) => path);

  jest.isolateModules(() => {
    jest.doMock("../context/controllerInfo", () => ({
      globalDb: undefined,
      globalBroadcastRef: undefined,
    }));
    jest.doMock("../context/globalInfo", () => ({
      globalFireDbInfo: {
        db: "firebase-db",
        database: "main",
        churchId: "church-main",
      },
      globalHostId: "host-123",
    }));
    jest.doMock("firebase/database", () => ({
      ref: refMock,
      set: setMock,
      get: jest.fn(),
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    storeModule = require("./store");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    presentationSliceModule = require("./presentationSlice");
  });

  return {
    store: storeModule.default,
    writePresentationSnapshotToFirebase:
      storeModule.writePresentationSnapshotToFirebase,
    presentationSlice: presentationSliceModule.presentationSlice,
    setMock,
    refMock,
  };
};

const createOverlay = (id: string, name: string) => ({
  id,
  type: "participant" as const,
  name,
  duration: 7,
  imageUrl: "",
  heading: "",
  subHeading: "",
  event: "",
  title: "",
  url: "",
  description: "",
  formatting: {},
});

const defaultShouldSendTo = {
  projector: true,
  monitor: true,
  stream: true,
};

const createSongDoc = (overrides: Record<string, unknown> = {}) => ({
  _id: "song-1",
  type: "song",
  name: "Song 1",
  selectedArrangement: 0,
  background: "background-a.jpg",
  arrangements: [],
  slides: [],
  shouldSendTo: defaultShouldSendTo,
  ...overrides,
});

const createTimerItem = (overrides: Record<string, unknown> = {}) => ({
  _id: "timer-item",
  type: "timer",
  name: "Countdown",
  selectedArrangement: 0,
  background: "",
  arrangements: [],
  slides: [
    {
      id: "timer-slide",
      name: "Countdown",
      type: "Timer",
      boxes: [{}, { words: "{{timer}}" }],
    },
    {
      id: "wrap-up-slide",
      name: "Wrap Up",
      type: "Timer",
      boxes: [{}, { words: "Thanks for joining" }],
    },
  ],
  timerInfo: {
    id: "timer-1",
    hostId: "host-123",
    name: "Countdown",
    timerType: "timer",
    status: "stopped",
    isActive: false,
    countdownTime: "00:05",
    duration: 5,
    remainingTime: 0,
    endTime: new Date(0).toISOString(),
    showMinutesOnly: false,
  },
  shouldSendTo: defaultShouldSendTo,
  ...overrides,
});

describe("store module", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.resetModules();
    jest.clearAllMocks();
    localStorage.clear();
  });

  it("broadcastCreditsUpdate posts docs with hostId when broadcast channel exists", () => {
    const postMessage = jest.fn();

    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: { postMessage },
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: { db: undefined, database: undefined },
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { broadcastCreditsUpdate } = require("./store");
      broadcastCreditsUpdate([{ _id: "credit-1" }]);
    });

    expect(postMessage).toHaveBeenCalledWith({
      type: "update",
      data: { docs: [{ _id: "credit-1" }], hostId: "host-123" },
    });
  });

  it("broadcastCreditsUpdate is a no-op when no broadcast channel exists", () => {
    const postMessage = jest.fn();

    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: { db: undefined, database: undefined },
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { broadcastCreditsUpdate } = require("./store");
      broadcastCreditsUpdate([{ _id: "credit-1" }]);
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("marks initialization complete on page-ready and resets on RESET_INITIALIZATION", () => {
    jest.useFakeTimers();

    jest.isolateModules(() => {
      const clearHistory = jest.fn(() => ({ type: "TEST_CLEAR_HISTORY" }));
      jest.doMock("redux-undo", () => {
        const actual = jest.requireActual("redux-undo");
        return {
          __esModule: true,
          ...actual,
          ActionCreators: { clearHistory },
        };
      });
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: { db: undefined, database: undefined },
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const storeModule = require("./store");
      const store = storeModule.default;

      expect(storeModule.hasFinishedInitialization).toBe(false);

      store.dispatch({ type: storeModule.CREDITS_EDITOR_PAGE_READY });
      jest.runAllTimers();

      expect(storeModule.hasFinishedInitialization).toBe(true);
      expect(clearHistory).toHaveBeenCalledTimes(1);

      store.dispatch({ type: "RESET_INITIALIZATION" });
      expect(storeModule.hasFinishedInitialization).toBe(false);
    });
  });

  it("does not write empty published credits to RTDB when store RESET runs", () => {
    let setMock: jest.Mock;

    jest.isolateModules(() => {
      setMock = jest.fn();
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: {
          db: "firebase-db",
          database: "main",
          churchId: "church-test",
        },
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn((_db: unknown, path: string) => path),
        set: setMock,
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initiateItemLists } = require("./itemListsSlice");
      const store = storeModule.default;

      store.dispatch(
        initiateItemLists([{ _id: "outline-a", name: "Service A" }]),
      );
      setMock.mockClear();

      store.dispatch({ type: "RESET" });
    });

    const clearedPublishedList = setMock!.mock.calls.some(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes("publishedList") &&
        Array.isArray(call[1]) &&
        call[1].length === 0,
    );
    expect(clearedPublishedList).toBe(false);
  });

  it("fallback initialization completes when credits slice becomes initialized", () => {
    jest.useFakeTimers();

    jest.isolateModules(() => {
      const clearHistory = jest.fn(() => ({ type: "TEST_CLEAR_HISTORY" }));
      jest.doMock("redux-undo", () => {
        const actual = jest.requireActual("redux-undo");
        return {
          __esModule: true,
          ...actual,
          ActionCreators: { clearHistory },
        };
      });
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: undefined,
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initiateCreditsList } = require("./creditsSlice");
      const store = storeModule.default;

      expect(storeModule.hasFinishedInitialization).toBe(false);

      store.dispatch(initiateCreditsList([]));
      jest.runAllTimers();

      expect(storeModule.hasFinishedInitialization).toBe(true);
      expect(clearHistory).toHaveBeenCalledTimes(1);
    });
  });

  it("clears transient item loading flags after undo restores a prior item snapshot", async () => {
    jest.useFakeTimers();

    let storeModule: any;
    let itemSliceModule: any;
    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: { db: undefined, database: undefined },
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      itemSliceModule = require("./itemSlice");
    });

    const store = storeModule.default;
    const { itemSlice } = itemSliceModule;

    store.dispatch({ type: storeModule.CREDITS_EDITOR_PAGE_READY });
    jest.runAllTimers();

    store.dispatch(
      itemSlice.actions.setActiveItem({
        name: "Original Name",
        _id: "item-b",
        type: "song",
        selectedArrangement: 0,
        selectedSlide: 0,
        selectedBox: 1,
        arrangements: [],
        slides: [],
        shouldSendTo: {
          projector: true,
          monitor: true,
          stream: true,
        },
      }),
    );
    store.dispatch(itemSlice.actions.setItemIsLoading(true));
    store.dispatch(itemSlice.actions._setName("Edited Name"));
    store.dispatch(itemSlice.actions.setItemIsLoading(false));

    expect(store.getState().undoable.past).toHaveLength(1);

    store.dispatch({ type: "@@redux-undo/UNDO" });
    await Promise.resolve();

    const state = store.getState().undoable.present.item;
    expect(state._id).toBe("item-b");
    expect(state.name).toBe("Original Name");
    expect(state.isLoading).toBe(false);
    expect(state.isSectionLoading).toBe(false);
  });

  it("preserves slide selection but clears background-target UI on item undo/redo", async () => {
    jest.useFakeTimers();

    let storeModule: any;
    let itemSliceModule: any;
    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: { db: undefined, database: undefined },
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      itemSliceModule = require("./itemSlice");
    });

    const store = storeModule.default;
    const { itemSlice } = itemSliceModule;

    store.dispatch({ type: storeModule.CREDITS_EDITOR_PAGE_READY });
    jest.runAllTimers();

    const slides = [
      { id: "s1", name: "V1", type: "Verse", boxes: [{ words: "a" }] },
      { id: "s2", name: "C", type: "Chorus", boxes: [{ words: "b" }] },
      { id: "s3", name: "V2", type: "Verse", boxes: [{ words: "c" }] },
    ];
    store.dispatch(
      itemSlice.actions.setActiveItem({
        ...createSongDoc(),
        arrangements: [{ name: "A", slides }],
        slides: [],
      }),
    );
    store.dispatch(itemSlice.actions._setName("Edited Name"));
    store.dispatch(itemSlice.actions.setSelectedSlide(2));
    store.dispatch(itemSlice.actions.toggleBackgroundTargetSlideId("s2"));
    store.dispatch(itemSlice.actions.setBackgroundTargetRangeAnchorId("s1"));
    store.dispatch(itemSlice.actions.setMobileBackgroundTargetSelectMode(true));

    expect(store.getState().undoable.past).toHaveLength(1);

    store.dispatch({ type: "@@redux-undo/UNDO" });
    await Promise.resolve();

    let item = store.getState().undoable.present.item;
    expect(item.name).toBe("Song 1");
    expect(item.selectedSlide).toBe(2);
    expect(item.backgroundTargetSlideIds).toEqual([]);
    expect(item.backgroundTargetRangeAnchorId).toBeNull();
    expect(item.mobileBackgroundTargetSelectMode).toBe(false);

    store.dispatch({ type: "@@redux-undo/REDO" });
    await Promise.resolve();

    item = store.getState().undoable.present.item;
    expect(item.name).toBe("Edited Name");
    expect(item.selectedSlide).toBe(2);
    expect(item.backgroundTargetSlideIds).toEqual([]);
    expect(item.backgroundTargetRangeAnchorId).toBeNull();
    expect(item.mobileBackgroundTargetSelectMode).toBe(false);
  });

  it("keeps overlay undo focused on the overlay whose edit was undone", async () => {
    jest.useFakeTimers();

    let storeModule: any;
    let overlaySliceModule: any;
    let overlaysSliceModule: any;
    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: undefined,
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      overlaySliceModule = require("./overlaySlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      overlaysSliceModule = require("./overlaysSlice");
    });

    const store = storeModule.default;
    const { overlaySlice } = overlaySliceModule;
    const { overlaysSlice } = overlaysSliceModule;

    const overlayA = createOverlay("overlay-a", "Alpha");
    const overlayB = createOverlay("overlay-b", "Beta");

    store.dispatch({ type: storeModule.CREDITS_EDITOR_PAGE_READY });
    jest.runAllTimers();

    store.dispatch(
      overlaysSlice.actions.initiateOverlayList([overlayA, overlayB]),
    );
    store.dispatch({ type: "@@redux-undo/CLEAR_HISTORY" });
    store.dispatch(overlaySlice.actions.selectOverlay(overlayA));

    jest.setSystemTime(1000);
    store.dispatch(
      overlaySlice.actions.updateOverlay({ ...overlayA, name: "Alpha 1" }),
    );
    store.dispatch(
      overlaysSlice.actions.updateOverlayInList({
        ...overlayA,
        name: "Alpha 1",
      }),
    );

    store.dispatch(overlaySlice.actions.selectOverlay(overlayB));

    jest.setSystemTime(2000);
    store.dispatch(
      overlaySlice.actions.updateOverlay({ ...overlayB, name: "Beta 1" }),
    );
    store.dispatch(
      overlaysSlice.actions.updateOverlayInList({
        ...overlayB,
        name: "Beta 1",
      }),
    );

    store.dispatch({ type: "@@redux-undo/UNDO" });
    await flushListenerEffects();

    let state = store.getState().undoable.present;
    expect(state.overlay.selectedOverlay).toEqual(
      expect.objectContaining({ id: "overlay-b", name: "Beta" }),
    );
    expect(state.overlays.list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "overlay-a", name: "Alpha 1" }),
        expect.objectContaining({ id: "overlay-b", name: "Beta" }),
      ]),
    );

    store.dispatch({ type: "@@redux-undo/UNDO" });
    await flushListenerEffects();

    state = store.getState().undoable.present;
    expect(state.overlay.selectedOverlay).toEqual(
      expect.objectContaining({ id: "overlay-a", name: "Alpha" }),
    );
    expect(state.overlays.list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "overlay-a", name: "Alpha" }),
        expect.objectContaining({ id: "overlay-b", name: "Beta" }),
      ]),
    );

    store.dispatch({ type: "@@redux-undo/REDO" });
    await flushListenerEffects();

    state = store.getState().undoable.present;
    expect(state.overlay.selectedOverlay).toEqual(
      expect.objectContaining({ id: "overlay-a", name: "Alpha 1" }),
    );
    expect(state.overlays.list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "overlay-a", name: "Alpha 1" }),
        expect.objectContaining({ id: "overlay-b", name: "Beta" }),
      ]),
    );

    store.dispatch({ type: "@@redux-undo/REDO" });
    await flushListenerEffects();

    state = store.getState().undoable.present;
    expect(state.overlay.selectedOverlay).toEqual(
      expect.objectContaining({ id: "overlay-b", name: "Beta 1" }),
    );
    expect(state.overlays.list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "overlay-a", name: "Alpha 1" }),
        expect.objectContaining({ id: "overlay-b", name: "Beta 1" }),
      ]),
    );
  });

  it("restores selection on undo after deleting an overlay and clears it on redo", async () => {
    jest.useFakeTimers();

    let storeModule: any;
    let overlaySliceModule: any;
    let overlaysSliceModule: any;
    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: undefined,
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      overlaySliceModule = require("./overlaySlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      overlaysSliceModule = require("./overlaysSlice");
    });

    const store = storeModule.default;
    const { overlaySlice } = overlaySliceModule;
    const { overlaysSlice } = overlaysSliceModule;

    const overlayA = createOverlay("overlay-a", "Alpha");
    const overlayB = createOverlay("overlay-b", "Beta");

    store.dispatch({ type: storeModule.CREDITS_EDITOR_PAGE_READY });
    jest.runAllTimers();

    store.dispatch(
      overlaysSlice.actions.initiateOverlayList([overlayA, overlayB]),
    );
    store.dispatch({ type: "@@redux-undo/CLEAR_HISTORY" });
    store.dispatch(overlaySlice.actions.selectOverlay(overlayB));

    jest.setSystemTime(1000);
    store.dispatch(overlaysSlice.actions.deleteOverlayFromList("overlay-b"));
    store.dispatch(overlaySlice.actions.deleteOverlay("overlay-b"));

    store.dispatch({ type: "@@redux-undo/UNDO" });
    await flushListenerEffects();

    let state = store.getState().undoable.present;
    expect(state.overlay.selectedOverlay).toEqual(
      expect.objectContaining({ id: "overlay-b", name: "Beta" }),
    );
    expect(state.overlays.list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "overlay-a" }),
        expect.objectContaining({ id: "overlay-b" }),
      ]),
    );

    store.dispatch({ type: "@@redux-undo/REDO" });
    await flushListenerEffects();

    state = store.getState().undoable.present;
    expect(state.overlay.selectedOverlay).toBeUndefined();
    expect(state.overlays.list).toEqual([
      expect.objectContaining({ id: "overlay-a", name: "Alpha" }),
    ]);
  });

  it("clears overlay pending-update after deleting the currently selected overlay", async () => {
    jest.useFakeTimers();

    let storeModule: any;
    let overlaySliceModule: any;
    let overlaysSliceModule: any;
    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: undefined,
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      overlaySliceModule = require("./overlaySlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      overlaysSliceModule = require("./overlaysSlice");
    });

    const store = storeModule.default;
    const { overlaySlice } = overlaySliceModule;
    const { overlaysSlice } = overlaysSliceModule;

    const overlayA = createOverlay("overlay-a", "Alpha");
    const overlayB = createOverlay("overlay-b", "Beta");

    store.dispatch({ type: storeModule.CREDITS_EDITOR_PAGE_READY });
    jest.runAllTimers();

    store.dispatch(
      overlaysSlice.actions.initiateOverlayList([overlayA, overlayB]),
    );
    store.dispatch(overlaySlice.actions.selectOverlay(overlayB));
    store.dispatch(overlaysSlice.actions.deleteOverlayFromList("overlay-b"));
    store.dispatch(overlaySlice.actions.deleteOverlay("overlay-b"));

    jest.runAllTimers();
    await flushListenerEffects();

    const state = store.getState().undoable.present.overlay;
    expect(state.selectedOverlay).toBeUndefined();
    expect(state.hasPendingUpdate).toBe(false);
  });

  it("keeps the selected overlay current when undoing a multi-overlay formatting change", async () => {
    jest.useFakeTimers();

    let storeModule: any;
    let overlaySliceModule: any;
    let overlaysSliceModule: any;
    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: undefined,
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      overlaySliceModule = require("./overlaySlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      overlaysSliceModule = require("./overlaysSlice");
    });

    const store = storeModule.default;
    const { overlaySlice } = overlaySliceModule;
    const { overlaysSlice } = overlaysSliceModule;

    const overlayA = createOverlay("overlay-a", "Alpha");
    const overlayB = createOverlay("overlay-b", "Beta");

    store.dispatch({ type: storeModule.CREDITS_EDITOR_PAGE_READY });
    jest.runAllTimers();

    store.dispatch(
      overlaysSlice.actions.initiateOverlayList([overlayA, overlayB]),
    );
    store.dispatch({ type: "@@redux-undo/CLEAR_HISTORY" });
    store.dispatch(overlaySlice.actions.selectOverlay(overlayB));

    const selectedBeforeUpdate =
      store.getState().undoable.present.overlay.selectedOverlay;
    const updatedFormatting = {
      ...selectedBeforeUpdate.formatting,
      backgroundColor: "#123456",
    };

    jest.setSystemTime(1000);
    store.dispatch(
      overlaySlice.actions.updateOverlay({
        ...selectedBeforeUpdate,
        formatting: updatedFormatting,
      }),
    );
    store.dispatch(
      overlaysSlice.actions.updateOverlayInList({
        id: "overlay-a",
        formatting: updatedFormatting,
      }),
    );
    store.dispatch(
      overlaysSlice.actions.updateOverlayInList({
        id: "overlay-b",
        formatting: updatedFormatting,
      }),
    );

    store.dispatch({ type: "@@redux-undo/UNDO" });
    await flushListenerEffects();

    const state = store.getState().undoable.present;
    expect(state.overlay.selectedOverlay).toEqual(
      expect.objectContaining({ id: "overlay-b" }),
    );
    expect(state.overlay.selectedOverlay?.formatting?.backgroundColor).not.toBe(
      "#123456",
    );
    expect(
      state.overlays.list.find((overlay: any) => overlay.id === "overlay-a")
        ?.formatting?.backgroundColor,
    ).not.toBe("#123456");
    expect(
      state.overlays.list.find((overlay: any) => overlay.id === "overlay-b")
        ?.formatting?.backgroundColor,
    ).not.toBe("#123456");
  });

  it("buffers remote item docs instead of applying them while the active item is being edited", async () => {
    let storeModule: any;
    let itemSliceModule: any;
    let allDocsSliceModule: any;

    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: undefined,
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      itemSliceModule = require("./itemSlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      allDocsSliceModule = require("./allDocsSlice");
    });

    const store = storeModule.default;
    const { itemSlice } = itemSliceModule;
    const { allDocsSlice } = allDocsSliceModule;

    const baseDoc = createSongDoc();
    const remoteDoc = createSongDoc({
      name: "Remote Song Update",
      background: "background-b.jpg",
      songMetadata: {
        source: "lrclib",
        lrclibId: 5,
        trackName: "Remote Song Update",
        artistName: "Remote Artist",
        plainLyrics: "Words",
        syncedLyrics: null,
        importedAt: "2026-03-30T12:00:00.000Z",
      },
    });

    store.dispatch(
      itemSlice.actions.setActiveItem({ ...baseDoc, listId: "list-1" }),
    );
    store.dispatch(itemSlice.actions.setIsEditMode(true));
    store.dispatch(allDocsSlice.actions.updateAllSongDocs([remoteDoc]));
    await flushListenerEffects();

    const state = store.getState().undoable.present.item;
    expect(state.name).toBe("Song 1");
    expect(state.background).toBe("background-a.jpg");
    expect(state.hasRemoteUpdate).toBe(true);
    expect(state.pendingRemoteItem).toEqual(
      expect.objectContaining({
        _id: "song-1",
        name: "Remote Song Update",
        background: "background-b.jpg",
      }),
    );
  });

  it("does not buffer when refreshed doc matches local editor state (sync echo)", async () => {
    let storeModule: any;
    let itemSliceModule: any;
    let allDocsSliceModule: any;

    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: undefined,
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      itemSliceModule = require("./itemSlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      allDocsSliceModule = require("./allDocsSlice");
    });

    const store = storeModule.default;
    const { itemSlice } = itemSliceModule;
    const { allDocsSlice } = allDocsSliceModule;

    const baseDoc = createSongDoc();
    const remoteDoc = createSongDoc({
      background: "background-b.jpg",
      _rev: "2-rev",
      updatedAt: "2026-04-01T12:00:00.000Z",
    });

    store.dispatch(
      itemSlice.actions.setActiveItem({ ...baseDoc, listId: "list-1" }),
    );
    store.dispatch(itemSlice.actions.setBackground("background-b.jpg"));
    store.dispatch(allDocsSlice.actions.updateAllSongDocs([remoteDoc]));
    await flushListenerEffects();

    const state = store.getState().undoable.present.item;
    expect(state.background).toBe("background-b.jpg");
    expect(state.hasRemoteUpdate).toBe(false);
    expect(state.pendingRemoteItem).toBeNull();
  });

  it("applies refreshed remote docs immediately when the active item is not dirty", async () => {
    let storeModule: any;
    let itemSliceModule: any;
    let allDocsSliceModule: any;

    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: undefined,
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      itemSliceModule = require("./itemSlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      allDocsSliceModule = require("./allDocsSlice");
    });

    const store = storeModule.default;
    const { itemSlice } = itemSliceModule;
    const { allDocsSlice } = allDocsSliceModule;

    const baseDoc = createSongDoc({
      slides: [{ id: "slide-a", name: "A", type: "Verse", boxes: [] }],
    });
    const remoteDoc = createSongDoc({
      name: "Remote Song Update",
      background: "background-b.jpg",
      songMetadata: {
        source: "lrclib",
        lrclibId: 5,
        trackName: "Remote Song Update",
        artistName: "Remote Artist",
        plainLyrics: "Words",
        syncedLyrics: null,
        importedAt: "2026-03-30T12:00:00.000Z",
      },
      slides: [
        { id: "slide-a", name: "A", type: "Verse", boxes: [] },
        { id: "slide-b", name: "B", type: "Verse", boxes: [] },
      ],
    });

    store.dispatch(
      itemSlice.actions.setActiveItem({
        ...baseDoc,
        listId: "list-1",
        selectedSlide: 0,
        selectedBox: 1,
      }),
    );
    store.dispatch(allDocsSlice.actions.updateAllSongDocs([remoteDoc]));
    await flushListenerEffects();

    const state = store.getState().undoable.present.item;
    expect(state.name).toBe("Remote Song Update");
    expect(state.background).toBe("background-b.jpg");
    expect(state.listId).toBe("list-1");
    expect(state.songMetadata).toEqual(
      expect.objectContaining({
        source: "lrclib",
        lrclibId: 5,
        artistName: "Remote Artist",
      }),
    );
    expect(state.hasRemoteUpdate).toBe(false);
    expect(state.pendingRemoteItem).toBeNull();
  });

  it("switches quick-link monitor timers to the wrap-up slide when they expire", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    let storeModule: any;
    let itemSliceModule: any;
    let timersSliceModule: any;
    let presentationSliceModule: any;

    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: { db: undefined, database: undefined },
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      itemSliceModule = require("./itemSlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      timersSliceModule = require("./timersSlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      presentationSliceModule = require("./presentationSlice");
    });

    const store = storeModule.default;
    const { itemSlice } = itemSliceModule;
    const { timersSlice } = timersSliceModule;
    const { presentationSlice } = presentationSliceModule;

    const timerItem = createTimerItem({ timerInfo: undefined });

    store.dispatch(itemSlice.actions.setActiveItem(timerItem));
    store.dispatch(presentationSlice.actions.toggleMonitorTransmitting());
    store.dispatch(
      presentationSlice.actions.updateMonitor({
        slide: timerItem.slides[0],
        name: "Countdown",
        type: "slide",
        timerId: "timer-1",
        itemId: "timer-item",
        skipTransmissionCheck: true,
      }),
    );
    store.dispatch(
      timersSlice.actions.addTimer({
        id: "timer-1",
        hostId: "host-123",
        name: "Countdown",
        timerType: "timer",
        status: "running",
        isActive: true,
        countdownTime: "00:05",
        duration: 5,
        remainingTime: 5,
        endTime: new Date("2026-01-01T00:00:01.000Z").toISOString(),
        showMinutesOnly: false,
      }),
    );

    jest.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    store.dispatch(timersSlice.actions.tickTimers());
    await flushListenerEffects();

    const timerState = store
      .getState()
      .timers.timers.find((timer: any) => timer.id === "timer-1");
    const monitorInfo = store.getState().presentation.monitorInfo;
    expect(timerState).toEqual(
      expect.objectContaining({
        remainingTime: 0,
        status: "stopped",
      }),
    );
    expect(monitorInfo.slide).toEqual(timerItem.slides[1]);
    expect(monitorInfo.type).toBe("timer");
    expect(monitorInfo.timerId).toBe("timer-1");
    expect(monitorInfo.itemId).toBe("timer-item");
  });

  it("persists finalized timer runtime onto the active timer item after starting", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-04-05T12:00:00.000Z"));

    let storeModule: any;
    let itemSliceModule: any;
    let timersSliceModule: any;

    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: { db: undefined, database: undefined },
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      itemSliceModule = require("./itemSlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      timersSliceModule = require("./timersSlice");
    });

    const store = storeModule.default;
    const { itemSlice } = itemSliceModule;
    const { timersSlice } = timersSliceModule;

    const timerItem = createTimerItem({
      timerInfo: {
        id: "timer-1",
        hostId: "host-123",
        name: "Countdown",
        timerType: "timer",
        status: "stopped",
        isActive: false,
        countdownTime: "00:05",
        duration: 5,
        remainingTime: 5,
        showMinutesOnly: false,
      },
    });

    store.dispatch(itemSlice.actions.setActiveItem(timerItem));
    store.dispatch(
      timersSlice.actions.updateTimer({
        id: "timer-1",
        timerInfo: {
          ...timerItem.timerInfo,
          status: "running",
          startedAt: new Date("2026-04-05T12:00:00.000Z").toISOString(),
        },
      }),
    );
    await flushListenerEffects();

    expect(store.getState().undoable.present.item.timerInfo).toEqual(
      expect.objectContaining({
        status: "running",
        isActive: true,
        endTime: new Date("2026-04-05T12:00:05.000Z").toISOString(),
      }),
    );
  });

  it("keeps the active timer item synced with live ticking state", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-04-05T12:00:00.000Z"));

    let storeModule: any;
    let itemSliceModule: any;
    let timersSliceModule: any;

    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: { db: undefined, database: undefined },
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: jest.fn(),
        set: jest.fn(),
        get: jest.fn(),
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      itemSliceModule = require("./itemSlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      timersSliceModule = require("./timersSlice");
    });

    const store = storeModule.default;
    const { itemSlice } = itemSliceModule;
    const { timersSlice } = timersSliceModule;

    const timerItem = createTimerItem({
      timerInfo: {
        id: "timer-1",
        hostId: "host-123",
        name: "Countdown",
        timerType: "timer",
        status: "running",
        isActive: true,
        countdownTime: "00:05",
        duration: 5,
        remainingTime: 5,
        endTime: new Date("2026-04-05T12:00:05.000Z").toISOString(),
        showMinutesOnly: false,
      },
    });

    store.dispatch(itemSlice.actions.setActiveItem(timerItem));
    store.dispatch(timersSlice.actions.syncTimers([timerItem.timerInfo]));
    await flushListenerEffects();

    jest.setSystemTime(new Date("2026-04-05T12:00:02.000Z"));
    store.dispatch(timersSlice.actions.tickTimers());
    await flushListenerEffects();

    expect(store.getState().undoable.present.item.timerInfo).toEqual(
      expect.objectContaining({
        status: "running",
        remainingTime: 3,
      }),
    );
  });

  it("removes this host's last timer from localStorage and Firebase", async () => {
    let storeModule: any;
    let timersSliceModule: any;
    const setMock = jest.fn();
    const getMock = jest.fn(() =>
      Promise.resolve({
        val: () => [
          {
            id: "timer-1",
            hostId: "host-123",
            name: "Countdown",
            timerType: "timer",
            status: "stopped",
            isActive: false,
            countdownTime: "00:05",
            duration: 5,
            remainingTime: 5,
            endTime: new Date(0).toISOString(),
            showMinutesOnly: false,
          },
          {
            id: "timer-2",
            hostId: "remote-host",
            name: "Remote Countdown",
            timerType: "timer",
            status: "stopped",
            isActive: false,
            countdownTime: "00:10",
            duration: 10,
            remainingTime: 10,
            endTime: new Date(0).toISOString(),
            showMinutesOnly: false,
          },
        ],
      }),
    );
    const refMock = jest.fn((_db: unknown, path: string) => path);
    const removeItemSpy = jest.spyOn(Storage.prototype, "removeItem");

    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: {
          db: "firebase-db",
          database: "main",
          churchId: "church-main",
        },
        globalHostId: "host-123",
      }));
      jest.doMock("firebase/database", () => ({
        ref: refMock,
        set: setMock,
        get: getMock,
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      timersSliceModule = require("./timersSlice");
    });

    const store = storeModule.default;
    const { timersSlice } = timersSliceModule;

    store.dispatch(
      timersSlice.actions.syncTimers([
        {
          id: "timer-1",
          hostId: "host-123",
          name: "Countdown",
          timerType: "timer",
          status: "stopped",
          isActive: false,
          countdownTime: "00:05",
          duration: 5,
          remainingTime: 5,
          endTime: new Date(0).toISOString(),
          showMinutesOnly: false,
        },
        {
          id: "timer-2",
          hostId: "remote-host",
          name: "Remote Countdown",
          timerType: "timer",
          status: "stopped",
          isActive: false,
          countdownTime: "00:10",
          duration: 10,
          remainingTime: 10,
          endTime: new Date(0).toISOString(),
          showMinutesOnly: false,
        },
      ]),
    );
    await waitForListenerDelay();

    store.dispatch(timersSlice.actions.deleteTimer("timer-1"));
    await waitForListenerDelay();

    expect(removeItemSpy).toHaveBeenCalledWith("timerInfo");
    expect(getMock).toHaveBeenCalled();
    expect(refMock).toHaveBeenCalledWith(
      "firebase-db",
      "churches/church-main/data/timers",
    );
    expect(setMock).toHaveBeenCalledWith("churches/church-main/data/timers", [
      expect.objectContaining({
        id: "timer-2",
        hostId: "remote-host",
      }),
    ]);
  });

  it("writes projector, monitor, and stream snapshots to Firebase and localStorage", () => {
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");
    const {
      store,
      writePresentationSnapshotToFirebase,
      presentationSlice,
      setMock,
      refMock,
    } = loadStoreWithPresentationSync();

    store.dispatch(presentationSlice.actions.setTransmitToAll(true));
    store.dispatch(
      presentationSlice.actions.updateProjector(
        createScreenPresentation("projector", 101, {
          name: "Projector Song",
        }),
      ),
    );
    store.dispatch(
      presentationSlice.actions.updateMonitor(
        createScreenPresentation("monitor", 202, {
          name: "Monitor Notes",
          nextSlide: createScreenSlide("monitor-next", "monitor-next"),
          bibleInfoBox: { words: "Reference" },
        }),
      ),
    );
    store.dispatch(
      presentationSlice.actions.updateStream(
        createScreenPresentation("stream", 303, {
          name: "Stream Lyrics",
        }),
      ),
    );

    writePresentationSnapshotToFirebase(store.getState());

    expect(refMock).toHaveBeenCalledWith(
      "firebase-db",
      "churches/church-main/data/presentation",
    );
    expect(setMock).toHaveBeenCalledWith(
      "churches/church-main/data/presentation",
      expect.objectContaining({
        projectorInfo: expect.objectContaining({
          name: "Projector Song",
          displayType: "projector",
        }),
        monitorInfo: expect.objectContaining({
          name: "Monitor Notes",
          displayType: "monitor",
        }),
        streamInfo: expect.objectContaining({
          name: "Stream Lyrics",
          displayType: "stream",
        }),
      }),
    );
    expect(setItemSpy).toHaveBeenCalledWith(
      "projectorInfo",
      expect.stringContaining("Projector Song"),
    );
    expect(setItemSpy).toHaveBeenCalledWith(
      "monitorInfo",
      expect.stringContaining("Monitor Notes"),
    );
    expect(setItemSpy).toHaveBeenCalledWith(
      "streamInfo",
      expect.stringContaining("Stream Lyrics"),
    );
  });

  it("pushes a presentation snapshot after a local projector update", async () => {
    const { store, presentationSlice, setMock } =
      loadStoreWithPresentationSync();

    store.dispatch(presentationSlice.actions.toggleProjectorTransmitting());
    setMock.mockClear();

    store.dispatch(
      presentationSlice.actions.updateProjector(
        createScreenPresentation("projector", 111, {
          name: "Live Projector",
        }),
      ),
    );

    await waitForListenerDelay();

    expect(setMock).toHaveBeenCalledTimes(1);
    expect(setMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        projectorInfo: expect.objectContaining({ name: "Live Projector" }),
      }),
    );
  });

  it("pushes the current stream snapshot when stream transmission turns on", async () => {
    const { store, presentationSlice, setMock } =
      loadStoreWithPresentationSync();

    store.dispatch(
      presentationSlice.actions.updateStreamFromRemote(
        createScreenPresentation("stream", 222, {
          name: "Remote Stream Snapshot",
        }),
      ),
    );
    setMock.mockClear();

    store.dispatch(presentationSlice.actions.toggleStreamTransmitting());

    await waitForListenerDelay();

    expect(setMock).toHaveBeenCalledTimes(1);
    expect(setMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        streamInfo: expect.objectContaining({ name: "Remote Stream Snapshot" }),
      }),
    );
  });

  it("applies only newer remote projector updates", async () => {
    const { store, presentationSlice } = loadStoreWithPresentationSync();

    store.dispatch(
      presentationSlice.actions.updateProjectorFromRemote(
        createScreenPresentation("projector", 500, {
          name: "Existing Projector",
        }),
      ),
    );

    store.dispatch({
      type: "debouncedUpdateProjector",
      payload: createScreenPresentation("projector", 400, {
        name: "Stale Projector",
      }),
    });
    await waitForListenerDelay();
    expect(store.getState().presentation.projectorInfo.name).toBe(
      "Existing Projector",
    );

    store.dispatch({
      type: "debouncedUpdateProjector",
      payload: createScreenPresentation("projector", 600, {
        name: "New Projector",
      }),
    });
    await waitForListenerDelay();
    expect(store.getState().presentation.projectorInfo.name).toBe(
      "New Projector",
    );
  });

  it("applies only newer remote monitor updates", async () => {
    const { store, presentationSlice } = loadStoreWithPresentationSync();

    store.dispatch(
      presentationSlice.actions.updateMonitorFromRemote(
        createScreenPresentation("monitor", 500, {
          name: "Existing Monitor",
          nextSlide: createScreenSlide("monitor-next-old", "next-old"),
        }),
      ),
    );

    store.dispatch({
      type: "debouncedUpdateMonitor",
      payload: createScreenPresentation("monitor", 450, {
        name: "Stale Monitor",
        nextSlide: createScreenSlide("monitor-next-stale", "next-stale"),
      }),
    });
    await waitForListenerDelay();
    expect(store.getState().presentation.monitorInfo.name).toBe(
      "Existing Monitor",
    );

    store.dispatch({
      type: "debouncedUpdateMonitor",
      payload: createScreenPresentation("monitor", 700, {
        name: "New Monitor",
        nextSlide: createScreenSlide("monitor-next-new", "next-new"),
      }),
    });
    await waitForListenerDelay();
    expect(store.getState().presentation.monitorInfo.name).toBe("New Monitor");
    expect(store.getState().presentation.monitorInfo.nextSlide).toEqual(
      createScreenSlide("monitor-next-new", "next-new"),
    );
  });

  it("applies only newer remote stream updates", async () => {
    const { store, presentationSlice } = loadStoreWithPresentationSync();

    store.dispatch(
      presentationSlice.actions.updateStreamFromRemote(
        createScreenPresentation("stream", 800, {
          name: "Existing Stream",
        }),
      ),
    );

    store.dispatch({
      type: "debouncedUpdateStream",
      payload: createScreenPresentation("stream", 750, {
        name: "Stale Stream",
      }),
    });
    await waitForListenerDelay();
    expect(store.getState().presentation.streamInfo.name).toBe(
      "Existing Stream",
    );

    store.dispatch({
      type: "debouncedUpdateStream",
      payload: createScreenPresentation("stream", 900, {
        name: "New Stream",
      }),
    });
    await waitForListenerDelay();
    expect(store.getState().presentation.streamInfo.name).toBe("New Stream");
  });
});
