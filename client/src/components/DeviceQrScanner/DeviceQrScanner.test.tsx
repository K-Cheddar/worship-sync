import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeviceQrScanner } from "./DeviceQrScanner";

describe("DeviceQrScanner", () => {
  beforeEach(() => {
    jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows the active scanning status without a restart action when healthy", async () => {
    const track = { stop: jest.fn() };
    const onClose = jest.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [track] }) },
    });
    jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    render(<DeviceQrScanner onAccepted={jest.fn()} onClose={onClose} />);

    expect(await screen.findByText("Scanning for a WorshipSync QR code…")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Restart camera" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("mounts the video element before the camera becomes ready", () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: jest.fn(() => new Promise(() => undefined)) },
    });
    render(<DeviceQrScanner onAccepted={jest.fn()} onClose={jest.fn()} />);

    expect(screen.getByLabelText("Device QR scanner camera")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Opening camera");
  });

  it("shows recovery controls when camera access is denied and retries", async () => {
    const getUserMedia = jest
      .fn()
      .mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"))
      .mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    render(<DeviceQrScanner onAccepted={jest.fn()} onClose={jest.fn()} />);

    const restartButton = await screen.findByRole("button", { name: "Restart camera" });
    fireEvent.click(restartButton);

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("does not render paste-link controls and Cancel closes the scanner", () => {
    const onClose = jest.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    render(<DeviceQrScanner onAccepted={jest.fn()} onClose={onClose} />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open link" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
