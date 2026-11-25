import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, useSelector } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import store from "../store/store";
import { flushItemCacheChanges } from "../store/itemCacheSync";
import ControllerInfoProvider, {
  canRetrySync413,
  cancelSongV2CleanupMaintenance,
  ControllerInfoContext,
  nextSyncBatchSize,
  scheduleSongV2CleanupMaintenance,
} from "./controllerInfo";
import { GlobalInfoContext } from "./globalInfo";
import { createMockGlobalContext } from "../test/mocks";
import { hasSuccessfulInitialContentReplication } from "../utils/contentReplicationActivity";
import * as startupDiagnostics from "../utils/startupDiagnostics";

jest.mock("../utils/startupDiagnostics", () => {
  const actual = jest.requireActual("../utils/startupDiagnostics");
  return {
    ...actual,
    getStartupDiagnosticMode: jest.fn(() => "off"),
    isStartupDiagnosticsActive: jest.fn(() => false),
    recordStartupDiagnostic: jest.fn(),
    beginStartupReplication: jest.fn(() => ({
      recordBatch: jest.fn(),
      recordRetry: jest.fn(),
      finish: jest.fn(),
    })),
  };
});

const mockPouchInstances: Array<{
  name: string;
  get: jest.Mock;
  put: jest.Mock;
  destroy: jest.Mock;
  bulkDocs: jest.Mock;
  allDocs: jest.Mock;
  changes: jest.Mock;
  sync: jest.Mock;
  replicate: { to: jest.Mock };
}> = [];
let mockLocalItemDocs: Array<Record<string, unknown>> = [];
const liveSyncHandles: Array<{
  cancel: jest.Mock;
  emit: (event: string, value?: any) => void;
}> = [];
const liveSyncBatchSizes: number[] = [];
const liveSyncOwners: string[] = [];
const liveSyncOptions: Array<Record<string, unknown>> = [];
const replicationCalls: Array<{ name: string; options?: Record<string, unknown> }> = [];
const initialPullHandles: Array<{ emit: (event: string, value?: any) => void }> = [];
const changeFeedHandles: Array<{
  databaseName: string;
  emit: (event: string, value?: any) => void;
}> = [];
let completeInitialPullAutomatically = true;
let localPouchConstructorFailureName: string | null = null;
let deferredLocalItemSnapshot: Promise<unknown> | null = null;
const verifiedCheckpointDatabaseNames = new Set<string>();

const createSyncHandle = (completeAfterSetup = false) => {
  const listeners = new Map<string, (value?: any) => void>();
  let handle: { cancel: jest.Mock; on: jest.Mock; emit: (event: string, value?: any) => void };
  handle = {
    cancel: jest.fn(),
    on: jest.fn((event: string, listener: (value?: any) => void) => {
      listeners.set(event, listener);
      if (event === "complete" && completeAfterSetup) setTimeout(() => listener({}), 0);
      return handle;
    }),
    emit: (event: string, value?: any) => listeners.get(event)?.(value),
  };
  return handle;
};

jest.mock("pouchdb-browser", () => {
  const PouchDBMock = jest.fn().mockImplementation((name: string) => {
    if (name === localPouchConstructorFailureName) {
      throw new Error("Local PouchDB initialization failed");
    }
    const localDocs = new Map<string, Record<string, unknown>>();
    const instance = {
      name,
      get: jest.fn(async (id: string) => {
        if (
          id === "_local/worship-sync-initial-content-replication-v1" &&
          verifiedCheckpointDatabaseNames.has(name)
        ) {
          return {
            _id: id,
            localDatabaseName: name,
            sourceDatabaseName: name,
            complete: true,
          };
        }
        const doc = localDocs.get(id);
        if (!doc) throw Object.assign(new Error("missing"), { status: 404, name: "not_found" });
        return { ...doc };
      }),
      put: jest.fn(async (doc: Record<string, unknown>) => {
        const stored = { ...doc, _rev: "1-local" };
        localDocs.set(String(doc._id), stored);
        return { ok: true, id: doc._id, rev: "1-local" };
      }),
      destroy: jest.fn().mockResolvedValue(undefined),
      bulkDocs: jest.fn().mockResolvedValue([]),
      allDocs: jest.fn().mockImplementation(() => deferredLocalItemSnapshot ?? Promise.resolve({ update_seq: 0, rows: mockLocalItemDocs.map((doc) => ({ doc })) })),
      sync: jest.fn((_remote: unknown, options?: Record<string, unknown>) => {
        liveSyncOwners.push(name);
        liveSyncOptions.push(options ?? {});
        if (typeof options?.batch_size === "number") liveSyncBatchSizes.push(options.batch_size);
        const handle = createSyncHandle();
        liveSyncHandles.push(handle);
        return handle;
      }),
      replicate: {
        to: jest.fn((_target: unknown, options?: Record<string, unknown>) => {
          replicationCalls.push({ name, options });
          const handle = createSyncHandle(completeInitialPullAutomatically);
          if (!name.includes("bibles")) initialPullHandles.push(handle);
          return handle;
        }),
      },
      changes: jest.fn(() => {
        const handle = createSyncHandle();
        changeFeedHandles.push({ databaseName: name, emit: handle.emit });
        return handle;
      }),
    };
    mockPouchInstances.push(instance);
    return instance;
  });

  return {
    __esModule: true,
    default: PouchDBMock,
  };
});

