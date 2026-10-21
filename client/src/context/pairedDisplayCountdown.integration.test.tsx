import { act, render, screen, waitFor, cleanup } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { onValue } from "firebase/database";
import { GlobalInfoContext } from "./globalInfo";
import { ChurchServiceTimeZoneProvider } from "./churchServiceTimeZone";
import TimerDisplay from "../components/DisplayWindow/TimerDisplay";
import { createMockGlobalContext } from "../test/mocks";
import { setDisplayToken, setWorkstationToken } from "../utils/authStorage";
import { setServerTimeOffset } from "../utils/serverTime";
import { createServiceTime } from "../test/fixtures";

const mockConnectAuthenticatedSse = jest.fn();
jest.mock("../utils/authenticatedSse", () => ({
  connectAuthenticatedSse: (...args: unknown[]) =>
    mockConnectAuthenticatedSse(...args),
}));

jest.mock("firebase/database", () => ({
  ...jest.requireActual("firebase/database"),
  ref: jest.fn((_db, path) => path),
  onValue: jest.fn(),
}));

const service = createServiceTime({ id: "sunday", name: "Sunday", reccurence: "weekly", dayOfWeek: 0, time: "10:00" });

describe("paired output countdown production composition", () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  let configured = true;
  let zone = "America/New_York";
  let rejected = false;
  let revision = "revision-test";
  let streamConnections: Array<{
    path: string;
    handlers: { onMessage: (message: string) => void };
    extraHeaders?: Record<string, string>;
  }>;
  beforeEach(() => {
    configured = true; zone = "America/New_York"; rejected = false; revision = "revision-test";
    streamConnections = [];
    localStorage.clear();
    setDisplayToken("paired-display-credential");
    global.fetch = fetchMock;
    mockConnectAuthenticatedSse.mockReset().mockImplementation((
      path: string,
      handlers: { onMessage: (message: string) => void },
      extraHeaders?: Record<string, string>,
    ) => {
      streamConnections.push({ path, handlers, extraHeaders });
      return jest.fn();
    });
    fetchMock.mockReset().mockImplementation(async () => {
      const payload = rejected
        ? { error: "Server unavailable" }
        : {
            success: true,
            serviceTimeZone: configured ? zone : "UTC",
            isConfigured: configured,
            serviceTimeZoneRevision: revision,
          };
      return new Response(JSON.stringify(payload), {
        status: rejected ? 503 : 200,
        headers: { "content-type": "application/json" },
      });
    });
    jest.mocked(onValue).mockImplementation((_ref, callback) => {
      if (typeof callback === "function") callback({ val: () => [service] } as never);
      return jest.fn();
    });
  });
  afterEach(() => {
    cleanup(); setServerTimeOffset(0); localStorage.clear(); global.fetch = originalFetch; jest.restoreAllMocks();
  });
  const mount = (sessionKind: "human" | "workstation" | "display", surface: string) => {
    const initialState = { undoable: { present: { serviceTimes: { list: sessionKind === "display" ? [] : [service], isInitialized: sessionKind !== "display" } } } };
    const store = configureStore({ reducer: (state = initialState) => state });
    const value = createMockGlobalContext({ churchId: "church-a", sessionKind, loginState: "success" });
    return render(<Provider store={store}>
      <GlobalInfoContext.Provider value={value as React.ContextType<typeof GlobalInfoContext>}>
        <ChurchServiceTimeZoneProvider>
          <div role="status" aria-label={surface}><TimerDisplay words="{{service-time}}" /></div>
        </ChurchServiceTimeZoneProvider>
      </GlobalInfoContext.Provider>
    </Provider>);
  };
  it.each([
    ["2026-07-12T13:00:00Z", "2026-07-12T14:00:00Z"],
    ["2026-01-11T14:00:00Z", "2026-01-11T15:00:00Z"],
  ])("resolves weekly 10:00 New York consistently from %s to %s", async (now, target) => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse(now) - 30_000);
    setServerTimeOffset(30_000);
    for (const [kind, surface] of [["human", "controller"], ["workstation", "workstation"], ["display", "monitor"], ["display", "projector"], ["display", "stream"]] as const) {
      setDisplayToken(kind === "display" ? "paired-display-credential" : "");
      setWorkstationToken(kind === "workstation" ? "workstation-credential" : "");
      const view = mount(kind, surface);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getByRole("status", { name: surface })).toHaveTextContent("1:00:00");
      expect(new Date(target).getTime() - (Date.now() + 30_000)).toBe(3_600_000);
      view.unmount();
    }
    expect(mockConnectAuthenticatedSse).toHaveBeenCalledWith(
      "api/churches/church-a/service-time-zone/stream",
      expect.any(Object),
      { "x-display-token": "paired-display-credential" },
    );
    expect(onValue).toHaveBeenCalledWith("churches/church-a/data/services", expect.any(Function));
  });
  it("adopts revision events, retains the last zone after a read failure, and recovers on the next change", async () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-12T13:00:00Z"));
    configured = false;
    mount("display", "monitor");
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole("status")).toHaveTextContent("--:--");

    configured = true;
    revision = "revision-new-york";
    await act(async () => {
      streamConnections[0].handlers.onMessage(JSON.stringify({
        type: "service-time-zone-revision",
        churchId: "church-a",
        serviceTimeZoneRevision: revision,
      }));
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/^(?:1:00:00|59:59)$/));

    rejected = true;
    revision = "revision-failed-read";
    await act(async () => {
      streamConnections[0].handlers.onMessage(JSON.stringify({
        type: "service-time-zone-revision",
        churchId: "church-a",
        serviceTimeZoneRevision: revision,
      }));
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("1:00:00");

    rejected = false; zone = "America/Chicago";
    revision = "revision-chicago";
    await act(async () => {
      streamConnections[0].handlers.onMessage(JSON.stringify({
        type: "service-time-zone-revision",
        churchId: "church-a",
        serviceTimeZoneRevision: revision,
      }));
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2:00:00"));
  });
});
