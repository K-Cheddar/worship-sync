import { render, screen, within } from "@testing-library/react";
import type { ItemSlideType, MediaType } from "../../types";
import DisplayBox from "../../components/DisplayWindow/DisplayBox";
import StaticSlideThumbnail from "./StaticSlideThumbnail";
import { resolveDisplaySettings } from "../../utils/displaySettings";

const queryRenderedVideo = () => {
  // A native <video> has no implicit testing-library role.
  // eslint-disable-next-line testing-library/no-node-access
  return document.querySelector("video");
};

jest.mock("../../hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: (url?: string) => url,
  useResolvedCachedMediaUrl: (url?: string) => url,
}));
jest.mock("../../hooks/useLocalImageUrl", () => ({
  useLocalImageUrl: (reference?: { id?: string }) => {
    if (reference?.id === "asset-1") {
      return {
        isLocalImage: true,
        isOwner: true,
        status: "ready",
        url: "blob:asset-1",
      };
    }
    if (reference?.id === "asset-2") {
      return {
        isLocalImage: true,
        isOwner: false,
        status: "unavailable",
      };
    }
    return { isLocalImage: false, isOwner: false, status: "not-local" };
  },
}));
jest.mock("../../hooks/useLocalVideoFileUrl", () => ({
  isUnavailableLocalVideoFile: (resolution: { status: string }) =>
    resolution.status === "unavailable",
  useLocalVideoFileUrl: (reference?: { id?: string }, purpose?: string) =>
    reference?.id === "local-video"
      ? {
          isLocalVideoFile: true,
          isOwner: true,
          status: "ready",
          url:
            purpose === "thumbnail"
              ? "blob:local-video-thumbnail"
              : "worshipsync-media://asset/local-video",
        }
      : { isLocalVideoFile: false, isOwner: false, status: "not-local" },
}));
jest.mock("../../components/DisplayWindow/TimerDisplay", () => ({
  __esModule: true,
  default: ({ words }: { words: string }) => <span>{words}</span>,
}));

const makeSlide = (overrides: Partial<ItemSlideType> = {}) =>
  ({
    id: "slide-1",
    name: "Verse 1",
    type: "Verse",
    boxes: [
      {
        id: "background",
        width: 100,
        height: 100,
        background: "https://example.test/background.jpg",
        words: "",
      },
      {
        id: "text",
        width: 80,
        height: 30,
        x: 10,
        y: 30,
        words: "Hello worship",
      },
    ],
    ...overrides,
  }) as ItemSlideType;

