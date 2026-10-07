import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MediaAddControl, ShowTransfersMenuItem } from "./MediaAddControl";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../../components/ui/DropdownMenu";
import { useOptionalTransfers } from "../../context/transferContext";

jest.mock("../../context/transferContext", () => ({
  useOptionalTransfers: jest.fn(),
}));

const mockUseOptionalTransfers = jest.mocked(useOptionalTransfers);

beforeEach(() => {
  jest.clearAllMocks();
  mockUseOptionalTransfers.mockReturnValue({
    transfers: [],
    isMinimized: false,
    minimizeTransfers: jest.fn(),
    restoreTransfers: jest.fn(),
    registerActivityHost: jest.fn(() => jest.fn()),
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
    registerActivityHost: jest.fn(() => jest.fn()),
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

  const activity = screen.getByRole("button", { name: "Show Activity · 1 active" });
  expect(activity).toHaveTextContent("Activity · 1 active");
  expect(activity).not.toHaveTextContent("%");
  expect(screen.getByTestId("activity-icon")).toHaveClass("lucide-loader-circle", "text-cyan-300", "animate-spin");
  expect(within(activity).getByText("Activity · 1 active")).toHaveClass("truncate", "@max-[240px]/sources-actions:hidden");
  await user.click(activity);
  expect(restore).toHaveBeenCalledTimes(1);
});

it("uses amber for Sources Activity when an operation needs attention", () => {
  mockUseOptionalTransfers.mockReturnValue({
    transfers: [{ id: "failed", name: "Cloud upload", type: "Media upload", status: "partial", progress: 50 } as never],
    isMinimized: false,
    minimizeTransfers: jest.fn(),
    restoreTransfers: jest.fn(),
    registerActivityHost: jest.fn(() => jest.fn()),
    updateTransfer: jest.fn(),
    removeTransfer: jest.fn(),
    registerTransferAction: jest.fn(),
    runTransferAction: jest.fn(),
    startCanvaTransfer: jest.fn(),
  });
  render(<MediaAddControl><button type="button">Add media</button></MediaAddControl>);
  expect(screen.getByRole("button", { name: "Show Activity · 1 needs attention" })).toBeInTheDocument();
  expect(screen.getByTestId("activity-icon")).toHaveClass("lucide-circle-alert", "text-amber-300");
});

it("uses a completion icon for finished work while retaining its accessible summary", () => {
  mockUseOptionalTransfers.mockReturnValue({
    transfers: [{ id: "complete", name: "Slides", type: "Canva", status: "complete", progress: 100 } as never],
    isMinimized: false,
    minimizeTransfers: jest.fn(),
    restoreTransfers: jest.fn(),
    registerActivityHost: jest.fn(() => jest.fn()),
    updateTransfer: jest.fn(),
    removeTransfer: jest.fn(),
    registerTransferAction: jest.fn(),
    runTransferAction: jest.fn(),
    startCanvaTransfer: jest.fn(),
  });
  render(<MediaAddControl><button type="button">Add media</button></MediaAddControl>);
  expect(screen.getByRole("button", { name: "Show Activity" })).toBeInTheDocument();
  expect(screen.getByTestId("activity-icon")).toHaveClass("lucide-circle-check", "text-gray-400");
});

it("shows an Activity menu item when the panel is minimized", async () => {
  mockUseOptionalTransfers.mockReturnValue({
    transfers: [{ id: "canva-import", name: "Slides", type: "Canva", status: "complete", progress: 100 } as never],
    isMinimized: true,
    minimizeTransfers: jest.fn(),
    restoreTransfers: jest.fn(),
    registerActivityHost: jest.fn(() => jest.fn()),
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
  expect(screen.getByTestId("activity-menu-icon")).toHaveClass("text-gray-400");
});
