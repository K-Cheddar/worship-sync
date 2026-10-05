import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TransferProvider } from "../context/transferContext";
import ResourceUploadDialog from "./ResourceUploadDialog";
import { uploadChurchResource } from "../api/auth";

jest.mock("../api/auth", () => ({
  uploadChurchResource: jest.fn(),
}));

jest.mock("../containers/Media/useNativeFileDrop", () => ({
  useNativeFileDrop: () => ({
    isFileDragOver: false,
    fileDropHandlers: {},
  }),
}));

const mockUploadChurchResource = jest.mocked(uploadChurchResource);

describe("ResourceUploadDialog", () => {
  beforeEach(() => {
    mockUploadChurchResource.mockReset();
  });

  it("supports controlled opening, locks dismissal, and keeps minimize and restore available during upload", async () => {
    const user = userEvent.setup();
    const onResourcesUploaded = jest.fn();
    const onOpenChange = jest.fn();
    let finish!: () => void;
    mockUploadChurchResource.mockImplementation(({ file, name, onProgress }) => new Promise((resolve) => {
      onProgress?.(50);
      finish = () => resolve({
        id: "resource-1", churchId: "church-1", name: name || file.name, kind: "document",
        storage: { key: file.name, fileName: file.name, contentType: file.type, sizeBytes: file.size, uploadedAt: "2026-10-05" },
        createdAt: "2026-10-05", createdBy: "user-1", updatedAt: "2026-10-05", updatedBy: "user-1",
      });
    }));
    const ControlledUpload = () => {
      const [open, setOpen] = useState(false);
      return <>
        <button onClick={() => setOpen(true)}>Open upload</button>
        <ResourceUploadDialog churchId="church-1" onResourcesUploaded={onResourcesUploaded} open={open} showTrigger={false} onOpenChange={(next) => { onOpenChange(next); setOpen(next); }} />
      </>;
    };
    render(<MemoryRouter><TransferProvider><ControlledUpload /></TransferProvider></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    const opener = screen.getByRole("button", { name: "Open upload" });
    await user.click(opener);
    await user.upload(screen.getByLabelText("Select resource files"), new File(["guide"], "guide.pdf", { type: "application/pdf" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Upload" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByRole("progressbar", { name: "guide.pdf progress" }).map((bar) => bar.getAttribute("aria-valuenow"))).toEqual(["50", "50"]);
    await user.click(screen.getByRole("button", { name: "Restore resource upload" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    expect(within(screen.getByRole("dialog")).getByRole("progressbar", { name: "guide.pdf progress" })).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByRole("button", { name: "Close modal" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    await user.keyboard("{Escape}");
    fireEvent.pointerDown(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Minimize upload" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Minimize resource upload to button" }));
    await user.click(screen.getByRole("button", { name: "Uploading..." }));
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    await act(async () => finish());
    expect(onResourcesUploaded).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("queues multiple files, preserves edited names, and reports uploaded resources", async () => {
    const user = userEvent.setup();
    const onResourcesUploaded = jest.fn();
    mockUploadChurchResource.mockImplementation(async ({ file, name, onProgress }) => {
      onProgress?.(50);
      onProgress?.(100);
      return {
        id: `${file.name}-resource`,
        churchId: "church-1",
        name: name || file.name,
        kind: "document",
        storage: {
          key: file.name,
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          uploadedAt: "2026-09-22T00:00:00.000Z",
        },
        createdAt: "2026-09-22T00:00:00.000Z",
        createdBy: "user-1",
        updatedAt: "2026-09-22T00:00:00.000Z",
        updatedBy: "user-1",
      };
    });

    render(<ResourceUploadDialog churchId="church-1" onResourcesUploaded={onResourcesUploaded} />);
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await user.upload(screen.getByLabelText("Select resource files"), [
      new File(["one"], "one.pdf", { type: "application/pdf" }),
      new File(["two"], "two.txt", { type: "text/plain" }),
    ]);

    const firstName = screen.getByRole("textbox", { name: "Resource name for one.pdf" });
    await user.clear(firstName);
    await user.type(firstName, "Service guide");
    await user.click(screen.getByRole("button", { name: "Upload (2 files)" }));

    await waitFor(() => expect(onResourcesUploaded).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: "Service guide" }),
      expect.objectContaining({ name: "two.txt" }),
    ])));
    expect(screen.queryByRole("dialog", { name: "Upload resources" })).not.toBeInTheDocument();
    expect(mockUploadChurchResource).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: "Service guide" }));
    expect(mockUploadChurchResource).toHaveBeenNthCalledWith(2, expect.objectContaining({ name: "two.txt" }));
  });

  it("retries only failed resource rows through the shared transfer action", async () => {
    const user = userEvent.setup();
    const onResourcesUploaded = jest.fn();
    let secondAttempts = 0;
    mockUploadChurchResource.mockImplementation(async ({ file, name }) => {
      if (file.name === "two.txt" && secondAttempts++ === 0) throw new Error("Temporary upload failure.");
      return {
        id: `${file.name}-resource`, churchId: "church-1", name: name || file.name,
        kind: "document", storage: { key: file.name, fileName: file.name, contentType: file.type, sizeBytes: file.size, uploadedAt: "2026-09-22T00:00:00.000Z" },
        createdAt: "2026-09-22T00:00:00.000Z", createdBy: "user-1", updatedAt: "2026-09-22T00:00:00.000Z", updatedBy: "user-1",
      };
    });

    render(<MemoryRouter><TransferProvider><ResourceUploadDialog churchId="church-1" onResourcesUploaded={onResourcesUploaded} /></TransferProvider></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await user.upload(screen.getByLabelText("Select resource files"), [
      new File(["one"], "one.pdf", { type: "application/pdf" }),
      new File(["two"], "two.txt", { type: "text/plain" }),
    ]);
    await user.click(screen.getByRole("button", { name: "Upload (2 files)" }));

    await user.click(await screen.findByRole("button", { name: "Retry failed files" }));
    await screen.findByText("Complete");
    expect(mockUploadChurchResource).toHaveBeenCalledTimes(3);
    expect(mockUploadChurchResource.mock.calls.map(([input]) => input.file.name)).toEqual(["one.pdf", "two.txt", "two.txt"]);
    expect(onResourcesUploaded).toHaveBeenCalledTimes(2);
  });
});
