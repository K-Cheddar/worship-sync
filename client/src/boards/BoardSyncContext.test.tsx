import { act, render, screen, waitFor } from "@testing-library/react";
import BoardSyncProvider, {
  describeBoardSyncError,
  isBoardAuthError,
  useBoardSync,
} from "./BoardSyncContext";
import { AUTH_SIGN_IN_AGAIN_MESSAGE } from "../utils/authUserMessages";
import { GlobalInfoContext } from "../context/globalInfo";

jest.mock("../context/globalInfo", () => {
  const ReactModule = jest.requireActual("react");
  return { GlobalInfoContext: ReactModule.createContext(null) };
});

jest.mock("../utils/environment", () => ({
  getApiBasePath: () => "",
}));

jest.mock("./api", () => ({
  createBoardRequestHeaders: () => ({}),
}));

jest.mock("pouchdb-browser", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    close: jest.fn(),
    sync: jest.fn(),
    replicate: { to: jest.fn() },
  })),
}));

type MockPouchEvent = {
  on: jest.Mock;
  cancel: jest.Mock;
  emit: (eventName: string, payload?: unknown) => void;
};

const createMockPouchEvent = (): MockPouchEvent => {
  const listeners = new Map<string, (payload?: unknown) => void>();
  const event: MockPouchEvent = {
    on: jest.fn(),
    cancel: jest.fn(),
    emit: (eventName, payload) => listeners.get(eventName)?.(payload),
  };
  event.on.mockImplementation(
    (eventName: string, listener: (payload?: unknown) => void) => {
      listeners.set(eventName, listener);
      return event;
    },
  );
  return event;
};

const mockPouchDB = jest.requireMock("pouchdb-browser").default as jest.Mock;

const Consumer = () => {
  const sync = useBoardSync();
  return <div data-testid="status">{sync?.status}</div>;
};

const renderProvider = (contextValue: unknown) =>
  render(
    <GlobalInfoContext.Provider value={contextValue as never}>
      <BoardSyncProvider>
        <Consumer />
      </BoardSyncProvider>
    </GlobalInfoContext.Provider>,
  );

describe("describeBoardSyncError", () => {
  it("prefers an Error message", () => {
    expect(describeBoardSyncError(new Error("boom"))).toBe("boom");
  });

  it("digs a message out of PouchDB-style objects that print as {}", () => {
    expect(describeBoardSyncError({ status: 401, reason: "unauthorized" })).toBe(
      "unauthorized",
    );
    expect(describeBoardSyncError({ status: 500 })).toBe("HTTP 500");
  });
});

describe("isBoardAuthError", () => {
  it("flags the sign-in-again error and 401/unauthorized shapes", () => {
    expect(isBoardAuthError(new Error(AUTH_SIGN_IN_AGAIN_MESSAGE))).toBe(true);
    expect(isBoardAuthError({ status: 401 })).toBe(true);
    expect(isBoardAuthError({ status: 403 })).toBe(true);
    expect(isBoardAuthError({ name: "unauthorized" })).toBe(true);
  });

  it("does not flag transient network faults", () => {
    expect(isBoardAuthError(new Error("Failed to fetch"))).toBe(false);
    expect(isBoardAuthError({ status: 503 })).toBe(false);
  });
});

describe("BoardSyncProvider auth gating", () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    mockPouchDB.mockReset();
    mockPouchDB.mockImplementation(() => ({
      close: jest.fn(),
      sync: jest.fn(),
      changes: jest.fn(() => createMockPouchEvent()),
      replicate: { to: jest.fn() },
    }));
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => { });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    warnSpy.mockRestore();
  });

  it("pauses (does not attempt replication) until the operator is signed in", async () => {
    renderProvider({ database: "church-db", loginState: "loading" });

    // Nothing should hit the network while unauthenticated — this is what used to
    // 401-loop and spam "Board sync setup failed: {}".
    expect(fetchMock).not.toHaveBeenCalled();
    // "paused" (not "connecting") so the UI can say "waiting for sign-in".
    expect(screen.getByTestId("status")).toHaveTextContent("paused");
  });

  it("reports connecting while the church context is still loading", () => {
    renderProvider({ database: "", loginState: "success" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent("connecting");
  });

  it("stops (rather than retry-loops) when the session has expired", async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).includes("bootstrap")
        ? Promise.resolve({ ok: false, status: 401 })
        : Promise.resolve({ ok: true, json: async () => ({ success: true }) }),
    );

    renderProvider({ database: "church-db", loginState: "success" });

    // Signed in → it tries, hits 401, and settles into paused so the UI can
    // offer "Sign in again" instead of an endless retry.
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("paused"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("bootstrap"),
      expect.anything(),
    );
    expect(warnSpy).toHaveBeenCalled();
  });

  it("renews the CouchDB session and restarts live replication after a runtime 403", async () => {
    const initialReplication = createMockPouchEvent();
    const liveSyncs: MockPouchEvent[] = [];
    const localDb = {
      close: jest.fn(),
      changes: jest.fn(() => createMockPouchEvent()),
      sync: jest.fn(() => {
        const liveSync = createMockPouchEvent();
        liveSyncs.push(liveSync);
        return liveSync;
      }),
    };
    const remoteDb = {
      close: jest.fn(),
      replicate: { to: jest.fn(() => initialReplication) },
    };
    mockPouchDB
      .mockImplementationOnce(() => localDb)
      .mockImplementationOnce(() => remoteDb);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    renderProvider({ database: "church-db", loginState: "success" });

    await waitFor(() => expect(remoteDb.replicate.to).toHaveBeenCalled());
    await act(async () => {
      initialReplication.emit("complete");
    });
    await waitFor(() => expect(liveSyncs).toHaveLength(1));
    expect(screen.getByTestId("status")).toHaveTextContent("connected");

    await act(async () => {
      liveSyncs[0]?.emit("denied", { status: 403 });
    });

    await waitFor(() => expect(localDb.sync).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(screen.getByTestId("status")).toHaveTextContent("connected");
  });
});
