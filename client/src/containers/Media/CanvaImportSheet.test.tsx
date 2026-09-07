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
