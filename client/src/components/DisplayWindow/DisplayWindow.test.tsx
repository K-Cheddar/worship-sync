import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
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
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "https://example.com"
    );
  });

  it("handles image overlay", () => {
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

    const image = screen.getByRole("img");
    expect(image).toHaveAttribute("src", "https://example.com/image.jpg");
    expect(image).toHaveAttribute("alt", "Test Image");
    expect(screen.getByTestId("image-overlay")).toBeInTheDocument();
  });

  it("handles animation between slides", () => {
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

    expect(screen.getByText("Test words")).toBeInTheDocument();
    expect(screen.getByTestId("display-window")).toHaveClass("animate");

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

    expect(screen.queryByText("Test words")).not.toBeInTheDocument();
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
          displayType="projector"
          shouldPlayVideo
        />
      </Provider>
    );

    const video = screen.getByTestId("video-player");
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute("autoplay");
  });

  it("handles wake lock API", () => {
    const mockWakeLock = {
      request: jest.fn().mockResolvedValue({}),
      release: jest.fn(),
    };
    Object.defineProperty(navigator, "wakeLock", {
      value: mockWakeLock,
      configurable: true,
    });

    render(
      <Provider store={mockStore}>
        <DisplayWindow
          boxes={mockBoxes}
          prevBoxes={[]}
          width={1920}
          displayType="stream"
        />
      </Provider>
    );

    expect(mockWakeLock.request).toHaveBeenCalledWith("screen");
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
        align: "center",
        brightness: 0.8,
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

    const box = screen.getByText("Styled Text");
    expect(box).toHaveStyle({
      fontSize: "24px",
      color: "#ff0000",
      backgroundColor: "#000000",
      textAlign: "center",
      opacity: "0.8",
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

    const box = screen.getByText("Positioned Text");
    expect(box).toHaveStyle({
      position: "absolute",
      left: "50px",
      top: "50px",
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

    const box = screen.getByText("Aspect Ratio Text");
    expect(box).toHaveStyle({
      aspectRatio: "1",
    });
  });
});
