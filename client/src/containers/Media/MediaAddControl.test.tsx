import { render, screen } from "@testing-library/react";
import { MediaAddControl } from "./MediaAddControl";
import { getTransferOverview, useOptionalTransfers } from "../../context/transferContext";

jest.mock("../../context/transferContext", () => ({
  getTransferOverview: jest.fn(),
  useOptionalTransfers: jest.fn(),
}));

const mockGetTransferOverview = jest.mocked(getTransferOverview);
const mockUseOptionalTransfers = jest.mocked(useOptionalTransfers);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetTransferOverview.mockReturnValue({
    activeCount: 1,
    progress: 100,
    transfers: [{
      id: "canva-import",
      name: "Slides",
      type: "Canva",
      status: "Saving presentation slides",
      progress: 100,
    }],
  });
  mockUseOptionalTransfers.mockReturnValue({
    transfers: [],
    isMinimized: false,
    minimizeTransfers: jest.fn(),
    restoreTransfers: jest.fn(),
    updateUploadTransfer: jest.fn(),
    startCanvaTransfer: jest.fn(),
  });
});

it("keeps the transfer summary available while an active import finalizes at 100%", () => {
  render(
    <MediaAddControl uploadProgress={{ isUploading: false, progress: 0 }} uploadTitle="Upload">
      <button type="button">Add media</button>
    </MediaAddControl>,
  );

  expect(screen.getByRole("button", {
    name: "Show transfer summary: 1 active transfers, 100% overall",
  })).toBeInTheDocument();
});
