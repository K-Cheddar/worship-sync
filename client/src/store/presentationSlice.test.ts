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

    it("toggles monitor and stream transmitting flags", () => {
      const store = createStore();
      expect(store.getState().presentation.isMonitorTransmitting).toBe(false);
      expect(store.getState().presentation.isStreamTransmitting).toBe(false);

      store.dispatch(presentationSlice.actions.toggleMonitorTransmitting());
      store.dispatch(presentationSlice.actions.toggleStreamTransmitting());

      expect(store.getState().presentation.isMonitorTransmitting).toBe(true);
      expect(store.getState().presentation.isStreamTransmitting).toBe(true);
    });

    it("updateProjector respects skipTransmissionCheck when projector is not transmitting", () => {
      const store = createStore();
      const slide = {
        id: "p-slide",
        type: "Media" as const,
        name: "Projector Slide",
        boxes: [],
      };

      store.dispatch(
        presentationSlice.actions.updateProjector(
          createPresentation({
            type: "song",
            name: "Projected",
            slide,
            displayType: "projector",
            skipTransmissionCheck: true,
          } as never),
        ),
      );

      const state = store.getState().presentation;
      expect(state.projectorInfo.name).toBe("Projected");
      expect(state.projectorInfo.slide).toEqual(slide);
      expect(state.prevProjectorInfo.name).toBe("");
    });

    it("updateMonitor sets nextSlide fallback and stores transition metadata", () => {
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          isMonitorTransmitting: true,
          monitorInfo: {
            ...presentationSlice.getInitialState().monitorInfo,
            nextSlide: { id: "old-next", type: "Media", name: "", boxes: [] },
          },
        },
      });

      const slide = {
        id: "m-slide",
        type: "Media" as const,
        name: "Current",
        boxes: [],
      };
      const bibleInfoBox = { id: "box-1", words: "ref" };

      store.dispatch(
        presentationSlice.actions.updateMonitor(
          createPresentation({
            type: "bible",
            name: "Monitor",
            slide,
            displayType: "monitor",
            itemId: "item-1",
            transitionDirection: "next",
            bibleInfoBox: bibleInfoBox as never,
          } as never),
        ),
      );

      const state = store.getState().presentation;
      expect(state.monitorInfo.slide).toEqual(slide);
      expect(state.monitorInfo.nextSlide).toBeNull();
      expect(state.monitorInfo.transitionDirection).toBe("next");
      expect(state.monitorInfo.bibleInfoBox).toEqual(bibleInfoBox);
      expect(state.prevMonitorInfo.nextSlide).toEqual({
        id: "old-next",
        type: "Media",
        name: "",
        boxes: [],
      });
    });

    it("updateStream keeps previous slide for bible payload and resets missing overlays", () => {
      const initialSlide = {
        id: "old-stream",
        type: "Media" as const,
        name: "Old Stream",
        boxes: [],
      };
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            slide: initialSlide,
            participantOverlayInfo: { name: "Person", id: "p1", time: 1 },
            stbOverlayInfo: { heading: "Heading", id: "s1", time: 1 },
            qrCodeOverlayInfo: { description: "QR", id: "q1", time: 1 },
            imageOverlayInfo: { name: "Image", imageUrl: "img", id: "i1", time: 1 },
            formattedTextDisplayInfo: { text: "Text", time: 1 },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateStream(
          createPresentation({
            type: "bible",
            name: "Bible Stream",
            slide: { id: "new", type: "Media", name: "New", boxes: [] },
            displayType: "stream",
          }),
        ),
      );

      const state = store.getState().presentation;
      expect(state.streamInfo.slide).toEqual(initialSlide);
      expect(state.streamInfo.name).toBe("Bible Stream");
      expect(state.streamInfo.participantOverlayInfo?.name).toBe("");
      expect(state.streamInfo.stbOverlayInfo?.heading).toBe("");
      expect(state.streamInfo.qrCodeOverlayInfo?.description).toBe("");
      expect(state.streamInfo.imageOverlayInfo?.imageUrl).toBe("");
      expect(state.streamInfo.formattedTextDisplayInfo?.text).toBe("");
    });

    it("overlay and bible actions clear conflicting stream payloads when content exists", () => {
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            slide: { id: "live", type: "Media", name: "Live", boxes: [] },
            qrCodeOverlayInfo: { description: "QR", id: "q1", time: 1 },
            imageOverlayInfo: { name: "Image", imageUrl: "img", id: "i1", time: 1 },
            participantOverlayInfo: { name: "Person", title: "Lead", id: "p1", time: 1 },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfo({
          id: "new-participant",
          name: "Speaker",
          title: "Pastor",
        } as never),
      );
      expect(store.getState().presentation.streamInfo.slide).toBeNull();
      expect(
        store.getState().presentation.streamInfo.qrCodeOverlayInfo?.description,
      ).toBe("");

      store.dispatch(
        presentationSlice.actions.updateQrCodeOverlayInfo({
          id: "new-qr",
          url: "https://example.com",
          description: "Scan me",
        } as never),
      );
      expect(store.getState().presentation.streamInfo.slide).toBeNull();
      expect(
        store.getState().presentation.streamInfo.participantOverlayInfo?.name,
      ).toBe("");

      store.dispatch(
        presentationSlice.actions.updateBibleDisplayInfo({
          title: "John 3",
          text: "For God so loved",
        }),
      );
      expect(store.getState().presentation.streamInfo.slide).toBeNull();
      expect(
        store.getState().presentation.streamInfo.imageOverlayInfo?.imageUrl,
      ).toBe("");
    });

    it("remote overlay and formatted text actions keep payload times", () => {
      const store = createStore();

      store.dispatch(
        presentationSlice.actions.updateImageOverlayInfoFromRemote({
          id: "img-remote",
          imageUrl: "https://img.example.com/a.jpg",
          time: 555,
        } as never),
      );
      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfoFromRemote({
          id: "participant-remote",
          name: "Remote Name",
          time: 666,
        } as never),
      );
      store.dispatch(
        presentationSlice.actions.updateFormattedTextDisplayInfoFromRemote({
          text: "Remote text",
          time: 777,
          align: "center",
        }),
      );

      const state = store.getState().presentation;
      expect(state.streamInfo.imageOverlayInfo?.time).toBe(555);
      expect(state.streamInfo.participantOverlayInfo?.time).toBe(666);
      expect(state.streamInfo.formattedTextDisplayInfo?.time).toBe(777);
      expect(state.streamInfo.formattedTextDisplayInfo?.text).toBe("Remote text");
    });

    it("clearAll preserves previous info and resets active displays", () => {
      const currentSlide = {
        id: "current",
        type: "Media" as const,
        name: "Current",
        boxes: [],
      };
      const nextSlide = { id: "next", type: "Media" as const, name: "", boxes: [] };

      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          projectorInfo: {
            ...presentationSlice.getInitialState().projectorInfo,
            name: "Projector Active",
            type: "song",
            slide: currentSlide,
          },
          monitorInfo: {
            ...presentationSlice.getInitialState().monitorInfo,
            name: "Monitor Active",
            type: "song",
            slide: currentSlide,
            nextSlide,
          },
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            name: "Stream Active",
            type: "song",
            slide: currentSlide,
            participantOverlayInfo: { id: "p", name: "Name", time: 1 },
          },
        },
      });

      store.dispatch(presentationSlice.actions.clearAll());
      const state = store.getState().presentation;

      expect(state.prevProjectorInfo.name).toBe("Projector Active");
      expect(state.prevMonitorInfo.name).toBe("Monitor Active");
      expect(state.prevMonitorInfo.nextSlide).toBeNull();
      expect(state.prevStreamInfo.name).toBe("Stream Active");
      expect(state.projectorInfo.slide).toBeNull();
      expect(state.monitorInfo.slide).toBeNull();
      expect(state.streamInfo.slide).toBeNull();
      expect(state.streamInfo.participantOverlayInfo?.name).toBe("");
    });

    it("updatePresentation updates monitor state and keeps stream slide for free payloads", () => {
      const oldMonitorSlide = {
        id: "monitor-old",
        type: "Media" as const,
        name: "Monitor Old",
        boxes: [],
      };
      const oldStreamSlide = {
        id: "stream-old",
        type: "Media" as const,
        name: "Stream Old",
        boxes: [],
      };
      const newSlide = {
        id: "new-slide",
        type: "Media" as const,
        name: "New",
        boxes: [],
      };
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          isMonitorTransmitting: true,
          isStreamTransmitting: true,
          monitorInfo: {
            ...presentationSlice.getInitialState().monitorInfo,
            slide: oldMonitorSlide,
            nextSlide: { id: "next-old", type: "Media", name: "", boxes: [] },
            itemId: "old-item",
          },
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            slide: oldStreamSlide,
            name: "Old stream name",
            type: "song",
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updatePresentation(
          createPresentation({
            type: "free",
            name: "Free Payload",
            slide: newSlide,
            nextSlide: undefined,
            timerId: "timer-1",
            itemId: "item-2",
            displayType: "monitor",
          }),
        ),
      );

      const state = store.getState().presentation;
      expect(state.monitorInfo.slide).toEqual(newSlide);
      expect(state.monitorInfo.nextSlide).toBeNull();
      expect(state.monitorInfo.itemId).toBe("item-2");
      expect(state.prevMonitorInfo.slide).toEqual(oldMonitorSlide);

      expect(state.streamInfo.name).toBe("Free Payload");
      expect(state.streamInfo.type).toBe("free");
      expect(state.streamInfo.slide).toEqual(oldStreamSlide);
      expect(state.prevStreamInfo.slide).toEqual(oldStreamSlide);
    });

    it("updateStreamFromRemote sets slide for media and clears it for bible/free", () => {
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            slide: { id: "old", type: "Media", name: "old", boxes: [] },
            name: "Old stream",
            type: "song",
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateStreamFromRemote(
          createPresentation({
            type: "song",
            name: "Song Remote",
            slide: { id: "song-slide", type: "Media", name: "song", boxes: [] },
            time: 100,
            timerId: "t1",
            displayType: "stream",
          }),
        ),
      );
      expect(store.getState().presentation.streamInfo.slide).toEqual({
        id: "song-slide",
        type: "Media",
        name: "song",
        boxes: [],
      });

      store.dispatch(
        presentationSlice.actions.updateStreamFromRemote(
          createPresentation({
            type: "bible",
            name: "Bible Remote",
            slide: { id: "bible-slide", type: "Media", name: "bible", boxes: [] },
            time: 200,
            displayType: "stream",
          }),
        ),
      );
      expect(store.getState().presentation.streamInfo.slide).toBeNull();

      store.dispatch(
        presentationSlice.actions.updateStreamFromRemote(
          createPresentation({
            type: "free",
            name: "Free Remote",
            slide: { id: "free-slide", type: "Media", name: "free", boxes: [] },
            time: 300,
            displayType: "stream",
          }),
        ),
      );
      expect(store.getState().presentation.streamInfo.slide).toBeNull();
      expect(store.getState().presentation.streamInfo.name).toBe("Free Remote");
    });

    it("clearMonitor and clearStream keep previous values and reset active payloads", () => {
      const currentSlide = {
        id: "current-slide",
        type: "Media" as const,
        name: "Current",
        boxes: [],
      };
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          monitorInfo: {
            ...presentationSlice.getInitialState().monitorInfo,
            slide: currentSlide,
            name: "Monitor live",
            type: "song",
            itemId: "item-monitor",
            nextSlide: { id: "next-slide", type: "Media", name: "", boxes: [] },
          },
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            slide: currentSlide,
            name: "Stream live",
            type: "song",
            participantOverlayInfo: { id: "p", name: "Name", time: 10 },
            qrCodeOverlayInfo: { id: "q", description: "QR", time: 10 },
          },
        },
      });

      store.dispatch(presentationSlice.actions.clearMonitor());
      let state = store.getState().presentation;
      expect(state.prevMonitorInfo.name).toBe("Monitor live");
      expect(state.prevMonitorInfo.itemId).toBe("item-monitor");
      expect(state.monitorInfo.slide).toBeNull();

      store.dispatch(presentationSlice.actions.clearStream());
      state = store.getState().presentation;
      expect(state.prevStreamInfo.name).toBe("Stream live");
      expect(state.prevStreamInfo.participantOverlayInfo?.name).toBe("Name");
      expect(state.streamInfo.slide).toBeNull();
      expect(state.streamInfo.participantOverlayInfo?.name).toBe("");
      expect(state.streamInfo.qrCodeOverlayInfo?.description).toBe("");
    });
  });
});
