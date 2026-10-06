import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MediaAddControl, ShowTransfersMenuItem } from "./MediaAddControl";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../../components/ui/DropdownMenu";
import { getTransferOverview, useOptionalTransfers } from "../../context/transferContext";

jest.mock("../../context/transferContext", () => ({
  getTransferOverview: jest.fn(),
  useOptionalTransfers: jest.fn(),
}));

const mockUseOptionalTransfers = jest.mocked(useOptionalTransfers);
const mockGetTransferOverview = jest.mocked(getTransferOverview);

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
    registerTransferAction: jest.fn(),
    runTransferAction: jest.fn(),
    startCanvaTransfer: jest.fn(),
  });
});

it("opens Activity without showing a global percentage", async () => {
  const user = userEvent.setup();
  const restore = jest.fn();
  mockUseOptionalTransfers.mockReturnValue({
    ...(mockUseOptionalTransfers.getMockImplementation?.() ? {} : {}),
    transfers: [{ id: "canva-import", name: "Slides", type: "Canva", status: "active", progress: 100 } as never],
    isMinimized: false,
    minimizeTransfers: jest.fn(),
    restoreTransfers: restore,
    updateTransfer: jest.fn(),
    removeTransfer: jest.fn(),
    registerTransferAction: jest.fn(),
    runTransferAction: jest.fn(),
    startCanvaTransfer: jest.fn(),
  });
  render(
    <MediaAddControl>
      <button type="button">Add media</button>
    </MediaAddControl>,
  );

  const activity = screen.getByRole("button", { name: "Show Activity: 1 active" });
  expect(activity).toHaveTextContent("Activity · 1 active");
  expect(activity).not.toHaveTextContent("%");
  await user.click(activity);
  expect(restore).toHaveBeenCalledTimes(1);
});

it("shows an Activity menu item when the panel is minimized", async () => {
  mockUseOptionalTransfers.mockReturnValue({
    transfers: [{ id: "canva-import", name: "Slides", type: "Canva", status: "complete", progress: 100 } as never],
    isMinimized: true,
    minimizeTransfers: jest.fn(),
    restoreTransfers: jest.fn(),
    updateTransfer: jest.fn(),
    removeTransfer: jest.fn(),
    registerTransferAction: jest.fn(),
    runTransferAction: jest.fn(),
    startCanvaTransfer: jest.fn(),
  });
  const user = userEvent.setup();
  render(<DropdownMenu><DropdownMenuTrigger>Open menu</DropdownMenuTrigger><DropdownMenuContent><ShowTransfersMenuItem /></DropdownMenuContent></DropdownMenu>);
  await user.click(screen.getByRole("button", { name: "Open menu" }));
  expect(await screen.findByText("Show Activity")).toBeInTheDocument();
});
