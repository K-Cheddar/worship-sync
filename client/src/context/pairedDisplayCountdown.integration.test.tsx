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
  beforeEach(() => {
    jest.useFakeTimers();
    configured = true; zone = "America/New_York"; rejected = false;
    localStorage.clear();
    setDisplayToken("paired-display-credential");
    global.fetch = fetchMock;
    fetchMock.mockReset().mockImplementation(async () => ({
      ok: !rejected, status: rejected ? 401 : 200,
      json: async () => rejected ? { error: "Authentication required" } : { success: true, serviceTimeZone: zone, isConfigured: configured },
    }));
    jest.mocked(onValue).mockImplementation((_ref, callback) => {
      if (typeof callback === "function") callback({ val: () => [service] } as never);
      return jest.fn();
    });
  });
  afterEach(() => {
    cleanup(); setServerTimeOffset(0); localStorage.clear(); global.fetch = originalFetch; jest.useRealTimers();
  });
  const mount = (sessionKind: "human" | "workstation" | "display", surface: string) => {
    const store = configureStore({ reducer: () => ({ undoable: { present: { serviceTimes: { list: sessionKind === "display" ? [] : [service], isInitialized: sessionKind !== "display" } } } }) });
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
    jest.setSystemTime(new Date(now).getTime() - 30_000);
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
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("api/churches/church-a/service-time-zone"), expect.objectContaining({
      headers: expect.objectContaining({ "x-display-token": "paired-display-credential" }),
    }));
    expect(onValue).toHaveBeenCalledWith("churches/church-a/data/services", expect.any(Function));
  });
  it("hides missing or rejected configuration and recovers on reconnect with changed settings", async () => {
    jest.setSystemTime(new Date("2026-07-12T13:00:00Z"));
    configured = false;
    mount("display", "monitor");
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("status")).toHaveTextContent("--:--");
    configured = true;
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1:00:00"));
    rejected = true;
    await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByRole("status")).toHaveTextContent("--:--");
    rejected = false; zone = "America/Chicago";
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1:59:00"));
  });
});
