import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import DisplayOutputsPanel from "./DisplayOutputsPanel";
import { presentationSlice } from "../../store/presentationSlice";
import {
  displayOutputsSlice,
  setDisplayOutputsFromRemote,
} from "../../store/displayOutputsSlice";

const writeDisplayOutputs = jest.fn().mockResolvedValue(true);
const showToast = jest.fn();

jest.mock("../../utils/displayOutputsWriter", () => ({
  writeDisplayOutputs: (...args: unknown[]) => writeDisplayOutputs(...args),
}));

jest.mock("../../store/store", () => ({
  clearRemoteOutputState: jest.fn().mockResolvedValue(undefined),
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

const REGISTRY = {
  projector: { id: "projector", type: "projector", name: "Main", order: 0 },
  monitor: { id: "monitor", type: "monitor", name: "Stage", order: 1 },
  stream: { id: "stream", type: "stream", name: "Stream", order: 2 },
  credits: { id: "credits", type: "credits", name: "Credits", order: 3 },
};

const createStore = () => {
  const store = configureStore({
    reducer: {
      presentation: presentationSlice.reducer,
      displayOutputs: displayOutputsSlice.reducer,
    },
  });
  store.dispatch(setDisplayOutputsFromRemote(REGISTRY));
  return store;
};

const renderPanel = (store: ReturnType<typeof createStore>) =>
  render(
    <Provider store={store}>
      <DisplayOutputsPanel />
    </Provider>,
  );

beforeEach(() => {
  writeDisplayOutputs.mockClear().mockResolvedValue(true);
  showToast.mockClear();
});

describe("DisplayOutputsPanel", () => {
  it("lists the push outputs an operator can send content to", () => {
    renderPanel(createStore());
    expect(screen.getByDisplayValue("Main")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Stage")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Stream")).toBeInTheDocument();
  });

  it("leaves out pull outputs, which take no presentation content", () => {
    renderPanel(createStore());
    expect(screen.queryByDisplayValue("Credits")).not.toBeInTheDocument();
  });

  it("shows the screen link an operator opens on the second machine", () => {
    renderPanel(createStore());
    expect(
      screen.getByText("/projector-full?output=projector"),
    ).toBeInTheDocument();
  });

  it("adds a named output and persists the registry", async () => {
    const user = userEvent.setup();
    const store = createStore();
    renderPanel(store);

    await user.type(screen.getByLabelText("New display name"), "Lobby");
    await user.click(screen.getByRole("button", { name: "Add" }));

    const added = store
      .getState()
      .displayOutputs.list.find((output) => output.name === "Lobby");
    expect(added?.type).toBe("projector");
    expect(writeDisplayOutputs).toHaveBeenCalled();
  });

  it("gives the new output a presentation slot so it can go live at once", async () => {
    const user = userEvent.setup();
    const store = createStore();
    renderPanel(store);

    await user.type(screen.getByLabelText("New display name"), "Lobby");
    await user.click(screen.getByRole("button", { name: "Add" }));

    const added = store
      .getState()
      .displayOutputs.list.find((output) => output.name === "Lobby");
    expect(store.getState().presentation.outputs[added!.id]).toBeDefined();
  });

  it("hides an output from controllers without deleting it", async () => {
    const user = userEvent.setup();
    const store = createStore();
    renderPanel(store);

    // Rows follow registry order: Main, Stage, Stream.
    const streamRow = screen.getAllByRole("listitem")[2];
    await user.click(
      within(streamRow).getByRole("switch", {
        name: /Enabled/,
      }),
    );

    const stream = store
      .getState()
      .displayOutputs.list.find((output) => output.id === "stream");
    expect(stream?.enabled).toBe(false);
    expect(stream).toBeDefined();
  });

  it("offers a drag handle for every display row", () => {
    renderPanel(createStore());

    expect(
      screen.getByRole("button", { name: "Reorder Stage" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reorder Main" }),
    ).toBeInTheDocument();
  });

  it("offers no delete control for a built-in output", () => {
    renderPanel(createStore());
    expect(
      screen.queryByRole("button", { name: "Remove Main" }),
    ).not.toBeInTheDocument();
  });

  it("tells the operator what to do when the registry cannot be saved", async () => {
    writeDisplayOutputs.mockResolvedValue(false);
    const user = userEvent.setup();
    renderPanel(createStore());

    await user.type(screen.getByLabelText("New display name"), "Lobby");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining("try again"),
        "error",
      ),
    );
  });

  it("hides a band control when the thing it configures is switched off", async () => {
    const user = userEvent.setup();
    renderPanel(createStore());

    // Clock defaults on, so its size control is offered.
    expect(screen.getByLabelText("Clock size for Stage")).toBeInTheDocument();

    const stageRow = screen.getAllByRole("listitem")[1];
    await user.click(within(stageRow).getAllByRole("switch")[1]);

    // Turning Clock off must take its size control with it, or the panel offers
    // a control that cannot do anything.
    expect(screen.queryByLabelText("Clock size for Stage")).toBeNull();
  });

  it("configures stream video sound and its default level", async () => {
    const user = userEvent.setup();
    renderPanel(createStore());
    const streamRow = screen.getAllByRole("listitem")[2];

    await user.click(
      within(streamRow).getByRole("switch", { name: /Video sound/ }),
    );

    expect(
      within(streamRow).getByLabelText("Video volume for Stream"),
    ).toHaveValue(100);
  });

  it("serializes an in-flight settings save before removing its display", async () => {
    jest.useFakeTimers();
    const store = createStore();
    store.dispatch(
      setDisplayOutputsFromRemote({
        ...REGISTRY,
        out_lobby: {
          id: "out_lobby",
          type: "projector",
          name: "Lobby",
          order: 4,
          settings: { showClock: true },
        },
      }),
    );
    let finishFirstWrite: ((saved: boolean) => void) | undefined;
    writeDisplayOutputs.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishFirstWrite = resolve;
        }),
    );
    renderPanel(store);
    const lobbyRow = screen.getAllByRole("listitem")[3];

    fireEvent.change(within(lobbyRow).getByLabelText("Clock size for Lobby"), {
      target: { value: "80" },
    });
    await act(async () => jest.advanceTimersByTime(500));
    expect(writeDisplayOutputs).toHaveBeenCalledTimes(1);

    fireEvent.click(
      within(lobbyRow).getByRole("button", { name: "Remove Lobby" }),
    );
    expect(writeDisplayOutputs).toHaveBeenCalledTimes(1);

    await act(async () => finishFirstWrite?.(true));
    jest.useRealTimers();
    await waitFor(() => expect(writeDisplayOutputs).toHaveBeenCalledTimes(2));
    const removalOutputs = writeDisplayOutputs.mock.calls[1][2];
    expect(removalOutputs).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "out_lobby" })]),
    );
  });
});

