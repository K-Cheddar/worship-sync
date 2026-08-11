import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import Overlay from "./Overlay";
import { presentationSlice } from "../../store/presentationSlice";
import { overlaysSlice } from "../../store/overlaysSlice";

jest.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: null,
  }),
}));

jest.mock("@gsap/react", () => ({
  useGSAP: () => { },
}));

const createStore = (presentationOverrides = {}) =>
  configureStore({
    reducer: {
      presentation: presentationSlice.reducer,
      overlays: overlaysSlice.reducer,
    },
    preloadedState: {
      presentation: {
        ...presentationSlice.getInitialState(),
        isStreamTransmitting: true,
        ...presentationOverrides,
      },
      overlays: overlaysSlice.getInitialState(),
    },
  });

describe("Overlay send", () => {
  const selectAndLoadOverlay = jest.fn();
  const handleDeleteOverlay = jest.fn();

  beforeEach(() => {
    selectAndLoadOverlay.mockReset();
    handleDeleteOverlay.mockReset();
  });

  it("dispatches updateParticipantOverlayInfo when Send is clicked", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const overlay = {
      id: "ov-1",
      type: "participant" as const,
      name: "Alex",
      title: "Host",
      event: "",
      duration: 0,
    };

    render(
      <Provider store={store}>
        <ul>
          <Overlay
            overlay={overlay}
            selectedId="ov-1"
            isStreamTransmitting
            initialList={[]}
            selectAndLoadOverlay={selectAndLoadOverlay}
            handleDeleteOverlay={handleDeleteOverlay}
          />
        </ul>
      </Provider>,
    );

    await user.click(screen.getByRole("button", { name: /Send/i }));

    expect(
      store.getState().presentation.streamInfo.participantOverlayInfo?.name,
    ).toBe("Alex");
    expect(
      store.getState().presentation.streamInfo.participantOverlayInfo?.title,
    ).toBe("Host");
  });

  it("does not send when stream is not transmitting", async () => {
    const user = userEvent.setup();
    const store = createStore({ isStreamTransmitting: false });
    const overlay = {
      id: "ov-2",
      type: "participant" as const,
      name: "Alex",
      title: "",
      event: "",
    };

    render(
      <Provider store={store}>
        <ul>
          <Overlay
            overlay={overlay}
            selectedId="ov-2"
            isStreamTransmitting={false}
            initialList={[]}
            selectAndLoadOverlay={selectAndLoadOverlay}
            handleDeleteOverlay={handleDeleteOverlay}
          />
        </ul>
      </Provider>,
    );

    expect(screen.getByRole("button", { name: /Send/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Send/i }));
    expect(
      store.getState().presentation.streamInfo.participantOverlayInfo?.name,
    ).toBe("");
  });

  it("dispatches updateStbOverlayInfo for stick-to-bottom overlays", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const overlay = {
      id: "ov-stb",
      type: "stick-to-bottom" as const,
      heading: "Welcome",
      subHeading: "Service starts soon",
      duration: 0,
    };

    render(
      <Provider store={store}>
        <ul>
          <Overlay
            overlay={overlay}
            selectedId="ov-stb"
            isStreamTransmitting
            initialList={[]}
            selectAndLoadOverlay={selectAndLoadOverlay}
            handleDeleteOverlay={handleDeleteOverlay}
          />
        </ul>
      </Provider>,
    );

    await user.click(screen.getByRole("button", { name: /Send/i }));
    expect(
      store.getState().presentation.streamInfo.stbOverlayInfo?.heading,
    ).toBe("Welcome");
  });
});
