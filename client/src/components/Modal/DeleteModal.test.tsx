import { fireEvent, render, screen } from "@testing-library/react";
import DeleteModal from "./DeleteModal";

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
