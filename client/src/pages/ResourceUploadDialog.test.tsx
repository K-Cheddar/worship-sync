import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
});
