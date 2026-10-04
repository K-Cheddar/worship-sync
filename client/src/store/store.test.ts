const flushListenerEffects = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

// Pure selectors/helpers from the slot-based presentation slice (no store side effects).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toLegacyPresentationShape } = require("./presentationSlice");

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

const loadStoreWithPresentationSync = (
  options: {
    firebaseDb?: string;
    firebaseReady?: boolean;
    realtimeConnected?: boolean;
    canWriteSharedData?: boolean;
  } = {},
) => {
  let storeModule: any;
  let presentationSliceModule: any;
  let serviceTimesSliceModule: any;
  let timersSliceModule: any;
  let presentationSyncErrorBusModule: any;
  const setMock = jest.fn();
  const updateMock = jest.fn();
  const runTransactionMock = jest.fn(
    async (_path: unknown, update: (current: unknown) => unknown) => {
      const value = update([]);
      return {
        committed: true,
        snapshot: { val: () => value },
      };
    },
  );
  const refMock = jest.fn((_db: unknown, path: string) => path);
  const globalFireDbInfo = {
    db:
      options.firebaseReady === false
        ? undefined
        : options.firebaseDb || "firebase-db",
    database: "main",
    churchId: "church-main",
    isConnected:
      options.firebaseReady === false
        ? false
        : options.realtimeConnected !== false,
    canWriteSharedData: options.canWriteSharedData ?? true,
  };

  jest.isolateModules(() => {
    jest.doMock("../context/controllerInfo", () => ({
      globalDb: undefined,
      globalBroadcastRef: undefined,
    }));
    jest.doMock("../context/globalInfo", () => ({
      globalFireDbInfo,
      globalHostId: "host-123",
    }));
    jest.doMock("firebase/database", () => ({
      ref: refMock,
      runTransaction: runTransactionMock,
      set: setMock,
      update: updateMock,
      get: jest.fn(),
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    storeModule = require("./store");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    presentationSliceModule = require("./presentationSlice");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    serviceTimesSliceModule = require("./serviceTimesSlice");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    timersSliceModule = require("./timersSlice");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    presentationSyncErrorBusModule = require("../utils/presentationSyncErrorBus");
  });

  return {
    store: storeModule.default,
    writePresentationSnapshotToFirebase:
      storeModule.writePresentationSnapshotToFirebase,
    presentationSlice: presentationSliceModule.presentationSlice,
    serviceTimesSlice: serviceTimesSliceModule.serviceTimesSlice,
    timersSlice: timersSliceModule.timersSlice,
    registerPresentationSyncErrorHandler:
      presentationSyncErrorBusModule.registerPresentationSyncErrorHandler,
    globalFireDbInfo,
    setMock,
    updateMock,
    refMock,
    runTransactionMock,
  };
};

const loadStoreWithMediaPersistence = () => {
  let storeModule: any;
  let mediaSliceModule: any;
  const postMessage = jest.fn();
  const db = {
    get: jest.fn(),
    put: jest.fn(),
    remove: jest.fn(),
    allDocs: jest.fn(),
  };

  jest.isolateModules(() => {
    jest.doMock("../context/controllerInfo", () => ({
      globalDb: db,
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
    storeModule = require("./store");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mediaSliceModule = require("./mediaSlice");
  });

  return {
    store: storeModule.default,
    mediaSlice: mediaSliceModule.mediaItemsSlice,
    db,
    postMessage,
  };
};

const loadStoreWithOverlayTemplatePersistence = () => {
  let storeModule: any;
  let overlayTemplatesSliceModule: any;
  const db = {
    get: jest.fn(),
    put: jest.fn(),
  };

  jest.isolateModules(() => {
    jest.doMock("../context/controllerInfo", () => ({
      globalDb: db,
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
    overlayTemplatesSliceModule = require("./overlayTemplatesSlice");
  });

  return {
    store: storeModule.default,
    overlayTemplatesSlice: overlayTemplatesSliceModule.overlayTemplatesSlice,
    db,
  };
};

const loadStoreWithItemPersistence = () => {
  let storeModule: any;
  let itemSliceModule: any;
  const postMessage = jest.fn();
  const db = {
    get: jest.fn(),
    put: jest.fn(),
  };

  jest.isolateModules(() => {
    jest.doMock("../context/controllerInfo", () => ({
      globalDb: db,
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
    storeModule = require("./store");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    itemSliceModule = require("./itemSlice");
  });

  return {
    store: storeModule.default,
    itemSlice: itemSliceModule.itemSlice,
    updateSlides: itemSliceModule.updateSlides,
    db,
    postMessage,
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

const createSongAudio = (id: string) => ({
  id,
  key: `churches/church-1/songs/song-1/${id}.mp3`,
  fileName: `${id}.mp3`,
  contentType: "audio/mpeg",
  sizeBytes: 1234,
  uploadedAt: "2026-08-09T12:00:00.000Z",
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
    jest.restoreAllMocks();
    jest.resetModules();
    jest.clearAllMocks();
    localStorage.clear();
  });

  it("repairs an unmatched service plan song when song docs load later", async () => {
    let storeModule: any;
    let allDocsSliceModule: any;
    let servicePlanningImportSliceModule: any;

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
      allDocsSliceModule = require("./allDocsSlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      servicePlanningImportSliceModule = require("./servicePlanningImportSlice");
    });

    const store = storeModule.default;
    const { updateAllSongDocs } = allDocsSliceModule;
    const { setServicePlanningServiceOutline } =
      servicePlanningImportSliceModule;
    const unmatchedCandidate = {
      sectionName: "Praise",
      headingName: "Praise",
      sourceRowIndex: 0,
      elementType: "Song of Praise",
      title: "How Great is Our God",
      cleanedTitle: "How Great is Our God",
      outlineItemType: "song",
      overlayReady: true,
      outlineAlreadyPresent: false,
      matchedLibraryItem: null,
      parsedRef: null,
    };

    store.dispatch(
      setServicePlanningServiceOutline({
        source: "servicePlanning",
        loadedAt: "2026-09-20T12:00:00.000Z",
        sourceUrl: "https://example.com/plan",
        planLabel: "Sunday",
        preview: {
          overlayCandidates: [],
          overlayPlan: [],
          outlineCandidates: [unmatchedCandidate],
          lineItems: [{ ...unmatchedCandidate, selectedForOutline: true, ledBy: "" }],
          teamAssignments: [],
        },
      }),
    );

    store.dispatch(
      updateAllSongDocs([
        createSongDoc({
          _id: "song-how-great",
          name: "How Great is Our God",
        }),
      ]),
    );
    await flushListenerEffects();

    const preview = store.getState().servicePlanningImport.preview;
    expect(preview?.outlineCandidates[0]?.matchedLibraryItem?._id).toBe(
      "song-how-great",
    );
    expect(preview?.lineItems[0]?.matchedLibraryItem?._id).toBe(
      "song-how-great",
    );
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

  it("enables aux history without overlay-only slices and preserves session boundaries", () => {
    jest.useFakeTimers();
    let storeModule: any;
    let itemSliceModule: any;
    let allItemsSliceModule: any;
    let preferencesSliceModule: any;
    let itemListSliceModule: any;
    let itemListsSliceModule: any;
    let mediaSliceModule: any;

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
      allItemsSliceModule = require("./allItemsSlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      preferencesSliceModule = require("./preferencesSlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      itemListSliceModule = require("./itemListSlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      itemListsSliceModule = require("./itemListsSlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mediaSliceModule = require("./mediaSlice");
    });

    const store = storeModule.default;
    const { itemSlice } = itemSliceModule;
    const item = {
      name: "Original Name",
      _id: "aux-item",
      type: "song",
      selectedArrangement: 0,
      selectedSlide: 0,
      selectedBox: 0,
      arrangements: [],
      slides: [],
      shouldSendTo: { projector: true, monitor: true, stream: true },
    };

    store.dispatch(allItemsSliceModule.setIsInitialized(true));
    store.dispatch(preferencesSliceModule.setIsInitialized(true));
    store.dispatch(itemListSliceModule.setIsInitialized(true));
    store.dispatch(itemListsSliceModule.setIsInitialized(true));
    store.dispatch(mediaSliceModule.setIsInitialized(true));

    expect(
      storeModule.areControllerSlicesReady(store.getState(), {
        includeOverlayState: false,
      }),
    ).toBe(true);
    expect(storeModule.areControllerSlicesReady(store.getState())).toBe(false);

    store.dispatch({ type: storeModule.CONTROLLER_PAGE_READY });
    jest.runAllTimers();
    store.dispatch(itemListsSliceModule.setOutlineScope("aux"));
    expect(store.getState().undoable.past).toHaveLength(0);
    store.dispatch(itemSlice.actions.setActiveItem(item));
    store.dispatch(itemSlice.actions._setName("Edited Name"));

    expect(store.getState().undoable.past).toHaveLength(1);
    store.dispatch({ type: "@@redux-undo/UNDO" });
    expect(store.getState().undoable.present.item.name).toBe("Original Name");
    store.dispatch({ type: "@@redux-undo/REDO" });
    expect(store.getState().undoable.present.item.name).toBe("Edited Name");

    store.dispatch({ type: "RESET_CONTROLLER_SESSION" });
    expect(store.getState().undoable.past).toHaveLength(0);
  });

  it("does not let a deferred initialization clear cross a reset", () => {
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
    store.dispatch({ type: storeModule.CREDITS_EDITOR_PAGE_READY });
    store.dispatch(
      itemSliceModule.itemSlice.actions.setActiveItem({
        ...createSongDoc(),
        _id: "aux-item",
        name: "Original Name",
      }),
    );
    store.dispatch(itemSliceModule.itemSlice.actions._setName("Aux edit"));
    expect(store.getState().undoable.past).toHaveLength(1);
    store.dispatch({ type: "RESET_INITIALIZATION" });
    jest.runAllTimers();

    expect(store.getState().undoable.past).toHaveLength(1);
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

  it("keeps controller and display registries across RESET_CONTROLLER_SESSION", () => {
    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: { db: undefined, database: undefined },
        globalHostId: "host-123",
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {
        setControllerProfilesFromRemote,
      } = require("./controllerProfilesSlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { setDisplayOutputsFromRemote } = require("./displayOutputsSlice");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initiateItemLists } = require("./itemListsSlice");
      const store = storeModule.default;

      store.dispatch(
        setControllerProfilesFromRemote([
          {
            id: "presentation",
            type: "presentation",
            name: "Sanctuary",
            description: "",
            order: 0,
            enabled: true,
            outputIds: [],
            outputsConfigured: false,
            defaultSendOutputIds: [],
            outlineScope: "presentation",
          },
          {
            id: "overlay",
            type: "overlay",
            name: "Stream Desk",
            description: "",
            order: 1,
            enabled: true,
            outputIds: [],
            outputsConfigured: false,
            defaultSendOutputIds: [],
            outlineScope: "presentation",
          },
        ]),
      );
      store.dispatch(setDisplayOutputsFromRemote(null));
      store.dispatch(
        initiateItemLists([{ _id: "outline-a", name: "Service A" }]),
      );

      store.dispatch({ type: "RESET_CONTROLLER_SESSION" });

      const state = store.getState();
      expect(state.controllerProfiles.isLoaded).toBe(true);
      expect(
        state.controllerProfiles.list.find(
          (p: { id: string }) => p.id === "presentation",
        )?.name,
      ).toBe("Sanctuary");
      expect(
        state.controllerProfiles.list.find(
          (p: { id: string }) => p.id === "overlay",
        )?.name,
      ).toBe("Stream Desk");
      expect(state.displayOutputs.isLoaded).toBe(true);
      expect(state.undoable.present.itemLists.activeList).toBeUndefined();
    });
  });

  it("clears controller and display registries on full RESET", () => {
    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo: { db: undefined, database: undefined },
        globalHostId: "host-123",
      }));

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const storeModule = require("./store");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {
        setControllerProfilesFromRemote,
      } = require("./controllerProfilesSlice");
      const store = storeModule.default;

      store.dispatch(
        setControllerProfilesFromRemote([
          {
            id: "presentation",
            type: "presentation",
            name: "Sanctuary",
            description: "",
            order: 0,
            enabled: true,
            outputIds: [],
            outputsConfigured: false,
            defaultSendOutputIds: [],
            outlineScope: "presentation",
          },
        ]),
      );
      expect(store.getState().controllerProfiles.isLoaded).toBe(true);

      store.dispatch({ type: "RESET" });

      expect(store.getState().controllerProfiles.isLoaded).toBe(false);
      expect(
        store
          .getState()
          .controllerProfiles.list.find(
            (p: { id: string }) => p.id === "presentation",
          )?.name,
      ).toBe("Presentation");
    });
  });

  it("treats a failed media load as settled without marking media initialized", () => {
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
      const storeModule = require("./store");
      const state = storeModule.default.getState();
      const readyExceptForMedia = {
        ...state,
        allItems: { ...state.allItems, isInitialized: true },
        media: {
          ...state.media,
          isInitialized: false,
          loadStatus: "error",
        },
        undoable: {
          ...state.undoable,
          present: {
            ...state.undoable.present,
            preferences: {
              ...state.undoable.present.preferences,
              isInitialized: true,
            },
            itemList: {
              ...state.undoable.present.itemList,
              isInitialized: true,
            },
            overlays: {
              ...state.undoable.present.overlays,
              isInitialized: true,
            },
            itemLists: {
              ...state.undoable.present.itemLists,
              isInitialized: true,
            },
            overlayTemplates: {
              ...state.undoable.present.overlayTemplates,
              isInitialized: true,
            },
          },
        },
      };

      expect(readyExceptForMedia.media.isInitialized).toBe(false);
      expect(storeModule.areControllerSlicesReady(readyExceptForMedia)).toBe(
        true,
      );
    });
  });

  it("discards a delayed media save when RESET replaces its state snapshot", async () => {
    jest.useFakeTimers();
    const { store, mediaSlice, db } = loadStoreWithMediaPersistence();

    store.dispatch(
      mediaSlice.actions.initiateMediaFromDoc({
        list: [{ id: "media-1", name: "Original" }],
        folders: [],
      }),
    );
    store.dispatch(
      mediaSlice.actions.updateMediaItemFields({
        id: "media-1",
        patch: { name: "Renamed" },
      }),
    );
    store.dispatch({ type: "RESET" });

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.get).not.toHaveBeenCalled();
    expect(db.put).not.toHaveBeenCalled();
  });

  it("discards a delayed media save after a remote media update", async () => {
    jest.useFakeTimers();
    const { store, mediaSlice, db } = loadStoreWithMediaPersistence();

    store.dispatch(
      mediaSlice.actions.initiateMediaFromDoc({
        list: [{ id: "media-1", name: "Original" }],
        folders: [],
      }),
    );
    store.dispatch(
      mediaSlice.actions.updateMediaItemFields({
        id: "media-1",
        patch: { name: "Local rename" },
      }),
    );
    store.dispatch(
      mediaSlice.actions.syncMediaFromRemote({
        list: [{ id: "media-1", name: "Remote rename" }],
        folders: [],
      }),
    );

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.get).not.toHaveBeenCalled();
    expect(db.put).not.toHaveBeenCalled();
    expect(store.getState().media.list[0].name).toBe("Remote rename");
  });

  it("keeps a pending local edit when an unrelated item replicates", async () => {
    jest.useFakeTimers();
    const { store, mediaSlice, db } = loadStoreWithMediaPersistence();
    const persisted = new Map<string, Record<string, unknown>>([
      ["media-item:media-1", {
        _id: "media-item:media-1", _rev: "1-a", docType: "mediaItem", id: "media-1", name: "Original",
      }],
      ["media-item:remote", {
        _id: "media-item:remote", _rev: "1-b", docType: "mediaItem", id: "remote", name: "Remote item",
      }],
    ]);
    db.get.mockImplementation(async (id: string) => {
      if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
      const doc = persisted.get(id);
      if (doc) return doc;
      throw Object.assign(new Error("missing"), { status: 404 });
    });
    db.allDocs.mockResolvedValue({ rows: [...persisted.values()].map((doc) => ({ id: doc._id, doc })) } as any);
    db.put.mockImplementation(async (doc: Record<string, unknown>) => {
      persisted.set(String(doc._id), { ...doc, _rev: "2" });
      return { ok: true } as any;
    });

    store.dispatch(mediaSlice.actions.initiateMediaFromDoc({
      list: [{ id: "media-1", name: "Original" }],
      folders: [],
    }));
    store.dispatch(mediaSlice.actions.updateMediaItemFields({
      id: "media-1",
      patch: { name: "Local edit" },
    }));
    store.dispatch(mediaSlice.actions.upsertMediaItemFromRemote({
      id: "remote",
      name: "Remote item",
    }));

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(persisted.get("media-item:media-1")?.name).toBe("Local edit");
    expect(store.getState().media.list).toEqual([
      { id: "media-1", name: "Local edit" },
      { id: "remote", name: "Remote item" },
    ]);
  });

  it("discards a delayed media save when RESET occurs during the document read", async () => {
    jest.useFakeTimers();
    const { store, mediaSlice, db } = loadStoreWithMediaPersistence();
    db.get.mockImplementation(async (id: string) => {
      if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
      store.dispatch({ type: "RESET" });
      return { _id: id, _rev: "1-item", id: "media-1", name: "Original", docType: "mediaItem" };
    });

    store.dispatch(
      mediaSlice.actions.initiateMediaFromDoc({
        list: [{ id: "media-1", name: "Original" }],
        folders: [],
      }),
    );
    store.dispatch(
      mediaSlice.actions.updateMediaItemFields({
        id: "media-1",
        patch: { name: "Renamed" },
      }),
    );

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.get).toHaveBeenCalledWith("media-library-meta");
    expect(db.get).toHaveBeenCalledWith("media-item:media-1");
    expect(db.put).not.toHaveBeenCalled();
  });

  it("persists media when the initialized state snapshot remains current", async () => {
    jest.useFakeTimers();
    const { store, mediaSlice, db } = loadStoreWithMediaPersistence();
    db.get.mockImplementation(async (id: string) => {
      if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
      if (id === "media-item:media-1") {
        return { _id: id, _rev: "1-item", id: "media-1", name: "Original", docType: "mediaItem" };
      }
      throw Object.assign(new Error("missing"), { status: 404 });
    });
    db.put.mockResolvedValue({ ok: true, id: "media-item:media-1", rev: "2-item" });

    store.dispatch(
      mediaSlice.actions.initiateMediaFromDoc({
        list: [{ id: "media-1", name: "Original" }],
        folders: [],
      }),
    );
    store.dispatch(
      mediaSlice.actions.updateMediaItemFields({
        id: "media-1",
        patch: { name: "Renamed" },
      }),
    );

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "media-item:media-1",
        _rev: "1-item",
        id: "media-1",
        docType: "mediaItem",
        name: "Renamed",
      }),
    );
  });

  it("persists every item changed during one debounced v2 window", async () => {
    jest.useFakeTimers();
    const { store, mediaSlice, db } = loadStoreWithMediaPersistence();
    const persisted = new Map<string, Record<string, unknown>>([
      ["media-item:media-a", {
        _id: "media-item:media-a", _rev: "1-a", docType: "mediaItem", id: "media-a", name: "Before A",
      }],
      ["media-item:media-b", {
        _id: "media-item:media-b", _rev: "1-b", docType: "mediaItem", id: "media-b", name: "Before B",
      }],
    ]);
    db.get.mockImplementation(async (id: string) => {
      if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
      const doc = persisted.get(id);
      if (doc) return doc;
      throw Object.assign(new Error("missing"), { status: 404 });
    });
    db.allDocs.mockResolvedValue({
      rows: [...persisted.values()].map((doc) => ({ id: doc._id, doc })),
    });
    db.put.mockImplementation(async (doc: Record<string, unknown>) => {
      persisted.set(String(doc._id), { ...doc, _rev: "2" });
      return { ok: true };
    });
    store.dispatch(mediaSlice.actions.initiateMediaFromDoc({
      list: [{ id: "media-a", name: "Before A" }, { id: "media-b", name: "Before B" }],
      folders: [],
    }));
    store.dispatch(mediaSlice.actions.updateMediaItemFields({
      id: "media-a",
      patch: { name: "After A" },
    }));
    store.dispatch(mediaSlice.actions.updateMediaItemFields({
      id: "media-b",
      patch: { name: "After B" },
    }));

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.put).toHaveBeenCalledTimes(2);
    expect(db.put).toHaveBeenCalledWith(expect.objectContaining({ _id: "media-item:media-a", name: "After A" }));
    expect(db.put).toHaveBeenCalledWith(expect.objectContaining({ _id: "media-item:media-b", name: "After B" }));
  });

  it("persists a newer edit after an earlier media write finishes in flight", async () => {
    jest.useFakeTimers();
    const { store, mediaSlice, db, postMessage } = loadStoreWithMediaPersistence();
    let resolveFirstPut: ((value: unknown) => void) | undefined;
    const persisted = new Map<string, Record<string, unknown>>([
      ["media-item:media-1", {
        _id: "media-item:media-1", _rev: "1-a", docType: "mediaItem", id: "media-1", name: "Original",
      }],
    ]);
    db.get.mockImplementation(async (id: string) => {
      if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
      const doc = persisted.get(id);
      if (doc) return doc;
      throw Object.assign(new Error("missing"), { status: 404 });
    });
    db.allDocs.mockResolvedValue({ rows: [...persisted.values()].map((doc) => ({ id: doc._id, doc })) } as any);
    db.put.mockImplementation((doc: Record<string, unknown>) => {
      if (doc.name === "First edit") {
        return new Promise((resolve) => {
          resolveFirstPut = (value) => {
            persisted.set(String(doc._id), { ...doc, _rev: "2-a" });
            resolve(value);
          };
        }) as any;
      }
      persisted.set(String(doc._id), { ...doc, _rev: "3-a" });
      return Promise.resolve({ ok: true }) as any;
    });

    store.dispatch(mediaSlice.actions.initiateMediaFromDoc({
      list: [{ id: "media-1", name: "Original" }],
      folders: [],
    }));
    store.dispatch(mediaSlice.actions.updateMediaItemFields({ id: "media-1", patch: { name: "First edit" } }));
    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();
    expect(db.put).toHaveBeenCalledTimes(1);

    store.dispatch(mediaSlice.actions.updateMediaItemFields({ id: "media-1", patch: { name: "Newer edit" } }));
    resolveFirstPut?.({ ok: true });
    await flushListenerEffects();
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].data.docs).toEqual([
      expect.objectContaining({ _id: "media-item:media-1", name: "First edit" }),
    ]);
    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.put).toHaveBeenCalledTimes(2);
    expect(persisted.get("media-item:media-1")?.name).toBe("Newer edit");
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[1][0].data.docs).toEqual([
      expect.objectContaining({ _id: "media-item:media-1", name: "Newer edit" }),
    ]);
  });

  it("broadcasts a committed local row while retaining an unrelated remote row", async () => {
    jest.useFakeTimers();
    const { store, mediaSlice, db, postMessage } = loadStoreWithMediaPersistence();
    let resolvePut: ((value: unknown) => void) | undefined;
    const persisted = new Map<string, Record<string, unknown>>([
      ["media-item:local", { _id: "media-item:local", _rev: "1-a", docType: "mediaItem", id: "local", name: "Before" }],
      ["media-item:remote", { _id: "media-item:remote", _rev: "1-b", docType: "mediaItem", id: "remote", name: "Before remote" }],
    ]);
    db.get.mockImplementation(async (id: string) => {
      if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
      const doc = persisted.get(id);
      if (doc) return doc;
      throw Object.assign(new Error("missing"), { status: 404 });
    });
    db.allDocs.mockResolvedValue({ rows: [...persisted.values()].map((doc) => ({ id: doc._id, doc })) } as any);
    db.put.mockImplementation((doc: Record<string, unknown>) => new Promise((resolve) => {
      resolvePut = (value) => {
        persisted.set(String(doc._id), { ...doc, _rev: "2-local" });
        resolve(value);
      };
    }) as any);

    store.dispatch(mediaSlice.actions.initiateMediaFromDoc({
      list: [{ id: "local", name: "Before" }, { id: "remote", name: "Before remote" }],
      folders: [],
    }));
    store.dispatch(mediaSlice.actions.updateMediaItemFields({ id: "local", patch: { name: "Saved local" } }));
    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();
    store.dispatch(mediaSlice.actions.upsertMediaItemFromRemote({ id: "remote", name: "Remote update" }));
    resolvePut?.({ ok: true });
    await flushListenerEffects();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].data.docs).toEqual([
      expect.objectContaining({ _id: "media-item:local", name: "Saved local" }),
    ]);
    expect(store.getState().media.list).toEqual([
      { id: "local", name: "Saved local" },
      { id: "remote", name: "Remote update" },
    ]);
    expect(persisted.get("media-item:remote")?.name).toBe("Before remote");
  });

  it("does not write a remote-winning row after another v2 row finishes", async () => {
    jest.useFakeTimers();
    const { store, mediaSlice, db, postMessage } = loadStoreWithMediaPersistence();
    let resolveAWrite: ((value: unknown) => void) | undefined;
    const persisted = new Map<string, Record<string, unknown>>([
      ["media-item:a", { _id: "media-item:a", _rev: "1-a", docType: "mediaItem", id: "a", name: "Before A" }],
      ["media-item:b", { _id: "media-item:b", _rev: "1-b", docType: "mediaItem", id: "b", name: "Before B" }],
    ]);
    db.get.mockImplementation(async (id: string) => {
      if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
      const doc = persisted.get(id);
      if (doc) return doc;
      throw Object.assign(new Error("missing"), { status: 404 });
    });
    db.allDocs.mockResolvedValue({ rows: [...persisted.values()].map((doc) => ({ id: doc._id, doc })) } as any);
    db.put.mockImplementation((doc: Record<string, unknown>) => new Promise((resolve) => {
      resolveAWrite = (value) => {
        persisted.set(String(doc._id), { ...doc, _rev: "2-a" });
        resolve(value);
      };
    }) as any);

    store.dispatch(mediaSlice.actions.initiateMediaFromDoc({
      list: [{ id: "a", name: "Before A" }, { id: "b", name: "Before B" }],
      folders: [],
    }));
    store.dispatch(mediaSlice.actions.updateMediaItemFields({ id: "a", patch: { name: "Local A" } }));
    store.dispatch(mediaSlice.actions.updateMediaItemFields({ id: "b", patch: { name: "Stale local B" } }));
    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.put).toHaveBeenCalledTimes(1);
    persisted.set("media-item:b", {
      _id: "media-item:b", _rev: "2-b", docType: "mediaItem", id: "b", name: "Remote B",
    });
    store.dispatch(mediaSlice.actions.upsertMediaItemFromRemote({ id: "b", name: "Remote B" }));
    resolveAWrite?.({ ok: true });
    await flushListenerEffects();

    expect(db.put).toHaveBeenCalledTimes(1);
    expect(db.put).toHaveBeenCalledWith(expect.objectContaining({ _id: "media-item:a", name: "Local A" }));
    expect(store.getState().media.list).toEqual([
      { id: "a", name: "Local A" },
      { id: "b", name: "Remote B" },
    ]);
    expect(persisted.get("media-item:b")?.name).toBe("Remote B");
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].data.docs).toEqual([
      expect.objectContaining({ _id: "media-item:a", name: "Local A" }),
    ]);
  });

  it("does not write remote-winning folders after a v2 row finishes", async () => {
    jest.useFakeTimers();
    const { store, mediaSlice, db, postMessage } = loadStoreWithMediaPersistence();
    let resolveAWrite: ((value: unknown) => void) | undefined;
    const remoteFolders = [{ id: "remote-folder", name: "Remote folder", parentId: null }];
    const persisted = new Map<string, Record<string, unknown>>([
      ["media-item:a", { _id: "media-item:a", _rev: "1-a", docType: "mediaItem", id: "a", name: "Before A" }],
      ["media-folders", { _id: "media-folders", _rev: "1-f", docType: "mediaFolders", folders: [] }],
    ]);
    db.get.mockImplementation(async (id: string) => {
      if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
      const doc = persisted.get(id);
      if (doc) return doc;
      throw Object.assign(new Error("missing"), { status: 404 });
    });
    db.allDocs.mockResolvedValue({ rows: [...persisted.values()].map((doc) => ({ id: doc._id, doc })) } as any);
    db.put.mockImplementation((doc: Record<string, unknown>) => new Promise((resolve) => {
      resolveAWrite = (value) => {
        persisted.set(String(doc._id), { ...doc, _rev: "2-a" });
        resolve(value);
      };
    }) as any);

    store.dispatch(mediaSlice.actions.initiateMediaFromDoc({
      list: [{ id: "a", name: "Before A" }],
      folders: [],
    }));
    store.dispatch(mediaSlice.actions.updateMediaItemFields({ id: "a", patch: { name: "Local A" } }));
    store.dispatch(mediaSlice.actions.setMediaListAndFolders({
      list: [{ id: "a", name: "Local A" }],
      folders: [{ id: "local-folder", name: "Local folder", parentId: null }],
    }));
    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.put).toHaveBeenCalledTimes(1);
    persisted.set("media-folders", {
      _id: "media-folders", _rev: "2-f", docType: "mediaFolders", folders: remoteFolders,
    });
    store.dispatch(mediaSlice.actions.updateMediaFoldersFromRemote(remoteFolders));
    resolveAWrite?.({ ok: true });
    await flushListenerEffects();

    expect(db.put).toHaveBeenCalledTimes(1);
    expect(persisted.get("media-folders")?.folders).toEqual(remoteFolders);
    expect(store.getState().media.folders).toEqual(remoteFolders);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].data.docs).toEqual([
      expect.objectContaining({ _id: "media-item:a", name: "Local A" }),
    ]);
  });

  it("keeps unrelated media edits pending when a remote update wins a row conflict", async () => {
    jest.useFakeTimers();
    const { store, mediaSlice, db } = loadStoreWithMediaPersistence();
    const persisted = new Map<string, Record<string, unknown>>([
      ["media-item:media-a", {
        _id: "media-item:media-a", _rev: "1-a", docType: "mediaItem", id: "media-a", name: "Before A",
      }],
      ["media-item:media-b", {
        _id: "media-item:media-b", _rev: "1-b", docType: "mediaItem", id: "media-b", name: "Before B",
      }],
    ]);
    db.get.mockImplementation(async (id: string) => {
      if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
      const doc = persisted.get(id);
      if (doc) return doc;
      throw Object.assign(new Error("missing"), { status: 404 });
    });
    db.allDocs.mockResolvedValue({ rows: [...persisted.values()].map((doc) => ({ id: doc._id, doc })) } as any);
    db.put.mockImplementation(async (doc: Record<string, unknown>) => {
      persisted.set(String(doc._id), { ...doc, _rev: "2" });
      return { ok: true } as any;
    });

    store.dispatch(mediaSlice.actions.initiateMediaFromDoc({
      list: [{ id: "media-a", name: "Before A" }, { id: "media-b", name: "Before B" }],
      folders: [],
    }));
    store.dispatch(mediaSlice.actions.updateMediaItemFields({ id: "media-a", patch: { name: "Local A" } }));
    store.dispatch(mediaSlice.actions.updateMediaItemFields({ id: "media-b", patch: { name: "Local B" } }));
    store.dispatch(mediaSlice.actions.upsertMediaItemFromRemote({ id: "media-a", name: "Remote A" }));

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(store.getState().media.list.find((item: { id: string }) => item.id === "media-a")?.name).toBe("Remote A");
    expect(persisted.get("media-item:media-a")?.name).toBe("Before A");
    expect(persisted.get("media-item:media-b")?.name).toBe("Local B");
  });

  it("does not recreate a directly tombstoned row when an older debounce wakes", async () => {
    jest.useFakeTimers();
    const { store, mediaSlice, db } = loadStoreWithMediaPersistence();
    const persisted = new Map<string, Record<string, unknown>>();
    db.get.mockImplementation(async (id: string) => {
      if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
      const doc = persisted.get(id);
      if (doc) return doc;
      throw Object.assign(new Error("missing"), { status: 404 });
    });
    db.put.mockImplementation(async (doc: Record<string, unknown>) => {
      persisted.set(String(doc._id), doc);
      return { ok: true } as any;
    });

    store.dispatch(mediaSlice.actions.initiateMediaFromDoc({
      list: [{ id: "delete-race", name: "Before" }],
      folders: [],
    }));
    store.dispatch(mediaSlice.actions.updateMediaItemFields({
      id: "delete-race",
      patch: { name: "Stale edit" },
    }));
    // The delete path has already committed this Pouch tombstone.
    store.dispatch(mediaSlice.actions.removeMediaItemFromRemote("delete-race"));

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(store.getState().media.list).toEqual([]);
    expect(db.put).not.toHaveBeenCalled();
    expect(persisted.has("media-item:delete-race")).toBe(false);
  });

  it("does not resurrect a row when an item put is already in flight as deletion begins", async () => {
    jest.useFakeTimers();
    const { store, mediaSlice, db } = loadStoreWithMediaPersistence();
    const id = "in-flight-delete-race";
    const docId = `media-item:${id}`;
    const persisted = new Map<string, Record<string, unknown>>([[docId, {
      _id: docId,
      _rev: "1-current",
      docType: "mediaItem",
      id,
      name: "Before",
    }]]);
    let resolveWrite!: () => void;
    let markWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
    const writeGate = new Promise<void>((resolve) => { resolveWrite = resolve; });
    db.get.mockImplementation(async (requestedId: string) => {
      if (requestedId === "media-library-meta") {
        return { _id: requestedId, schemaVersion: 2 };
      }
      const doc = persisted.get(requestedId);
      if (doc) return doc;
      throw Object.assign(new Error("missing"), { status: 404 });
    });
    db.put.mockImplementation(async (doc: Record<string, unknown>) => {
      markWriteStarted();
      await writeGate;
      const current = persisted.get(String(doc._id));
      if (!current || current._rev !== doc._rev) {
        throw Object.assign(new Error("revision conflict"), { status: 409 });
      }
      persisted.set(String(doc._id), { ...doc, _rev: "2-written" });
      return { ok: true, rev: "2-written" } as any;
    });
    db.remove.mockImplementation(async (doc: Record<string, unknown>) => {
      const current = persisted.get(String(doc._id));
      if (!current || current._rev !== doc._rev) {
        throw Object.assign(new Error("revision conflict"), { status: 409 });
      }
      persisted.delete(String(doc._id));
      return { ok: true, id: doc._id } as any;
    });

    store.dispatch(mediaSlice.actions.initiateMediaFromDoc({
      list: [{ id, name: "Before" }],
      folders: [],
    }));
    store.dispatch(mediaSlice.actions.updateMediaItemFields({
      id,
      patch: { name: "Edit being saved" },
    }));
    await jest.advanceTimersByTimeAsync(1500);
    await writeStarted;

    // Deletion reads and tombstones the current persisted revision while the
    // older Pouch put is pending. Pouch revision checking rejects that late put.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { removeMediaItem } = require("../utils/mediaDocUtils");
    await removeMediaItem(db, id);
    store.dispatch(mediaSlice.actions.removeMediaItemFromRemote(id));
    resolveWrite();
    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(store.getState().media.list).toEqual([]);
    expect(persisted.has(docId)).toBe(false);
    expect(db.put).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("does not write, broadcast, or cache stale local media after a remote row wins during a v2 read", async () => {
    jest.useFakeTimers();
    const { store, mediaSlice, db, postMessage } = loadStoreWithMediaPersistence();
    const previousElectronApiDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
    const syncMediaCache = jest.fn().mockResolvedValue({ downloaded: 0, cleaned: 0 });
    const getMediaCacheMap = jest.fn().mockResolvedValue({});
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { syncMediaCache, getMediaCacheMap },
    });
    const persisted = new Map<string, Record<string, unknown>>([
      ["media-item:media-1", {
        _id: "media-item:media-1", _rev: "1-a", docType: "mediaItem", id: "media-1",
        name: "Original", type: "image", background: "https://example.test/original.png",
      }],
    ]);
    let remoteWon = false;
    db.get.mockImplementation(async (id: string) => {
      if (id === "media-library-meta") return { _id: id, schemaVersion: 2 };
      const doc = persisted.get(id);
      if (id === "media-item:media-1" && !remoteWon) {
        remoteWon = true;
        const remoteDoc = {
          ...doc,
          _rev: "2-remote",
          name: "Remote rename",
          background: "https://example.test/remote.png",
        };
        persisted.set(id, remoteDoc);
        store.dispatch(mediaSlice.actions.upsertMediaItemFromRemote({
          id: "media-1",
          name: "Remote rename",
          type: "image",
          background: "https://example.test/remote.png",
        } as any));
        return remoteDoc;
      }
      if (doc) return doc;
      throw Object.assign(new Error("missing"), { status: 404 });
    });
    db.allDocs.mockImplementation(async () => ({
      rows: [...persisted.values()].map((doc) => ({ id: doc._id, doc })),
    } as any));

    store.dispatch(mediaSlice.actions.initiateMediaFromDoc({
      list: [{ id: "media-1", name: "Original", type: "image", background: "https://example.test/original.png" } as any],
      folders: [],
    }));
    store.dispatch(mediaSlice.actions.updateMediaItemFields({
      id: "media-1",
      patch: { name: "Local rename" },
    }));

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();
    await flushListenerEffects();

    expect(remoteWon).toBe(true);
    expect(db.put).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    expect(persisted.get("media-item:media-1")).toEqual(expect.objectContaining({
      name: "Remote rename",
      background: "https://example.test/remote.png",
    }));
    expect(syncMediaCache).toHaveBeenCalledWith(["https://example.test/remote.png"]);
    expect(syncMediaCache).not.toHaveBeenCalledWith(["https://example.test/original.png"]);
    expect(getMediaCacheMap).toHaveBeenCalledTimes(1);
    if (previousElectronApiDescriptor) {
      Object.defineProperty(window, "electronAPI", previousElectronApiDescriptor);
    } else {
      Reflect.deleteProperty(window, "electronAPI");
    }
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

  it("cancels a pending item autosave when persisted song audio is applied", async () => {
    jest.useFakeTimers();
    const { store, itemSlice, db } = loadStoreWithItemPersistence();
    const previousAudio = createSongAudio("audio-old");
    const attachedAudio = createSongAudio("audio-new");

    store.dispatch(
      itemSlice.actions.setActiveItem(
        createSongDoc({ _rev: "1-song", songAudio: previousAudio }),
      ),
    );
    store.dispatch(itemSlice.actions._setName("Edited while uploading"));
    store.dispatch(
      itemSlice.actions.applyPersistedSongAudio({
        songAudio: attachedAudio,
        persistedDoc: createSongDoc({
          _rev: "2-song",
          name: "Edited while uploading",
          songAudio: attachedAudio,
        }),
      }),
    );

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.get).not.toHaveBeenCalled();
    expect(db.put).not.toHaveBeenCalled();
    expect(store.getState().undoable.present.item.songAudio).toEqual(
      attachedAudio,
    );
  });

  it("preserves newer persisted song audio during an ordinary item autosave", async () => {
    jest.useFakeTimers();
    const { store, itemSlice, db } = loadStoreWithItemPersistence();
    const staleAudio = createSongAudio("audio-old");
    const persistedAudio = createSongAudio("audio-new");
    db.get.mockResolvedValue(
      createSongDoc({ _rev: "2-song", songAudio: persistedAudio }),
    );
    db.put.mockResolvedValue({ ok: true, id: "song-1", rev: "3-song" });

    store.dispatch(
      itemSlice.actions.setActiveItem(
        createSongDoc({ _rev: "1-song", songAudio: staleAudio }),
      ),
    );
    store.dispatch(itemSlice.actions._setName("Edited Song"));

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Edited Song",
        songAudio: persistedAudio,
      }),
    );
  });

  it("omits legacy root slides from song saves and retains non-song slide persistence", async () => {
    jest.useFakeTimers();
    const { store, itemSlice, db } = loadStoreWithItemPersistence();
    const arrangementSlide = { id: "arr-slide", name: "Verse", type: "Verse", boxes: [] };
    db.get.mockResolvedValue(createSongDoc({
      _rev: "1-song", slides: [{ id: "legacy", name: "Legacy", type: "Verse", boxes: [] }],
      arrangements: [{ id: "arr-1", name: "Master", formattedLyrics: [], songOrder: [], slides: [arrangementSlide] }],
    }));
    db.put.mockResolvedValue({ ok: true, id: "song-1", rev: "2-song" });
    store.dispatch(itemSlice.actions.setActiveItem(createSongDoc({
      _rev: "1-song", slides: [{ id: "legacy", name: "Legacy", type: "Verse", boxes: [] }],
      arrangements: [{ id: "arr-1", name: "Master", formattedLyrics: [], songOrder: [], slides: [arrangementSlide] }],
    })));
    store.dispatch(itemSlice.actions._setName("Saved Song"));
    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    const savedSong = db.put.mock.calls[0][0];
    expect(savedSong).not.toHaveProperty("slides");
    expect(savedSong.arrangements[0].slides).toEqual([arrangementSlide]);

    const nonSong = createTimerItem({ _rev: "1-timer" });
    store.dispatch(itemSlice.actions.setActiveItem(nonSong));
    db.get.mockResolvedValue(nonSong);
    db.put.mockClear();
    store.dispatch(itemSlice.actions._setName("Saved Timer"));
    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();
    expect(db.put.mock.calls[0][0].slides).toEqual(nonSong.slides);
  });

  it("updates the selected arrangement's compact monitor layout when source sizing inputs change", async () => {
    const { store, itemSlice, updateSlides } = loadStoreWithItemPersistence();
    const initialSlide = {
      id: "verse-1",
      name: "Verse 1",
      type: "Verse",
      boxes: [{ words: "" }, { words: "short", width: 100, isBold: false, isItalic: false }],
    };
    store.dispatch(itemSlice.actions.setActiveItem(createSongDoc({
      monitorLayout: undefined,
      arrangements: [{
        id: "arr-1", name: "Master", formattedLyrics: [], songOrder: [],
        monitorLayout: { currentFontSizePx: 1, nextFontSizePx: 2 },
        slides: [initialSlide],
      }],
    })));

    const updatedSlide = {
      ...initialSlide,
      boxes: [initialSlide.boxes[0], { ...initialSlide.boxes[1], words: "a much longer lyric line that should need more space" }],
    };
    await store.dispatch(updateSlides({ slides: [updatedSlide] })).unwrap();

    const state = store.getState().undoable.present.item;
    expect(state.slides).toEqual([]);
    expect(state.arrangements[0].slides).toEqual([updatedSlide]);
    expect(state.arrangements[0].monitorLayout).not.toEqual({
      currentFontSizePx: 1,
      nextFontSizePx: 2,
    });
  });

  it("does not restore removed song audio during an ordinary item autosave", async () => {
    jest.useFakeTimers();
    const { store, itemSlice, db } = loadStoreWithItemPersistence();
    const staleAudio = createSongAudio("audio-old");
    db.get.mockResolvedValue(createSongDoc({ _rev: "2-song" }));
    db.put.mockResolvedValue({ ok: true, id: "song-1", rev: "3-song" });

    store.dispatch(
      itemSlice.actions.setActiveItem(
        createSongDoc({ _rev: "1-song", songAudio: staleAudio }),
      ),
    );
    store.dispatch(itemSlice.actions._setName("Edited Song"));

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Edited Song",
        songAudio: undefined,
      }),
    );
  });

  it("persists and reloads a custom free section name", async () => {
    jest.useFakeTimers();
    const { store, itemSlice, updateSlides, db } =
      loadStoreWithItemPersistence();
    const slides = [
      {
        id: "section-4",
        type: "Section",
        name: "Section 4",
        boxes: [],
      },
    ];
    const renamedSections = [
      {
        sectionNum: 4,
        name: "First",
        words: "Section text",
        slideSpan: 1,
      },
    ];
    db.get.mockResolvedValue(
      createSongDoc({
        _rev: "1-free",
        _id: "free-1",
        type: "free",
        slides,
        formattedSections: [
          { sectionNum: 4, words: "Section text", slideSpan: 1 },
        ],
      }),
    );
    db.put.mockResolvedValue({ ok: true, id: "free-1", rev: "2-free" });

    store.dispatch(
      itemSlice.actions.setActiveItem(
        createSongDoc({
          _rev: "1-free",
          _id: "free-1",
          type: "free",
          slides,
          formattedSections: [
            { sectionNum: 4, words: "Section text", slideSpan: 1 },
          ],
        }),
      ),
    );
    store.dispatch(
      updateSlides({ slides, formattedSections: renamedSections }),
    );

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({ formattedSections: renamedSections }),
    );
    const savedItem = db.put.mock.calls[0][0];
    store.dispatch(itemSlice.actions.setActiveItem(savedItem));
    expect(store.getState().undoable.present.item.formattedSections).toEqual(
      renamedSections,
    );
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

  it("persists non-selected overlay docs when undo reverts a multi-overlay change", async () => {
    jest.useFakeTimers();

    let storeModule: any;
    let overlaySliceModule: any;
    let overlaysSliceModule: any;
    const getMock = jest.fn((id: string) => {
      if (id === "overlay-overlay-a") {
        return Promise.resolve({
          _id: id,
          _rev: "1-a",
          docType: "overlay",
          ...createOverlay("overlay-a", "Alpha"),
        });
      }
      if (id === "overlay-overlay-b") {
        return Promise.resolve({
          _id: id,
          _rev: "1-b",
          docType: "overlay",
          ...createOverlay("overlay-b", "Beta"),
        });
      }
      return Promise.reject(new Error(`Unexpected get ${id}`));
    });
    const putMock = jest.fn((doc: any) =>
      Promise.resolve({ rev: `${doc._rev || "1"}-next` }),
    );

    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: {
          get: getMock,
          put: putMock,
        },
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
    jest.runAllTimers();
    await flushListenerEffects();

    expect(getMock).toHaveBeenCalledWith("overlay-overlay-a");
    expect(putMock).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "overlay-overlay-a",
        id: "overlay-a",
      }),
    );
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
    store.dispatch(itemSlice.actions.setIsLyricsEditorOpen(true));
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
    const monitorInfo = toLegacyPresentationShape(
      store.getState().presentation,
    ).monitorInfo;
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

  it("keeps timer writes pending while Firebase is unavailable and flushes them after reconnect", async () => {
    let storeModule: any;
    let timersSliceModule: any;
    const setMock = jest.fn();
    const getMock = jest.fn(() => Promise.resolve({ val: () => [] }));
    const refMock = jest.fn((_db: unknown, path: string) => path);
    const globalFireDbInfo = {
      db: undefined as unknown,
      database: "main",
      churchId: "church-main",
      canWriteSharedData: true,
    };

    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo,
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
        endTime: "2026-04-05T12:00:05.000Z",
        showMinutesOnly: false,
        time: 100,
      }),
    );
    await waitForListenerDelay();

    expect(localStorage.getItem("timerInfo")).toContain("timer-1");
    expect(setMock).not.toHaveBeenCalled();
    expect(store.getState().timers.shouldUpdateTimers).toBe(true);

    globalFireDbInfo.db = "firebase-db";
    store.dispatch(timersSlice.actions.flushPendingTimerWrites());
    await waitForListenerDelay();

    expect(refMock).toHaveBeenCalledWith(
      "firebase-db",
      "churches/church-main/data/timers",
    );
    expect(setMock).toHaveBeenCalledWith("churches/church-main/data/timers", [
      expect.objectContaining({
        id: "timer-1",
        hostId: "host-123",
        status: "running",
        time: 100,
      }),
    ]);
    expect(store.getState().timers.shouldUpdateTimers).toBe(false);
  });

  it("does not overwrite a newer Firebase timer when flushing a stale pending local timer", async () => {
    let storeModule: any;
    let timersSliceModule: any;
    const remoteTimer = {
      id: "timer-1",
      hostId: "remote-host",
      name: "Remote Countdown",
      timerType: "timer",
      status: "running",
      isActive: true,
      countdownTime: "00:05",
      duration: 5,
      remainingTime: 4,
      endTime: "2026-04-05T12:00:05.000Z",
      showMinutesOnly: false,
      time: 200,
    };
    const setMock = jest.fn();
    const getMock = jest.fn(() =>
      Promise.resolve({
        val: () => [remoteTimer],
      }),
    );
    const refMock = jest.fn((_db: unknown, path: string) => path);
    const globalFireDbInfo = {
      db: undefined as unknown,
      database: "main",
      churchId: "church-main",
      canWriteSharedData: true,
    };

    jest.isolateModules(() => {
      jest.doMock("../context/controllerInfo", () => ({
        globalDb: undefined,
        globalBroadcastRef: undefined,
      }));
      jest.doMock("../context/globalInfo", () => ({
        globalFireDbInfo,
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
      timersSlice.actions.addTimer({
        id: "timer-1",
        hostId: "host-123",
        name: "Local Stale Countdown",
        timerType: "timer",
        status: "stopped",
        isActive: false,
        countdownTime: "00:05",
        duration: 5,
        remainingTime: 5,
        endTime: "2026-04-05T12:00:05.000Z",
        showMinutesOnly: false,
        time: 100,
      }),
    );
    await waitForListenerDelay();

    globalFireDbInfo.db = "firebase-db";
    store.dispatch(timersSlice.actions.flushPendingTimerWrites());
    await waitForListenerDelay();

    expect(setMock).toHaveBeenCalledWith("churches/church-main/data/timers", [
      expect.objectContaining({
        id: "timer-1",
        hostId: "remote-host",
        status: "running",
        time: 200,
      }),
    ]);
    expect(store.getState().timers.shouldUpdateTimers).toBe(false);
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
          canWriteSharedData: true,
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

  it("persists a selected default when creating the overlay templates document", async () => {
    jest.useFakeTimers();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { store, overlayTemplatesSlice, db } =
      loadStoreWithOverlayTemplatePersistence();
    db.get.mockRejectedValue(new Error("missing"));
    db.put.mockResolvedValue({
      ok: true,
      id: "overlay-templates",
      rev: "1-overlay-templates",
    });

    store.dispatch(overlayTemplatesSlice.actions.initiateTemplates(undefined));
    store.dispatch(
      overlayTemplatesSlice.actions.addTemplate({
        type: "participant",
        template: {
          id: "participant-default",
          name: "Participant default",
          formatting: {},
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z",
        },
      }),
    );
    store.dispatch(
      overlayTemplatesSlice.actions.setDefaultTemplate({
        type: "participant",
        templateId: "participant-default",
      }),
    );

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "overlay-templates",
        defaultTemplateIdsByType: {
          participant: "participant-default",
        },
      }),
    );
  });

  it("does not let a view-only display publish timers or service times", async () => {
    jest.useFakeTimers();
    const {
      store,
      serviceTimesSlice,
      timersSlice,
      setMock,
      runTransactionMock,
    } = loadStoreWithPresentationSync({ canWriteSharedData: false });

    store.dispatch(
      serviceTimesSlice.actions.initiateServices([
        {
          id: "service-1",
          name: "Remote Service",
          timerType: "countdown",
          reccurence: "one_time",
          dateTimeISO: "2026-04-05T12:00:00.000Z",
        },
      ]),
    );
    store.dispatch(
      timersSlice.actions.addTimer({
        id: "timer-1",
        hostId: "host-123",
        name: "Display Timer",
        timerType: "timer",
        status: "stopped",
        isActive: false,
        countdownTime: "00:05",
        duration: 5,
        remainingTime: 5,
        showMinutesOnly: false,
        time: 100,
      }),
    );
    store.dispatch(
      serviceTimesSlice.actions.addService({
        id: "service-2",
        name: "Blocked Display Edit",
        timerType: "countdown",
        reccurence: "one_time",
        dateTimeISO: "2026-04-05T12:30:00.000Z",
      }),
    );

    await jest.advanceTimersByTimeAsync(1600);

    expect(setMock).not.toHaveBeenCalled();
    expect(runTransactionMock).not.toHaveBeenCalled();
    expect(store.getState().timers.shouldUpdateTimers).toBe(false);
    expect(localStorage.getItem("timerInfo")).toContain("Display Timer");
  });

  it("merges a service-time update into Firebase without replacing other services", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-04-05T11:58:00.000Z"));
    const { store, serviceTimesSlice, refMock, runTransactionMock } =
      loadStoreWithPresentationSync();
    const remoteServices = [
      {
        id: "service-1",
        name: "Sunday Service",
        timerType: "countdown",
        reccurence: "one_time",
        dateTimeISO: "2026-04-05T12:00:00.000Z",
      },
      {
        id: "service-2",
        name: "Wednesday Service",
        timerType: "countdown",
        reccurence: "one_time",
        dateTimeISO: "2026-04-08T12:00:00.000Z",
      },
    ];
    let committedServices: any[] = [];
    runTransactionMock.mockImplementationOnce(
      async (_path: unknown, update: (current: unknown) => unknown) => {
        committedServices = update(remoteServices) as any[];
        return {
          committed: true,
          snapshot: { val: () => committedServices },
        };
      },
    );

    store.dispatch(
      serviceTimesSlice.actions.initiateServices([remoteServices[0]]),
    );
    store.dispatch(
      serviceTimesSlice.actions.updateService({
        id: "service-1",
        changes: { overrideDateTimeISO: "2026-04-05T12:05:00.000Z" },
      }),
    );

    await flushListenerEffects();

    expect(refMock).toHaveBeenCalledWith(
      "firebase-db",
      "churches/church-main/data/services",
    );
    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(committedServices).toEqual([
      expect.objectContaining({
        id: "service-1",
        overrideDateTimeISO: "2026-04-05T12:05:00.000Z",
        updatedAt: "2026-04-05T11:58:00.000Z",
      }),
      expect.objectContaining({ id: "service-2" }),
    ]);
    expect(store.getState().undoable.present.serviceTimes.list).toEqual(
      committedServices,
    );
  });

  it("attempts a service-time update when the connection monitor is disconnected", async () => {
    jest.useFakeTimers();
    const {
      store,
      serviceTimesSlice,
      registerPresentationSyncErrorHandler,
      runTransactionMock,
    } = loadStoreWithPresentationSync({ realtimeConnected: false });
    const syncErrorHandler = jest.fn();
    registerPresentationSyncErrorHandler(syncErrorHandler);
    const originalService = {
      id: "service-1",
      name: "Sunday Service",
      timerType: "countdown",
      reccurence: "one_time",
      dateTimeISO: "2026-04-05T12:00:00.000Z",
    };
    runTransactionMock.mockImplementationOnce(
      async (_path: unknown, update: (current: unknown) => unknown) => {
        const value = update([originalService]);
        return {
          committed: true,
          snapshot: { val: () => value },
        };
      },
    );

    store.dispatch(
      serviceTimesSlice.actions.initiateServices([originalService]),
    );
    store.dispatch(
      serviceTimesSlice.actions.updateService({
        id: "service-1",
        changes: { overrideDateTimeISO: "2026-04-05T12:05:00.000Z" },
      }),
    );

    await flushListenerEffects();

    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(store.getState().undoable.present.serviceTimes.list).toEqual([
      expect.objectContaining({
        ...originalService,
        overrideDateTimeISO: "2026-04-05T12:05:00.000Z",
      }),
    ]);
    expect(syncErrorHandler).not.toHaveBeenCalled();
  });

  it("rolls back a service-time update before Firebase is initialized", async () => {
    jest.useFakeTimers();
    const {
      store,
      serviceTimesSlice,
      registerPresentationSyncErrorHandler,
      runTransactionMock,
    } = loadStoreWithPresentationSync({ firebaseReady: false });
    const syncErrorHandler = jest.fn();
    registerPresentationSyncErrorHandler(syncErrorHandler);
    const originalService = {
      id: "service-1",
      name: "Sunday Service",
      timerType: "countdown",
      reccurence: "one_time",
      dateTimeISO: "2026-04-05T12:00:00.000Z",
    };

    store.dispatch(
      serviceTimesSlice.actions.initiateServices([originalService]),
    );
    store.dispatch(
      serviceTimesSlice.actions.updateService({
        id: "service-1",
        changes: { overrideDateTimeISO: "2026-04-05T12:05:00.000Z" },
      }),
    );

    await flushListenerEffects();

    expect(runTransactionMock).not.toHaveBeenCalled();
    expect(store.getState().undoable.present.serviceTimes.list).toEqual([
      originalService,
    ]);
    expect(syncErrorHandler).toHaveBeenCalledWith(
      "Live sync is not ready. Your change was not saved. Wait for it to finish connecting, then try again.",
    );
  });

  it("rolls back and reports a rejected service-time update", async () => {
    jest.useFakeTimers();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const {
      store,
      serviceTimesSlice,
      registerPresentationSyncErrorHandler,
      runTransactionMock,
    } = loadStoreWithPresentationSync();
    const syncErrorHandler = jest.fn();
    registerPresentationSyncErrorHandler(syncErrorHandler);
    runTransactionMock.mockRejectedValueOnce({ code: "PERMISSION_DENIED" });

    store.dispatch(
      serviceTimesSlice.actions.initiateServices([
        {
          id: "service-1",
          name: "Sunday Service",
          timerType: "countdown",
          reccurence: "one_time",
          dateTimeISO: "2026-04-05T12:00:00.000Z",
        },
      ]),
    );
    store.dispatch(
      serviceTimesSlice.actions.updateService({
        id: "service-1",
        changes: { overrideDateTimeISO: "2026-04-05T12:05:00.000Z" },
      }),
    );

    await flushListenerEffects();

    expect(store.getState().undoable.present.serviceTimes.list).toEqual([
      {
        id: "service-1",
        name: "Sunday Service",
        timerType: "countdown",
        reccurence: "one_time",
        dateTimeISO: "2026-04-05T12:00:00.000Z",
      },
    ]);
    expect(syncErrorHandler).toHaveBeenCalledWith(
      "Service time was not synced. Your change was not saved. Check your connection, then try again.",
    );
  });

  it("reconciles to Firebase when another device removed the edited service", async () => {
    jest.useFakeTimers();
    const { store, serviceTimesSlice, runTransactionMock } =
      loadStoreWithPresentationSync();
    runTransactionMock.mockImplementationOnce(
      async (_path: unknown, update: (current: unknown) => unknown) => {
        const value = update([]);
        return {
          committed: true,
          snapshot: { val: () => value },
        };
      },
    );

    store.dispatch(
      serviceTimesSlice.actions.initiateServices([
        {
          id: "service-1",
          name: "Sunday Service",
          timerType: "countdown",
          reccurence: "one_time",
          dateTimeISO: "2026-04-05T12:00:00.000Z",
        },
      ]),
    );
    store.dispatch(
      serviceTimesSlice.actions.updateService({
        id: "service-1",
        changes: { overrideDateTimeISO: "2026-04-05T12:05:00.000Z" },
      }),
    );
    await flushListenerEffects();

    expect(store.getState().undoable.present.serviceTimes.list).toEqual([]);
  });

  it("writes projector, monitor, and stream snapshots to Firebase and localStorage", () => {
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");
    const {
      store,
      writePresentationSnapshotToFirebase,
      presentationSlice,
      updateMock,
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
    expect(updateMock).toHaveBeenCalledWith(
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
    const { store, presentationSlice, updateMock } =
      loadStoreWithPresentationSync();

    store.dispatch(presentationSlice.actions.toggleProjectorTransmitting());
    updateMock.mockClear();

    store.dispatch(
      presentationSlice.actions.updateProjector(
        createScreenPresentation("projector", 111, {
          name: "Live Projector",
        }),
      ),
    );

    await waitForListenerDelay();

    expect(updateMock).toHaveBeenCalledWith(
      "churches/church-main/data/presentation",
      expect.objectContaining({
        projectorInfo: expect.objectContaining({ name: "Live Projector" }),
      }),
    );
  });

  it("pushes the current stream snapshot when stream transmission turns on", async () => {
    const { store, presentationSlice, updateMock } =
      loadStoreWithPresentationSync();

    store.dispatch(
      presentationSlice.actions.updateStreamFromRemote(
        createScreenPresentation("stream", 222, {
          name: "Remote Stream Snapshot",
        }),
      ),
    );
    updateMock.mockClear();

    store.dispatch(presentationSlice.actions.toggleStreamTransmitting());

    await waitForListenerDelay();

    expect(updateMock).toHaveBeenCalledWith(
      "churches/church-main/data/presentation",
      expect.objectContaining({
        streamInfo: expect.objectContaining({ name: "Remote Stream Snapshot" }),
      }),
    );
  });

  it("does not defer an overlay while the realtime socket is disconnected", async () => {
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const {
      store,
      presentationSlice,
      registerPresentationSyncErrorHandler,
      globalFireDbInfo,
      updateMock,
    } = loadStoreWithPresentationSync({ realtimeConnected: false });
    const deliveryErrorHandler = jest.fn();
    registerPresentationSyncErrorHandler(deliveryErrorHandler);

    store.dispatch(presentationSlice.actions.setTransmitToAll(true));
    store.dispatch(
      presentationSlice.actions.updateParticipantOverlayInfo({
        id: "participant-queued",
        name: "Queued speaker",
        title: "Pastor",
        duration: 10,
      }),
    );

    await waitForListenerDelay();

    expect(updateMock).not.toHaveBeenCalled();
    expect(setItemSpy).toHaveBeenCalledWith(
      "stream_participantOverlayInfo",
      expect.stringContaining("Queued speaker"),
    );

    globalFireDbInfo.isConnected = true;
    await waitForListenerDelay(50);

    expect(updateMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[firebase diagnostic]",
      expect.stringContaining('"event":"presentation_sync_write_unavailable"'),
    );
    expect(deliveryErrorHandler).toHaveBeenCalledWith(
      "Overlay update was not sent. Check your connection and try again.",
    );
  });

  it("does not publish unrelated pre-auth presentation state after hydration", async () => {
    const { store, presentationSlice, globalFireDbInfo, updateMock } =
      loadStoreWithPresentationSync({ firebaseReady: false });

    store.dispatch(
      presentationSlice.actions.updateProjector(
        createScreenPresentation("projector", 404, {
          name: "Pre-auth local projector",
        }),
      ),
    );
    await waitForListenerDelay();

    globalFireDbInfo.db = "firebase-db";
    await waitForListenerDelay(50);

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("reports but does not retry a rejected overlay write", async () => {
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const {
      store,
      presentationSlice,
      registerPresentationSyncErrorHandler,
      updateMock,
    } = loadStoreWithPresentationSync();
    const deliveryErrorHandler = jest.fn();
    registerPresentationSyncErrorHandler(deliveryErrorHandler);

    store.dispatch(presentationSlice.actions.setTransmitToAll(true));
    await waitForListenerDelay();
    updateMock.mockClear();
    updateMock
      .mockRejectedValueOnce({ code: "PERMISSION_DENIED" })
      .mockResolvedValueOnce(undefined);

    store.dispatch(
      presentationSlice.actions.updateImageOverlayInfo({
        id: "image-retry",
        imageUrl: "https://cdn.example.com/retry.png",
        duration: 10,
      }),
    );

    await waitForListenerDelay(220);

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[firebase diagnostic]",
      expect.stringContaining('"event":"firebase_operation_failed"'),
    );
    expect(deliveryErrorHandler).toHaveBeenCalledWith(
      "Overlay update was not sent. Check your connection and try again.",
    );
  });

  it("does not let a view-only display publish presentation state", async () => {
    const {
      store,
      writePresentationSnapshotToFirebase,
      presentationSlice,
      updateMock,
    } = loadStoreWithPresentationSync({ canWriteSharedData: false });

    store.dispatch(
      presentationSlice.actions.updateParticipantOverlayInfo({
        id: "display-overlay",
        name: "Display overlay",
        duration: 10,
      }),
    );

    await writePresentationSnapshotToFirebase(store.getState());

    expect(updateMock).not.toHaveBeenCalled();
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
    expect(
      toLegacyPresentationShape(store.getState().presentation).projectorInfo
        .name,
    ).toBe("Existing Projector");

    store.dispatch({
      type: "debouncedUpdateProjector",
      payload: createScreenPresentation("projector", 600, {
        name: "New Projector",
      }),
    });
    await waitForListenerDelay();
    expect(
      toLegacyPresentationShape(store.getState().presentation).projectorInfo
        .name,
    ).toBe("New Projector");
  });

  it("applies newer remote videoPlayback cues without a newer slide time", async () => {
    const { store, presentationSlice } = loadStoreWithPresentationSync();
    const slide = createScreenSlide("video-slide", "playing");
    const playingCue = {
      mediaKey: "remote:v1",
      positionSeconds: 10,
      paused: false,
      atServerMs: 1_000_000,
      generation: 5,
      applySeek: false,
    };
    const pausedCue = {
      ...playingCue,
      positionSeconds: 12,
      paused: true,
      atServerMs: 1_000_200,
      generation: 6,
    };

    store.dispatch(
      presentationSlice.actions.updateProjectorFromRemote(
        createScreenPresentation("projector", 500, {
          name: "Live Video",
          slide,
          videoPlayback: playingCue,
        }),
      ),
    );

    store.dispatch({
      type: "debouncedUpdateProjector",
      payload: createScreenPresentation("projector", 500, {
        name: "Live Video",
        slide,
        videoPlayback: pausedCue,
      }),
    });
    await waitForListenerDelay();

    expect(
      toLegacyPresentationShape(store.getState().presentation).projectorInfo
        .videoPlayback,
    ).toEqual(expect.objectContaining({ paused: true, generation: 6 }));
    expect(
      toLegacyPresentationShape(store.getState().presentation).projectorInfo
        .name,
    ).toBe("Live Video");

    store.dispatch({
      type: "debouncedUpdateProjector",
      payload: createScreenPresentation("projector", 500, {
        name: "Live Video",
        slide,
        videoPlayback: playingCue,
      }),
    });
    await waitForListenerDelay();

    expect(
      toLegacyPresentationShape(store.getState().presentation).projectorInfo
        .videoPlayback,
    ).toEqual(expect.objectContaining({ paused: true, generation: 6 }));
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
    expect(
      toLegacyPresentationShape(store.getState().presentation).monitorInfo.name,
    ).toBe("Existing Monitor");

    store.dispatch({
      type: "debouncedUpdateMonitor",
      payload: createScreenPresentation("monitor", 700, {
        name: "New Monitor",
        nextSlide: createScreenSlide("monitor-next-new", "next-new"),
      }),
    });
    await waitForListenerDelay();
    expect(
      toLegacyPresentationShape(store.getState().presentation).monitorInfo.name,
    ).toBe("New Monitor");
    expect(
      toLegacyPresentationShape(store.getState().presentation).monitorInfo
        .nextSlide,
    ).toEqual(createScreenSlide("monitor-next-new", "next-new"));
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
    expect(
      toLegacyPresentationShape(store.getState().presentation).streamInfo.name,
    ).toBe("Existing Stream");

    store.dispatch({
      type: "debouncedUpdateStream",
      payload: createScreenPresentation("stream", 900, {
        name: "New Stream",
      }),
    });
    await waitForListenerDelay();
    expect(
      toLegacyPresentationShape(store.getState().presentation).streamInfo.name,
    ).toBe("New Stream");
  });

  it("applies remote service-time updates to shared redux state", async () => {
    const { store, serviceTimesSlice } = loadStoreWithPresentationSync();

    store.dispatch(
      serviceTimesSlice.actions.initiateServices([
        {
          id: "service-1",
          name: "Existing Service",
          timerType: "countdown",
          reccurence: "one_time",
          dateTimeISO: "2026-04-05T12:00:00.000Z",
        },
      ]),
    );

    store.dispatch({
      type: "debouncedUpdateServiceTimes",
      payload: [
        {
          id: "service-2",
          name: "Remote Service",
          timerType: "countdown",
          reccurence: "one_time",
          dateTimeISO: "2026-04-05T12:30:00.000Z",
        },
      ],
    });
    await waitForListenerDelay();

    expect(store.getState().undoable.present.serviceTimes.list).toEqual([
      expect.objectContaining({
        id: "service-2",
        name: "Remote Service",
      }),
    ]);
    expect(store.getState().undoable.present.serviceTimes.isInitialized).toBe(
      true,
    );
    expect(localStorage.getItem("serviceTimes")).toContain("Remote Service");
  });

  it("applies remote bible info when local bible slot is still empty at the same timestamp", async () => {
    const { store, presentationSlice } = loadStoreWithPresentationSync();

    store.dispatch(
      presentationSlice.actions.updateFormattedTextDisplayInfoFromRemote({
        text: "",
        time: 1000,
      }),
    );

    store.dispatch({
      type: "debouncedUpdateBibleDisplayInfo",
      payload: { title: "John 3:16", text: "For God so loved", time: 1000 },
    });
    await waitForListenerDelay();

    const bible = toLegacyPresentationShape(store.getState().presentation)
      .streamInfo.bibleDisplayInfo;
    expect(bible?.title).toBe("John 3:16");
    expect(bible?.text).toBe("For God so loved");
    expect(
      toLegacyPresentationShape(store.getState().presentation).streamInfo.type,
    ).toBe("bible");
  });

  it("ignores a live remote participant overlay when the local slot only has a newer empty placeholder", async () => {
    const { store } = loadStoreWithPresentationSync();

    store.dispatch({
      type: "debouncedUpdateParticipantOverlayInfo",
      payload: { id: "p0", name: "Initial", title: "Host", time: 900 },
    });
    await waitForListenerDelay();

    store.dispatch({
      type: "debouncedUpdateParticipantOverlayInfo",
      payload: { time: 1001, transitionSequence: 11 },
    });
    await waitForListenerDelay();

    store.dispatch({
      type: "debouncedUpdateParticipantOverlayInfo",
      payload: {
        id: "p1",
        name: "Alex",
        title: "Host",
        time: 1000,
        transitionSequence: 10,
      },
    });
    await waitForListenerDelay();

    const participant = toLegacyPresentationShape(store.getState().presentation)
      .streamInfo.participantOverlayInfo;
    expect(participant?.name ?? "").toBe("");
    expect(participant?.title ?? "").toBe("");
    expect(participant?.time).toBe(1001);
    expect(participant?.transitionSequence).toBe(11);
  });

  it("applies a live remote participant overlay when the local slot has no ordering markers yet", async () => {
    const { store } = loadStoreWithPresentationSync();

    store.dispatch({
      type: "debouncedUpdateParticipantOverlayInfo",
      payload: {
        id: "p1",
        name: "Alex",
        title: "Host",
        time: 1000,
        transitionSequence: 10,
      },
    });
    await waitForListenerDelay();

    const participant = toLegacyPresentationShape(store.getState().presentation)
      .streamInfo.participantOverlayInfo;
    expect(participant?.id).toBe("p1");
    expect(participant?.name).toBe("Alex");
    expect(participant?.title).toBe("Host");
    expect(participant?.time).toBe(1000);
    expect(participant?.transitionSequence).toBe(10);
  });

  it("applies a newer remote participant overlay transition when sequence is higher even if timestamp is lower", async () => {
    const { store, presentationSlice } = loadStoreWithPresentationSync();

    store.dispatch(
      presentationSlice.actions.updateParticipantOverlayInfoFromRemote({
        id: "p-old",
        name: "Old Host",
        time: 1000,
        transitionSequence: 10,
      }),
    );

    store.dispatch({
      type: "debouncedUpdateParticipantOverlayInfo",
      payload: {
        id: "p-new",
        name: "New Host",
        time: 999,
        transitionSequence: 11,
      },
    });
    await waitForListenerDelay();

    const participant = toLegacyPresentationShape(store.getState().presentation)
      .streamInfo.participantOverlayInfo;
    expect(participant?.id).toBe("p-new");
    expect(participant?.name).toBe("New Host");
    expect(participant?.time).toBe(999);
    expect(participant?.transitionSequence).toBe(11);
  });
});

const loadStoreWithItemListPersistence = () => {
  let storeModule: any;
  let itemListSliceModule: any;
  let itemListsSliceModule: any;
  const postMessage = jest.fn();
  const db = {
    get: jest.fn(),
    put: jest
      .fn()
      .mockResolvedValue({ ok: true, id: "outline-a", rev: "2-saved" }),
  };

  jest.isolateModules(() => {
    jest.doMock("../context/controllerInfo", () => ({
      globalDb: db,
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
    storeModule = require("./store");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    itemListSliceModule = require("./itemListSlice");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    itemListsSliceModule = require("./itemListsSlice");
  });

  return {
    store: storeModule.default,
    itemListSlice: itemListSliceModule.itemListSlice,
    itemListsSlice: itemListsSliceModule.itemListsSlice,
    db,
    postMessage,
  };
};

describe("item list outline persistence", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createServiceItem } = require("../test/fixtures");

  const hydrateOutline = (
    store: any,
    itemListSlice: any,
    itemListsSlice: any,
  ) => {
    store.dispatch(
      itemListsSlice.actions.initiateItemLists([
        { _id: "outline-a", name: "Sunday" },
      ]),
    );
    store.dispatch(
      itemListSlice.actions.initiateItemList([
        createServiceItem({ name: "Current", _id: "song-1", listId: "l1" }),
      ]),
    );
  };

  it("persists the post-debounce outline list onto the latest document rev", async () => {
    jest.useFakeTimers();
    const { store, itemListSlice, itemListsSlice, db, postMessage } =
      loadStoreWithItemListPersistence();
    db.get.mockResolvedValue({
      _id: "outline-a",
      _rev: "5-newer",
      items: [
        createServiceItem({ name: "Current", _id: "song-1", listId: "l1" }),
      ],
      overlays: ["overlay-1"],
    });

    hydrateOutline(store, itemListSlice, itemListsSlice);
    store.dispatch(
      itemListSlice.actions.updateItemList([
        createServiceItem({ name: "Current", _id: "song-1", listId: "l1" }),
        createServiceItem({ name: "Added", _id: "song-2", listId: "l2" }),
      ]),
    );

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "outline-a",
        _rev: "5-newer",
        overlays: ["overlay-1"],
        items: expect.arrayContaining([
          expect.objectContaining({ name: "Added" }),
        ]),
      }),
    );
    expect(postMessage).toHaveBeenCalled();
    expect(store.getState().undoable.present.itemList.hasPendingUpdate).toBe(
      false,
    );
  });

  it("discards a delayed outline save after a remote hydrate during debounce", async () => {
    jest.useFakeTimers();
    const { store, itemListSlice, itemListsSlice, db } =
      loadStoreWithItemListPersistence();

    hydrateOutline(store, itemListSlice, itemListsSlice);
    store.dispatch(
      itemListSlice.actions.updateItemList([
        createServiceItem({ name: "Stale Local", _id: "old", listId: "lo" }),
      ]),
    );
    store.dispatch(
      itemListSlice.actions.updateItemListFromRemote([
        createServiceItem({
          name: "Remote Current",
          _id: "r1",
          listId: "lr",
        }),
      ]),
    );

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.put).not.toHaveBeenCalled();
    expect(store.getState().undoable.present.itemList.list[0].name).toBe(
      "Remote Current",
    );
    expect(store.getState().undoable.present.itemList.hasPendingUpdate).toBe(
      false,
    );
  });

  it("still persists after selection changes during debounce", async () => {
    jest.useFakeTimers();
    const { store, itemListSlice, itemListsSlice, db } =
      loadStoreWithItemListPersistence();
    db.get.mockResolvedValue({
      _id: "outline-a",
      _rev: "1-base",
      items: [
        createServiceItem({ name: "Current", _id: "song-1", listId: "l1" }),
      ],
      overlays: [],
    });

    hydrateOutline(store, itemListSlice, itemListsSlice);
    store.dispatch(
      itemListSlice.actions.updateItemList([
        createServiceItem({ name: "Current", _id: "song-1", listId: "l1" }),
        createServiceItem({ name: "Added", _id: "song-2", listId: "l2" }),
      ]),
    );
    store.dispatch(itemListSlice.actions.setActiveItemInList("l2"));

    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ name: "Added" }),
        ]),
      }),
    );
  });
});

