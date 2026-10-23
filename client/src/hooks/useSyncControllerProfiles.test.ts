import { createElement, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { configureStore, type Action } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { type Database } from "firebase/database";
import { useSyncControllerProfiles } from "./useSyncControllerProfiles";
import { controllerProfilesSlice } from "../store/controllerProfilesSlice";

type Listener = {
  path: string;
  success: (snapshot: { val: () => unknown }) => void;
};

const mockListeners: Listener[] = [];
const mockOnValue = jest.fn(
  (
    target: { path: string },
    success: Listener["success"],
  ) => {
    mockListeners.push({ path: target.path, success });
    return jest.fn();
  },
);

jest.mock("firebase/database", () => ({
  ref: (_db: unknown, path: string) => ({ path }),
  onValue: (target: { path: string }, success: Listener["success"]) =>
    mockOnValue(target, success),
}));

const db = {} as Database;
const createStore = () =>
  configureStore({
    reducer: (
      state: { controllerProfiles: ReturnType<typeof controllerProfilesSlice.reducer> } | undefined,
      action: Action,
    ) => ({
      controllerProfiles: controllerProfilesSlice.reducer(
        state?.controllerProfiles,
        action,
      ),
    }),
  });

const wrapperOf = (store: ReturnType<typeof createStore>) => {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Provider, { store, children });
  return Wrapper;
};

describe("useSyncControllerProfiles", () => {
  beforeEach(() => {
    mockListeners.length = 0;
    mockOnValue.mockClear();
  });

  it("does not subscribe until shared data is ready", () => {
    renderHook(() => useSyncControllerProfiles(db, "church-1", false), {
      wrapper: wrapperOf(createStore()),
    });
    expect(mockOnValue).not.toHaveBeenCalled();
  });

  it("keeps a late snapshot scoped to its original church during a switch", () => {
    const store = createStore();
    const { rerender } = renderHook(
      ({ churchId }: { churchId: string }) =>
        useSyncControllerProfiles(db, churchId, true),
      { wrapper: wrapperOf(store), initialProps: { churchId: "church-1" } },
    );
    const previousListener = mockListeners[0];

    rerender({ churchId: "church-2" });
    act(() => {
      previousListener.success({
        val: () => [{ id: "presentation", type: "presentation", name: "Church One", order: 0 }],
      });
    });
    expect(store.getState().controllerProfiles.isLoaded).toBe(false);
    expect(store.getState().controllerProfiles.syncedChurchId).toBeNull();

    const currentListener = mockListeners[mockListeners.length - 1];
    expect(currentListener.path).toBe("churches/church-2/data/controllerProfiles");
    act(() => {
      currentListener.success({
        val: () => [{ id: "presentation", type: "presentation", name: "Church Two", order: 0 }],
      });
    });

    expect(store.getState().controllerProfiles.syncedChurchId).toBe("church-2");
    expect(store.getState().controllerProfiles.list[0].name).toBe("Church Two");
  });
});
