import { fireEvent, render, screen } from "@testing-library/react";
import DeleteModal from "./DeleteModal";
import MediaLibraryMediaVisual from "../../containers/Media/MediaLibraryMediaVisual";
import { useLocalImageUrl } from "../../hooks/useLocalImageUrl";
import type { MediaType } from "../../types";

jest.mock("../../hooks/useLocalImageUrl", () => ({
  useLocalImageUrl: jest.fn(),
}));
jest.mock("../../hooks/useLocalVideoFileUrl", () => ({
  useLocalVideoFileUrl: () => ({ isLocalVideoFile: false }),
}));

jest.mock("./Modal", () => ({
  __esModule: true,
  default: ({
    isOpen,
    onClose,
    title,
    children,
  }: {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title || "modal"}>
        <button type="button" onClick={onClose}>
          backdrop-close
        </button>
        {children}
      </div>
    ) : null,
}));

jest.mock("../../hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: (url: string | undefined) =>
    url ? `cached:${url}` : url,
}));

describe("DeleteModal", () => {
  it("resolves a local media preview without rendering its internal URL while loading or unavailable", () => {
    const media: MediaType = {
      id: "local-1", publicId: "local-1", name: "Welcome.jpg",
      path: "", createdAt: "", updatedAt: "", format: "jpg",
      height: 1080, width: 1920, type: "image", source: "local",
      background: "local-image://local-1", thumbnail: "local-image://local-1",
      localImage: {
        id: "local-1", ownerDeviceId: "device-1", ownerLabel: "Booth",
        fileName: "Welcome.jpg", contentType: "image/jpeg", storagePolicy: "local-only",
      },
    };
    const resolution = jest.mocked(useLocalImageUrl);
    resolution.mockReturnValue({ isLocalImage: true, isOwner: true, status: "loading" });
    const dialog = () => (
      <DeleteModal isOpen onClose={jest.fn()} onConfirm={jest.fn()} itemName={media.name}
        imagePreview={<MediaLibraryMediaVisual mediaItem={media} imageAlt={media.name} />} />
    );
    const { rerender } = render(dialog());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(resolution).toHaveBeenCalledWith(media.localImage, "thumbnail");
    resolution.mockReturnValue({ isLocalImage: true, isOwner: true, status: "ready", url: "blob:thumbnail" });
    rerender(dialog());
    expect(screen.getByRole("img", { name: media.name })).toHaveAttribute("src", "cached:blob:thumbnail");
    resolution.mockReturnValue({ isLocalImage: true, isOwner: true, status: "unavailable" });
    rerender(dialog());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("locks dismissal controls while a delete is being confirmed", () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();

    render(
      <DeleteModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        itemName="Welcome Slide"
        imageUrl="preview.jpg"
        isConfirming
      />
    );

    expect(screen.getByRole("img", { name: "Welcome Slide" })).toHaveAttribute(
      "src",
      "cached:preview.jpg"
    );

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    const confirmButton = screen.getByRole("button", { name: "Deleting..." });

    expect(cancelButton).toBeDisabled();
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "backdrop-close" }));
    fireEvent.click(cancelButton);
    fireEvent.click(confirmButton);

    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
