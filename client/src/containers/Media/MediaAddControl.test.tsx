import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      status: "active",
      progress: 100,
      phase: { key: "saving", label: "Saving presentation slides" },
    }],
  });
  mockUseOptionalTransfers.mockReturnValue({
    transfers: [],
    isMinimized: false,
    minimizeTransfers: jest.fn(),
    restoreTransfers: jest.fn(),
    updateTransfer: jest.fn(),
    removeTransfer: jest.fn(),
    runTransferAction: jest.fn(),
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

it("labels unknown aggregate progress without exposing null percent text", async () => {
  const user = userEvent.setup();
  mockGetTransferOverview.mockReturnValue({
    activeCount: 1,
    progress: null,
    transfers: [{
      id: "canva-import",
      name: "Slides",
      type: "Canva",
      status: "active",
      progress: null,
      phase: { key: "saving", label: "Saving presentation slides" },
    }],
  });
  render(
    <MediaAddControl uploadProgress={{ isUploading: false, progress: 0 }} uploadTitle="Upload">
      <button type="button">Add media</button>
    </MediaAddControl>,
  );

  const trigger = screen.getByRole("button", {
    name: "Show transfer summary: 1 active transfers, progress unknown",
  });
  expect(trigger).toHaveTextContent("Working…");
  expect(screen.queryByText(/null%/i)).not.toBeInTheDocument();
  expect(trigger).not.toHaveAttribute("aria-label", expect.stringContaining("null%"));
  await user.click(trigger);
  expect(screen.getByRole("heading", { name: "Transfers · 1 active · Working…" })).toBeInTheDocument();
  expect(screen.queryByText(/null%/i)).not.toBeInTheDocument();
});
