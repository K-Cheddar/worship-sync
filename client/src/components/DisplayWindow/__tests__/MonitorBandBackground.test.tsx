import { render, screen } from "@testing-library/react";
import type { Box } from "../../../types";
import type { LocalImageResolution } from "../../../hooks/useLocalImageUrl";
import type { LocalVideoFileResolution } from "../../../hooks/useLocalVideoFileUrl";
import MonitorBandBackground from "../MonitorBandBackground";

const mockNotLocalImageResolution: LocalImageResolution = {
  isLocalImage: false,
  isOwner: false,
  status: "not-local",
};
const unavailableLocalVideoResolution: LocalVideoFileResolution = {
  isLocalVideoFile: true,
  isOwner: false,
  status: "unavailable",
};
let mockLocalVideoResolution = unavailableLocalVideoResolution;
let mockLocalVideoThumbnailResolution = unavailableLocalVideoResolution;
const mockUseCachedMediaUrl = jest.fn((url?: string) => url);

jest.mock("../../../hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: (url?: string) => mockUseCachedMediaUrl(url),
}));
jest.mock("../../../hooks/useLocalImageUrl", () => ({
  useLocalImageUrl: () => mockNotLocalImageResolution,
}));
jest.mock("../../../hooks/useLocalVideoFileUrl", () => ({
  useLocalVideoFileUrl: (_value: unknown, purpose?: string) =>
    purpose === "thumbnail"
      ? mockLocalVideoThumbnailResolution
      : mockLocalVideoResolution,
  isUnavailableLocalVideoFile: (resolution: LocalVideoFileResolution) =>
    resolution.isLocalVideoFile && resolution.status === "unavailable",
}));

const localVideoBox: Box = {
  id: "local-video-box",
  words: "",
  width: 100,
  height: 100,
  background: "local-video-file://video-1",
  mediaInfo: {
    id: "video-1",
    name: "Service video",
    type: "video",
    background: "local-video-file://video-1",
    placeholderImage: "https://cdn.example.com/service-video-still.jpg",
    localVideoFile: {
      id: "video-1",
      ownerDeviceId: "video-owner-device",
      ownerLabel: "Booth PC",
      fileName: "Service.mp4",
      contentType: "video/mp4",
      storagePolicy: "local-only",
    },
  } as NonNullable<Box["mediaInfo"]>,
};

describe("MonitorBandBackground", () => {
  beforeEach(() => {
    mockLocalVideoResolution = unavailableLocalVideoResolution;
    mockLocalVideoThumbnailResolution = unavailableLocalVideoResolution;
    mockUseCachedMediaUrl.mockClear();
  });

  it("leaves a physical monitor's unavailable local video background black", () => {
    const { container } = render(<MonitorBandBackground box={localVideoBox} />);

    expect(container).toBeEmptyDOMElement();
    expect(mockUseCachedMediaUrl).toHaveBeenCalledWith(undefined);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the shared unavailable-source status in a live controller preview", () => {
    render(
      <MonitorBandBackground
        box={localVideoBox}
        showLocalSourceStatus
      />,
    );

    expect(screen.queryByTestId("monitor-band-background")).not.toBeInTheDocument();
    expect(screen.getByText("Local video unavailable on this device")).toBeInTheDocument();
    expect(screen.getByText("Local video · Service.mp4")).toBeInTheDocument();
    expect(screen.getByText("Source is local to another device")).toBeInTheDocument();
  });

  it("keeps saved still imagery in compact monitor thumbnails", () => {
    render(
      <MonitorBandBackground
        box={localVideoBox}
        showLocalSourceStatus
        statusSize="thumbnail"
      />,
    );

    expect(screen.getByTestId("monitor-band-background")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
