import { render, screen, within } from "@testing-library/react";
import type { ItemSlideType, MediaType } from "../../types";
import DisplayBox from "../../components/DisplayWindow/DisplayBox";
import StaticSlideThumbnail from "./StaticSlideThumbnail";

jest.mock("../../hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: (url?: string) => url,
  useResolvedCachedMediaUrl: (url?: string) => url,
}));
jest.mock("../../hooks/useLocalImageUrl", () => ({
  useLocalImageUrl: (reference?: { id?: string }) =>
    reference?.id === "asset-1"
      ? {
          isLocalImage: true,
          isOwner: true,
          status: "ready",
          url: "blob:asset-1",
        }
      : { isLocalImage: false, isOwner: false, status: "not-local" },
}));
jest.mock("../../hooks/useLocalVideoFileUrl", () => ({
  useLocalVideoFileUrl: () => ({ isLocalVideoFile: false, isOwner: false, status: "not-local" }),
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
  it("renders text and remote image stills without mounting DisplayWindow machinery", () => {
    render(
      <StaticSlideThumbnail
        slide={makeSlide()}
        itemType="song"
        isStreamFormat={false}
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
    expect(screen.queryByRole("video")).not.toBeInTheDocument();
  });

  it("uses a video poster or still and keeps stream free text lightweight", () => {
    const { rerender } = render(
      <StaticSlideThumbnail
        slide={makeSlide({
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
        itemType="song"
        isStreamFormat={false}
      />,
    );

    expect(screen.getByAltText("")).toHaveAttribute("src", "poster.jpg");
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
        isStreamFormat
      />,
    );
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.queryByRole("video")).not.toBeInTheDocument();
  });

  it("uses the shared Bible stream formatting in static mode", () => {
    render(
      <StaticSlideThumbnail
        slide={makeSlide()}
        itemType="bible"
        isStreamFormat
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
        isStreamFormat={false}
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
          isStreamFormat={false}
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
