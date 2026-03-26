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

    it("updateStream clears the stream slide for bible payload", () => {
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
            imageOverlayInfo: {
              name: "Image",
              imageUrl: "img",
              id: "i1",
              time: 1,
            },
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
      expect(state.streamInfo.slide).toBeNull();
      expect(state.streamInfo.name).toBe("Bible Stream");
    });

    it("updateStream slide behaves like other item-layer content when overlay-only is off", () => {
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          isStreamTransmitting: true,
          streamItemContentBlocked: false,
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            bibleDisplayInfo: {
              title: "Psalm 23",
              text: "The Lord is my shepherd",
              time: 1,
            },
            formattedTextDisplayInfo: { text: "Old formatted", time: 1 },
            participantOverlayInfo: { name: "Host", id: "p1", time: 1 },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateStream(
          createPresentation({
            type: "song",
            name: "New Song",
            slide: {
              id: "slide-1",
              type: "Media",
              name: "Verse 1",
              boxes: [{ width: 10, height: 10, words: "Lyrics" }],
            },
            displayType: "stream",
          }),
        ),
      );

      const state = store.getState().presentation.streamInfo;
      expect(state.slide?.id).toBe("slide-1");
      expect(state.bibleDisplayInfo?.title).toBe("");
      expect(state.formattedTextDisplayInfo?.text).toBe("");
      expect(state.participantOverlayInfo?.name).toBe("Host");
    });

    it("updateStream slide keeps overlays when overlay-only is on", () => {
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          isStreamTransmitting: true,
          streamItemContentBlocked: true,
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            bibleDisplayInfo: {
              title: "Psalm 23",
              text: "The Lord is my shepherd",
              time: 1,
            },
            participantOverlayInfo: { name: "Host", id: "p1", time: 1 },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateStream(
          createPresentation({
            type: "song",
            name: "New Song",
            slide: {
              id: "slide-2",
              type: "Media",
              name: "Verse 2",
              boxes: [{ width: 10, height: 10, words: "Lyrics" }],
            },
            displayType: "stream",
          }),
        ),
      );

      const state = store.getState().presentation.streamInfo;
      expect(state.slide?.id).toBe("slide-2");
      expect(state.bibleDisplayInfo?.title).toBe("");
      expect(state.participantOverlayInfo?.name).toBe("Host");
    });

    it("updateParticipantOverlayInfo does not clear stream item when overlay-only ON", () => {
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          isStreamTransmitting: true,
          streamItemContentBlocked: true,
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            slide: {
              id: "s1",
              type: "Media" as const,
              name: "Song",
              boxes: [],
            },
            bibleDisplayInfo: {
              title: "John 3:16",
              text: "For God so loved...",
              time: 1,
            },
          },
        },
      });
      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfo({
          id: "o1",
          type: "participant",
          name: "Speaker",
          title: "Host",
          event: "Service",
          time: Date.now(),
          formatting: {},
        } as never),
      );
      const { streamInfo } = store.getState().presentation;
      expect(streamInfo.slide).toEqual({
        id: "s1",
        type: "Media",
        name: "Song",
        boxes: [],
      });
      expect(streamInfo.bibleDisplayInfo?.title).toBe("John 3:16");
      expect(streamInfo.participantOverlayInfo?.name).toBe("Speaker");
    });

    it("updateParticipantOverlayInfo preserves stream item when overlay-only OFF", () => {
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          isStreamTransmitting: true,
          streamItemContentBlocked: false,
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            slide: {
              id: "s1",
              type: "Media" as const,
              name: "Song",
              boxes: [],
            },
            bibleDisplayInfo: {
              title: "John 3:16",
              text: "For God so loved...",
              time: 1,
            },
          },
        },
      });
      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfo({
          id: "o1",
          type: "participant",
          name: "Speaker",
          time: Date.now(),
          formatting: {},
        } as never),
      );
      const { streamInfo } = store.getState().presentation;
      expect(streamInfo.slide).toEqual({
        id: "s1",
        type: "Media",
        name: "Song",
        boxes: [],
      });
      expect(streamInfo.bibleDisplayInfo?.title).toBe("John 3:16");
      expect(streamInfo.participantOverlayInfo?.name).toBe("Speaker");
    });

    it("setStreamItemContentBlocked sets and clearStream resets streamItemContentBlocked", () => {
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          streamItemContentBlocked: false,
        },
      });
      expect(store.getState().presentation.streamItemContentBlocked).toBe(
        false,
      );
      store.dispatch(
        presentationSlice.actions.setStreamItemContentBlocked(true),
      );
      expect(store.getState().presentation.streamItemContentBlocked).toBe(true);
      store.dispatch(presentationSlice.actions.clearStream());
      expect(store.getState().presentation.streamItemContentBlocked).toBe(
        false,
      );
    });

    it("setStreamItemContentBlocked true preserves active overlays", () => {
      const base = presentationSlice.getInitialState();
      const store = createStore({
        presentation: {
          ...base,
          isStreamTransmitting: true,
          streamItemContentBlocked: false,
          streamInfo: {
            ...base.streamInfo,
            slide: {
              id: "s1",
              type: "Verse",
              name: "Song",
              boxes: [{ width: 100, height: 100, words: "Lyrics" }],
            },
            participantOverlayInfo: {
              name: "Speaker",
              time: 1,
              id: "p1",
            },
          },
        },
      });
      store.dispatch(
        presentationSlice.actions.setStreamItemContentBlocked(true),
      );
      expect(store.getState().presentation.streamItemContentBlocked).toBe(true);
      expect(
        store.getState().presentation.streamInfo.participantOverlayInfo?.name,
      ).toBe("Speaker");
    });

    it("setStreamItemContentBlocked true does not clear overlays without item data", () => {
      const base = presentationSlice.getInitialState();
      const store = createStore({
        presentation: {
          ...base,
          isStreamTransmitting: true,
          streamItemContentBlocked: false,
          streamInfo: {
            ...base.streamInfo,
            slide: null,
            participantOverlayInfo: {
              name: "Speaker",
              time: 1,
              id: "p1",
            },
          },
        },
      });
      store.dispatch(
        presentationSlice.actions.setStreamItemContentBlocked(true),
      );
      expect(
        store.getState().presentation.streamInfo.participantOverlayInfo?.name,
      ).toBe("Speaker");
    });

    it("setStreamItemContentBlocked true does not clear when no active overlay", () => {
      const base = presentationSlice.getInitialState();
      const store = createStore({
        presentation: {
          ...base,
          isStreamTransmitting: true,
          streamItemContentBlocked: false,
          streamInfo: {
            ...base.streamInfo,
            slide: {
              id: "s1",
              type: "Verse",
              name: "Song",
              boxes: [{ width: 100, height: 100, words: "Lyrics" }],
            },
            participantOverlayInfo: { name: "", time: 1, id: "p1" },
          },
        },
      });
      store.dispatch(
        presentationSlice.actions.setStreamItemContentBlocked(true),
      );
      expect(
        store.getState().presentation.streamInfo.slide?.boxes?.[0]?.words,
      ).toBe("Lyrics");
    });

    it("clearAll resets streamItemContentBlocked", () => {
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          streamItemContentBlocked: true,
        },
      });
      store.dispatch(presentationSlice.actions.clearAll());
      expect(store.getState().presentation.streamItemContentBlocked).toBe(
        false,
      );
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
      expect(
        store.getState().presentation.streamInfo.imageOverlayInfo?.time,
      ).toBe(555);

      store.dispatch(
        presentationSlice.actions.updateFormattedTextDisplayInfoFromRemote({
          text: "Remote text",
          time: 777,
          align: "center",
        }),
      );
      const afterFormatted = store.getState().presentation;
      expect(afterFormatted.streamInfo.formattedTextDisplayInfo?.time).toBe(
        777,
      );
      expect(afterFormatted.streamInfo.formattedTextDisplayInfo?.text).toBe(
        "Remote text",
      );

      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfoFromRemote({
          id: "participant-remote",
          name: "Remote Name",
          time: 666,
        } as never),
      );
      const afterParticipant = store.getState().presentation;
      expect(afterParticipant.streamInfo.participantOverlayInfo?.time).toBe(
        666,
      );
      expect(afterParticipant.streamInfo.imageOverlayInfo?.imageUrl).toBe("");
    });

    it("updateParticipantOverlayInfoFromRemote preserves stream item when overlay-only off", () => {
      const base = presentationSlice.getInitialState();
      const store = createStore({
        presentation: {
          ...base,
          streamItemContentBlocked: false,
          streamInfo: {
            ...base.streamInfo,
            bibleDisplayInfo: { title: "John 3", text: "For God", time: 1 },
            participantOverlayInfo: { name: "", time: 1, id: "p" },
          },
        },
      });
      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfoFromRemote({
          id: "p2",
          name: "Speaker",
          time: 999,
        } as never),
      );
      expect(
        store.getState().presentation.streamInfo.bibleDisplayInfo?.title,
      ).toBe("John 3");
    });

    it("updateParticipantOverlayInfoFromRemote does not clear item when overlay-only on", () => {
      const base = presentationSlice.getInitialState();
      const store = createStore({
        presentation: {
          ...base,
          streamItemContentBlocked: true,
          streamInfo: {
            ...base.streamInfo,
            bibleDisplayInfo: { title: "John 3", text: "For God", time: 1 },
            participantOverlayInfo: { name: "", time: 1, id: "p" },
          },
        },
      });
      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfoFromRemote({
          id: "p2",
          name: "Speaker",
          time: 999,
        } as never),
      );
      expect(
        store.getState().presentation.streamInfo.bibleDisplayInfo?.title,
      ).toBe("John 3");
    });

    it("clearStreamOverlaysOnly empties overlays and keeps slide bible formatted", () => {
      const base = presentationSlice.getInitialState();
      const store = createStore({
        presentation: {
          ...base,
          isStreamTransmitting: true,
          streamInfo: {
            ...base.streamInfo,
            slide: {
              id: "s1",
              type: "Media" as const,
              name: "N",
              boxes: [{ width: 10, height: 10, words: "w" }],
            },
            bibleDisplayInfo: { title: "Jn", text: "body", time: 1 },
            formattedTextDisplayInfo: { text: "ft", time: 1 },
            participantOverlayInfo: { name: "Ann", time: 1, id: "p" },
            stbOverlayInfo: {
              heading: "H",
              subHeading: "",
              time: 1,
              id: "s",
            },
          },
        },
      });
      store.dispatch(presentationSlice.actions.clearStreamOverlaysOnly());
      const s = store.getState().presentation.streamInfo;
      expect(s.participantOverlayInfo?.name).toBe("");
      expect(s.stbOverlayInfo?.heading).toBe("");
      expect(s.slide?.id).toBe("s1");
      expect(s.bibleDisplayInfo?.title).toBe("Jn");
      expect(s.formattedTextDisplayInfo?.text).toBe("ft");
    });

    it("clearStreamOverlaysOnly no-op when not stream transmitting", () => {
      const base = presentationSlice.getInitialState();
      const store = createStore({
        presentation: {
          ...base,
          isStreamTransmitting: false,
          streamInfo: {
            ...base.streamInfo,
            participantOverlayInfo: { name: "Ann", time: 1, id: "p" },
          },
        },
      });
      store.dispatch(presentationSlice.actions.clearStreamOverlaysOnly());
      expect(
        store.getState().presentation.streamInfo.participantOverlayInfo?.name,
      ).toBe("Ann");
    });

    it("clearStreamOverlaysOnly no-op when no active overlay", () => {
      const base = presentationSlice.getInitialState();
      const store = createStore({
        presentation: {
          ...base,
          isStreamTransmitting: true,
          streamInfo: {
            ...base.streamInfo,
            participantOverlayInfo: { name: "", time: 1, id: "p" },
            bibleDisplayInfo: { title: "Keep", text: "", time: 1 },
          },
        },
      });
      store.dispatch(presentationSlice.actions.clearStreamOverlaysOnly());
      expect(
        store.getState().presentation.streamInfo.bibleDisplayInfo?.title,
      ).toBe("Keep");
      expect(
        store.getState().presentation.streamInfo.participantOverlayInfo?.name,
      ).toBe("");
    });

    it("setStreamItemContentBlocked false preserves active overlay", () => {
      const base = presentationSlice.getInitialState();
      const store = createStore({
        presentation: {
          ...base,
          streamItemContentBlocked: true,
          streamInfo: {
            ...base.streamInfo,
            slide: {
              id: "s1",
              type: "Verse",
              name: "Song",
              boxes: [{ width: 100, height: 100, words: "Hi" }],
            },
            participantOverlayInfo: { name: "Ann", time: 1, id: "p1" },
          },
        },
      });
      store.dispatch(
        presentationSlice.actions.setStreamItemContentBlocked(false),
      );
      expect(store.getState().presentation.streamItemContentBlocked).toBe(
        false,
      );
      expect(
        store.getState().presentation.streamInfo.participantOverlayInfo?.name,
      ).toBe("Ann");
    });

    const streamSlideAndBible = (blocked: boolean) => ({
      ...presentationSlice.getInitialState(),
      isStreamTransmitting: true,
      streamItemContentBlocked: blocked,
      streamInfo: {
        ...presentationSlice.getInitialState().streamInfo,
        slide: {
          id: "s1",
          type: "Media" as const,
          name: "Song",
          boxes: [{ width: 100, height: 100, words: "Lyrics" }],
        },
        bibleDisplayInfo: {
          title: "Psalm 23",
          text: "The Lord is my shepherd",
          time: 1,
        },
      },
    });

    it("updateStbOverlayInfo preserves item whether overlay-only is on or off", () => {
      const stbPayload = {
        id: "stb1",
        type: "stick-to-bottom" as const,
        heading: "Announcements",
        subHeading: "",
        duration: 0,
        formatting: {},
      };
      const blockedOn = createStore({
        presentation: streamSlideAndBible(true),
      });
      blockedOn.dispatch(
        presentationSlice.actions.updateStbOverlayInfo(stbPayload as never),
      );
      let s = blockedOn.getState().presentation.streamInfo;
      expect(s.slide?.boxes?.[0]?.words).toBe("Lyrics");
      expect(s.bibleDisplayInfo?.title).toBe("Psalm 23");
      expect(s.stbOverlayInfo?.heading).toBe("Announcements");

      const blockedOff = createStore({
        presentation: streamSlideAndBible(false),
      });
      blockedOff.dispatch(
        presentationSlice.actions.updateStbOverlayInfo(stbPayload as never),
      );
      s = blockedOff.getState().presentation.streamInfo;
      expect(s.slide?.boxes?.[0]?.words).toBe("Lyrics");
      expect(s.bibleDisplayInfo?.title).toBe("Psalm 23");
      expect(s.stbOverlayInfo?.heading).toBe("Announcements");
    });

    it("updateQrCodeOverlayInfo preserves item whether overlay-only is on or off", () => {
      const qrPayload = {
        id: "qr1",
        type: "qr-code" as const,
        url: "https://example.com",
        description: "Scan",
        duration: 0,
        formatting: {},
      };
      const blockedOn = createStore({
        presentation: streamSlideAndBible(true),
      });
      blockedOn.dispatch(
        presentationSlice.actions.updateQrCodeOverlayInfo(qrPayload as never),
      );
      let s = blockedOn.getState().presentation.streamInfo;
      expect(s.bibleDisplayInfo?.title).toBe("Psalm 23");
      expect(s.qrCodeOverlayInfo?.url).toBe("https://example.com");

      const blockedOff = createStore({
        presentation: streamSlideAndBible(false),
      });
      blockedOff.dispatch(
        presentationSlice.actions.updateQrCodeOverlayInfo(qrPayload as never),
      );
      s = blockedOff.getState().presentation.streamInfo;
      expect(s.slide?.boxes?.[0]?.words).toBe("Lyrics");
      expect(s.bibleDisplayInfo?.title).toBe("Psalm 23");
    });

    it("updateImageOverlayInfo preserves item whether overlay-only is on or off", () => {
      const imgPayload = {
        id: "img1",
        type: "image" as const,
        imageUrl: "https://cdn.example.com/a.png",
        duration: 0,
        formatting: {},
      };
      const blockedOn = createStore({
        presentation: streamSlideAndBible(true),
      });
      blockedOn.dispatch(
        presentationSlice.actions.updateImageOverlayInfo(imgPayload as never),
      );
      let s = blockedOn.getState().presentation.streamInfo;
      expect(s.bibleDisplayInfo?.title).toBe("Psalm 23");
      expect(s.imageOverlayInfo?.imageUrl).toBe(
        "https://cdn.example.com/a.png",
      );

      const blockedOff = createStore({
        presentation: streamSlideAndBible(false),
      });
      blockedOff.dispatch(
        presentationSlice.actions.updateImageOverlayInfo(imgPayload as never),
      );
      s = blockedOff.getState().presentation.streamInfo;
      expect(s.bibleDisplayInfo?.title).toBe("Psalm 23");
    });

    it("updateStbOverlayInfoFromRemote preserves item whether overlay-only is off or on", () => {
      const payload = {
        id: "r",
        heading: "Remote STB",
        subHeading: "",
        time: 400,
      } as never;
      const off = createStore({
        presentation: {
          ...streamSlideAndBible(false),
          streamInfo: {
            ...streamSlideAndBible(false).streamInfo,
            stbOverlayInfo: { heading: "", time: 1, id: "s" },
          },
        },
      });
      off.dispatch(
        presentationSlice.actions.updateStbOverlayInfoFromRemote(payload),
      );
      expect(
        off.getState().presentation.streamInfo.bibleDisplayInfo?.title,
      ).toBe("Psalm 23");

      const on = createStore({
        presentation: {
          ...streamSlideAndBible(true),
          streamInfo: {
            ...streamSlideAndBible(true).streamInfo,
            stbOverlayInfo: { heading: "", time: 1, id: "s" },
          },
        },
      });
      on.dispatch(
        presentationSlice.actions.updateStbOverlayInfoFromRemote(payload),
      );
      expect(
        on.getState().presentation.streamInfo.bibleDisplayInfo?.title,
      ).toBe("Psalm 23");
    });

    it("updateQrCodeOverlayInfoFromRemote preserves item when overlay-only is off", () => {
      const store = createStore({
        presentation: streamSlideAndBible(false),
      });
      store.dispatch(
        presentationSlice.actions.updateQrCodeOverlayInfoFromRemote({
          id: "q",
          url: "https://x.com",
          description: "d",
          time: 500,
        } as never),
      );
      expect(store.getState().presentation.streamInfo.slide?.boxes?.[0]?.words).toBe(
        "Lyrics",
      );
      expect(
        store.getState().presentation.streamInfo.bibleDisplayInfo?.title,
      ).toBe("Psalm 23");
    });

    it("updateImageOverlayInfoFromRemote preserves item when overlay-only is off", () => {
      const store = createStore({
        presentation: streamSlideAndBible(false),
      });
      store.dispatch(
        presentationSlice.actions.updateImageOverlayInfoFromRemote({
          id: "i",
          imageUrl: "https://img.com/x.jpg",
          time: 600,
        } as never),
      );
      expect(
        store.getState().presentation.streamInfo.bibleDisplayInfo?.title,
      ).toBe("Psalm 23");
    });

    it("setStreamItemContentBlockedFromRemote matches local toggle behavior", () => {
      const base = presentationSlice.getInitialState();
      const withOverlay = createStore({
        presentation: {
          ...base,
          streamItemContentBlocked: false,
          streamInfo: {
            ...base.streamInfo,
            slide: {
              id: "s1",
              type: "Verse",
              name: "Song",
              boxes: [{ width: 10, height: 10, words: "w" }],
            },
            participantOverlayInfo: { name: "Live", time: 1, id: "p" },
          },
        },
      });
      withOverlay.dispatch(
        presentationSlice.actions.setStreamItemContentBlockedFromRemote(true),
      );
      expect(withOverlay.getState().presentation.streamItemContentBlocked).toBe(
        true,
      );
      expect(
        withOverlay.getState().presentation.streamInfo.participantOverlayInfo
          ?.name,
      ).toBe("Live");

      const overlayOnlyOff = createStore({
        presentation: {
          ...base,
          streamItemContentBlocked: true,
          streamInfo: {
            ...base.streamInfo,
            slide: {
              id: "s2",
              type: "Media" as const,
              name: "N",
              boxes: [{ width: 10, height: 10, words: "x" }],
            },
            participantOverlayInfo: { name: "Y", time: 1, id: "p" },
          },
        },
      });
      overlayOnlyOff.dispatch(
        presentationSlice.actions.setStreamItemContentBlockedFromRemote(false),
      );
      expect(
        overlayOnlyOff.getState().presentation.streamItemContentBlocked,
      ).toBe(false);
      expect(
        overlayOnlyOff.getState().presentation.streamInfo.participantOverlayInfo
          ?.name,
      ).toBe("Y");
    });

    it("setStreamItemContentBlockedFromRemote false is a no-op when already false", () => {
      const base = presentationSlice.getInitialState();
      const store = createStore({
        presentation: {
          ...base,
          streamItemContentBlocked: false,
          streamInfo: {
            ...base.streamInfo,
            participantOverlayInfo: { name: "Live", time: 1, id: "p" },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.setStreamItemContentBlockedFromRemote(false),
      );

      expect(store.getState().presentation.streamItemContentBlocked).toBe(false);
      expect(
        store.getState().presentation.streamInfo.participantOverlayInfo?.name,
      ).toBe("Live");
    });

    it("setStreamItemContentBlocked true is a no-op when already true", () => {
      const base = presentationSlice.getInitialState();
      const store = createStore({
        presentation: {
          ...base,
          streamItemContentBlocked: true,
          streamInfo: {
            ...base.streamInfo,
            slide: {
              id: "s1",
              type: "Verse",
              name: "Song",
              boxes: [{ width: 10, height: 10, words: "Lyrics" }],
            },
            participantOverlayInfo: { name: "Live", time: 1, id: "p" },
          },
        },
      });

      store.dispatch(presentationSlice.actions.setStreamItemContentBlocked(true));

      expect(store.getState().presentation.streamItemContentBlocked).toBe(true);
      expect(
        store.getState().presentation.streamInfo.participantOverlayInfo?.name,
      ).toBe("Live");
    });

    it("updateBibleDisplayInfo preserves overlays whether overlay-only is on or off", () => {
      const participant = { name: "Host", time: 1, id: "p" };
      const bible = { title: "Jn 3", text: "For God", time: 2 };

      const blockedOn = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          isStreamTransmitting: true,
          streamItemContentBlocked: true,
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            participantOverlayInfo: participant,
            stbOverlayInfo: {
              heading: "H",
              subHeading: "",
              time: 1,
              id: "s",
            },
          },
        },
      });
      blockedOn.dispatch(
        presentationSlice.actions.updateBibleDisplayInfo(bible),
      );
      let s = blockedOn.getState().presentation.streamInfo;
      expect(s.bibleDisplayInfo?.title).toBe("Jn 3");
      expect(s.participantOverlayInfo?.name).toBe("Host");
      expect(s.stbOverlayInfo?.heading).toBe("H");

      const blockedOff = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          isStreamTransmitting: true,
          streamItemContentBlocked: false,
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            participantOverlayInfo: participant,
            stbOverlayInfo: {
              heading: "H",
              subHeading: "",
              time: 1,
              id: "s",
            },
          },
        },
      });
      blockedOff.dispatch(
        presentationSlice.actions.updateBibleDisplayInfo(bible),
      );
      s = blockedOff.getState().presentation.streamInfo;
      expect(s.bibleDisplayInfo?.title).toBe("Jn 3");
      expect(s.participantOverlayInfo?.name).toBe("Host");
      expect(s.stbOverlayInfo?.heading).toBe("H");
      expect(s.type).toBe("bible");
    });

    it("updateFormattedTextDisplayInfo preserves overlays whether overlay-only is on or off", () => {
      const participant = { name: "Host", time: 1, id: "p" };
      const formatted = { text: "Hello", time: 2 };

      const blockedOn = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          isStreamTransmitting: true,
          streamItemContentBlocked: true,
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            participantOverlayInfo: participant,
          },
        },
      });
      blockedOn.dispatch(
        presentationSlice.actions.updateFormattedTextDisplayInfo(formatted),
      );
      expect(
        blockedOn.getState().presentation.streamInfo.participantOverlayInfo
          ?.name,
      ).toBe("Host");

      const blockedOff = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          isStreamTransmitting: true,
          streamItemContentBlocked: false,
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            participantOverlayInfo: participant,
          },
        },
      });
      blockedOff.dispatch(
        presentationSlice.actions.updateFormattedTextDisplayInfo(formatted),
      );
      expect(
        blockedOff.getState().presentation.streamInfo.participantOverlayInfo
          ?.name,
      ).toBe("Host");
      expect(blockedOff.getState().presentation.streamInfo.type).toBe("free");
    });

    it("updateFormattedTextDisplayInfo clears the stream slide and refreshes streamInfo time", () => {
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            time: 10,
            slide: {
              id: "slide-1",
              type: "Media" as const,
              name: "Current",
              boxes: [],
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateFormattedTextDisplayInfo({
          text: "Formatted text",
        }),
      );

      const state = store.getState().presentation.streamInfo;
      expect(state.slide).toBeNull();
      expect(state.formattedTextDisplayInfo?.text).toBe("Formatted text");
      expect(state.time).toBeGreaterThan(10);
    });

    it("clearAll preserves previous info and resets active displays", () => {
      const currentSlide = {
        id: "current",
        type: "Media" as const,
        name: "Current",
        boxes: [],
      };
      const nextSlide = {
        id: "next",
        type: "Media" as const,
        name: "",
        boxes: [],
      };

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
      expect(store.getState().presentation.streamInfo.bibleDisplayInfo?.title).toBe(
        "",
      );
      expect(
        store.getState().presentation.streamInfo.formattedTextDisplayInfo?.text,
      ).toBe("");

      store.dispatch(
        presentationSlice.actions.updateStreamFromRemote(
          createPresentation({
            type: "bible",
            name: "Bible Remote",
            slide: {
              id: "bible-slide",
              type: "Media",
              name: "bible",
              boxes: [],
            },
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

    it("updateStreamFromRemote preserves bible text for bible snapshots", () => {
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            bibleDisplayInfo: { title: "Jn 3", text: "For God", time: 100 },
            type: "bible",
            time: 100,
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateStreamFromRemote(
          createPresentation({
            type: "bible",
            name: "Bible Remote",
            slide: null,
            time: 100,
            displayType: "stream",
          }),
        ),
      );

      expect(store.getState().presentation.streamInfo.bibleDisplayInfo?.title).toBe(
        "Jn 3",
      );
      expect(store.getState().presentation.streamInfo.type).toBe("bible");
    });

    it("updateStreamFromRemote keeps overlays for stream slides when overlay-only is on", () => {
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          streamItemContentBlocked: true,
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            participantOverlayInfo: { id: "p", name: "Host", time: 1 },
            bibleDisplayInfo: { title: "Jn 3", text: "For God", time: 1 },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateStreamFromRemote(
          createPresentation({
            type: "song",
            name: "Song Remote",
            slide: { id: "song-2", type: "Media", name: "song", boxes: [] },
            time: 100,
            displayType: "stream",
          }),
        ),
      );

      const state = store.getState().presentation.streamInfo;
      expect(state.slide?.id).toBe("song-2");
      expect(state.bibleDisplayInfo?.title).toBe("");
      expect(state.participantOverlayInfo?.name).toBe("Host");
    });

    it("updateParticipantOverlayInfo preserves the outgoing overlay in prevStreamInfo for exit animation", () => {
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            qrCodeOverlayInfo: {
              id: "q1",
              description: "Scan me",
              url: "https://example.com",
              time: 1,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfo({
          id: "p1",
          name: "Alex",
        }),
      );

      const state = store.getState().presentation;
      expect(state.prevStreamInfo.qrCodeOverlayInfo?.description).toBe(
        "Scan me",
      );
      expect(state.streamInfo.qrCodeOverlayInfo?.description).toBe("");
      expect(state.streamInfo.participantOverlayInfo?.name).toBe("Alex");
    });

    it("updateImageOverlayInfoFromRemote preserves the outgoing overlay in prevStreamInfo for exit animation", () => {
      const store = createStore({
        presentation: {
          ...presentationSlice.getInitialState(),
          streamInfo: {
            ...presentationSlice.getInitialState().streamInfo,
            participantOverlayInfo: {
              id: "p1",
              name: "Host",
              time: 1,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateImageOverlayInfoFromRemote({
          id: "img-1",
          imageUrl: "https://img.example/hero.jpg",
          time: 10,
        }),
      );

      const state = store.getState().presentation;
      expect(state.prevStreamInfo.participantOverlayInfo?.name).toBe("Host");
      expect(state.streamInfo.participantOverlayInfo?.name).toBe("");
      expect(state.streamInfo.imageOverlayInfo?.imageUrl).toBe(
        "https://img.example/hero.jpg",
      );
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
