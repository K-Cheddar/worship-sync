import { render, screen } from "@testing-library/react";
import SharedOverlay from "../SharedOverlay";
import { defaultParticipantOverlayStyles } from "../defaultOverlayStyles";

jest.mock("../../../utils/generalUtils", () => ({
  checkMediaType: jest.fn(() => "image"),
  getImageFromVideoUrl: jest.fn((url: string) => url),
}));

const defaultProps = {
  width: 25,
  styles: defaultParticipantOverlayStyles,
  overlayInfo: { name: "Jane", title: "Speaker", type: "participant" as const },
  needsPadding: true,
  overlayType: "participant" as const,
};

describe("SharedOverlay", () => {
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
});
