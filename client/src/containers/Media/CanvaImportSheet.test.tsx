import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  getCanvaDesign,
  getCanvaStatus,
  importCanvaDesign,
  listCanvaDesigns,
} from "../../api/canva";
import CanvaImportSheet from "./CanvaImportSheet";
import type { MediaType } from "../../types";
import type { mediaInfoType } from "./cloudinaryTypes";

jest.mock("../../api/canva", () => ({
  getCanvaStatus: jest.fn(),
  getCanvaDesign: jest.fn(),
  importCanvaDesign: jest.fn(),
  listCanvaDesigns: jest.fn(),
}));

const mockShowToast = jest.fn();
jest.mock("../../context/toastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock("../../utils/environment", () => ({
  isElectron: () => false,
  getApiBasePath: () => "/",
  isPackagedElectronRenderer: () => false,
}));

const existingMedia = {
  id: "media-1",
  name: "Weekly welcome",
  type: "image",
  canvaImportKey: "canva:DAF_design_1:rev:100:png:1",
  canvaSource: {
    designId: "DAF_design_1",
    designTitle: "Sunday Welcome",
    revision: 100,
    format: "png",
    pageNumbers: [1],
  },
} as MediaType;

const refreshedImage = {
  public_id: "canva/new-page-1",
  secure_url: "https://res.cloudinary.com/new-page-1.png",
  thumbnail_url: "https://res.cloudinary.com/new-page-1-thumb.png",
  resource_type: "image",
  format: "png",
  width: 1920,
  height: 1080,
  canvaImportKey: "canva:DAF_design_1:rev:101:png:1",
  canvaSource: {
    designId: "DAF_design_1",
    designTitle: "Sunday Welcome",
    revision: 101,
    format: "png",
    pageNumbers: [1],
  },
} as mediaInfoType;

test("opens a design from a pasted Canva link when the church account can access it", async () => {
  jest.mocked(getCanvaStatus).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
    accountLabel: "Church Creative",
  });
  jest.mocked(listCanvaDesigns).mockResolvedValue({
    items: [],
    continuation: "",
  });
  jest.mocked(getCanvaDesign).mockResolvedValue({
    id: "DAF_shared_99",
    title: "Shared Weekly Deck",
    thumbnailUrl: "https://example.test/shared.png",
    pageCount: 3,
    updatedAt: 200,
    editUrl: "https://www.canva.com/design/DAF_shared_99/edit",
    viewUrl: "https://www.canva.com/design/DAF_shared_99/view",
  });

  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <CanvaImportSheet
          open
          onOpenChange={jest.fn()}
          onImageComplete={jest.fn()}
          onVideoComplete={jest.fn()}
          onImageRefresh={jest.fn()}
          onVideoRefresh={jest.fn()}
          existingMedia={[]}
        />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  const user = userEvent.setup();
  const linkInput = await screen.findByLabelText(/Open by link/i);
  await user.type(
    linkInput,
    "https://www.canva.com/design/DAF_shared_99/view",
  );
  await user.click(screen.getByRole("button", { name: /^Open$/i }));

  await waitFor(() => {
    expect(getCanvaDesign).toHaveBeenCalledWith("church-1", "DAF_shared_99");
  });
  expect(await screen.findByText("Shared Weekly Deck")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Page 1/i })).toBeInTheDocument();
});

test("refreshes an existing Canva media record when its design revision changes", async () => {
  jest.mocked(getCanvaStatus).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
    accountLabel: "Church Creative",
  });
  jest.mocked(getCanvaDesign).mockResolvedValue({
    id: "DAF_design_1",
    title: "Sunday Welcome",
    thumbnailUrl: "https://example.test/thumb.png",
    pageCount: 2,
    updatedAt: 101,
    editUrl: "https://www.canva.com/api/design/token/edit",
    viewUrl: "https://www.canva.com/api/design/token/view",
  });
  jest.mocked(listCanvaDesigns).mockResolvedValue({
    items: [
      {
        id: "DAF_design_1",
        title: "Sunday Welcome",
        thumbnailUrl: "https://example.test/thumb.png",
        pageCount: 2,
        updatedAt: 101,
        editUrl: "https://www.canva.com/api/design/token/edit",
        viewUrl: "https://www.canva.com/api/design/token/view",
      },
    ],
    continuation: "",
  });
  jest.mocked(importCanvaDesign).mockResolvedValue({
    assets: [{ kind: "image", data: refreshedImage }],
    skippedCount: 0,
    revision: 101,
  });
  const onImageComplete = jest.fn();
  const onImageRefresh = jest.fn();

  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <CanvaImportSheet
          open
          onOpenChange={jest.fn()}
          onImageComplete={onImageComplete}
          onVideoComplete={jest.fn()}
          onImageRefresh={onImageRefresh}
          onVideoRefresh={jest.fn()}
          existingMedia={[existingMedia]}
          sourceMedia={existingMedia}
        />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  expect(
    await screen.findByText("A newer Canva revision is available."),
  ).toBeInTheDocument();
  const user = userEvent.setup();
  const openSpy = jest.spyOn(window, "open").mockReturnValue(null);
  await user.click(screen.getByRole("button", { name: "Edit in Canva" }));
  expect(mockShowToast).toHaveBeenCalledWith(
    "Canva did not open. Allow pop-ups for WorshipSync, then try again.",
    "error",
  );
  openSpy.mockRestore();
  await user.click(screen.getByRole("button", { name: "Change design" }));
  const prefetchedDesign = await screen.findByRole("button", {
    name: /Sunday Welcome/,
  });
  expect(listCanvaDesigns).toHaveBeenCalledWith("church-1");
  await user.click(prefetchedDesign);
  await user.click(screen.getByRole("button", { name: "Refresh selected" }));

  await waitFor(() => {
    expect(onImageRefresh).toHaveBeenCalledWith(refreshedImage, "media-1");
  });
  expect(onImageComplete).not.toHaveBeenCalled();
  expect(importCanvaDesign).toHaveBeenCalledWith("church-1", {
    designId: "DAF_design_1",
    pages: [1],
    format: "png",
    existingImportKeys: ["canva:DAF_design_1:rev:100:png:1"],
  });
});