const Probe = () => {
  const context = React.useContext(ControllerInfoContext);
  const itemName = useSelector((state: ReturnType<typeof store.getState>) => state.allDocs.allSongDocs[0]?.name);
  return (
    <div>
      <div data-testid="cache-name">{itemName}</div>
      <div data-testid="progress">{context?.dbProgress}</div>
      <div data-testid="status">{context?.connectionStatus.status}</div>
      <div data-testid="message">{context?.connectionStatus.message}</div>
      <div data-testid="has-db">{context?.db ? "yes" : "no"}</div>
      <div data-testid="bootstrap-ready">{context?.bootstrapReady ? "yes" : "no"}</div>
      <div data-testid="startup-stage">{context?.startupInfo?.stage}</div>
      <div data-testid="startup-failure">{context?.startupInfo?.failure?.kind}</div>
      <button type="button" onClick={() => context?.pullFromRemote()}>Pull</button>
    </div>
  );
};

describe("ControllerInfoProvider", () => {
  const renderAuthenticatedStartup = (path = "/workstation/operator") => render(
    <Provider store={store}>
      <GlobalInfoContext.Provider value={createMockGlobalContext({
        loginState: "success",
        sessionKind: "workstation",
        database: "startup-test-church",
      }) as any}>
        <MemoryRouter initialEntries={[path]}>
          <ControllerInfoProvider><Probe /></ControllerInfoProvider>
        </MemoryRouter>
      </GlobalInfoContext.Provider>
    </Provider>,
  );

  const resolveCouchSession = () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ success: true }),
    });
  };

  beforeEach(() => {
    mockLocalItemDocs = [];
    mockPouchInstances.length = 0;
    liveSyncHandles.length = 0;
    liveSyncBatchSizes.length = 0;
    liveSyncOwners.length = 0;
    liveSyncOptions.length = 0;
    replicationCalls.length = 0;
    initialPullHandles.length = 0;
    changeFeedHandles.length = 0;
    completeInitialPullAutomatically = true;
    localPouchConstructorFailureName = null;
    deferredLocalItemSnapshot = null;
    verifiedCheckpointDatabaseNames.clear();
    jest.mocked(startupDiagnostics.getStartupDiagnosticMode).mockReturnValue("off");
    jest.mocked(startupDiagnostics.recordStartupDiagnostic).mockClear();
    global.fetch = jest.fn() as jest.Mock;
    (global as unknown as { BroadcastChannel: typeof BroadcastChannel }).BroadcastChannel =
      jest.fn().mockImplementation(() => ({
        close: jest.fn(),
        postMessage: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })) as unknown as typeof BroadcastChannel;
  });

  afterEach(() => {
    jest.mocked(startupDiagnostics.getStartupDiagnosticMode).mockReturnValue("off");
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("hydrates and listens on the Services route before the remote session resolves", async () => {
    let resolveSession!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockReturnValue(new Promise((resolve) => { resolveSession = resolve; }));
    mockLocalItemDocs = [{ _id: "song", type: "song", name: "Offline local song" }];
    const view = render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext({ database: "offline-church" }) as any}>
          <MemoryRouter initialEntries={["/teams/services"]}>
            <ControllerInfoProvider><Probe /></ControllerInfoProvider>
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    await waitFor(() => expect(screen.getByTestId("cache-name")).toHaveTextContent("Offline local song"));
    expect(liveSyncHandles).toHaveLength(0);
    const localDb = mockPouchInstances.find((instance) => instance.name === "worship-sync-offline-church")!;
    expect(localDb.allDocs).toHaveBeenCalledTimes(1);
    const feed = localDb.changes.mock.results[0].value;
    await act(async () => {
      feed.emit("change", { seq: 1, id: "song", doc: { _id: "song", type: "song", name: "Local edit" } });
      await flushItemCacheChanges(localDb as never);
    });
    expect(screen.getByTestId("cache-name")).toHaveTextContent("Local edit");
    mockLocalItemDocs = [{ _id: "song", type: "song", name: "New session" }];
    act(() => { store.dispatch({ type: "RESET" }); });
    await waitFor(() => expect(screen.getByTestId("cache-name")).toHaveTextContent("New session"));
    expect(localDb.allDocs).toHaveBeenCalledTimes(2);
    act(() => feed.emit("change", { seq: 2, id: "song", doc: { _id: "song", type: "song", name: "Retired session" } }));
    expect(screen.getByTestId("cache-name")).toHaveTextContent("New session");
    view.unmount();
    expect(feed.cancel).toHaveBeenCalled();
    expect(store.getState().allDocs.allSongDocs).toEqual([]);
    await act(async () => { resolveSession({ headers: { get: () => "application/json" }, json: async () => ({ success: true }) }); });
  });

  it("sets up guest mode from the bundled seed without a server session", async () => {
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider
          value={
            createMockGlobalContext({
              loginState: "guest",
              sessionKind: null,
              database: "demo",
            }) as any
          }
        >
          <MemoryRouter initialEntries={["/controller"]}>
            <ControllerInfoProvider>
              <Probe />
            </ControllerInfoProvider>
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("has-db")).toHaveTextContent("yes");
    });

    expect(screen.getByTestId("progress")).toHaveTextContent("100");
    expect(screen.getByTestId("status")).toHaveTextContent("connected");
    expect(global.fetch).not.toHaveBeenCalled();

    const seededDb = mockPouchInstances.find(
      (instance) =>
        instance.name === "worship-sync-demo-guest" &&
        instance.bulkDocs.mock.calls.length > 0,
    );
    expect(seededDb?.bulkDocs).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ _id: "ItemLists" }),
        expect.objectContaining({ _id: "offline-demo-outline" }),
      ]),
    );
  });

  it("skips both database initializations without starting session retries", async () => {
    jest.mocked(startupDiagnostics.getStartupDiagnosticMode).mockReturnValue("skip-databases");
    renderAuthenticatedStartup();

    await waitFor(() => expect(screen.getByTestId("startup-stage")).toHaveTextContent("idle"));
    expect(mockPouchInstances).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("has-db")).toHaveTextContent("no");
    expect(startupDiagnostics.recordStartupDiagnostic).toHaveBeenCalledWith(
      "startup",
      "database-plan",
      expect.objectContaining({
        mode: "skip-databases",
        content: false,
        bible: false,
        contentInitialPullBatchSize: 150,
        contentInitialPullBatchesLimit: 15,
        bibleInitialPullBatchSize: 1000,
        bibleInitialPullBatchesLimit: 25,
      }),
    );
  });

  it("initializes content only with the original baseline settings", async () => {
    jest.mocked(startupDiagnostics.getStartupDiagnosticMode).mockReturnValue("content-only");
    resolveCouchSession();
    renderAuthenticatedStartup();

    await waitFor(() => expect(replicationCalls).toHaveLength(1));
    expect(replicationCalls[0].name).not.toContain("bibles");
    expect(replicationCalls[0].options).toEqual(expect.objectContaining({
      batch_size: 150,
      batches_limit: 15,
      selector: { _id: { $ne: "media" } },
    }));
    await waitFor(() => expect(screen.getByTestId("startup-stage")).toHaveTextContent("completed"));
    expect(startupDiagnostics.recordStartupDiagnostic).not.toHaveBeenCalledWith(
      "startup",
      "application.ready",
      expect.anything(),
    );
  });

  it("initializes Bible only when its authenticated database session is ready", async () => {
    jest.mocked(startupDiagnostics.getStartupDiagnosticMode).mockReturnValue("bible-only");
    resolveCouchSession();
    renderAuthenticatedStartup();

    await waitFor(() => expect(replicationCalls).toHaveLength(1));
    expect(replicationCalls[0].name).toContain("bibles");
    expect(replicationCalls[0].options).toEqual(expect.objectContaining({
      batch_size: 1000,
      batches_limit: 25,
    }));
    expect(mockPouchInstances.some((instance) => instance.name === "worship-sync-startup-test-church")).toBe(false);
  });

  it("uses the bounded queue for both database initial pulls", async () => {
    jest.mocked(startupDiagnostics.getStartupDiagnosticMode).mockReturnValue("bounded-batches");
    resolveCouchSession();
    renderAuthenticatedStartup();

    await waitFor(() => expect(replicationCalls).toHaveLength(2));
    expect(replicationCalls.map(({ options }) => [options?.batch_size, options?.batches_limit])).toEqual([
      [100, 2],
      [100, 2],
    ]);
    expect(startupDiagnostics.recordStartupDiagnostic).toHaveBeenCalledWith(
      "startup",
      "database-plan",
      expect.objectContaining({
        mode: "bounded-batches",
        contentInitialPullBatchSize: 100,
        contentInitialPullBatchesLimit: 2,
        bibleInitialPullBatchSize: 100,
        bibleInitialPullBatchesLimit: 2,
      }),
    );
  });

  it("uses smaller batch and queue settings for both databases", async () => {
    jest.mocked(startupDiagnostics.getStartupDiagnosticMode).mockReturnValue("reduced-batches");
    resolveCouchSession();
    renderAuthenticatedStartup();

    await waitFor(() => expect(replicationCalls).toHaveLength(2));
    expect(replicationCalls.map(({ options }) => [options?.batch_size, options?.batches_limit])).toEqual([
      [25, 2],
      [25, 2],
    ]);
  });

  it("waits for content's initial pull before opening the Bible database in sequential mode", async () => {
    jest.mocked(startupDiagnostics.getStartupDiagnosticMode).mockReturnValue("sequential");
    resolveCouchSession();
    completeInitialPullAutomatically = false;
    let resolveItemSnapshot!: (value: unknown) => void;
    deferredLocalItemSnapshot = new Promise((resolve) => { resolveItemSnapshot = resolve; });
    renderAuthenticatedStartup();

    await waitFor(() => expect(mockPouchInstances.find(({ name }) => name === "worship-sync-startup-test-church")?.allDocs).toHaveBeenCalled());
    expect(replicationCalls).toHaveLength(0);
    expect(mockPouchInstances.some((instance) => instance.name === "worship-sync-bibles")).toBe(false);

    await act(async () => {
      resolveItemSnapshot({ update_seq: 0, rows: [] });
    });
    await waitFor(() => expect(replicationCalls).toHaveLength(1));
    expect(replicationCalls[0].name).not.toContain("bibles");
    expect(replicationCalls[0].options).toEqual(expect.objectContaining({
      batch_size: 150,
      batches_limit: 15,
    }));
    expect(mockPouchInstances.some((instance) => instance.name === "worship-sync-bibles")).toBe(false);

    await act(async () => {
      initialPullHandles[0].emit("complete", { ok: true });
    });
    await waitFor(() => expect(replicationCalls).toHaveLength(2));
    expect(replicationCalls[1].name).toContain("bibles");
    expect(replicationCalls[1].options).toEqual(expect.objectContaining({
      batch_size: 1000,
      batches_limit: 25,
    }));
    await waitFor(() => expect(screen.getByTestId("startup-stage")).toHaveTextContent("completed"));
    expect(startupDiagnostics.recordStartupDiagnostic).toHaveBeenCalledWith(
      "startup",
      "application.ready",
      expect.objectContaining({ sessionKind: "authenticated" }),
    );
  });

  it("keeps subsequent Bible synchronization active with the original settings", async () => {
    resolveCouchSession();
    const { unmount } = renderAuthenticatedStartup();

    await waitFor(() => expect(
      replicationCalls.some(({ name }) => name.includes("bibles")),
    ).toBe(true));
    await waitFor(() => expect(
      changeFeedHandles.some(({ databaseName }) => databaseName.includes("bibles")),
    ).toBe(true));
    expect(replicationCalls.find(({ name }) => name.includes("bibles"))?.options).toEqual(
      expect.objectContaining({ batch_size: 1000, batches_limit: 25 }),
    );

    jest.useFakeTimers();
    try {
      const bibleChangeFeed = changeFeedHandles.find(({ databaseName }) =>
        databaseName.includes("bibles"),
      )!;
      act(() => bibleChangeFeed.emit("change"));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });
      const bibleLiveSyncIndex = liveSyncOwners.lastIndexOf("worship-sync-bibles");
      expect(bibleLiveSyncIndex).toBeGreaterThanOrEqual(0);
      expect(liveSyncOptions[bibleLiveSyncIndex]).toEqual(expect.objectContaining({
        retry: true,
        batch_size: 1000,
        batches_limit: 25,
      }));
    } finally {
      unmount();
      jest.useRealTimers();
    }
  });
});