const loadStoreWithAllItemsPersistence = () => {
  let storeModule: any;
  let allItemsSliceModule: any;
  const postMessage = jest.fn();
  const db = {
    get: jest.fn().mockResolvedValue({ _id: "allItems", items: [] }),
    put: jest.fn().mockResolvedValue({ ok: true, id: "allItems", rev: "2" }),
  };

  jest.isolateModules(() => {
    jest.doMock("../context/controllerInfo", () => ({
      globalDb: db,
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
    storeModule = require("./store");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    allItemsSliceModule = require("./allItemsSlice");
  });

  return { store: storeModule.default, allItemsSlice: allItemsSliceModule, db };
};

describe("allItems persistence", () => {
  it("keeps timer search changes UI-only while persisting library mutations", async () => {
    jest.useFakeTimers();
    const { store, allItemsSlice, db } = loadStoreWithAllItemsPersistence();
    store.dispatch(allItemsSlice.setIsInitialized(true));

    store.dispatch(allItemsSlice.setTimerSearchValue("countdown"));
    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();
    expect(db.put).not.toHaveBeenCalled();

    store.dispatch(
      allItemsSlice.addItemToAllItemsList({
        _id: "timer-1",
        name: "Countdown",
        type: "timer",
        listId: "timer-1",
        background: "",
      }),
    );
    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "allItems",
        items: [expect.objectContaining({ _id: "timer-1" })],
      }),
    );
    jest.useRealTimers();
  });
});

