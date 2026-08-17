import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import Projector from "../Projector";
import { presentationSlice } from "../../store/presentationSlice";
import {
  displayOutputsSlice,
  setDisplayOutputsFromRemote,
} from "../../store/displayOutputsSlice";
import { timersSlice } from "../../store/timersSlice";
import { preferencesSlice } from "../../store/preferencesSlice";
import { writeScreenSettings } from "../../utils/screenSettingsStore";

jest.mock("../../containers/FullscreenPresentation", () => ({
  __esModule: true,
  default: () => <div data-testid="windowed-projector" />,
}));

jest.mock("../ProjectorFull", () => ({
  __esModule: true,
  default: () => <div data-testid="headless-projector" />,
}));

jest.mock("../../hooks/useWakeLock", () => ({ useWakeLock: () => {} }));

const createStore = () => {
  const store = configureStore({
    reducer: {
      presentation: presentationSlice.reducer,
      displayOutputs: displayOutputsSlice.reducer,
      timers: timersSlice.reducer,
      undoable: (
        state = {
          present: { preferences: preferencesSlice.getInitialState() },
        },
      ) => state,
    },
  });
  store.dispatch(
    setDisplayOutputsFromRemote({
      projector: {
        id: "projector",
        type: "projector",
        name: "Main",
        order: 0,
      },
      out_lobby: {
        id: "out_lobby",
        type: "projector",
        name: "Lobby",
        order: 1,
      },
    }),
  );
  return store;
};

const renderAt = (search: string) =>
  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={[`/projector${search}`]}>
        <Projector />
      </MemoryRouter>
    </Provider>,
  );

beforeEach(() => {
  window.localStorage.clear();
});

describe("Projector headless setting", () => {
  it("shows the windowed output by default, keeping the fullscreen button", () => {
    renderAt("");
    expect(screen.getByTestId("windowed-projector")).toBeInTheDocument();
  });

  it("drops the chrome when this screen is marked headless", () => {
    writeScreenSettings("projector", { isHeadless: true }, "projector");
    renderAt("");
    expect(screen.getByTestId("headless-projector")).toBeInTheDocument();
  });

  it("applies headless per display, not to every projector on the machine", () => {
    writeScreenSettings("out_lobby", { isHeadless: true }, "projector");

    renderAt("?output=out_lobby");
    expect(screen.getByTestId("headless-projector")).toBeInTheDocument();

    renderAt("");
    expect(screen.getByTestId("windowed-projector")).toBeInTheDocument();
  });
});
