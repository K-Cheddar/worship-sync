import { render, screen } from "@testing-library/react";
import LocalVideoInputSlideBadge from "./LocalVideoInputSlideBadge";

describe("LocalVideoInputSlideBadge", () => {
  it("renders an overlay with Video input and the source label", () => {
    render(<LocalVideoInputSlideBadge label="Booth camera" />);

    const badge = screen.getByTestId("local-video-input-slide-badge");
    expect(badge).toHaveAttribute("aria-label", "Video input: Booth camera");
    expect(badge).toHaveTextContent("Video input");
    expect(badge).toHaveTextContent("Booth camera");
  });

  it("labels a screen share distinctly from a camera input", () => {
    render(
      <LocalVideoInputSlideBadge
        label="Lyrics screen"
        captureKind="screen"
      />,
    );

    const badge = screen.getByTestId("local-video-input-slide-badge");
    expect(badge).toHaveAttribute("aria-label", "Screen share: Lyrics screen");
    expect(badge).toHaveTextContent("Screen share");
    expect(badge).toHaveTextContent("Lyrics screen");
  });

  it("renders a bottom banner for the editor preview", () => {
    render(
      <LocalVideoInputSlideBadge
        label="Lyrics screen"
        captureKind="screen"
        variant="banner"
        size="md"
      />,
    );

    expect(
      screen.getByLabelText("Screen share: Lyrics screen"),
    ).toHaveTextContent("Screen share: Lyrics screen");
  });

  it("falls back when the label is blank", () => {
    render(<LocalVideoInputSlideBadge label="   " captureKind="window" />);

    expect(
      screen.getByLabelText("Window share: Window share"),
    ).toBeInTheDocument();
  });
});