test("creates a deck from new, refreshed, and already-current selected pages", async () => {
  const page2Existing = {
    ...existingMedia,
    id: "media-2",
    name: "Weekly welcome page 2",
    canvaImportKey: "canva:DAF_design_1:rev:101:png:2",
    canvaSource: {
      designId: "DAF_design_1",
      designTitle: "Sunday Welcome",
      revision: 101,
      format: "png" as const,
      pageNumbers: [2],
    },
    background: "https://res.cloudinary.com/page-2.png",
  } as MediaType;
  const newPage3 = {
    public_id: "canva/new-page-3",
    secure_url: "https://res.cloudinary.com/new-page-3.png",
    thumbnail_url: "https://res.cloudinary.com/new-page-3-thumb.png",
    resource_type: "image",
    format: "png",
    width: 1920,
    height: 1080,
    original_filename: "Page 3",
    canvaImportKey: "canva:DAF_design_1:rev:101:png:3",
    canvaSource: {
      designId: "DAF_design_1",
      designTitle: "Sunday Welcome",
      revision: 101,
      format: "png" as const,
      pageNumbers: [3],
    },
  } as mediaInfoType;
  const createdPage3 = {
    id: "media-3",
    name: "Page 3",
    type: "image",
    background: newPage3.secure_url,
    canvaImportKey: newPage3.canvaImportKey,
    canvaSource: newPage3.canvaSource,
  } as MediaType;

  jest.mocked(getCanvaStatus).mockResolvedValue({
    connected: true,
    oauthConfigured: true,
    accountLabel: "Church Creative",
  });
  jest.mocked(listCanvaDesigns).mockResolvedValue({
    items: [
      {
        id: "DAF_design_1",
        title: "Sunday Welcome",
        thumbnailUrl: "https://example.test/thumb.png",
        pageCount: 3,
        updatedAt: 101,
        editUrl: "https://www.canva.com/api/design/token/edit",
        viewUrl: "https://www.canva.com/api/design/token/view",
      },
    ],
    continuation: "",
  });
  jest.mocked(importCanvaDesign).mockResolvedValue({
    assets: [
      { kind: "image", data: refreshedImage },
      { kind: "image", data: newPage3 },
    ],
    skippedCount: 1,
    revision: 101,
  });
  const onImageComplete = jest.fn(() => createdPage3);
  const onImageRefresh = jest.fn();
  const onCreateDeckItem = jest.fn();

  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <CanvaImportSheet
          open
          onOpenChange={jest.fn()}
          onImageComplete={onImageComplete}
          onVideoComplete={jest.fn()}
          onImageRefresh={onImageRefresh}
          onVideoRefresh={jest.fn()}
          onCreateDeckItem={onCreateDeckItem}
          existingMedia={[existingMedia, page2Existing]}
        />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: /Sunday Welcome/ }),
  );
  // Page 1 is pre-selected when a design opens; add the rest of the selection.
  await user.click(screen.getByRole("button", { name: /Page 2/i }));
  await user.click(screen.getByRole("button", { name: /Page 3/i }));
  await user.click(
    screen.getByRole("button", { name: /Import selected|Refresh selected/i }),
  );

  await waitFor(() => {
    expect(onCreateDeckItem).toHaveBeenCalled();
  });
  const [deckPages, title] = onCreateDeckItem.mock.calls[0];
  expect(title).toBe("Sunday Welcome");
  expect(deckPages).toHaveLength(3);
  expect(deckPages[0].id).toBe("media-1");
  expect(deckPages[0].background).toBe(refreshedImage.secure_url);
  expect(deckPages[1].id).toBe("media-2");
  expect(deckPages[2].id).toBe("media-3");
  expect(onImageRefresh).toHaveBeenCalledWith(refreshedImage, "media-1");
  expect(onImageComplete).toHaveBeenCalledWith(newPage3);
});
