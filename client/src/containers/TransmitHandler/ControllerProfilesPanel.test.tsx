import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import ControllerProfilesPanel from "./ControllerProfilesPanel";
import {
  displayOutputsSlice,
  setDisplayOutputsFromRemote,
} from "../../store/displayOutputsSlice";
import {
  controllerProfilesSlice,
  setControllerProfilesFromRemote,
} from "../../store/controllerProfilesSlice";

const writeControllerProfiles = jest.fn().mockResolvedValue(true);
const showToast = jest.fn();

jest.mock("../../utils/controllerProfilesWriter", () => ({
  writeControllerProfiles: (...args: unknown[]) =>
    writeControllerProfiles(...args),
}));

jest.mock("../../context/toastContext", () => ({
  useToast: () => ({ showToast }),
}));

jest.mock("../../context/globalInfo", () => ({
  GlobalInfoContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
    Consumer: () => null,
    displayName: "GlobalInfoContext",
  },
}));

/** A church with the built-ins plus one custom projector that has been retired. */
const REGISTRY = [
  { id: "projector", type: "projector", name: "Projector", order: 0 },
  { id: "monitor", type: "monitor", name: "Monitor", order: 1 },
  { id: "stream", type: "stream", name: "Stream", order: 2 },
  {
    id: "out_tvs",
    type: "projector",
    name: "TVs",
    order: 3,
    enabled: false,
  },
  { id: "out_lobby", type: "projector", name: "Lobby", order: 4 },
];

const PROFILES = [
  {
    id: "ctrl_visual",
    type: "aux-presentation",
    name: "Visual Technician",
    order: 2,
    enabled: true,
    outputIds: [],
    outputsConfigured: true,
    defaultSendOutputIds: [],
    outlineScope: "ctrl_visual",
  },
];

const renderPanel = (profiles: unknown[] = PROFILES) => {
  const store = configureStore({
    reducer: {
      displayOutputs: displayOutputsSlice.reducer,
      controllerProfiles: controllerProfilesSlice.reducer,
    },
  });
  store.dispatch(setDisplayOutputsFromRemote(REGISTRY));
  store.dispatch(setControllerProfilesFromRemote(profiles));
  render(
    <Provider store={store}>
      <ControllerProfilesPanel />
    </Provider>,
  );
  return { store };
};

/** Groups are per controller, since built-ins are configured the same way. */
const drivesGroup = (controller = "Visual Technician") =>
  screen.getByRole("group", {
    name: new RegExp(`${controller} .* displays it drives`, "i"),
  });

const defaultsGroup = (controller = "Visual Technician") =>
  screen.getByRole("group", {
    name: new RegExp(`${controller} .* default displays for new items`, "i"),
  });

beforeEach(() => {
  writeControllerProfiles.mockClear();
  showToast.mockClear();
});

describe("displays a controller can be given", () => {
  it("offers every custom display, not just the three built-ins", () => {
    // The reported bug: a display the operator created was missing here.
    renderPanel();
    const group = drivesGroup();
    for (const name of ["Projector", "Monitor", "Stream", "Lobby", "TVs"]) {
      expect(within(group).getByLabelText(`${name}:`)).toBeInTheDocument();
    }
  });

  it("lists a retired display rather than silently dropping it", () => {
    // Hiding it made a display the operator had just created look like it had
    // never been saved.
    renderPanel();
    const group = drivesGroup();
    expect(within(group).getByLabelText("TVs:")).toBeDisabled();
    expect(
      within(group).getByText(/enable it under Displays above/i),
    ).toBeInTheDocument();
  });

  it("leaves live displays selectable", () => {
    renderPanel();
    expect(within(drivesGroup()).getByLabelText("Lobby:")).toBeEnabled();
  });

  it("warns that a freshly created controller drives nothing yet", () => {
    renderPanel();
    expect(
      screen.getByText(/drives no displays and cannot send anything/i),
    ).toBeInTheDocument();
  });

  it("keeps the rest when one screen is switched off a built-in", async () => {
    // Starting from its stored (empty) list would turn one click into
    // "drive only this one" and silently drop every other screen.
    const { store } = renderPanel();
    await userEvent.click(
      within(drivesGroup("Presentation")).getByLabelText("Monitor:"),
    );
    const presentation = store
      .getState()
      .controllerProfiles.list.find((p) => p.id === "presentation");
    expect(presentation?.outputIds).toEqual(["projector", "stream"]);
    expect(presentation?.outputsConfigured).toBe(true);
  });

  it("can be switched off like any other controller, but not removed", () => {
    renderPanel();
    // Every controller gets an Enabled switch; only auxiliary ones can be
    // removed, since the built-ins are routes that must keep existing.
    expect(screen.getAllByLabelText("Enabled:")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /Remove/i })).toHaveLength(1);
  });

  it("drives nothing once switched off", async () => {
    const { store } = renderPanel();
    const enabledToggles = screen.getAllByLabelText("Enabled:");
    await userEvent.click(enabledToggles[0]);
    expect(
      store.getState().controllerProfiles.list.find((p) => p.id === "presentation")
        ?.enabled,
    ).toBe(false);
  });
});

describe("assigning a display", () => {
  it("scopes the controller and persists it", async () => {
    const { store } = renderPanel();
    await userEvent.click(within(drivesGroup()).getByLabelText("Lobby:"));

    const profile = store
      .getState()
      .controllerProfiles.list.find((p) => p.id === "ctrl_visual");
    expect(profile?.outputIds).toEqual(["out_lobby"]);
    await waitFor(() => expect(writeControllerProfiles).toHaveBeenCalled());
  });

  it("leaves the main controller's own displays alone", async () => {
    renderPanel();
    await userEvent.click(within(drivesGroup()).getByLabelText("Lobby:"));
    const presentation = drivesGroup("Presentation");
    expect(within(presentation).getByLabelText("Projector:")).toBeChecked();
    expect(within(presentation).getByLabelText("Lobby:")).not.toBeChecked();
  });

  it("narrows the default choices to the displays it drives", async () => {
    renderPanel();
    await userEvent.click(within(drivesGroup()).getByLabelText("Lobby:"));

    expect(within(defaultsGroup()).getByLabelText("Lobby:")).toBeInTheDocument();
    // Scoped now, so another controller's screens are no longer on offer.
    expect(within(defaultsGroup()).queryByLabelText("Monitor:")).toBeNull();
  });

  it("explains an empty default list when every assigned display is off", () => {
    renderPanel([
      {
        ...PROFILES[0],
        outputIds: ["out_tvs"],
      },
    ]);
    expect(
      screen.getByText(/Nothing to choose from until this controller drives/i),
    ).toBeInTheDocument();
  });

  it("keeps a retired display assigned rather than quietly unassigning it", () => {
    // Turning a screen off for a week should not lose the controller's wiring.
    const { store } = renderPanel([
      {
        ...PROFILES[0],
        outputIds: ["out_tvs"],
      },
    ]);
    expect(
      store.getState().controllerProfiles.list.find((p) => p.id === "ctrl_visual")
        ?.outputIds,
    ).toEqual(["out_tvs"]);
    expect(within(drivesGroup()).getByLabelText("TVs:")).toBeChecked();
  });
});
