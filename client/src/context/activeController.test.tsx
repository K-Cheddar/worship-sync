import { render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import itemListsReducer, {
  initiateItemLists,
} from "../store/itemListsSlice";
import controllerProfilesReducer, {
  setControllerProfilesFromRemote,
} from "../store/controllerProfilesSlice";
import {
  ActiveControllerProvider,
  useActiveControllerProfile,
  useControllerBasePath,
} from "./activeController";
import {
  OVERLAY_CONTROLLER_ID,
  PRESENTATION_CONTROLLER_ID,
} from "../utils/controllerProfiles";
import type { ItemList } from "../types";

/**
 * The provider carries two invariants: the tree below knows which controller it
 * is, and the outline picker is moved into that controller's scope. The second
 * one lives here rather than in each page precisely so a page cannot forget it.
 */

const AUX_ID = "ctrl_lobby";

const outline = (_id: string, controllerScope?: string): ItemList => ({
  _id,
  name: _id,
  ...(controllerScope ? { controllerScope } : {}),
});

const createStore = () => {
  const store = configureStore({
    reducer: {
      // The slice lives under `undoable.present` in the real store; this shim
      // keeps the test to the two reducers under test.
      undoable: (
        state: { present: { itemLists: ReturnType<typeof itemListsReducer> } } = {
          present: { itemLists: itemListsReducer(undefined, { type: "@@init" }) },
        },
        action,
      ) => ({
        present: {
          itemLists: itemListsReducer(state.present.itemLists, action),
        },
      }),
      controllerProfiles: controllerProfilesReducer,
    },
  });
  store.dispatch(
    setControllerProfilesFromRemote([
      {
        id: AUX_ID,
        type: "aux-presentation",
        name: "Lobby",
        order: 2,
        outputIds: ["out_lobby"],
        outlineScope: AUX_ID,
      },
    ]),
  );
  store.dispatch(
    initiateItemLists([
      outline("sunday-am"),
      outline("lobby-loop", AUX_ID),
    ]),
  );
  return store;
};

const scopeOf = (store: ReturnType<typeof createStore>) =>
  store.getState().undoable.present.itemLists;

const Probe = () => {
  const profile = useActiveControllerProfile();
  const basePath = useControllerBasePath();
  return (
    <div>
      <span data-testid="name">{profile.name}</span>
      <span data-testid="base">{basePath}</span>
    </div>
  );
};

describe("ActiveControllerProvider", () => {
  it("resolves the named profile for the tree below", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <ActiveControllerProvider profileId={AUX_ID}>
          <Probe />
        </ActiveControllerProvider>
      </Provider>,
    );
    expect(screen.getByTestId("name")).toHaveTextContent("Lobby");
  });

  it("moves the outline picker into that controller's scope", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <ActiveControllerProvider profileId={AUX_ID}>
          <Probe />
        </ActiveControllerProvider>
      </Provider>,
    );
    expect(scopeOf(store).scope).toBe(AUX_ID);
    expect(scopeOf(store).selectedList?._id).toBe("lobby-loop");
  });

  it("hands the scope back on unmount, so other surfaces are unaffected", () => {
    const store = createStore();
    const { unmount } = render(
      <Provider store={store}>
        <ActiveControllerProvider profileId={AUX_ID}>
          <Probe />
        </ActiveControllerProvider>
      </Provider>,
    );
    unmount();
    expect(scopeOf(store).scope).toBe(PRESENTATION_CONTROLLER_ID);
    expect(scopeOf(store).selectedList?._id).toBe("sunday-am");
  });

  it("keeps the overlay controller in the presentation scope", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <ActiveControllerProvider profileId={OVERLAY_CONTROLLER_ID}>
          <Probe />
        </ActiveControllerProvider>
      </Provider>,
    );
    expect(scopeOf(store).scope).toBe(PRESENTATION_CONTROLLER_ID);
  });

  it("stands in for an unknown controller instead of borrowing presentation", () => {
    // Its registry entry may simply not have arrived; inheriting the
    // sanctuary's displays would be far worse than driving none.
    const store = createStore();
    render(
      <Provider store={store}>
        <ActiveControllerProvider profileId="ctrl_gone">
          <Probe />
        </ActiveControllerProvider>
      </Provider>,
    );
    expect(screen.getByTestId("base")).toHaveTextContent(
      "/aux-controller/ctrl_gone",
    );
    expect(scopeOf(store).scope).toBe("ctrl_gone");
  });
});

describe("useControllerBasePath", () => {
  it("routes an auxiliary controller to its own path", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <ActiveControllerProvider profileId={AUX_ID}>
          <Probe />
        </ActiveControllerProvider>
      </Provider>,
    );
    // Outline links are built from this; "/controller" here would throw the
    // operator onto the main controller mid-service.
    expect(screen.getByTestId("base")).toHaveTextContent(
      `/aux-controller/${AUX_ID}`,
    );
  });

  it("keeps the built-ins on the main controller path", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <ActiveControllerProvider profileId={PRESENTATION_CONTROLLER_ID}>
          <Probe />
        </ActiveControllerProvider>
      </Provider>,
    );
    expect(screen.getByTestId("base")).toHaveTextContent("/controller");
  });
});
