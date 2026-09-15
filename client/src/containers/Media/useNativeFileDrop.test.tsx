import { render, screen, fireEvent } from "@testing-library/react";
import { useNativeFileDrop } from "./useNativeFileDrop";

function TestDropTarget({ disabled = false }: { disabled?: boolean }) {
  const { isFileDragOver, fileDropHandlers } = useNativeFileDrop({
    disabled,
    onFiles: jest.fn(),
  });
  return (
    <div data-testid="target" {...fileDropHandlers}>
      {isFileDragOver ? "Drop files to add media" : "Idle"}
    </div>
  );
}

describe("useNativeFileDrop", () => {
  it("prevents native file dragover and clears state on dragleave", () => {
    render(<TestDropTarget />);
    const target = screen.getByTestId("target");
    const file = new File(["image"], "photo.png", { type: "image/png" });

    fireEvent.dragEnter(target, { dataTransfer: { types: ["Files"], files: [file] } });
    expect(screen.getByText("Drop files to add media")).toBeInTheDocument();
    fireEvent.dragOver(target, { dataTransfer: { types: ["Files"], files: [file] } });
    fireEvent.dragLeave(target, { dataTransfer: { types: ["Files"], files: [file] } });
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });

  it("ignores internal drags without preventing them", () => {
    render(<TestDropTarget />);
    const target = screen.getByTestId("target");
    const event = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { types: ["application/x-worshipsync-media"], files: [] },
    });

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });

  it("ignores native files when disabled", () => {
    render(<TestDropTarget disabled />);
    const target = screen.getByTestId("target");
    const event = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { types: ["Files"], files: [] },
    });

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });
});
