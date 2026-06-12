import { render } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { timersSlice } from "../../store/timersSlice";
import TimerManager from "./TimerManager";
import { GlobalInfoContext } from "../../context/globalInfo";

const onValueCallbacks = new Map<string, unknown>();
const refMock = jest.fn((_db: unknown, path: string) => ({ path }));
const onValueMock = jest.fn(
  (target: { path: string }, success: unknown) => {
    onValueCallbacks.set(target.path, success);
    return jest.fn();
  }
);

jest.mock("firebase/database", () => ({
  ref: (db: unknown, path: string) => refMock(db, path),
  onValue: (target: { path: string }, success: unknown, error: unknown) =>
    onValueMock(target, success ?? error),
}));

const ACTIVE_INSTANCES_PATH = "churches/church-1/data/activeInstances";
const TIMERS_PATH = "churches/church-1/data/timers";

const makeStore = () =>
  configureStore({ reducer: { timers: timersSlice.reducer } });

const renderTimerManager = (ctx: Record<string, unknown>) =>
  render(
    <Provider store={makeStore()}>
      <GlobalInfoContext.Provider value={ctx as never}>
        <TimerManager />
      </GlobalInfoContext.Provider>
    </Provider>
  );

const baseCtx = {
  churchId: "church-1",
  firebaseDb: "db",
  hostId: "host-A",
  loginState: "success",
};

describe("TimerManager subscriptions", () => {
  beforeEach(() => {
    onValueCallbacks.clear();
    refMock.mockClear();
    onValueMock.mockClear();
  });

  it("does not subscribe until shared data is ready", () => {
    renderTimerManager({ ...baseCtx, sharedDataReady: false });
    expect(onValueCallbacks.has(ACTIVE_INSTANCES_PATH)).toBe(false);
    expect(onValueCallbacks.has(TIMERS_PATH)).toBe(false);
  });

  it("does not subscribe in guest mode", () => {
    renderTimerManager({
      ...baseCtx,
      loginState: "guest",
      sharedDataReady: true,
    });
    expect(onValueCallbacks.has(ACTIVE_INSTANCES_PATH)).toBe(false);
    expect(onValueCallbacks.has(TIMERS_PATH)).toBe(false);
  });

  it("subscribes to timers and active instances once ready", () => {
    renderTimerManager({ ...baseCtx, sharedDataReady: true });
    expect(onValueCallbacks.has(ACTIVE_INSTANCES_PATH)).toBe(true);
    expect(onValueCallbacks.has(TIMERS_PATH)).toBe(true);
  });
});
