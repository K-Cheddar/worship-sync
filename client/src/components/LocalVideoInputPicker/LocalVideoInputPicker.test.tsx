import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { isElectron } from "../../utils/environment";
import LocalVideoInputPicker from "./LocalVideoInputPicker";

const mockIsElectron = jest.mocked(isElectron);

const createDevice = (
  kind: MediaDeviceKind,
  deviceId: string,
  label: string,
): MediaDeviceInfo => ({
  deviceId,
  groupId: "group-1",
  kind,
  label,
  toJSON: () => ({}),
});

describe("LocalVideoInputPicker", () => {
  const enumerateDevices = jest.fn<Promise<MediaDeviceInfo[]>, []>();
  const getUserMedia = jest.fn<
    Promise<MediaStream>,
    [MediaStreamConstraints]
  >();
  let deviceChangeListener: EventListener | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsElectron.mockReturnValue(false);
    deviceChangeListener = undefined;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices,
        getUserMedia,
        addEventListener: jest.fn((type: string, listener: EventListener) => {
          if (type === "devicechange") deviceChangeListener = listener;
        }),
        removeEventListener: jest.fn(
          (type: string, listener: EventListener) => {
            if (type === "devicechange" && deviceChangeListener === listener) {
              deviceChangeListener = undefined;
            }
          },
        ),
      },
    });
  });

  const openPicker = () => {
    render(<LocalVideoInputPicker onLinked={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add video input" }));
  };

  it("does not show browser permission or refresh controls in Electron", async () => {
    mockIsElectron.mockReturnValue(true);
    enumerateDevices.mockResolvedValue([
      createDevice("videoinput", "camera-1", "OBS Camera"),
    ]);

    openPicker();

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: "Allow input access" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Refresh" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });

  it("shows input access only for a browser whose device labels are hidden", async () => {
    enumerateDevices.mockResolvedValue([
      createDevice("videoinput", "camera-1", ""),
    ]);

    openPicker();

    expect(
      await screen.findByRole("button", { name: "Allow input access" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Refresh" }),
    ).not.toBeInTheDocument();
  });

  it("hides input access after the browser exposes labeled devices", async () => {
    enumerateDevices.mockResolvedValue([
      createDevice("videoinput", "camera-1", "USB Capture"),
    ]);

    openPicker();

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: "Allow input access" }),
    ).not.toBeInTheDocument();
  });

  it("configures a Media input with sound and frame fit", async () => {
    enumerateDevices.mockResolvedValue([
      createDevice("videoinput", "camera-1", "USB Capture"),
      createDevice("audioinput", "audio-1", "USB Audio"),
    ]);

    openPicker();

    expect(
      await screen.findByRole("button", { name: "Add to Media" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });

  it("requests browser permission once and then refreshes the labeled devices", async () => {
    const stopVideo = jest.fn();
    const stopAudio = jest.fn();
    enumerateDevices
      .mockResolvedValueOnce([createDevice("videoinput", "camera-1", "")])
      .mockResolvedValueOnce([
        createDevice("videoinput", "camera-1", "USB Capture"),
      ]);
    getUserMedia
      .mockResolvedValueOnce({
        getTracks: () => [{ stop: stopVideo }],
      } as unknown as MediaStream)
      .mockResolvedValueOnce({
        getTracks: () => [{ stop: stopAudio }],
      } as unknown as MediaStream);

    openPicker();
    fireEvent.click(
      await screen.findByRole("button", { name: "Allow input access" }),
    );

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(2));
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: false,
      video: true,
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: true,
      video: false,
    });
    expect(stopVideo).toHaveBeenCalledTimes(1);
    expect(stopAudio).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Allow input access" }),
    ).not.toBeInTheDocument();
  });

  it("automatically re-enumerates inputs when USB devices change", async () => {
    mockIsElectron.mockReturnValue(true);
    enumerateDevices
      .mockResolvedValueOnce([
        createDevice("videoinput", "camera-1", "First Camera"),
      ])
      .mockResolvedValueOnce([
        createDevice("videoinput", "camera-2", "Replacement Camera"),
      ]);

    openPicker();
    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(1));

    await act(async () => {
      deviceChangeListener?.(new Event("devicechange"));
      await Promise.resolve();
    });

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Refresh" }),
    ).not.toBeInTheDocument();
  });

  it("offers a retry when Electron cannot find a video input", async () => {
    mockIsElectron.mockReturnValue(true);
    enumerateDevices.mockResolvedValue([]);

    openPicker();

    const retry = await screen.findByRole("button", { name: "Try again" });
    fireEvent.click(retry);

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Allow input access" }),
    ).not.toBeInTheDocument();
  });
});
