import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import TransmitHandler from "./TransmitHandler";
import { presentationSlice } from "../../store/presentationSlice";
import { preferencesSlice } from "../../store/preferencesSlice";
import { timersSlice } from "../../store/timersSlice";

jest.mock("../../components/Presentation/Presentation", () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => (
    <div data-testid={`presentation-${name.toLowerCase()}`}>{name}</div>
  ),
}));

const createStore = () =>
  configureStore({
    reducer: {
      presentation: presentationSlice.reducer,
      timers: timersSlice.reducer,
      undoable: (
        state = {
          present: {
            preferences: preferencesSlice.getInitialState(),
          },
        }
      ) => state,
    },
    preloadedState: {
      presentation: presentationSlice.getInitialState(),
      timers: timersSlice.getInitialState(),
      undoable: {
        present: {
          preferences: {
            ...preferencesSlice.getInitialState(),
            isMediaExpanded: false,
          },
        },
      },
    },
  } as Parameters<typeof configureStore>[0]);

describe("TransmitHandler", () => {
  it("renders only Stream when visibleScreens is stream", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <TransmitHandler visibleScreens={["stream"]} />
      </Provider>
    );
    expect(screen.getByTestId("presentation-stream")).toBeInTheDocument();
    expect(screen.queryByTestId("presentation-projector")).not.toBeInTheDocument();
    expect(screen.queryByTestId("presentation-monitor")).not.toBeInTheDocument();
  });

  it("renders all three screens by default", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <TransmitHandler />
      </Provider>
    );
    expect(screen.getByTestId("presentation-stream")).toBeInTheDocument();
    expect(screen.getByTestId("presentation-projector")).toBeInTheDocument();
    expect(screen.getByTestId("presentation-monitor")).toBeInTheDocument();
  });

  it("hides overlay-only controls by default", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <TransmitHandler visibleScreens={["stream"]} />
      </Provider>
    );

    expect(screen.queryByText("Hide Content")).not.toBeInTheDocument();
    expect(screen.queryByText("Clear Overlays")).not.toBeInTheDocument();
  });

  it("shows stream-focused controls when requested", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <TransmitHandler
          visibleScreens={["stream"]}
          variant="overlayStreamFocus"
          showStreamOverlayOnlyToggle
          showClearStreamOverlaysButton
        />
      </Provider>
    );

    expect(screen.getByText("Clear All")).toBeInTheDocument();
    expect(screen.getByText("Live:")).toBeInTheDocument();
    expect(screen.getByText("Hide Content:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Overlays" })).toBeInTheDocument();
  });
});
