import React from "react";
import { render, screen } from "@testing-library/react";
import DisplayWindow from "./DisplayWindow";
import { Box } from "../../types";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import presentationReducer from "../../store/presentationSlice";

const mockStore = configureStore({
  reducer: {
    presentation: presentationReducer,
  },
  preloadedState: {
    presentation: {
      isProjectorTransmitting: false,
      isMonitorTransmitting: false,
      isStreamTransmitting: false,
      prevProjectorInfo: {
        type: "",
        name: "",
        slide: null,
      },
      prevMonitorInfo: {
        type: "",
        name: "",
        slide: null,
      },
      prevStreamInfo: {
        type: "",
        name: "",
        slide: null,
      },
      projectorInfo: {
        type: "",
        name: "",
        slide: null,
      },
      monitorInfo: {
        type: "",
        name: "",
        slide: null,
      },
      streamInfo: {
        type: "",
        name: "",
        slide: null,
      },
    },
  },
});

describe("DisplayWindow", () => {
  const mockBoxes: Box[] = [
    {
      id: "test-slide",
      words: "Test words",
      width: 100,
      height: 100,
      x: 0,
      y: 0,
    },
  ];

  it("renders with basic boxes", () => {
    render(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={mockBoxes}
          prevBoxes={[]}
          width={1920}
          displayType="projector"
        />
      </Provider>
    );

    expect(screen.getByText("Test words")).toBeInTheDocument();
    expect(screen.getByTestId("display-window")).toBeInTheDocument();
  });

  it("handles bible display info", () => {
    render(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={[]}
          prevBoxes={[]}
          width={1920}
          displayType="stream"
          bibleDisplayInfo={{
            title: "John 3:16",
            text: "For God so loved the world...",
          }}
        />
      </Provider>
    );

    expect(screen.getByText("John 3:16")).toBeInTheDocument();
    expect(
      screen.getByText("For God so loved the world...")
    ).toBeInTheDocument();
  });

  it("handles participant overlay", () => {
    render(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={mockBoxes}
          prevBoxes={[]}
          width={1920}
          displayType="stream"
          participantOverlayInfo={{
            name: "Test Participant",
            type: "participant",
            id: "test-id",
          }}
        />
      </Provider>
    );

    expect(screen.getByText("Test Participant")).toBeInTheDocument();
    expect(screen.getByTestId("participant-overlay")).toBeInTheDocument();
  });

  it("handles STB overlay", () => {
    render(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={mockBoxes}
          prevBoxes={[]}
          width={1920}
          displayType="stream"
          stbOverlayInfo={{
            heading: "Test Heading",
            type: "stick-to-bottom",
            id: "test-id",
          }}
        />
      </Provider>
    );

    expect(screen.getByText("Test Heading")).toBeInTheDocument();
    expect(screen.getByTestId("stb-overlay")).toBeInTheDocument();
  });

  it("handles QR code overlay", () => {
    render(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={mockBoxes}
          prevBoxes={[]}
          width={1920}
          displayType="stream"
          qrCodeOverlayInfo={{
            url: "https://example.com",
            description: "Test QR Code",
            type: "qr-code",
            id: "test-id",
          }}
        />
      </Provider>
    );

    expect(screen.getByText("Test QR Code")).toBeInTheDocument();
    expect(screen.getByTestId("qr-code-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("qr-code")).toBeInTheDocument();
  });

  it("renders image overlay", () => {
    render(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={mockBoxes}
          prevBoxes={[]}
          width={1920}
          displayType="stream"
          imageOverlayInfo={{
            name: "Test Image",
            imageUrl: "https://example.com/image.jpg",
            type: "image",
            id: "test-id",
          }}
        />
      </Provider>
    );

    const container = screen.getByTestId("image-overlay");
    expect(container).toBeInTheDocument();

    const image = screen.getByTestId("image-overlay-image");
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute("src", "https://example.com/image.jpg");
    expect(image).toHaveAttribute("alt", "Test Image");
  });

  it("handles animation between slides", async () => {
    const { rerender } = render(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={mockBoxes}
          prevBoxes={[]}
          width={1920}
          displayType="projector"
          shouldAnimate
        />
      </Provider>
    );

    const textElement = screen.getByTestId("display-box-text-0");
    expect(textElement).toBeInTheDocument();
    expect(textElement).toHaveStyle({ opacity: "1" });

    rerender(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={[]}
          prevBoxes={mockBoxes}
          width={1920}
          displayType="projector"
          shouldAnimate
        />
      </Provider>
    );

    // Wait for animation to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(textElement).toHaveStyle({ opacity: "0" });
  });

  it("handles different display types", () => {
    const { rerender } = render(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={mockBoxes}
          prevBoxes={[]}
          width={1920}
          displayType="projector"
        />
      </Provider>
    );

    expect(screen.getByTestId("display-window")).toHaveClass("projector");

    rerender(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={mockBoxes}
          prevBoxes={[]}
          width={1920}
          displayType="monitor"
        />
      </Provider>
    );

    expect(screen.getByTestId("display-window")).toHaveClass("monitor");

    rerender(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={mockBoxes}
          prevBoxes={[]}
          width={1920}
          displayType="stream"
        />
      </Provider>
    );

    expect(screen.getByTestId("display-window")).toHaveClass("stream");
  });

  it("handles responsive width", () => {
    render(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={mockBoxes}
          prevBoxes={[]}
          width={100}
          displayType="projector"
        />
      </Provider>
    );

    const container = screen.getByTestId("display-window");
    expect(container).toHaveStyle({ width: "100%" });
  });

  it("handles video playback", () => {
    render(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={mockBoxes}
          prevBoxes={[]}
          width={1920}
          displayType="stream"
          imageOverlayInfo={{
            name: "Test Video",
            imageUrl: "https://example.com/video.mp4",
            type: "image",
            id: "test-id",
          }}
        />
      </Provider>
    );

    const container = screen.getByTestId("image-overlay");
    expect(container).toBeInTheDocument();

    const video = screen.getByTestId("image-overlay-video");
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute("autoPlay", "");
    expect(video).toHaveAttribute("loop", "");
    expect(video).toHaveAttribute("muted", "");
    expect(video).toHaveAttribute("src", "https://example.com/video.mp4");
  });

  it("handles wake lock API", () => {
    const mockWakeLock = {
      request: jest.fn().mockResolvedValue({
        release: jest.fn(),
      }),
    };

    // @ts-ignore
    navigator.wakeLock = mockWakeLock;

    render(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={mockBoxes}
          prevBoxes={[]}
          width={1920}
          displayType="projector"
        />
      </Provider>
    );

    expect(navigator.wakeLock.request).toHaveBeenCalled();
  });

  it("handles error states gracefully", () => {
    render(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={[]}
          prevBoxes={[]}
          width={1920}
          displayType="projector"
        />
      </Provider>
    );

    expect(screen.getByTestId("display-window")).toBeInTheDocument();
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });

  it("handles box styling", () => {
    const styledBoxes: Box[] = [
      {
        id: "styled-box",
        words: "Styled Text",
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        fontSize: 24,
        fontColor: "#ff0000",
        background: "#000000",
        align: "center" as const,
        brightness: 80,
      },
    ];

    render(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={styledBoxes}
          prevBoxes={[]}
          width={1920}
          displayType="projector"
        />
      </Provider>
    );

    const box = screen.getByTestId("display-box-0");
    expect(box).toHaveStyle({
      width: "calc(100% - 0%)",
      height: "calc(100% - (1920vw * (0 + 0) / 100))",
      fontSize: "24vw",
      color: "#ff0000",
      textAlign: "center",
    });
  });

  it("handles box positioning", () => {
    const positionedBoxes: Box[] = [
      {
        id: "positioned-box",
        words: "Positioned Text",
        width: 100,
        height: 100,
        x: 50,
        y: 50,
      },
    ];

    render(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={positionedBoxes}
          prevBoxes={[]}
          width={1920}
          displayType="projector"
        />
      </Provider>
    );

    const box = screen.getByTestId("display-box-0");
    expect(box).toHaveStyle({
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
    });
  });

  it("handles box aspect ratio", () => {
    const aspectRatioBoxes: Box[] = [
      {
        id: "aspect-ratio-box",
        words: "Aspect Ratio Text",
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        shouldKeepAspectRatio: true,
      },
    ];

    render(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={aspectRatioBoxes}
          prevBoxes={[]}
          width={1920}
          displayType="projector"
        />
      </Provider>
    );

    const box = screen.getByTestId("display-box-0");
    expect(box).toHaveStyle({
      width: "calc(100% - 0%)",
      height: "calc(100% - (1920vw * (0 + 0) / 100))",
    });

    const background = screen.getByTestId("display-box-background-0");
    expect(background).toHaveClass("object-contain");
  });
});
