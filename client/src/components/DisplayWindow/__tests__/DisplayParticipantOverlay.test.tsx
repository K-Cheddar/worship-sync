import { render, screen } from "@testing-library/react";
import DisplayParticipantOverlay from "../DisplayParticipantOverlay";

jest.mock("../../../utils/generalUtils", () => ({
  checkMediaType: jest.fn(() => "image"),
  getImageFromVideoUrl: jest.fn((url: string) => url),
}));

const defaultParticipantInfo = {
  id: "p1",
  type: "participant" as const,
  name: "Test Name",
  title: "Test Title",
  formatting: {},
};

describe("DisplayParticipantOverlay", () => {
  describe("shouldFillContainer", () => {
    it("renders only one overlay (current) when shouldFillContainer is true", () => {
      const { container } = render(
        <div style={{ position: "relative", width: 400, height: 300 }}>
          <DisplayParticipantOverlay
            width={25}
            participantOverlayInfo={defaultParticipantInfo}
            prevParticipantOverlayInfo={{}}
            shouldFillContainer
          />
        </div>
      );
      const overlayDivs = container.querySelectorAll(".absolute.overflow-hidden");
      expect(overlayDivs.length).toBe(1);
      expect(screen.getByText("Test Name")).toBeInTheDocument();
      expect(screen.getByText("Test Title")).toBeInTheDocument();
    });

    it("renders current and prev overlay when shouldFillContainer is false", () => {
      const { container } = render(
        <div style={{ position: "relative", width: 400, height: 300 }}>
          <DisplayParticipantOverlay
            width={25}
            participantOverlayInfo={defaultParticipantInfo}
            prevParticipantOverlayInfo={{}}
            shouldFillContainer={false}
          />
        </div>
      );
      const overlayDivs = container.querySelectorAll(".absolute.overflow-hidden");
      expect(overlayDivs.length).toBe(2);
    });
  });
});
