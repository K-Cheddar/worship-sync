import { configureStore } from "@reduxjs/toolkit";
import reducer, {
  addControllerProfile,
  removeControllerProfile,
  renameControllerProfile,
  reorderControllerProfiles,
  selectControllerProfiles,
  selectControllerProfilesLoaded,
  setControllerProfileDefaultSends,
  setControllerProfileEnabled,
  setControllerProfileOutputs,
  setControllerProfilesFromRemote,
} from "./controllerProfilesSlice";
import {
  OVERLAY_CONTROLLER_ID,
  PRESENTATION_CONTROLLER_ID,
} from "../utils/controllerProfiles";

const createStore = () =>
  configureStore({ reducer: { controllerProfiles: reducer } });

const profilesOf = (store: ReturnType<typeof createStore>) =>
  store.getState().controllerProfiles.list;

const auxIdOf = (store: ReturnType<typeof createStore>) =>
  profilesOf(store).find((p) => p.type === "aux-presentation")!.id;

describe("initial state", () => {
  it("starts with the unscoped built-ins so targeting resolves before sync", () => {
    const store = createStore();
    expect(profilesOf(store).map((p) => p.id)).toEqual([
      PRESENTATION_CONTROLLER_ID,
      OVERLAY_CONTROLLER_ID,
    ]);
    expect(selectControllerProfilesLoaded(store.getState())).toBe(false);
  });

  it("falls back to the built-ins when the slice is absent entirely", () => {
    expect(selectControllerProfiles({}).map((p) => p.id)).toEqual([
      PRESENTATION_CONTROLLER_ID,
      OVERLAY_CONTROLLER_ID,
    ]);
  });

  it("returns a stable fallback reference, so subscribers do not re-render", () => {
    expect(selectControllerProfiles({})).toBe(selectControllerProfiles({}));
  });
});

describe("setControllerProfilesFromRemote", () => {
  it("marks the registry loaded and keeps the built-ins on a bad payload", () => {
    const store = createStore();
    store.dispatch(setControllerProfilesFromRemote("garbage"));
    expect(selectControllerProfilesLoaded(store.getState())).toBe(true);
    expect(profilesOf(store).map((p) => p.id)).toEqual([
      PRESENTATION_CONTROLLER_ID,
      OVERLAY_CONTROLLER_ID,
    ]);
  });
});

describe("addControllerProfile", () => {
  it("creates an auxiliary controller with its own outline scope", () => {
    const store = createStore();
    store.dispatch(addControllerProfile({ name: "Lobby" }));
    const added = profilesOf(store).find((p) => p.name === "Lobby")!;
    expect(added.type).toBe("aux-presentation");
    expect(added.enabled).toBe(true);
    // Its own scope, or its outlines would show in the main controller's picker.
    expect(added.outlineScope).toBe(added.id);
  });

  it("suffixes a colliding name", () => {
    const store = createStore();
    store.dispatch(addControllerProfile({ name: "Presentation" }));
    expect(profilesOf(store).map((p) => p.name)).toContain("Presentation 2");
  });

  it("seeds no displays, so it never silently claims a live screen", () => {
    const store = createStore();
    store.dispatch(addControllerProfile({ name: "Lobby" }));
    expect(profilesOf(store).find((p) => p.name === "Lobby")!.outputIds).toEqual(
      [],
    );
  });
});

describe("editing a controller", () => {
  it("renames", () => {
    const store = createStore();
    store.dispatch(addControllerProfile({ name: "Lobby" }));
    const id = auxIdOf(store);
    store.dispatch(renameControllerProfile({ id, name: "  Cafe  Screen " }));
    expect(profilesOf(store).find((p) => p.id === id)!.name).toBe("Cafe Screen");
  });

  it("retires without removing", () => {
    const store = createStore();
    store.dispatch(addControllerProfile({ name: "Lobby" }));
    const id = auxIdOf(store);
    store.dispatch(setControllerProfileEnabled({ id, enabled: false }));
    expect(profilesOf(store).find((p) => p.id === id)!.enabled).toBe(false);
  });

  it("de-duplicates the display list", () => {
    const store = createStore();
    store.dispatch(addControllerProfile({ name: "Lobby" }));
    const id = auxIdOf(store);
    store.dispatch(
      setControllerProfileOutputs({ id, outputIds: ["a", "a", "b"] }),
    );
    expect(profilesOf(store).find((p) => p.id === id)!.outputIds).toEqual([
      "a",
      "b",
    ]);
  });

  it("drops defaults that point at displays it no longer drives", () => {
    // A default the controller cannot reach would create items that send
    // nowhere, which reads to an operator as a broken item.
    const store = createStore();
    store.dispatch(addControllerProfile({ name: "Lobby" }));
    const id = auxIdOf(store);
    store.dispatch(setControllerProfileOutputs({ id, outputIds: ["a", "b"] }));
    store.dispatch(setControllerProfileDefaultSends({ id, outputIds: ["a", "b"] }));
    store.dispatch(setControllerProfileOutputs({ id, outputIds: ["a"] }));
    expect(
      profilesOf(store).find((p) => p.id === id)!.defaultSendOutputIds,
    ).toEqual(["a"]);
  });

  it("refuses a default for a display it does not drive", () => {
    const store = createStore();
    store.dispatch(addControllerProfile({ name: "Lobby" }));
    const id = auxIdOf(store);
    store.dispatch(setControllerProfileOutputs({ id, outputIds: ["a"] }));
    store.dispatch(
      setControllerProfileDefaultSends({ id, outputIds: ["projector"] }),
    );
    expect(
      profilesOf(store).find((p) => p.id === id)!.defaultSendOutputIds,
    ).toEqual([]);
  });
});

describe("removeControllerProfile", () => {
  it("removes an auxiliary controller", () => {
    const store = createStore();
    store.dispatch(addControllerProfile({ name: "Lobby" }));
    const id = auxIdOf(store);
    store.dispatch(removeControllerProfile(id));
    expect(profilesOf(store).some((p) => p.id === id)).toBe(false);
  });

  it("refuses to remove a built-in, which everything else falls back to", () => {
    const store = createStore();
    store.dispatch(removeControllerProfile(PRESENTATION_CONTROLLER_ID));
    expect(
      profilesOf(store).some((p) => p.id === PRESENTATION_CONTROLLER_ID),
    ).toBe(true);
  });
});

describe("reorderControllerProfiles", () => {
  it("reorders and reindexes, leaving unlisted ids at the end", () => {
    const store = createStore();
    store.dispatch(addControllerProfile({ name: "Lobby" }));
    const id = auxIdOf(store);
    store.dispatch(reorderControllerProfiles([id, PRESENTATION_CONTROLLER_ID]));
    expect(profilesOf(store).map((p) => p.id)).toEqual([
      id,
      PRESENTATION_CONTROLLER_ID,
      OVERLAY_CONTROLLER_ID,
    ]);
    expect(profilesOf(store).map((p) => p.order)).toEqual([0, 1, 2]);
  });
});
