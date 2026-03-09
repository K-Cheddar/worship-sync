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
});
