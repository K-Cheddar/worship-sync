import { configureStore } from "@reduxjs/toolkit";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import Overlay from "./Overlay";
import { presentationSlice } from "../../store/presentationSlice";
import { overlaysSlice } from "../../store/overlaysSlice";
import { overlaySlice } from "../../store/overlaySlice";
import { selectOverlay } from "../../store/overlaySlice";

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

/**
 * Selection→load is owned by Overlays.selectAndLoadOverlay. This smoke covers the
 * operator row click contract: selecting a list row invokes the parent loader with
 * the overlay id (Overlays then loads from IndexedDB and dispatches selectOverlay).
 */
describe("Overlay selection → load wiring", () => {
  it("calls selectAndLoadOverlay with the overlay id when the row is clicked", async () => {
    const user = userEvent.setup();
    const selectAndLoadOverlay = jest.fn();
    const store = configureStore({
      reducer: {
        presentation: presentationSlice.reducer,
        overlays: overlaysSlice.reducer,
        overlay: overlaySlice.reducer,
      },
    });

    render(
      <Provider store={store}>
        <ul>
          <Overlay
            overlay={{
              id: "ov-select-1",
              type: "participant",
              name: "Riley",
              title: "",
              event: "",
            }}
            selectedId=""
            isStreamTransmitting
            initialList={[]}
            selectAndLoadOverlay={selectAndLoadOverlay}
            handleDeleteOverlay={jest.fn()}
          />
        </ul>
      </Provider>,
    );

    await user.click(screen.getByText("Riley"));
    expect(selectAndLoadOverlay).toHaveBeenCalledWith("ov-select-1");
  });

  it("selectOverlay reducer applies loaded overlay formatting defaults path", () => {
    const store = configureStore({
      reducer: { overlay: overlaySlice.reducer },
    });

    act(() => {
      store.dispatch(
        selectOverlay({
          id: "ov-loaded",
          type: "participant",
          name: "Jordan",
          title: "Host",
          formatting: { participantOverlayPosition: "center" },
        } as never),
      );
    });

    expect(store.getState().overlay.selectedOverlay?.name).toBe("Jordan");
    expect(store.getState().overlay.selectedOverlay?.id).toBe("ov-loaded");
  });
});
