import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { useNativeFileDrop } from "../containers/Media/useNativeFileDrop";
import { TransferProvider } from "../context/transferContext";
import ResourceUploadDialog from "./ResourceUploadDialog";
import { uploadChurchResource } from "../api/auth";

jest.mock("../api/auth", () => ({
  uploadChurchResource: jest.fn(),
}));

jest.mock("../containers/Media/useNativeFileDrop", () => ({
  useNativeFileDrop: jest.fn(() => ({
    isFileDragOver: false,
    fileDropHandlers: {},
  })),
}));

const mockUploadChurchResource = jest.mocked(uploadChurchResource);

describe("ResourceUploadDialog", () => {
  beforeEach(() => {
    mockUploadChurchResource.mockReset();
  });

  it("keeps an adaptive resource list and compact Add files target after selection", async () => {
    const user = userEvent.setup();
    render(<ResourceUploadDialog churchId="church-1" onResourcesUploaded={jest.fn()} />);
    await user.click(screen.getByRole("button", { name: "Upload" }));

    const dialog = screen.getByRole("dialog", { name: "Upload resources" });
    expect(dialog).toHaveClass("max-w-2xl", "max-h-[90vh]");
    const dropZone = within(dialog).getByRole("group", { name: "Resource file drop zone" });
    expect(dropZone).toHaveClass("p-4");
    expect(within(dropZone).getByText("Drop files here or choose files")).toBeInTheDocument();
    expect(within(dropZone).getByText("Images, documents, and MP3 audio")).toBeInTheDocument();
    expect(within(dropZone).getByRole("button", { name: "Choose files" })).toBeInTheDocument();

    const files = ["one.pdf", "two.pdf", "three.pdf", "four.pdf", "five.pdf", "six.pdf", "seven.pdf", "eight.pdf"]
      .map((name) => new File(["pdf"], name, { type: "application/pdf" }));
    await user.upload(screen.getByLabelText("Select resource files"), files);

    expect(dropZone).toHaveClass("p-2");
    expect(within(dropZone).getByText("Drop more files here")).toBeInTheDocument();
    expect(within(dropZone).getByRole("button", { name: "Add files" })).toBeInTheDocument();
    const list = within(dialog).getByRole("region", { name: "Selected resource files" });
    expect(list).toHaveClass("min-h-0", "flex-1", "overflow-y-auto", "max-h-[min(50vh,32rem)]");
    files.forEach((file) => expect(within(list).getByText(file.name)).toBeInTheDocument());
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Upload (8 files)" })).toBeInTheDocument();
  });
  it("limits the file picker to supported formats and accepts common image uploads", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onResourcesUploaded = jest.fn();
    mockUploadChurchResource.mockImplementation(async ({ file, name }) => ({
      id: "jpeg-resource", churchId: "church-1", name: name || file.name, kind: "image",
      storage: { key: file.name, fileName: file.name, contentType: file.type, sizeBytes: file.size, uploadedAt: "2026-10-05" },
      createdAt: "2026-10-05", createdBy: "user-1", updatedAt: "2026-10-05", updatedBy: "user-1",
    }));
    render(<MemoryRouter><TransferProvider><ResourceUploadDialog churchId="church-1" onResourcesUploaded={onResourcesUploaded} /></TransferProvider></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Upload" }));
    const input = screen.getByLabelText("Select resource files");
    for (const contentType of ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]) {
      expect(input).toHaveAttribute("accept", expect.stringContaining(contentType));
    }
    await user.upload(input, [
      new File(["jpeg"], "profile.jpg", { type: "image/jpeg" }),
      new File(["png"], "slide.png", { type: "image/png" }),
      new File(["gif"], "banner.gif", { type: "image/gif" }),
      new File(["webp"], "photo.webp", { type: "image/webp" }),
      new File(["avif"], "cover.avif", { type: "image/avif" }),
      new File(["svg"], "unsupported.svg", { type: "image/svg+xml" }),
    ]);
    expect(screen.getByText(/unsupported\.svg: Choose a JPEG, PNG, GIF, WebP, AVIF/)).toBeVisible();
    expect(screen.getByText("Drop more files here")).toBeInTheDocument();
    expect(screen.queryByText("Images, documents, and MP3 audio")).not.toBeInTheDocument();
    expect(screen.queryByText(/Choose JPEG, PNG/)).not.toBeInTheDocument();
    for (const fileName of ["profile.jpg", "slide.png", "banner.gif", "photo.webp", "cover.avif"]) {
      expect(screen.getByText(fileName)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Edit name for ${fileName}` })).toBeInTheDocument();
    }
    expect(screen.queryByText("Source: profile.jpg")).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Upload (5 files)" }));
    await waitFor(() => expect(mockUploadChurchResource).toHaveBeenCalledTimes(5));
    await waitFor(() => expect(onResourcesUploaded).toHaveBeenCalledTimes(1));
    expect(mockUploadChurchResource.mock.calls.map(([input]) => input.file.name)).toEqual([
      "profile.jpg", "slide.png", "banner.gif", "photo.webp", "cover.avif",
    ]);
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
    expect(screen.getAllByRole("progressbar", { name: "guide.pdf progress" }).map((bar) => bar.getAttribute("aria-valuenow"))).toEqual(["50"]);
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

    render(<MemoryRouter><TransferProvider><ResourceUploadDialog churchId="church-1" onResourcesUploaded={onResourcesUploaded} /></TransferProvider></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await user.upload(screen.getByLabelText("Select resource files"), [
      new File(["one"], "one.pdf", { type: "application/pdf" }),
      new File(["two"], "two.txt", { type: "text/plain" }),
    ]);

    await user.click(screen.getByRole("button", { name: "Edit name for one.pdf" }));
    const firstName = screen.getByRole("textbox", { name: "Display name for one.pdf" });
    await user.clear(firstName);
    await user.type(firstName, "Service guide");
    await user.keyboard("{Enter}");
    expect(screen.getByText("Source: one.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove one.pdf" })).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Edit name for two.txt" }));
    const retryName = screen.getByRole("textbox", { name: "Display name for two.txt" });
    await user.clear(retryName);
    await user.type(retryName, "service handout");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Upload (2 files)" }));

    await screen.findByRole("button", { name: "Restore resource upload" });
    await user.click(screen.getByRole("button", { name: "Restore resource upload" }));
    const dialog = screen.getByRole("dialog", { name: "Upload resources" });
    expect(within(dialog).getByText("Retry uses this batch’s original files and names.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Add files" })).toBeDisabled();
    expect(within(dialog).getByLabelText("Select resource files")).toBeDisabled();
    expect(jest.mocked(useNativeFileDrop)).toHaveBeenLastCalledWith(expect.objectContaining({ disabled: true }));
    expect(within(dialog).queryByRole("button", { name: "Edit name for two.txt" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Remove two.txt" })).not.toBeInTheDocument();
    expect(within(dialog).getByText("service handout")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Retry failed" }));
    await screen.findAllByText("Complete");
    expect(mockUploadChurchResource).toHaveBeenCalledTimes(3);
    expect(mockUploadChurchResource.mock.calls.map(([input]) => [input.file.name, input.name])).toEqual([
      ["one.pdf", "one.pdf"],
      ["two.txt", "service handout"],
      ["two.txt", "service handout"],
    ]);
    expect(onResourcesUploaded).toHaveBeenCalledTimes(2);
  });

  it("retries a failed file from the global transfer after the Resources dialog unmounts", async () => {
    const user = userEvent.setup();
    let releaseFirst!: () => void;
    let twoAttempts = 0;
    const onResourcesUploaded = jest.fn();
    mockUploadChurchResource.mockImplementation(async ({ file, name }) => {
      if (file.name === "one.pdf") {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      } else if (twoAttempts++ === 0) {
        throw new Error("Temporary upload failure.");
      }
      return {
        id: `${file.name}-resource`, churchId: "church-1", name: name || file.name,
        kind: "document", storage: { key: file.name, fileName: file.name, contentType: file.type, sizeBytes: file.size, uploadedAt: "2026-10-05" },
        createdAt: "2026-10-05", createdBy: "user-1", updatedAt: "2026-10-05", updatedBy: "user-1",
      };
    });
    const Route = () => {
      const [onResourcesRoute, setOnResourcesRoute] = useState(true);
      return <>
        <button onClick={() => setOnResourcesRoute(false)}>Leave Resources</button>
        {onResourcesRoute ? <ResourceUploadDialog churchId="church-1" onResourcesUploaded={onResourcesUploaded} /> : null}
      </>;
    };
    render(<MemoryRouter><TransferProvider><Route /></TransferProvider></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await user.upload(screen.getByLabelText("Select resource files"), [
      new File(["one"], "one.pdf", { type: "application/pdf" }),
      new File(["two"], "two.txt", { type: "text/plain" }),
    ]);
    await user.click(screen.getByRole("button", { name: "Upload (2 files)" }));
    await user.click(screen.getByRole("button", { name: "Leave Resources" }));
    await act(async () => releaseFirst());
    await screen.findByRole("button", { name: "Retry failed files" });
    await user.click(screen.getByRole("button", { name: "Retry failed files" }));
    await screen.findAllByText("Complete");
    expect(mockUploadChurchResource.mock.calls.map(([input]) => input.file.name)).toEqual([
      "one.pdf", "two.txt", "two.txt",
    ]);
    expect(onResourcesUploaded).not.toHaveBeenCalled();
  });
});