describe("StaticSlideThumbnail", () => {
  it.each(["projector", "monitor", "stream"] as const)(
    "uses the correct background preview behavior for %s without video playback",
    (previewMode) => {
      const slide = makeSlide();
      slide.boxes[0].shouldKeepAspectRatio = true;
      slide.boxes[0].mediaInfo = {
        type: "video",
        background: "local-video-file://local-video",
        localVideoFile: {
          id: "local-video",
          ownerDeviceId: "device-1",
          ownerLabel: "Booth PC",
          fileName: "welcome.mov",
          contentType: "video/quicktime",
          storagePolicy: "local-only",
        },
      } as MediaType;

      render(
        <StaticSlideThumbnail
          slide={slide}
          itemType="song"
          previewMode={previewMode}
          monitorSettings={{
            ...resolveDisplaySettings(undefined, undefined, "monitor"),
            showBackground: true,
          }}
        />,
      );

      const backgroundThumbnails = [
        screen.queryByTestId("display-box-local-video-thumbnail"),
        screen.queryByTestId("static-local-video-thumbnail"),
      ].filter((thumbnail): thumbnail is HTMLElement => thumbnail !== null);
      expect(backgroundThumbnails).toHaveLength(
        previewMode === "stream" ? 0 : 1,
      );
      expect(
        backgroundThumbnails.map((thumbnail) => thumbnail.getAttribute("src")),
      ).toEqual(
        previewMode === "stream" ? [] : ["blob:local-video-thumbnail"],
      );
      expect(
        backgroundThumbnails.map((thumbnail) =>
          thumbnail.classList.contains("object-contain"),
        ),
      ).toEqual(previewMode === "stream" ? [] : [true]);
      expect(queryRenderedVideo()).toBeNull();
    },
  );

  it("shows the same local video still behind the Monitor next-slide bands", () => {
    const slide = makeSlide();
    slide.boxes[0].mediaInfo = {
      type: "video",
      background: "local-video-file://local-video",
      localVideoFile: {
        id: "local-video",
        ownerDeviceId: "device-1",
        ownerLabel: "Booth PC",
        fileName: "welcome.mov",
        contentType: "video/quicktime",
        storagePolicy: "local-only",
      },
    } as MediaType;

    render(
      <StaticSlideThumbnail
        slide={slide}
        nextSlide={makeSlide()}
        itemType="song"
        previewMode="monitor"
        monitorSettings={{
          ...resolveDisplaySettings(undefined, undefined, "monitor"),
          showBackground: true,
          showNextSlide: true,
        }}
      />,
    );

    expect(screen.getByTestId("monitor-band-video-thumbnail")).toHaveAttribute(
      "src",
      "blob:local-video-thumbnail",
    );
    expect(queryRenderedVideo()).toBeNull();
  });

  it.each(["projector", "stream", "monitor"] as const)(
    "uses the captured input still in %s previews without video playback",
    (previewMode) => {
      render(
        <StaticSlideThumbnail
          slide={makeSlide({
            mediaSource: {
              kind: "local-video-input",
              sourceId: "camera-1",
              label: "Main camera",
              fit: "cover",
            },
          })}
          itemType="song"
          previewMode={previewMode}
          localVideoInputThumbnailUrl="blob:camera-thumbnail"
        />,
      );

      expect(screen.getByTestId("static-video-input-thumbnail")).toHaveAttribute(
        "src",
        "blob:camera-thumbnail",
      );
      expect(screen.getByTestId("static-video-input-thumbnail")).toHaveClass(
        "object-cover",
      );
      expect(queryRenderedVideo()).toBeNull();
    },
  );

  it("keeps a capture still while marking a remote live source unavailable", () => {
    render(
      <StaticSlideThumbnail
        slide={makeSlide({
          mediaSource: {
            kind: "local-video-input",
            sourceId: "remote-camera-with-still",
            label: "Main camera",
            ownerDeviceId: "source-device",
            ownerLabel: "Booth PC",
          },
        })}
        itemType="song"
        previewMode="projector"
        localVideoInputThumbnailUrl="blob:camera-thumbnail"
      />,
    );

    expect(screen.getByTestId("static-video-input-thumbnail")).toHaveAttribute(
      "src",
      "blob:camera-thumbnail",
    );
    expect(screen.getByRole("status")).toHaveAttribute(
      "data-local-source-status-size",
      "indicator",
    );
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "Local source on another device · Video input · Main camera · Available on Booth PC",
    );
    expect(screen.getByRole("status")).toHaveAttribute(
      "data-local-source-status-size",
      "indicator",
    );
  });

  it("renders text and remote image stills without mounting DisplayWindow machinery", () => {
    render(
      <StaticSlideThumbnail
        slide={makeSlide()}
        itemType="song"
        previewMode="projector"
      />,
    );

    expect(screen.getByTestId("static-slide-thumbnail")).toHaveClass(
      "border-gray-500",
    );
    expect(screen.getByText("Hello worship")).toBeInTheDocument();
    expect(screen.getByAltText("")).toHaveAttribute(
      "src",
      "https://example.test/background.jpg",
    );
    expect(queryRenderedVideo()).toBeNull();
  });

  it.each([
    ["projector", "bg-black/90"],
    ["monitor", "bg-black/90"],
    ["stream", "bg-transparent"],
  ] as const)(
    "identifies a capture source from another device in %s thumbnails",
    (previewMode, expectedStatusBackground) => {
      const slide = makeSlide({
        mediaSource: {
          kind: "local-video-input",
          sourceId: `remote-${previewMode}`,
          label: "Main camera",
          ownerDeviceId: "source-device",
          ownerLabel: "Booth PC",
        },
      });

      render(
        <StaticSlideThumbnail
          slide={slide}
          itemType="song"
          previewMode={previewMode}
        />,
      );

      expect(screen.getByText("Local source on another device")).toBeInTheDocument();
      expect(screen.getByText("Available on Booth PC")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveClass(expectedStatusBackground);
      expect(screen.getByRole("status")).toHaveAttribute(
        "data-local-source-status-size",
        "thumbnail",
      );
      expect(queryRenderedVideo()).toBeNull();
    },
  );

  it.each([
    [false, "monitor-preview-single-slide-layout"],
    [true, "monitor-preview-next-slide-layout"],
  ] as const)(
    "shows unavailable local image status in the monitor %s layout",
    (useNextSlideLayout, expectedLayoutTestId) => {
      const slide = makeSlide({
        boxes: [
          {
            id: "background",
            width: 100,
            height: 100,
            background: "",
            words: "",
            mediaInfo: {
              id: "asset-2",
              type: "image",
              path: "",
              createdAt: "",
              updatedAt: "",
              format: "png",
              height: 1080,
              width: 1920,
              name: "Welcome",
              publicId: "welcome",
              background: "local-image://asset-2",
              thumbnail: "local-image://asset-2",
              localImage: {
                id: "asset-2",
                ownerDeviceId: "source-device",
                ownerLabel: "Booth PC",
                fileName: "Welcome.png",
                contentType: "image/png",
                storagePolicy: "local-only",
              },
            },
          },
          {
            id: "text",
            width: 80,
            height: 30,
            x: 10,
            y: 30,
            words: "Hello worship",
          },
        ],
      });
      const settings = {
        ...resolveDisplaySettings(undefined, undefined, "monitor"),
        showBackground: true,
        showNextSlide: useNextSlideLayout,
      };

      render(
        <StaticSlideThumbnail
          slide={slide}
          monitorSlide={slide}
          nextSlide={makeSlide()}
          itemType="song"
          previewMode="monitor"
          monitorSettings={settings}
          scaleFactor={0.2}
        />,
      );

      expect(screen.getByText("Local source on another device")).toBeInTheDocument();
      expect(screen.getByText("Local image · Welcome.png")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveAttribute(
        "data-local-source-status-size",
        "thumbnail",
      );
      expect(screen.getByTestId(expectedLayoutTestId)).toBeInTheDocument();
    },
  );

  it("matches display mode for video posters and keeps stream free text lightweight", () => {
    const videoSlide = makeSlide({
      boxes: [
        {
          id: "video",
          width: 100,
          height: 100,
          mediaInfo: {
            type: "video",
            path: "video.mp4",
            createdAt: "",
            updatedAt: "",
            format: "mp4",
            height: 1080,
            width: 1920,
            name: "video",
            publicId: "video",
            id: "video",
            thumbnail: "poster.jpg",
            background: "video.mp4",
            placeholderImage: "poster.jpg",
          } satisfies MediaType,
          words: "",
        },
      ],
    });
    const { rerender } = render(
      <StaticSlideThumbnail
        slide={videoSlide}
        itemType="song"
        previewMode="projector"
      />,
    );

    expect(screen.getByAltText("")).toHaveAttribute("src", "poster.jpg");
    rerender(
      <StaticSlideThumbnail
        slide={videoSlide}
        itemType="song"
        previewMode="stream"
      />,
    );
    expect(screen.queryByAltText("")).not.toBeInTheDocument();

    rerender(
      <StaticSlideThumbnail
        slide={makeSlide({
          formattedTextDisplayInfo: {
            text: "Welcome",
            backgroundColor: "#123456",
            textColor: "#ffffff",
            fontSize: 1.5,
            paddingX: 2,
            paddingY: 1,
            isBold: false,
            isItalic: false,
            align: "left",
          },
        })}
        itemType="free"
        previewMode="stream"
      />,
    );
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(queryRenderedVideo()).toBeNull();
  });

  it("uses the shared Bible stream formatting in static mode", () => {
    render(
      <StaticSlideThumbnail
        slide={makeSlide()}
        itemType="bible"
        previewMode="stream"
        bibleInfo={{ title: "John 3:16", text: "For God so loved the world" }}
      />,
    );

    expect(screen.getByText("John 3:16")).toHaveStyle({
      fontSize: `${1920 / 58}px`,
    });
    expect(screen.getByText("For God so loved the world")).toHaveStyle({
      fontSize: `${1920 / 55}px`,
    });
    expect(screen.queryByTestId("display-box")).not.toBeInTheDocument();
  });

  it("renders the configured static Monitor next-slide bands", () => {
    const currentSlide = makeSlide({
      monitorCurrentBandBoxes: [
        {
          id: "monitor-current",
          width: 100,
          height: 100,
          words: "Monitor current",
          monitorFontSizePx: 42,
        },
      ],
    });
    const nextSlide = makeSlide({
      id: "slide-2",
      monitorNextBandBoxes: [
        {
          id: "monitor-next",
          width: 100,
          height: 100,
          words: "Monitor next",
          monitorFontSizePx: 34,
        },
      ],
    });

    render(
      <StaticSlideThumbnail
        slide={currentSlide}
        monitorSlide={currentSlide}
        nextSlide={nextSlide}
        itemType="song"
        previewMode="monitor"
        monitorSettings={
          resolveDisplaySettings(
            {
              showNextSlide: true,
              showClock: false,
              showTimer: true,
              showBackground: true,
            },
            undefined,
            "monitor",
          )
        }
      />,
    );

    expect(screen.getByTestId("static-slide-thumbnail")).toHaveAttribute(
      "data-preview-mode",
      "monitor",
    );
    expect(
      screen.getByTestId("monitor-preview-next-slide-layout"),
    ).toBeInTheDocument();
    expect(screen.getByText("Monitor current")).toBeInTheDocument();
    expect(screen.getByText("Monitor next")).toBeInTheDocument();
    expect(screen.getByTestId("monitor-preview-timer")).toHaveTextContent("05:00");
    expect(queryRenderedVideo()).toBeNull();
  });

  it("uses the static single-slide Monitor layout when next-slide is off", () => {
    render(
      <StaticSlideThumbnail
        slide={makeSlide()}
        itemType="song"
        previewMode="monitor"
        monitorSettings={
          resolveDisplaySettings(
            { showNextSlide: false, showClock: true, showTimer: false },
            undefined,
            "monitor",
          )
        }
      />,
    );

    expect(
      screen.getByTestId("monitor-preview-single-slide-layout"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monitor-preview-clock")).toHaveTextContent(
      new Date(2000, 0, 1, 10, 30).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    );
    expect(screen.queryByTestId("monitor-preview-timer")).not.toBeInTheDocument();
  });

  it("uses the display local-image resource in static mode", () => {
    const localImageMedia = {
      path: "",
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
      format: "png",
      height: 1080,
      width: 1920,
      name: "Welcome.png",
      publicId: "asset-1",
      type: "image",
      id: "asset-1",
      background: "local-image://asset-1",
      thumbnail: "local-image://asset-1",
      source: "local",
      localImage: {
        id: "asset-1",
        contentRevision: "revision-1",
        ownerDeviceId: "device-1",
        ownerLabel: "Booth PC",
        fileName: "Welcome.png",
        contentType: "image/png",
        storagePolicy: "local-only",
      },
    } satisfies MediaType;
    const slide = makeSlide({
      boxes: [
        {
          id: "local-image",
          width: 100,
          height: 100,
          background: "local-image://asset-1",
          mediaInfo: localImageMedia,
          words: "",
        },
      ],
    });

    render(
      <StaticSlideThumbnail
        slide={slide}
        itemType="song"
        previewMode="projector"
      />,
    );

    expect(screen.getByAltText("")).toHaveAttribute("src", "blob:asset-1");
  });

  it("uses the active slide's geometry, dimming, and simple-font semantics", () => {
    const slide = makeSlide({
      boxes: [
        {
          id: "background",
          width: 100,
          height: 100,
          background: "https://example.test/background.jpg",
          words: "",
        },
        {
          id: "long-text",
          width: 80,
          height: 30,
          x: 10,
          y: 30,
          fontSize: 48,
          words: "Line one\nLine two\nLine three",
        },
      ],
    });
    render(
      <>
        <StaticSlideThumbnail
          slide={slide}
          itemType="song"
          previewMode="projector"
          scaleFactor={0.5}
        />
        <div data-testid="active-slide">
          <DisplayBox
            box={slide.boxes[0]}
            width={100}
            showBackground
            index={0}
            brightness={30}
            isSimpleFont
          />
          <DisplayBox
            box={slide.boxes[1]}
            width={100}
            showBackground
            index={1}
            isSimpleFont
          />
        </div>
      </>,
    );

    const staticBoxes = within(
      screen.getByTestId("static-slide-thumbnail"),
    ).getAllByTestId("display-box");
    const activeBoxes = within(screen.getByTestId("active-slide")).getAllByTestId(
      "display-box",
    );

    expect(screen.getByTestId("static-slide-reference-canvas")).toHaveStyle({
      width: "1920px",
      height: "1080px",
      transform: "translate(-50%, -50%) scale(0.5)",
    });
    expect(staticBoxes[0]).toHaveStyle({
      width: "1920px",
      height: "1080px",
      filter: "brightness(30%)",
    });
    expect(activeBoxes[0]).toHaveStyle({ filter: "brightness(30%)" });
    expect(staticBoxes[1]).toHaveStyle({
      width: "1536px",
      height: "324px",
      left: "192px",
      top: "324px",
      fontSize: "48px",
    });
    expect(activeBoxes[1]).toHaveStyle({
      width: "1536px",
      height: "324px",
      left: "192px",
      top: "324px",
    });
    expect(within(staticBoxes[1]).getByText(/Line one/)).not.toHaveStyle({
      textShadow: expect.any(String),
    });
    expect(within(activeBoxes[1]).getByText(/Line one/)).not.toHaveStyle({
      textShadow: expect.any(String),
    });
  });
});
