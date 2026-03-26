const flushListenerEffects = async () => {
  await Promise.resolve();
  await Promise.resolve();
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

describe("store module", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("broadcastCreditsUpdate posts docs with hostId when broadcast channel exists", () => {
    const postMessage = jest.fn();

    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: { postMessage },
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
        globalFireDbInfo: undefined,
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

    store.dispatch(overlaysSlice.actions.initiateOverlayList([overlayA, overlayB]));
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

    store.dispatch(overlaysSlice.actions.initiateOverlayList([overlayA, overlayB]));
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

    store.dispatch(overlaysSlice.actions.initiateOverlayList([overlayA, overlayB]));
    store.dispatch({ type: "@@redux-undo/CLEAR_HISTORY" });
    store.dispatch(overlaySlice.actions.selectOverlay(overlayB));

    const selectedBeforeUpdate = store.getState().undoable.present.overlay.selectedOverlay;
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
    expect(
      state.overlay.selectedOverlay?.formatting?.backgroundColor,
    ).not.toBe("#123456");
    expect(
      state.overlays.list.find((overlay: any) => overlay.id === "overlay-a")
        ?.formatting?.backgroundColor,
    ).not.toBe("#123456");
    expect(
      state.overlays.list.find((overlay: any) => overlay.id === "overlay-b")
        ?.formatting?.backgroundColor,
    ).not.toBe("#123456");
  });
});
