import { fireEvent, render, screen } from "@testing-library/react";
import MediaLibraryGridMediaTile from "./MediaLibraryGridMediaTile";
import type { MediaType } from "../../types";
import { useLocalImageUrl } from "../../hooks/useLocalImageUrl";
import { useLocalVideoFileUrl } from "../../hooks/useLocalVideoFileUrl";

jest.mock("../../hooks/useLocalImageUrl", () => ({
  useLocalImageUrl: jest.fn(() => ({
    isLocalImage: false,
    isOwner: false,
    status: "not-local",
  })),
}));

jest.mock("../../hooks/useLocalVideoFileUrl", () => ({
  useLocalVideoFileUrl: jest.fn(() => ({
    isLocalVideoFile: false,
    isOwner: false,
    status: "not-local",
  })),
}));

jest.mock("../../hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: (src?: string) => src,
}));

const mockUseLocalImageUrl = jest.mocked(useLocalImageUrl);
const mockUseLocalVideoFileUrl = jest.mocked(useLocalVideoFileUrl);

const localVideo: MediaType = {
  path: "",
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
  format: "mp4",
  height: 1080,
  width: 1920,
  name: "Welcome.mp4",
  publicId: "video-1",
  type: "video",
  id: "video-1",
  background: "local-video-file://video-1",
  thumbnail: "",
  source: "local",
  localVideoFile: {
    id: "video-1",
    ownerDeviceId: "device-1",
    ownerLabel: "Booth PC",
    fileName: "Welcome.mp4",
    contentType: "video/mp4",
    storagePolicy: "local-only",
  },
};

describe("MediaLibraryGridMediaTile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalImageUrl.mockReturnValue({
      isLocalImage: false,
      isOwner: false,
      status: "not-local",
    });
    mockUseLocalVideoFileUrl.mockReturnValue({
      isLocalVideoFile: false,
      isOwner: false,
      status: "not-local",
    });
  });

  it("shows a Film icon until a local video still is ready", () => {
    mockUseLocalVideoFileUrl.mockReturnValue({
      isLocalVideoFile: true,
      isOwner: true,
      status: "loading",
    });

    render(
      <MediaLibraryGridMediaTile
        mediaItem={localVideo}
        index={0}
        isSelected={false}
        isMultiSelected={false}
        mediaMultiSelectMode={false}
        onMediaTileClick={jest.fn()}
        onEnterMediaMultiSelectMode={jest.fn()}
      />,
    );

    expect(mockUseLocalVideoFileUrl).toHaveBeenCalledWith(
      localVideo.localVideoFile,
      "thumbnail",
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows the saved local video still in the media grid", () => {
    mockUseLocalVideoFileUrl.mockReturnValue({
      isLocalVideoFile: true,
      isOwner: true,
      status: "ready",
      url: "blob:local-video-thumb",
    });

    render(
      <MediaLibraryGridMediaTile
        mediaItem={localVideo}
        index={0}
        isSelected={false}
        isMultiSelected={false}
        mediaMultiSelectMode={false}
        onMediaTileClick={jest.fn()}
        onEnterMediaMultiSelectMode={jest.fn()}
      />,
    );

    expect(screen.getByRole("img", { name: "video-1" })).toHaveAttribute(
      "src",
      "blob:local-video-thumb",
    );
  });

  it("keeps tile click handling when a still is shown", () => {
    mockUseLocalVideoFileUrl.mockReturnValue({
      isLocalVideoFile: true,
      isOwner: true,
      status: "ready",
      url: "blob:local-video-thumb",
    });
    const onMediaTileClick = jest.fn();

    render(
      <MediaLibraryGridMediaTile
        mediaItem={localVideo}
        index={2}
        isSelected={false}
        isMultiSelected={false}
        mediaMultiSelectMode={false}
        onMediaTileClick={onMediaTileClick}
        onEnterMediaMultiSelectMode={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(onMediaTileClick).toHaveBeenCalledWith(
      expect.anything(),
      localVideo,
      2,
    );
  });
});