describe("before the church's registry has loaded", () => {
  const unhydratedStore = () =>
    configureStore({
      reducer: {
        presentation: presentationSlice.reducer,
        displayOutputs: displayOutputsSlice.reducer,
      },
    });

  it("does not persist edits made against the shipped defaults", async () => {
    const user = userEvent.setup();
    renderPanel(unhydratedStore());

    // Rows show built-in defaults, not this church's displays. Writing them
    // would overwrite real names, order, and enabled state.
    const rows = screen.getAllByRole("listitem");
    await user.click(within(rows[0]).getAllByRole("switch")[0]);

    expect(writeDisplayOutputs).not.toHaveBeenCalled();
  });

  it("tells the operator the panel is still loading", () => {
    renderPanel(unhydratedStore());
    expect(screen.getByText(/Loading this church/)).toBeInTheDocument();
  });

  it("enables editing once the registry lands", () => {
    const store = unhydratedStore();
    const { rerender } = render(
      <Provider store={store}>
        <DisplayOutputsPanel />
      </Provider>,
    );

    store.dispatch(setDisplayOutputsFromRemote(REGISTRY));
    rerender(
      <Provider store={store}>
        <DisplayOutputsPanel />
      </Provider>,
    );

    expect(screen.queryByText(/Loading this church/)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Main")).toBeEnabled();
  });
});

describe("the screen link an operator copies", () => {
  const writeText = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
  });

  it("copies a hash route, which is the only form the router reads", async () => {
    const user = userEvent.setup();
    // Installed after setup: user-event puts its own clipboard stub in place.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderPanel(createStore());

    await user.click(
      screen.getByRole("button", { name: "Copy screen link for Main" }),
    );

    // Without the `#` the app lands on its default route and never sees
    // `?output=`, so the screen resolves some other display.
    const [copied] = writeText.mock.calls[0];
    expect(copied).toContain("#/projector-full?output=projector");
  });
});
