import { createElement, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { configureStore, type Action } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { type Database } from "firebase/database";
import { useSyncDisplayOutputs } from "./useSyncDisplayOutputs";
import { displayOutputsSlice } from "../store/displayOutputsSlice";

const db = {} as Database;
const OUTPUTS_PATH = "churches/church-1/data/displayOutputs";

const onValueCallbacks = new Map<
  string,
  (snapshot: { val: () => unknown }) => void
>();
const onValueMock = jest.fn(
  (
    target: { path: string },
    success: (snapshot: { val: () => unknown }) => void,
  ) => {
    onValueCallbacks.set(target.path, success);
    return jest.fn();
  },
);

jest.mock("firebase/database", () => ({
  ref: (_db: unknown, path: string) => ({ path }),
  onValue: (
    target: { path: string },
    success: (snapshot: { val: () => unknown }) => void,
  ) => onValueMock(target, success),
}));

type DisplayOutputsState = ReturnType<typeof displayOutputsSlice.reducer>;

const createStore = () =>
  configureStore({
    reducer: (
      state: { displayOutputs: DisplayOutputsState } | undefined,
      action: Action,
    ) => {
      // Mirror `store.ts`: RESET drops slice state so the next reduce uses
      // initialState (`isLoaded: false`).
      if (action.type === "RESET") {
        state = undefined;
      }
      return {
        displayOutputs: displayOutputsSlice.reducer(
          state?.displayOutputs,
          action,
        ),
      };
    },
  });

const wrapperOf = (store: ReturnType<typeof createStore>) => {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Provider, { store, children });
  return Wrapper;
};

describe("useSyncDisplayOutputs", () => {
  beforeEach(() => {
    onValueCallbacks.clear();
    onValueMock.mockClear();
  });

  it("does not subscribe until sharedDataReady is true", () => {
    renderHook(() => useSyncDisplayOutputs(db, "church-1", false), {
      wrapper: wrapperOf(createStore()),
    });
    expect(onValueMock).not.toHaveBeenCalled();
  });

  it("marks the registry loaded from the first Firebase snapshot", () => {
    const store = createStore();
    renderHook(() => useSyncDisplayOutputs(db, "church-1", true), {
      wrapper: wrapperOf(store),
    });

    act(() => {
      onValueCallbacks.get(OUTPUTS_PATH)?.({ val: () => null });
    });

    expect(store.getState().displayOutputs.isLoaded).toBe(true);
  });

  it("re-attaches after RESET so the Displays panel can leave the loading lock", () => {
    const store = createStore();
    renderHook(() => useSyncDisplayOutputs(db, "church-1", true), {
      wrapper: wrapperOf(store),
    });

    act(() => {
      onValueCallbacks.get(OUTPUTS_PATH)?.({ val: () => null });
    });
    expect(store.getState().displayOutputs.isLoaded).toBe(true);
    expect(onValueMock).toHaveBeenCalledTimes(1);

    // Controller unmount / StrictMode remount: the store is wiped, but this
    // hook stays mounted at the app root and its listener would otherwise
    // never fire again.
    act(() => {
      store.dispatch({ type: "RESET" });
    });
    expect(store.getState().displayOutputs.isLoaded).toBe(false);
    expect(onValueMock).toHaveBeenCalledTimes(2);

    act(() => {
      onValueCallbacks.get(OUTPUTS_PATH)?.({ val: () => null });
    });
    expect(store.getState().displayOutputs.isLoaded).toBe(true);
  });
});
