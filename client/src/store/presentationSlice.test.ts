import { configureStore } from "@reduxjs/toolkit";
import { presentationSlice } from "./presentationSlice";
import { createPresentation } from "../test/fixtures";

type PresentationState = ReturnType<typeof presentationSlice.reducer>;
type PresentationSliceState = { presentation: PresentationState };

const createStore = (preloadedState?: Partial<PresentationSliceState>) =>
  configureStore({
    reducer: { presentation: presentationSlice.reducer },
    ...(preloadedState != null &&
      Object.keys(preloadedState).length > 0 && {
        preloadedState: preloadedState as PresentationSliceState,
      }),
  });

describe("presentationSlice", () => {
  describe("reducer only", () => {
    it("toggleProjectorTransmitting flips isProjectorTransmitting", () => {
      const store = createStore();
      expect(store.getState().presentation.isProjectorTransmitting).toBe(false);
      store.dispatch(presentationSlice.actions.toggleProjectorTransmitting());
      expect(store.getState().presentation.isProjectorTransmitting).toBe(true);
      store.dispatch(presentationSlice.actions.toggleProjectorTransmitting());
      expect(store.getState().presentation.isProjectorTransmitting).toBe(false);
    });

    it("setTransmitToAll sets all transmitting flags", () => {
      const store = createStore();
      store.dispatch(presentationSlice.actions.setTransmitToAll(true));
      const state = store.getState().presentation;
      expect(state.isProjectorTransmitting).toBe(true);
      expect(state.isMonitorTransmitting).toBe(true);
      expect(state.isStreamTransmitting).toBe(true);
      store.dispatch(presentationSlice.actions.setTransmitToAll(false));
      const next = store.getState().presentation;
      expect(next.isProjectorTransmitting).toBe(false);
      expect(next.isMonitorTransmitting).toBe(false);
      expect(next.isStreamTransmitting).toBe(false);
    });

    it("updatePresentation updates projectorInfo when transmitting", () => {
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          isProjectorTransmitting: true,
        },
      });
      const slide = {
        id: "s1",
        type: "Media" as const,
        name: "",
        boxes: [],
      };
      const payload = createPresentation({
        type: "song",
        name: "Test Song",
        slide,
        displayType: "projector",
      });
      store.dispatch(presentationSlice.actions.updatePresentation(payload));
      expect(store.getState().presentation.projectorInfo.name).toBe(
        "Test Song",
      );
      expect(store.getState().presentation.projectorInfo.type).toBe("song");
      expect(store.getState().presentation.projectorInfo.slide).toEqual(slide);
    });
  });
});
