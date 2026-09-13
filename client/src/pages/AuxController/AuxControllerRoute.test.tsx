import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import AuxController from "./AuxController";
import { getControllerItemPath } from "../../utils/outlineSlideSections";
import {
  controllerProfilesSlice,
  setControllerProfilesFromRemote,
} from "../../store/controllerProfilesSlice";
import { GlobalInfoContext } from "../../context/globalInfo";
import type { AccessType } from "../../context/globalInfo";

/**
 * The route guard's one hard rule: it never renders nothing.
 *
 * A blank window with no message is the worst state to hand an operator, and it
 * is exactly what gating the page on the registry having loaded produced —
 * a full RESET (or a race before the soft session reset) can leave the slice
 * unloaded briefly.
 */

// The controller body pulls in the whole presentation stack; these tests are
// about the guard in front of it.
jest.mock("../Controller/useControllerPageLifecycle", () => ({
  useControllerPageLifecycle: () => ({ layoutRef: { current: null } }),
}));

jest.mock("../../containers/ServiceItems/ServiceItems", () => ({
  __esModule: true,
  default: () => <div data-testid="service-items" />,
}));
jest.mock("../../containers/TransmitHandler/TransmitHandler", () => ({
  __esModule: true,
  default: () => <div data-testid="transmit-handler" />,
}));
jest.mock("../../containers/Media/Media", () => ({
  __esModule: true,
  default: () => <div data-testid="media" />,
}));
jest.mock("../Controller/Item", () => ({
  __esModule: true,
  default: () => <div data-testid="item" />,
}));
jest.mock("../../components/ControllerPageShell/ControllerPageShell", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="controller-shell">{children}</div>
  ),
}));
jest.mock("../../containers/ItemEditor/LyricsEditor", () => ({
  __esModule: true,
  default: () => <div data-testid="lyrics-editor" />,
}));

const LOBBY = {
  id: "ctrl_lobby",
  type: "aux-presentation",
  name: "Lobby",
  order: 2,
  enabled: true,
  outputIds: ["out_lobby"],
  outputsConfigured: true,
  outlineScope: "ctrl_lobby",
};

const renderRoute = (
  profiles?: unknown[],
  path = "/aux-controller/ctrl_lobby",
  access: AccessType = "full",
) => {
  const store = configureStore({
    reducer: {
      controllerProfiles: controllerProfilesSlice.reducer,
      displayOutputs: () => ({ list: [], isLoaded: true }),
      presentation: () => ({ outputs: {} }),
      undoable: () => ({
        present: {
          preferences: { scrollbarWidth: "auto" },
          itemLists: {},
          item: { isEditMode: false },
        },
      }),
    },
  });
  if (profiles) store.dispatch(setControllerProfilesFromRemote(profiles));
  render(
    <Provider store={store}>
      <GlobalInfoContext.Provider
        value={{ access, user: "op", churchName: "Test" } as never}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/aux-controller/:profileId/*"
              element={<AuxController />}
            />
          </Routes>
        </MemoryRouter>
      </GlobalInfoContext.Provider>
    </Provider>,
  );
};

describe("the auxiliary controller route", () => {
  it("opens straight away without waiting for the controller registry", () => {
    // The controller's identity is in the URL. Blocking the page on a
    // church-wide fetch stranded the operator on a spinner.
    renderRoute();
    expect(screen.getByTestId("controller-shell")).toBeInTheDocument();
    expect(screen.getByTestId("service-items")).toBeInTheDocument();
  });

  it("says so, and sends nowhere, while its settings are still loading", () => {
    renderRoute();
    expect(
      screen.getByText(/cannot send to a display yet/i),
    ).toBeInTheDocument();
  });

  it("explains a controller that no longer exists", () => {
    renderRoute([]);
    expect(
      screen.getByText(/This controller is not available/i),
    ).toBeInTheDocument();
  });

  it("explains a retired controller rather than opening it", () => {
    renderRoute([{ ...LOBBY, enabled: false }]);
    expect(
      screen.getByText(/This controller is not available/i),
    ).toBeInTheDocument();
  });

  it("refuses to open a built-in controller through this route", () => {
    // Its displays and outlines belong to the presentation controller.
    renderRoute([LOBBY], "/aux-controller/presentation");
    expect(
      screen.getByText(/This controller is not available/i),
    ).toBeInTheDocument();
  });

  it("opens the controller once its profile is available", () => {
    renderRoute([LOBBY]);
    expect(screen.getByTestId("controller-shell")).toBeInTheDocument();
    expect(screen.getByTestId("service-items")).toBeInTheDocument();
  });

  it("mounts the lyrics editor like the main controller", () => {
    renderRoute([LOBBY]);
    expect(screen.getByTestId("lyrics-editor")).toBeInTheDocument();
  });

  it("keeps the lyrics editor off view-only access", () => {
    renderRoute([LOBBY], "/aux-controller/ctrl_lobby", "view");
    expect(screen.queryByTestId("lyrics-editor")).not.toBeInTheDocument();
  });

  it("drops the warning once the real profile arrives", () => {
    renderRoute([LOBBY]);
    expect(screen.queryByText(/cannot send to a display yet/i)).toBeNull();
  });

  it("offers a way back from the unavailable screen", () => {
    renderRoute([]);
    expect(screen.getByRole("link", { name: /Back to home/i })).toHaveAttribute(
      "href",
      "/home",
    );
  });
});

/**
 * Outline rows used to link to "/controller/item/…" regardless of which
 * controller rendered them, so clicking an item on an auxiliary controller
 * opened the presentation controller with that item.
 */
describe("outline links stay on this controller", () => {
  it("builds item routes under the controller's own path", () => {
    const item = { _id: "song/1", listId: "list-2" };
    expect(getControllerItemPath(item, "/aux-controller/ctrl_lobby")).toBe(
      `/aux-controller/ctrl_lobby/item/${window.btoa(
        encodeURI("song/1"),
      )}/${window.btoa(encodeURI("list-2"))}`,
    );
  });

  it("still defaults to the main controller for callers without one", () => {
    expect(
      getControllerItemPath({ _id: "a", listId: "b" }).startsWith("/controller/"),
    ).toBe(true);
  });
});