const loadStoreWithControllerMediaFolders = () => {
  let storeModule: any;
  let preferencesModule: any;
  let rev = 1;
  const docs = new Map<string, Record<string, unknown>>();
  const postMessage = jest.fn();
  const notFound = Object.assign(new Error("missing"), { status: 404, name: "not_found" });
  const db = {
    get: jest.fn(async (id: string) => {
      const doc = docs.get(id);
      if (!doc) throw notFound;
      return { ...doc };
    }),
    put: jest.fn(async (doc: Record<string, unknown>) => {
      const next = { ...doc, _rev: `${rev++}-test` };
      docs.set(String(doc._id), next);
      return { ok: true, rev: next._rev };
    }),
  };
  jest.isolateModules(() => {
    jest.doMock("../context/controllerInfo", () => ({ globalDb: db, globalBroadcastRef: { postMessage } }));
    jest.doMock("../context/globalInfo", () => ({ globalFireDbInfo: { db: undefined, churchId: undefined }, globalHostId: "host-123" }));
    jest.doMock("firebase/database", () => ({ ref: jest.fn(), set: jest.fn(), get: jest.fn() }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    storeModule = require("./store");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    preferencesModule = require("./preferencesSlice");
  });
  return { store: storeModule.default, preferences: preferencesModule, docs, db, postMessage };
};

describe("controller media folder persistence", () => {
  it("writes and broadcasts only the scoped folder doc", async () => {
    jest.useFakeTimers();
    const { store, preferences, docs, db, postMessage } = loadStoreWithControllerMediaFolders();
    store.dispatch(preferences.setIsInitialized(true));
    store.dispatch(preferences.initiateMediaRouteFolders({ controllerProfileId: "aux-1", mediaRouteFolders: {} }));
    store.dispatch(preferences.setMediaRouteFolder({ controllerProfileId: "aux-1", key: "controller-item-image", folderId: "videos" }));
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1500);
    await flushListenerEffects();

    expect([...docs.keys()]).toEqual(["mediaRouteFolders:aux-1"]);
    expect(db.put).toHaveBeenCalledTimes(2);
    expect(db.put.mock.calls.every(([doc]) => doc._id === "mediaRouteFolders:aux-1")).toBe(true);
    expect(postMessage.mock.calls[0][0].data.docs[0]).toMatchObject({
      _id: "mediaRouteFolders:aux-1",
      controllerProfileId: "aux-1",
      mediaRouteFolders: { "controller-item-image": "videos" },
    });
    jest.useRealTimers();
  });
});
