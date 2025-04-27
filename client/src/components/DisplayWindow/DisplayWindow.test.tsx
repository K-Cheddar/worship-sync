import React from "react";
import { render, screen } from "@testing-library/react";
import DisplayWindow from "./DisplayWindow";
import { Box } from "../../types";

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
      <DisplayWindow
        boxes={mockBoxes}
        prevBoxes={[]}
        width={1920}
        displayType="projector"
      />
    );

    expect(screen.getByText("Test words")).toBeInTheDocument();
  });

  it("handles bible display info", () => {
    render(
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
    );

    expect(screen.getByText("John 3:16")).toBeInTheDocument();
    expect(
      screen.getByText("For God so loved the world...")
    ).toBeInTheDocument();
  });

  it("handles participant overlay", () => {
    render(
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
    );

    expect(screen.getByText("Test Participant")).toBeInTheDocument();
  });

  it("handles STB overlay", () => {
    render(
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
    );

    expect(screen.getByText("Test Heading")).toBeInTheDocument();
  });

  it("handles QR code overlay", () => {
    render(
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
    );

    expect(screen.getByText("Test QR Code")).toBeInTheDocument();
  });

  it("handles image overlay", () => {
    render(
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
    );

    const image = screen.getByRole("img");
    expect(image).toHaveAttribute("src", "https://example.com/image.jpg");
    expect(image).toHaveAttribute("alt", "Test Image");
  });

  it("handles animation between slides", () => {
    const { rerender } = render(
      <DisplayWindow
        boxes={mockBoxes}
        prevBoxes={[]}
        width={1920}
        displayType="projector"
        shouldAnimate
      />
    );

    expect(screen.getByText("Test words")).toBeInTheDocument();

    rerender(
      <DisplayWindow
        boxes={[]}
        prevBoxes={mockBoxes}
        width={1920}
        displayType="projector"
        shouldAnimate
      />
    );

    expect(screen.queryByText("Test words")).not.toBeInTheDocument();
  });

  it("handles different display types", () => {
    const { rerender } = render(
      <DisplayWindow
        boxes={mockBoxes}
        prevBoxes={[]}
        width={1920}
        displayType="projector"
      />
    );

    expect(screen.getByText("Test words")).toBeInTheDocument();

    rerender(
      <DisplayWindow
        boxes={mockBoxes}
        prevBoxes={[]}
        width={1920}
        displayType="monitor"
      />
    );

    expect(screen.getByText("Test words")).toBeInTheDocument();

    rerender(
      <DisplayWindow
        boxes={mockBoxes}
        prevBoxes={[]}
        width={1920}
        displayType="stream"
      />
    );

    expect(screen.getByText("Test words")).toBeInTheDocument();
  });

  it("handles responsive width", () => {
    render(
      <DisplayWindow
        boxes={mockBoxes}
        prevBoxes={[]}
        width={100}
        displayType="projector"
      />
    );

    const container = screen.getByTestId("display-window");
    expect(container).toHaveStyle({ width: "100%" });
  });

  it("handles video playback", () => {
    render(
      <DisplayWindow
        boxes={mockBoxes}
        prevBoxes={[]}
        width={1920}
        displayType="projector"
        shouldPlayVideo
      />
    );

    // Add video playback tests here
    // Note: This is a placeholder as we need to add video test cases
  });
});
