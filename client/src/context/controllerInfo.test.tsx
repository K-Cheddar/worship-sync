import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import store from "../store/store";
import ControllerInfoProvider, {
  canRetrySync413,
  ControllerInfoContext,
  nextSyncBatchSize,
} from "./controllerInfo";
import { GlobalInfoContext } from "./globalInfo";
import { createMockGlobalContext } from "../test/mocks";

const mockPouchInstances: Array<{
  name: string;
  destroy: jest.Mock;
  bulkDocs: jest.Mock;
  sync: jest.Mock;
  replicate: { to: jest.Mock };
}> = [];
const liveSyncHandles: Array<{
  cancel: jest.Mock;
  emit: (event: string, value?: any) => void;
}> = [];
const liveSyncBatchSizes: number[] = [];
const liveSyncOwners: string[] = [];
const liveSyncOptions: Array<Record<string, unknown>> = [];
const replicationCalls: Array<{ name: string; options?: Record<string, unknown> }> = [];

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
    const instance = {
      name,
      destroy: jest.fn().mockResolvedValue(undefined),
      bulkDocs: jest.fn().mockResolvedValue([]),
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
          return createSyncHandle(true);
        }),
      },
      changes: jest.fn(() => createSyncHandle()),
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
  return (
    <div>
      <div data-testid="progress">{context?.dbProgress}</div>
      <div data-testid="status">{context?.connectionStatus.status}</div>
      <div data-testid="message">{context?.connectionStatus.message}</div>
      <div data-testid="has-db">{context?.db ? "yes" : "no"}</div>
      <button type="button" onClick={() => context?.pullFromRemote()}>Pull</button>
    </div>
  );
};

describe("ControllerInfoProvider", () => {
  beforeEach(() => {
    mockPouchInstances.length = 0;
    liveSyncHandles.length = 0;
    liveSyncBatchSizes.length = 0;
    liveSyncOwners.length = 0;
    liveSyncOptions.length = 0;
    replicationCalls.length = 0;
    global.fetch = jest.fn() as jest.Mock;
    (global as unknown as { BroadcastChannel: typeof BroadcastChannel }).BroadcastChannel =
      jest.fn().mockImplementation(() => ({
        close: jest.fn(),
        postMessage: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })) as unknown as typeof BroadcastChannel;
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
        expect.objectContaining({ _id: "allItems" }),
        expect.objectContaining({ _id: "ItemLists" }),
        expect.objectContaining({ _id: "offline-demo-outline" }),
      ]),
    );
  });
});

describe("controller replication 413 batch policy", () => {
  beforeEach(() => {
    mockPouchInstances.length = 0;
    liveSyncHandles.length = 0;
    liveSyncBatchSizes.length = 0;
    liveSyncOwners.length = 0;
    liveSyncOptions.length = 0;
    replicationCalls.length = 0;
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
