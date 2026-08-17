import { configureStore } from "@reduxjs/toolkit";
import {
  fromLegacyPresentationShape,
  LegacyPresentationShape,
  presentationSlice,
  toLegacyPresentationShape,
} from "./presentationSlice";
import { createPresentation } from "../test/fixtures";
import { setServerTimeOffset } from "../utils/serverTime";
import type { ItemSlideType } from "../types";

/**
 * These tests were written against the flat projector/monitor/stream shape.
 * Rather than restate 293 expectations, they author and read state through the
 * same legacy bridge production uses for Firebase and localStorage, so each
 * assertion still checks the behavior it originally checked.
 */
const legacy = toLegacyPresentationShape;
const legacyInitialState = () =>
  toLegacyPresentationShape(presentationSlice.getInitialState());

const createLocalImageSlide = (): ItemSlideType => ({
  id: "slide-local-image",
  name: "Local image",
  type: "Media",
  boxes: [
    {
      id: "box-local-image",
      width: 100,
      height: 100,
      mediaInfo: {
        id: "asset-1",
        publicId: "asset-1",
        path: "",
        name: "Welcome.png",
        type: "image",
        format: "png",
        width: 1920,
        height: 1080,
        background: "local-image://asset-1",
        thumbnail: "local-image://asset-1",
        createdAt: "2026-08-12T00:00:00.000Z",
        updatedAt: "2026-08-12T00:00:00.000Z",
        source: "local",
        localImage: {
          id: "asset-1",
          contentRevision: "revision-1",
          ownerDeviceId: "device-1",
          ownerLabel: "Booth",
          fileName: "Welcome.png",
          contentType: "image/png",
          storagePolicy: "local-only",
        },
      },
    },
  ],
});

const createStore = (preloadedState?: {
  presentation?: Partial<ReturnType<typeof toLegacyPresentationShape>>;
}) =>
  configureStore({
    reducer: { presentation: presentationSlice.reducer },
    ...(preloadedState?.presentation != null && {
      preloadedState: {
        presentation: fromLegacyPresentationShape(preloadedState.presentation),
      },
    }),
  });

