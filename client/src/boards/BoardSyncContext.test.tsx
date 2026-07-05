import { render, screen, waitFor } from "@testing-library/react";
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
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
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

    // Signed in → it tries, hits 401, and settles into a terminal failed state
    // with a clear log instead of an endless retry.
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("failed"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("bootstrap"),
      expect.anything(),
    );
    expect(warnSpy).toHaveBeenCalled();
  });
});