describe("controller replication 413 batch policy", () => {
  beforeEach(() => {
    mockLocalItemDocs = [];
    mockPouchInstances.length = 0;
    liveSyncHandles.length = 0;
    liveSyncBatchSizes.length = 0;
    liveSyncOwners.length = 0;
    liveSyncOptions.length = 0;
    replicationCalls.length = 0;
    initialPullHandles.length = 0;
    changeFeedHandles.length = 0;
    completeInitialPullAutomatically = true;
    localPouchConstructorFailureName = null;
    verifiedCheckpointDatabaseNames.clear();
    global.fetch = jest.fn() as jest.Mock;
    (global as unknown as { BroadcastChannel: typeof BroadcastChannel }).BroadcastChannel =
      jest.fn().mockImplementation(() => ({
        close: jest.fn(),
        postMessage: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })) as unknown as typeof BroadcastChannel;
  });

  it("reduces batch sizes down to one and stops restarting at one", () => {
    const sizes = [40];
    while (canRetrySync413(sizes[sizes.length - 1])) {
      sizes.push(nextSyncBatchSize(sizes[sizes.length - 1]));
    }
    expect(sizes).toEqual([40, 20, 10, 5, 2, 1]);
    expect(canRetrySync413(1)).toBe(false);
  });

  it("restarts with smaller batches through one handle and blocks at size one", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      headers: { get: () => "application/json" },
      json: async () => ({ success: true }),
    });
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <MemoryRouter initialEntries={["/controller"]}>
            <ControllerInfoProvider><Probe /></ControllerInfoProvider>
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    await waitFor(() => expect(liveSyncHandles).toHaveLength(1));

    for (let index = 0; index < 5; index += 1) {
      const current = liveSyncHandles[liveSyncHandles.length - 1];
      act(() => current.emit("error", { status: 413, message: "Content Too Large" }));
      await waitFor(() => expect(liveSyncHandles).toHaveLength(index + 2));
      expect(current.cancel).toHaveBeenCalledTimes(1);
    }

    const smallestBatch = liveSyncHandles[liveSyncHandles.length - 1];
    act(() => smallestBatch.emit("error", { status: 413, message: "Content Too Large" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("failed"));
    expect(liveSyncHandles).toHaveLength(6);
    expect(liveSyncBatchSizes).toEqual([40, 20, 10, 5, 2, 1]);
    expect(liveSyncOptions[0]).toEqual(expect.objectContaining({
      selector: { _id: { $ne: "media" } },
    }));
    expect(smallestBatch.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("message")).toHaveTextContent("one database document is too large");
  });

  it("replaces an auth-failed live handle after renewing the session", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      headers: { get: () => "application/json" },
      json: async () => ({ success: true }),
    });
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <MemoryRouter initialEntries={["/controller"]}>
            <ControllerInfoProvider><Probe /></ControllerInfoProvider>
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    await waitFor(() => expect(liveSyncHandles).toHaveLength(1));
    const failedHandle = liveSyncHandles[0];
    act(() => failedHandle.emit("denied", { status: 401, name: "unauthorized" }));
    await waitFor(() => expect(liveSyncHandles).toHaveLength(2));
    expect(failedHandle.cancel).toHaveBeenCalledTimes(1);
    expect(liveSyncHandles[1].cancel).not.toHaveBeenCalled();
    act(() => liveSyncHandles[1].emit("active"));
    expect(screen.getByTestId("status")).toHaveTextContent("connected");
  });

  it("excludes the legacy media aggregate from startup and reconnect pulls", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      headers: { get: () => "application/json" },
      json: async () => ({ success: true }),
    });
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <MemoryRouter initialEntries={["/controller"]}>
            <ControllerInfoProvider><Probe /></ControllerInfoProvider>
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    await waitFor(() => expect(liveSyncHandles).toHaveLength(1));

    const startupPull = replicationCalls.find(({ options }) => options?.batch_size === 150);
    expect(startupPull?.options).toEqual(expect.objectContaining({
      selector: { _id: { $ne: "media" } },
    }));

    fireEvent.click(screen.getByRole("button", { name: "Pull" }));
    await waitFor(() => expect(replicationCalls.filter(({ options }) => options?.retry === false)).toHaveLength(1));
    expect(replicationCalls.find(({ options }) => options?.retry === false)?.options).toEqual(expect.objectContaining({
      selector: { _id: { $ne: "media" } },
    }));
  });

  it("does not expose initial content replication as complete until its successful pull settles", async () => {
    completeInitialPullAutomatically = false;
    (global.fetch as jest.Mock).mockResolvedValue({
      headers: { get: () => "application/json" },
      json: async () => ({ success: true }),
    });
    const databaseName = "worship-sync-test";
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <MemoryRouter initialEntries={["/controller"]}>
            <ControllerInfoProvider><Probe /></ControllerInfoProvider>
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => expect(initialPullHandles.length).toBeGreaterThan(0));
    expect(hasSuccessfulInitialContentReplication(databaseName)).toBe(false);
    expect(screen.getByTestId("has-db")).toHaveTextContent("yes");
    act(() => initialPullHandles.at(-1)!.emit("change", { pending: 12, docs: [{ _id: "song" }] }));
    expect(screen.getByTestId("progress")).toHaveTextContent("0");
    act(() => initialPullHandles.at(-1)!.emit("change", { pending: 0, docs: [{ _id: "song" }] }));
    expect(screen.getByTestId("progress")).toHaveTextContent("99");
    expect(screen.getByTestId("bootstrap-ready")).toHaveTextContent("no");
    act(() => initialPullHandles.at(-1)!.emit("paused", { status: 0, message: "offline" }));
    expect(screen.getByTestId("bootstrap-ready")).toHaveTextContent("no");
    act(() => initialPullHandles[initialPullHandles.length - 1].emit("complete"));
    await waitFor(() => {
      expect(hasSuccessfulInitialContentReplication(databaseName)).toBe(true);
    });
    expect(screen.getByTestId("bootstrap-ready")).toHaveTextContent("yes");
    const localDb = mockPouchInstances.find((instance) => instance.name === databaseName)!;
    await expect(localDb.get("_local/worship-sync-initial-content-replication-v1")).resolves.toEqual(
      expect.objectContaining({
        localDatabaseName: databaseName,
        sourceDatabaseName: databaseName,
        complete: true,
      }),
    );
  });

  it("keeps a previously verified local database ready while the server is unavailable", async () => {
    jest.useFakeTimers();
    completeInitialPullAutomatically = false;
    verifiedCheckpointDatabaseNames.add("worship-sync-offline-ready");
    (global.fetch as jest.Mock).mockResolvedValue({
      headers: { get: () => "application/json" },
      json: async () => ({ success: false }),
    });
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider
          value={createMockGlobalContext({ database: "offline-ready" }) as any}
        >
          <MemoryRouter initialEntries={["/controller"]}>
            <ControllerInfoProvider><Probe /></ControllerInfoProvider>
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("bootstrap-ready")).toHaveTextContent("yes");
    });
    expect(screen.getByTestId("progress")).toHaveTextContent("100");
    expect(screen.getByTestId("has-db")).toHaveTextContent("yes");
    expect(initialPullHandles).toHaveLength(0);
    jest.clearAllTimers();
  });

  it("exposes failed initial replication results without granting readiness", async () => {
    completeInitialPullAutomatically = false;
    (global.fetch as jest.Mock).mockResolvedValue({
      headers: { get: () => "application/json" },
      json: async () => ({ success: true }),
    });
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <MemoryRouter initialEntries={["/controller"]}>
            <ControllerInfoProvider><Probe /></ControllerInfoProvider>
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => expect(initialPullHandles.length).toBeGreaterThan(0));
    act(() =>
      initialPullHandles.at(-1)!.emit("complete", {
        ok: false,
        errors: [{ status: 500, name: "server_error" }],
      }),
    );

    expect(screen.getByTestId("bootstrap-ready")).toHaveTextContent("no");
    expect(screen.getByTestId("startup-failure")).toHaveTextContent("replication");
    expect(screen.getByTestId("startup-stage")).toHaveTextContent("failed");
    expect(liveSyncHandles).toHaveLength(0);
  });

  it("exposes a terminal local database initialization failure", async () => {
    localPouchConstructorFailureName = "worship-sync-local-failure";
    (global.fetch as jest.Mock).mockResolvedValue({
      headers: { get: () => "application/json" },
      json: async () => ({ success: true }),
    });
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider
          value={createMockGlobalContext({ database: "local-failure" }) as any}
        >
          <MemoryRouter initialEntries={["/controller"]}>
            <ControllerInfoProvider><Probe /></ControllerInfoProvider>
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("startup-failure")).toHaveTextContent(
        "local-storage",
      );
    });
    expect(screen.getByTestId("startup-stage")).toHaveTextContent("failed");
    expect(screen.getByTestId("progress")).toBeEmptyDOMElement();
  });

  it("keeps automatic server retries going before exposing a recovery action", async () => {
    jest.useFakeTimers();
    (global.fetch as jest.Mock).mockResolvedValue({
      headers: { get: () => "application/json" },
      json: async () => ({ success: false }),
    });
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <MemoryRouter initialEntries={["/controller"]}>
            <ControllerInfoProvider><Probe /></ControllerInfoProvider>
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );

    await act(async () => {
      await jest.runAllTimersAsync();
    });
    expect(global.fetch).toHaveBeenCalledTimes(6);
    expect(screen.getByTestId("startup-failure")).toHaveTextContent(
      "server-connection",
    );
    expect(screen.getByTestId("message")).toHaveTextContent(
      "couldn't connect to the server after 5 retries",
    );
  });

  it("identifies exhausted session authentication failures separately from network failures", async () => {
    jest.useFakeTimers();
    (global.fetch as jest.Mock).mockResolvedValue({
      headers: { get: () => "application/json" },
      json: async () => ({ success: false, failureKind: "authentication" }),
    });
    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <MemoryRouter initialEntries={["/controller"]}>
            <ControllerInfoProvider><Probe /></ControllerInfoProvider>
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );

    await act(async () => {
      await jest.runAllTimersAsync();
    });
    expect(global.fetch).toHaveBeenCalledTimes(6);
    expect(screen.getByTestId("startup-failure")).toHaveTextContent(
      "authentication",
    );
    expect(screen.getByTestId("message")).toHaveTextContent(
      "couldn't verify its database session",
    );
  });

  it.each(["cancelled", "failed"])("does not enable bootstrap defaults after a %s initial pull", async (outcome) => {
    completeInitialPullAutomatically = false;
    (global.fetch as jest.Mock).mockResolvedValue({ headers: { get: () => "application/json" }, json: async () => ({ success: true }) });
    render(<Provider store={store}><GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
      <MemoryRouter initialEntries={["/controller"]}><ControllerInfoProvider><Probe /></ControllerInfoProvider></MemoryRouter>
    </GlobalInfoContext.Provider></Provider>);
    await waitFor(() => expect(initialPullHandles.length).toBeGreaterThan(0));
    act(() => initialPullHandles.at(-1)!.emit("complete", outcome === "cancelled" ? { status: "cancelled" } : { ok: false, errors: [{ status: 500 }] }));
    expect(screen.getByTestId("bootstrap-ready")).toHaveTextContent("no");
    expect(liveSyncHandles).toHaveLength(0);
  });

  it("ignores a previous church's delayed initial pull", async () => {
    completeInitialPullAutomatically = false;
    (global.fetch as jest.Mock).mockResolvedValue({ headers: { get: () => "application/json" }, json: async () => ({ success: true }) });
    const tree = (church: string) => <Provider store={store}><GlobalInfoContext.Provider value={createMockGlobalContext({ churchId: church, database: church }) as any}>
      <MemoryRouter initialEntries={["/controller"]}><ControllerInfoProvider><Probe /></ControllerInfoProvider></MemoryRouter>
    </GlobalInfoContext.Provider></Provider>;
    const view = render(tree("a"));
    await waitFor(() => expect(initialPullHandles).toHaveLength(1));
    const oldPull = initialPullHandles[0];
    view.rerender(tree("b"));
    await waitFor(() => expect(initialPullHandles).toHaveLength(2));
    act(() => oldPull.emit("complete", { ok: true }));
    expect(screen.getByTestId("bootstrap-ready")).toHaveTextContent("no");
    expect(liveSyncHandles).toHaveLength(0);
    act(() => initialPullHandles[1].emit("complete", { ok: true }));
    await waitFor(() => expect(screen.getByTestId("bootstrap-ready")).toHaveTextContent("yes"));
    expect(liveSyncOwners).toEqual(["worship-sync-b"]);
  });

  it("does not resume an old church sync after renewal finishes", async () => {
    let resolveOldRenewal!: (response: unknown) => void;
    const oldRenewal = new Promise((resolve) => { resolveOldRenewal = resolve; });
    let resolveNewChurchSession!: (response: unknown) => void;
    const newChurchSession = new Promise((resolve) => { resolveNewChurchSession = resolve; });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        headers: { get: () => "application/json" },
        json: async () => ({ success: true }),
      })
      .mockReturnValueOnce(oldRenewal)
      .mockReturnValueOnce(newChurchSession)
      .mockResolvedValue({
        headers: { get: () => "application/json" },
        json: async () => ({ success: true }),
      });
    const renderForChurch = (church: string) => (
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext({ database: church }) as any}>
          <MemoryRouter initialEntries={["/controller"]}>
            <ControllerInfoProvider><Probe /></ControllerInfoProvider>
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>
    );
    const view = render(renderForChurch("church-a"));
    await waitFor(() => expect(liveSyncHandles).toHaveLength(1));

    act(() => liveSyncHandles[0].emit("denied", { status: 401, name: "unauthorized" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    view.rerender(renderForChurch("church-b"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));

    resolveOldRenewal({
      headers: { get: () => "application/json" },
      json: async () => ({ success: true }),
    });
    await act(async () => { await oldRenewal; await Promise.resolve(); });
    expect(liveSyncOwners.filter((owner) => owner === "worship-sync-church-a")).toHaveLength(1);

    resolveNewChurchSession({
      headers: { get: () => "application/json" },
      json: async () => ({ success: true }),
    });
    await act(async () => { await newChurchSession; await Promise.resolve(); });
    await waitFor(() => expect(liveSyncOwners).toContain("worship-sync-church-b"));

    expect(liveSyncHandles).toHaveLength(2);
    expect(liveSyncBatchSizes).toEqual([40, 40]);
  });

  it("cancels a scheduled church retry before teardown and keeps the next church independent", async () => {
    jest.useFakeTimers();
    jest.spyOn(console, "error").mockImplementation(() => {});
    let startedOldCleanup!: () => void;
    const oldCleanupStarted = new Promise<void>(resolve => { startedOldCleanup = resolve; });
    const oldDb = {
      name: "worship-sync-church-a",
      allDocs: jest.fn(async () => {
        startedOldCleanup();
        throw new Error("temporary cleanup scan failure");
      }),
      destroy: jest.fn().mockResolvedValue(undefined),
    } as unknown as PouchDB.Database;
    scheduleSongV2CleanupMaintenance(oldDb, true);
    await oldCleanupStarted;
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    expect(jest.getTimerCount()).toBe(1);

    cancelSongV2CleanupMaintenance(oldDb);
    await oldDb.destroy();
    const oldDatabaseCalls = (oldDb.allDocs as jest.Mock).mock.calls.length;
    await jest.advanceTimersByTimeAsync(300_000);
    expect(oldDb.destroy).toHaveBeenCalledTimes(1);
    expect(oldDb.allDocs).toHaveBeenCalledTimes(oldDatabaseCalls);

    const newDb = {
      name: "worship-sync-church-b",
      allDocs: jest.fn().mockResolvedValue({ rows: [] }),
      destroy: jest.fn().mockResolvedValue(undefined),
    } as unknown as PouchDB.Database;
    scheduleSongV2CleanupMaintenance(newDb, true);
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    expect(newDb.allDocs).toHaveBeenCalledTimes(2);
    expect(oldDb.allDocs).toHaveBeenCalledTimes(oldDatabaseCalls);
    jest.useRealTimers();
  });

  it("does not continue in-flight cleanup after the original database is torn down", async () => {
    jest.useFakeTimers();
    let started!: () => void;
    const operationStarted = new Promise<void>(resolve => { started = resolve; });
    let finishEnumeration!: (result: { rows: [] }) => void;
    const enumeration = new Promise<{ rows: [] }>(resolve => { finishEnumeration = resolve; });
    const oldDb = {
      name: "worship-sync-church-a-in-flight",
      allDocs: jest.fn(() => {
        started();
        return enumeration;
      }),
      destroy: jest.fn().mockResolvedValue(undefined),
    } as unknown as PouchDB.Database;
    scheduleSongV2CleanupMaintenance(oldDb, true);
    await operationStarted;

    cancelSongV2CleanupMaintenance(oldDb);
    await oldDb.destroy();
    finishEnumeration({ rows: [] });
    for (let index = 0; index < 10; index += 1) await Promise.resolve();

    expect(oldDb.allDocs).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it("does not restart sync when auth recovery finishes after provider unmount", async () => {
    let resolveRenewal!: (response: unknown) => void;
    const renewal = new Promise((resolve) => { resolveRenewal = resolve; });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        headers: { get: () => "application/json" },
        json: async () => ({ success: true }),
      })
      .mockReturnValueOnce(renewal);
    const view = render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <MemoryRouter initialEntries={["/controller"]}>
            <ControllerInfoProvider><Probe /></ControllerInfoProvider>
          </MemoryRouter>
        </GlobalInfoContext.Provider>
      </Provider>,
    );
    await waitFor(() => expect(liveSyncHandles).toHaveLength(1));
    act(() => liveSyncHandles[0].emit("denied", { status: 401, name: "unauthorized" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    view.unmount();

    resolveRenewal({
      headers: { get: () => "application/json" },
      json: async () => ({ success: true }),
    });
    await act(async () => { await renewal; await Promise.resolve(); });

    expect(liveSyncHandles).toHaveLength(1);
  });
});