describe("presentationSlice", () => {
  beforeEach(() => {
    setServerTimeOffset(0);
  });

  afterEach(() => {
    setServerTimeOffset(0);
    jest.useRealTimers();
  });

  describe("reducer only", () => {
    it("routes a local video input only while its projector output is live", () => {
      const store = createStore();
      const input = {
        sourceId: "source-1",
        deviceLabel: "USB Capture",
        ownerDeviceId: "workstation-1",
        ownerLabel: "Booth",
      };

      store.dispatch(
        presentationSlice.actions.showLocalVideoInput({
          outputId: "projector",
          input,
        }),
      );
      expect(
        legacy(store.getState().presentation).projectorInfo.localVideoInput,
      ).toBeUndefined();

      store.dispatch(presentationSlice.actions.toggleProjectorTransmitting());
      store.dispatch(
        presentationSlice.actions.showLocalVideoInput({
          outputId: "projector",
          input,
        }),
      );
      expect(
        legacy(store.getState().presentation).projectorInfo.localVideoInput,
      ).toEqual(input);
      expect(legacy(store.getState().presentation).projectorInfo.type).toBe(
        "local-video-input",
      );
    });

    it("returns from local video input to ordinary slides on the next send", () => {
      const store = createStore();
      store.dispatch(presentationSlice.actions.toggleProjectorTransmitting());
      store.dispatch(
        presentationSlice.actions.showLocalVideoInput({
          outputId: "projector",
          input: {
            sourceId: "source-1",
            deviceLabel: "USB Capture",
            ownerDeviceId: "workstation-1",
            ownerLabel: "Booth",
          },
        }),
      );
      store.dispatch(
        presentationSlice.actions.updateProjector(
          createPresentation({
            type: "song",
            name: "Next song",
            slide: { id: "next", type: "Verse", name: "Next", boxes: [] },
            displayType: "projector",
          }),
        ),
      );

      const projector = legacy(store.getState().presentation).projectorInfo;
      expect(projector.localVideoInput).toBeUndefined();
      expect(projector.name).toBe("Next song");
    });

    it.each([
      [
        "monitor",
        presentationSlice.actions.toggleMonitorTransmitting,
        presentationSlice.actions.updateMonitor,
      ],
      [
        "stream",
        presentationSlice.actions.toggleStreamTransmitting,
        presentationSlice.actions.updateStream,
      ],
    ] as const)(
      "routes a video-input media slide to a live %s output",
      (surface, toggleLive, updateSurface) => {
        const store = createStore();
        const input = {
          sourceId: "source-1",
          deviceLabel: "USB Capture",
          ownerDeviceId: "workstation-1",
          ownerLabel: "Booth",
          fit: "cover" as const,
          audioEnabled: true,
        };
        const slide = {
          id: "video-slide",
          type: "Media" as const,
          name: "Main camera",
          boxes: [],
        };

        store.dispatch(toggleLive());
        store.dispatch(
          updateSurface({
            outputIds: [surface],
            slide,
            type: "local-video-input",
            name: "Camera deck",
            localVideoInput: input,
          }),
        );

        const slot = store.getState().presentation.outputs[surface];
        expect(slot.info.slide).toEqual(slide);
        expect(slot.info.localVideoInput).toEqual(input);
      },
    );

    it("hands local video into previous state when monitor and stream are cleared", () => {
      const store = createStore();
      const input = {
        sourceId: "source-clear",
        deviceLabel: "USB Capture",
        ownerDeviceId: "workstation-1",
        ownerLabel: "Booth",
      };
      store.dispatch(presentationSlice.actions.toggleMonitorTransmitting());
      store.dispatch(presentationSlice.actions.toggleStreamTransmitting());
      store.dispatch(
        presentationSlice.actions.updateMonitor({
          outputIds: ["monitor"],
          slide: null,
          type: "local-video-input",
          name: "Camera",
          localVideoInput: input,
        }),
      );
      store.dispatch(
        presentationSlice.actions.updateStream({
          outputIds: ["stream"],
          slide: null,
          type: "local-video-input",
          name: "Camera",
          localVideoInput: input,
        }),
      );

      store.dispatch(presentationSlice.actions.clearMonitor());
      store.dispatch(presentationSlice.actions.clearStream({}));

      expect(
        store.getState().presentation.outputs.monitor.prevInfo.localVideoInput,
      ).toEqual(input);
      expect(
        store.getState().presentation.outputs.stream.prevInfo.localVideoInput,
      ).toEqual(input);
      expect(
        store.getState().presentation.outputs.monitor.info.localVideoInput,
      ).toBeUndefined();
      expect(
        store.getState().presentation.outputs.stream.info.localVideoInput,
      ).toBeUndefined();
    });

    it("preserves local-video exits for named stream clear and Clear All", () => {
      const store = createStore();
      const input = {
        sourceId: "source-clear-all",
        deviceLabel: "USB Capture",
        ownerDeviceId: "workstation-1",
        ownerLabel: "Booth",
      };
      store.dispatch(presentationSlice.actions.toggleMonitorTransmitting());
      store.dispatch(presentationSlice.actions.toggleStreamTransmitting());
      const sendCamera = () => {
        store.dispatch(
          presentationSlice.actions.updateMonitor({
            outputIds: ["monitor"],
            slide: null,
            type: "local-video-input",
            name: "Camera",
            localVideoInput: input,
          }),
        );
        store.dispatch(
          presentationSlice.actions.updateStream({
            outputIds: ["stream"],
            slide: null,
            type: "local-video-input",
            name: "Camera",
            localVideoInput: input,
          }),
        );
      };
      sendCamera();
      store.dispatch(presentationSlice.actions.clearOutput("stream"));
      expect(
        store.getState().presentation.outputs.stream.prevInfo.localVideoInput,
      ).toEqual(input);

      sendCamera();
      store.dispatch(presentationSlice.actions.clearAll());
      expect(
        store.getState().presentation.outputs.monitor.prevInfo.localVideoInput,
      ).toEqual(input);
      expect(
        store.getState().presentation.outputs.stream.prevInfo.localVideoInput,
      ).toEqual(input);
    });

    it("ordinary sends leave board takeover and clear the current camera", () => {
      const store = createStore();
      const input = {
        sourceId: "source-board",
        deviceLabel: "USB Capture",
        ownerDeviceId: "workstation-1",
        ownerLabel: "Booth",
      };
      store.dispatch(presentationSlice.actions.toggleProjectorTransmitting());
      store.dispatch(
        presentationSlice.actions.updateProjector({
          outputIds: ["projector"],
          slide: null,
          type: "local-video-input",
          name: "Camera",
          localVideoInput: input,
        }),
      );
      store.dispatch(
        presentationSlice.actions.setDisplayBoardAliasId({
          aliasId: "youth",
          outputIds: ["projector"],
        }),
      );

      store.dispatch(
        presentationSlice.actions.updatePresentation({
          outputIds: ["projector"],
          type: "song",
          name: "Next song",
          slide: { id: "next", type: "Verse", name: "Next", boxes: [] },
        }),
      );

      const projector = store.getState().presentation.outputs.projector;
      expect(projector.boardAliasId).toBe("");
      expect(projector.prevInfo.localVideoInput).toEqual(input);
      expect(projector.info.localVideoInput).toBeUndefined();
    });

    it("patches a cloud copy into live and outgoing presentation snapshots", () => {
      jest.useFakeTimers();
      jest.setSystemTime(2_000);
      const base = legacyInitialState();
      const slide = createLocalImageSlide();
      const store = createStore({
        presentation: {
          ...base,
          projectorInfo: { ...base.projectorInfo, slide, time: 100 },
          prevProjectorInfo: { ...base.prevProjectorInfo, slide, time: 90 },
          monitorInfo: {
            ...base.monitorInfo,
            slide,
            nextSlide: createLocalImageSlide(),
            time: 100,
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.attachCloudCopyToLocalImageInPresentation({
          itemId: "item-1",
          assetId: "asset-1",
          mediaId: "media-1",
          url: "https://res.cloudinary.com/example/welcome.png",
        }),
      );

      const state = legacy(store.getState().presentation);
      expect(state.projectorInfo.slide?.boxes[0].mediaInfo?.localImage).toEqual(
        expect.objectContaining({
          storagePolicy: "local-and-cloud",
          cloudMediaId: "media-1",
          cloudUrl: "https://res.cloudinary.com/example/welcome.png",
        }),
      );
      expect(
        state.prevProjectorInfo.slide?.boxes[0].mediaInfo?.localImage?.cloudUrl,
      ).toBe("https://res.cloudinary.com/example/welcome.png");
      expect(
        state.monitorInfo.nextSlide?.boxes[0].mediaInfo?.localImage?.cloudUrl,
      ).toBe("https://res.cloudinary.com/example/welcome.png");
      expect(state.projectorInfo.time).toBe(2_000);
    });

    it("patches a relink into the live snapshot and preserves the outgoing frame", () => {
      const base = legacyInitialState();
      const slide = createLocalImageSlide();
      const localImage = slide.boxes[0].mediaInfo!.localImage!;
      localImage.storagePolicy = "local-and-cloud";
      localImage.cloudUrl = "https://res.cloudinary.com/example/old.png";
      localImage.cloudMediaId = "old-media";
      const store = createStore({
        presentation: {
          ...base,
          projectorInfo: { ...base.projectorInfo, slide, time: 100 },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateLocalImageReferenceInPresentation({
          itemId: "item-1",
          assetId: "asset-1",
          patch: {
            reference: {
              contentRevision: "revision-2",
              fileName: "Updated.png",
              cloudUrl: undefined,
              cloudMediaId: undefined,
            },
            media: { name: "Updated.png", width: 1280, height: 720 },
          },
        }),
      );

      const state = legacy(store.getState().presentation);
      const media = state.projectorInfo.slide?.boxes[0].mediaInfo;
      expect(media).toEqual(
        expect.objectContaining({
          name: "Updated.png",
          width: 1280,
          height: 720,
        }),
      );
      expect(media?.localImage).toEqual(
        expect.objectContaining({
          fileName: "Updated.png",
          contentRevision: "revision-2",
          cloudUrl: undefined,
          cloudMediaId: undefined,
        }),
      );
      expect(
        state.prevProjectorInfo.slide?.boxes[0].mediaInfo?.localImage,
      ).toEqual(
        expect.objectContaining({
          fileName: "Welcome.png",
          contentRevision: "revision-1",
          cloudUrl: "https://res.cloudinary.com/example/old.png",
          cloudMediaId: "old-media",
        }),
      );
      expect(state.projectorInfo.time).toBeGreaterThan(100);
    });

    it("toggleProjectorTransmitting flips isProjectorTransmitting", () => {
      const store = createStore();
      expect(
        legacy(store.getState().presentation).isProjectorTransmitting,
      ).toBe(false);
      store.dispatch(presentationSlice.actions.toggleProjectorTransmitting());
      expect(
        legacy(store.getState().presentation).isProjectorTransmitting,
      ).toBe(true);
      store.dispatch(presentationSlice.actions.toggleProjectorTransmitting());
      expect(
        legacy(store.getState().presentation).isProjectorTransmitting,
      ).toBe(false);
    });

    it("setTransmitToAll sets all transmitting flags", () => {
      const store = createStore();
      store.dispatch(presentationSlice.actions.setTransmitToAll(true));
      const state = legacy(store.getState().presentation);
      expect(state.isProjectorTransmitting).toBe(true);
      expect(state.isMonitorTransmitting).toBe(true);
      expect(state.isStreamTransmitting).toBe(true);
      store.dispatch(presentationSlice.actions.setTransmitToAll(false));
      const next = legacy(store.getState().presentation);
      expect(next.isProjectorTransmitting).toBe(false);
      expect(next.isMonitorTransmitting).toBe(false);
      expect(next.isStreamTransmitting).toBe(false);
    });

    it("updatePresentation updates projectorInfo when transmitting", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
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
      expect(legacy(store.getState().presentation).projectorInfo.name).toBe(
        "Test Song",
      );
      expect(legacy(store.getState().presentation).projectorInfo.type).toBe(
        "song",
      );
      expect(legacy(store.getState().presentation).projectorInfo.slide).toEqual(
        slide,
      );
    });

    it("toggles monitor and stream transmitting flags", () => {
      const store = createStore();
      expect(legacy(store.getState().presentation).isMonitorTransmitting).toBe(
        false,
      );
      expect(legacy(store.getState().presentation).isStreamTransmitting).toBe(
        false,
      );

      store.dispatch(presentationSlice.actions.toggleMonitorTransmitting());
      store.dispatch(presentationSlice.actions.toggleStreamTransmitting());

      expect(legacy(store.getState().presentation).isMonitorTransmitting).toBe(
        true,
      );
      expect(legacy(store.getState().presentation).isStreamTransmitting).toBe(
        true,
      );
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

      const state = legacy(store.getState().presentation);
      expect(state.projectorInfo.name).toBe("Projected");
      expect(state.projectorInfo.slide).toEqual(slide);
      expect(state.prevProjectorInfo.name).toBe("");
    });

    it("updateProjector and clearProjector persist then wipe slideIndex/slideCount", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isProjectorTransmitting: true,
        },
      });
      store.dispatch(
        presentationSlice.actions.updateProjector(
          createPresentation({
            type: "song",
            name: "Projected",
            slide: { id: "p1", type: "Media", name: "V1", boxes: [] },
            displayType: "projector",
            slideIndex: 2,
            slideCount: 8,
          }),
        ),
      );
      expect(
        legacy(store.getState().presentation).projectorInfo.slideIndex,
      ).toBe(2);
      expect(
        legacy(store.getState().presentation).projectorInfo.slideCount,
      ).toBe(8);

      store.dispatch(presentationSlice.actions.clearProjector());
      expect(
        legacy(store.getState().presentation).projectorInfo.slideIndex,
      ).toBeUndefined();
      expect(
        legacy(store.getState().presentation).projectorInfo.slideCount,
      ).toBeUndefined();
    });

    it("updateMonitor and updateStream persist slideIndex/slideCount", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isMonitorTransmitting: true,
          isStreamTransmitting: true,
        },
      });
      store.dispatch(
        presentationSlice.actions.updateMonitor(
          createPresentation({
            type: "song",
            name: "Monitor Song",
            slide: { id: "m1", type: "Media", name: "C", boxes: [] },
            displayType: "monitor",
            slideIndex: 0,
            slideCount: 4,
          }),
        ),
      );
      store.dispatch(
        presentationSlice.actions.updateStream(
          createPresentation({
            type: "song",
            name: "Stream Song",
            slide: { id: "s1", type: "Media", name: "C", boxes: [] },
            displayType: "stream",
            slideIndex: 1,
            slideCount: 4,
          }),
        ),
      );
      const state = legacy(store.getState().presentation);
      expect(state.monitorInfo.slideIndex).toBe(0);
      expect(state.monitorInfo.slideCount).toBe(4);
      expect(state.streamInfo.slideIndex).toBe(1);
      expect(state.streamInfo.slideCount).toBe(4);

      store.dispatch(presentationSlice.actions.clearMonitor());
      store.dispatch(presentationSlice.actions.clearStream());
      expect(
        legacy(store.getState().presentation).monitorInfo.slideIndex,
      ).toBeUndefined();
      expect(
        legacy(store.getState().presentation).streamInfo.slideIndex,
      ).toBeUndefined();
    });

    it("updateMonitor sets nextSlide fallback and stores transition metadata", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isMonitorTransmitting: true,
          monitorInfo: {
            ...legacyInitialState().monitorInfo,
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

      const state = legacy(store.getState().presentation);
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
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
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

      const state = legacy(store.getState().presentation);
      expect(state.streamInfo.slide).toBeNull();
      expect(state.streamInfo.name).toBe("Bible Stream");
    });

    it("updateStream slide behaves like other item-layer content when overlay-only is off", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamItemContentBlocked: false,
          streamInfo: {
            ...legacyInitialState().streamInfo,
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

      const state = legacy(store.getState().presentation).streamInfo;
      expect(state.slide?.id).toBe("slide-1");
      expect(state.bibleDisplayInfo?.title).toBe("");
      expect(state.formattedTextDisplayInfo?.text).toBe("");
      expect(state.participantOverlayInfo?.name).toBe("Host");
    });

    it("updateStream slide keeps overlays when overlay-only is on", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamItemContentBlocked: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
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

      const state = legacy(store.getState().presentation).streamInfo;
      expect(state.slide?.id).toBe("slide-2");
      expect(state.bibleDisplayInfo?.title).toBe("");
      expect(state.participantOverlayInfo?.name).toBe("Host");
    });

    it("updateParticipantOverlayInfo does not clear stream item when overlay-only ON", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamItemContentBlocked: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
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
      const { streamInfo } = legacy(store.getState().presentation);
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
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamItemContentBlocked: false,
          streamInfo: {
            ...legacyInitialState().streamInfo,
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
      const { streamInfo } = legacy(store.getState().presentation);
      expect(streamInfo.slide).toEqual({
        id: "s1",
        type: "Media",
        name: "Song",
        boxes: [],
      });
      expect(streamInfo.bibleDisplayInfo?.title).toBe("John 3:16");
      expect(streamInfo.participantOverlayInfo?.name).toBe("Speaker");
    });

    it("uses the shared Firebase-offset clock when minting local stream overlay timestamps", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-05-17T12:00:00.000Z"));
      setServerTimeOffset(30_000);

      const base = legacyInitialState();
      const store = createStore({
        presentation: {
          ...base,
          isStreamTransmitting: true,
          streamInfo: {
            ...base.streamInfo,
            participantOverlayInfo: { id: "p-prev", name: "", time: 1 },
            stbOverlayInfo: { id: "stb-prev", heading: "", time: 2 },
            qrCodeOverlayInfo: { id: "qr-prev", description: "", time: 3 },
            imageOverlayInfo: { id: "img-prev", imageUrl: "", time: 4 },
            boardPostStreamInfo: {
              author: "",
              authorHexColor: "#e7e5e4",
              text: "",
              time: 5,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfo({
          id: "p-next",
          type: "participant",
          name: "Speaker",
        } as never),
      );

      expect(
        legacy(store.getState().presentation).streamInfo.participantOverlayInfo
          ?.time,
      ).toBe(new Date("2026-05-17T12:00:30.000Z").getTime());
    });

    it("uses the shared Firebase-offset clock when minting board-post overlay timestamps", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-05-17T12:00:00.000Z"));
      setServerTimeOffset(30_000);

      const base = legacyInitialState();
      const store = createStore({
        presentation: {
          ...base,
          isStreamTransmitting: true,
          streamInfo: {
            ...base.streamInfo,
            participantOverlayInfo: {
              id: "p1",
              name: "Host",
              time: 1,
              transitionSequence: 3,
            },
            stbOverlayInfo: { id: "stb-prev", heading: "", time: 2 },
            qrCodeOverlayInfo: { id: "qr-prev", description: "", time: 3 },
            imageOverlayInfo: { id: "img-prev", imageUrl: "", time: 4 },
            boardPostStreamInfo: {
              author: "",
              authorHexColor: "#e7e5e4",
              text: "",
              time: 5,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateBoardPostStreamInfo({
          author: "Alex",
          authorHexColor: "#0ea5e9",
          text: "Praying",
        }),
      );

      const state = legacy(store.getState().presentation);
      expect(state.streamInfo.boardPostStreamInfo?.text).toBe("Praying");
      expect(state.streamInfo.boardPostStreamInfo?.time).toBe(
        new Date("2026-05-17T12:00:30.000Z").getTime(),
      );
      expect(state.streamInfo.boardPostStreamInfo?.transitionSequence).toBe(4);
      expect(state.streamInfo.participantOverlayInfo?.name).toBe("");
      expect(state.prevStreamInfo.participantOverlayInfo?.name).toBe("Host");
    });

    it("setStreamItemContentBlocked survives a clearStream", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          streamItemContentBlocked: false,
        },
      });
      expect(
        legacy(store.getState().presentation).streamItemContentBlocked,
      ).toBe(false);
      store.dispatch(
        presentationSlice.actions.setStreamItemContentBlocked(true),
      );
      expect(
        legacy(store.getState().presentation).streamItemContentBlocked,
      ).toBe(true);
      store.dispatch(presentationSlice.actions.clearStream());
      // Overlay-only mode is a stated intent about overlays, not slide state:
      // clearing the slides must not put item content back on a live stream.
      expect(
        legacy(store.getState().presentation).streamItemContentBlocked,
      ).toBe(true);
    });

    it("setStreamItemContentBlocked true preserves active overlays", () => {
      const base = legacyInitialState();
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
      expect(
        legacy(store.getState().presentation).streamItemContentBlocked,
      ).toBe(true);
      expect(
        legacy(store.getState().presentation).streamInfo.participantOverlayInfo
          ?.name,
      ).toBe("Speaker");
    });

    it("setStreamItemContentBlocked true does not clear overlays without item data", () => {
      const base = legacyInitialState();
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
        legacy(store.getState().presentation).streamInfo.participantOverlayInfo
          ?.name,
      ).toBe("Speaker");
    });

    it("setStreamItemContentBlocked true does not clear when no active overlay", () => {
      const base = legacyInitialState();
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
        legacy(store.getState().presentation).streamInfo.slide?.boxes?.[0]
          ?.words,
      ).toBe("Lyrics");
    });

    it("clearAll leaves Hide Content on, since it is operator intent", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          streamItemContentBlocked: true,
        },
      });
      store.dispatch(presentationSlice.actions.clearAll());
      expect(
        legacy(store.getState().presentation).streamItemContentBlocked,
      ).toBe(true);
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
        legacy(store.getState().presentation).streamInfo.imageOverlayInfo?.time,
      ).toBe(555);

      store.dispatch(
        presentationSlice.actions.updateFormattedTextDisplayInfoFromRemote({
          text: "Remote text",
          time: 777,
          align: "center",
        }),
      );
      const afterFormatted = legacy(store.getState().presentation);
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
      const afterParticipant = legacy(store.getState().presentation);
      expect(afterParticipant.streamInfo.participantOverlayInfo?.time).toBe(
        666,
      );
      expect(afterParticipant.streamInfo.imageOverlayInfo?.imageUrl).toBe("");
    });

    it("updateParticipantOverlayInfoFromRemote preserves stream item when overlay-only off", () => {
      const base = legacyInitialState();
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
        legacy(store.getState().presentation).streamInfo.bibleDisplayInfo
          ?.title,
      ).toBe("John 3");
    });

    it("updateParticipantOverlayInfoFromRemote does not clear item when overlay-only on", () => {
      const base = legacyInitialState();
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
        legacy(store.getState().presentation).streamInfo.bibleDisplayInfo
          ?.title,
      ).toBe("John 3");
    });

    it("clearStreamOverlaysOnly empties overlays and keeps slide bible formatted", () => {
      const base = legacyInitialState();
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
      const s = legacy(store.getState().presentation).streamInfo;
      expect(s.participantOverlayInfo?.name).toBe("");
      expect(s.stbOverlayInfo?.heading).toBe("");
      expect(s.slide?.id).toBe("s1");
      expect(s.bibleDisplayInfo?.title).toBe("Jn");
      expect(s.formattedTextDisplayInfo?.text).toBe("ft");
    });

    it("clearStreamOverlaysOnly assigns a newer timestamp than the overlay it is clearing", () => {
      jest.useFakeTimers();
      jest.setSystemTime(1000);

      const base = legacyInitialState();
      const store = createStore({
        presentation: {
          ...base,
          isStreamTransmitting: true,
        },
      });

      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfo({
          id: "p1",
          type: "participant",
          name: "Ann",
          duration: 7,
        } as never),
      );

      const shownAt = legacy(store.getState().presentation).streamInfo
        .participantOverlayInfo?.time;

      store.dispatch(presentationSlice.actions.clearStreamOverlaysOnly());

      const clearedAt = legacy(store.getState().presentation).streamInfo
        .participantOverlayInfo?.time;

      expect(clearedAt).toBeGreaterThan(shownAt ?? -1);
    });

    it("sending image after clear does not leave prior participant in prevStreamInfo for a second exit", () => {
      jest.useFakeTimers();
      jest.setSystemTime(8000);

      const base = legacyInitialState();
      const store = createStore({
        presentation: {
          ...base,
          isStreamTransmitting: true,
        },
      });

      store.dispatch(
        presentationSlice.actions.updateImageOverlayInfo({
          id: "img-1",
          type: "image",
          imageUrl: "https://img.example/a.jpg",
        } as never),
      );

      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfo({
          id: "p-1",
          type: "participant",
          name: "Alex",
        } as never),
      );

      store.dispatch(presentationSlice.actions.clearStreamOverlaysOnly());

      expect(
        legacy(store.getState().presentation).prevStreamInfo
          .participantOverlayInfo?.name,
      ).toBe("Alex");

      store.dispatch(
        presentationSlice.actions.updateImageOverlayInfo({
          id: "img-2",
          type: "image",
          imageUrl: "https://img.example/b.jpg",
        } as never),
      );

      const end = legacy(store.getState().presentation);
      expect(end.prevStreamInfo.participantOverlayInfo?.name).toBe("");
      expect(end.streamInfo.imageOverlayInfo?.imageUrl).toBe(
        "https://img.example/b.jpg",
      );
    });

    it("updateImageOverlayInfo preserves outgoing participant in prevStreamInfo for exit animation", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
            participantOverlayInfo: {
              id: "p1",
              name: "Host",
              time: 1,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateImageOverlayInfo({
          id: "img-1",
          type: "image",
          imageUrl: "https://img.example/hero.jpg",
        } as never),
      );

      const state = legacy(store.getState().presentation);
      expect(state.prevStreamInfo.participantOverlayInfo?.name).toBe("Host");
      expect(state.streamInfo.participantOverlayInfo?.name).toBe("");
      expect(state.streamInfo.imageOverlayInfo?.imageUrl).toBe(
        "https://img.example/hero.jpg",
      );
    });

    it("sending image after full clearStream does not replay prior participant exit", () => {
      jest.useFakeTimers();
      jest.setSystemTime(9000);

      const base = legacyInitialState();
      const store = createStore({
        presentation: {
          ...base,
          isStreamTransmitting: true,
        },
      });

      store.dispatch(
        presentationSlice.actions.updateImageOverlayInfo({
          id: "img-a",
          type: "image",
          imageUrl: "https://img.example/a.jpg",
        } as never),
      );
      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfo({
          id: "part-a",
          type: "participant",
          name: "Alex",
        } as never),
      );

      store.dispatch(presentationSlice.actions.clearStream());
      expect(
        legacy(store.getState().presentation).prevStreamInfo
          .participantOverlayInfo?.name,
      ).toBe("Alex");

      store.dispatch(
        presentationSlice.actions.updateImageOverlayInfo({
          id: "img-b",
          type: "image",
          imageUrl: "https://img.example/b.jpg",
        } as never),
      );

      const end = legacy(store.getState().presentation);
      expect(end.prevStreamInfo.participantOverlayInfo?.name).toBe("");
      expect(end.prevStreamInfo.imageOverlayInfo?.imageUrl).toBe("");
      expect(end.streamInfo.imageOverlayInfo?.imageUrl).toBe(
        "https://img.example/b.jpg",
      );
    });

    it.each([
      {
        label: "participant",
        send: () =>
          presentationSlice.actions.updateParticipantOverlayInfo({
            id: "part-b",
            type: "participant",
            name: "Jordan",
          } as never),
        assert: (state: LegacyPresentationShape) => {
          expect(state.streamInfo.participantOverlayInfo?.name).toBe("Jordan");
        },
      },
      {
        label: "stb",
        send: () =>
          presentationSlice.actions.updateStbOverlayInfo({
            id: "stb-b",
            type: "stick-to-bottom",
            heading: "Service starts soon",
          } as never),
        assert: (state: LegacyPresentationShape) => {
          expect(state.streamInfo.stbOverlayInfo?.heading).toBe(
            "Service starts soon",
          );
        },
      },
      {
        label: "qr",
        send: () =>
          presentationSlice.actions.updateQrCodeOverlayInfo({
            id: "qr-b",
            type: "qr-code",
            url: "https://example.com/connect",
            description: "Connect",
          } as never),
        assert: (state: LegacyPresentationShape) => {
          expect(state.streamInfo.qrCodeOverlayInfo?.url).toBe(
            "https://example.com/connect",
          );
        },
      },
      {
        label: "board-post",
        send: () =>
          presentationSlice.actions.updateBoardPostStreamInfo({
            author: "Jordan",
            authorHexColor: "#22c55e",
            text: "Praying for you",
          }),
        assert: (state: LegacyPresentationShape) => {
          expect(state.streamInfo.boardPostStreamInfo?.text).toBe(
            "Praying for you",
          );
        },
      },
    ])(
      "sending %s after full clearStream does not replay prior participant exit",
      ({ send, assert }) => {
        jest.useFakeTimers();
        jest.setSystemTime(9100);

        const base = legacyInitialState();
        const store = createStore({
          presentation: {
            ...base,
            isStreamTransmitting: true,
          },
        });

        store.dispatch(
          presentationSlice.actions.updateImageOverlayInfo({
            id: "img-a",
            type: "image",
            imageUrl: "https://img.example/a.jpg",
          } as never),
        );
        store.dispatch(
          presentationSlice.actions.updateParticipantOverlayInfo({
            id: "part-a",
            type: "participant",
            name: "Alex",
          } as never),
        );

        store.dispatch(presentationSlice.actions.clearStream());
        expect(
          legacy(store.getState().presentation).prevStreamInfo
            .participantOverlayInfo?.name,
        ).toBe("Alex");

        store.dispatch(send());

        const end = legacy(store.getState().presentation);
        expect(end.prevStreamInfo.participantOverlayInfo?.name).toBe("");
        assert(end);
      },
    );

    it("clearStreamOverlaysOnly drops stale cross-type prev overlay so only live overlay exits", () => {
      jest.useFakeTimers();
      jest.setSystemTime(5000);

      const base = legacyInitialState();
      const store = createStore({
        presentation: {
          ...base,
          isStreamTransmitting: true,
        },
      });

      store.dispatch(
        presentationSlice.actions.updateImageOverlayInfo({
          id: "img-1",
          type: "image",
          imageUrl: "https://img.example/photo.jpg",
        } as never),
      );

      store.dispatch(
        presentationSlice.actions.updateQrCodeOverlayInfo({
          id: "qr-1",
          type: "qr-code",
          url: "https://example.com/qr",
          description: "Scan",
        } as never),
      );

      const mid = legacy(store.getState().presentation);
      expect(mid.streamInfo.imageOverlayInfo?.imageUrl).toBe("");
      expect(mid.prevStreamInfo.imageOverlayInfo?.imageUrl).toBe(
        "https://img.example/photo.jpg",
      );
      expect(mid.streamInfo.qrCodeOverlayInfo?.url).toBe(
        "https://example.com/qr",
      );

      store.dispatch(presentationSlice.actions.clearStreamOverlaysOnly());

      const end = legacy(store.getState().presentation);
      expect(end.prevStreamInfo.imageOverlayInfo?.imageUrl).toBe("");
      expect(end.prevStreamInfo.qrCodeOverlayInfo?.url).toBe(
        "https://example.com/qr",
      );
      expect(end.streamInfo.qrCodeOverlayInfo?.description).toBe("");
    });

    it("clearStreamOverlaysOnly clears overlays even when stream is not transmitting", () => {
      const base = legacyInitialState();
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
      const state = legacy(store.getState().presentation);
      expect(state.streamInfo.participantOverlayInfo?.name).toBe("");
      expect(state.prevStreamInfo.participantOverlayInfo?.name).toBe("Ann");
    });

    it("clearStreamOverlaysOnly no-op when no active overlay", () => {
      const base = legacyInitialState();
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
        legacy(store.getState().presentation).streamInfo.bibleDisplayInfo
          ?.title,
      ).toBe("Keep");
      expect(
        legacy(store.getState().presentation).streamInfo.participantOverlayInfo
          ?.name,
      ).toBe("");
    });

    it("setStreamItemContentBlocked false preserves active overlay", () => {
      const base = legacyInitialState();
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
      expect(
        legacy(store.getState().presentation).streamItemContentBlocked,
      ).toBe(false);
      expect(
        legacy(store.getState().presentation).streamInfo.participantOverlayInfo
          ?.name,
      ).toBe("Ann");
    });

    const streamSlideAndBible = (blocked: boolean) => ({
      ...legacyInitialState(),
      isStreamTransmitting: true,
      streamItemContentBlocked: blocked,
      streamInfo: {
        ...legacyInitialState().streamInfo,
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
      let s = legacy(blockedOn.getState().presentation).streamInfo;
      expect(s.slide?.boxes?.[0]?.words).toBe("Lyrics");
      expect(s.bibleDisplayInfo?.title).toBe("Psalm 23");
      expect(s.stbOverlayInfo?.heading).toBe("Announcements");

      const blockedOff = createStore({
        presentation: streamSlideAndBible(false),
      });
      blockedOff.dispatch(
        presentationSlice.actions.updateStbOverlayInfo(stbPayload as never),
      );
      s = legacy(blockedOff.getState().presentation).streamInfo;
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
      let s = legacy(blockedOn.getState().presentation).streamInfo;
      expect(s.bibleDisplayInfo?.title).toBe("Psalm 23");
      expect(s.qrCodeOverlayInfo?.url).toBe("https://example.com");

      const blockedOff = createStore({
        presentation: streamSlideAndBible(false),
      });
      blockedOff.dispatch(
        presentationSlice.actions.updateQrCodeOverlayInfo(qrPayload as never),
      );
      s = legacy(blockedOff.getState().presentation).streamInfo;
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
      let s = legacy(blockedOn.getState().presentation).streamInfo;
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
      s = legacy(blockedOff.getState().presentation).streamInfo;
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
        legacy(off.getState().presentation).streamInfo.bibleDisplayInfo?.title,
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
        legacy(on.getState().presentation).streamInfo.bibleDisplayInfo?.title,
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
      expect(
        legacy(store.getState().presentation).streamInfo.slide?.boxes?.[0]
          ?.words,
      ).toBe("Lyrics");
      expect(
        legacy(store.getState().presentation).streamInfo.bibleDisplayInfo
          ?.title,
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
        legacy(store.getState().presentation).streamInfo.bibleDisplayInfo
          ?.title,
      ).toBe("Psalm 23");
    });

    it("setStreamItemContentBlockedFromRemote matches local toggle behavior", () => {
      const base = legacyInitialState();
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
      expect(
        legacy(withOverlay.getState().presentation).streamItemContentBlocked,
      ).toBe(true);
      expect(
        legacy(withOverlay.getState().presentation).streamInfo
          .participantOverlayInfo?.name,
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
        legacy(overlayOnlyOff.getState().presentation).streamItemContentBlocked,
      ).toBe(false);
      expect(
        legacy(overlayOnlyOff.getState().presentation).streamInfo
          .participantOverlayInfo?.name,
      ).toBe("Y");
    });

    it("setStreamItemContentBlockedFromRemote false is a no-op when already false", () => {
      const base = legacyInitialState();
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

      expect(
        legacy(store.getState().presentation).streamItemContentBlocked,
      ).toBe(false);
      expect(
        legacy(store.getState().presentation).streamInfo.participantOverlayInfo
          ?.name,
      ).toBe("Live");
    });

    it("setStreamItemContentBlocked true is a no-op when already true", () => {
      const base = legacyInitialState();
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

      store.dispatch(
        presentationSlice.actions.setStreamItemContentBlocked(true),
      );

      expect(
        legacy(store.getState().presentation).streamItemContentBlocked,
      ).toBe(true);
      expect(
        legacy(store.getState().presentation).streamInfo.participantOverlayInfo
          ?.name,
      ).toBe("Live");
    });

    it("updateBibleDisplayInfo preserves overlays whether overlay-only is on or off", () => {
      const participant = { name: "Host", time: 1, id: "p" };
      const bible = { title: "Jn 3", text: "For God", time: 2 };

      const blockedOn = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamItemContentBlocked: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
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
      let s = legacy(blockedOn.getState().presentation).streamInfo;
      expect(s.bibleDisplayInfo?.title).toBe("Jn 3");
      expect(s.participantOverlayInfo?.name).toBe("Host");
      expect(s.stbOverlayInfo?.heading).toBe("H");

      const blockedOff = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamItemContentBlocked: false,
          streamInfo: {
            ...legacyInitialState().streamInfo,
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
      s = legacy(blockedOff.getState().presentation).streamInfo;
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
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamItemContentBlocked: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
            participantOverlayInfo: participant,
          },
        },
      });
      blockedOn.dispatch(
        presentationSlice.actions.updateFormattedTextDisplayInfo(formatted),
      );
      expect(
        legacy(blockedOn.getState().presentation).streamInfo
          .participantOverlayInfo?.name,
      ).toBe("Host");

      const blockedOff = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamItemContentBlocked: false,
          streamInfo: {
            ...legacyInitialState().streamInfo,
            participantOverlayInfo: participant,
          },
        },
      });
      blockedOff.dispatch(
        presentationSlice.actions.updateFormattedTextDisplayInfo(formatted),
      );
      expect(
        legacy(blockedOff.getState().presentation).streamInfo
          .participantOverlayInfo?.name,
      ).toBe("Host");
      expect(legacy(blockedOff.getState().presentation).streamInfo.type).toBe(
        "free",
      );
    });

    it("updateFormattedTextDisplayInfo clears the stream slide and refreshes streamInfo time", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
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

      const state = legacy(store.getState().presentation).streamInfo;
      expect(state.slide).toBeNull();
      expect(state.formattedTextDisplayInfo?.text).toBe("Formatted text");
      expect(state.time).toBeGreaterThan(10);
    });

    it("updateBibleDisplayInfo moves live formatted text to prev and clears stream slot for exit", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
            formattedTextDisplayInfo: {
              text: "Welcome everyone",
              time: 5,
              backgroundColor: "#eb8934",
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateBibleDisplayInfo({
          title: "Jn 3:16",
          text: "For God so loved",
        }),
      );

      const p = legacy(store.getState().presentation);
      expect(p.streamInfo.formattedTextDisplayInfo?.text).toBe("");
      expect(p.prevStreamInfo.formattedTextDisplayInfo?.text).toBe(
        "Welcome everyone",
      );
      expect(p.streamInfo.bibleDisplayInfo?.title).toBe("Jn 3:16");
      expect(p.streamInfo.type).toBe("bible");
    });

    it("updateFormattedTextDisplayInfo moves live bible to prev and clears stream bible for exit", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
            type: "bible",
            bibleDisplayInfo: {
              title: "Ps 23",
              text: "The Lord is my shepherd",
              time: 3,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateFormattedTextDisplayInfo({
          text: "Announcements",
        }),
      );

      const p = legacy(store.getState().presentation);
      expect(p.streamInfo.bibleDisplayInfo?.title).toBe("");
      expect(p.streamInfo.bibleDisplayInfo?.text).toBe("");
      expect(p.prevStreamInfo.bibleDisplayInfo?.title).toBe("Ps 23");
      expect(p.streamInfo.formattedTextDisplayInfo?.text).toBe("Announcements");
      expect(p.streamInfo.type).toBe("free");
    });

    it("updateFormattedTextDisplayInfo after empty updateBibleDisplayInfo keeps prev bible for exit (ItemSlides order)", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
            type: "bible",
            bibleDisplayInfo: {
              title: "Rom 8:1",
              text: "No condemnation",
              time: 1,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateBibleDisplayInfo({
          title: "",
          text: "",
        }),
      );
      store.dispatch(
        presentationSlice.actions.updateFormattedTextDisplayInfo({
          text: "Welcome",
        }),
      );

      const p = legacy(store.getState().presentation);
      expect(p.prevStreamInfo.bibleDisplayInfo?.title).toBe("Rom 8:1");
      expect(p.streamInfo.formattedTextDisplayInfo?.text).toBe("Welcome");
      expect(p.streamInfo.type).toBe("free");
    });

    it("updateStream snapshots live bible into prev before clearing non-slide stream fields", () => {
      const slide = {
        id: "s1",
        type: "song" as const,
        name: "Song",
        boxes: [{ id: "b1", width: 10, height: 10, words: "Lyric" }],
      };
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
            type: "bible",
            bibleDisplayInfo: {
              title: "Ps 1",
              text: "Blessed",
              time: 1,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateStream({
          slide,
          type: "song",
          name: "Song",
        } as never),
      );

      const p = legacy(store.getState().presentation);
      expect(p.prevStreamInfo.bibleDisplayInfo?.title).toBe("Ps 1");
      expect(p.streamInfo.bibleDisplayInfo?.title).toBe("");
      expect(p.streamInfo.type).toBe("song");
    });

    it("updateStream snapshots live formatted text into prev when switching to a stream slide", () => {
      const slide = {
        id: "s1",
        type: "song" as const,
        name: "Song",
        boxes: [{ id: "b1", width: 10, height: 10, words: "Lyric" }],
      };
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
            type: "free",
            formattedTextDisplayInfo: {
              text: "Announcements here",
              time: 3,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateStream({
          slide,
          type: "song",
          name: "Song",
        } as never),
      );

      const p = legacy(store.getState().presentation);
      expect(p.prevStreamInfo.formattedTextDisplayInfo?.text).toBe(
        "Announcements here",
      );
      expect(p.streamInfo.formattedTextDisplayInfo?.text).toBe("");
      expect(p.streamInfo.type).toBe("song");
    });

    it("updateStream leaves prev bible unchanged when stream bible is already empty", () => {
      const slide = {
        id: "s1",
        type: "song" as const,
        name: "Song",
        boxes: [{ id: "b1", width: 10, height: 10, words: "Lyric" }],
      };
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          prevStreamInfo: {
            ...legacyInitialState().prevStreamInfo,
            bibleDisplayInfo: {
              title: "AlreadyInPrev",
              text: "saved",
              time: 1,
            },
          },
          streamInfo: {
            ...legacyInitialState().streamInfo,
            type: "bible",
            bibleDisplayInfo: { title: "", text: "", time: 99 },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateStream({
          slide,
          type: "song",
          name: "Song",
        } as never),
      );

      expect(
        legacy(store.getState().presentation).prevStreamInfo.bibleDisplayInfo
          ?.title,
      ).toBe("AlreadyInPrev");
    });

    it("updateStreamFromRemote snapshots live bible into prev when switching to a stream slide", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          streamInfo: {
            ...legacyInitialState().streamInfo,
            type: "bible",
            bibleDisplayInfo: {
              title: "Gal 2:20",
              text: "Christ lives in me",
              time: 5,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateStreamFromRemote(
          createPresentation({
            type: "song",
            name: "Song",
            slide: { id: "sl", type: "Media", name: "m", boxes: [] },
            time: 10,
            displayType: "stream",
          }),
        ),
      );

      const p = legacy(store.getState().presentation);
      expect(p.prevStreamInfo.bibleDisplayInfo?.title).toBe("Gal 2:20");
      expect(p.streamInfo.bibleDisplayInfo?.title).toBe("");
      expect(p.streamInfo.type).toBe("song");
    });

    it("updateStreamFromRemote snapshots live formatted text into prev when switching to a stream slide", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          streamInfo: {
            ...legacyInitialState().streamInfo,
            type: "free",
            formattedTextDisplayInfo: {
              text: "Potluck signup",
              time: 2,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateStreamFromRemote(
          createPresentation({
            type: "song",
            name: "Song",
            slide: { id: "sl", type: "Media", name: "m", boxes: [] },
            time: 10,
            displayType: "stream",
          }),
        ),
      );

      const p = legacy(store.getState().presentation);
      expect(p.prevStreamInfo.formattedTextDisplayInfo?.text).toBe(
        "Potluck signup",
      );
      expect(p.streamInfo.formattedTextDisplayInfo?.text).toBe("");
    });

    it("updateBibleDisplayInfoFromRemote moves live formatted text to prev and clears stream slot", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          streamInfo: {
            ...legacyInitialState().streamInfo,
            formattedTextDisplayInfo: {
              text: "Hello church",
              time: 2,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateBibleDisplayInfoFromRemote({
          title: "Mt 5:3",
          text: "Blessed are the poor in spirit",
          time: 10,
        }),
      );

      const p = legacy(store.getState().presentation);
      expect(p.streamInfo.formattedTextDisplayInfo?.text).toBe("");
      expect(p.prevStreamInfo.formattedTextDisplayInfo?.text).toBe(
        "Hello church",
      );
      expect(p.streamInfo.bibleDisplayInfo?.title).toBe("Mt 5:3");
      expect(p.streamInfo.type).toBe("bible");
    });

    it("updateFormattedTextDisplayInfoFromRemote after empty bible keeps prev bible (remote ItemSlides order)", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          streamInfo: {
            ...legacyInitialState().streamInfo,
            type: "bible",
            bibleDisplayInfo: {
              title: "Col 3:1",
              text: "Seek things above",
              time: 1,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateBibleDisplayInfoFromRemote({
          title: "",
          text: "",
          time: 2,
        }),
      );
      store.dispatch(
        presentationSlice.actions.updateFormattedTextDisplayInfoFromRemote({
          text: "Picnic Sunday",
          time: 3,
        } as never),
      );

      expect(
        legacy(store.getState().presentation).prevStreamInfo.bibleDisplayInfo
          ?.title,
      ).toBe("Col 3:1");
      expect(
        legacy(store.getState().presentation).streamInfo
          .formattedTextDisplayInfo?.text,
      ).toBe("Picnic Sunday");
      expect(legacy(store.getState().presentation).streamInfo.type).toBe(
        "free",
      );
    });

    it("remote clear keeps the outgoing verse in prev when stream snapshot arrives before the empty bible", () => {
      const store = createStore();
      store.dispatch(
        presentationSlice.actions.updateBibleDisplayInfoFromRemote({
          title: "Jn 3:16",
          text: "For God so loved",
          time: 100,
        }),
      );

      // Clear propagates as separate per-key remote updates; the emptied stream
      // snapshot (type "") can land before the empty bible echo.
      store.dispatch(
        presentationSlice.actions.updateStreamFromRemote({
          type: "",
          name: "",
          slide: null,
          displayType: "stream",
          time: 200,
        } as never),
      );
      store.dispatch(
        presentationSlice.actions.updateBibleDisplayInfoFromRemote({
          title: "",
          text: "",
          time: 201,
        }),
      );

      // The empty bible echo must not overwrite the verse already staged for the fade-out.
      expect(
        legacy(store.getState().presentation).prevStreamInfo.bibleDisplayInfo
          ?.text,
      ).toBe("For God so loved");
    });

    it("remote clear keeps the outgoing formatted text in prev when stream snapshot arrives before the empty update", () => {
      const store = createStore();
      store.dispatch(
        presentationSlice.actions.updateFormattedTextDisplayInfoFromRemote({
          text: "Welcome",
          time: 100,
        } as never),
      );

      store.dispatch(
        presentationSlice.actions.updateStreamFromRemote({
          type: "",
          name: "",
          slide: null,
          displayType: "stream",
          time: 200,
        } as never),
      );
      store.dispatch(
        presentationSlice.actions.updateFormattedTextDisplayInfoFromRemote({
          text: "",
          time: 201,
        } as never),
      );

      expect(
        legacy(store.getState().presentation).prevStreamInfo
          .formattedTextDisplayInfo?.text,
      ).toBe("Welcome");
    });

    it("updateFormattedTextDisplayInfoFromRemote with empty text does not clear live bible (firebase echo order)", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          streamInfo: {
            ...legacyInitialState().streamInfo,
            type: "bible",
            formattedTextDisplayInfo: { text: "", time: 99 },
            bibleDisplayInfo: {
              title: "Jn 3:16",
              text: "For God so loved the world",
              time: 100,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateFormattedTextDisplayInfoFromRemote({
          text: "",
          time: 101,
        } as never),
      );

      const p = legacy(store.getState().presentation);
      expect(p.streamInfo.bibleDisplayInfo?.title).toBe("Jn 3:16");
      expect(p.streamInfo.type).toBe("bible");
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
          ...legacyInitialState(),
          projectorInfo: {
            ...legacyInitialState().projectorInfo,
            name: "Projector Active",
            type: "song",
            slide: currentSlide,
          },
          monitorInfo: {
            ...legacyInitialState().monitorInfo,
            name: "Monitor Active",
            type: "song",
            slide: currentSlide,
            nextSlide,
          },
          streamInfo: {
            ...legacyInitialState().streamInfo,
            name: "Stream Active",
            type: "song",
            slide: currentSlide,
            participantOverlayInfo: { id: "p", name: "Name", time: 1 },
          },
        },
      });

      store.dispatch(presentationSlice.actions.clearAll());
      const state = legacy(store.getState().presentation);

      expect(state.prevProjectorInfo.name).toBe("Projector Active");
      expect(state.prevMonitorInfo.name).toBe("Monitor Active");
      expect(state.prevMonitorInfo.nextSlide).toBeNull();
      expect(state.prevStreamInfo.name).toBe("Stream Active");
      expect(state.projectorInfo.slide).toBeNull();
      expect(state.monitorInfo.slide).toBeNull();
      expect(state.streamInfo.slide).toBeNull();
      expect(state.streamInfo.participantOverlayInfo?.name).toBe("");
    });

    it("clearAll leaves outputs it was not given alone, so a disabled display is untouched", () => {
      const currentSlide = {
        id: "current",
        type: "Media" as const,
        name: "Current",
        boxes: [],
      };

      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          projectorInfo: {
            ...legacyInitialState().projectorInfo,
            name: "Projector Active",
            type: "song",
            slide: currentSlide,
          },
          monitorInfo: {
            ...legacyInitialState().monitorInfo,
            name: "Monitor Active",
            type: "song",
            slide: currentSlide,
          },
        },
      });

      // The controller passes only enabled outputs; a disabled monitor is absent
      // from that list and must keep whatever it was showing.
      store.dispatch(
        presentationSlice.actions.clearAll({ outputIds: ["projector"] }),
      );
      const state = legacy(store.getState().presentation);

      expect(state.projectorInfo.slide).toBeNull();
      expect(state.monitorInfo.slide).toEqual(currentSlide);
      expect(state.monitorInfo.name).toBe("Monitor Active");
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
          ...legacyInitialState(),
          isMonitorTransmitting: true,
          isStreamTransmitting: true,
          monitorInfo: {
            ...legacyInitialState().monitorInfo,
            slide: oldMonitorSlide,
            nextSlide: { id: "next-old", type: "Media", name: "", boxes: [] },
            itemId: "old-item",
          },
          streamInfo: {
            ...legacyInitialState().streamInfo,
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

      const state = legacy(store.getState().presentation);
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
          ...legacyInitialState(),
          streamInfo: {
            ...legacyInitialState().streamInfo,
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
      expect(legacy(store.getState().presentation).streamInfo.slide).toEqual({
        id: "song-slide",
        type: "Media",
        name: "song",
        boxes: [],
      });
      expect(
        legacy(store.getState().presentation).streamInfo.bibleDisplayInfo
          ?.title,
      ).toBe("");
      expect(
        legacy(store.getState().presentation).streamInfo
          .formattedTextDisplayInfo?.text,
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
      expect(legacy(store.getState().presentation).streamInfo.slide).toBeNull();

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
      expect(legacy(store.getState().presentation).streamInfo.slide).toBeNull();
      expect(legacy(store.getState().presentation).streamInfo.name).toBe(
        "Free Remote",
      );
    });

    it("updateStreamFromRemote preserves bible text for bible snapshots", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          streamInfo: {
            ...legacyInitialState().streamInfo,
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

      expect(
        legacy(store.getState().presentation).streamInfo.bibleDisplayInfo
          ?.title,
      ).toBe("Jn 3");
      expect(legacy(store.getState().presentation).streamInfo.type).toBe(
        "bible",
      );
    });

    it("updateStreamFromRemote keeps overlays for stream slides when overlay-only is on", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          streamItemContentBlocked: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
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

      const state = legacy(store.getState().presentation).streamInfo;
      expect(state.slide?.id).toBe("song-2");
      expect(state.bibleDisplayInfo?.title).toBe("");
      expect(state.participantOverlayInfo?.name).toBe("Host");
    });

    it("updateParticipantOverlayInfo preserves the outgoing overlay in prevStreamInfo for exit animation", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
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

      const state = legacy(store.getState().presentation);
      expect(state.prevStreamInfo.qrCodeOverlayInfo?.description).toBe(
        "Scan me",
      );
      expect(state.streamInfo.qrCodeOverlayInfo?.description).toBe("");
      expect(state.streamInfo.participantOverlayInfo?.name).toBe("Alex");
    });

    it("updateImageOverlayInfoFromRemote is a no-op when stream already shows the same image overlay (sync echo)", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
            imageOverlayInfo: {
              id: "img-1",
              type: "image",
              imageUrl: "https://img.example/a.jpg",
              time: 100,
            },
          },
        },
      });

      const before = legacy(store.getState().presentation);

      store.dispatch(
        presentationSlice.actions.updateImageOverlayInfoFromRemote({
          id: "img-1",
          type: "image",
          imageUrl: "https://img.example/a.jpg",
          time: 100,
        } as never),
      );

      const after = legacy(store.getState().presentation);
      expect(after.streamInfo.imageOverlayInfo?.time).toBe(100);
      expect(after.streamInfo.imageOverlayInfo?.imageUrl).toBe(
        "https://img.example/a.jpg",
      );
      expect(after.prevStreamInfo.imageOverlayInfo).toEqual(
        before.prevStreamInfo.imageOverlayInfo,
      );
    });

    it("updateParticipantOverlayInfoFromRemote is a no-op when stream already shows the same participant overlay (sync echo)", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
            participantOverlayInfo: {
              id: "p-1",
              name: "Alex",
              title: "Host",
              event: "Sunday",
              time: 50,
            },
          },
        },
      });

      const before = legacy(store.getState().presentation);

      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfoFromRemote({
          id: "p-1",
          name: "Alex",
          title: "Host",
          event: "Sunday",
          time: 50,
        } as never),
      );

      const after = legacy(store.getState().presentation);
      expect(after.streamInfo.participantOverlayInfo?.time).toBe(50);
      expect(after.prevStreamInfo.participantOverlayInfo).toEqual(
        before.prevStreamInfo.participantOverlayInfo,
      );
    });

    it("updateStbOverlayInfoFromRemote is a no-op when stream already shows the same STB overlay (sync echo)", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
            stbOverlayInfo: {
              id: "stb-1",
              heading: "Welcome",
              subHeading: "Today",
              time: 50,
            },
          },
        },
      });

      const before = legacy(store.getState().presentation);

      store.dispatch(
        presentationSlice.actions.updateStbOverlayInfoFromRemote({
          id: "stb-1",
          heading: "Welcome",
          subHeading: "Today",
          time: 50,
        } as never),
      );

      const after = legacy(store.getState().presentation);
      expect(after.streamInfo.stbOverlayInfo?.time).toBe(50);
      expect(after.prevStreamInfo.stbOverlayInfo).toEqual(
        before.prevStreamInfo.stbOverlayInfo,
      );
    });

    it("updateQrCodeOverlayInfoFromRemote is a no-op when stream already shows the same QR overlay (sync echo)", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          isStreamTransmitting: true,
          streamInfo: {
            ...legacyInitialState().streamInfo,
            qrCodeOverlayInfo: {
              id: "qr-1",
              url: "https://example.com/x",
              description: "Scan",
              time: 50,
            },
          },
        },
      });

      const before = legacy(store.getState().presentation);

      store.dispatch(
        presentationSlice.actions.updateQrCodeOverlayInfoFromRemote({
          id: "qr-1",
          url: "https://example.com/x",
          description: "Scan",
          time: 50,
        } as never),
      );

      const after = legacy(store.getState().presentation);
      expect(after.streamInfo.qrCodeOverlayInfo?.time).toBe(50);
      expect(after.prevStreamInfo.qrCodeOverlayInfo).toEqual(
        before.prevStreamInfo.qrCodeOverlayInfo,
      );
    });

    it("updateImageOverlayInfoFromRemote preserves the outgoing overlay in prevStreamInfo for exit animation", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          streamInfo: {
            ...legacyInitialState().streamInfo,
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

      const state = legacy(store.getState().presentation);
      expect(state.prevStreamInfo.participantOverlayInfo?.name).toBe("Host");
      expect(state.streamInfo.participantOverlayInfo?.name).toBe("");
      expect(state.streamInfo.imageOverlayInfo?.imageUrl).toBe(
        "https://img.example/hero.jpg",
      );
    });

    it("does not clear prev participant when empty participant remote follows image remote (per-key Firebase order)", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          streamInfo: {
            ...legacyInitialState().streamInfo,
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
      expect(
        legacy(store.getState().presentation).prevStreamInfo
          .participantOverlayInfo?.name,
      ).toBe("Host");

      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfoFromRemote({
          id: "p-empty",
          name: "",
          title: "",
          event: "",
          time: 10,
        } as never),
      );

      const end = legacy(store.getState().presentation);
      expect(end.prevStreamInfo.participantOverlayInfo?.name).toBe("Host");
      expect(end.streamInfo.participantOverlayInfo?.name).toBe("");
    });

    it("keeps a cross-type outgoing image overlay in prevStreamInfo when remote updates arrive clear-first", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          streamInfo: {
            ...legacyInitialState().streamInfo,
            imageOverlayInfo: {
              id: "img-live",
              imageUrl: "https://img.example/current.jpg",
              name: "Current image",
              time: 5,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateImageOverlayInfoFromRemote({
          id: "img-cleared",
          imageUrl: "",
          name: "",
          time: 10,
        }),
      );

      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfoFromRemote({
          id: "participant-next",
          name: "Alex",
          time: 10,
        }),
      );

      const state = legacy(store.getState().presentation);
      expect(state.prevStreamInfo.imageOverlayInfo?.imageUrl).toBe(
        "https://img.example/current.jpg",
      );
      expect(state.streamInfo.imageOverlayInfo?.imageUrl).toBe("");
      expect(state.streamInfo.participantOverlayInfo?.name).toBe("Alex");
    });

    it("clearStreamOverlaysOnly keeps existing prev overlay object when it matches live id", () => {
      const base = legacyInitialState();
      const matchingImage = {
        id: "img-match",
        type: "image" as const,
        imageUrl: "https://img.example/same.jpg",
        time: 10,
      } as never;
      const store = createStore({
        presentation: {
          ...base,
          isStreamTransmitting: true,
          streamInfo: {
            ...base.streamInfo,
            imageOverlayInfo: matchingImage,
          },
          prevStreamInfo: {
            ...base.prevStreamInfo,
            imageOverlayInfo: matchingImage,
          },
        },
      });

      const beforeRef = legacy(store.getState().presentation).prevStreamInfo
        .imageOverlayInfo;
      store.dispatch(presentationSlice.actions.clearStreamOverlaysOnly());
      const afterRef = legacy(store.getState().presentation).prevStreamInfo
        .imageOverlayInfo;

      expect(afterRef).toBe(beforeRef);
      expect(afterRef?.imageUrl).toBe("https://img.example/same.jpg");
    });

    it("remote sequence image -> participant -> clear -> image does not replay participant exit", () => {
      jest.useFakeTimers();
      jest.setSystemTime(10000);

      const base = legacyInitialState();
      const store = createStore({
        presentation: {
          ...base,
          isStreamTransmitting: true,
        },
      });

      store.dispatch(
        presentationSlice.actions.updateImageOverlayInfoFromRemote({
          id: "img-a",
          type: "image",
          imageUrl: "https://img.example/a.jpg",
          time: 10,
        } as never),
      );
      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfoFromRemote({
          id: "p-a",
          type: "participant",
          name: "Alex",
          time: 11,
        } as never),
      );

      store.dispatch(presentationSlice.actions.clearStreamOverlaysOnly());

      store.dispatch(
        presentationSlice.actions.updateImageOverlayInfoFromRemote({
          id: "img-b",
          type: "image",
          imageUrl: "https://img.example/b.jpg",
          time: 12,
        } as never),
      );

      const end = legacy(store.getState().presentation);
      expect(end.prevStreamInfo.participantOverlayInfo?.name).toBe("");
      expect(end.streamInfo.imageOverlayInfo?.imageUrl).toBe(
        "https://img.example/b.jpg",
      );
    });

    it.each([
      {
        label: "participant",
        send: () =>
          presentationSlice.actions.updateParticipantOverlayInfoFromRemote({
            id: "p-b",
            type: "participant",
            name: "Jordan",
            time: 12,
          } as never),
        assert: (state: LegacyPresentationShape) => {
          expect(state.streamInfo.participantOverlayInfo?.name).toBe("Jordan");
        },
      },
      {
        label: "stb",
        send: () =>
          presentationSlice.actions.updateStbOverlayInfoFromRemote({
            id: "stb-b",
            type: "stick-to-bottom",
            heading: "Service starts soon",
            time: 12,
          } as never),
        assert: (state: LegacyPresentationShape) => {
          expect(state.streamInfo.stbOverlayInfo?.heading).toBe(
            "Service starts soon",
          );
        },
      },
      {
        label: "qr",
        send: () =>
          presentationSlice.actions.updateQrCodeOverlayInfoFromRemote({
            id: "qr-b",
            type: "qr-code",
            url: "https://example.com/connect",
            description: "Connect",
            time: 12,
          } as never),
        assert: (state: LegacyPresentationShape) => {
          expect(state.streamInfo.qrCodeOverlayInfo?.url).toBe(
            "https://example.com/connect",
          );
        },
      },
    ])(
      "remote sequence image -> participant -> clear -> %s does not replay participant exit",
      ({ send, assert }) => {
        jest.useFakeTimers();
        jest.setSystemTime(10000);

        const base = legacyInitialState();
        const store = createStore({
          presentation: {
            ...base,
            isStreamTransmitting: true,
          },
        });

        store.dispatch(
          presentationSlice.actions.updateImageOverlayInfoFromRemote({
            id: "img-a",
            type: "image",
            imageUrl: "https://img.example/a.jpg",
            time: 10,
          } as never),
        );
        store.dispatch(
          presentationSlice.actions.updateParticipantOverlayInfoFromRemote({
            id: "p-a",
            type: "participant",
            name: "Alex",
            time: 11,
          } as never),
        );

        store.dispatch(presentationSlice.actions.clearStreamOverlaysOnly());
        store.dispatch(send());

        const end = legacy(store.getState().presentation);
        expect(end.prevStreamInfo.participantOverlayInfo?.name).toBe("");
        assert(end);
      },
    );

    it("remote late clear after cross-type switch clears stale prev image", () => {
      const base = legacyInitialState();
      const store = createStore({
        presentation: {
          ...base,
          isStreamTransmitting: true,
        },
      });

      store.dispatch(
        presentationSlice.actions.updateImageOverlayInfoFromRemote({
          id: "img-a",
          type: "image",
          imageUrl: "https://img.example/a.jpg",
          time: 10,
        } as never),
      );
      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfoFromRemote({
          id: "p-a",
          type: "participant",
          name: "Alex",
          time: 11,
        } as never),
      );

      // Late clear for image arrives after stream image already switched away.
      store.dispatch(
        presentationSlice.actions.updateImageOverlayInfoFromRemote({
          id: "img-clear",
          type: "image",
          imageUrl: "",
          time: 12,
        } as never),
      );

      const state = legacy(store.getState().presentation);
      expect(state.streamInfo.imageOverlayInfo?.imageUrl).toBe("");
      expect(state.prevStreamInfo.imageOverlayInfo?.imageUrl).toBe("");
      expect(state.streamInfo.participantOverlayInfo?.name).toBe("Alex");
    });

    it("preserves outgoing image overlay in prevStreamInfo for exit animation when remote updates arrive clear-last", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          streamInfo: {
            ...legacyInitialState().streamInfo,
            imageOverlayInfo: {
              id: "img-live",
              imageUrl: "https://img.example/current.jpg",
              name: "Current image",
              time: 5,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfoFromRemote({
          id: "participant-next",
          name: "Alex",
          time: 10,
        }),
      );

      store.dispatch(
        presentationSlice.actions.updateImageOverlayInfoFromRemote({
          id: "img-cleared",
          imageUrl: "",
          name: "",
          time: 10,
        }),
      );

      const state = legacy(store.getState().presentation);
      expect(state.prevStreamInfo.imageOverlayInfo?.imageUrl).toBe(
        "https://img.example/current.jpg",
      );
      expect(state.streamInfo.imageOverlayInfo?.imageUrl).toBe("");
      expect(state.streamInfo.participantOverlayInfo?.name).toBe("Alex");
    });

    it("preserves outgoing QR overlay in prevStreamInfo for exit animation when remote updates arrive clear-last", () => {
      const store = createStore({
        presentation: {
          ...legacyInitialState(),
          streamInfo: {
            ...legacyInitialState().streamInfo,
            qrCodeOverlayInfo: {
              id: "qr-live",
              url: "https://example.com",
              description: "Scan here",
              time: 5,
            },
          },
        },
      });

      store.dispatch(
        presentationSlice.actions.updateParticipantOverlayInfoFromRemote({
          id: "participant-next",
          name: "Alex",
          time: 10,
        }),
      );

      store.dispatch(
        presentationSlice.actions.updateQrCodeOverlayInfoFromRemote({
          id: "qr-cleared",
          url: "",
          description: "",
          time: 10,
        }),
      );

      const state = legacy(store.getState().presentation);
      expect(state.prevStreamInfo.qrCodeOverlayInfo?.description).toBe(
        "Scan here",
      );
      expect(state.streamInfo.qrCodeOverlayInfo?.description).toBe("");
      expect(state.streamInfo.participantOverlayInfo?.name).toBe("Alex");
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
          ...legacyInitialState(),
          monitorInfo: {
            ...legacyInitialState().monitorInfo,
            slide: currentSlide,
            name: "Monitor live",
            type: "song",
            itemId: "item-monitor",
            nextSlide: { id: "next-slide", type: "Media", name: "", boxes: [] },
          },
          streamInfo: {
            ...legacyInitialState().streamInfo,
            slide: currentSlide,
            name: "Stream live",
            type: "song",
            participantOverlayInfo: { id: "p", name: "Name", time: 10 },
            qrCodeOverlayInfo: { id: "q", description: "QR", time: 10 },
          },
        },
      });

      store.dispatch(presentationSlice.actions.clearMonitor());
      let state = legacy(store.getState().presentation);
      expect(state.prevMonitorInfo.name).toBe("Monitor live");
      expect(state.prevMonitorInfo.itemId).toBe("item-monitor");
      expect(state.monitorInfo.slide).toBeNull();

      store.dispatch(presentationSlice.actions.clearStream());
      state = legacy(store.getState().presentation);
      expect(state.prevStreamInfo.name).toBe("Stream live");
      expect(state.prevStreamInfo.participantOverlayInfo?.name).toBe("Name");
      expect(state.streamInfo.slide).toBeNull();
      expect(state.streamInfo.participantOverlayInfo?.name).toBe("");
      expect(state.streamInfo.qrCodeOverlayInfo?.description).toBe("");
    });

    describe("board-post overlay machine", () => {
      it("updateBoardPostStreamInfo no-ops when stream is not transmitting", () => {
        const store = createStore({
          presentation: {
            ...legacyInitialState(),
            isStreamTransmitting: false,
          },
        });

        store.dispatch(
          presentationSlice.actions.updateBoardPostStreamInfo({
            author: "Alex",
            authorHexColor: "#0ea5e9",
            text: "Hello church",
          }),
        );

        expect(
          legacy(store.getState().presentation).streamInfo.boardPostStreamInfo
            ?.text,
        ).toBe("");
      });

      it("updateBoardPostStreamInfo preserves outgoing board post in prev on same-type replacement", () => {
        jest.useFakeTimers();
        jest.setSystemTime(20_000);

        const base = legacyInitialState();
        const store = createStore({
          presentation: {
            ...base,
            isStreamTransmitting: true,
          },
        });

        store.dispatch(
          presentationSlice.actions.updateBoardPostStreamInfo({
            author: "First",
            authorHexColor: "#f97316",
            text: "First post",
          }),
        );
        const firstSeq = legacy(store.getState().presentation).streamInfo
          .boardPostStreamInfo?.transitionSequence;

        store.dispatch(
          presentationSlice.actions.updateBoardPostStreamInfo({
            author: "Second",
            authorHexColor: "#22c55e",
            text: "Second post",
          }),
        );

        const state = legacy(store.getState().presentation);
        expect(state.prevStreamInfo.boardPostStreamInfo?.text).toBe(
          "First post",
        );
        expect(state.streamInfo.boardPostStreamInfo?.text).toBe("Second post");
        expect(
          state.streamInfo.boardPostStreamInfo?.transitionSequence,
        ).toBeGreaterThan(firstSeq ?? 0);
      });

      it("updateBoardPostStreamInfoFromRemote handoffs current to prev", () => {
        const base = legacyInitialState();
        const store = createStore({
          presentation: {
            ...base,
            streamInfo: {
              ...base.streamInfo,
              boardPostStreamInfo: {
                author: "Local",
                authorHexColor: "#e7e5e4",
                text: "Local post",
                time: 100,
                transitionSequence: 1,
              },
            },
          },
        });

        store.dispatch(
          presentationSlice.actions.updateBoardPostStreamInfoFromRemote({
            author: "Remote",
            authorHexColor: "#6366f1",
            text: "Remote post",
            time: 200,
            transitionSequence: 2,
          }),
        );

        const state = legacy(store.getState().presentation);
        expect(state.prevStreamInfo.boardPostStreamInfo?.text).toBe(
          "Local post",
        );
        expect(state.streamInfo.boardPostStreamInfo?.text).toBe("Remote post");
        expect(state.streamInfo.boardPostStreamInfo?.transitionSequence).toBe(
          2,
        );
      });

      it("clearStreamOverlaysOnly moves live board post to prev with a newer timestamp", () => {
        jest.useFakeTimers();
        jest.setSystemTime(30_000);

        const base = legacyInitialState();
        const store = createStore({
          presentation: {
            ...base,
            isStreamTransmitting: true,
          },
        });

        store.dispatch(
          presentationSlice.actions.updateBoardPostStreamInfo({
            author: "Ann",
            authorHexColor: "#e11d48",
            text: "Clear me",
            duration: 10,
          }),
        );
        const liveTime =
          legacy(store.getState().presentation).streamInfo.boardPostStreamInfo
            ?.time ?? 0;

        store.dispatch(presentationSlice.actions.clearStreamOverlaysOnly());

        const state = legacy(store.getState().presentation);
        expect(state.prevStreamInfo.boardPostStreamInfo?.text).toBe("Clear me");
        expect(state.streamInfo.boardPostStreamInfo?.text).toBe("");
        expect(state.streamInfo.boardPostStreamInfo?.time).toBeGreaterThan(
          liveTime,
        );
        expect(
          state.streamInfo.boardPostStreamInfo?.transitionSequence,
        ).toBeGreaterThan(
          state.prevStreamInfo.boardPostStreamInfo?.transitionSequence ?? 0,
        );
      });

      it("sending participant after board post preserves board post in prev for exit", () => {
        jest.useFakeTimers();
        jest.setSystemTime(40_000);

        const base = legacyInitialState();
        const store = createStore({
          presentation: {
            ...base,
            isStreamTransmitting: true,
          },
        });

        store.dispatch(
          presentationSlice.actions.updateBoardPostStreamInfo({
            author: "Pat",
            authorHexColor: "#14b8a6",
            text: "Board first",
          }),
        );
        store.dispatch(
          presentationSlice.actions.updateParticipantOverlayInfo({
            id: "p-next",
            type: "participant",
            name: "Speaker",
          } as never),
        );

        const state = legacy(store.getState().presentation);
        expect(state.streamInfo.boardPostStreamInfo?.text).toBe("");
        expect(state.prevStreamInfo.boardPostStreamInfo?.text).toBe(
          "Board first",
        );
        expect(state.streamInfo.participantOverlayInfo?.name).toBe("Speaker");
      });
    });
  });
});
