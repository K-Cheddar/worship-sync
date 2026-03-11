import { render, screen } from "@testing-library/react";
import SharedOverlay from "../SharedOverlay";
import {
  defaultImageOverlayStyles,
  defaultParticipantOverlayStyles,
  defaultQrCodeOverlayStyles,
} from "../defaultOverlayStyles";
import { checkMediaType, getImageFromVideoUrl } from "../../../utils/generalUtils";
import { useCachedVideoUrl } from "../../../hooks/useCachedMediaUrl";

jest.mock("../../../utils/generalUtils", () => ({
  checkMediaType: jest.fn(() => "image"),
  getImageFromVideoUrl: jest.fn((url: string) => url),
}));

jest.mock("../../../hooks/useCachedMediaUrl", () => ({
  useCachedVideoUrl: jest.fn((url?: string) => url),
}));

jest.mock("../HLSVideoPlayer", () => ({
  __esModule: true,
  default: ({ src, originalSrc }: { src: string; originalSrc: string }) => (
    <div data-testid="hls-player" data-src={src} data-original-src={originalSrc} />
  ),
}));

const defaultProps = {
  width: 25,
  styles: defaultParticipantOverlayStyles,
  overlayInfo: { name: "Jane", title: "Speaker", type: "participant" as const },
  needsPadding: true,
  overlayType: "participant" as const,
};

describe("SharedOverlay", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    (checkMediaType as jest.Mock).mockImplementation(() => "image");
    (getImageFromVideoUrl as jest.Mock).mockImplementation((url: string) => url);
    (useCachedVideoUrl as jest.Mock).mockImplementation((url?: string) => url);
  });

  describe("shouldFillContainer", () => {
    it("applies fill container styles when shouldFillContainer is true", () => {
      render(<SharedOverlay {...defaultProps} shouldFillContainer />);
      const overlayDiv = screen.getByTestId("shared-overlay");
      expect(overlayDiv).toBeInTheDocument();
      expect(overlayDiv.style.inset).toMatch(/^0(px)?$/);
      expect(overlayDiv.style.width).toBe("100%");
      expect(overlayDiv.style.height).toBe("100%");
      expect(overlayDiv.style.maxWidth).toBe("none");
      expect(overlayDiv.style.minWidth).toBe("100%");
    });

    it("does not apply fill container styles when shouldFillContainer is false", () => {
      render(<SharedOverlay {...defaultProps} shouldFillContainer={false} />);
      const overlayDiv = screen.getByTestId("shared-overlay");
      expect(overlayDiv.style.inset).toBe("");
      expect(overlayDiv.style.width).not.toBe("100%");
      expect(overlayDiv.style.minWidth).not.toBe("100%");
    });

    it("does not apply fill container styles when shouldFillContainer is omitted", () => {
      render(<SharedOverlay {...defaultProps} />);
      const overlayDiv = screen.getByTestId("shared-overlay");
      expect(overlayDiv.style.inset).toBe("");
    });

    it("renders overlay content when shouldFillContainer is true", () => {
      render(<SharedOverlay {...defaultProps} shouldFillContainer />);
      expect(screen.getByText("Jane")).toBeInTheDocument();
      expect(screen.getByText("Speaker")).toBeInTheDocument();
    });
  });

  it("applies participant center and right position overrides", () => {
    const { rerender } = render(
      <SharedOverlay
        {...defaultProps}
        styles={{ ...defaultParticipantOverlayStyles, participantOverlayPosition: "center" }}
      />,
    );
    const center = screen.getByTestId("shared-overlay");
    expect(center.style.left).toBe("50%");
    expect(center.style.transform).toBe("translateX(-50%)");

    rerender(
      <SharedOverlay
        {...defaultProps}
        styles={{
          ...defaultParticipantOverlayStyles,
          participantOverlayPosition: "right",
          right: 7,
        }}
      />,
    );
    const right = screen.getByTestId("shared-overlay");
    expect(right.style.right).toBe("7%");
  });

  it("renders qr code and description for qr overlay", () => {
    render(
      <SharedOverlay
        width={25}
        styles={defaultQrCodeOverlayStyles}
        overlayInfo={{
          id: "q1",
          type: "qr-code",
          url: "https://example.com",
          description: "Scan this code",
        }}
        needsPadding
        overlayType="qr-code"
      />,
    );

    expect(screen.getByText("Scan this code")).toBeInTheDocument();
    expect(screen.getByTestId("overlay-qr-code")).toBeInTheDocument();
  });

  it("checks cached video path for image overlay video urls", () => {
    (checkMediaType as jest.Mock).mockReturnValue("video");

    render(
      <SharedOverlay
        width={25}
        styles={defaultImageOverlayStyles}
        overlayInfo={{
          id: "img1",
          type: "image",
          name: "Video Overlay",
          imageUrl: "https://cdn.example.com/video.mp4",
        }}
        needsPadding
        overlayType="image"
      />,
    );

    expect(useCachedVideoUrl).toHaveBeenCalledWith(
      "https://cdn.example.com/video.mp4",
    );
    expect(screen.getByTestId("hls-player")).toBeInTheDocument();
  });

  it("renders fallback image for video url when cached url is unavailable", () => {
    (checkMediaType as jest.Mock).mockReturnValue("video");
    (useCachedVideoUrl as jest.Mock).mockReturnValue(undefined);
    (getImageFromVideoUrl as jest.Mock).mockReturnValue("https://cdn.example.com/poster.jpg");

    render(
      <SharedOverlay
        width={25}
        styles={defaultImageOverlayStyles}
        overlayInfo={{
          id: "img2",
          type: "image",
          name: "Video Poster",
          imageUrl: "https://cdn.example.com/video.mp4",
        }}
        needsPadding
        overlayType="image"
      />,
    );

    const image = screen.getByAltText("Video Poster") as HTMLImageElement;
    expect(image).toBeInTheDocument();
    expect(image.src).toContain("https://cdn.example.com/poster.jpg");
  });
});
