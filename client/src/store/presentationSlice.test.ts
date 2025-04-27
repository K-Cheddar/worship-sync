import { configureStore } from "@reduxjs/toolkit";
import presentationReducer, {
  updatePresentation,
  updateBibleDisplayInfo,
  clearAll,
  toggleProjectorTransmitting,
  toggleMonitorTransmitting,
  toggleStreamTransmitting,
} from "./presentationSlice";
import { ItemSlide, Presentation } from "../types";
import { RootState } from "./store";

describe("presentationSlice", () => {
  let store: ReturnType<typeof configureStore>;

  beforeEach(() => {
    store = configureStore({
      reducer: {
        presentation: presentationReducer,
      },
    });
  });

  describe("updatePresentation", () => {
    const testSlide: ItemSlide = {
      type: "song",
      id: "test-slide",
      boxes: [
        {
          words: "Test words",
          width: 100,
          height: 100,
        },
      ],
    };

    it("should update all transmitting displays", () => {
      // Set all displays to transmitting
      store.dispatch(toggleProjectorTransmitting());
      store.dispatch(toggleMonitorTransmitting());
      store.dispatch(toggleStreamTransmitting());

      store.dispatch(
        updatePresentation({
          slide: testSlide,
          type: "song",
          name: "Test Song",
        })
      );

      const state = (store.getState() as RootState).presentation;
      expect(state.streamInfo.slide).toEqual(testSlide);
      expect(state.streamInfo.type).toBe("song");
      expect(state.streamInfo.name).toBe("Test Song");
    });

    it("should handle bible type presentations", () => {
      store.dispatch(toggleStreamTransmitting());

      const biblePresentation: Presentation = {
        type: "bible",
        name: "Test Bible",
        slide: null,
        bibleDisplayInfo: {
          title: "John 3:16",
          text: "For God so loved the world...",
        },
      };

      store.dispatch(updatePresentation(biblePresentation));

      const state = (store.getState() as RootState).presentation;
      expect(state.streamInfo.type).toBe("bible");
      expect(state.streamInfo.slide).toBeNull();
      expect(state.streamInfo.bibleDisplayInfo).toEqual(
        biblePresentation.bibleDisplayInfo
      );
    });
  });

  describe("updateBibleDisplayInfo", () => {
    it("should update bible display info for transmitting displays", () => {
      store.dispatch(toggleStreamTransmitting());

      const bibleInfo = {
        title: "John 3:16",
        text: "For God so loved the world...",
      };

      store.dispatch(updateBibleDisplayInfo(bibleInfo));

      const state = (store.getState() as RootState).presentation;
      expect(state.streamInfo.bibleDisplayInfo).toEqual(bibleInfo);
    });

    it("should clear other overlays when updating bible display info", () => {
      store.dispatch(toggleStreamTransmitting());

      // First set some overlays
      store.dispatch(
        updatePresentation({
          type: "song",
          name: "Test Song",
          slide: {
            type: "song",
            id: "test-slide",
            boxes: [],
          },
          participantOverlayInfo: {
            id: "test",
            type: "participant",
            name: "Test Participant",
          },
        })
      );

      // Then update bible display info
      store.dispatch(
        updateBibleDisplayInfo({
          title: "John 3:16",
          text: "For God so loved the world...",
        })
      );

      const state = (store.getState() as RootState).presentation;
      expect(state.streamInfo.participantOverlayInfo).toEqual({
        name: "",
        time: expect.any(Number),
        id: expect.any(String),
      });
    });
  });

  describe("clearAll", () => {
    it("should clear all displays", () => {
      // Set up some state
      store.dispatch(toggleStreamTransmitting());
      store.dispatch(
        updatePresentation({
          slide: {
            type: "song",
            id: "test-slide",
            boxes: [],
          },
          type: "song",
          name: "Test Song",
        })
      );

      store.dispatch(clearAll());

      const state = (store.getState() as RootState).presentation;
      expect(state.streamInfo.slide).toBeNull();
      expect(state.streamInfo.type).toBe("");
      expect(state.streamInfo.name).toBe("");
    });
  });

  describe("transmitting states", () => {
    it("should toggle projector transmitting state", () => {
      store.dispatch(toggleProjectorTransmitting());
      expect(
        (store.getState() as RootState).presentation.isProjectorTransmitting
      ).toBe(true);

      store.dispatch(toggleProjectorTransmitting());
      expect(
        (store.getState() as RootState).presentation.isProjectorTransmitting
      ).toBe(false);
    });

    it("should toggle monitor transmitting state", () => {
      store.dispatch(toggleMonitorTransmitting());
      expect(
        (store.getState() as RootState).presentation.isMonitorTransmitting
      ).toBe(true);

      store.dispatch(toggleMonitorTransmitting());
      expect(
        (store.getState() as RootState).presentation.isMonitorTransmitting
      ).toBe(false);
    });

    it("should toggle stream transmitting state", () => {
      store.dispatch(toggleStreamTransmitting());
      expect(
        (store.getState() as RootState).presentation.isStreamTransmitting
      ).toBe(true);

      store.dispatch(toggleStreamTransmitting());
      expect(
        (store.getState() as RootState).presentation.isStreamTransmitting
      ).toBe(false);
    });
  });
});
