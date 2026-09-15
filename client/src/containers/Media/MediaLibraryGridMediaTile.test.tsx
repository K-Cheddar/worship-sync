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
const mockUseDraggable = jest.fn(() => ({
  attributes: {},
  listeners: {},
  setNodeRef: jest.fn(),
  transform: null,
  isDragging: false,
}));

jest.mock("@dnd-kit/core", () => ({
  useDraggable: (options: unknown) => {
    mockUseDraggable(options);
    return {
      attributes: {},
      listeners: {},
      setNodeRef: jest.fn(),
      transform: null,
      isDragging: false,
    };
  },
}));

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
    expect(screen.getByRole("img", { name: "video-1" })).toHaveAttribute(
      "draggable",
      "false",
    );
  });

  it("shows the video input label with the Video icon", () => {
    const localVideoInput: MediaType = {
      path: "",
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
      format: "live",
      height: 1080,
      width: 1920,
      name: "Main camera",
      publicId: "input-1",
      type: "video",
      id: "input-1",
      background: "local-video-input://source-1",
      thumbnail: "",
      source: "local",
      localVideoInput: {
        kind: "local-video-input",
        sourceId: "source-1",
        label: "Main camera",
        ownerDeviceId: "device-1",
        ownerLabel: "Booth PC",
      },
    };

    render(
      <MediaLibraryGridMediaTile
        mediaItem={localVideoInput}
        index={0}
        isSelected={false}
        isMultiSelected={false}
        mediaMultiSelectMode={false}
        onMediaTileClick={jest.fn()}
        onEnterMediaMultiSelectMode={jest.fn()}
      />,
    );

    expect(screen.getByText("Main camera")).toBeInTheDocument();
    expect(screen.getByText("Video input")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("prefers the library display name over the device label", () => {
    const localVideoInput: MediaType = {
      path: "",
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
      format: "live",
      height: 1080,
      width: 1920,
      name: "Camera video",
      publicId: "input-1",
      type: "video",
      id: "input-1",
      background: "local-video-input://source-1",
      thumbnail: "",
      source: "local",
      localVideoInput: {
        kind: "local-video-input",
        sourceId: "source-1",
        label: "Video input",
        ownerDeviceId: "device-1",
        ownerLabel: "Booth PC",
      },
    };

    render(
      <MediaLibraryGridMediaTile
        mediaItem={localVideoInput}
        index={0}
        isSelected={false}
        isMultiSelected={false}
        mediaMultiSelectMode={false}
        onMediaTileClick={jest.fn()}
        onEnterMediaMultiSelectMode={jest.fn()}
      />,
    );

    expect(screen.getByText("Camera video")).toBeInTheDocument();
    // Origin badge still uses the kind label; the tile body should not.
    expect(screen.getAllByText("Video input")).toHaveLength(1);
  });

  it("shows a Screen share badge for desktop capture items", () => {
    const screenShare: MediaType = {
      path: "",
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
      format: "live",
      height: 1080,
      width: 1920,
      name: "Lyrics screen",
      publicId: "share-1",
      type: "video",
      id: "share-1",
      background: "local-video-input://source-2",
      thumbnail: "",
      source: "local",
      localVideoInput: {
        kind: "local-video-input",
        sourceId: "source-2",
        label: "Lyrics screen",
        captureKind: "screen",
        ownerDeviceId: "device-1",
        ownerLabel: "Booth PC",
      },
    };

    render(
      <MediaLibraryGridMediaTile
        mediaItem={screenShare}
        index={0}
        isSelected={false}
        isMultiSelected={false}
        mediaMultiSelectMode={false}
        onMediaTileClick={jest.fn()}
        onEnterMediaMultiSelectMode={jest.fn()}
      />,
    );

    expect(screen.getByText("Lyrics screen")).toBeInTheDocument();
    expect(screen.getByText("Screen share")).toBeInTheDocument();
  });

  it("shows a Local badge for device-only files", () => {
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

    expect(screen.getByText("Local")).toBeInTheDocument();
  });

  it("hides the Local badge when the file is also uploaded to the cloud", () => {
    const cloudSharedVideo: MediaType = {
      ...localVideo,
      localVideoFile: {
        ...localVideo.localVideoFile!,
        storagePolicy: "local-and-cloud",
        cloudUrl: "https://stream.example/welcome.m3u8",
      },
    };

    render(
      <MediaLibraryGridMediaTile
        mediaItem={cloudSharedVideo}
        index={0}
        isSelected={false}
        isMultiSelected={false}
        mediaMultiSelectMode={false}
        onMediaTileClick={jest.fn()}
        onEnterMediaMultiSelectMode={jest.fn()}
      />,
    );

    expect(screen.queryByText("Local")).not.toBeInTheDocument();
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

  it("uses the selected media group only when the dragged tile is selected", () => {
    render(
      <MediaLibraryGridMediaTile
        mediaItem={localVideo}
        index={0}
        isSelected
        isMultiSelected
        mediaMultiSelectMode
        orderedSelectedMediaIds={["video-1", "image-2"]}
        mediaDragEnabled
        onMediaTileClick={jest.fn()}
        onEnterMediaMultiSelectMode={jest.fn()}
      />,
    );

    expect(mockUseDraggable).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { kind: "media", mediaIds: ["video-1", "image-2"] },
      }),
    );
  });

  it("ignores a stale selection when the dragged tile is unselected", () => {
    render(
      <MediaLibraryGridMediaTile
        mediaItem={localVideo}
        index={0}
        isSelected={false}
        isMultiSelected={false}
        mediaMultiSelectMode
        orderedSelectedMediaIds={["old-selection"]}
        mediaDragEnabled
        onMediaTileClick={jest.fn()}
        onEnterMediaMultiSelectMode={jest.fn()}
      />,
    );

    expect(mockUseDraggable).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { kind: "media", mediaIds: ["video-1"] },
      }),
    );
  });
});
