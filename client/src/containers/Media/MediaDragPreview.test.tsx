import { render, screen } from "@testing-library/react";
import type { MediaType } from "../../types";
import MediaDragPreview from "./MediaDragPreview";

jest.mock("../../hooks/useLocalImageUrl", () => ({
  useLocalImageUrl: jest.fn((value) => ({
    isLocalImage: Boolean(value),
    isOwner: true,
    status: value ? "ready" : "not-local",
    url: value ? "blob:local-image-thumbnail" : undefined,
  })),
}));

jest.mock("../../hooks/useLocalVideoFileUrl", () => ({
  useLocalVideoFileUrl: jest.fn((value) => ({
    isLocalVideoFile: Boolean(value),
    isOwner: true,
    status: value ? "ready" : "not-local",
    url: value ? "blob:local-video-thumbnail" : undefined,
  })),
}));

jest.mock("../../hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: (src?: string) => src,
}));

const media = (overrides: Partial<MediaType> = {}) =>
  ({
    id: "media-1",
    name: "Welcome",
    type: "image",
    thumbnail: "https://cdn.example/welcome.jpg",
    background: "https://cdn.example/welcome.jpg",
    ...overrides,
  }) as MediaType;

describe("MediaDragPreview", () => {
  it("uses the same local image thumbnail resolution as the media tile", () => {
    render(
      <MediaDragPreview
        mediaItems={[
          media({
            localImage: {
              id: "local-image-1",
              ownerDeviceId: "device-1",
              ownerLabel: "Booth PC",
              fileName: "welcome.jpg",
              contentType: "image/jpeg",
              storagePolicy: "local-only",
            },
          }),
        ]}
        variant="overlay"
      />,
    );

    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "blob:local-image-thumbnail",
    );
  });

  it("keeps cloud media identifiable", () => {
    render(<MediaDragPreview mediaItems={[media()]} variant="overlay" />);

    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "https://cdn.example/welcome.jpg",
    );
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });

  it("uses the local video thumbnail resolution", () => {
    render(
      <MediaDragPreview
        mediaItems={[
          media({
            type: "video",
            thumbnail: "",
            localVideoFile: {
              id: "local-video-1",
              ownerDeviceId: "device-1",
              ownerLabel: "Booth PC",
              fileName: "welcome.mp4",
              contentType: "video/mp4",
              storagePolicy: "local-only",
            },
          }),
        ]}
        variant="overlay"
      />,
    );

    expect(screen.getByRole("img", { name: "Welcome" })).toHaveAttribute(
      "src",
      "blob:local-video-thumbnail",
    );
  });

  it("uses the capture label fallback for live inputs", () => {
    render(
      <MediaDragPreview
        mediaItems={[
          media({
            name: "Confidence monitor",
            thumbnail: "",
            background: "",
            localVideoInput: {
              kind: "local-video-input",
              sourceId: "screen-1",
              label: "Confidence monitor",
              captureKind: "window",
              ownerDeviceId: "device-1",
              ownerLabel: "Booth PC",
            },
          }),
        ]}
        variant="overlay"
      />,
    );

    expect(screen.getAllByText("Confidence monitor")).toHaveLength(2);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
